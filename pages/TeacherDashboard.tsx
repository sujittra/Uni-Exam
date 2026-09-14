import React, { useState, useEffect, useMemo } from 'react';
import { User, Exam, Question, QuestionType, StudentProgress, CodeLanguage, CodeInputMode } from '../types';
import { saveExam, deleteExam, getExamsForTeacher, getLiveProgress, importStudents, updateExamStatus, getExamResults, uploadExamImage, getStudents, recalculateExamScores, reopenStudentProgress, updateStudent, deleteStudents, assignMajorToStudents, isAssignedToStudent, StudentImportRow } from '../services/dataService';
import { examForStudent } from '../services/shuffle';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

interface TeacherDashboardProps {
  user: User;
  onLogout: () => void;
}

type SortOption = 'ID' | 'NAME' | 'SECTION' | 'STATUS' | 'PROGRESS';
type SortDirection = 'ASC' | 'DESC';

// HELPER: Normalize Answer Text (Duplicated from dataService for client-side rendering)
const normalizeAnswerText = (text: any) => {
    if (!text) return '';
    // Handle Object case (if coming from Java Answer Object)
    if (typeof text === 'object' && text.code) return String(text.code).toLowerCase().replace(/\s+/g, '');

    return String(text)
      .toLowerCase()
      .replace(/[\n\r]+/g, ',') // Convert newlines to commas
      .replace(/\s+/g, '');     // Remove all whitespace
  };

// Helper: Safe Extract Code
const getAnswerDisplay = (ans: any) => {
    if (typeof ans === 'object' && ans !== null) {
        if (ans.code) return ans.code;
        return JSON.stringify(ans);
    }
    return String(ans);
};

// Helper: Whether an answer earns points for a question (mirrors dataService.calculateScore)
const isAnswerCorrect = (q: Question, ans: any): boolean => {
    if (ans === undefined || ans === null || ans === '') return false;
    if (q.type === QuestionType.MULTIPLE_CHOICE) {
        return String(ans) === String(q.correctOptionIndex);
    }
    if (q.type === QuestionType.SHORT_ANSWER) {
        const studentAns = normalizeAnswerText(ans);
        return q.acceptedAnswers?.some(a => normalizeAnswerText(a) === studentAns) || false;
    }
    if (q.type === QuestionType.JAVA_CODE) {
        if (typeof ans === 'object' && ans.passed === true) return true;
        if (typeof ans === 'object' && ans.code && String(ans.code).length > 20) return true;
        if (typeof ans === 'string' && ans.length > 20) return true;
        return false;
    }
    return false;
};

// Roster CSV: `StudentID, Name, Section, Major` — Major is optional (4th column), and a
// header row is optional too. When a header IS present its column names decide the order,
// so a file exported with the columns rearranged still imports correctly.
const CSV_HEADER_ALIASES: Record<string, 'id' | 'name' | 'section' | 'major'> = {
  studentid: 'id', 'student id': 'id', id: 'id', รหัสนักศึกษา: 'id', รหัส: 'id',
  name: 'name', fullname: 'name', 'full name': 'name', ชื่อ: 'name', 'ชื่อ-สกุล': 'name',
  section: 'section', sectionid: 'section', 'section id': 'section', sec: 'section', กลุ่ม: 'section',
  major: 'major', programme: 'major', program: 'major', department: 'major', สาขา: 'major', สาขาวิชา: 'major',
};

// Splits one CSV line, honouring "quoted, fields" and "" escapes (Excel exports use them).
const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim());
};

const parseRosterCsv = (text: string): StudentImportRow[] => {
  // \uFEFF: Excel writes a BOM, which would otherwise glue itself to the first column name.
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  let order: ('id' | 'name' | 'section' | 'major')[] = ['id', 'name', 'section', 'major'];
  let startIndex = 0;
  const firstCells = splitCsvLine(lines[0]).map(c => c.toLowerCase());
  const mapped = firstCells.map(c => CSV_HEADER_ALIASES[c]);
  // Treat row 1 as a header only if every cell is a recognised column name — otherwise a
  // student legitimately named e.g. "Name" would silently lose their row.
  if (mapped.length > 1 && mapped.every(Boolean) && mapped.includes('id')) {
    order = mapped as typeof order;
    startIndex = 1;
  }

  return lines.slice(startIndex).map((line, i) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    order.forEach((key, idx) => { row[key] = cells[idx] || ''; });
    if (!row.id || !row.name) throw new Error(`บรรทัดที่ ${i + 1 + startIndex} ไม่มีรหัสนักศึกษาหรือชื่อ`);
    return {
      id: row.id,
      name: row.name,
      section: row.section || 'General',
      major: row.major || undefined,
    };
  });
};

// Helper: Is this code question set to "call the student's function" instead of stdin?
// Java has no harness for it, so the mode only takes effect for Python.
const isFunctionMode = (q: Question) => q.language === 'python3' && q.inputMode === 'function';

// Helper: Normalize a section name for case-insensitive comparison (e.g. "sec01" == "SEC01")
const normSection = (s?: string) => (s || '').trim().toUpperCase();

