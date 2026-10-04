import { CodeLanguage, Exam, Question, QuestionType, StudentProgress, TestCase, User, UserRole } from '../types';
import { loadToken, saveToken, clearToken } from './session';
import {
  calculateScore as scoreAnswers,
  normalizeAnswerText as normalizeAnswer,
  ScorableQuestion,
} from '../api/_scoring';
import { isAssignedToStudent as isAssigned } from '../api/_assignment';

// ==========================================
// DATA ACCESS
// ==========================================
// This file used to hold a Supabase URL and anon key and talk to PostgREST directly. That
// key ships inside the JS bundle, so everything the browser could do, anyone who opened the
// site could do: read every MCQ answer key, read the teachers' passwords (stored in plain
// text), rewrite or delete questions, and set their own score. Row Level Security is now
// closed on every table and the service_role key lives only in the Vercel functions under
// api/, so the browser has no database credentials at all — it calls api/db.ts, which
// checks a signed session token and re-derives anything that matters (which student is
// saving, which teacher owns an exam, what a set of answers is worth) on the server.
//
// What changed for this file: `supabase.from(...)` became `call(action, payload)`. The
// snake_case rows the server returns are the same shape PostgREST was returning before, so
// the mappers below are unchanged.

// Offline demo mode, kept for running the UI with no backend at all. It is opt-in now —
// there is no key left whose absence could imply it.
const USE_MOCK = (import.meta as any).env?.VITE_USE_MOCK === 'true';

class ApiError extends Error {}

const call = async <T = any>(action: string, payload: Record<string, any> = {}): Promise<T> => {
  const token = loadToken();
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // fall through to the status-based message below
  }

  if (!res.ok) {
    // An expired or rejected token means the session is over; dropping it here sends the
    // user back to the login screen instead of letting every later call fail silently.
    if (res.status === 401) clearToken();
    throw new ApiError(body?.error || `Request failed (${res.status})`);
  }
  return body?.data as T;
};

// ==========================================
// MOCK DATA STORAGE (Local Storage Wrapper)
// ==========================================

const STORAGE_KEYS = {
  USERS: 'uniexam_mock_users',
  PASSWORDS: 'uniexam_mock_passwords', // Added to persist passwords
  EXAMS: 'uniexam_mock_exams',
  PROGRESS: 'uniexam_mock_progress'
};

const loadMockData = <T>(key: string, defaultData: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultData;
  } catch {
    return defaultData;
  }
};

const saveMockData = (key: string, data: any) => {
  localStorage.setItem(key, JSON.stringify(data));
};

// --- DEFAULT DATA SEEDS ---
const defaultUsers: User[] = [
  { id: 't1', name: 'Dr. Smith', role: UserRole.TEACHER },
  { id: 's1', name: 'Alice Student', role: UserRole.STUDENT, studentId: '64001', section: 'SEC01', createdBy: 't1' },
  { id: 's2', name: 'Bob Student', role: UserRole.STUDENT, studentId: '64002', section: 'SEC02', createdBy: 't1' }
];

// Seed passwords. NOTE: In a real app, never store plain text passwords in LS.
const defaultPasswords: Record<string, string> = {
    'Dr. Smith': 'admin123'
};

const defaultExams: Exam[] = [
  {
    id: 'e1',
    title: 'CS101 Midterm: Java Basics',
    description: 'Fundamental concepts of Java Programming.',
    durationMinutes: 60,
    isActive: true,
    createdBy: 't1', // Assigned to Dr. Smith
    assignedSections: ['SEC01', 'SEC02'],
    questions: [
      {
        id: 'q1',
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Which data type is used to create a variable that should store text?',
        score: 5,
        options: ['String', 'char', 'float', 'boolean'],
        correctOptionIndex: 0
      },
      {
        id: 'q2',
        type: QuestionType.JAVA_CODE,
        text: 'Write a Java method named `sum` that takes two integers and returns their sum.',
        score: 20,
        language: 'java',
        testCases: [
          { input: '1 2', output: '3' },
          { input: '10 -5', output: '5' }
        ]
      },
      {
         id: 'q3',
         type: QuestionType.SHORT_ANSWER,
         text: 'What is the capital of Thailand?',
         imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Wat_Arun_July_2020.jpg/640px-Wat_Arun_July_2020.jpg',
         score: 5,
         acceptedAnswers: ['Bangkok', 'Krung Thep']
      }
    ]
  }
];

