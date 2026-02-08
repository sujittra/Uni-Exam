import { Exam, QuestionType, StudentProgress, User, UserRole } from '../types';

// ==========================================
// SUPABASE CONFIGURATION (Uncomment to use Real Backend)
// ==========================================
/*
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// When using Supabase, you would replace the in-memory arrays below with
// calls to supabase.from('table').select/insert/update/delete
*/
// ==========================================

// Mock Data Storage
let users: User[] = [
  { id: 't1', name: 'Dr. Smith', role: UserRole.TEACHER },
  { id: 's1', name: 'Alice Student', role: UserRole.STUDENT, studentId: '64001', section: 'SEC01' },
  { id: 's2', name: 'Bob Student', role: UserRole.STUDENT, studentId: '64002', section: 'SEC02' }
];

// Mock Password Store (username -> password)
const mockPasswords: Record<string, string> = {
  'Dr. Smith': 'admin123' 
};

let exams: Exam[] = [
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
      }
    ]
  }
];

let progressStore: StudentProgress[] = [];

// --- Auth & User Management ---

export const loginTeacher = async (name: string, password: string): Promise<User | null> => {
  // Check if user exists and password matches mock store
  const user = users.find(u => u.role === UserRole.TEACHER && u.name === name);
  if (user && mockPasswords[name] === password) {
    return user;
  }
  return null;
};

export const registerTeacher = async (name: string, password: string): Promise<User> => {
  const existing = users.find(u => u.name === name && u.role === UserRole.TEACHER);
  if (existing) throw new Error("Username already taken");

  const newUser: User = {
    id: `t_${Date.now()}`,
    name,
    role: UserRole.TEACHER
  };
  users.push(newUser);
  mockPasswords[name] = password;
  return newUser;
};

export const loginStudent = async (studentId: string): Promise<User | null> => {
  const student = users.find(u => u.studentId === studentId && u.role === UserRole.STUDENT);
  return student || null;
};

export const importStudents = async (studentData: {id: string, name: string, section: string}[]) => {
  const newUsers = studentData.map(s => ({
    id: `s_${s.id}`,
    name: s.name,
    studentId: s.id,
    section: s.section,
    role: UserRole.STUDENT
  }));
  
  // Filter out duplicates based on studentId
  const uniqueNewUsers = newUsers.filter(nu => !users.some(u => u.studentId === nu.studentId));
  users = [...users, ...uniqueNewUsers];
};

// --- Exam Management ---

export const getExamsForStudent = async (student: User): Promise<Exam[]> => {
  return exams.filter(e => e.isActive && e.assignedSections.includes(student.section || ''));
};

export const getExamsForTeacher = async (): Promise<Exam[]> => {
  return exams;
};

export const saveExam = async (exam: Exam): Promise<void> => {
  const index = exams.findIndex(e => e.id === exam.id);
  if (index >= 0) {
    exams[index] = exam;
  } else {
    exams.push(exam);
  }
};

export const deleteExam = async (examId: string): Promise<void> => {
  exams = exams.filter(e => e.id !== examId);
};

export const createExam = async (exam: Exam): Promise<void> => {
  exams.push(exam);
};

export const updateExamStatus = async (examId: string, isActive: boolean): Promise<void> => {
  const exam = exams.find(e => e.id === examId);
  if (exam) exam.isActive = isActive;
};

// --- Progress & Runtime ---

export const submitStudentProgress = async (progress: StudentProgress) => {
  const existingIndex = progressStore.findIndex(p => p.studentId === progress.studentId && p.examId === progress.examId);
  if (existingIndex >= 0) {
    progressStore[existingIndex] = { ...progress, lastUpdated: Date.now() };
  } else {
    progressStore.push({ ...progress, lastUpdated: Date.now() });
  }
};

export const getLiveProgress = async (examId: string): Promise<StudentProgress[]> => {
  return progressStore.filter(p => p.examId === examId);
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
  const exam = exams.find(e => e.id === examId);
  if (!exam) return [];

  const progressList = progressStore.filter(p => p.examId === examId);
  
  const results: ExamResult[] = progressList.map(p => {
    const student = users.find(u => u.studentId === p.studentId);
    
    // Auto-calculate score
    let totalScore = 0;
    let maxScore = 0;

    exam.questions.forEach(q => {
      maxScore += q.score;
      const ans = p.answers[q.id];
      
      if (ans !== undefined && ans !== null && ans !== '') {
        if (q.type === QuestionType.MULTIPLE_CHOICE) {
           if (ans === q.correctOptionIndex) totalScore += q.score;
        } else if (q.type === QuestionType.SHORT_ANSWER) {
           // Case insensitive check
           if (q.acceptedAnswers?.some(a => a.toLowerCase() === String(ans).toLowerCase())) {
             totalScore += q.score;
           }
        }
        // NOTE: Java Code is manual grade or handled by test runner. 
        // For this basic export, we assume 0 unless we store grading result separately.
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

  return results;
};

export const compileJavaCode = async (code: string, testCases: {input: string, output: string}[]): Promise<{passed: boolean, output: string}> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // Very basic mock logic: check if code is not empty
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

      resolve({
        passed,
        output: outputDetails
      });
    }, 1500);
  });
};