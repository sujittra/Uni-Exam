import React, { useState, useEffect, useMemo } from 'react';
import { User, Exam, Question, QuestionType, StudentProgress } from '../types';
import { saveExam, deleteExam, getExamsForTeacher, getLiveProgress, importStudents, updateExamStatus, getExamResults, uploadExamImage, getStudents } from '../services/dataService';
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
    return String(text)
      .toLowerCase()
      .replace(/[\n\r]+/g, ',') // Convert newlines to commas
      .replace(/\s+/g, '');     // Remove all whitespace
  };

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'EXAMS' | 'STUDENTS' | 'MONITOR'>('EXAMS');
  const [exams, setExams] = useState<Exam[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  
  // Editor State
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  
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

  // Roster Sort
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterSortConfig, setRosterSortConfig] = useState<{ key: keyof User; direction: SortDirection }>({ key: 'studentId', direction: 'ASC' });

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
    const data = await getExamsForTeacher();
    setExams([...data]);
  };

  const loadStudents = async () => {
    const data = await getStudents();
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
      questions: []
    };
    setEditingExam(newExam);
  };

  const handleEditExam = (exam: Exam) => { setEditingExam(JSON.parse(JSON.stringify(exam))); };
  
  const handleDeleteExam = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this exam?")) {
       await deleteExam(id);
       loadExams();
    }
  };

  const handleSaveExam = async () => {
    if (!editingExam) return;
    if (!editingExam.title.trim()) return alert("Exam title is required");
    await saveExam(editingExam);
    setEditingExam(null);
    loadExams();
  };

  const handleImportStudents = async () => {
    try {
      const lines = importText.trim().split('\n');
      const data = lines.map(line => {
        const [id, name, section] = line.split(',');
        if (!id || !name) throw new Error("Invalid format");
        return { id: id.trim(), name: name.trim(), section: section ? section.trim() : 'General' };
      });
      await importStudents(data);
      setImportStatus(`Success! Imported ${data.length} students.`);
      setImportText('');
      loadStudents();
    } catch (e) {
      setImportStatus('Error parsing CSV. Use format: ID, Name, Section');
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
    let filtered = students.filter(s => 
      s.name.toLowerCase().includes(rosterSearch.toLowerCase()) || 
      s.studentId?.includes(rosterSearch) ||
      s.section?.toLowerCase().includes(rosterSearch.toLowerCase())
    );

    return filtered.sort((a, b) => {
      const valA = (a[rosterSortConfig.key] || '').toString().toLowerCase();
      const valB = (b[rosterSortConfig.key] || '').toString().toLowerCase();
      if (valA < valB) return rosterSortConfig.direction === 'ASC' ? -1 : 1;
      if (valA > valB) return rosterSortConfig.direction === 'ASC' ? 1 : -1;
      return 0;
    });
  }, [students, rosterSearch, rosterSortConfig]);


  // --- MONITOR DATA PROCESSING ---
  const processedMonitorData = useMemo(() => {
    if (!monitoringExamId) return [];
    const exam = exams.find(e => e.id === monitoringExamId);
    if (!exam) return [];

    // 1. Filter students by assigned sections
    const eligibleStudents = students.filter(s => 
      exam.assignedSections.length === 0 || 
      exam.assignedSections.includes(s.section || '')
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
      
      const matchSection = monitorSectionFilter === 'ALL' || item.user.section === monitorSectionFilter;
      
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

  const uniqueSections = useMemo(() => {
     const sections = new Set(students.map(s => s.section).filter(Boolean));
     return Array.from(sections).sort();
  }, [students]);

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
                     isCorrect = String(ans).length > 20; // Rough check for code
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
                   <Button variant="secondary" onClick={() => setEditingExam(null)}>Cancel</Button>
                   <Button onClick={handleSaveExam}>Save Changes</Button>
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
                   <div>
                      <label className="text-sm font-medium text-gray-700">Assigned Sections</label>
                      <input className="w-full p-2 border rounded" value={editingExam.assignedSections.join(', ')} onChange={e => setEditingExam({...editingExam, assignedSections: e.target.value.split(',').map(s => s.trim())})} placeholder="SEC01, SEC02"/>
                   </div>
                </div>
              </Card>
              <div className="space-y-4">
                 <div className="flex justify-between items-end">
                    <h3 className="text-lg font-bold text-gray-700">Questions ({editingExam.questions.length})</h3>
                    <div className="flex gap-2 text-sm">
                      <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.MULTIPLE_CHOICE)}>+ MCQ</Button>
                      <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.SHORT_ANSWER)}>+ Short Answer</Button>
                      <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.JAVA_CODE)}>+ Java Code</Button>
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
                                  <p className="text-xs font-bold text-blue-700 uppercase">Test Cases</p>
                                  {q.testCases?.map((tc, tcIdx) => (
                                    <div key={tcIdx} className="grid grid-cols-2 gap-2 mb-2">
                                       <input className="p-1 border rounded text-sm font-mono" placeholder="Input" value={tc.input} onChange={(e) => { const newTC = [...(q.testCases || [])]; newTC[tcIdx] = { ...newTC[tcIdx], input: e.target.value }; updateQuestion(q.id, { testCases: newTC }); }} />
                                       <div className="flex gap-1">
                                          <input className="flex-1 p-1 border rounded text-sm font-mono" placeholder="Output" value={tc.output} onChange={(e) => { const newTC = [...(q.testCases || [])]; newTC[tcIdx] = { ...newTC[tcIdx], output: e.target.value }; updateQuestion(q.id, { testCases: newTC }); }} />
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
                      <button onClick={() => handleExportResults(exam.id, exam.title)} className="col-span-2 text-sm text-purple-600 hover:bg-purple-50 py-1 rounded border border-purple-200">📄 Export Scores</button>
                      <button onClick={() => handleDeleteExam(exam.id)} className="col-span-2 text-xs text-red-400 hover:text-red-600 mt-1">Delete Exam</button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'STUDENTS' && (
          <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            <Card title="Batch Import Students">
              <div className="space-y-4">
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                   <p className="text-sm text-yellow-700">Format: <code>StudentID, FullName, SectionID</code></p>
                </div>
                <textarea className="w-full h-32 p-4 border border-gray-300 rounded-lg font-mono text-sm" placeholder="Paste CSV data here..." value={importText} onChange={(e) => setImportText(e.target.value)}></textarea>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-green-600">{importStatus}</span>
                  <Button onClick={handleImportStudents}>Import Data</Button>
                </div>
              </div>
            </Card>

            <Card title={`Student Roster (${students.length})`}>
              <div className="p-4 bg-gray-50 border-b flex items-center gap-4">
                 <input 
                    type="text" 
                    placeholder="Search Roster..." 
                    className="flex-1 p-2 border rounded text-sm"
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                 />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500">
                   <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                     <tr>
                       <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleRosterSort('studentId')}>
                          Student ID {rosterSortConfig.key === 'studentId' && (rosterSortConfig.direction === 'ASC' ? '▲' : '▼')}
                       </th>
                       <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleRosterSort('name')}>
                          Name {rosterSortConfig.key === 'name' && (rosterSortConfig.direction === 'ASC' ? '▲' : '▼')}
                       </th>
                       <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleRosterSort('section')}>
                          Section {rosterSortConfig.key === 'section' && (rosterSortConfig.direction === 'ASC' ? '▲' : '▼')}
                       </th>
                     </tr>
                   </thead>
                   <tbody>
                     {getSortedRoster.length === 0 ? (
                       <tr><td colSpan={3} className="px-6 py-4 text-center">No students found.</td></tr>
                     ) : (
                       getSortedRoster.map(s => (
                         <tr key={s.id} className="bg-white border-b hover:bg-gray-50 transition-colors">
                           <td className="px-6 py-4 font-bold">{s.studentId}</td>
                           <td className="px-6 py-4">{s.name}</td>
                           <td className="px-6 py-4"><span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">{s.section || 'N/A'}</span></td>
                         </tr>
                       ))
                     )}
                   </tbody>
                </table>
              </div>
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
                   
                   {processedMonitorData.map(({ user, display }) => {
                     const isIdle = display.status === 'IDLE';

                     return (
                       <div key={user.studentId} className={`rounded-lg p-4 shadow border flex flex-col gap-3 transition-colors relative ${isIdle ? 'bg-gray-50 border-gray-200 opacity-75' : 'bg-white border-gray-200'}`}>
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
                         
                         <div className="text-xs text-right text-gray-400 mt-1 border-t pt-2">
                           {isIdle ? 'Waiting...' : `Last Active: ${new Date(display.lastUpdated).toLocaleTimeString()}`}
                         </div>
                       </div>
                     );
                   })}
                 </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
};