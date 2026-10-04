// Vercel serverless function — every database read and write the app performs.
//
// The browser no longer holds a Supabase key of any kind. RLS is closed on every table and
// only the service_role key in these functions can get past it, so this file is the whole
// data layer: one POST endpoint, an `action` naming the operation, and a signed session
// token saying who is asking. Each action states which role it needs, and nothing takes the
// caller's word for who they are — a student's id, a teacher's ownership of an exam and a
// submitted score are all re-derived here from the token and the database.
//
// POST { action, ...payload } with Authorization: Bearer <token> -> { data } | { error }
import { pgSelect, pgInsert, pgUpdate, pgDelete, pgUpsert, storageUpload, isSupabaseAdminConfigured } from './_supabaseAdmin.js';
import { sessionFromRequest, isSessionConfigured, SessionPayload } from './_session.js';
import { calculateScore, codeFingerprint, CodePassedFn, ScorableQuestion } from './_scoring.js';
import { isAssignedToStudent } from './_assignment.js';

// Everything a question needs for grading, including the parts a student must never see.
const GRADING_COLUMNS = 'id,type,score,correct_option_index,accepted_answers';

// What a student's browser is allowed to receive. correct_option_index and
// accepted_answers are deliberately absent: the answer key stays on this side now, and the
// score comes back from the server instead of being worked out in the exam page.
const STUDENT_QUESTION_COLUMNS =
  'id,exam_id,type,text,image_url,score,options,test_cases,hidden_test_case_count,language,allow_file_upload,input_mode';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const bad = (message: string) => new HttpError(400, message);
const forbidden = (message: string) => new HttpError(403, message);

const requireTeacher = (session: SessionPayload | null): SessionPayload => {
  if (!session) throw new HttpError(401, 'Not signed in.');
  if (session.role !== 'TEACHER') throw forbidden('Teachers only.');
  return session;
};

const requireStudent = (session: SessionPayload | null): SessionPayload => {
  if (!session) throw new HttpError(401, 'Not signed in.');
  if (session.role !== 'STUDENT') throw forbidden('Students only.');
  return session;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (value: any, label: string): string => {
  const id = String(value || '');
  if (!UUID.test(id)) throw bad(`${label} is not a valid id.`);
  return id;
};

const asStringList = (value: any): string[] => (Array.isArray(value) ? value.map((v) => String(v)) : []);

// An exam belongs to the teacher who created it, and a teacher only ever sees their own.
// Every action that names an examId goes through here first, so passing someone else's id
// is a 403 rather than a window into their class.
const assertOwnsExam = async (session: SessionPayload, examId: string) => {
  const { data } = await pgSelect<any[]>('exams', `id=eq.${examId}&select=id,created_by`);
  const exam = data?.[0];
  if (!exam) throw new HttpError(404, 'Exam not found.');
  if (exam.created_by && exam.created_by !== session.sub) throw forbidden('This exam belongs to another teacher.');
  return exam;
};

// ==========================================
// SCORING
// ==========================================
// A code answer counts only if api/judge.ts recorded a passing verdict for this student,
// this question, and this exact code. The `passed` flag the browser stores next to the
// answer is a copy for the UI — believing it would let a student grade themselves by
// editing one field in a request body.
// Returns a lookup: give it a student id and it gives back the `codePassed` rule for that
// student, ready to hand to calculateScore.
type VerdictLookup = (studentId: string) => CodePassedFn;

const loadVerdicts = async (studentIds: string[], questionIds: string[]): Promise<VerdictLookup> => {
  if (studentIds.length === 0 || questionIds.length === 0) return () => () => false;

  const { data } = await pgSelect<any[]>(
    'judge_results',
    `student_id=in.(${studentIds.map((s) => `"${s}"`).join(',')})&question_id=in.(${questionIds.join(',')})` +
      '&select=student_id,question_id,code_fingerprint,passed'
  );
  const verdicts = new Map<string, { fingerprint: string; passed: boolean }>();
  (data || []).forEach((row: any) => {
    verdicts.set(`${row.student_id}:${row.question_id}`, {
      fingerprint: row.code_fingerprint,
      passed: row.passed === true,
    });
  });

  return (studentId: string) => (question, answer) => {
    const code = typeof answer === 'object' && answer !== null ? String(answer.code || '') : '';
    if (!code.trim()) return false;
    const verdict = verdicts.get(`${studentId}:${question.id}`);
    if (!verdict || !verdict.passed) return false;
    // The verdict belongs to the code that was judged. Editing afterwards drops the mark,
    // which is the same thing the student is told on screen.
    return verdict.fingerprint === codeFingerprint(code);
  };
};

// Attempts sat before the lockdown have no recorded verdicts — the judge wasn't writing
// any — so grading them strictly would turn every code answer in the existing data to zero
// the first time a teacher pressed Re-grade. Those attempts keep the old rule (the verdict
// stored with the answer) and everything sat since is graded from the recorded verdicts.
// started_at is the right clock for this because it is set once, when the attempt begins,
// and re-grading preserves it.
const LEGACY_VERDICT_CUTOFF = Date.parse(process.env.LEGACY_VERDICT_CUTOFF || '2026-10-04T00:00:00Z');

const isLegacyAttempt = (startedAt: any): boolean => {
  const started = startedAt ? Date.parse(String(startedAt)) : NaN;
  return !Number.isFinite(started) || started < LEGACY_VERDICT_CUTOFF;
};

const scoreFor = (
  questions: ScorableQuestion[],
  answers: Record<string, any>,
  studentId: string,
  verdicts: VerdictLookup,
  startedAt?: any
) => calculateScore(questions, answers, isLegacyAttempt(startedAt) ? undefined : verdicts(studentId));

const gradingQuestions = async (examId: string): Promise<ScorableQuestion[]> => {
  const { data } = await pgSelect<any[]>('questions', `exam_id=eq.${examId}&select=${GRADING_COLUMNS}`);
  return (data || []).map((q: any) => ({
    id: q.id,
    type: q.type,
    score: q.score || 0,
    correctOptionIndex: q.correct_option_index,
    acceptedAnswers: q.accepted_answers,
  }));
};

const safeParseJSON = (input: any) => {
  if (typeof input === 'object' && input !== null) return input;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      return {};
    }
  }
  return {};
};

