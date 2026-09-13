export enum UserRole {
  TEACHER = 'TEACHER',
  STUDENT = 'STUDENT'
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  studentId?: string; // For students
  section?: string; // For students
  createdBy?: string; // New: Track which teacher imported this student
}

export enum QuestionType {
  MULTIPLE_CHOICE = 'MCQ',
  JAVA_CODE = 'JAVA',
  SHORT_ANSWER = 'SHORT_ANSWER'
}

export type CodeLanguage = 'java' | 'python3';

export interface TestCase {
  input: string;
  output: string;
  hidden?: boolean; // If true, students don't see this case's input/expected/actual, but it still counts toward grading
}

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  imageUrl?: string; // Added image URL support
  score: number;
  // For MCQ
  options?: string[];
  correctOptionIndex?: number;
  // For Code
  testCases?: TestCase[];
  language?: CodeLanguage; // Programming language for code questions, defaults to 'java'
  allowFileUpload?: boolean; // Whether students can upload a code file instead of typing, defaults to true
  // For Short Answer
  acceptedAnswers?: string[];
}

export interface Exam {
  id: string;
  title: string;
  description: string;
  assignedSections: string[]; // e.g., ["SEC01", "SEC02"]
  questions: Question[];
  durationMinutes: number;
  isActive: boolean;
  createdBy?: string; // New: Track which teacher created this exam
}

export interface StudentProgress {
  studentId: string;
  studentName: string;
  examId: string;
  currentQuestionIndex: number;
  answers: Record<string, any>; // questionId -> answer
  score: number;
  status: 'IDLE' | 'IN_PROGRESS' | 'COMPLETED';
  startedAt?: number; // Timestamp when student started the exam
  lastUpdated: number;
}