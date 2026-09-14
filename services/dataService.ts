import { createClient } from '@supabase/supabase-js';
import { CodeLanguage, Exam, Question, QuestionType, StudentProgress, TestCase, User, UserRole } from '../types';

// ==========================================
// SUPABASE CONFIGURATION
// ==========================================
// Restore the keys found in the initial version
const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://wbkpuqtzkpvhjnckinep.supabase.co'; 
const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6India3B1cXR6a3B2aGpuY2tpbmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NDE2OTMsImV4cCI6MjA4NjExNzY5M30.2Vsb4vl5WTnLLn60033Rcx-X6TfdDXrI1Qsuj8i_dN0';

// Initialize Client only if keys are present
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

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
  createdBy: e.created_by, // Map DB column
  questions: (e.questions || []).map(mapQuestion).sort((a: Question, b: Question) => a.text.localeCompare(b.text))
});

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
export const normalizeAnswerText = (text: any) => {
  if (!text) return '';
  // Handle Object case (if coming from Java Answer Object)
  if (typeof text === 'object' && text.code) return String(text.code).toLowerCase().replace(/\s+/g, '');
  
  return String(text)
    .toLowerCase()
    .replace(/[\n\r]+/g, ',') // Convert newlines to commas (e.g. pop\npush -> pop,push)
    .replace(/\s+/g, '');     // Remove all whitespace
};

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
// GRADING LOGIC (Shared between Student Submission and Teacher Export)
// ==========================================
export const calculateScore = (exam: Exam, answers: Record<string, any>): number => {
  let totalScore = 0;
  
  exam.questions.forEach(q => {
    const ans = answers[q.id];
    
    if (ans !== undefined && ans !== null && ans !== '') {
      if (q.type === QuestionType.MULTIPLE_CHOICE) {
         // Improved Type Coercion: DB might give "0" (string), App gives 0 (number)
         if (String(ans) === String(q.correctOptionIndex)) {
           totalScore += q.score;
         }
      } else if (q.type === QuestionType.SHORT_ANSWER) {
         // FLEXIBLE GRADING for Short Answer
         const studentAns = normalizeAnswerText(ans);
         const isCorrect = q.acceptedAnswers?.some(a => normalizeAnswerText(a) === studentAns);
         if (isCorrect) totalScore += q.score;
      } else if (q.type === QuestionType.JAVA_CODE) {
         // IMPROVED GRADING: 
         if (typeof ans === 'object') {
             // 1. Strict Check: Passed all test cases
             if (ans.passed === true) {
                 totalScore += q.score;
             } 
             // 2. Fallback Check: Length check (e.g. wrote > 20 chars)
             // This ensures students get points if they wrote code but forgot to run it or failed compilation
             else if (ans.code && String(ans.code).length > 20) {
                 totalScore += q.score; 
             }
         } else if (typeof ans === 'string' && ans.length > 20) {
             // Legacy string fallback
             totalScore += q.score;
         }
      }
    }
  });
  
  return totalScore;
};

// ==========================================
// RECALCULATION SERVICE (NEW)
// ==========================================
export const recalculateExamScores = async (examId: string): Promise<void> => {
  console.log(`Starting recalculation for Exam: ${examId}`);
  let exam: Exam | undefined;
  let progressList: any[] = [];

  // 1. Fetch Exam Definition & Existing Progress
  if (supabase) {
      const { data: eData } = await supabase.from('exams').select('*, questions(*)').eq('id', examId).single();
      if(eData) exam = mapExam(eData);
      const { data: pData } = await supabase.from('student_progress').select('*').eq('exam_id', examId);
      progressList = pData || [];
  } else {
      const mockExams = getMockExams();
      exam = mockExams.find(e => e.id === examId);
      progressList = getMockProgress().filter(p => p.examId === examId);
  }

  if (!exam || progressList.length === 0) {
    console.log("No exam or progress found to recalculate.");
    return;
  }

  // 2. Iterate and Recalculate
  const updates = progressList.map(p => {
     const answers = safeParseJSON(p.answers);
     const newScore = calculateScore(exam!, answers);
     return {
        student_id: p.student_id || p.studentId, // Handle both snake (DB) and camel (Mock)
        exam_id: examId,
        score: newScore,
        // Preserve other fields for the upsert
        current_question_index: p.current_question_index || p.currentQuestionIndex,
        answers: answers,
        status: p.status,
        updated_at: new Date().toISOString()
     };
  });

  // 3. Save Back to DB
  if (supabase && updates.length > 0) {
     // Batch Upsert
     const { error } = await supabase.from('student_progress').upsert(updates, { onConflict: 'student_id, exam_id' });
     if (error) console.error("Recalculation Save Error:", error);
     else console.log(`Updated scores for ${updates.length} students.`);
  } else if (!supabase) {
     const mockProgress = getMockProgress();
     updates.forEach(u => {
        const idx = mockProgress.findIndex(mp => mp.studentId === u.student_id && mp.examId === u.exam_id);
        if (idx >= 0) {
            mockProgress[idx].score = u.score;
            mockProgress[idx].lastUpdated = Date.now();
        }
     });
     saveMockData(STORAGE_KEYS.PROGRESS, mockProgress);
  }
};

