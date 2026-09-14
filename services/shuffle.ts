import { Exam, Question, QuestionType } from '../types';

// Per-student randomisation of question and MCQ-choice order.
//
// The order MUST be stable for a given student: `currentQuestionIndex` is persisted, and a
// student who refreshes or resumes hours later has to land back on the same question. So
// the shuffle is seeded from the student's id (plus the exam/question id) rather than being
// random per render — same student, same order, every time; different students, different
// orders.
//
// Grading is untouched by either shuffle: answers are stored against question ids, and an
// MCQ answer is stored as the ORIGINAL option index (see optionOrderFor / toOriginalIndex),
// which is what dataService.calculateScore and recalculateExamScores compare against.

// FNV-1a — small, dependency-free, and good enough to spread ids across the seed space.
const hashString = (str: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

// mulberry32: a tiny seeded PRNG. Deterministic for a given seed, which is the whole point.
const seededRandom = (seed: number) => {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Fisher-Yates driven by the seeded PRNG.
const seededShuffle = <T>(items: T[], seed: string): T[] => {
  const rand = seededRandom(hashString(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// The order in which this student sees one MCQ's choices, as indices into the original
// `options` array. `[2, 0, 1]` means "show original option 2 first".
export const optionOrderFor = (question: Question, studentId: string, shuffle: boolean): number[] => {
  const indices = (question.options || []).map((_, i) => i);
  if (!shuffle || question.type !== QuestionType.MULTIPLE_CHOICE) return indices;
  return seededShuffle(indices, `${studentId}:${question.id}`);
};

// Every MCQ's option order for one exam, keyed by question id — computed once when the
// exam session starts so a re-render can't reshuffle mid-question.
export const buildOptionOrders = (exam: Exam, studentId: string): Record<string, number[]> => {
  const orders: Record<string, number[]> = {};
  exam.questions.forEach(q => {
    if (q.type === QuestionType.MULTIPLE_CHOICE) {
      orders[q.id] = optionOrderFor(q, studentId, !!exam.shuffleOptions);
    }
  });
  return orders;
};

// The exam as this particular student should see it: questions reordered if the exam says
// so. Options are NOT rewritten here — they stay in their original order so the stored
// answer index keeps its original meaning; display order comes from buildOptionOrders.
export const examForStudent = (exam: Exam, studentId: string): Exam => {
  if (!exam.shuffleQuestions) return exam;
  return { ...exam, questions: seededShuffle(exam.questions, `${studentId}:${exam.id}`) };
};
