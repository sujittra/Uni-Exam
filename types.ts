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
}

export enum QuestionType {
  MULTIPLE_CHOICE = 'MCQ',
  JAVA_CODE = 'JAVA',
  SHORT_ANSWER = 'SHORT_ANSWER'
}

export interface TestCase {
  input: string;
  output: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  score: number;
  // For MCQ
  options?: string[];
  correctOptionIndex?: number;
  // For Code
  testCases?: TestCase[]; 
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
}

export interface StudentProgress {
  studentId: string;
  studentName: string;
  examId: string;
  currentQuestionIndex: number;
  answers: Record<string, any>; // questionId -> answer
  score: number;
  status: 'IDLE' | 'IN_PROGRESS' | 'COMPLETED';
  lastUpdated: number;
}