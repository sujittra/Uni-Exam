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
  major?: string; // For students: their major/programme (สาขา)
  createdBy?: string; // New: Track which teacher imported this student
}

export enum QuestionType {
  MULTIPLE_CHOICE = 'MCQ',
  JAVA_CODE = 'JAVA',
  SHORT_ANSWER = 'SHORT_ANSWER'
}

export type CodeLanguage = 'java' | 'python3';

// How a code question feeds each test case to the student's program.
//   'stdin'    — the test case's input is piped to standard input (original behaviour)
//   'function' — the test case's input is a call expression, e.g. `rectangle_area(4, 5)`,
//                evaluated after the student's code. Python only.
export type CodeInputMode = 'stdin' | 'function';

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
  testCases?: TestCase[]; // Visible cases; for students, hidden ones are never included here
  hiddenTestCaseCount?: number; // How many hidden cases exist (safe to show students; real data lives server-side)
  language?: CodeLanguage; // Programming language for code questions, defaults to 'java'
  allowFileUpload?: boolean; // Whether students can upload a code file instead of typing, defaults to true
  inputMode?: CodeInputMode; // How test case inputs are fed to the program, defaults to 'stdin'
  // For Short Answer
  acceptedAnswers?: string[];
}

export interface Exam {
  id: string;
  title: string;
  description: string;
  assignedSections: string[]; // e.g., ["SEC01", "SEC02"]
  assignedMajors?: string[]; // ANDed with assignedSections; empty means "any major"
  questions: Question[];
  durationMinutes: number;
  isActive: boolean;
  shuffleQuestions?: boolean; // Each student sees the questions in their own order
  shuffleOptions?: boolean; // Each student sees each MCQ's choices in their own order
  // Leaving the exam view costs time. The first `tabSwitchLimit` exits are free; every one
  // after that takes `tabSwitchPenaltyMinutes` off the student's clock. A penalty of 0
  // turns the whole thing off, which is the default.
  tabSwitchLimit?: number;
  tabSwitchPenaltyMinutes?: number;
  createdBy?: string; // New: Track which teacher created this exam
}

export interface StudentProgress {
  studentId: string;
  studentName: string;
  examId: string;
  currentQuestionIndex: number;
  // The monitor leaves this empty: shipping every student's work to every invigilator's
  // screen twice a second was most of the traffic an exam produced. Inspect fetches one
  // student's answers on demand instead (getStudentAnswers), and the monitor gets
  // answeredCount, which is all it ever used them for.
  answers: Record<string, any>; // questionId -> answer
  answeredCount?: number;
  score: number;
  status: 'IDLE' | 'IN_PROGRESS' | 'COMPLETED';
  startedAt?: number; // Timestamp when student started the exam
  autoSubmitted?: boolean; // True if the exam was auto-submitted because time ran out, rather than a manual submit
  tabSwitchCount?: number; // Times the student left the exam view (tab/app switch, or exited forced fullscreen)
  captureAttemptCount?: number; // Times a screen-capture shortcut was detected (best effort — the OS swallows some)
  lastUpdated: number;
}