// ==========================================
// AUTH & USER MANAGEMENT
// ==========================================

export const loginTeacher = async (name: string, password: string): Promise<User | null> => {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'TEACHER')
      .ilike('name', name) 
      .eq('password', password)
      .single();
    if (error || !data) return null;
    return mapUser(data);
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

export const registerTeacher = async (name: string, password: string): Promise<User> => {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .insert({ name, password, role: 'TEACHER' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapUser(data);
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
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').eq('student_id', cleanId).single();
    if (error || !data) return null;
    return mapUser(data);
  }
  const mockUsers = getMockUsers();
  return mockUsers.find(u => u.studentId === cleanId && u.role === UserRole.STUDENT) || null;
};

// UPDATED: Get students created by a specific teacher
export const getStudents = async (teacherId?: string): Promise<User[]> => {
  if (supabase) {
    let query = supabase
      .from('users')
      .select('*')
      .eq('role', 'STUDENT')
      .order('student_id', { ascending: true });

    // Filter by teacher ownership if provided
    if (teacherId) {
       query = query.eq('created_by', teacherId);
    }
      
    const { data, error } = await query;
    if (error) return [];
    return data.map(mapUser);
  }

  // Mock
  const allStudents = getMockUsers().filter(u => u.role === UserRole.STUDENT);
  if (teacherId) {
      return allStudents.filter(s => s.createdBy === teacherId || (!s.createdBy && teacherId === 't1'));
  }
  return allStudents;
};

export interface StudentImportRow { id: string; name: string; section: string; major?: string }

// UPDATED: Import students with teacher ownership
export const importStudents = async (teacherId: string, studentData: StudentImportRow[]) => {
  if (supabase) {
    const { error } = await supabase.from('users').upsert(
      studentData.map(s => ({ 
          student_id: s.id, 
          name: s.name, 
          section: s.section, 
          major: s.major || null,
          role: 'STUDENT',
          created_by: teacherId // Link student to teacher
      })),
      { onConflict: 'student_id' }
    );
    if (error) throw new Error("Import failed: " + error.message);
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
  const payload = {
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.section !== undefined ? { section: updates.section } : {}),
    ...(updates.major !== undefined ? { major: updates.major || null } : {}),
  };
  if (Object.keys(payload).length === 0) return;

  if (supabase) {
    const { error } = await supabase.from('users').update(payload).eq('id', id);
    if (error) throw new Error("Update failed: " + error.message);
    return;
  }
  const mockUsers = getMockUsers();
  saveMockData(STORAGE_KEYS.USERS, mockUsers.map(u => u.id === id ? { ...u, ...updates } : u));
};

// Assigns one major to many students at once (the roster's bulk "assign สาขา" action).
export const assignMajorToStudents = async (ids: string[], major: string): Promise<void> => {
  if (ids.length === 0) return;
  if (supabase) {
    const { error } = await supabase.from('users').update({ major: major || null }).in('id', ids);
    if (error) throw new Error("Assign failed: " + error.message);
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
  if (supabase) {
    const { error } = await supabase.from('users').delete().in('id', ids);
    if (error) throw new Error("Delete failed: " + error.message);
    return;
  }
  const idSet = new Set(ids);
  saveMockData(STORAGE_KEYS.USERS, getMockUsers().filter(u => !idSet.has(u.id)));
};

// ==========================================
// EXAM MANAGEMENT
// ==========================================

export const uploadExamImage = async (file: File): Promise<string> => {
  if (supabase) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
    const filePath = `${fileName}`;
    const { error: uploadError } = await supabase.storage.from('exam-images').upload(filePath, file);
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
    const { data } = supabase.storage.from('exam-images').getPublicUrl(filePath);
    return data.publicUrl;
  }
  return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
  });
};