// --- GETTERS (Always fetch fresh from Storage) ---
const getMockUsers = () => loadMockData<User[]>(STORAGE_KEYS.USERS, defaultUsers);
const getMockPasswords = () => loadMockData<Record<string, string>>(STORAGE_KEYS.PASSWORDS, defaultPasswords);
const getMockExams = () => loadMockData<Exam[]>(STORAGE_KEYS.EXAMS, defaultExams);
const getMockProgress = () => loadMockData<StudentProgress[]>(STORAGE_KEYS.PROGRESS, []);

// ==========================================
// HELPERS (Map DB Snake_Case to App CamelCase)
// ==========================================
const mapUser = (u: any): User => ({
  id: u.id,
  name: u.name,
  role: u.role as UserRole,
  studentId: u.student_id,
  section: u.section,
  major: u.major || undefined,
  createdBy: u.created_by
});

const mapExam = (e: any): Exam => ({
  id: e.id,
  title: e.title,
  description: e.description,
  durationMinutes: e.duration_minutes,
  isActive: e.is_active,
  shuffleQuestions: !!e.shuffle_questions,
  shuffleOptions: !!e.shuffle_options,
  assignedSections: e.assigned_sections || [],
  assignedMajors: e.assigned_majors || [],
  createdBy: e.created_by, // Map DB column
  questions: (e.questions || []).map(mapQuestion).sort((a: Question, b: Question) => a.text.localeCompare(b.text))
});

// correctOptionIndex and acceptedAnswers are absent from anything the server sends a
// student — the answer key does not leave api/ any more — so they land as undefined here,
// which is exactly what the exam page should see.
const mapQuestion = (q: any): Question => ({
  id: q.id,
  type: q.type as QuestionType,
  text: q.text,
  imageUrl: q.image_url,
  score: q.score,
  options: q.options,
  correctOptionIndex: q.correct_option_index,
  testCases: q.test_cases,
  hiddenTestCaseCount: q.hidden_test_case_count || 0,
  language: q.language || 'java',
  allowFileUpload: q.allow_file_upload !== false,
  inputMode: q.input_mode === 'function' ? 'function' : 'stdin',
  acceptedAnswers: q.accepted_answers
});

// Helper to safely parse JSONB that might come as string
const safeParseJSON = (input: any) => {
  if (typeof input === 'object' && input !== null) return input;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (e) {
      return {};
    }
  }
  return {};
};

// HELPER: Normalize Answer Text for Flexible Grading
export const normalizeAnswerText = normalizeAnswer;

const mapProgress = (p: any, userName: string = ''): StudentProgress => ({
  studentId: p.student_id,
  studentName: userName,
  examId: p.exam_id,
  currentQuestionIndex: p.current_question_index,
  answers: safeParseJSON(p.answers), // Use Safe Parse
  score: p.score,
  status: p.status,
  startedAt: p.started_at ? new Date(p.started_at).getTime() : undefined,
  autoSubmitted: !!p.auto_submitted,
  tabSwitchCount: p.tab_switch_count || 0,
  captureAttemptCount: p.capture_attempt_count || 0,
  lastUpdated: new Date(p.updated_at).getTime()
});

// ==========================================
// GRADING LOGIC
// ==========================================
// The rules themselves live in api/_scoring.ts, shared with the server so the dashboard and
// the stored score can never disagree. This is the view-side entry point: it reads the
// judge verdict saved next to the answer, which is what the teacher's browser has. The
// score that is actually stored is computed in api/db.ts from the recorded verdicts
// instead, where a student cannot reach it.
const toScorable = (q: Question): ScorableQuestion => ({
  id: q.id,
  type: q.type,
  score: q.score,
  correctOptionIndex: q.correctOptionIndex,
  acceptedAnswers: q.acceptedAnswers,
});

export const calculateScore = (exam: Exam, answers: Record<string, any>): number =>
  scoreAnswers(exam.questions.map(toScorable), answers);

// ==========================================
// RECALCULATION SERVICE
// ==========================================
export interface ExamActivity {
  isActive: boolean;
  title: string;
  inProgress: number; // attempts written to in the last quarter hour — people actually sitting
  staleInProgress: number; // still marked IN_PROGRESS but long abandoned
  completed: number;
}

