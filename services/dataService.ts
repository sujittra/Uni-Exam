import { createClient } from '@supabase/supabase-js';
import { Exam, Question, QuestionType, StudentProgress, User, UserRole } from '../types';

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
  { id: 's1', name: 'Alice Student', role: UserRole.STUDENT, studentId: '64001', section: 'SEC01' },
  { id: 's2', name: 'Bob Student', role: UserRole.STUDENT, studentId: '64002', section: 'SEC02' }
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
  section: u.section
});

const mapExam = (e: any): Exam => ({
  id: e.id,
  title: e.title,
  description: e.description,
  durationMinutes: e.duration_minutes,
  isActive: e.is_active,
  assignedSections: e.assigned_sections || [],
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

const mapProgress = (p: any, userName: string = ''): StudentProgress => ({
  studentId: p.student_id,
  studentName: userName, 
  examId: p.exam_id,
  currentQuestionIndex: p.current_question_index,
  answers: safeParseJSON(p.answers), // Use Safe Parse
  score: p.score,
  status: p.status,
  startedAt: p.started_at ? new Date(p.started_at).getTime() : undefined,
  lastUpdated: new Date(p.updated_at).getTime()
});

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

// NEW: Get all students for Roster view
export const getStudents = async (): Promise<User[]> => {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'STUDENT')
      .order('student_id', { ascending: true });
      
    if (error) return [];
    return data.map(mapUser);
  }
  return getMockUsers().filter(u => u.role === UserRole.STUDENT);
};

export const importStudents = async (studentData: {id: string, name: string, section: string}[]) => {
  if (supabase) {
    const { error } = await supabase.from('users').upsert(
      studentData.map(s => ({ student_id: s.id, name: s.name, section: s.section, role: 'STUDENT' })),
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
    role: UserRole.STUDENT
  }));
  
  const existingIds = new Set(mockUsers.map(u => u.studentId));
  const uniqueNewUsers = newUsers.filter(nu => !existingIds.has(nu.studentId));
  
  saveMockData(STORAGE_KEYS.USERS, [...mockUsers, ...uniqueNewUsers]);
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

export const getExamsForStudent = async (student: User): Promise<Exam[]> => {
  if (supabase) {
    const { data, error } = await supabase.from('exams').select('*, questions(*)').eq('is_active', true);
    if (error) return [];
    const allExams = data.map(mapExam);
    return allExams.filter(e => e.assignedSections.includes(student.section || ''));
  }
  const mockExams = getMockExams();
  return mockExams.filter(e => e.isActive && e.assignedSections.includes(student.section || ''));
};

export const getExamsForTeacher = async (): Promise<Exam[]> => {
  if (supabase) {
    const { data, error } = await supabase.from('exams').select('*, questions(*)').order('created_at', { ascending: false });
    if (error) return [];
    return data.map(mapExam);
  }
  return getMockExams();
};