// Same idea for majors, which are free text typed by whoever imported the roster.
const normMajor = (s?: string) => (s || '').trim().toLowerCase();

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'EXAMS' | 'STUDENTS' | 'MONITOR'>('EXAMS');
  const [exams, setExams] = useState<Exam[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  
  // Editor State
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Import State
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState('');

  // Monitor State
  const [monitoringExamId, setMonitoringExamId] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<StudentProgress[]>([]);
  
  // Monitor Filters & Sort
  const [monitorSearch, setMonitorSearch] = useState('');
  const [monitorSortBy, setMonitorSortBy] = useState<SortOption>('ID');
  const [monitorSectionFilter, setMonitorSectionFilter] = useState<string>('ALL');
  
  // Review/Inspect Modal
  const [inspectStudentId, setInspectStudentId] = useState<string | null>(null);

  // Roster Sort / Filter / Paging
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterSortConfig, setRosterSortConfig] = useState<{ key: keyof User; direction: SortDirection }>({ key: 'studentId', direction: 'ASC' });
  const [rosterMajorFilter, setRosterMajorFilter] = useState<string>('ALL');
  const [rosterPageSize, setRosterPageSize] = useState(25);
  const [rosterPage, setRosterPage] = useState(1);

  // Roster selection & editing
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [editingStudent, setEditingStudent] = useState<User | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', section: '', major: '' });
  const [bulkMajor, setBulkMajor] = useState('');

  useEffect(() => {
    loadExams();
    loadStudents(); 
  }, []);

  // Polling for monitoring
  useEffect(() => {
    let interval: number;
    if (activeTab === 'MONITOR' && monitoringExamId) {
      const fetchData = async () => {
        const data = await getLiveProgress(monitoringExamId);
        setLiveData(data);
      };
      fetchData();
      interval = window.setInterval(fetchData, 2000); // 2s polling
    }
    return () => clearInterval(interval);
  }, [activeTab, monitoringExamId]);

  const loadExams = async () => {
    // Pass user.id to filter exams by owner
    const data = await getExamsForTeacher(user.id);
    setExams([...data]);
  };

  const loadStudents = async () => {
    // Pass user.id to filter students by owner
    const data = await getStudents(user.id);
    setStudents(data);
  };

  // ... (Exam Management Functions omitted for brevity, logic remains same) ...
  const handleCreateExam = () => {
    const newExam: Exam = {
      id: `e${Date.now()}`,
      title: 'Untitled Exam',
      description: '',
      assignedSections: [],
      durationMinutes: 60,
      isActive: false,
      createdBy: user.id, // Assign ownership to current teacher
      questions: []
    };
    setEditingExam(newExam);
  };

  const handleEditExam = (exam: Exam) => { setEditingExam(JSON.parse(JSON.stringify(exam))); };

  // Duplicate an exam into a fresh, closed copy and jump straight into editing it.
  // `exams` already has hidden test cases merged in (getExamsForTeacher does that), so the
  // copy keeps them; saveExam pushes them back out to the RLS-protected table under the
  // new question ids. Sections are deliberately cleared so a half-edited copy can't show
  // up for students alongside the original.
  const handleDuplicateExam = async (exam: Exam) => {
    const copy: Exam = {
      ...JSON.parse(JSON.stringify(exam)),
      id: `e${Date.now()}`, // temp id — saveExam treats this as "insert", not "update"
      title: `${exam.title} (สำเนา)`,
      isActive: false,
      assignedSections: [],
      createdBy: user.id,
    };
    setIsSaving(true);
    try {
      const saved = await saveExam(copy);
      // Re-read so the editor gets the copy's REAL question ids (saveExam always deletes +
      // reinserts questions, so the ids it echoes back are the originals').
      const fresh = await getExamsForTeacher(user.id);
      setExams([...fresh]);
      setEditingExam(fresh.find(e => e.id === saved.id) || saved);
    } catch (e: any) {
      alert("Duplicate failed: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };


  const handleDeleteExam = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this exam?")) {
       await deleteExam(id);
       loadExams();
    }
  };

  const handleSaveExam = async () => {
    if (!editingExam) return;
    if (!editingExam.title.trim()) return alert("Exam title is required");
    
    setIsSaving(true);
    try {
      // 1. Save the exam definition
      const savedExam = await saveExam(editingExam);
      
      // 2. Automatically Re-calculate scores for all students who took this exam
      //    (This ensures the DB scores match the new answer key immediately)
      await recalculateExamScores(savedExam.id);
      
      setEditingExam(null);
      loadExams();
    } catch (e: any) {
      alert("Error saving: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRecalculateScores = async (examId: string) => {
    if (!confirm("This will re-grade all students based on the current answer key. Continue?")) return;
    await recalculateExamScores(examId);
    alert("Scores updated successfully.");
  };

  const handleImportStudents = async () => {
    try {
      const data = parseRosterCsv(importText);
      if (data.length === 0) throw new Error("No rows found");
      // Pass user.id as the creator of these students
      await importStudents(user.id, data);
      setImportStatus(`สำเร็จ! นำเข้า ${data.length} รายชื่อ`);
      setImportText('');
      loadStudents();
    } catch (e: any) {
      setImportStatus(`ผิดพลาด: ${e.message}. รูปแบบที่ใช้ได้: StudentID, ชื่อ, Section, สาขา (สาขาใส่หรือไม่ใส่ก็ได้)`);
    }
  };

  // Import from a picked .csv file. The file's text lands in the same textarea so the
  // teacher can eyeball/fix it before committing — same parser either way.
  const handleCsvFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      const data = parseRosterCsv(text);
      setImportStatus(
        data.length > 0
          ? `อ่านไฟล์ "${file.name}" ได้ ${data.length} รายชื่อ — ตรวจสอบแล้วกด Import Data`
          : `ไฟล์ "${file.name}" ไม่มีข้อมูลที่อ่านได้`
      );
    } catch (e: any) {
      setImportStatus(`อ่านไฟล์ไม่สำเร็จ: ${e.message}`);
    }
  };

  const handleUpdateStudent = async () => {
    if (!editingStudent) return;
    if (!editDraft.name.trim()) return alert("ต้องมีชื่อนักศึกษา");
    try {
      await updateStudent(editingStudent.id, {
        name: editDraft.name.trim(),
        section: editDraft.section.trim(),
        major: editDraft.major.trim(),
      });
      setEditingStudent(null);
      loadStudents();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDeleteStudents = async (ids: string[]) => {
    if (ids.length === 0) return;
    const who = ids.length === 1
      ? students.find(s => s.id === ids[0])?.name || 'นักศึกษาคนนี้'
      : `${ids.length} คน`;
    if (!window.confirm(`ลบ ${who} ออกจาก Roster?\nประวัติการสอบทั้งหมดของนักศึกษาจะถูกลบไปด้วย และกู้คืนไม่ได้`)) return;
    try {
      await deleteStudents(ids);
      setSelectedStudentIds(prev => prev.filter(id => !ids.includes(id)));
      loadStudents();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleAssignMajor = async () => {
    const major = bulkMajor.trim();
    if (selectedStudentIds.length === 0) return;
    if (!major) return alert("กรุณาเลือกหรือพิมพ์ชื่อสาขาก่อน");
    try {
      await assignMajorToStudents(selectedStudentIds, major);
      setSelectedStudentIds([]);
      setBulkMajor('');
      loadStudents();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const toggleExamStatus = async (id: string, currentStatus: boolean) => {
    await updateExamStatus(id, !currentStatus);
    loadExams();
  };

  const handleExportResults = async (examId: string, title: string) => {
    const results = await getExamResults(examId);
    if (results.length === 0) {
      alert("No data to export or no student has started this exam yet.");
      return;
    }
    const headers = ["Student ID", "Name", "Section", "Total Score", "Max Score", "Status", "Last Update"];
    const csvContent = [
      headers.join(","),
      ...results.map(r => [
        `"${r.studentId}"`, `"${r.name}"`, `"${r.section}"`, r.totalScore, r.maxScore, `"${r.status}"`, `"${r.submittedAt}"`
      ].join(","))
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/\s+/g, '_')}_Scores.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImageUpload = async (qId: string, file: File | null) => {
    if(!file || !editingExam) return;
    try {
      const url = await uploadExamImage(file);
      updateQuestion(qId, { imageUrl: url });
    } catch (err: any) {
      alert("Upload failed: " + err.message);
    }
  };

  // --- EDITOR HELPERS ---
  const addQuestion = (type: QuestionType) => {
    if (!editingExam) return;
    const newQ: Question = {
      id: `q${Date.now()}`,
      type,
      text: 'New Question',
      score: 10,
      options: type === QuestionType.MULTIPLE_CHOICE ? ['Option 1', 'Option 2'] : undefined,
      correctOptionIndex: type === QuestionType.MULTIPLE_CHOICE ? 0 : undefined,
      testCases: type === QuestionType.JAVA_CODE ? [{ input: '', output: '' }] : undefined,
      language: type === QuestionType.JAVA_CODE ? 'java' : undefined,
      allowFileUpload: type === QuestionType.JAVA_CODE ? true : undefined,
      inputMode: type === QuestionType.JAVA_CODE ? 'stdin' : undefined,
      acceptedAnswers: type === QuestionType.SHORT_ANSWER ? [''] : undefined
    };
    setEditingExam({ ...editingExam, questions: [...editingExam.questions, newQ] });
  };
  const updateQuestion = (qId: string, updates: Partial<Question>) => {
    if (!editingExam) return;
    setEditingExam({
      ...editingExam,
      questions: editingExam.questions.map(q => q.id === qId ? { ...q, ...updates } : q)
    });
  };
  const removeQuestion = (qId: string) => {
    if (!editingExam) return;
    setEditingExam({
      ...editingExam,
      questions: editingExam.questions.filter(q => q.id !== qId)
    });
  };

  // --- SORTING HELPERS ---
  const handleRosterSort = (key: keyof User) => {
    setRosterSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'ASC' ? 'DESC' : 'ASC'
    }));
  };

  const getSortedRoster = useMemo(() => {
    const term = rosterSearch.trim().toLowerCase();
    let filtered = students.filter(s =>
      (!term ||
        s.name.toLowerCase().includes(term) ||
        s.studentId?.toLowerCase().includes(term) ||
        s.section?.toLowerCase().includes(term) ||
        s.major?.toLowerCase().includes(term)) &&
      (rosterMajorFilter === 'ALL' ||
        (rosterMajorFilter === 'NONE' ? !s.major : s.major === rosterMajorFilter))
    );

    return filtered.sort((a, b) => {
      const valA = (a[rosterSortConfig.key] || '').toString().toLowerCase();
      const valB = (b[rosterSortConfig.key] || '').toString().toLowerCase();
      if (valA < valB) return rosterSortConfig.direction === 'ASC' ? -1 : 1;
      if (valA > valB) return rosterSortConfig.direction === 'ASC' ? 1 : -1;
      return 0;
    });
  }, [students, rosterSearch, rosterSortConfig, rosterMajorFilter]);

  // Every major already in the roster — drives both the filter dropdown and the
  // bulk-assign picker, so an existing spelling can be reused instead of retyped.
  const knownMajors = useMemo(
    () => Array.from(new Set(students.map(s => s.major).filter((m): m is string => !!m))).sort(),
    [students]
  );

  const rosterTotalPages = Math.max(1, Math.ceil(getSortedRoster.length / rosterPageSize));
  // Clamp rather than store: deleting or filtering can strand the page number past the end.
  const rosterCurrentPage = Math.min(rosterPage, rosterTotalPages);
  const pagedRoster = getSortedRoster.slice(
    (rosterCurrentPage - 1) * rosterPageSize,
    rosterCurrentPage * rosterPageSize
  );

  // "Select all" acts on the whole filtered result, not just the visible page — assigning a
  // major to a search result of 300 students shouldn't need 12 page visits.
  const allFilteredSelected =
    getSortedRoster.length > 0 && getSortedRoster.every(s => selectedStudentIds.includes(s.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(getSortedRoster.map(s => s.id));
      setSelectedStudentIds(prev => prev.filter(id => !filteredIds.has(id)));
    } else {
      setSelectedStudentIds(prev => Array.from(new Set([...prev, ...getSortedRoster.map(s => s.id)])));
    }
  };

  const toggleSelectStudent = (id: string) => {
    setSelectedStudentIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const startEditStudent = (s: User) => {
    setEditingStudent(s);
    setEditDraft({ name: s.name, section: s.section || '', major: s.major || '' });
  };


  // --- MONITOR DATA PROCESSING ---
  const processedMonitorData = useMemo(() => {
    if (!monitoringExamId) return [];
    const exam = exams.find(e => e.id === monitoringExamId);
    if (!exam) return [];

    // 1. Filter students by assigned sections (case-insensitive)
    const eligibleStudents = students.filter(s =>
      exam.assignedSections.length === 0
        ? true
        : isAssignedToStudent(exam, s)
    );

    // 2. Merge with Live Data
    const merged = eligibleStudents.map(student => {
      const progress = liveData.find(p => p.studentId === student.studentId);
      
      // Calculate Progress %
      let percent = 0;
      let status = progress?.status || 'IDLE';
      let lastUpdated = progress?.lastUpdated || 0;
      let currentQ = progress?.currentQuestionIndex || -1;

      if (status === 'COMPLETED') {
        percent = 100;
        currentQ = exam.questions.length - 1;
      } else if (progress) {
        const answerCount = Object.keys(progress.answers || {}).length;
        const rawCount = Math.max(answerCount, (progress.currentQuestionIndex || 0));
        percent = Math.round((rawCount / exam.questions.length) * 100);
        if (percent > 100) percent = 100;
      }

      return {
        user: student,
        progress: progress,
        display: {
          percent,
          status,
          lastUpdated,
          currentQ
        }
      };
    });

    // 3. Filter
    const filtered = merged.filter(item => {
      const matchSearch = 
        item.user.name.toLowerCase().includes(monitorSearch.toLowerCase()) ||
        item.user.studentId?.includes(monitorSearch);
      
      const matchSection = monitorSectionFilter === 'ALL' || normSection(item.user.section) === normSection(monitorSectionFilter);
      
      return matchSearch && matchSection;
    });

    // 4. Sort
    return filtered.sort((a, b) => {
      switch (monitorSortBy) {
        case 'NAME': return a.user.name.localeCompare(b.user.name);
        case 'SECTION': return (a.user.section || '').localeCompare(b.user.section || '');
        case 'STATUS': {
           // Order: COMPLETED > IN_PROGRESS > IDLE
           const weight = (s: string) => s === 'COMPLETED' ? 3 : s === 'IN_PROGRESS' ? 2 : 1;
           return weight(b.display.status) - weight(a.display.status);
        }
        case 'PROGRESS': return b.display.percent - a.display.percent;
        case 'ID': default: return (a.user.studentId || '').localeCompare(b.user.studentId || '');
      }
    });

  }, [monitoringExamId, students, liveData, monitorSearch, monitorSortBy, monitorSectionFilter, exams]);

  // Majors present in the roster, for the exam editor's major picker.
  const uniqueMajors = useMemo(() => {
     const seen = new Map<string, string>();
     students.forEach(s => {
        if (s.major) {
           const key = normMajor(s.major);
           if (!seen.has(key)) seen.set(key, s.major!.trim());
        }
     });
     return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [students]);

  // Live count of who would actually get this exam under the current section + major
  // selection — makes the AND between the two pickers concrete before saving.
  const eligibleCount = useMemo(
     () => (editingExam ? students.filter(s => isAssignedToStudent(editingExam, s)).length : 0),
     [editingExam, students]
  );

  const uniqueSections = useMemo(() => {
     // Dedupe case-insensitively (e.g. "sec01" / "SEC01" / "Sec01" count as one), keeping the first-seen casing
     const seen = new Map<string, string>();
     students.forEach(s => {
        if (s.section) {
           const key = normSection(s.section);
           if (!seen.has(key)) seen.set(key, s.section!.trim());
        }
     });
     return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const monitoringExam = useMemo(() => exams.find(e => e.id === monitoringExamId), [exams, monitoringExamId]);

  const [reopeningStudentId, setReopeningStudentId] = useState<string | null>(null);

  const handleReopenStudent = async (studentId: string) => {
    if (!monitoringExamId) return;
    if (!window.confirm('Allow this student to edit their answers again?')) return;
    setReopeningStudentId(studentId);
    try {
      await reopenStudentProgress(studentId, monitoringExamId);
      const data = await getLiveProgress(monitoringExamId);
      setLiveData(data);
    } finally {
      setReopeningStudentId(null);
    }
  };

  // --- RENDER OVERALL STATS ---
  const renderQuestionStats = () => {
    if (!monitoringExamId) return null;
    const currentExam = exams.find(e => e.id === monitoringExamId);
    if (!currentExam) return null;

    // Filter only those who have submitted ANY answers in liveData (Active or Completed)
    const activeStudents = liveData.filter(p => p.answers && Object.keys(p.answers).length > 0);
    const totalActive = activeStudents.length;

    if (totalActive === 0) return (
       <Card className="mb-6 bg-purple-50 border-purple-100">
         <div className="text-center py-4 text-purple-400">Waiting for students to start answering...</div>
       </Card>
    );

    return (
      <Card title={`Overall Class Progress (Based on ${totalActive} active students)`} className="mb-6">
        <div className="space-y-4 max-h-60 overflow-y-auto pr-2">
           {currentExam.questions.map((q, idx) => {
              let correct = 0;
              let incorrect = 0;
              
              activeStudents.forEach(student => {
                 const ans = student.answers[q.id];
                 let isCorrect = false;

                 // Only check correctness if answer exists
                 if (ans !== undefined && ans !== null && ans !== "") {
                   if (q.type === QuestionType.MULTIPLE_CHOICE) {
                     isCorrect = String(ans) === String(q.correctOptionIndex);
                   } else if (q.type === QuestionType.SHORT_ANSWER) {
                     // USE FLEXIBLE GRADING (Same as dataService)
                     const studentAns = normalizeAnswerText(ans);
                     isCorrect = q.acceptedAnswers?.some(a => normalizeAnswerText(a) === studentAns) || false;
                   } else {
                     // JAVA GRADING (Updated)
                     if (typeof ans === 'object' && ans.passed === true) {
                        isCorrect = true;
                     } else if (typeof ans === 'string' && ans.length > 20) {
                        isCorrect = true; // Fallback
                     }
                   }
                 }
                 
                 // If Correct -> Increment Correct
                 // If Wrong OR Answer is Missing/Empty -> Increment Incorrect (Ensures bar is always full width)
                 if (isCorrect) correct++;
                 else incorrect++;
              });

              const pCorrect = (correct / totalActive) * 100;
              const pIncorrect = (incorrect / totalActive) * 100;
              
              return (
                <div key={q.id} className="flex items-center gap-4 text-sm">
                   <span className="w-8 font-bold text-gray-500">Q{idx+1}</span>
                   <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                      <div className="bg-green-500 h-full" style={{ width: `${pCorrect}%` }}></div>
                      <div className="bg-red-400 h-full" style={{ width: `${pIncorrect}%` }}></div>
                   </div>
                   <span className="text-xs text-gray-400 w-12 text-right">{Math.round(pCorrect)}%</span>
                </div>
              )
           })}
        </div>
        <div className="flex justify-center gap-4 mt-4 text-xs text-gray-500 border-t pt-2">
           <div className="flex items-center gap-1"><div className="w-2 h-2 bg-green-500 rounded-full"></div> Correct</div>
           <div className="flex items-center gap-1"><div className="w-2 h-2 bg-red-400 rounded-full"></div> Incorrect/Other</div>
        </div>
      </Card>
    );
 };

 const renderInspectModal = () => {
    if (!inspectStudentId || !monitoringExamId) return null;
    
    const student = students.find(s => s.studentId === inspectStudentId);
    const progress = liveData.find(p => p.studentId === inspectStudentId);
    const exam = exams.find(e => e.id === monitoringExamId);

    if (!student || !exam) return null;

    // The order this student actually saw. Nothing is stored for it — the order is derived
    // from their student id, so replaying examForStudent reproduces exactly what they got.
    const studentOrder = exam.shuffleQuestions && student.studentId
       ? examForStudent(exam, student.studentId).questions.map(q => q.id)
       : null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl animate-fade-in">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <div>
                       <h3 className="font-bold text-lg text-gray-800">{student.name} ({student.studentId})</h3>
                       {studentOrder && (
                          <p className="text-xs text-gray-400 mt-0.5">
                             ข้อสอบชุดนี้สลับลำดับ — รายการด้านล่างเรียงตามลำดับต้นฉบับของอาจารย์ และกำกับไว้ว่านักศึกษาคนนี้เห็นเป็นข้อที่เท่าไหร่
                          </p>
                       )}
                       <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${progress?.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                             {progress?.status || 'NOT STARTED'}
                          </span>
                          {(progress?.tabSwitchCount || 0) > 0 && (
                             <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-700">
                                ⚠️ Left exam view {progress!.tabSwitchCount}x
                             </span>
                          )}
                          {(progress?.captureAttemptCount || 0) > 0 && (
                             <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700" title="ตรวจพบการกดปุ่มจับภาพหน้าจอ (ตรวจได้เท่าที่เบราว์เซอร์มองเห็น)">
                                📸 Capture attempts {progress!.captureAttemptCount}x
                             </span>
                          )}
                       </div>
                    </div>
                    <button onClick={() => setInspectStudentId(null)} className="text-gray-400 hover:text-gray-600 font-bold text-xl px-2">&times;</button>
                </div>
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {progress ? (
                        exam.questions.map((q, idx) => {
                            const ans = progress.answers[q.id];
                            const correct = isAnswerCorrect(q, ans);
                            // Questions are listed in the teacher's own order. When the exam
                            // shuffles, also show where this question sat for THIS student, so
                            // "ข้อ 3 ผิดนะครับ" from a student maps to the right row.
                            const seenAt = studentOrder ? studentOrder.indexOf(q.id) + 1 : 0;
                            // MCQ answers are stored as the original option index; showing that
                            // bare number is unreadable, more so once choices are shuffled.
                            const isMcq = q.type === QuestionType.MULTIPLE_CHOICE;
                            const chosenText = isMcq && ans !== undefined && ans !== null && ans !== ''
                               ? q.options?.[Number(ans)]
                               : undefined;
                            return (
                                <div key={q.id} className="border-b pb-4 last:border-0">
                                    <div className="flex justify-between mb-2 gap-3">
                                        <span className="font-bold text-gray-700 text-sm">
                                           Q{idx+1}: {q.text}
                                           {seenAt > 0 && seenAt !== idx + 1 && (
                                              <span className="ml-2 font-normal text-xs text-gray-400 whitespace-nowrap">(นักศึกษาเห็นเป็นข้อที่ {seenAt})</span>
                                           )}
                                        </span>
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full h-fit whitespace-nowrap ${correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                                           {correct ? q.score : 0} / {q.score} pts
                                        </span>
                                    </div>
                                    {isMcq ? (
                                        <div className="space-y-1">
                                           <div className={`p-3 rounded-lg text-sm border ${correct ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
                                              <span className="text-xs font-bold uppercase opacity-60 mr-2">ตอบ</span>
                                              {chosenText !== undefined
                                                 ? <>{chosenText} <span className="text-xs opacity-50">(ตัวเลือกที่ {Number(ans) + 1})</span></>
                                                 : <span className="italic opacity-60">No answer provided</span>}
                                           </div>
                                           {!correct && q.correctOptionIndex !== undefined && (
                                              <div className="p-2 rounded-lg text-sm bg-gray-50 border border-gray-200 text-gray-600">
                                                 <span className="text-xs font-bold uppercase opacity-60 mr-2">เฉลย</span>
                                                 {q.options?.[q.correctOptionIndex]} <span className="text-xs opacity-50">(ตัวเลือกที่ {q.correctOptionIndex + 1})</span>
                                              </div>
                                           )}
                                        </div>
                                    ) : (
                                    <div className="bg-gray-50 p-3 rounded-lg text-sm font-mono whitespace-pre-wrap border border-gray-200">
                                        {ans ? getAnswerDisplay(ans) : <span className="text-gray-400 italic">No answer provided</span>}
                                    </div>
                                    )}
                                    {q.type === QuestionType.JAVA_CODE && typeof ans === 'object' && ans !== null && (
                                       <div className="mt-2 text-xs flex gap-4">
                                          <span className="text-gray-500 font-bold">
                                             {q.language === 'python3' ? '🐍 Python 3' : '☕ Java'}
                                          </span>
                                          <span className={`${ans.passed ? 'text-green-600' : 'text-red-500'} font-bold`}>
                                             Compiler: {ans.passed ? 'PASSED' : 'FAILED'}
                                          </span>
                                       </div>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-center text-gray-400 py-10">Student has not started the exam yet.</div>
                    )}
                </div>
                <div className="p-4 border-t bg-gray-50 rounded-b-2xl flex justify-end">
                    <Button onClick={() => setInspectStudentId(null)}>Close</Button>
                </div>
            </div>
        </div>
    );
 };

  // --- RENDER ---
  if (editingExam) {
     /* ... (Editor Code - Same as previous, omitted for brevity) ... */
     return (
        <div className="min-h-screen bg-gray-100 pb-20">
           {/* Re-using previous editor code structure exactly */}
           <div className="bg-white shadow sticky top-0 z-50 border-b border-gray-200">
              <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                 <h2 className="text-xl font-bold text-gray-800">Edit Exam</h2>
                 <div className="flex gap-2">
                   <Button variant="secondary" onClick={() => setEditingExam(null)} disabled={isSaving}>Cancel</Button>
                   <Button onClick={handleSaveExam} disabled={isSaving}>{isSaving ? 'Saving & Regrading...' : 'Save Changes'}</Button>
                 </div>
              </div>
           </div>
           <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
              <Card title="Exam Details">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="col-span-2">
                      <label className="text-sm font-medium text-gray-700">Exam Title</label>
                      <input className="w-full p-2 border rounded" value={editingExam.title} onChange={e => setEditingExam({...editingExam, title: e.target.value})} />
                   </div>
                   <div className="col-span-2">
                      <label className="text-sm font-medium text-gray-700">Description</label>
                      <textarea className="w-full p-2 border rounded" rows={2} value={editingExam.description} onChange={e => setEditingExam({...editingExam, description: e.target.value})} />
                   </div>
                   <div>
                      <label className="text-sm font-medium text-gray-700">Duration (Minutes)</label>
                      <input type="number" className="w-full p-2 border rounded" value={editingExam.durationMinutes} onChange={e => setEditingExam({...editingExam, durationMinutes: Number(e.target.value)})} />
                   </div>
                   <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                      <p className="text-sm font-medium text-gray-700">การสุ่มลำดับ <span className="text-xs text-gray-400 font-normal">Randomisation</span></p>
                      {/* Both orders are derived from each student's id, so they stay the same
                          across refreshes and resumes. Answers are stored against question ids
                          (and the original option index), so neither affects grading. */}
                      <label className="flex items-start gap-2 text-sm text-gray-600 cursor-pointer">
                         <input
                            type="checkbox"
                            className="mt-1"
                            checked={!!editingExam.shuffleQuestions}
                            onChange={e => setEditingExam({ ...editingExam, shuffleQuestions: e.target.checked })}
                         />
                         <span>
                            สลับลำดับข้อ
                            <span className="block text-xs text-gray-400">นักศึกษาแต่ละคนเห็นข้อ 1 ไม่เหมือนกัน — Each student gets their own question order</span>
                         </span>
                      </label>
                      <label className="flex items-start gap-2 text-sm text-gray-600 cursor-pointer">
                         <input
                            type="checkbox"
                            className="mt-1"
                            checked={!!editingExam.shuffleOptions}
                            onChange={e => setEditingExam({ ...editingExam, shuffleOptions: e.target.checked })}
                         />
                         <span>
                            สลับลำดับตัวเลือกของข้อ MCQ ทุกข้อ
                            <span className="block text-xs text-gray-400">ระวังข้อที่มีตัวเลือกแบบ "ถูกทุกข้อ" / "ไม่มีข้อถูก" — Shuffles every MCQ's choices</span>
                         </span>
                      </label>
                   </div>
                   <div>
                      <label className="text-sm font-medium text-gray-700">Assigned Sections</label>
                      {uniqueSections.length === 0 ? (
                         <p className="text-sm text-gray-400 mt-1">No sections found yet — import students in the Students tab first.</p>
                      ) : (
                         <div className="flex flex-wrap gap-2 mt-1">
                            {uniqueSections.map(sec => {
                               const isChecked = editingExam.assignedSections.some(a => normSection(a) === normSection(sec));
                               return (
                                  <label
                                     key={sec}
                                     className={`px-3 py-1.5 rounded-full border-2 text-sm cursor-pointer transition-colors select-none ${isChecked ? 'bg-purple-600 border-purple-600 text-white' : 'border-gray-200 text-gray-600 hover:border-purple-300'}`}
                                  >
                                     <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={isChecked}
                                        onChange={() => {
                                           const newSections = isChecked
                                              ? editingExam.assignedSections.filter(a => normSection(a) !== normSection(sec))
                                              : [...editingExam.assignedSections, sec];
                                           setEditingExam({ ...editingExam, assignedSections: newSections });
                                        }}
                                     />
                                     {sec}
                                  </label>
                               );
                            })}
                         </div>
                      )}
                   </div>
                   <div>
                      <label className="text-sm font-medium text-gray-700">Assigned สาขา <span className="text-xs text-gray-400 font-normal">(ไม่เลือก = ทุกสาขา)</span></label>
                      {/* ANDed with the sections above: a student must match a selected section
                          AND a selected major. Leaving this empty means "any major". */}
                      {uniqueMajors.length === 0 ? (
                         <p className="text-sm text-gray-400 mt-1">ยังไม่มีข้อมูลสาขาใน Roster — เพิ่มสาขาให้นักศึกษาในแท็บ Roster ก่อน</p>
                      ) : (
                         <>
                           <div className="flex flex-wrap gap-2 mt-1">
                              {uniqueMajors.map(major => {
                                 const isChecked = (editingExam.assignedMajors || []).some(a => normMajor(a) === normMajor(major));
                                 return (
                                    <label
                                       key={major}
                                       className={`px-3 py-1.5 rounded-full border-2 text-sm cursor-pointer transition-colors select-none ${isChecked ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}
                                    >
                                       <input
                                          type="checkbox"
                                          className="hidden"
                                          checked={isChecked}
                                          onChange={() => {
                                             const current = editingExam.assignedMajors || [];
                                             const newMajors = isChecked
                                                ? current.filter(a => normMajor(a) !== normMajor(major))
                                                : [...current, major];
                                             setEditingExam({ ...editingExam, assignedMajors: newMajors });
                                          }}
                                       />
                                       {major}
                                    </label>
                                 );
                              })}
                           </div>
                           {(editingExam.assignedMajors || []).length > 0 && (
                              <p className="text-xs text-gray-500 mt-2">
                                 เห็นข้อสอบนี้ {eligibleCount} คน — ต้องอยู่ใน Section ที่เลือก <strong>และ</strong> สาขาที่เลือก
                              </p>
                           )}
                         </>
                      )}
                   </div>
                </div>
              </Card>
              <div className="space-y-4">
                 <div className="flex justify-between items-end">
                    <h3 className="text-lg font-bold text-gray-700">Questions ({editingExam.questions.length})</h3>
                    <div className="flex gap-2 text-sm">
                      <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.MULTIPLE_CHOICE)}>+ MCQ</Button>
                      <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.SHORT_ANSWER)}>+ Short Answer</Button>
                      <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.JAVA_CODE)}>+ Code (Java/Python)</Button>
                    </div>
                 </div>
                 {editingExam.questions.map((q, idx) => (
                    <Card key={q.id} className="relative group">
                       <div className="absolute right-4 top-4 opacity-100 transition-opacity">
                          <button onClick={() => removeQuestion(q.id)} className="text-red-400 hover:text-red-600 font-medium text-sm">Delete</button>
                       </div>
                       <div className="flex gap-4 items-start">
                          <span className="bg-purple-100 text-purple-700 font-bold px-3 py-1 rounded text-sm mt-1">Q{idx+1}</span>
                          <div className="flex-1 space-y-4">
                             <div className="flex gap-4 items-start">
                               <div className="flex-1 space-y-2">
                                  <textarea className="w-full p-2 border border-gray-300 rounded font-medium h-24" value={q.text} onChange={(e) => updateQuestion(q.id, { text: e.target.value })} placeholder="Question text..."/>
                                  {q.imageUrl ? (
                                    <div className="flex items-center gap-4">
                                       <img src={q.imageUrl} alt="Question" className="h-16 w-16 object-cover rounded border" />
                                       <button onClick={() => updateQuestion(q.id, { imageUrl: '' })} className="text-xs text-red-500 font-bold">Remove Image</button>
                                    </div>
                                 ) : (
                                    <input type="file" accept="image/*" onChange={(e) => handleImageUpload(q.id, e.target.files?.[0] || null)} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"/>
                                 )}
                               </div>
                               <div className="w-24"><input type="number" className="w-full p-2 border border-gray-300 rounded text-center" value={q.score} onChange={(e) => updateQuestion(q.id, { score: Number(e.target.value) })} placeholder="Score"/></div>
                             </div>
                             {q.type === QuestionType.MULTIPLE_CHOICE && (
                               <div className="space-y-2 bg-gray-50 p-3 rounded">
                                 {q.options?.map((opt, oIdx) => (
                                   <div key={oIdx} className="flex items-center gap-2">
                                      <input type="radio" name={`correct_${q.id}`} checked={q.correctOptionIndex === oIdx} onChange={() => updateQuestion(q.id, { correctOptionIndex: oIdx })}/>
                                      <input className="flex-1 p-1 border rounded text-sm" value={opt} onChange={(e) => { const newOpts = [...(q.options || [])]; newOpts[oIdx] = e.target.value; updateQuestion(q.id, { options: newOpts }); }}/>
                                      <button onClick={() => { const newOpts = q.options?.filter((_, i) => i !== oIdx); updateQuestion(q.id, { options: newOpts, correctOptionIndex: 0 }); }} className="text-gray-400">×</button>
                                   </div>
                                 ))}
                                 <Button size="sm" variant="secondary" onClick={() => updateQuestion(q.id, { options: [...(q.options||[]), `Option ${(q.options?.length||0)+1}`] })}>+ Add Option</Button>
                               </div>
                             )}
                             {q.type === QuestionType.SHORT_ANSWER && (
                               <div className="space-y-2 bg-gray-50 p-3 rounded">
                                  <p className="text-xs font-bold text-gray-500 uppercase">Accepted Answers</p>
                                  <textarea className="w-full p-2 border rounded text-sm" placeholder="Enter acceptable answers separated by commas" value={q.acceptedAnswers?.join(', ')} onChange={(e) => updateQuestion(q.id, { acceptedAnswers: e.target.value.split(',').map(s => s.trim()) })} />
                               </div>
                             )}
                             {q.type === QuestionType.JAVA_CODE && (
                               <div className="space-y-2 bg-blue-50 p-3 rounded border border-blue-100">
                                  <div className="flex items-center justify-between">
                                     <p className="text-xs font-bold text-blue-700 uppercase">Test Cases</p>
                                     <div className="flex items-center gap-4">
                                        <label className="flex items-center gap-1 text-xs font-bold text-blue-700 uppercase cursor-pointer">
                                           <input
                                              type="checkbox"
                                              checked={q.allowFileUpload !== false}
                                              onChange={(e) => updateQuestion(q.id, { allowFileUpload: e.target.checked })}
                                           />
                                           Allow File Upload
                                        </label>
                                        <div className="flex items-center gap-2">
                                           <label className="text-xs font-bold text-blue-700 uppercase">Language</label>
                                           <select
                                              className="p-1 border rounded text-sm bg-white"
                                              value={q.language || 'java'}
                                              onChange={(e) => updateQuestion(q.id, { language: e.target.value as CodeLanguage })}
                                           >
                                              <option value="java">Java</option>
                                              <option value="python3">Python 3</option>
                                           </select>
                                        </div>
                                        {/* 'function' mode compiles the call expression into the source, which only
                                            the Python harness knows how to build — so it's offered for Python only. */}
                                        {q.language === 'python3' && (
                                          <div className="flex items-center gap-2">
                                             <label className="text-xs font-bold text-blue-700 uppercase">Test Input</label>
                                             <select
                                                className="p-1 border rounded text-sm bg-white"
                                                value={q.inputMode || 'stdin'}
                                                onChange={(e) => updateQuestion(q.id, { inputMode: e.target.value as CodeInputMode })}
                                             >
                                                <option value="stdin">stdin</option>
                                                <option value="function">Function call</option>
                                             </select>
                                          </div>
                                        )}
                                     </div>
                                  </div>
                                  {isFunctionMode(q) && (
                                    <div className="bg-white border border-blue-200 rounded p-2 text-xs text-gray-600">
                                       <p>ช่องซ้ายคือ <strong>ประโยคเรียกฟังก์ชัน</strong> เช่น <code className="bg-gray-100 px-1 rounded">rectangle_area(4, 5)</code> — นักศึกษาเขียนแค่ตัวฟังก์ชัน ระบบจะเรียกให้เอง และรับได้ทั้งแบบ <code className="bg-gray-100 px-1 rounded">return</code> ค่า หรือ <code className="bg-gray-100 px-1 rounded">print</code> ออกมา</p>
                                       <p className="text-gray-400 mt-0.5">The left field is a call expression, not stdin. Students write only the function; both returning and printing the answer pass.</p>
                                    </div>
                                  )}
                                  {q.testCases?.map((tc, tcIdx) => (
                                    <div key={tcIdx} className="grid grid-cols-2 gap-2 mb-2">
                                       <input className="p-1 border rounded text-sm font-mono" placeholder={isFunctionMode(q) ? "Call e.g. rectangle_area(4, 5)" : "Input"} value={tc.input} onChange={(e) => { const newTC = [...(q.testCases || [])]; newTC[tcIdx] = { ...newTC[tcIdx], input: e.target.value }; updateQuestion(q.id, { testCases: newTC }); }} />
                                       <div className="flex gap-1 items-center">
                                          <input className="flex-1 p-1 border rounded text-sm font-mono" placeholder="Output" value={tc.output} onChange={(e) => { const newTC = [...(q.testCases || [])]; newTC[tcIdx] = { ...newTC[tcIdx], output: e.target.value }; updateQuestion(q.id, { testCases: newTC }); }} />
                                          <label className="flex items-center gap-1 text-xs text-blue-700 font-bold whitespace-nowrap cursor-pointer" title="Hide this test case's input/expected/actual from students; it still counts toward grading">
                                             <input type="checkbox" checked={!!tc.hidden} onChange={(e) => { const newTC = [...(q.testCases || [])]; newTC[tcIdx] = { ...newTC[tcIdx], hidden: e.target.checked }; updateQuestion(q.id, { testCases: newTC }); }} />
                                             Hidden
                                          </label>
                                          <button onClick={() => { const newTC = q.testCases?.filter((_, i) => i !== tcIdx); updateQuestion(q.id, { testCases: newTC }); }} className="text-red-400 font-bold px-2">×</button>
                                       </div>
                                    </div>
                                  ))}
                                  <Button size="sm" variant="secondary" onClick={() => updateQuestion(q.id, { testCases: [...(q.testCases||[]), {input:'', output:''}] })}>+ Add Test Case</Button>
                               </div>
                             )}
                          </div>
                       </div>
                    </Card>
                 ))}
              </div>
           </div>
        </div>
     );
  }

  // --- STANDARD DASHBOARD VIEW ---

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-purple-700 text-white shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">UniExam Manager</h1>
            <span className="bg-purple-600 px-3 py-1 rounded-full text-xs text-purple-100 uppercase">{user.name}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('EXAMS')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'EXAMS' ? 'bg-white text-purple-700' : 'text-purple-100 hover:bg-purple-600'}`}>Exams</button>
            <button onClick={() => setActiveTab('STUDENTS')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'STUDENTS' ? 'bg-white text-purple-700' : 'text-purple-100 hover:bg-purple-600'}`}>Roster</button>
            <button onClick={() => setActiveTab('MONITOR')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'MONITOR' ? 'bg-white text-purple-700' : 'text-purple-100 hover:bg-purple-600'}`}>Monitor</button>
            <div className="w-px h-8 bg-purple-500 mx-2"></div>
            <button onClick={onLogout} className="text-purple-200 hover:text-white text-sm font-medium">Logout</button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 flex-1">
        
        {activeTab === 'EXAMS' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">My Exams</h2>
              <Button onClick={handleCreateExam}>+ New Exam</Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {exams.map(exam => (
                <Card key={exam.id} title={exam.title} className="hover:shadow-xl transition-shadow flex flex-col h-full">
                  <div className="flex-1 space-y-3">
                    <p className="text-sm text-gray-600 line-clamp-2">{exam.description || 'No description provided.'}</p>
                    <div className="flex flex-wrap gap-2">
                      {exam.assignedSections.map(sec => <span key={sec} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">Group: {sec}</span>)}
                      {(exam.assignedMajors || []).map(major => <span key={major} className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded">สาขา: {major}</span>)}
                    </div>
                  </div>
                  <div className="pt-4 mt-4 border-t border-gray-100 space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${exam.isActive ? 'bg-green-500' : 'bg-red-300'}`}></span>
                        <span className="text-sm font-medium text-gray-600">{exam.isActive ? 'Active' : 'Closed'}</span>
                      </div>
                      <span className="text-xs text-gray-400">{exam.questions.length} Questions</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant={exam.isActive ? 'danger' : 'secondary'} onClick={() => toggleExamStatus(exam.id, exam.isActive)}>{exam.isActive ? 'Close' : 'Open'}</Button>
                      <Button size="sm" variant="primary" onClick={() => handleEditExam(exam)}>Edit / Manage</Button>
                      <Button size="sm" variant="outline" className="col-span-2" onClick={() => { setMonitoringExamId(exam.id); setActiveTab('MONITOR'); }}>Monitor Students</Button>
                      <button
                        onClick={() => handleDuplicateExam(exam)}
                        disabled={isSaving}
                        title="สร้างสำเนาข้อสอบชุดนี้เพื่อนำไปแก้เป็นอีกชุด"
                        className="col-span-2 text-sm text-gray-600 hover:bg-gray-50 py-1 rounded border border-gray-200 disabled:opacity-50"
                      >
                        📋 Duplicate
                      </button>
                      <button onClick={() => handleExportResults(exam.id, exam.title)} className="col-span-2 text-sm text-purple-600 hover:bg-purple-50 py-1 rounded border border-purple-200">📄 Export Scores</button>
                      <button onClick={() => handleRecalculateScores(exam.id)} className="col-span-2 text-xs text-blue-500 hover:text-blue-700 mt-1 font-medium">↺ Re-grade Scores</button>
                      <button onClick={() => handleDeleteExam(exam.id)} className="col-span-2 text-xs text-red-400 hover:text-red-600 mt-1">Delete Exam</button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'STUDENTS' && (
          <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
            {/* Shared by the bulk-assign field and the edit-student modal */}
            <datalist id="known-majors">
               {knownMajors.map(m => <option key={m} value={m} />)}
            </datalist>
            <Card title="Batch Import Students">
              <div className="space-y-4">
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 space-y-1">
                   <p className="text-sm text-yellow-800">รูปแบบ: <code>StudentID, ชื่อ, Section, สาขา</code> — ช่องสาขาจะใส่หรือไม่ใส่ก็ได้</p>
                   <p className="text-xs text-yellow-700">Format: <code>StudentID, Name, Section, Major</code> — Major is optional. A header row (e.g. <code>studentId,name,section,major</code>) is detected automatically.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                   <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-purple-200 text-purple-700 text-sm font-medium cursor-pointer hover:bg-purple-50">
                      📂 เลือกไฟล์ CSV
                      <input
                         type="file"
                         accept=".csv,text/csv"
                         className="hidden"
                         onChange={(e) => { handleCsvFile(e.target.files?.[0] || null); e.target.value = ''; }}
                      />
                   </label>
                   <span className="text-xs text-gray-400">หรือวางข้อมูลลงในช่องด้านล่างโดยตรง</span>
                </div>
                <textarea className="w-full h-32 p-4 border border-gray-300 rounded-lg font-mono text-sm" placeholder="Paste CSV data here..." value={importText} onChange={(e) => setImportText(e.target.value)}></textarea>
                <div className="flex justify-between items-center gap-4">
                  <span className="text-sm font-medium text-green-600">{importStatus}</span>
                  <Button onClick={handleImportStudents}>Import Data</Button>
                </div>
              </div>
            </Card>

            <Card title={`Student Roster (${students.length})`}>
              <div className="p-4 bg-gray-50 border-b space-y-3">
                 <div className="flex flex-wrap items-center gap-3">
                    <input
                       type="text"
                       placeholder="ค้นหาจากชื่อ, รหัสนักศึกษา, Section หรือสาขา..."
                       className="flex-1 min-w-[240px] p-2 border rounded text-sm"
                       value={rosterSearch}
                       onChange={(e) => { setRosterSearch(e.target.value); setRosterPage(1); }}
                    />
                    <select
                       className="p-2 border rounded text-sm bg-white"
                       value={rosterMajorFilter}
                       onChange={(e) => { setRosterMajorFilter(e.target.value); setRosterPage(1); }}
                    >
                       <option value="ALL">ทุกสาขา</option>
                       <option value="NONE">ยังไม่ระบุสาขา</option>
                       {knownMajors.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                       <label className="text-xs text-gray-500 whitespace-nowrap">แสดง</label>
                       <select
                          className="p-2 border rounded text-sm bg-white"
                          value={rosterPageSize}
                          onChange={(e) => { setRosterPageSize(Number(e.target.value)); setRosterPage(1); }}
                       >
                          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} แถว</option>)}
                       </select>
                    </div>
                 </div>

                 {selectedStudentIds.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 bg-purple-50 border border-purple-200 rounded-lg p-3">
                       <span className="text-sm font-medium text-purple-800">เลือกแล้ว {selectedStudentIds.length} คน</span>
                       <input
                          list="known-majors"
                          className="p-2 border rounded text-sm flex-1 min-w-[200px]"
                          placeholder="พิมพ์ชื่อสาขา หรือเลือกจากที่มีอยู่"
                          value={bulkMajor}
                          onChange={(e) => setBulkMajor(e.target.value)}
                       />
                       <Button size="sm" onClick={handleAssignMajor}>กำหนดสาขา</Button>
                       <button
                          onClick={() => handleDeleteStudents(selectedStudentIds)}
                          className="text-sm text-red-500 hover:text-red-700 font-medium px-2"
                       >
                          ลบที่เลือก
                       </button>
                       <button onClick={() => setSelectedStudentIds([])} className="text-sm text-gray-500 hover:text-gray-700 px-2">
                          ยกเลิกการเลือก
                       </button>
                    </div>
                 )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500">
                   <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                     <tr>
                       <th className="px-4 py-3 w-10">
                          <input
                             type="checkbox"
                             checked={allFilteredSelected}
                             onChange={toggleSelectAllFiltered}
                             title="เลือกทั้งหมดตามผลการค้นหา/ตัวกรองปัจจุบัน"
                          />
                       </th>
                       <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleRosterSort('studentId')}>
                          Student ID {rosterSortConfig.key === 'studentId' && (rosterSortConfig.direction === 'ASC' ? '▲' : '▼')}
                       </th>
                       <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleRosterSort('name')}>
                          Name {rosterSortConfig.key === 'name' && (rosterSortConfig.direction === 'ASC' ? '▲' : '▼')}
                       </th>
                       <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleRosterSort('section')}>
                          Section {rosterSortConfig.key === 'section' && (rosterSortConfig.direction === 'ASC' ? '▲' : '▼')}
                       </th>
                       <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleRosterSort('major')}>
                          สาขา {rosterSortConfig.key === 'major' && (rosterSortConfig.direction === 'ASC' ? '▲' : '▼')}
                       </th>
                       <th className="px-6 py-3 text-right">จัดการ</th>
                     </tr>
                   </thead>
                   <tbody>
                     {pagedRoster.length === 0 ? (
                       <tr><td colSpan={6} className="px-6 py-4 text-center">No students found.</td></tr>
                     ) : (
                       pagedRoster.map(s => (
                         <tr key={s.id} className={`border-b hover:bg-gray-50 transition-colors ${selectedStudentIds.includes(s.id) ? 'bg-purple-50' : 'bg-white'}`}>
                           <td className="px-4 py-4">
                              <input type="checkbox" checked={selectedStudentIds.includes(s.id)} onChange={() => toggleSelectStudent(s.id)} />
                           </td>
                           <td className="px-6 py-4 font-bold">{s.studentId}</td>
                           <td className="px-6 py-4">{s.name}</td>
                           <td className="px-6 py-4"><span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">{s.section || 'N/A'}</span></td>
                           <td className="px-6 py-4">
                              {s.major
                                ? <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">{s.major}</span>
                                : <span className="text-xs text-gray-300">—</span>}
                           </td>
                           <td className="px-6 py-4 text-right whitespace-nowrap">
                              <button onClick={() => startEditStudent(s)} className="text-purple-600 hover:text-purple-800 text-xs font-medium px-2">แก้ไข</button>
                              <button onClick={() => handleDeleteStudents([s.id])} className="text-red-400 hover:text-red-600 text-xs font-medium px-2">ลบ</button>
                           </td>
                         </tr>
                       ))
                     )}
                   </tbody>
                </table>
              </div>

              {getSortedRoster.length > 0 && (
                 <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t bg-gray-50 text-sm">
                    <span className="text-gray-500">
                       แสดง {(rosterCurrentPage - 1) * rosterPageSize + 1}–{Math.min(rosterCurrentPage * rosterPageSize, getSortedRoster.length)} จาก {getSortedRoster.length} รายชื่อ
                    </span>
                    <div className="flex items-center gap-2">
                       <button
                          onClick={() => setRosterPage(rosterCurrentPage - 1)}
                          disabled={rosterCurrentPage <= 1}
                          className="px-3 py-1 rounded border bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                       >
                          ← ก่อนหน้า
                       </button>
                       <span className="text-gray-600">หน้า {rosterCurrentPage} / {rosterTotalPages}</span>
                       <button
                          onClick={() => setRosterPage(rosterCurrentPage + 1)}
                          disabled={rosterCurrentPage >= rosterTotalPages}
                          className="px-3 py-1 rounded border bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                       >
                          ถัดไป →
                       </button>
                    </div>
                 </div>
              )}
            </Card>
          </div>
        )}

        {activeTab === 'MONITOR' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4 justify-between">
              <div className="flex items-center gap-4">
                 <h2 className="text-2xl font-bold text-gray-800">Live Monitor</h2>
                 <select className="p-2 border rounded-lg bg-white shadow-sm font-medium" value={monitoringExamId || ''} onChange={(e) => setMonitoringExamId(e.target.value)}>
                   <option value="">-- Select Exam --</option>
                   {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                 </select>
              </div>
            </div>

            {!monitoringExamId ? (
              <div className="text-center py-20 text-gray-400 border-2 border-dashed border-gray-300 rounded-xl">Select an exam to view real-time student activity.</div>
            ) : (
              <div>
                 {/* Monitor Toolbar */}
                 <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-wrap gap-4 items-center">
                    <input 
                      type="text" 
                      placeholder="Search Name or ID..." 
                      className="p-2 border rounded-lg flex-1 min-w-[200px]"
                      value={monitorSearch}
                      onChange={(e) => setMonitorSearch(e.target.value)}
                    />
                    
                    <select 
                      className="p-2 border rounded-lg"
                      value={monitorSectionFilter}
                      onChange={(e) => setMonitorSectionFilter(e.target.value)}
                    >
                      <option value="ALL">All Sections</option>
                      {uniqueSections.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                    </select>

                    <div className="flex items-center gap-2 text-sm text-gray-600">
                       <span>Sort By:</span>
                       <select 
                          className="p-2 border rounded-lg font-medium"
                          value={monitorSortBy}
                          onChange={(e) => setMonitorSortBy(e.target.value as SortOption)}
                        >
                          <option value="ID">Student ID</option>
                          <option value="NAME">Name</option>
                          <option value="SECTION">Section</option>
                          <option value="STATUS">Status</option>
                          <option value="PROGRESS">Progress %</option>
                        </select>
                    </div>
                 </div>

                 {renderQuestionStats()}

                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                   {processedMonitorData.length === 0 && (
                     <p className="text-gray-500 col-span-3 text-center py-10">No students match your filter.</p>
                   )}
                   
                   {processedMonitorData.map(({ user, progress, display }) => {
                     const isIdle = display.status === 'IDLE';
                     const timeRemainingMs = progress?.startedAt && monitoringExam
                        ? monitoringExam.durationMinutes * 60000 - (Date.now() - progress.startedAt)
                        : 0;
                     const canReopen = display.status === 'COMPLETED' && timeRemainingMs > 0;

                     return (
                       <div key={user.studentId} className={`rounded-lg p-4 shadow border flex flex-col gap-3 transition-colors relative group/card cursor-pointer hover:shadow-md ${isIdle ? 'bg-gray-50 border-gray-200 opacity-75' : 'bg-white border-gray-200'}`} onClick={() => setInspectStudentId(user.studentId || null)}>
                         <div className="flex justify-between items-start">
                           <div>
                             <h4 className="font-bold text-gray-900">{user.name}</h4>
                             <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs font-mono bg-gray-100 px-1 rounded">{user.studentId}</span>
                                <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">{user.section || 'N/A'}</span>
                             </div>
                           </div>
                           <span className={`px-2 py-1 text-xs rounded-full h-fit font-bold border 
                             ${display.status === 'COMPLETED' ? 'bg-green-100 text-green-700 border-green-200' : 
                               display.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                             {display.status === 'IDLE' ? 'NOT STARTED' : display.status}
                           </span>
                         </div>
                         
                         <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                           <div className={`h-2.5 rounded-full transition-all duration-500 ${display.status === 'COMPLETED' ? 'bg-green-500' : 'bg-purple-600'}`} style={{ width: `${display.percent}%` }}></div>
                         </div>
                         
                         <div className="flex justify-between text-xs text-gray-500 font-medium">
                           <span>{display.percent}% Done</span>
                           <span>{isIdle ? '-' : `Q: ${display.currentQ + 1}`}</span>
                         </div>

                         {(progress?.tabSwitchCount || 0) > 0 && (
                           <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 w-fit">
                             ⚠️ Left exam view {progress!.tabSwitchCount}x
                           </div>
                         )}

                         {(progress?.captureAttemptCount || 0) > 0 && (
                           <div className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1 w-fit" title="ตรวจพบการกดปุ่มจับภาพหน้าจอ (ตรวจได้เท่าที่เบราว์เซอร์มองเห็น)">
                             📸 Capture attempts {progress!.captureAttemptCount}x
                           </div>
                         )}

                         {canReopen && (
                           <button
                             onClick={(e) => { e.stopPropagation(); handleReopenStudent(user.studentId!); }}
                             disabled={reopeningStudentId === user.studentId}
                             className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition-colors disabled:opacity-50"
                           >
                             {reopeningStudentId === user.studentId ? 'Reopening...' : `↺ Allow Edit (${Math.ceil(timeRemainingMs / 60000)}m left)`}
                           </button>
                         )}

                         <div className="text-xs text-right text-gray-400 mt-1 border-t pt-2 flex justify-between items-center">
                           <span className="text-purple-500 font-bold opacity-0 group-hover/card:opacity-100 transition-opacity">Click to Inspect</span>
                           <span>{isIdle ? 'Waiting...' : `Last Active: ${new Date(display.lastUpdated).toLocaleTimeString()}`}</span>
                         </div>
                       </div>
                     );
                   })}
                 </div>
              </div>
            )}
          </div>
        )}
        
        {/* INSPECT MODAL */}
        {renderInspectModal()}

        {/* EDIT STUDENT MODAL */}
        {editingStudent && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl animate-fade-in">
              <h2 className="text-xl font-bold text-gray-900 mb-0.5">แก้ไขข้อมูลนักศึกษา</h2>
              <p className="text-xs text-gray-400 mb-4">Edit student details</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">Student ID</label>
                  {/* Read-only: student_id is the login key and the FK student_progress rows
                      point at, so editing it would orphan every attempt they've made. */}
                  <input className="w-full p-2 border rounded bg-gray-100 text-gray-500" value={editingStudent.studentId || ''} disabled />
                  <p className="text-xs text-gray-400 mt-0.5">รหัสนักศึกษาแก้ไม่ได้ (ใช้เป็นรหัสเข้าสอบและผูกกับประวัติการสอบ) — ถ้าผิดให้ลบแล้วนำเข้าใหม่</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">ชื่อ</label>
                  <input className="w-full p-2 border rounded" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">Section</label>
                  <input className="w-full p-2 border rounded" value={editDraft.section} onChange={(e) => setEditDraft({ ...editDraft, section: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">สาขา</label>
                  <input list="known-majors" className="w-full p-2 border rounded" value={editDraft.major} onChange={(e) => setEditDraft({ ...editDraft, major: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <Button variant="secondary" onClick={() => setEditingStudent(null)}>ยกเลิก</Button>
                <Button onClick={handleUpdateStudent}>บันทึก</Button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
};