// Rescores every attempt at one exam from the stored answers. Used by the teacher's
// "Re-grade Scores" button and after an exam is edited.
const rescoreExam = async (examId: string) => {
  const questions = await gradingQuestions(examId);
  const { data: rows } = await pgSelect<any[]>('student_progress', `exam_id=eq.${examId}&select=*`);
  const progress = rows || [];
  if (progress.length === 0) return 0;

  const verdicts = await loadVerdicts(
    progress.map((p: any) => p.student_id),
    questions.filter((q) => q.type === 'JAVA').map((q) => q.id)
  );

  const updates = progress.map((p: any) => ({
    student_id: p.student_id,
    exam_id: examId,
    score: scoreFor(questions, safeParseJSON(p.answers), p.student_id, verdicts, p.started_at),
    // The upsert replaces the whole row, so everything else has to be carried over.
    current_question_index: p.current_question_index,
    answers: safeParseJSON(p.answers),
    status: p.status,
    started_at: p.started_at,
    auto_submitted: p.auto_submitted,
    tab_switch_count: p.tab_switch_count,
    capture_attempt_count: p.capture_attempt_count,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await pgUpsert('student_progress', updates, 'student_id,exam_id');
  if (error) throw new HttpError(500, error.message);
  return updates.length;
};

// ==========================================
// ACTIONS
// ==========================================
type Handler = (payload: any, session: SessionPayload | null) => Promise<any>;

const actions: Record<string, Handler> = {
  // ---- STUDENT ---------------------------------------------------------------------
  // The exams this student may sit. Section and major come from their own row, not from
  // the request, so neither can be claimed to reach another section's paper.
  'student.exams': async (_payload, session) => {
    const me = requireStudent(session);
    const { data: users } = await pgSelect<any[]>(
      'users',
      `student_id=eq.${encodeURIComponent(me.studentId!)}&select=section,major`
    );
    const student = users?.[0] || {};
    const { data } = await pgSelect<any[]>(
      'exams',
      `is_active=eq.true&select=*,questions(${STUDENT_QUESTION_COLUMNS})`
    );
    return (data || []).filter((e: any) =>
      isAssignedToStudent(
        { assignedSections: e.assigned_sections || [], assignedMajors: e.assigned_majors || [] },
        { section: student.section, major: student.major }
      )
    );
  },

  'student.progress': async (payload, session) => {
    const me = requireStudent(session);
    const examId = asUuid(payload?.examId, 'examId');
    const { data } = await pgSelect<any[]>(
      'student_progress',
      `student_id=eq.${encodeURIComponent(me.studentId!)}&exam_id=eq.${examId}&select=*`
    );
    const row = data?.[0];
    return row ? { ...row, student_name: me.name } : null;
  },

  // Saves an attempt. The row is keyed by the token's student id, and the score is worked
  // out here — whatever the browser computed for its own display is ignored.
  'student.saveProgress': async (payload, session) => {
    const me = requireStudent(session);
    const examId = asUuid(payload?.examId, 'examId');

    const { data: examRows } = await pgSelect<any[]>('exams', `id=eq.${examId}&select=id,is_active`);
    if (!examRows?.[0]) throw new HttpError(404, 'Exam not found.');

    const answers = safeParseJSON(payload?.answers);
    const questions = await gradingQuestions(examId);
    const verdicts = await loadVerdicts(
      [me.studentId!],
      questions.filter((q) => q.type === 'JAVA').map((q) => q.id)
    );

    // started_at is what the exam clock counts from, so it is fixed once and then left
    // alone: the first save sets it, every later save keeps whatever is already stored.
    // On that first save the browser's value is accepted but clamped into the last day —
    // otherwise a backdated one would both extend the timer and drop the attempt into the
    // pre-lockdown window, where code answers are graded on trust.
    const { data: existingRows } = await pgSelect<any[]>(
      'student_progress',
      `student_id=eq.${encodeURIComponent(me.studentId!)}&exam_id=eq.${examId}&select=started_at`
    );
    let startedAt: string | undefined = existingRows?.[0]?.started_at || undefined;
    if (!startedAt) {
      const now = Date.now();
      const claimed = payload?.startedAt ? new Date(payload.startedAt).getTime() : now;
      const valid = Number.isFinite(claimed) ? claimed : now;
      startedAt = new Date(Math.min(Math.max(valid, now - 24 * 60 * 60 * 1000), now)).toISOString();
    }

    const status = ['IDLE', 'IN_PROGRESS', 'COMPLETED'].includes(payload?.status) ? payload.status : 'IN_PROGRESS';
    const row: any = {
      student_id: me.studentId,
      exam_id: examId,
      current_question_index: Number(payload?.currentQuestionIndex) || 0,
      answers,
      score: scoreFor(questions, answers, me.studentId!, verdicts, startedAt),
      status,
      started_at: startedAt,
      auto_submitted: !!payload?.autoSubmitted,
      tab_switch_count: Number(payload?.tabSwitchCount) || 0,
      capture_attempt_count: Number(payload?.captureAttemptCount) || 0,
      updated_at: new Date().toISOString(),
    };

    const { error } = await pgUpsert('student_progress', [row], 'student_id,exam_id');
    if (error) throw new HttpError(500, error.message);
    return { score: row.score };
  },

  // ---- TEACHER: EXAMS ----------------------------------------------------------------
  'teacher.exams': async (_payload, session) => {
    const me = requireTeacher(session);
    const { data } = await pgSelect<any[]>(
      'exams',
      `created_by=eq.${me.sub}&select=*,questions(*)&order=created_at.desc`
    );
    const exams = data || [];

    // The teacher's editor needs the hidden test cases themselves, which no other reader
    // of this database ever gets.
    const codeQuestionIds = exams.flatMap((e: any) => (e.questions || []).filter((q: any) => q.type === 'JAVA').map((q: any) => q.id));
    if (codeQuestionIds.length > 0) {
      const { data: hidden } = await pgSelect<any[]>(
        'question_hidden_test_cases',
        `question_id=in.(${codeQuestionIds.join(',')})&select=question_id,input,output`
      );
      const byQuestion = new Map<string, any[]>();
      (hidden || []).forEach((row: any) => {
        if (!byQuestion.has(row.question_id)) byQuestion.set(row.question_id, []);
        byQuestion.get(row.question_id)!.push({ input: row.input, output: row.output, hidden: true });
      });
      exams.forEach((e: any) =>
        (e.questions || []).forEach((q: any) => {
          const extra = byQuestion.get(q.id);
          if (extra?.length) q.test_cases = [...(q.test_cases || []), ...extra];
        })
      );
    }
    return exams;
  },

  // Saves an exam and its questions.
  //
  // Question ids are preserved. This used to delete every question and insert the set
  // again, which minted new ids on every save — and because an attempt stores its answers
  // keyed by question id, editing an exam after a class had sat it detached all of their
  // answers and left the whole section on zero. Rows that already belong to this exam are
  // updated in place; only genuinely new questions are inserted and only removed ones are
  // deleted.
  'teacher.saveExam': async (payload, session) => {
    const me = requireTeacher(session);
    const exam = payload?.exam;
    if (!exam || typeof exam !== 'object') throw bad('exam is required.');

    const examPayload = {
      title: String(exam.title || ''),
      description: exam.description ?? null,
      duration_minutes: Number(exam.durationMinutes) || 60,
      is_active: !!exam.isActive,
      shuffle_questions: !!exam.shuffleQuestions,
      shuffle_options: !!exam.shuffleOptions,
      assigned_sections: asStringList(exam.assignedSections),
      assigned_majors: asStringList(exam.assignedMajors),
      created_by: me.sub,
    };

    // The editor gives a brand new exam a temporary id like "e1726380000000".
    const isNew = !UUID.test(String(exam.id || ''));
    let examId: string;
    if (isNew) {
      const { data, error } = await pgInsert<any[]>('exams', [examPayload]);
      if (error || !data?.[0]) throw new HttpError(500, error?.message || 'Could not create the exam.');
      examId = data[0].id;
    } else {
      examId = asUuid(exam.id, 'exam.id');
      await assertOwnsExam(me, examId);
      const { error } = await pgUpdate('exams', `id=eq.${examId}`, examPayload);
      if (error) throw new HttpError(500, error.message);
    }

    const incoming: any[] = Array.isArray(exam.questions) ? exam.questions : [];
    const { data: existingRows } = await pgSelect<any[]>('questions', `exam_id=eq.${examId}&select=id`);
    const existingIds = new Set((existingRows || []).map((q: any) => q.id));

    const toRow = (q: any) => ({
      exam_id: examId,
      type: q.type,
      text: String(q.text || ''),
      image_url: q.imageUrl ?? null,
      score: Number(q.score) || 0,
      options: q.options ?? null,
      correct_option_index: q.correctOptionIndex ?? null,
      // Hidden cases live in their own RLS-protected table, never in this column.
      test_cases: (q.testCases || []).filter((tc: any) => !tc.hidden),
      language: q.language ?? null,
      allow_file_upload: q.type === 'JAVA' ? q.allowFileUpload !== false : null,
      input_mode: q.type === 'JAVA' ? (q.inputMode === 'function' ? 'function' : 'stdin') : null,
      accepted_answers: q.acceptedAnswers ?? null,
    });

    // A duplicated exam arrives carrying the source exam's question ids, so "keep the id"
    // has to mean "keep an id this exam already owns" — anything else is a new row.
    const keepers = incoming.filter((q) => UUID.test(String(q.id || '')) && existingIds.has(q.id));
    const newcomers = incoming.filter((q) => !(UUID.test(String(q.id || '')) && existingIds.has(q.id)));
    const keptIds = new Set(keepers.map((q) => q.id));

    const removed = [...existingIds].filter((id) => !keptIds.has(id));
    if (removed.length > 0) {
      const { error } = await pgDelete('questions', `id=in.(${removed.join(',')})`);
      if (error) throw new HttpError(500, error.message);
    }

    // In parallel: an exam can hold a few dozen questions, and one round trip each would
    // put a save close to the function's time limit.
    const updates = await Promise.all(keepers.map((q) => pgUpdate('questions', `id=eq.${q.id}`, toRow(q))));
    const updateError = updates.find((r) => r.error)?.error;
    if (updateError) throw new HttpError(500, updateError.message);

    let insertedIds: string[] = [];
    if (newcomers.length > 0) {
      const { data, error } = await pgInsert<any[]>('questions', newcomers.map(toRow));
      if (error) throw new HttpError(500, error.message);
      insertedIds = (data || []).map((q: any) => q.id);
    }

    // Hidden test cases, replace-all per question, now that every question has a real id.
    const saved = [...keepers.map((q) => ({ q, id: q.id })), ...newcomers.map((q, i) => ({ q, id: insertedIds[i] }))]
      .filter(({ id }) => !!id);

    // Which questions currently have hidden cases, in one query, so questions that have
    // none and are keeping none can be skipped entirely.
    const { data: existingHidden } = saved.length
      ? await pgSelect<any[]>(
          'question_hidden_test_cases',
          `question_id=in.(${saved.map(({ id }) => id).join(',')})&select=question_id`
        )
      : { data: [] as any[] };
    const hasHidden = new Set((existingHidden || []).map((row: any) => row.question_id));

    await Promise.all(
      saved.map(async ({ q, id }) => {
        const hiddenCases = (q.testCases || []).filter((tc: any) => tc.hidden);
        if (hiddenCases.length === 0 && !hasHidden.has(id)) return;
        await pgDelete('question_hidden_test_cases', `question_id=eq.${id}`);
        if (hiddenCases.length > 0) {
          await pgInsert('question_hidden_test_cases', hiddenCases.map((tc: any) => ({ question_id: id, input: tc.input, output: tc.output })));
        }
        await pgUpdate('questions', `id=eq.${id}`, { hidden_test_case_count: hiddenCases.length });
      })
    );

    // Editing an exam changes what the answers are worth, so the stored scores are brought
    // back in line straight away rather than waiting for someone to press Re-grade.
    await rescoreExam(examId).catch(() => {});
    return { examId };
  },

  'teacher.deleteExam': async (payload, session) => {
    const me = requireTeacher(session);
    const examId = asUuid(payload?.examId, 'examId');
    await assertOwnsExam(me, examId);
    const { error } = await pgDelete('exams', `id=eq.${examId}`);
    if (error) throw new HttpError(500, error.message);
    return { deleted: true };
  },

  'teacher.setExamStatus': async (payload, session) => {
    const me = requireTeacher(session);
    const examId = asUuid(payload?.examId, 'examId');
    await assertOwnsExam(me, examId);
    const { error } = await pgUpdate('exams', `id=eq.${examId}`, { is_active: !!payload?.isActive });
    if (error) throw new HttpError(500, error.message);
    return { isActive: !!payload?.isActive };
  },

  'teacher.uploadImage': async (payload, session) => {
    requireTeacher(session);
    const base64 = String(payload?.dataBase64 || '');
    const contentType = String(payload?.contentType || '');
    if (!base64) throw bad('dataBase64 is required.');
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(contentType)) throw bad('Only PNG, JPEG, GIF and WebP images are accepted.');
    const body = Buffer.from(base64, 'base64');
    if (body.length > 3 * 1024 * 1024) throw bad('Image is larger than 3 MB.');

    const extension = contentType.split('/')[1].replace('jpeg', 'jpg');
    const path = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}.${extension}`;
    const { data, error } = await storageUpload('exam-images', path, body, contentType);
    if (error || !data) throw new HttpError(500, error?.message || 'Upload failed.');
    return { url: data.publicUrl };
  },

  // ---- TEACHER: ROSTER ---------------------------------------------------------------
  'teacher.students': async (_payload, session) => {
    const me = requireTeacher(session);
    // select is explicit so the password column cannot ride along by accident.
    const { data } = await pgSelect<any[]>(
      'users',
      `role=eq.STUDENT&created_by=eq.${me.sub}&select=id,name,role,student_id,section,major,created_by&order=student_id.asc`
    );
    return data || [];
  },

  'teacher.importStudents': async (payload, session) => {
    const me = requireTeacher(session);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (rows.length === 0) return { imported: 0 };
    const { error } = await pgUpsert(
      'users',
      rows.map((s: any) => ({
        student_id: String(s.id || '').trim(),
        name: String(s.name || '').trim(),
        section: s.section ?? null,
        major: s.major || null,
        role: 'STUDENT',
        created_by: me.sub,
      })),
      'student_id'
    );
    if (error) throw new HttpError(500, error.message);
    return { imported: rows.length };
  },

  'teacher.updateStudent': async (payload, session) => {
    const me = requireTeacher(session);
    const id = asUuid(payload?.id, 'id');
    const updates = payload?.updates || {};
    const patch: any = {};
    if (updates.name !== undefined) patch.name = String(updates.name);
    if (updates.section !== undefined) patch.section = String(updates.section);
    if (updates.major !== undefined) patch.major = updates.major || null;
    if (Object.keys(patch).length === 0) return { updated: 0 };
    // created_by in the filter keeps one teacher's edit inside their own roster.
    const { error } = await pgUpdate('users', `id=eq.${id}&role=eq.STUDENT&created_by=eq.${me.sub}`, patch);
    if (error) throw new HttpError(500, error.message);
    return { updated: 1 };
  },

  'teacher.assignMajor': async (payload, session) => {
    const me = requireTeacher(session);
    const ids = asStringList(payload?.ids).map((id) => asUuid(id, 'id'));
    if (ids.length === 0) return { updated: 0 };
    const { error } = await pgUpdate(
      'users',
      `id=in.(${ids.join(',')})&role=eq.STUDENT&created_by=eq.${me.sub}`,
      { major: payload?.major || null }
    );
    if (error) throw new HttpError(500, error.message);
    return { updated: ids.length };
  },

  'teacher.deleteStudents': async (payload, session) => {
    const me = requireTeacher(session);
    const ids = asStringList(payload?.ids).map((id) => asUuid(id, 'id'));
    if (ids.length === 0) return { deleted: 0 };
    const { error } = await pgDelete('users', `id=in.(${ids.join(',')})&role=eq.STUDENT&created_by=eq.${me.sub}`);
    if (error) throw new HttpError(500, error.message);
    return { deleted: ids.length };
  },

  // ---- TEACHER: MONITORING & RESULTS -------------------------------------------------
  'teacher.liveProgress': async (payload, session) => {
    const me = requireTeacher(session);
    const examId = asUuid(payload?.examId, 'examId');
    await assertOwnsExam(me, examId);

    const { data: rows } = await pgSelect<any[]>('student_progress', `exam_id=eq.${examId}&select=*`);
    const progress = rows || [];
    if (progress.length === 0) return [];

    const ids = [...new Set(progress.map((p: any) => p.student_id))];
    const { data: users } = await pgSelect<any[]>(
      'users',
      `student_id=in.(${ids.map((s) => `"${s}"`).join(',')})&select=student_id,name,section`
    );
    const names = new Map((users || []).map((u: any) => [u.student_id, u]));
    return progress.map((p: any) => ({
      ...p,
      student_name: names.get(p.student_id)?.name || 'Unknown',
      student_section: names.get(p.student_id)?.section || 'N/A',
    }));
  },

  // Results are computed here from the stored answers, using the same rules as a live
  // submission, so the export can never disagree with what was saved.
  'teacher.examResults': async (payload, session) => {
    const me = requireTeacher(session);
    const examId = asUuid(payload?.examId, 'examId');
    await assertOwnsExam(me, examId);

    const questions = await gradingQuestions(examId);
    const { data: rows } = await pgSelect<any[]>('student_progress', `exam_id=eq.${examId}&select=*`);
    const progress = rows || [];
    if (progress.length === 0) return [];

    const ids = [...new Set(progress.map((p: any) => p.student_id))];
    const { data: users } = await pgSelect<any[]>(
      'users',
      `student_id=in.(${ids.map((s) => `"${s}"`).join(',')})&select=student_id,name,section`
    );
    const byId = new Map((users || []).map((u: any) => [u.student_id, u]));
    const verdicts = await loadVerdicts(ids, questions.filter((q) => q.type === 'JAVA').map((q) => q.id));
    const total = questions.reduce((sum, q) => sum + (q.score || 0), 0);

    return progress.map((p: any) => ({
      student_id: p.student_id,
      name: byId.get(p.student_id)?.name || 'Unknown',
      section: byId.get(p.student_id)?.section || 'N/A',
      total_score: scoreFor(questions, safeParseJSON(p.answers), p.student_id, verdicts, p.started_at),
      max_score: total,
      status: p.status,
      updated_at: p.updated_at,
    }));
  },

  'teacher.recalculate': async (payload, session) => {
    const me = requireTeacher(session);
    const examId = asUuid(payload?.examId, 'examId');
    await assertOwnsExam(me, examId);
    const updated = await rescoreExam(examId);
    return { updated };
  },

  'teacher.reopenProgress': async (payload, session) => {
    const me = requireTeacher(session);
    const examId = asUuid(payload?.examId, 'examId');
    await assertOwnsExam(me, examId);
    const studentId = String(payload?.studentId || '').trim();
    if (!studentId) throw bad('studentId is required.');
    const { error } = await pgUpdate(
      'student_progress',
      `exam_id=eq.${examId}&student_id=eq.${encodeURIComponent(studentId)}`,
      { status: 'IN_PROGRESS', updated_at: new Date().toISOString() }
    );
    if (error) throw new HttpError(500, error.message);
    return { reopened: true };
  },
};

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!isSupabaseAdminConfigured() || !isSessionConfigured()) {
      res.status(500).json({ error: 'Server is not configured (SUPABASE_URL / service role key / SESSION_SECRET).' });
      return;
    }

    const action = String(req.body?.action || '');
    const handle = actions[action];
    if (!handle) {
      res.status(400).json({ error: `Unknown action: ${action}` });
      return;
    }

    const data = await handle(req.body || {}, sessionFromRequest(req));
    res.status(200).json({ data });
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    try {
      res.status(status).json({ error: e?.message || String(e) });
    } catch {
      // response already sent
    }
  }
}