export const saveExam = async (exam: Exam): Promise<void> => {
  if (supabase) {
    const examPayload = {
      title: exam.title,
      description: exam.description,
      duration_minutes: exam.durationMinutes,
      is_active: exam.isActive,
      assigned_sections: exam.assignedSections
    };
    let examId = exam.id;
    if (exam.id.startsWith('e') && exam.id.length < 20) {
      const { data: newExam, error: createError } = await supabase.from('exams').insert(examPayload).select().single();
      if (createError) throw createError;
      examId = newExam.id;
    } else {
      const { error: updateError } = await supabase.from('exams').update(examPayload).eq('id', examId);
      if (updateError) throw updateError;
    }
    await supabase.from('questions').delete().eq('exam_id', examId);
    if (exam.questions.length > 0) {
      const questionsPayload = exam.questions.map(q => ({
        exam_id: examId,
        type: q.type,
        text: q.text,
        image_url: q.imageUrl,
        score: q.score,
        options: q.options,
        correct_option_index: q.correctOptionIndex,
        test_cases: q.testCases,
        accepted_answers: q.acceptedAnswers
      }));
      const { error: qError } = await supabase.from('questions').insert(questionsPayload);
      if (qError) throw qError;
    }
    return;
  }
  
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
        status: progress.status,
        updated_at: new Date().toISOString()
      };
      if (progress.startedAt) {
        payload.started_at = new Date(progress.startedAt).toISOString();
      }

      const { error } = await supabase.from('student_progress').upsert(payload, { onConflict: 'student_id, exam_id' });
      
      if (error) {
        // FALLBACK: If column 'started_at' is missing (PGRST204), try sending without it
        if (error.code === 'PGRST204' && payload.started_at) {
             console.warn("Supabase schema mismatch (missing started_at). Retrying payload without it.");
             const { started_at, ...fallbackPayload } = payload;
             const { error: fallbackError } = await supabase.from('student_progress').upsert(fallbackPayload, { onConflict: 'student_id, exam_id' });
             
             if (!fallbackError) return { success: true };
             return { success: false, error: `${fallbackError.code}: ${fallbackError.message}` };
        }

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

    let totalScore = 0;
    let maxScore = 0;

    exam!.questions.forEach(q => {
      maxScore += q.score;
      const ans = answers[q.id];
      
      if (ans !== undefined && ans !== null && ans !== '') {
        if (q.type === QuestionType.MULTIPLE_CHOICE) {
           // Improved Type Coercion: DB might give "0" (string), App gives 0 (number)
           if (String(ans) === String(q.correctOptionIndex)) {
             totalScore += q.score;
           }
        } else if (q.type === QuestionType.SHORT_ANSWER) {
           const textAns = String(ans).trim().toLowerCase();
           const isCorrect = q.acceptedAnswers?.some(a => a.toLowerCase() === textAns);
           if (isCorrect) totalScore += q.score;
        } else if (q.type === QuestionType.JAVA_CODE) {
           // Fallback grading: Length check > 20 chars
           if (typeof ans === 'string' && ans.length > 20) {
             totalScore += q.score;
           }
        }
      }
    });

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
// REAL REMOTE COMPILER (via Piston API)
// ==========================================
const PISTON_API_URL = "https://emkc.org/api/v2/piston/execute";

export const compileJavaCode = async (code: string, testCases: {input: string, output: string}[]): Promise<{passed: boolean, output: string}> => {
  if (!code.trim()) {
      return { passed: false, output: "Error: Code is empty." };
  }

  let finalOutputDetails = "";
  let allPassed = true;

  const normalize = (str: string) => str.replace(/\s+/g, ' ').trim();

  const runTestCase = async (input: string, expected: string, index: number) => {
      try {
          const response = await fetch(PISTON_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  language: "java",
                  version: "15.0.2", 
                  files: [
                      {
                          name: "Main.java",
                          content: code
                      }
                  ],
                  stdin: input,
                  compile_timeout: 10000,
                  run_timeout: 3000
              })
          });

          const result = await response.json();
          
          if (result.compile && result.compile.code !== 0) {
              return { 
                  success: false, 
                  output: `[Compilation Error]\n${result.compile.stderr || result.compile.stdout}` 
              };
          }

          if (result.run && result.run.code !== 0 && result.run.signal !== null) {
              return {
                  success: false,
                  output: `[Runtime Error]\n${result.run.stderr || result.run.stdout}`
              };
          }

          const actualOutput = result.run.stdout ? result.run.stdout.trim() : "";
          const normalizedExpected = normalize(expected);
          const normalizedActual = normalize(actualOutput);
          const passed = normalizedActual === normalizedExpected;

          return {
              success: true,
              passed: passed,
              details: `Test Case ${index + 1}: Input [${input}] \n   -> Expected [${normalizedExpected}] \n   -> Actual   [${normalizedActual}] (${passed ? 'PASS' : 'FAIL'})`
          };

      } catch (error: any) {
          return { success: false, output: `System Error: ${error.message}` };
      }
  };

  finalOutputDetails += "Compiling and Running on Remote Server...\n\n";

  for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const result = await runTestCase(tc.input, tc.output, i);

      if (!result.success) {
          finalOutputDetails += result.output + "\n";
          return { passed: false, output: finalOutputDetails };
      }

      finalOutputDetails += result.details + "\n";
      if (!result.passed) allPassed = false;
  }

  return { passed: allPassed, output: finalOutputDetails };
};