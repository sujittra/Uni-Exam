// The grading rules, in one place, used by both sides.
//
// It lives in api/ for the same reason _pyHarness.ts does: the server is the authority (it
// is the only side that can see the answer key now, and the only side whose arithmetic a
// student cannot edit), but the teacher's dashboard has to show the same numbers, so both
// import this file rather than keeping two copies that drift. Plain TypeScript with no Node
// imports, so it bundles into the browser as well.
//
// api/db.ts calls it with a `codePassed` that consults the recorded judge verdicts; the
// teacher UI calls it with the default, which reads the verdict stored alongside the answer.

export interface ScorableQuestion {
  id: string;
  type: string; // 'MCQ' | 'JAVA' | 'SHORT_ANSWER'
  score: number;
  correctOptionIndex?: number | null;
  acceptedAnswers?: string[] | null;
}

// Short answers are compared with punctuation-ish differences flattened: case, all
// whitespace, and newlines-as-commas (so "pop\npush" matches "pop,push").
export const normalizeAnswerText = (text: any): string => {
  if (!text) return '';
  if (typeof text === 'object' && text.code) return String(text.code).toLowerCase().replace(/\s+/g, '');
  return String(text)
    .toLowerCase()
    .replace(/[\n\r]+/g, ',')
    .replace(/\s+/g, '');
};

// Whether a code answer earns its marks. The default is the verdict recorded on the answer
// itself, which is what the teacher's browser has to go on. The server passes its own
// version instead — the client-supplied flag is just a claim, and a claim is exactly what a
// student would forge.
export type CodePassedFn = (question: ScorableQuestion, answer: any) => boolean;

const trustStoredVerdict: CodePassedFn = (_q, answer) =>
  typeof answer === 'object' && answer !== null && answer.passed === true;

export const isAnswered = (ans: any) => ans !== undefined && ans !== null && ans !== '';

export const scoreQuestion = (
  question: ScorableQuestion,
  answer: any,
  codePassed: CodePassedFn = trustStoredVerdict
): number => {
  if (!isAnswered(answer)) return 0;

  if (question.type === 'MCQ') {
    // The index arrives as a number from the app and as a string from PostgREST.
    return String(answer) === String(question.correctOptionIndex) ? question.score : 0;
  }

  if (question.type === 'SHORT_ANSWER') {
    const given = normalizeAnswerText(answer);
    return question.acceptedAnswers?.some((a) => normalizeAnswerText(a) === given) ? question.score : 0;
  }

  if (question.type === 'JAVA') {
    // A code question is worth its points only when the judge says every test case passed.
    // Length is not evidence of correctness — see the note in the git history for the
    // fallback that used to award full marks to any answer over 20 characters.
    return codePassed(question, answer) ? question.score : 0;
  }

  return 0;
};

export const calculateScore = (
  questions: ScorableQuestion[],
  answers: Record<string, any>,
  codePassed: CodePassedFn = trustStoredVerdict
): number => questions.reduce((total, q) => total + scoreQuestion(q, answers?.[q.id], codePassed), 0);

export const maxScore = (questions: ScorableQuestion[]): number =>
  questions.reduce((total, q) => total + (q.score || 0), 0);

// Identifies the exact text a judge verdict belongs to, so editing the code after it passed
// does not keep the mark. Not a security boundary (both sides compute it the same way) —
// the security is that only api/judge.ts can write a verdict row at all.
export const codeFingerprint = (code: string): string => {
  const text = String(code ?? '');
  // FNV-1a, 32-bit, hex. Small, dependency-free, and good enough to notice an edit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}_${hash.toString(16)}`;
};