// Case-insensitive section match (e.g. "sec01" / "SEC01" / "Sec01" are treated as the same section)
const normSection = (s?: string) => (s || '').trim().toUpperCase();
const isAssignedToSection = (assignedSections: string[], section?: string) =>
  assignedSections.some(a => normSection(a) === normSection(section));

export const getExamsForStudent = async (student: User): Promise<Exam[]> => {
  if (supabase) {
    const { data, error } = await supabase.from('exams').select('*, questions(*)').eq('is_active', true);
    if (error) return [];
    const allExams = data.map(mapExam);
    return allExams.filter(e => isAssignedToSection(e.assignedSections, student.section));
  }
  const mockExams = getMockExams();
  return mockExams.filter(e => e.isActive && isAssignedToSection(e.assignedSections, student.section));
};

// UPDATED: Filter by teacherId
// Hidden test cases live behind api/hidden-test-cases.ts (service_role only — RLS blocks
// this client's anon key from reading them directly). The teacher editor needs the real
// content to display/edit them, so merge them in here for the teacher-facing fetch only.
const fetchHiddenTestCases = async (questionIds: string[]): Promise<Record<string, TestCase[]>> => {
  if (questionIds.length === 0) return {};
  try {
    const res = await fetch(`/api/hidden-test-cases?questionIds=${questionIds.join(',')}`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
};

const mergeHiddenTestCases = async (exams: Exam[]): Promise<Exam[]> => {
  const codeQuestionIds = exams.flatMap(e => e.questions)
    .filter(q => q.type === QuestionType.JAVA_CODE)
    .map(q => q.id);
  const hiddenByQuestion = await fetchHiddenTestCases(codeQuestionIds);

  return exams.map(e => ({
    ...e,
    questions: e.questions.map(q => {
      const hidden = hiddenByQuestion[q.id];
      if (!hidden || hidden.length === 0) return q;
      return { ...q, testCases: [...(q.testCases || []), ...hidden.map(tc => ({ ...tc, hidden: true }))] };
    })
  }));
};

export const getExamsForTeacher = async (teacherId?: string): Promise<Exam[]> => {
  if (supabase) {
    let query = supabase.from('exams').select('*, questions(*)').order('created_at', { ascending: false });

    // Filter by created_by if teacherId is provided
    if (teacherId) {
       query = query.eq('created_by', teacherId);
    }

    const { data, error } = await query;
    if (error) return [];
    return mergeHiddenTestCases(data.map(mapExam));
  }

  // Mock Data Filtering
  const mockExams = getMockExams();
  if (teacherId) {
     return mockExams.filter(e => e.createdBy === teacherId || (!e.createdBy && teacherId === 't1'));
  }
  return mockExams;
};

// UPDATED: Save created_by
export const saveExam = async (exam: Exam): Promise<Exam> => {
  let savedExamId = exam.id;

  if (supabase) {
    const examPayload = {
      title: exam.title,
      description: exam.description,
      duration_minutes: exam.durationMinutes,
      is_active: exam.isActive,
      shuffle_questions: !!exam.shuffleQuestions,
      shuffle_options: !!exam.shuffleOptions,
      assigned_sections: exam.assignedSections,
      created_by: exam.createdBy // Save ownership
    };
    
    if (exam.id.startsWith('e') && exam.id.length < 20) {
      const { data: newExam, error: createError } = await supabase.from('exams').insert(examPayload).select().single();
      if (createError) throw createError;
      savedExamId = newExam.id;
    } else {
      const { error: updateError } = await supabase.from('exams').update(examPayload).eq('id', savedExamId);
      if (updateError) throw updateError;
    }
    await supabase.from('questions').delete().eq('exam_id', savedExamId);
    if (exam.questions.length > 0) {
      // Hidden test cases never go into questions.test_cases (that column is readable by
      // anon/students) — only the visible ones do. Hidden ones are pushed separately below,
      // after the questions are inserted and we have their new ids (questions are always
      // fully deleted + reinserted here, so ids change on every save).
      const questionsPayload = exam.questions.map(q => ({
        exam_id: savedExamId,
        type: q.type,
        text: q.text,
        image_url: q.imageUrl,
        score: q.score,
        options: q.options,
        correct_option_index: q.correctOptionIndex,
        test_cases: q.testCases?.filter(tc => !tc.hidden),
        language: q.language,
        allow_file_upload: q.type === QuestionType.JAVA_CODE ? (q.allowFileUpload !== false) : undefined,
        input_mode: q.type === QuestionType.JAVA_CODE ? (q.inputMode || 'stdin') : undefined,
        accepted_answers: q.acceptedAnswers
      }));
      const { data: insertedQuestions, error: qError } = await supabase.from('questions').insert(questionsPayload).select();
      if (qError) throw qError;

      // Push hidden test cases (if any) to their own RLS-protected table via the server
      // function — insertedQuestions comes back in the same order as questionsPayload.
      await Promise.all(exam.questions.map((q, idx) => {
        const hiddenCases = q.testCases?.filter(tc => tc.hidden) || [];
        if (hiddenCases.length === 0) return Promise.resolve();
        const questionId = insertedQuestions?.[idx]?.id;
        if (!questionId) return Promise.resolve();
        return fetch('/api/hidden-test-cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId, testCases: hiddenCases.map(tc => ({ input: tc.input, output: tc.output })) })
        }).catch(() => {});
      }));
    }
  } else {
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
  }

  return { ...exam, id: savedExamId };
};

export const deleteExam = async (examId: string): Promise<void> => {
  if (supabase) {
    await supabase.from('exams').delete().eq('id', examId);
    return;
  }
  const mockExams = getMockExams();
  const updatedExams = mockExams.filter(e => e.id !== examId);
  saveMockData(STORAGE_KEYS.EXAMS, updatedExams);
};

export const updateExamStatus = async (examId: string, isActive: boolean): Promise<void> => {
  if (supabase) {
    await supabase.from('exams').update({ is_active: isActive }).eq('id', examId);
    return;
  }
  const mockExams = getMockExams();
  const index = mockExams.findIndex(e => e.id === examId);
  if (index >= 0) {
      const updatedExams = [...mockExams];
      updatedExams[index] = { ...updatedExams[index], isActive };
      saveMockData(STORAGE_KEYS.EXAMS, updatedExams);
  }
};

// ==========================================
// PROGRESS & RESULTS
// ==========================================

export const getStudentProgress = async (studentId: string, examId: string): Promise<StudentProgress | null> => {
  if (supabase) {
    const { data: progress } = await supabase
      .from('student_progress')
      .select('*')
      .eq('student_id', studentId)
      .eq('exam_id', examId)
      .single();

    if (!progress) return null;

    const { data: user } = await supabase
      .from('users')
      .select('name')
      .eq('student_id', studentId)
      .single();

    return mapProgress(progress, user?.name || studentId);
  }
  const mockProgressStore = getMockProgress();
  return mockProgressStore.find(p => p.studentId === studentId && p.examId === examId) || null;
}

export const submitStudentProgress = async (progress: StudentProgress): Promise<{success: boolean, error?: string}> => {
  if (supabase) {
    try {
      const payload: any = {
        student_id: progress.studentId,
        exam_id: progress.examId,
        current_question_index: progress.currentQuestionIndex,
        answers: progress.answers || {}, // Force object
        score: progress.score, // CRITICAL: Save the actual calculated score
        status: progress.status,
        auto_submitted: !!progress.autoSubmitted,
        tab_switch_count: progress.tabSwitchCount || 0,
        capture_attempt_count: progress.captureAttemptCount || 0,
        updated_at: new Date().toISOString()
      };
      if (progress.startedAt) {
        payload.started_at = new Date(progress.startedAt).toISOString();
      }

      let { error } = await supabase.from('student_progress').upsert(payload, { onConflict: 'student_id, exam_id' });

      // FALLBACK: If a newer column (e.g. 'started_at', 'auto_submitted') is missing from an
      // older/un-migrated database schema (PGRST204), retry without it.
      let fallbackPayload = payload;
      while (error && error.code === 'PGRST204') {
          const missingColumn = /column '(\w+)'/.exec(error.message)?.[1];
          if (!missingColumn || !(missingColumn in fallbackPayload)) break;
          console.warn(`Supabase schema mismatch (missing ${missingColumn}). Retrying payload without it.`);
          const { [missingColumn]: _omit, ...rest } = fallbackPayload;
          fallbackPayload = rest;
          const retry = await supabase.from('student_progress').upsert(fallbackPayload, { onConflict: 'student_id, exam_id' });
          error = retry.error;
      }

      if (error) {
        // Detailed Error Logging
        console.error("SUPABASE UPLOAD ERROR:", error);
        return { success: false, error: `${error.code}: ${error.message} (${error.details || ''})` };
      }
      return { success: true };
    } catch (e: any) {
      console.error("UNEXPECTED ERROR:", e);
      return { success: false, error: e.message };
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
  if (supabase) {
    await supabase
      .from('student_progress')
      .update({ status: 'IN_PROGRESS', updated_at: new Date().toISOString() })
      .eq('student_id', studentId)
      .eq('exam_id', examId);
    return;
  }
  const mockProgressStore = getMockProgress();
  const idx = mockProgressStore.findIndex(p => p.studentId === studentId && p.examId === examId);
  if (idx >= 0) {
    mockProgressStore[idx] = { ...mockProgressStore[idx], status: 'IN_PROGRESS', lastUpdated: Date.now() };
    saveMockData(STORAGE_KEYS.PROGRESS, mockProgressStore);
  }
};

export const getLiveProgress = async (examId: string): Promise<StudentProgress[]> => {
  if (supabase) {
    // 1. Get Progress
    const { data: progressData, error } = await supabase
      .from('student_progress')
      .select('*')
      .eq('exam_id', examId);
    
    if (error || !progressData) return [];

    // 2. Get Student Names Manually
    const studentIds = progressData.map((p: any) => p.student_id);
    if (studentIds.length === 0) return [];

    const { data: users } = await supabase
      .from('users')
      .select('student_id, name')
      .in('student_id', studentIds);

    const userMap = new Map(users?.map((u: any) => [u.student_id, u.name]) || []);

    return progressData.map((p: any) => mapProgress(p, userMap.get(p.student_id) || 'Unknown'));
  }

  // Fallback to Mock
  const mockProgressStore = getMockProgress();
  return mockProgressStore.filter(p => p.examId === examId);
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
  let exam: Exam | undefined;
  let progressList: any[] = [];
  let users: any[] = [];

  // --- 1. FETCH DATA ---
  if (supabase) {
     const { data: eData } = await supabase.from('exams').select('*, questions(*)').eq('id', examId).single();
     if(eData) exam = mapExam(eData);

     const { data: pData } = await supabase.from('student_progress').select('*').eq('exam_id', examId);
     progressList = pData || [];

     if (progressList.length > 0) {
        const sIds = progressList.map((p: any) => p.student_id);
        const { data: uData } = await supabase.from('users').select('student_id, name, section').in('student_id', sIds);
        users = uData || [];
     }
  } else {
     const mockExams = getMockExams();
     exam = mockExams.find(e => e.id === examId);
     progressList = getMockProgress().filter(p => p.examId === examId);
     users = getMockUsers();
  }

  if (!exam) return [];

  // --- 2. CALCULATE SCORES ---
  return progressList.map((p: any) => {
    // Ensure answers is an object (Fix for Stringified JSONB)
    const answers = safeParseJSON(p.answers); 
    const status = p.status;
    const submittedAt = p.updated_at || p.lastUpdated; 
    
    const studentId = p.student_id || p.studentId; 
    const user = users.find((u: any) => (u.student_id || u.studentId) === studentId);

    // Calculate Scores using shared logic
    const totalScore = calculateScore(exam!, answers);
    
    // Calculate Max Score
    const maxScore = exam!.questions.reduce((sum, q) => sum + q.score, 0);

    return {
      studentId: studentId,
      name: user?.name || 'Unknown',
      section: user?.section || 'N/A',
      totalScore,
      maxScore,
      status: status,
      submittedAt: submittedAt ? new Date(submittedAt).toLocaleString() : 'N/A'
    };
  });
};

// ==========================================
// REMOTE GRADING (via Vercel serverless function -> Sphere Engine)
// ==========================================
// The actual judge call (and its API token) lives server-side in api/judge.ts, which
// also looks up this question's test cases itself (visible AND hidden) — the client
// only ever sends the question id + code, never test case content, so hidden test data
// never has to touch the student's browser at all.
export const compileCode = async (questionId: string, code: string, language: CodeLanguage = 'java'): Promise<{passed: boolean, output: string}> => {
  if (!code.trim()) {
      return { passed: false, output: "Error: Code is empty." };
  }

  try {
    const response = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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