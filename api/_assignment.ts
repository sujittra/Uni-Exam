// Who an exam is for. Shared, like _scoring.ts: api/db.ts decides which exams a student is
// allowed to receive at all, and the teacher's dashboard shows the same answer when it
// previews who an exam will reach. Plain TypeScript, no Node imports.

export interface Assignable {
  assignedSections: string[];
  assignedMajors?: string[];
}

export interface Assignee {
  section?: string;
  major?: string;
}

// "sec01", "SEC01" and " Sec01 " are the same section.
const normSection = (s?: string) => (s || '').trim().toUpperCase();
const normMajor = (m?: string) => (m || '').trim().toLowerCase();

// Majors are ANDed with sections and are optional: an exam that lists no majors is open to
// every major, so an empty list must never exclude anyone.
export const isAssignedToStudent = (exam: Assignable, student: Assignee): boolean => {
  const sections = exam.assignedSections || [];
  if (!sections.some((a) => normSection(a) === normSection(student.section))) return false;
  const majors = exam.assignedMajors || [];
  if (majors.length === 0) return true;
  return majors.some((m) => normMajor(m) === normMajor(student.major));
};