// Whether anyone is sitting this exam right now. Asked before offering to edit or re-grade
// it: `isActive` on its own says little, since an exam can be open with nobody in it.
export const getExamActivity = async (examId: string): Promise<ExamActivity> => {
  if (!USE_MOCK) return await call<ExamActivity>('teacher.examActivity', { examId });
  const exam = getMockExams().find(e => e.id === examId);
  const rows = getMockProgress().filter(p => p.examId === examId);
  return {
    isActive: !!exam?.isActive,
    title: exam?.title || '',
    inProgress: rows.filter(p => p.status === 'IN_PROGRESS').length,
    staleInProgress: 0,
    completed: rows.filter(p => p.status === 'COMPLETED').length,
  };
};

// acknowledgeActive carries the teacher's "yes, I mean it" past the server's refusal to
// touch an exam people are still answering.
export const recalculateExamScores = async (examId: string, acknowledgeActive = false): Promise<void> => {
  if (!USE_MOCK) {
    await call('teacher.recalculate', { examId, acknowledgeActive });
    return;
  }

  const exam = getMockExams().find(e => e.id === examId);
  const progressList = getMockProgress().filter(p => p.examId === examId);
  if (!exam || progressList.length === 0) return;

  const mockProgress = getMockProgress();
  progressList.forEach(p => {
    const idx = mockProgress.findIndex(mp => mp.studentId === p.studentId && mp.examId === examId);
    if (idx >= 0) {
      mockProgress[idx].score = calculateScore(exam, safeParseJSON(p.answers));
      mockProgress[idx].lastUpdated = Date.now();
    }
  });
  saveMockData(STORAGE_KEYS.PROGRESS, mockProgress);
};

