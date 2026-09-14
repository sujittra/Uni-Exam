import React, { useState, useEffect, useRef } from 'react';
import { User, Exam, Question, QuestionType, StudentProgress } from '../types';
import { getExamsForStudent, submitStudentProgress, compileCode, getStudentProgress, calculateScore } from '../services/dataService';
import { testPythonCode } from '../services/pyodideRunner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

interface StudentExamProps {
  user: User;
  onLogout: () => void;
}

// Helper for LocalStorage Keys
const getStorageKey = (studentId: string, examId: string) => `uniexam_prog_${studentId}_${examId}`;

// Proctoring relies on the Fullscreen API, which iOS doesn't support for arbitrary
// elements in ANY browser (Chrome on iPhone/iPad is Safari's engine underneath).
// Students are told to sit the exam in desktop Chrome; anything else gets a warning.
const supportsFullscreen = () =>
   !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen;

// Edge / Opera / Samsung Internet all carry "Chrome/" in their UA — real Chrome is the
// one without their own token.
const isChrome = () => {
   const ua = navigator.userAgent;
   return /Chrome\//.test(ua) && !/Edg\/|EdgA\/|OPR\/|SamsungBrowser\/|CriOS\//.test(ua);
};

const isExamBrowserSupported = () => supportsFullscreen() && isChrome();

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
  // Counts exits from the exam view (tab switch, app switch, or leaving fullscreen) —
  // logged for the teacher, never enforced client-side (can't truly block tab-switching)
  const tabSwitchCountRef = useRef<number>(0);
  // Suppresses the fullscreen-exit violation we trigger ourselves when the exam ends
  const isEndingExamRef = useRef(false);
  
  const [timeLeft, setTimeLeft] = useState(0);
  const [examStartTime, setExamStartTime] = useState<number>(0);
  
  // UI State
  const [showTOS, setShowTOS] = useState<Exam | null>(null);
  const [showCodeInfoModal, setShowCodeInfoModal] = useState(false);
  const hasShownCodeInfoRef = useRef(false);
  const [browserSupported] = useState(isExamBrowserSupported);
  
  // Compiler State
  const [codeOutput, setCodeOutput] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

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

  // Proctoring: log (don't block — browsers can't truly prevent tab/app switching)
  // every time the student leaves the exam view: switches tabs/apps, minimizes, or
  // exits the forced fullscreen mode. Visible to the teacher in Monitor/Inspect.
  useEffect(() => {
    if (!activeExam) return;

    const recordViolation = () => {
      if (isEndingExamRef.current) return; // we're exiting fullscreen ourselves on submit
      tabSwitchCountRef.current += 1;
      syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'IN_PROGRESS', examStartTime, true);
    };

    const handleVisibility = () => { if (document.hidden) recordViolation(); };
    const handleFullscreenChange = () => { if (!document.fullscreenElement) recordViolation(); };

    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [activeExam, currentQuestionIdx, examStartTime]);

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
          if (!hasShownCodeInfoRef.current) {
             hasShownCodeInfoRef.current = true;
             setShowCodeInfoModal(true);
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

       // AUTO-SYNC FIX: If local says completed but DB is missing or genuinely behind local
       // (e.g. a failed sync), push it. Skip this when the DB is actually newer than local
       // (e.g. a teacher reopened the exam for editing) so that doesn't get overwritten.
       if (localProg?.status === 'COMPLETED' && (!dbProg || (dbProg.status !== 'COMPLETED' && localProg.lastUpdated > dbProg.lastUpdated))) {
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

    // Must be called synchronously within the click handler (before any await) to
    // count as a user gesture — browsers reject requestFullscreen() otherwise.
    // Not fatal if unsupported/rejected (e.g. iOS Safari) — exam still proceeds.
    document.documentElement.requestFullscreen?.().catch(() => {});

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
    tabSwitchCountRef.current = finalData?.tabSwitchCount || 0;
    isEndingExamRef.current = false;
    hasShownCodeInfoRef.current = false;
    setCurrentQuestionIdx(finalData?.currentQuestionIndex || 0);
    setShowTOS(null);
  };

  const syncProgress = async (examId: string, qIdx: number, ans: Record<string, any>, status: 'IDLE' | 'IN_PROGRESS' | 'COMPLETED', startedAt: number, bg: boolean = false, autoSubmitted: boolean = false) => {
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
      autoSubmitted,
      tabSwitchCount: tabSwitchCountRef.current,
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

    isEndingExamRef.current = true;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }

    // Calculate FINAL Score
    const finalScore = calculateScore(activeExam, answersRef.current);

    await syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'COMPLETED', examStartTime, false, force);
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

  const handleCodeFileUpload = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleAnswerChange(String(reader.result || ''));
    reader.readAsText(file);
  };

  // "ทดสอบ" — instant, unlimited, runs entirely in the browser (Python only) against
  // just the visible sample test cases. Never touches hidden test cases or any
  // external API, and doesn't affect the graded answer.
  const handleTestCode = async () => {
    if (!activeExam) return;
    const q = activeExam.questions[currentQuestionIdx];
    if (q.type !== QuestionType.JAVA_CODE || q.language !== 'python3' || !q.testCases) return;

    const val = answers[q.id];
    const code = (typeof val === 'object' ? val.code : val) || '';
    const visibleTestCases = q.testCases.filter(tc => !tc.hidden);

    setIsTesting(true);
    setCodeOutput('Starting Python in your browser...');

    const result = await testPythonCode(code, visibleTestCases, q.inputMode || 'stdin');
    setCodeOutput(result.output);
    setIsTesting(false);
  };

  // "ส่งคำตอบ" — the graded run: goes through the remote judge against ALL test
  // cases (including hidden ones) and its result is what's saved for scoring.
  const handleRunCode = async () => {
    if (!activeExam) return;
    const q = activeExam.questions[currentQuestionIdx];
    if (q.type !== QuestionType.JAVA_CODE) return;

    // Extract code
    const val = answers[q.id];
    const code = (typeof val === 'object' ? val.code : val) || '';

    setIsCompiling(true);
    setCodeOutput('Submitting for grading...');

    const result = await compileCode(q.id, code, q.language || 'java');
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

  // Format a duration in ms as e.g. "12m 34s"
  const formatDuration = (ms: number) => {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m ${s}s`;
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
         <div className="container mx-auto px-4 py-6 flex-1 max-w-3xl">
            <div className="flex flex-col gap-6">

               {/* Question Panel */}
               <div className="space-y-4 bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
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
               <div className="flex flex-col bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
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
                        <div className="flex flex-col gap-4">
                           <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-gray-500">
                                 {q.language === 'python3' ? '🐍 Python 3' : '☕ Java'}
                              </span>
                              {q.allowFileUpload !== false && (
                                 <label className="text-xs text-purple-600 font-medium cursor-pointer hover:text-purple-800">
                                    📁 Upload {q.language === 'python3' ? '.py' : '.java'} file
                                    <input
                                       type="file"
                                       accept={q.language === 'python3' ? '.py' : '.java'}
                                       className="hidden"
                                       onChange={(e) => handleCodeFileUpload(e.target.files?.[0] || null)}
                                    />
                                 </label>
                              )}
                           </div>

                           {((q.testCases && q.testCases.length > 0) || (q.hiddenTestCaseCount || 0) > 0) && (
                              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                                 <p className="text-xs font-bold text-gray-500 uppercase">Test Cases</p>
                                 {q.inputMode === 'function' && (
                                    <div>
                                       <p className="text-xs text-gray-600">เขียนเฉพาะฟังก์ชัน ระบบจะเรียกฟังก์ชันของคุณตามที่แสดงด้านล่างแล้วเทียบกับผลลัพธ์ที่คาดหวัง (จะ return ค่า หรือ print ออกมาก็ได้)</p>
                                       <p className="text-xs text-gray-400">Write the function only — we call it as shown below and compare the result. Returning the value or printing it both work.</p>
                                    </div>
                                 )}
                                 <div className="space-y-1.5">
                                    {q.testCases?.map((tc, tcIdx) => (
                                       <div key={tcIdx} className="grid grid-cols-2 gap-2 text-xs font-mono">
                                          <div className="bg-white border rounded px-2 py-1 truncate"><span className="text-gray-400">{q.inputMode === 'function' ? 'Call: ' : 'Input: '}</span>{tc.input}</div>
                                          <div className="bg-white border rounded px-2 py-1 truncate"><span className="text-gray-400">Output: </span>{tc.output}</div>
                                       </div>
                                    ))}
                                 </div>
                                 {(q.hiddenTestCaseCount || 0) > 0 && (
                                    <p className="text-xs text-gray-400 italic">
                                       + {q.hiddenTestCaseCount} hidden test case(s) also used for grading
                                    </p>
                                 )}
                              </div>
                           )}

                           <textarea
                              className="w-full h-64 p-4 rounded-xl border-2 border-gray-200 focus:border-purple-500 focus:ring-0 outline-none resize-none font-mono text-sm bg-gray-50"
                              placeholder={q.language === 'python3'
                                 ? '# Write your Python 3 code here\n# Read input via input(), print result via print(...)'
                                 : '// Write your Java code here class Main { public static void main(String[] args) { ... } }'}
                              value={getCodeValue(answers[q.id])}
                              onChange={(e) => handleAnswerChange(e.target.value)}
                           />
                           <div className="flex justify-between items-center">
                              <span className="text-xs text-gray-400">
                                 {q.language === 'python3' ? 'Test = instant, unlimited (sample cases only)' : 'Output console below'}
                              </span>
                              <div className="flex gap-2">
                                 {q.language === 'python3' && (
                                    <Button size="sm" variant="outline" onClick={handleTestCode} disabled={isTesting || isCompiling}>
                                       {isTesting ? 'Testing...' : '▶ ทดสอบ'}
                                    </Button>
                                 )}
                                 <Button size="sm" onClick={handleRunCode} disabled={isCompiling || isTesting}>
                                    {isCompiling ? 'Submitting...' : '✓ ส่งคำตอบ'}
                                 </Button>
                              </div>
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

         {/* Code Question Info Modal — explains the Test vs Submit buttons */}
         {showCodeInfoModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl animate-fade-in">
                  <h2 className="text-xl font-bold text-gray-900 mb-0.5">วิธีใช้ปุ่มสำหรับโจทย์เขียนโค้ด</h2>
                  <p className="text-xs text-gray-400 mb-4">How the code question buttons work</p>
                  <div className="space-y-3 text-sm mb-6">
                     <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                        <p className="font-bold text-purple-700">▶ ทดสอบ</p>
                        <p className="text-gray-600">ใช้ทดลองรันโค้ดกับตัวอย่าง test case ที่มองเห็นได้ กดกี่ครั้งก็ได้ ไม่มีผลต่อคะแนน</p>
                        <p className="text-xs text-gray-400 mt-1">Try your code against the visible sample test cases. Unlimited attempts — does not affect your score.</p>
                     </div>
                     <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                        <p className="font-bold text-green-700">✓ ส่งคำตอบ</p>
                        <p className="text-gray-600">ใช้เมื่อพร้อมให้ตรวจจริง (รวม test case ที่ซ่อนอยู่ด้วย) — ผลจากปุ่มนี้คือคะแนนที่คุณจะได้รับ</p>
                        <p className="text-xs text-gray-400 mt-1">Use this when you're ready to be graded for real (including hidden test cases) — this determines your score.</p>
                     </div>
                  </div>
                  <div className="flex justify-end">
                     <Button onClick={() => setShowCodeInfoModal(false)}>เข้าใจแล้ว</Button>
                  </div>
               </div>
            </div>
         )}
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
         {!browserSupported && (
            <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl flex gap-3">
               <span className="text-lg leading-none mt-0.5">⚠️</span>
               <div>
                  <p className="font-bold">กรุณาทำข้อสอบด้วย Google Chrome บนคอมพิวเตอร์</p>
                  <p className="text-sm mt-0.5">เบราว์เซอร์ที่คุณใช้อยู่ไม่รองรับโหมดเต็มจอ (Fullscreen) ที่ระบบคุมสอบใช้ — รวมถึงทุกเบราว์เซอร์บน iPhone/iPad หากทำข้อสอบต่อ ระบบจะยังบันทึกการออกจากหน้าสอบตามปกติ</p>
                  <p className="text-xs text-amber-700/80 mt-1">Please take your exams in Google Chrome on a computer. Your current browser doesn't support the fullscreen mode used for proctoring (this includes every browser on iPhone/iPad). If you continue anyway, leaving the exam view is still logged.</p>
               </div>
            </div>
         )}
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
                           {isCompleted && (
                              status.autoSubmitted ? (
                                 <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-full font-bold whitespace-nowrap">⏱ Time's Up</span>
                              ) : (
                                 <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full font-bold">Completed</span>
                              )
                           )}
                        </div>
                        <p className="text-gray-500 text-sm mb-4 min-h-[40px]">{exam.description}</p>
                        {isCompleted && (
                           <div className="text-xs text-gray-400 mb-4 space-y-0.5">
                              <div>Submitted: {new Date(status.lastUpdated).toLocaleString()}</div>
                              {status.startedAt && (
                                 <div>Time used: {formatDuration(status.lastUpdated - status.startedAt)}</div>
                              )}
                           </div>
                        )}
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
               <h2 className="text-xl font-bold text-gray-900 mb-0.5">กติกาการสอบ</h2>
               <p className="text-xs text-gray-400 mb-4">Exam Rules &amp; Instructions</p>
               <div className={`text-sm mb-3 p-4 rounded-lg border ${browserSupported ? 'bg-blue-50 border-blue-100 text-blue-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                  <p className="font-bold">{browserSupported ? '🖥 ใช้ Google Chrome บนคอมพิวเตอร์เท่านั้น' : '⚠️ เบราว์เซอร์นี้ไม่รองรับ — กรุณาเปิดด้วย Google Chrome บนคอมพิวเตอร์'}</p>
                  <p className="mt-0.5">ระบบคุมสอบต้องใช้โหมดเต็มจอ (Fullscreen) ซึ่งทุกเบราว์เซอร์บน iPhone/iPad ไม่รองรับ</p>
                  <p className={`text-xs mt-1 ${browserSupported ? 'text-blue-700/80' : 'text-amber-700/80'}`}>Take this exam in Google Chrome on a computer. Proctoring requires fullscreen mode, which no browser on iPhone/iPad supports.</p>
               </div>
               <div className="space-y-3 text-gray-600 text-sm mb-6 bg-gray-50 p-4 rounded-lg">
                  <div>
                     <p>1. คุณมีเวลา <strong>{showTOS.durationMinutes} นาที</strong> ในการทำข้อสอบนี้</p>
                     <p className="text-xs text-gray-400">You have {showTOS.durationMinutes} minutes to complete this exam.</p>
                  </div>
                  <div>
                     <p>2. ห้ามรีเฟรชหน้าเว็บหรือปิดแท็บเบราว์เซอร์ซ้ำๆ</p>
                     <p className="text-xs text-gray-400">Do not refresh the page or close the browser tab repeatedly.</p>
                  </div>
                  <div>
                     <p>3. ระบบจะบันทึกความคืบหน้าอัตโนมัติทุก 30 วินาที</p>
                     <p className="text-xs text-gray-400">Your progress is saved automatically every 30 seconds.</p>
                  </div>
                  <div>
                     <p>4. เมื่อส่งคำตอบแล้ว จะไม่สามารถแก้ไขคำตอบได้อีก</p>
                     <p className="text-xs text-gray-400">Once submitted, you cannot change your answers.</p>
                  </div>
                  <div>
                     <p>5. หน้าจอจะเข้าสู่โหมดเต็มจอ (Fullscreen) อัตโนมัติ หากสลับแท็บ/สลับหน้าจอ หรือกด Esc ออกจากโหมดเต็มจอ ระบบจะบันทึกไว้เป็นการ "ออกจากหน้าสอบ" และแจ้งให้อาจารย์ทราบ</p>
                     <p className="text-xs text-gray-400">The exam will enter fullscreen mode automatically. Switching tabs/screens or pressing Esc to exit fullscreen will be logged as "leaving the exam" and shown to your instructor.</p>
                  </div>
                  <div>
                     <p>6. การทุจริตหรือพยายามทุจริตจะถูกบันทึกไว้</p>
                     <p className="text-xs text-gray-400">Malpractice or cheating attempts will be logged.</p>
                  </div>
               </div>
               <div className="flex gap-3 justify-end">
                  <Button variant="secondary" onClick={() => setShowTOS(null)}>ยกเลิก</Button>
                  <Button onClick={() => initExamSession(showTOS)}>ยอมรับ เริ่มทำข้อสอบ</Button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};