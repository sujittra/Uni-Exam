import React, { useState, useEffect, useRef } from 'react';
import { User, Exam, Question, QuestionType, StudentProgress } from '../types';
import { getExamsForStudent, submitStudentProgress, compileJavaCode, getStudentProgress, calculateScore } from '../services/dataService';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

interface StudentExamProps {
  user: User;
  onLogout: () => void;
}

// Helper for LocalStorage Keys
const getStorageKey = (studentId: string, examId: string) => `uniexam_prog_${studentId}_${examId}`;

export const StudentExam: React.FC<StudentExamProps> = ({ user, onLogout }) => {
  const [availableExams, setAvailableExams] = useState<Exam[]>([]);
  const [examStatuses, setExamStatuses] = useState<Record<string, StudentProgress>>({});
  const [syncingStatus, setSyncingStatus] = useState<string | null>(null);
  
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  
  // State for UI rendering
  const [answers, setAnswers] = useState<Record<string, any>>({});
  // Ref for Syncing (Guarantees latest value without stale closures)
  const answersRef = useRef<Record<string, any>>({});
  
  const [timeLeft, setTimeLeft] = useState(0);
  const [examStartTime, setExamStartTime] = useState<number>(0);
  
  // UI State
  const [showTOS, setShowTOS] = useState<Exam | null>(null);
  
  // Compiler State
  const [codeOutput, setCodeOutput] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);

  useEffect(() => {
    loadExamsAndStatus();
  }, []);

  // Timer & Auto-Sync
  useEffect(() => {
    if (activeExam && examStartTime > 0) {
      const timer = setInterval(() => {
        // Calculate remaining based on wall-clock time
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - examStartTime) / 1000);
        const durationSeconds = activeExam.durationMinutes * 60;
        const remaining = durationSeconds - elapsedSeconds;

        if (remaining <= 0) {
          setTimeLeft(0);
          finishExam(true); // Force finish
          clearInterval(timer);
        } else {
          setTimeLeft(remaining);
          // Sync progress to Server every 30 seconds using REF to avoid stale state
          if (remaining % 30 === 0) {
             syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'IN_PROGRESS', examStartTime, true);
          }
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [activeExam, examStartTime, currentQuestionIdx]); // Removed answers from dependency to avoid timer reset

  // Update code output when switching questions
  useEffect(() => {
    if(activeExam) {
       const q = activeExam.questions[currentQuestionIdx];
       if (q.type === QuestionType.JAVA_CODE) {
          const ans = answers[q.id];
          if (typeof ans === 'object' && ans.output) {
             setCodeOutput(ans.output);
          } else {
             setCodeOutput('');
          }
       }
    }
  }, [currentQuestionIdx, activeExam]);

  const loadExamsAndStatus = async () => {
    const exams = await getExamsForStudent(user);
    setAvailableExams(exams);
    
    const statuses: Record<string, StudentProgress> = {};
    for (const exam of exams) {
       let dbProg = await getStudentProgress(user.studentId!, exam.id);
       const localKey = getStorageKey(user.studentId!, exam.id);
       const localStr = localStorage.getItem(localKey);
       const localProg = localStr ? JSON.parse(localStr) : null;

       // AUTO-SYNC FIX: If local says completed but DB is missing or old, push it.
       if (localProg?.status === 'COMPLETED' && (!dbProg || dbProg.status !== 'COMPLETED')) {
          console.log(`Auto-syncing completed exam: ${exam.id}`);
          setSyncingStatus(`Syncing exam data: ${exam.title}...`);
          const result = await submitStudentProgress(localProg);
          if (result.success) {
             dbProg = await getStudentProgress(user.studentId!, exam.id);
          } else {
             console.error("Auto-sync failed:", result.error);
          }
          setSyncingStatus(null);
       }

       let finalProg = dbProg;
       if (localProg && dbProg) {
          if (localProg.lastUpdated > dbProg.lastUpdated) finalProg = localProg;
       } else if (localProg) {
          finalProg = localProg;
       }

       if (finalProg) statuses[exam.id] = finalProg;
    }
    setExamStatuses(statuses);
  };

  const initExamSession = async (exam: Exam) => {
    if (examStatuses[exam.id]?.status === 'COMPLETED') {
        alert("You have already completed this exam.");
        return;
    }

    const localKey = getStorageKey(user.studentId!, exam.id);
    const localStr = localStorage.getItem(localKey);
    const localData = localStr ? JSON.parse(localStr) : null;
    const dbData = await getStudentProgress(user.studentId!, exam.id);
    
    let finalData = null;
    if (localData && dbData) {
        finalData = (localData.lastUpdated > dbData.lastUpdated) ? localData : dbData;
    } else {
        finalData = localData || dbData;
    }

    let startTime = Date.now();
    if (finalData && finalData.startedAt) {
       startTime = finalData.startedAt;
    } else {
       // First time start
       // Need to save start time immediately to lock it in
       await syncProgress(exam.id, 0, {}, 'IDLE', startTime, true);
    }

    setActiveExam(exam);
    setExamStartTime(startTime);
    setAnswers(finalData?.answers || {});
    answersRef.current = finalData?.answers || {};
    setCurrentQuestionIdx(finalData?.currentQuestionIndex || 0);
    setShowTOS(null);
  };

  const syncProgress = async (examId: string, qIdx: number, ans: Record<string, any>, status: 'IDLE' | 'IN_PROGRESS' | 'COMPLETED', startedAt: number, bg: boolean = false) => {
    if (!bg) setSyncingStatus('Saving...');
    
    // Calculate current score (even if partial)
    const exam = availableExams.find(e => e.id === examId);
    const currentScore = exam ? calculateScore(exam, ans) : 0;

    const progress: StudentProgress = {
      studentId: user.studentId!,
      studentName: user.name,
      examId,
      currentQuestionIndex: qIdx,
      answers: ans,
      score: currentScore, // Save Score
      status,
      startedAt, // Persist start time
      lastUpdated: Date.now()
    };
    
    // Save Local
    localStorage.setItem(getStorageKey(user.studentId!, examId), JSON.stringify(progress));
    
    // Save DB
    const res = await submitStudentProgress(progress);
    if (!res.success && !bg) {
        alert("Warning: Could not save progress to server. Check internet connection.");
    }
    
    if (!bg) setSyncingStatus(null);
  };

  const finishExam = async (force: boolean = false) => {
    if (!activeExam) return;
    if (!force && !window.confirm("Are you sure you want to submit? You cannot change answers after submission.")) return;
    
    // Calculate FINAL Score
    const finalScore = calculateScore(activeExam, answersRef.current);

    await syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'COMPLETED', examStartTime, false);
    alert(`Exam Submitted! Your Score: ${finalScore}`);
    
    setActiveExam(null);
    loadExamsAndStatus();
  };

  // UI Handlers
  const handleAnswerChange = (val: any) => {
    if (!activeExam) return;
    const qId = activeExam.questions[currentQuestionIdx].id;
    
    // For Java, preserve structure if it exists
    let newVal = val;
    const currentAns = answers[qId];
    if (activeExam.questions[currentQuestionIdx].type === QuestionType.JAVA_CODE) {
        // If typing, reset passed status but keep previous output if we want (or clear it)
        // Here we clear passed status because code changed
        if (typeof currentAns === 'object') {
           newVal = { ...currentAns, code: val, passed: false }; 
        } else {
           newVal = { code: val, output: '', passed: false };
        }
    }

    const newAnswers = { ...answers, [qId]: newVal };
    setAnswers(newAnswers);
    answersRef.current = newAnswers; // Update Ref immediately
  };

  const handleRunCode = async () => {
    if (!activeExam) return;
    const q = activeExam.questions[currentQuestionIdx];
    if (q.type !== QuestionType.JAVA_CODE || !q.testCases) return;
    
    // Extract code
    const val = answers[q.id];
    const code = (typeof val === 'object' ? val.code : val) || '';

    setIsCompiling(true);
    setCodeOutput('Compiling and Running...');
    
    const result = await compileJavaCode(code, q.testCases);
    setCodeOutput(result.output);
    setIsCompiling(false);

    // Save Execution Result to DB (via Answers state)
    const newEntry = {
        code: code,
        output: result.output,
        passed: result.passed
    };
    const newAnswers = { ...answers, [q.id]: newEntry };
    setAnswers(newAnswers);
    answersRef.current = newAnswers;
    
    // Trigger save immediately so status persists even if they reload
    syncProgress(activeExam.id, currentQuestionIdx, newAnswers, 'IN_PROGRESS', examStartTime, true);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Helper to extract code string from potential object answer
  const getCodeValue = (ans: any) => {
      if (!ans) return '';
      if (typeof ans === 'object') return ans.code || '';
      return ans;
  };

  // --- RENDER ---

  if (activeExam) {
    const q = activeExam.questions[currentQuestionIdx];
    const isFirst = currentQuestionIdx === 0;
    const isLast = currentQuestionIdx === activeExam.questions.length - 1;

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
         {/* Exam Header */}
         <div className="bg-white shadow-sm border-b sticky top-0 z-10">
            <div className="container mx-auto px-4 h-16 flex justify-between items-center">
               <h1 className="font-bold text-gray-800 text-lg truncate max-w-md">{activeExam.title}</h1>
               <div className="flex items-center gap-4">
                  <div className={`text-xl font-mono font-bold ${timeLeft < 300 ? 'text-red-500 animate-pulse' : 'text-purple-600'}`}>
                    {formatTime(timeLeft)}
                  </div>
                  <Button variant="danger" size="sm" onClick={() => finishExam(false)}>Submit Exam</Button>
               </div>
            </div>
            {/* Progress Bar */}
            <div className="h-1 bg-gray-200 w-full">
               <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${((currentQuestionIdx + 1) / activeExam.questions.length) * 100}%` }}></div>
            </div>
         </div>

         {/* Exam Body */}
         <div className="container mx-auto px-4 py-6 flex-1 max-w-5xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
               
               {/* Question Panel */}
               <div className="space-y-6">
                  <div className="flex justify-between items-end">
                     <span className="text-sm font-bold text-gray-400">Question {currentQuestionIdx + 1} of {activeExam.questions.length}</span>
                     {syncingStatus && <span className="text-xs text-purple-500 animate-pulse">{syncingStatus}</span>}
                  </div>
                  <h2 className="text-xl font-medium text-gray-800 leading-relaxed whitespace-pre-wrap">{q.text}</h2>
                  {q.imageUrl && (
                    <img src={q.imageUrl} alt="Question Reference" className="max-h-64 rounded-lg border shadow-sm object-contain bg-white" />
                  )}
               </div>

               {/* Answer Panel */}
               <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="flex-1 p-6 overflow-y-auto">
                     <h3 className="text-sm font-bold text-gray-500 uppercase mb-4">Your Answer</h3>
                     
                     {q.type === QuestionType.MULTIPLE_CHOICE && (
                        <div className="space-y-3">
                           {q.options?.map((opt, idx) => (
                              <label key={idx} className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${answers[q.id] === String(idx) ? 'border-purple-500 bg-purple-50' : 'border-gray-100 hover:border-purple-200'}`}>
                                 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${answers[q.id] === String(idx) ? 'border-purple-500' : 'border-gray-300'}`}>
                                    {answers[q.id] === String(idx) && <div className="w-2.5 h-2.5 rounded-full bg-purple-500"></div>}
                                 </div>
                                 <input type="radio" name="mcq" className="hidden" checked={answers[q.id] === String(idx)} onChange={() => handleAnswerChange(String(idx))} />
                                 <span className="text-gray-700">{opt}</span>
                              </label>
                           ))}
                        </div>
                     )}

                     {q.type === QuestionType.SHORT_ANSWER && (
                        <textarea 
                           className="w-full h-48 p-4 rounded-xl border-2 border-gray-200 focus:border-purple-500 focus:ring-0 outline-none resize-none text-lg"
                           placeholder="Type your answer here..."
                           value={answers[q.id] || ''}
                           onChange={(e) => handleAnswerChange(e.target.value)}
                        />
                     )}

                     {q.type === QuestionType.JAVA_CODE && (
                        <div className="flex flex-col h-full gap-4">
                           <textarea 
                              className="flex-1 w-full p-4 rounded-xl border-2 border-gray-200 focus:border-purple-500 focus:ring-0 outline-none resize-none font-mono text-sm bg-gray-50"
                              placeholder="// Write your Java code here class Main { public static void main(String[] args) { ... } }"
                              value={getCodeValue(answers[q.id])}
                              onChange={(e) => handleAnswerChange(e.target.value)}
                           />
                           <div className="flex justify-between items-center">
                              <span className="text-xs text-gray-400">Output console below</span>
                              <Button size="sm" onClick={handleRunCode} disabled={isCompiling}>
                                 {isCompiling ? 'Running...' : '▶ Run Code'}
                              </Button>
                           </div>
                           <div className="h-32 bg-gray-900 rounded-xl p-3 text-xs font-mono text-green-400 overflow-y-auto whitespace-pre-wrap">
                              {codeOutput || '> Ready to compile...'}
                           </div>
                        </div>
                     )}
                  </div>
                  
                  {/* Footer Nav */}
                  <div className="p-4 bg-gray-50 border-t flex justify-between">
                     <Button variant="secondary" disabled={isFirst} onClick={() => {
                        syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'IN_PROGRESS', examStartTime, true);
                        setCurrentQuestionIdx(prev => prev - 1);
                     }}>
                        &larr; Previous
                     </Button>
                     {isLast ? (
                        <Button onClick={() => finishExam(false)}>Submit Exam</Button>
                     ) : (
                        <Button onClick={() => {
                           syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'IN_PROGRESS', examStartTime, true);
                           setCurrentQuestionIdx(prev => prev + 1);
                        }}>
                           Next Question &rarr;
                        </Button>
                     )}
                  </div>
               </div>
            </div>
         </div>
      </div>
    );
  }

  // --- DASHBOARD LIST ---

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex justify-between items-center">
           <h1 className="font-bold text-gray-800 text-xl">My Exams</h1>
           <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">{user.name} ({user.studentId})</span>
              <button onClick={onLogout} className="text-sm text-red-500 hover:text-red-700 font-medium">Logout</button>
           </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
         {syncingStatus && (
            <div className="mb-4 bg-blue-50 text-blue-700 px-4 py-3 rounded-lg flex items-center gap-2 animate-pulse">
               <span>↻</span> {syncingStatus}
            </div>
         )}
         
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {availableExams.length === 0 ? (
               <div className="col-span-3 text-center py-20 text-gray-400">No exams assigned to your section ({user.section}).</div>
            ) : (
               availableExams.map(exam => {
                  const status = examStatuses[exam.id];
                  const isCompleted = status?.status === 'COMPLETED';
                  
                  return (
                     <Card key={exam.id} className="hover:shadow-lg transition-all">
                        <div className="flex justify-between items-start mb-4">
                           <h3 className="font-bold text-lg text-gray-900">{exam.title}</h3>
                           {isCompleted && <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full font-bold">Completed</span>}
                        </div>
                        <p className="text-gray-500 text-sm mb-6 min-h-[40px]">{exam.description}</p>
                        <div className="flex items-center justify-between mt-auto pt-4 border-t">
                           <div className="text-xs text-gray-400">
                              <div>{exam.questions.length} Questions</div>
                              <div>{exam.durationMinutes} Minutes</div>
                           </div>
                           {isCompleted ? (
                              <div className="text-right">
                                 <div className="text-2xl font-bold text-purple-600">{status.score}</div>
                                 <div className="text-xs text-gray-400">Your Score</div>
                              </div>
                           ) : (
                              <Button onClick={() => setShowTOS(exam)}>
                                 {status?.status === 'IN_PROGRESS' ? 'Continue Exam' : 'Start Exam'}
                              </Button>
                           )}
                        </div>
                     </Card>
                  );
               })
            )}
         </div>
      </main>

      {/* Terms of Service Modal */}
      {showTOS && (
         <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-fade-in">
               <h2 className="text-xl font-bold text-gray-900 mb-4">Exam Rules & Instructions</h2>
               <div className="space-y-3 text-gray-600 text-sm mb-6 bg-gray-50 p-4 rounded-lg">
                  <p>1. You have <strong>{showTOS.durationMinutes} minutes</strong> to complete this exam.</p>
                  <p>2. Do not refresh the page or close the browser tab repeatedly.</p>
                  <p>3. Your progress is saved automatically every 30 seconds.</p>
                  <p>4. Once submitted, you cannot change your answers.</p>
                  <p>5. Malpractice or cheating attempts will be logged.</p>
               </div>
               <div className="flex gap-3 justify-end">
                  <Button variant="secondary" onClick={() => setShowTOS(null)}>Cancel</Button>
                  <Button onClick={() => initExamSession(showTOS)}>I Agree, Start Exam</Button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};