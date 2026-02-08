import React, { useState, useEffect, useRef } from 'react';
import { User, Exam, Question, QuestionType, StudentProgress } from '../types';
import { getExamsForStudent, submitStudentProgress, compileJavaCode, getStudentProgress } from '../services/dataService';
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

    if (finalData && finalData.status === 'COMPLETED') {
        alert("You have already completed this exam.");
        await loadExamsAndStatus();
        return;
    }

    let startTime = Date.now();
    let startIdx = 0;
    let savedAnswers = {};

    if (finalData && finalData.status === 'IN_PROGRESS' && finalData.startedAt) {
      startTime = finalData.startedAt;
      startIdx = finalData.currentQuestionIndex || 0;
      savedAnswers = finalData.answers || {};
    } else {
      await syncProgress(exam.id, 0, {}, 'IN_PROGRESS', startTime);
      saveToLocal(exam.id, 0, {}, startTime, 'IN_PROGRESS');
    }

    setExamStartTime(startTime);
    setCurrentQuestionIdx(startIdx);
    
    // Initialize both State and Ref
    setAnswers(savedAnswers);
    answersRef.current = savedAnswers;
    
    setActiveExam(exam);
    setShowTOS(null);
  };

  const syncProgress = async (examId: string, idx: number, currAnswers: any, status: 'IN_PROGRESS' | 'COMPLETED', startedAt: number, silent = false) => {
    // Double check we aren't sending empty answers if we have them in ref
    const finalAnswers = Object.keys(currAnswers).length > 0 ? currAnswers : answersRef.current;
    
    const progress: StudentProgress = {
      studentId: user.studentId!,
      studentName: user.name,
      examId: examId,
      currentQuestionIndex: idx,
      answers: finalAnswers,
      score: 0,
      status,
      startedAt: startedAt,
      lastUpdated: Date.now()
    };
    
    saveToLocal(examId, idx, finalAnswers, startedAt, status);
    const result = await submitStudentProgress(progress); 
    if (!result.success && !silent) {
        alert("Warning: Failed to save progress to server. Check your connection.");
    }
  };

  const saveToLocal = (examId: string, idx: number, currAnswers: any, startedAt: number, status: string) => {
      const key = getStorageKey(user.studentId!, examId);
      const data = {
          studentId: user.studentId!,
          examId,
          currentQuestionIndex: idx,
          answers: currAnswers,
          status,
          startedAt,
          lastUpdated: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(data));
  };

  const handleAnswer = (val: any) => {
    const qId = activeExam!.questions[currentQuestionIdx].id;
    const newAnswers = { ...answers, [qId]: val };
    
    // Update State (for UI)
    setAnswers(newAnswers);
    // Update Ref (for Sync logic)
    answersRef.current = newAnswers;
    
    saveToLocal(activeExam!.id, currentQuestionIdx, newAnswers, examStartTime, 'IN_PROGRESS');
  };

  const runCode = async (code: string, question: Question) => {
    setIsCompiling(true);
    setCodeOutput('Compiling and Running Tests...');
    const result = await compileJavaCode(code, question.testCases || []);
    setCodeOutput(result.output);
    setIsCompiling(false);
  };

  const nextQuestion = () => {
    if (currentQuestionIdx < activeExam!.questions.length - 1) {
      const nextIdx = currentQuestionIdx + 1;
      setCurrentQuestionIdx(nextIdx);
      
      // Use Ref to ensure we send the latest answers
      saveToLocal(activeExam!.id, nextIdx, answersRef.current, examStartTime, 'IN_PROGRESS');
      syncProgress(activeExam!.id, nextIdx, answersRef.current, 'IN_PROGRESS', examStartTime, true);
      
      setCodeOutput(''); 
    }
  };

  const prevQuestion = () => {
    if (currentQuestionIdx > 0) {
      const prevIdx = currentQuestionIdx - 1;
      setCurrentQuestionIdx(prevIdx);
      saveToLocal(activeExam!.id, prevIdx, answersRef.current, examStartTime, 'IN_PROGRESS');
    }
  };

  const finishExam = async (force = false) => {
    if (!activeExam) return;

    if (!force && !window.confirm("Are you sure you want to submit? You cannot undo this action.")) {
      return;
    }
    
    setSyncingStatus("Submitting...");
    // Use Ref to ensure absolute latest state is sent
    await syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'COMPLETED', examStartTime);
    setSyncingStatus(null);
    
    setExamStatuses(prev => ({
      ...prev,
      [activeExam.id]: {
        ...prev[activeExam.id],
        status: 'COMPLETED',
        lastUpdated: Date.now()
      }
    }));

    if(!force) alert('Exam Submitted Successfully!');
    setActiveExam(null);
    loadExamsAndStatus(); 
  };

  const formatTime = (seconds: number) => {
    if (seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (activeExam) {
    const question = activeExam.questions[currentQuestionIdx];
    const isLast = currentQuestionIdx === activeExam.questions.length - 1;
    const isFirst = currentQuestionIdx === 0;
    const isMCQ = question.type === QuestionType.MULTIPLE_CHOICE;

    return (
      <div className="min-h-screen bg-gray-100 flex flex-col h-screen overflow-hidden">
        {/* Exam Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
          <div>
            <h1 className="text-xl font-bold text-gray-800">{activeExam.title}</h1>
            <span className="text-sm text-gray-500">Question {currentQuestionIdx + 1} of {activeExam.questions.length}</span>
          </div>
          <div className="flex items-center gap-6">
             <div className="text-center">
                <span className="block text-xs text-gray-400 uppercase font-bold">Time Remaining</span>
                <span className={`text-xl font-mono font-bold ${timeLeft < 300 ? 'text-red-500 animate-pulse' : 'text-purple-600'}`}>
                  {formatTime(timeLeft)}
                </span>
             </div>
             <Button variant="danger" size="sm" onClick={() => finishExam(false)} disabled={!!syncingStatus}>
               {syncingStatus ? 'Submitting...' : 'Submit Exam'}
             </Button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden relative">
          
          {/* Main Question Area */}
          <div className={`${isMCQ ? 'w-full max-w-4xl mx-auto' : 'w-1/2 border-r border-gray-200'} bg-white overflow-y-auto p-6 transition-all duration-300`}>
            {question.imageUrl && (
              <img src={question.imageUrl} alt="Question Illustration" className="w-full h-auto rounded-lg mb-6 object-contain max-h-[400px] border border-gray-100 bg-gray-50" />
            )}
            
            <h2 className="text-xl font-semibold text-gray-800 mb-6 whitespace-pre-wrap leading-relaxed">{question.text}</h2>
            
            {/* MCQ Options */}
            {isMCQ && (
              <div className="space-y-3 mt-8 max-w-2xl mx-auto">
                {question.options?.map((opt, idx) => (
                  <label key={idx} className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${answers[question.id] === idx ? 'border-purple-600 bg-purple-50 ring-2 ring-purple-200' : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'}`}>
                    <input 
                      type="radio" 
                      name="option" 
                      className="hidden"
                      checked={answers[question.id] === idx}
                      onChange={() => handleAnswer(idx)}
                    />
                    <div className="flex items-center gap-4">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center border-2 font-bold text-sm ${answers[question.id] === idx ? 'bg-purple-600 border-purple-600 text-white' : 'border-gray-300 text-gray-500'}`}>
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span className="text-lg text-gray-700">{opt}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* Java Requirements */}
            {question.type === QuestionType.JAVA_CODE && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800 mb-4">
                 <h4 className="font-bold mb-1">Requirements:</h4>
                 <ul className="list-disc pl-4 space-y-1">
                   <li>Language: Java 17</li>
                   <li>Check the test cases below for expected I/O.</li>
                 </ul>
              </div>
            )}

             {/* Test Cases */}
             {question.type === QuestionType.JAVA_CODE && question.testCases && (
               <div className="mt-6">
                 <h4 className="text-sm font-bold text-gray-600 mb-2">Test Cases</h4>
                 <div className="space-y-2">
                   {question.testCases.map((tc, idx) => (
                     <div key={idx} className="bg-gray-50 p-2 rounded text-xs font-mono border border-gray-200">
                        <span className="text-gray-500">Input:</span> {tc.input} <br/>
                        <span className="text-gray-500">Output:</span> {tc.output}
                     </div>
                   ))}
                 </div>
               </div>
             )}
          </div>

          {/* Right Panel */}
          {!isMCQ && (
            <div className="flex-1 bg-gray-50 flex flex-col shadow-inner">
              
              {/* Java Code Editor */}
              {question.type === QuestionType.JAVA_CODE && (
                <div className="flex-1 flex flex-col p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold text-gray-500">Main.java</span>
                    <Button size="sm" onClick={() => runCode(answers[question.id] || '', question)} disabled={isCompiling}>
                      {isCompiling ? 'Running...' : 'Run & Test'}
                    </Button>
                  </div>
                  <textarea
                    className="flex-1 w-full bg-[#1e1e1e] text-gray-100 font-mono p-4 rounded-lg focus:outline-none resize-none text-sm shadow-md"
                    placeholder={`public class Main {\n  public static void main(String[] args) {\n    // Write your code here\n  }\n}`}
                    value={answers[question.id] || ''}
                    onChange={(e) => handleAnswer(e.target.value)}
                    spellCheck={false}
                  />
                  <div className="h-32 bg-black text-green-400 font-mono text-sm p-4 mt-4 rounded-lg overflow-y-auto border border-gray-700 shadow-md">
                     <div className="text-gray-500 text-xs border-b border-gray-700 pb-1 mb-1">Console Output</div>
                     <pre>{codeOutput || '> Ready to compile...'}</pre>
                  </div>
                </div>
              )}

              {/* Short Answer Input */}
              {question.type === QuestionType.SHORT_ANSWER && (
                <div className="flex-1 flex flex-col justify-center items-center p-8">
                  <div className="w-full max-w-xl">
                     <label className="block text-gray-700 font-bold mb-3 text-lg">Your Answer</label>
                     <textarea
                       className="w-full p-6 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-100 focus:border-purple-500 outline-none transition-all text-lg shadow-sm"
                       rows={6}
                       placeholder="Type your answer here..."
                       value={answers[question.id] || ''}
                       onChange={(e) => handleAnswer(e.target.value)}
                     />
                     <p className="mt-3 text-sm text-gray-400">Please answer concisely.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer Navigation */}
        <div className="bg-white p-4 border-t border-gray-200 flex justify-between items-center px-8 z-20">
            <Button 
              variant="outline" 
              onClick={prevQuestion} 
              disabled={isFirst}
              className={isFirst ? "opacity-0 pointer-events-none" : ""}
            >
              &larr; Previous
            </Button>
            
            {isLast ? (
                <Button variant="danger" onClick={() => finishExam(false)} disabled={!!syncingStatus}>
                  {syncingStatus ? 'Submitting...' : 'Finish & Submit'}
                </Button>
            ) : (
                <Button onClick={nextQuestion}>Next Question &rarr;</Button>
            )}
        </div>
      </div>
    );
  }

  // --- TOS MODAL ---
  if (showTOS) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full animate-fade-in" title="Examination Rules">
          <div className="space-y-4 text-gray-700 mb-6">
            <p>Please read the following rules carefully before starting:</p>
            <ul className="list-disc pl-5 space-y-2 text-sm">
              <li>Once you click <strong>"I Agree & Start"</strong>, the timer will begin immediately.</li>
              <li><strong>Do not close the browser.</strong> The timer continues to run on the server even if you disconnect.</li>
              <li>If you lose connection, your answers are saved locally and will sync when you reconnect.</li>
              <li>Submitting the exam is <strong>final</strong>. You cannot re-enter.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={() => initExamSession(showTOS)} className="w-full py-3">I Agree & Start Exam</Button>
            <button onClick={() => setShowTOS(null)} className="text-gray-500 text-sm hover:underline">Cancel</button>
          </div>
        </Card>
      </div>
    );
  }

  // --- LOBBY ---
  return (
    <div className="min-h-screen bg-purple-50">
       <nav className="bg-white shadow-sm p-4 sticky top-0 z-10">
         <div className="container mx-auto flex justify-between items-center">
            <div className="font-bold text-purple-800 text-lg">UniExam Pro <span className="text-gray-400 font-normal ml-2">| Student Portal</span></div>
            <div className="flex items-center gap-4">
               {syncingStatus && (
                 <div className="flex items-center gap-2 text-xs text-purple-600 bg-purple-100 px-3 py-1 rounded-full animate-pulse">
                   <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                   {syncingStatus}
                 </div>
               )}
               <div className="text-right">
                 <p className="text-sm font-bold text-gray-800">{user.name}</p>
                 <p className="text-xs text-gray-500">ID: {user.studentId}</p>
               </div>
               <Button size="sm" variant="secondary" onClick={onLogout}>Logout</Button>
            </div>
         </div>
       </nav>

       <div className="container mx-auto p-4 md:p-8">
         <h2 className="text-2xl font-bold text-gray-800 mb-6">Available Examinations</h2>
         
         {availableExams.length === 0 ? (
           <Card className="text-center py-12">
             <div className="text-6xl mb-4">🎉</div>
             <h3 className="text-xl font-medium text-gray-700">No active exams</h3>
             <p className="text-gray-500">You are all caught up! Check back later.</p>
           </Card>
         ) : (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {availableExams.map(exam => {
               const status = examStatuses[exam.id]?.status || 'IDLE';
               const isCompleted = status === 'COMPLETED';
               const isResume = status === 'IN_PROGRESS';

               return (
                 <Card key={exam.id} title={exam.title} className={`transition-all ${isCompleted ? 'opacity-70 grayscale' : 'hover:ring-2 hover:ring-purple-300'}`}>
                    <div className="mb-4 text-gray-600 text-sm h-12 overflow-hidden">{exam.description}</div>
                    <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
                      <span className="flex items-center gap-1">⏱ {exam.durationMinutes} mins</span>
                      <span className="flex items-center gap-1">📝 {exam.questions.length} Questions</span>
                    </div>
                    
                    {isCompleted ? (
                       <div className="flex gap-2">
                         <Button className="w-full" disabled variant="secondary">Exam Completed</Button>
                         {/* Manual Sync Button if user suspects issue */}
                         <button 
                            className="text-xs text-purple-500 underline" 
                            title="Click if results are missing"
                            onClick={async () => {
                               if(window.confirm("Resend results to server?")) {
                                  const localKey = getStorageKey(user.studentId!, exam.id);
                                  const localData = JSON.parse(localStorage.getItem(localKey) || '{}');
                                  if (localData) {
                                      setSyncingStatus("Resending...");
                                      await submitStudentProgress(localData);
                                      setSyncingStatus(null);
                                      alert("Results resent.");
                                  }
                               }
                            }}
                         >
                           Resync
                         </button>
                       </div>
                    ) : (
                       <Button 
                         className="w-full" 
                         variant={isResume ? 'outline' : 'primary'}
                         onClick={() => isResume ? initExamSession(exam) : setShowTOS(exam)}
                       >
                         {isResume ? 'Resume Exam' : 'Start Exam'}
                       </Button>
                    )}
                 </Card>
               );
             })}
           </div>
         )}
       </div>
    </div>
  );
};