import { Exam } from '../types';

// How long a student actually has, once the exam's penalty for leaving the exam view is
// taken off. Shared so the student's countdown and the teacher's monitor can never
// disagree about how much time somebody has left.

type TimedExam = Pick<Exam, 'durationMinutes' | 'tabSwitchLimit' | 'tabSwitchPenaltyMinutes'>;

/**
 * Minutes deducted for leaving the exam view more often than the exam allows. The first
 * `tabSwitchLimit` exits are free; every one after that costs `tabSwitchPenaltyMinutes`.
 */
export const timePenaltyMinutes = (exam: TimedExam, tabSwitchCount = 0): number => {
  const perExit = Math.max(0, exam.tabSwitchPenaltyMinutes || 0);
  if (perExit === 0) return 0; // penalty switched off — the limit alone does nothing
  const free = Math.max(0, exam.tabSwitchLimit || 0);
  return Math.max(0, tabSwitchCount - free) * perExit;
};

/** The exam's duration in seconds for this student, penalties included. Never negative. */
export const effectiveDurationSeconds = (exam: TimedExam, tabSwitchCount = 0): number =>
  Math.max(0, exam.durationMinutes * 60 - timePenaltyMinutes(exam, tabSwitchCount) * 60);
