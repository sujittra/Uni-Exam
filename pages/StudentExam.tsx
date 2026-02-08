import React, { useState, useEffect } from 'react';
import { User, Exam, Question, QuestionType, StudentProgress } from '../types';
import { getExamsForStudent, submitStudentProgress, compileJavaCode } from '../services/dataService';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

interface StudentExamProps {
  user: User;
  onLogout: () => void;
}

export const StudentExam: React.FC<StudentExamProps> = ({ user, onLogout }) => {
  const [availableExams, setAvailableExams] = useState<Exam[]>([]);
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  
  // Compiler State
  const [codeOutput, setCodeOutput] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);

  useEffect(() => {
    loadExams();
  }, []);

  useEffect(() => {
    if (activeExam && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
           if(prev <= 1) {
             finishExam();
             return 0;
           }
           return prev - 1;
        });
        // Sync progress every 30 seconds
        if(timeLeft % 30 === 0) syncProgress();
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [activeExam, timeLeft]);

  const loadExams = async () => {
    const exams = await getExamsForStudent(user);
    setAvailableExams(exams);
  };

  const startExam = (exam: Exam) => {
    setActiveExam(exam);
    setTimeLeft(exam.durationMinutes * 60);
    setCurrentQuestionIdx(0);
    setAnswers({});
    syncProgress(exam.id, 0, {}, 'IN_PROGRESS');
  };

  const syncProgress = (examId = activeExam?.id, idx = currentQuestionIdx, currAnswers = answers, status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS') => {
    if (!examId) return;
    const progress: StudentProgress = {
      studentId: user.studentId!,
      studentName: user.name,
      examId: examId,
      currentQuestionIndex: idx,
      answers: currAnswers,
      score: 0, // Calculated on backend usually
      status,
      lastUpdated: Date.now()
    };
    submitStudentProgress(progress);
  };

  const handleAnswer = (val: any) => {
    const newAnswers = { ...answers, [activeExam!.questions[currentQuestionIdx].id]: val };
    setAnswers(newAnswers);
  };

  const runCode = async (code: string, question: Question) => {
    setIsCompiling(true);
    setCodeOutput('Compiling and Running Tests...');
    
    // Simulate API call to Java Compiler
    const result = await compileJavaCode(code, question.testCases || []);
    
    setCodeOutput(result.output);
    setIsCompiling(false);
  };

  const nextQuestion = () => {
    if (currentQuestionIdx < activeExam!.questions.length - 1) {
      const nextIdx = currentQuestionIdx + 1;
      setCurrentQuestionIdx(nextIdx);
      syncProgress(activeExam!.id, nextIdx, answers);
      setCodeOutput(''); // Reset output for next Q
    }
  };

  const finishExam = () => {
    syncProgress(activeExam!.id, currentQuestionIdx, answers, 'COMPLETED');
    alert('Exam Submitted Successfully!');
    setActiveExam(null);
    loadExams(); // Refresh list
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- RENDER ---

  if (activeExam) {
    const question = activeExam.questions[currentQuestionIdx];
    const isLast = currentQuestionIdx === activeExam.questions.length - 1;

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
             <Button variant="danger" size="sm" onClick={finishExam}>Submit Exam</Button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Question Panel */}
          <div className="w-1/3 bg-white border-r border-gray-200 overflow-y-auto p-6">
            {question.imageUrl && (
              <img src={question.imageUrl} alt="Question Illustration" className="w-full h-auto rounded-lg mb-4 object-contain max-h-64 border border-gray-100" />
            )}
            
            <h2 className="text-lg font-semibold text-gray-800 mb-4 whitespace-pre-wrap">{question.text}</h2>
            
            {question.type === QuestionType.MULTIPLE_CHOICE && (
              <div className="space-y-3">
                {question.options?.map((opt, idx) => (
                  <label key={idx} className={`block p-4 rounded-lg border-2 cursor-pointer transition-all ${answers[question.id] === idx ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-200'}`}>
                    <input 
                      type="radio" 
                      name="option" 
                      className="hidden"
                      checked={answers[question.id] === idx}
                      onChange={() => handleAnswer(idx)}
                    />
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center border text-xs ${answers[question.id] === idx ? 'bg-purple-500 border-purple-500 text-white' : 'border-gray-400 text-gray-500'}`}>
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span className="text-gray-700">{opt}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {question.type === QuestionType.JAVA_CODE && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800 mb-4">
                <h4 className="font-bold mb-1">Requirements:</h4>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Language: Java 17</li>
                  <li>Check the test cases below for expected I/O.</li>
                </ul>
              </div>
            )}
            
             {/* Test Cases Display for Code */}
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

          {/* Answer Area (Right Panel) */}
          <div className="flex-1 bg-gray-50 flex flex-col">
            
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
                  className="flex-1 w-full bg-[#1e1e1e] text-gray-100 font-mono p-4 rounded-lg focus:outline-none resize-none text-sm"
                  placeholder={`public class Main {\n  public static void main(String[] args) {\n    // Write your code here\n  }\n}`}
                  value={answers[question.id] || ''}
                  onChange={(e) => handleAnswer(e.target.value)}
                  spellCheck={false}
                />
                <div className="h-32 bg-black text-green-400 font-mono text-sm p-4 mt-4 rounded-lg overflow-y-auto border border-gray-700">
                   <div className="text-gray-500 text-xs border-b border-gray-700 pb-1 mb-1">Console Output</div>
                   <pre>{codeOutput || '> Ready to compile...'}</pre>
                </div>
              </div>
            )}

            {/* Short Answer Input */}
            {question.type === QuestionType.SHORT_ANSWER && (
              <div className="flex-1 flex flex-col justify-center items-center p-8">
                <div className="w-full max-w-2xl">
                   <label className="block text-gray-700 font-bold mb-3">Your Answer</label>
                   <textarea
                     className="w-full p-6 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-100 focus:border-purple-500 outline-none transition-all text-lg"
                     rows={6}
                     placeholder="Type your answer here..."
                     value={answers[question.id] || ''}
                     onChange={(e) => handleAnswer(e.target.value)}
                   />
                   <p className="mt-3 text-sm text-gray-400">Please answer concisely.</p>
                </div>
              </div>
            )}
            
            {/* Empty State for MCQ (since answers are on left) */}
            {question.type === QuestionType.MULTIPLE_CHOICE && (
              <div className="flex-1 flex items-center justify-center text-gray-400 select-none">
                <div className="text-center">
                  <span className="text-6xl opacity-20 block mb-4">✍️</span>
                  <p>Select the best option from the left panel.</p>
                </div>
              </div>
            )}
            
            {/* Footer Navigation */}
            <div className="bg-white p-4 border-t border-gray-200 flex justify-end">
               {isLast ? (
                  <Button variant="danger" onClick={finishExam}>Finish & Submit</Button>
               ) : (
                  <Button onClick={nextQuestion}>Next Question &rarr;</Button>
               )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Lobby View
  return (
    <div className="min-h-screen bg-purple-50">
       <nav className="bg-white shadow-sm p-4 sticky top-0 z-10">
         <div className="container mx-auto flex justify-between items-center">
            <div className="font-bold text-purple-800 text-lg">UniExam Pro <span className="text-gray-400 font-normal ml-2">| Student Portal</span></div>
            <div className="flex items-center gap-4">
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
             {availableExams.map(exam => (
               <Card key={exam.id} title={exam.title} className="hover:ring-2 hover:ring-purple-300 transition-all">
                  <div className="mb-4 text-gray-600 text-sm h-12 overflow-hidden">{exam.description}</div>
                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
                    <span className="flex items-center gap-1">⏱ {exam.durationMinutes} mins</span>
                    <span className="flex items-center gap-1">📝 {exam.questions.length} Questions</span>
                  </div>
                  <Button className="w-full" onClick={() => startExam(exam)}>Start Exam</Button>
               </Card>
             ))}
           </div>
         )}
       </div>
    </div>
  );
};