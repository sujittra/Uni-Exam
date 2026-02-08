import React, { useState, useEffect } from 'react';
import { User, Exam, Question, QuestionType, StudentProgress, TestCase } from '../types';
import { saveExam, deleteExam, getExamsForTeacher, getLiveProgress, importStudents, updateExamStatus, getExamResults } from '../services/dataService';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

interface TeacherDashboardProps {
  user: User;
  onLogout: () => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'EXAMS' | 'STUDENTS' | 'MONITOR'>('EXAMS');
  const [exams, setExams] = useState<Exam[]>([]);
  
  // Editor State
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  
  // Import State
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState('');

  // Monitor State
  const [monitoringExamId, setMonitoringExamId] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<StudentProgress[]>([]);

  useEffect(() => {
    loadExams();
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

  const handleEditExam = (exam: Exam) => {
    // Deep copy to prevent mutation before save
    setEditingExam(JSON.parse(JSON.stringify(exam)));
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
    
    // CSV Generation with BOM for UTF-8 Support in Excel
    const headers = ["Student ID", "Name", "Section", "Total Score", "Max Score", "Status", "Last Update"];
    const csvContent = [
      headers.join(","),
      ...results.map(r => [
        `"${r.studentId}"`, 
        `"${r.name}"`, 
        `"${r.section}"`, 
        r.totalScore, 
        r.maxScore,
        `"${r.status}"`, 
        `"${r.submittedAt}"`
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

  // --- RENDER ---

  // If Editing, show full screen editor
  if (editingExam) {
    return (
      <div className="min-h-screen bg-gray-100 pb-20">
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
            {/* Exam Metadata */}
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
                    <label className="text-sm font-medium text-gray-700">Assigned Sections (Comma separated)</label>
                    <input 
                      className="w-full p-2 border rounded" 
                      value={editingExam.assignedSections.join(', ')} 
                      onChange={e => setEditingExam({...editingExam, assignedSections: e.target.value.split(',').map(s => s.trim())})} 
                      placeholder="SEC01, SEC02"
                    />
                 </div>
              </div>
            </Card>

            {/* Questions List */}
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                 <h3 className="text-lg font-bold text-gray-700">Questions ({editingExam.questions.length})</h3>
                 <div className="flex gap-2 text-sm">
                   <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.MULTIPLE_CHOICE)}>+ MCQ</Button>
                   <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.SHORT_ANSWER)}>+ Short Answer</Button>
                   <Button size="sm" variant="outline" onClick={() => addQuestion(QuestionType.JAVA_CODE)}>+ Java Code</Button>
                 </div>
              </div>

              {editingExam.questions.length === 0 && (
                <div className="text-center py-10 border-2 border-dashed border-gray-300 rounded-lg text-gray-400">
                  No questions added yet.
                </div>
              )}

              {editingExam.questions.map((q, idx) => (
                <Card key={q.id} className="relative group">
                   <div className="absolute right-4 top-4 opacity-100 transition-opacity">
                      <button onClick={() => removeQuestion(q.id)} className="text-red-400 hover:text-red-600 font-medium text-sm">Delete</button>
                   </div>
                   
                   <div className="flex gap-4 items-start">
                      <span className="bg-purple-100 text-purple-700 font-bold px-3 py-1 rounded text-sm mt-1">Q{idx+1}</span>
                      <div className="flex-1 space-y-4">
                         
                         {/* Common Fields */}
                         <div className="flex gap-4">
                           <div className="flex-1">
                              <input 
                                className="w-full p-2 border border-gray-300 rounded font-medium" 
                                value={q.text} 
                                onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                                placeholder="Enter question text..."
                              />
                           </div>
                           <div className="w-24">
                              <input 
                                type="number"
                                className="w-full p-2 border border-gray-300 rounded text-center" 
                                value={q.score} 
                                onChange={(e) => updateQuestion(q.id, { score: Number(e.target.value) })}
                                placeholder="Score"
                              />
                           </div>
                         </div>

                         {/* MCQ Specifics */}
                         {q.type === QuestionType.MULTIPLE_CHOICE && (
                           <div className="space-y-2 bg-gray-50 p-3 rounded">
                             <p className="text-xs font-bold text-gray-500 uppercase">Options (Select radio for correct answer)</p>
                             {q.options?.map((opt, oIdx) => (
                               <div key={oIdx} className="flex items-center gap-2">
                                  <input 
                                    type="radio" 
                                    name={`correct_${q.id}`} 
                                    checked={q.correctOptionIndex === oIdx}
                                    onChange={() => updateQuestion(q.id, { correctOptionIndex: oIdx })}
                                  />
                                  <input 
                                    className="flex-1 p-1 border rounded text-sm"
                                    value={opt}
                                    onChange={(e) => {
                                      const newOpts = [...(q.options || [])];
                                      newOpts[oIdx] = e.target.value;
                                      updateQuestion(q.id, { options: newOpts });
                                    }}
                                  />
                                  <button onClick={() => {
                                     const newOpts = q.options?.filter((_, i) => i !== oIdx);
                                     updateQuestion(q.id, { options: newOpts, correctOptionIndex: 0 });
                                  }} className="text-gray-400 hover:text-red-500">×</button>
                               </div>
                             ))}
                             <Button size="sm" variant="secondary" onClick={() => updateQuestion(q.id, { options: [...(q.options||[]), `Option ${(q.options?.length||0)+1}`] })}>+ Add Option</Button>
                           </div>
                         )}

                         {/* Short Answer Specifics */}
                         {q.type === QuestionType.SHORT_ANSWER && (
                           <div className="space-y-2 bg-gray-50 p-3 rounded">
                              <p className="text-xs font-bold text-gray-500 uppercase">Accepted Answers</p>
                              <textarea 
                                className="w-full p-2 border rounded text-sm" 
                                placeholder="Enter acceptable answers separated by commas (e.g. Java, java, JAVA)"
                                value={q.acceptedAnswers?.join(', ')}
                                onChange={(e) => updateQuestion(q.id, { acceptedAnswers: e.target.value.split(',').map(s => s.trim()) })}
                              />
                           </div>
                         )}

                         {/* Java Code Specifics */}
                         {q.type === QuestionType.JAVA_CODE && (
                           <div className="space-y-2 bg-blue-50 p-3 rounded border border-blue-100">
                              <p className="text-xs font-bold text-blue-700 uppercase">Test Cases (Input / Output)</p>
                              {q.testCases?.map((tc, tcIdx) => (
                                <div key={tcIdx} className="grid grid-cols-2 gap-2 mb-2">
                                   <input 
                                     className="p-1 border rounded text-sm font-mono" placeholder="Input"
                                     value={tc.input}
                                     onChange={(e) => {
                                        const newTC = [...(q.testCases || [])];
                                        newTC[tcIdx] = { ...newTC[tcIdx], input: e.target.value };
                                        updateQuestion(q.id, { testCases: newTC });
                                     }}
                                   />
                                   <div className="flex gap-1">
                                      <input 
                                        className="flex-1 p-1 border rounded text-sm font-mono" placeholder="Expected Output"
                                        value={tc.output}
                                        onChange={(e) => {
                                            const newTC = [...(q.testCases || [])];
                                            newTC[tcIdx] = { ...newTC[tcIdx], output: e.target.value };
                                            updateQuestion(q.id, { testCases: newTC });
                                        }}
                                      />
                                      <button onClick={() => {
                                         const newTC = q.testCases?.filter((_, i) => i !== tcIdx);
                                         updateQuestion(q.id, { testCases: newTC });
                                      }} className="text-red-400 font-bold px-2">×</button>
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
      {/* Navbar */}
      <header className="bg-purple-700 text-white shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">UniExam Manager</h1>
            <span className="bg-purple-600 px-3 py-1 rounded-full text-xs text-purple-100 uppercase tracking-wider">{user.name}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('EXAMS')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'EXAMS' ? 'bg-white text-purple-700' : 'text-purple-100 hover:bg-purple-600'}`}>Exams</button>
            <button onClick={() => setActiveTab('STUDENTS')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'STUDENTS' ? 'bg-white text-purple-700' : 'text-purple-100 hover:bg-purple-600'}`}>Roster Import</button>
            <button onClick={() => setActiveTab('MONITOR')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'MONITOR' ? 'bg-white text-purple-700' : 'text-purple-100 hover:bg-purple-600'}`}>Monitor</button>
            <div className="w-px h-8 bg-purple-500 mx-2"></div>
            <button onClick={onLogout} className="text-purple-200 hover:text-white text-sm font-medium">Logout</button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 flex-1">
        
        {/* EXAMS TAB */}
        {activeTab === 'EXAMS' && (
          <div className="space-y-6">
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
                      {exam.assignedSections.map(sec => (
                        <span key={sec} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">Group: {sec}</span>
                      ))}
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
                      <Button size="sm" variant={exam.isActive ? 'danger' : 'secondary'} onClick={() => toggleExamStatus(exam.id, exam.isActive)}>
                          {exam.isActive ? 'Close' : 'Open'}
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => handleEditExam(exam)}>
                          Edit / Manage
                      </Button>
                      <Button size="sm" variant="outline" className="col-span-2" onClick={() => { setMonitoringExamId(exam.id); setActiveTab('MONITOR'); }}>
                          Monitor Students
                      </Button>
                      <button 
                        onClick={() => handleExportResults(exam.id, exam.title)} 
                        className="col-span-2 text-sm text-purple-600 hover:bg-purple-50 py-1 rounded border border-purple-200"
                      >
                         📄 Export Scores (CSV)
                      </button>
                      <button onClick={() => handleDeleteExam(exam.id)} className="col-span-2 text-xs text-red-400 hover:text-red-600 mt-1">Delete Exam</button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ROSTER IMPORT TAB */}
        {activeTab === 'STUDENTS' && (
          <div className="max-w-3xl mx-auto">
            <Card title="Batch Import Students">
              <div className="space-y-4">
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                  <p className="text-sm text-yellow-700">
                    <strong>Format instructions:</strong> Paste Excel data as CSV (Comma Separated).
                    <br />
                    <code>StudentID, FullName, SectionID</code>
                    <br />
                    Example: <code>6401015, Somchai Jai-dee, SEC01</code>
                  </p>
                </div>
                <textarea 
                  className="w-full h-64 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="Paste CSV data here..."
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                ></textarea>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-green-600">{importStatus}</span>
                  <Button onClick={handleImportStudents}>Import Data</Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* MONITOR TAB */}
        {activeTab === 'MONITOR' && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Live Monitor</h2>
              <select 
                className="p-2 border rounded-lg bg-white"
                value={monitoringExamId || ''}
                onChange={(e) => setMonitoringExamId(e.target.value)}
              >
                <option value="">Select active exam to monitor...</option>
                {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </div>

            {!monitoringExamId ? (
              <div className="text-center py-20 text-gray-400 border-2 border-dashed border-gray-300 rounded-xl">
                Select an exam to view real-time student activity.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {liveData.length === 0 && <p className="text-gray-500 col-span-3">Waiting for students to start...</p>}
                {liveData.map(student => {
                  const exam = exams.find(e => e.id === monitoringExamId);
                  const progressPercent = exam ? Math.round((Object.keys(student.answers).length / exam.questions.length) * 100) : 0;
                  
                  return (
                    <div key={student.studentId} className="bg-white rounded-lg p-4 shadow border border-gray-200 flex flex-col gap-3">
                      <div className="flex justify-between">
                        <div>
                          <h4 className="font-bold text-gray-900">{student.studentName}</h4>
                          <span className="text-xs text-gray-500">ID: {student.studentId}</span>
                        </div>
                        <span className={`px-2 py-1 text-xs rounded-full h-fit ${student.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                          {student.status}
                        </span>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div className="bg-purple-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Progress: {progressPercent}%</span>
                        <span>Current Q: {student.currentQuestionIndex + 1}</span>
                      </div>
                      
                      <div className="text-xs text-right text-gray-400 mt-2">
                        Last Active: {new Date(student.lastUpdated).toLocaleTimeString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
};