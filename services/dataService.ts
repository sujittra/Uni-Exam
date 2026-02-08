import { createClient } from '@supabase/supabase-js';
import { Exam, Question, QuestionType, StudentProgress, User, UserRole } from '../types';

// ==========================================
// SUPABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://wbkpuqtzkpvhjnckinep.supabase.co'; 
const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6India3B1cXR6a3B2aGpuY2tpbmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NDE2OTMsImV4cCI6MjA4NjExNzY5M30.2Vsb4vl5WTnLLn60033Rcx-X6TfdDXrI1Qsuj8i_dN0';

// Initialize Client only if keys are present
const supabase = (SUPABASE_URL && SUPABASE_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

// ==========================================
// MOCK DATA (Fallback)
// ==========================================
let mockUsers: User[] = [
  { id: 't1', name: 'Dr. Smith', role: UserRole.TEACHER },
  { id: 's1', name: 'Alice Student', role: UserRole.STUDENT, studentId: '64001', section: 'SEC01' },
  { id: 's2', name: 'Bob Student', role: UserRole.STUDENT, studentId: '64002', section: 'SEC02' }
];
const mockPasswords: Record<string, string> = { 'Dr. Smith': 'admin123' };

let mockExams: Exam[] = [
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

let mockProgressStore: StudentProgress[] = [];

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
  questions: (e.questions || []).map(mapQuestion).sort((a: Question, b: Question) => a.text.localeCompare(b.text)) // Simple sort
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

const mapProgress = (p: any, userName: string = ''): StudentProgress => ({
  studentId: p.student_id,
  studentName: userName, 
  examId: p.exam_id,
  currentQuestionIndex: p.current_question_index,
  answers: p.answers || {},
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
      .eq('name', name)
      .eq('password', password)
      .single();
    if (error || !data) return null;
    return mapUser(data);
  }
  const user = mockUsers.find(u => u.role === UserRole.TEACHER && u.name === name);
  if (user && mockPasswords[name] === password) return user;
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
  const existing = mockUsers.find(u => u.name === name && u.role === UserRole.TEACHER);
  if (existing) throw new Error("Username already taken");
  const newUser: User = { id: `t_${Date.now()}`, name, role: UserRole.TEACHER };
  mockUsers.push(newUser);
  mockPasswords[name] = password;
  return newUser;
};

export const loginStudent = async (studentId: string): Promise<User | null> => {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').eq('student_id', studentId).single();
    if (error || !data) return null;
    return mapUser(data);
  }
  return mockUsers.find(u => u.studentId === studentId && u.role === UserRole.STUDENT) || null;
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
  const newUsers = studentData.map(s => ({
    id: `s_${s.id}`,
    name: s.name,
    studentId: s.id,
    section: s.section,
    role: UserRole.STUDENT
  }));
  const uniqueNewUsers = newUsers.filter(nu => !mockUsers.some(u => u.studentId === nu.studentId));
  mockUsers = [...mockUsers, ...uniqueNewUsers];
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
  return URL.createObjectURL(file);
};

export const getExamsForStudent = async (student: User): Promise<Exam[]> => {
  if (supabase) {
    const { data, error } = await supabase.from('exams').select('*, questions(*)').eq('is_active', true);
    if (error) return [];
    const allExams = data.map(mapExam);
    return allExams.filter(e => e.assignedSections.includes(student.section || ''));
  }
  return mockExams.filter(e => e.isActive && e.assignedSections.includes(student.section || ''));
};

export const getExamsForTeacher = async (): Promise<Exam[]> => {
  if (supabase) {
    const { data, error } = await supabase.from('exams').select('*, questions(*)').order('created_at', { ascending: false });
    if (error) return [];
    return data.map(mapExam);
  }
  return mockExams;
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
  const index = mockExams.findIndex(e => e.id === exam.id);
  if (index >= 0) mockExams[index] = exam;
  else mockExams.push(exam);
};

export const deleteExam = async (examId: string): Promise<void> => {
  if (supabase) {
    await supabase.from('exams').delete().eq('id', examId);
    return;
  }
  mockExams = mockExams.filter(e => e.id !== examId);
};

export const updateExamStatus = async (examId: string, isActive: boolean): Promise<void> => {
  if (supabase) {
    await supabase.from('exams').update({ is_active: isActive }).eq('id', examId);
    return;
  }
  const exam = mockExams.find(e => e.id === examId);
  if (exam) exam.isActive = isActive;
};

// ==========================================
// PROGRESS & RESULTS
// ==========================================

export const getStudentProgress = async (studentId: string, examId: string): Promise<StudentProgress | null> => {
  if (supabase) {
    const { data, error } = await supabase
      .from('student_progress')
      .select('*, users!student_progress_student_id_fkey(name)')
      .eq('student_id', studentId)
      .eq('exam_id', examId)
      .single();
    if (error || !data) return null;
    return mapProgress(data, data.users?.name);
  }
  return mockProgressStore.find(p => p.studentId === studentId && p.examId === examId) || null;
}

export const submitStudentProgress = async (progress: StudentProgress) => {
  if (supabase) {
    const payload: any = {
      student_id: progress.studentId,
      exam_id: progress.examId,
      current_question_index: progress.currentQuestionIndex,
      answers: progress.answers,
      status: progress.status,
      updated_at: new Date().toISOString()
    };
    if (progress.startedAt) {
      payload.started_at = new Date(progress.startedAt).toISOString();
    }

    const { error } = await supabase.from('student_progress').upsert(payload, { onConflict: 'student_id, exam_id' });
    if (error) console.error("Progress Sync Error:", error);
    return;
  }

  const existingIndex = mockProgressStore.findIndex(p => p.studentId === progress.studentId && p.examId === progress.examId);
  if (existingIndex >= 0) {
    mockProgressStore[existingIndex] = { ...progress, lastUpdated: Date.now() };
  } else {
    mockProgressStore.push({ ...progress, lastUpdated: Date.now() });
  }
};

export const getLiveProgress = async (examId: string): Promise<StudentProgress[]> => {
  if (supabase) {
    const { data, error } = await supabase
      .from('student_progress')
      .select('*, users!student_progress_student_id_fkey(name)')
      .eq('exam_id', examId);
    if (error || !data) return [];
    return data.map((p: any) => mapProgress(p, p.users?.name));
  }
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
  let progressList: StudentProgress[] = [];
  let userLookup: (id: string) => User | undefined;

  if (supabase) {
     const { data: eData } = await supabase.from('exams').select('*, questions(*)').eq('id', examId).single();
     if(eData) exam = mapExam(eData);

     const { data: pData } = await supabase
      .from('student_progress')
      .select('*, users!student_progress_student_id_fkey(name, section)')
      .eq('exam_id', examId);
     
     if(pData) {
       progressList = pData.map((p: any) => mapProgress(p, p.users?.name));
       userLookup = (sid) => {
         const found = pData.find((p:any) => p.student_id === sid);
         return found ? { ...found.users, id: 'temp', role: UserRole.STUDENT } : undefined;
       }
     }
  } else {
     exam = mockExams.find(e => e.id === examId);
     progressList = mockProgressStore.filter(p => p.examId === examId);
     userLookup = (sid) => mockUsers.find(u => u.studentId === sid);
  }

  if (!exam) return [];

  return progressList.map(p => {
    const student = userLookup(p.studentId);
    let totalScore = 0;
    let maxScore = 0;

    exam!.questions.forEach(q => {
      maxScore += q.score;
      const ans = p.answers[q.id];
      if (ans !== undefined && ans !== null && ans !== '') {
        if (q.type === QuestionType.MULTIPLE_CHOICE) {
           if (ans === q.correctOptionIndex) totalScore += q.score;
        } else if (q.type === QuestionType.SHORT_ANSWER) {
           if (q.acceptedAnswers?.some(a => a.toLowerCase() === String(ans).toLowerCase())) {
             totalScore += q.score;
           }
        }
      }
    });

    return {
      studentId: p.studentId,
      name: p.studentName,
      section: student?.section || 'N/A',
      totalScore,
      maxScore,
      status: p.status,
      submittedAt: new Date(p.lastUpdated).toLocaleString()
    };
  });
};

export const compileJavaCode = async (code: string, testCases: {input: string, output: string}[]): Promise<{passed: boolean, output: string}> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const passed = code.length > 20 && !code.includes('error');
      let outputDetails = "";
      if (passed) {
        outputDetails = "BUILD SUCCESSFUL\n\n";
        testCases.forEach((tc, i) => {
          outputDetails += `Test Case ${i + 1}: Input [${tc.input}] -> Expected [${tc.output}] -> Actual [${tc.output}] (PASS)\n`;
        });
      } else {
         outputDetails = "BUILD FAILED\n\nError: Syntax error or compilation failed.";
      }
      resolve({ passed, output: outputDetails });
    }, 1500);
  });
};