// ==========================================
// AUTH & USER MANAGEMENT
// ==========================================
// Credentials are checked in api/login.ts now. What comes back is the user record plus a
// signed token; the token is what every later call presents, and it is the only thing that
// decides whether a request is treated as a student, a teacher, or neither.
const login = async (body: Record<string, any>): Promise<{ user: User; token: string }> => {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Login failed (${res.status})`);
  return data;
};

export const loginTeacher = async (name: string, password: string): Promise<User | null> => {
  if (!USE_MOCK) {
    try {
      const { user, token } = await login({ mode: 'teacher', name, password });
      saveToken(token);
      return user;
    } catch {
      return null;
    }
  }

  const mockUsers = getMockUsers();
  const mockPasswords = getMockPasswords();

  const user = mockUsers.find(u =>
    u.role === UserRole.TEACHER &&
    u.name.toLowerCase().trim() === name.toLowerCase().trim()
  );

  if (user) {
      const storedPassword = mockPasswords[user.name];
      if (storedPassword === password) return user;
  }

  return null;
};

// Creating a teacher account needs the invite code set as TEACHER_SIGNUP_CODE on the
// server; without it the server refuses, because an open sign-up form is a door straight
// into every exam and every answer key.
export const registerTeacher = async (name: string, password: string, code?: string): Promise<User> => {
  if (!USE_MOCK) {
    const { user, token } = await login({ mode: 'register', name, password, code });
    saveToken(token);
    return user;
  }

  const mockUsers = getMockUsers();

  const existing = mockUsers.find(u =>
      u.role === UserRole.TEACHER &&
      u.name.toLowerCase().trim() === name.toLowerCase().trim()
  );

  if (existing) throw new Error("Username already taken");

  const newUser: User = { id: `t_${Date.now()}`, name: name.trim(), role: UserRole.TEACHER };

  const updatedUsers = [...mockUsers, newUser];
  saveMockData(STORAGE_KEYS.USERS, updatedUsers);

  const mockPasswords = getMockPasswords();
  mockPasswords[newUser.name] = password;
  saveMockData(STORAGE_KEYS.PASSWORDS, mockPasswords);

  return newUser;
};

export const loginStudent = async (studentId: string): Promise<User | null> => {
  const cleanId = studentId.trim();
  if (!USE_MOCK) {
    try {
      const { user, token } = await login({ mode: 'student', studentId: cleanId });
      saveToken(token);
      return user;
    } catch {
      return null;
    }
  }
  const mockUsers = getMockUsers();
  return mockUsers.find(u => u.studentId === cleanId && u.role === UserRole.STUDENT) || null;
};

// Students belonging to the signed-in teacher. The teacherId argument is kept for the
// call sites; the server uses the token's identity rather than this value.
export const getStudents = async (teacherId?: string): Promise<User[]> => {
  if (!USE_MOCK) {
    const rows = await call<any[]>('teacher.students');
    return (rows || []).map(mapUser);
  }

  // Mock
  const allStudents = getMockUsers().filter(u => u.role === UserRole.STUDENT);
  if (teacherId) {
      return allStudents.filter(s => s.createdBy === teacherId || (!s.createdBy && teacherId === 't1'));
  }
  return allStudents;
};

export interface StudentImportRow { id: string; name: string; section: string; major?: string }

export const importStudents = async (teacherId: string, studentData: StudentImportRow[]) => {
  if (!USE_MOCK) {
    await call('teacher.importStudents', { rows: studentData });
    return;
  }

  const mockUsers = getMockUsers();
  const newUsers = studentData.map(s => ({
    id: `s_${s.id}`,
    name: s.name,
    studentId: s.id,
    section: s.section,
    major: s.major,
    role: UserRole.STUDENT,
    createdBy: teacherId
  }));

  // Basic mock upsert logic (overwrite if exists)
  const existingMap = new Map(mockUsers.map(u => [u.studentId || u.id, u]));
  newUsers.forEach(nu => {
      existingMap.set(nu.studentId, nu);
  });

  saveMockData(STORAGE_KEYS.USERS, Array.from(existingMap.values()));
};

// Roster row edit. student_id is the login key AND the foreign key student_progress points
// at, so changing it would orphan a student's attempts — it stays read-only here.
export const updateStudent = async (
  id: string,
  updates: { name?: string; section?: string; major?: string }
): Promise<void> => {
  if (Object.keys(updates).length === 0) return;

  if (!USE_MOCK) {
    await call('teacher.updateStudent', { id, updates });
    return;
  }
  const mockUsers = getMockUsers();
  saveMockData(STORAGE_KEYS.USERS, mockUsers.map(u => u.id === id ? { ...u, ...updates } : u));
};

// Assigns one major to many students at once (the roster's bulk "assign สาขา" action).
export const assignMajorToStudents = async (ids: string[], major: string): Promise<void> => {
  if (ids.length === 0) return;
  if (!USE_MOCK) {
    await call('teacher.assignMajor', { ids, major });
    return;
  }
  const idSet = new Set(ids);
  const mockUsers = getMockUsers();
  saveMockData(STORAGE_KEYS.USERS, mockUsers.map(u => idSet.has(u.id) ? { ...u, major } : u));
};

// Deleting a student cascades to their student_progress rows (FK is ON DELETE CASCADE),
// so their exam attempts and scores go with them.
export const deleteStudents = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  if (!USE_MOCK) {
    await call('teacher.deleteStudents', { ids });
    return;
  }
  const idSet = new Set(ids);
  saveMockData(STORAGE_KEYS.USERS, getMockUsers().filter(u => !idSet.has(u.id)));
};

// ==========================================
// EXAM MANAGEMENT
// ==========================================

// The file is sent to api/db.ts rather than straight to Supabase Storage: uploading with
// the anon key meant anyone with the bundle could write into the bucket.
export const uploadExamImage = async (file: File): Promise<string> => {
  if (!USE_MOCK) {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(file);
    });
    const { url } = await call<{ url: string }>('teacher.uploadImage', {
      dataBase64,
      contentType: file.type,
    });
    return url;
  }
  return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
  });
};

export const isAssignedToStudent = (exam: Exam, student: User) =>
  isAssigned({ assignedSections: exam.assignedSections, assignedMajors: exam.assignedMajors }, student);

// Which exams a student may sit is decided on the server from their own roster row; the
// `student` argument is only used by the offline mock.
export const getExamsForStudent = async (student: User): Promise<Exam[]> => {
  if (!USE_MOCK) {
    const rows = await call<any[]>('student.exams');
    return (rows || []).map(mapExam);
  }
  const mockExams = getMockExams();
  return mockExams.filter(e => e.isActive && isAssignedToStudent(e, student));
};

export const getExamsForTeacher = async (teacherId?: string): Promise<Exam[]> => {
  if (!USE_MOCK) {
    // Hidden test cases are merged in by the server for the teacher's own exams — the
    // editor needs their content, and nothing else in the app is ever allowed to see it.
    const rows = await call<any[]>('teacher.exams');
    return (rows || []).map(mapExam);
  }

  // Mock Data Filtering
  const mockExams = getMockExams();
  if (teacherId) {
     return mockExams.filter(e => e.createdBy === teacherId || (!e.createdBy && teacherId === 't1'));
  }
  return mockExams;
};

export const saveExam = async (exam: Exam, acknowledgeActive = false): Promise<Exam> => {
  if (!USE_MOCK) {
    const { examId } = await call<{ examId: string }>('teacher.saveExam', { exam, acknowledgeActive });
    return { ...exam, id: examId };
  }

  // Mock Save
  const mockExams = getMockExams();
  const index = mockExams.findIndex(e => e.id === exam.id);
  let updatedExams;
  if (index >= 0) {
    updatedExams = [...mockExams];
    updatedExams[index] = exam;
  } else {
    updatedExams = [...mockExams, exam];
  }
  saveMockData(STORAGE_KEYS.EXAMS, updatedExams);
  return exam;
};

export const deleteExam = async (examId: string): Promise<void> => {
  if (!USE_MOCK) {
    await call('teacher.deleteExam', { examId });
    return;
  }
  const mockExams = getMockExams();
  const updatedExams = mockExams.filter(e => e.id !== examId);
  saveMockData(STORAGE_KEYS.EXAMS, updatedExams);
};

// Closing an exam also finishes off the attempts still open, and reports how many — a
// student who closed the tab without submitting would otherwise sit at "in progress"
// indefinitely. `sealed` is that count.
export const updateExamStatus = async (examId: string, isActive: boolean): Promise<{ sealed: number }> => {
  if (!USE_MOCK) {
    const result = await call<{ sealed: number }>('teacher.setExamStatus', { examId, isActive });
    return { sealed: result?.sealed || 0 };
  }
  const mockExams = getMockExams();
  const index = mockExams.findIndex(e => e.id === examId);
  if (index >= 0) {
      const updatedExams = [...mockExams];
      updatedExams[index] = { ...updatedExams[index], isActive };
      saveMockData(STORAGE_KEYS.EXAMS, updatedExams);
  }
  return { sealed: 0 };
};

// ==========================================
// PROGRESS & RESULTS
// ==========================================

// A student can only ever read their own attempt: the server answers from the token's
// student id and ignores the one passed here.
export const getStudentProgress = async (studentId: string, examId: string): Promise<StudentProgress | null> => {
  if (!USE_MOCK) {
    const row = await call<any>('student.progress', { examId });
    return row ? mapProgress(row, row.student_name || studentId) : null;
  }
  const mockProgressStore = getMockProgress();
  return mockProgressStore.find(p => p.studentId === studentId && p.examId === examId) || null;
}

// The score field on `progress` is what the exam page showed locally; the server recomputes
// it from the answers and the recorded judge verdicts, and that is what gets stored.
export const submitStudentProgress = async (progress: StudentProgress): Promise<{success: boolean, error?: string}> => {
  if (!USE_MOCK) {
    try {
      const { score } = await call<{ score: number }>('student.saveProgress', {
        examId: progress.examId,
        currentQuestionIndex: progress.currentQuestionIndex,
        answers: progress.answers || {},
        status: progress.status,
        startedAt: progress.startedAt,
        autoSubmitted: !!progress.autoSubmitted,
        tabSwitchCount: progress.tabSwitchCount || 0,
        captureAttemptCount: progress.captureAttemptCount || 0,
      });
      progress.score = score;
      return { success: true };
    } catch (e: any) {
      console.error('SAVE PROGRESS ERROR:', e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  const mockProgressStore = getMockProgress();
  const existingIndex = mockProgressStore.findIndex(p => p.studentId === progress.studentId && p.examId === progress.examId);
  let updatedStore;

  if (existingIndex >= 0) {
    updatedStore = [...mockProgressStore];
    updatedStore[existingIndex] = { ...progress, lastUpdated: Date.now() };
  } else {
    updatedStore = [...mockProgressStore, { ...progress, lastUpdated: Date.now() }];
  }
  saveMockData(STORAGE_KEYS.PROGRESS, updatedStore);
  return { success: true };
};

// Teacher action: reopen a student's completed exam so they can resume editing.
// Keeps their existing answers/score/startedAt — the exam UI computes remaining time
// from startedAt, so this only has an effect while time is still left in the window.
export const reopenStudentProgress = async (studentId: string, examId: string): Promise<void> => {
  if (!USE_MOCK) {
    await call('teacher.reopenProgress', { studentId, examId });
    return;
  }
  const mockProgressStore = getMockProgress();
  const idx = mockProgressStore.findIndex(p => p.studentId === studentId && p.examId === examId);
  if (idx >= 0) {
    mockProgressStore[idx] = { ...mockProgressStore[idx], status: 'IN_PROGRESS', lastUpdated: Date.now() };
    saveMockData(STORAGE_KEYS.PROGRESS, mockProgressStore);
  }
};

// What an attempt's state should be called on screen.
//
// The stored status is one of three values and doesn't distinguish the cases a teacher
// actually asks about: someone who ran out of time without submitting looks identical to
// someone who pressed Submit. `auto_submitted` is what tells them apart — it is set when
// the timer ran out on a student mid-exam, and now also when a teacher closes an exam on
// an attempt still open. An attempt with no answers at all never really began.
//
// Derived rather than stored, deliberately: a fourth status column would be a second
// source of truth about the same attempt, free to disagree with the first.
export type AttemptLabel = 'NOT STARTED' | 'IN PROGRESS' | 'TIMES UP' | 'SUBMITTED';

export const describeAttempt = (
  progress: StudentProgress | undefined,
  examIsActive: boolean
): { label: AttemptLabel; detail: string } => {
  if (!progress || progress.status === 'IDLE') {
    return { label: 'NOT STARTED', detail: 'ยังไม่ได้เริ่มทำข้อสอบ' };
  }
  if (progress.status === 'IN_PROGRESS') {
    return examIsActive
      ? { label: 'IN PROGRESS', detail: 'กำลังทำข้อสอบอยู่' }
      // Closing an exam seals these, so this is a row from before that was added.
      : { label: 'TIMES UP', detail: 'ค้างอยู่ตอนที่ข้อสอบถูกปิด — ไม่ได้กดส่ง' };
  }
  if (progress.autoSubmitted) {
    return { label: 'TIMES UP', detail: 'หมดเวลาหรือข้อสอบถูกปิดก่อนที่จะกดส่ง — ระบบเก็บคำตอบที่บันทึกไว้ล่าสุด' };
  }
  return { label: 'SUBMITTED', detail: 'กดส่งคำตอบเองเรียบร้อย' };
};

// Per question, over the students who have answered anything at all. The three buckets add
// up to activeCount, so a bar drawn from them is always exactly full.
export interface QuestionStat {
  questionId: string;
  correct: number;
  incorrect: number;
  notAnswered: number;
}

export interface LiveProgress {
  rows: StudentProgress[];
  questionStats: QuestionStat[];
  activeCount: number;
}

// The monitor, polled every two seconds by each invigilator's screen. It no longer carries
// anyone's answers: the per-question tallies are counted on the server and the answers
// themselves are fetched one student at a time by getStudentAnswers, when Inspect opens.
// With forty students and three screens, shipping the whole class's work twice a second
// was most of the traffic an exam generated.
export const getLiveProgress = async (examId: string): Promise<LiveProgress> => {
  if (!USE_MOCK) {
    const data = await call<{ rows: any[]; questionStats: QuestionStat[]; activeCount: number }>(
      'teacher.liveProgress',
      { examId }
    );
    return {
      rows: (data?.rows || []).map((p: any) => ({
        ...mapProgress(p, p.student_name || 'Unknown'),
        answeredCount: p.answered_count || 0,
      })),
      questionStats: data?.questionStats || [],
      activeCount: data?.activeCount || 0,
    };
  }

  // Fallback to Mock
  const exam = getMockExams().find(e => e.id === examId);
  const rows = getMockProgress().filter(p => p.examId === examId);
  const active = rows.filter(p => Object.keys(p.answers || {}).length > 0);
  const questionStats = (exam?.questions || []).map(q => {
    let correct = 0;
    let incorrect = 0;
    let notAnswered = 0;
    active.forEach(p => {
      const ans = (p.answers || {})[q.id];
      if (ans === undefined || ans === null || ans === '') notAnswered++;
      else if (scoreAnswers([toScorable(q)], { [q.id]: ans }) > 0) correct++;
      else incorrect++;
    });
    return { questionId: q.id, correct, incorrect, notAnswered };
  });
  return {
    rows: rows.map(p => ({ ...p, answeredCount: Object.keys(p.answers || {}).length })),
    questionStats,
    activeCount: active.length,
  };
};

export interface StudentAnswers {
  answers: Record<string, any>;
  questionScores: { questionId: string; score: number; max: number; overridden: boolean }[];
  totalScore: number;
  maxScore: number;
}

// One student's answers and what each of them scored. Separate from the monitor so the
// expensive part is paid for only when a teacher opens Inspect, and computed on the server
// because the code questions' verdicts never leave it.
export const getStudentAnswers = async (examId: string, studentId: string): Promise<StudentAnswers | null> => {
  if (!USE_MOCK) {
    const row = await call<any>('teacher.studentAnswers', { examId, studentId });
    if (!row) return null;
    return {
      answers: row.answers || {},
      questionScores: row.question_scores || [],
      totalScore: row.score || 0,
      maxScore: row.max_score || 0,
    };
  }
  const exam = getMockExams().find(e => e.id === examId);
  const p = getMockProgress().find(x => x.examId === examId && x.studentId === studentId);
  if (!exam || !p) return null;
  return {
    answers: p.answers || {},
    questionScores: exam.questions.map(q => ({
      questionId: q.id,
      score: scoreAnswers([toScorable(q)], p.answers || {}),
      max: q.score,
      overridden: false,
    })),
    totalScore: calculateScore(exam, p.answers || {}),
    maxScore: exam.questions.reduce((sum, q) => sum + q.score, 0),
  };
};

// Teacher action: set one answer's marks by hand — the appeal. Passing null hands the
// question back to the normal rules. Returns the attempt's new total.
export const setQuestionScore = async (
  examId: string,
  studentId: string,
  questionId: string,
  score: number | null
): Promise<{ total: number; max: number; questionScore: number; overridden: boolean }> => {
  if (!USE_MOCK) {
    return await call('teacher.setQuestionScore', { examId, studentId, questionId, score });
  }
  throw new Error('Score appeals need the server (not available in mock mode).');
};

export interface ExamResult {
  studentId: string;
  name: string;
  section: string;
  totalScore: number;
  maxScore: number;
  status: string;
  submittedAt: string;
}

export const getExamResults = async (examId: string): Promise<ExamResult[]> => {
  if (!USE_MOCK) {
    const rows = await call<any[]>('teacher.examResults', { examId });
    return (rows || []).map((r: any) => ({
      studentId: r.student_id,
      name: r.name,
      section: r.section,
      totalScore: r.total_score,
      maxScore: r.max_score,
      status: r.status,
      submittedAt: r.updated_at ? new Date(r.updated_at).toLocaleString() : 'N/A',
    }));
  }

  const exam = getMockExams().find(e => e.id === examId);
  if (!exam) return [];
  const users = getMockUsers();
  const maxScore = exam.questions.reduce((sum, q) => sum + q.score, 0);

  return getMockProgress().filter(p => p.examId === examId).map(p => {
    const user = users.find(u => u.studentId === p.studentId);
    return {
      studentId: p.studentId,
      name: user?.name || 'Unknown',
      section: user?.section || 'N/A',
      totalScore: calculateScore(exam, safeParseJSON(p.answers)),
      maxScore,
      status: p.status,
      submittedAt: p.lastUpdated ? new Date(p.lastUpdated).toLocaleString() : 'N/A',
    };
  });
};

// ==========================================
// REMOTE GRADING (via Vercel serverless function -> Sphere Engine)
// ==========================================
// The judge call (and its API token) lives server-side in api/judge.ts, which looks up this
// question's test cases itself (visible AND hidden) — the client only ever sends the
// question id + code, never test case content. The session token goes with it because the
// judge records its verdict against the student, and that recorded verdict is what the
// mark for a code question is made of.
export const compileCode = async (questionId: string, code: string, language: CodeLanguage = 'java'): Promise<{passed: boolean, output: string}> => {
  if (!code.trim()) {
      return { passed: false, output: "Error: Code is empty." };
  }

  try {
    const token = loadToken();
    const response = await fetch('/api/judge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ questionId, code, language })
    });

    if (!response.ok) {
      return { passed: false, output: `System Error: Judge endpoint returned ${response.status} ${response.statusText}` };
    }

    return await response.json();
  } catch (error: any) {
    return { passed: false, output: `System Error: ${error.message || error}` };
  }
};
