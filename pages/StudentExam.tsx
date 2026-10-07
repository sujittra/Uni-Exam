import React, { useState, useEffect, useRef } from 'react';
import { User, Exam, Question, QuestionType, StudentProgress } from '../types';
import { getExamsForStudent, submitStudentProgress, compileCode, getStudentProgress } from '../services/dataService';
import { testPythonCode } from '../services/pyodideRunner';
import { codeFingerprint } from '../api/_scoring';
import { examForStudent, buildOptionOrders } from '../services/shuffle';
import { effectiveDurationSeconds, timePenaltyMinutes } from '../services/examTime';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import {
  AlertTriangleIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, CodeIcon,
  InfoIcon, LockIcon, MonitorIcon, PlayIcon, RefreshIcon, UploadIcon,
} from '../components/Icons';

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

// Applied to everything that shows the QUESTION itself (text, image, choices, test cases)
// so it can't be selected, copied, dragged out or right-click-saved. The student's own
// answer fields deliberately don't get this — they still need normal copy/paste to work.
const noCopy = (className = '') => ({
   className: `select-none ${className}`.trim(),
   onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
   onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
   onCut: (e: React.ClipboardEvent) => e.preventDefault(),
   onDragStart: (e: React.DragEvent) => e.preventDefault(),
});

interface ExamRule { th: React.ReactNode; en: string }

// The exam rules, in order. Kept as data so the modal can number them and split them across
// pages without the numbers being written by hand — the shuffle rule is only present when
// the exam actually shuffles something.
const examRules = (exam: Exam): ExamRule[] => {
   const rules: ExamRule[] = [
      {
         th: <>คุณมีเวลา <strong>{exam.durationMinutes} นาที</strong> ในการทำข้อสอบนี้</>,
         en: `You have ${exam.durationMinutes} minutes to complete this exam.`,
      },
      {
         th: 'ห้ามรีเฟรชหน้าเว็บหรือปิดแท็บเบราว์เซอร์ซ้ำๆ',
         en: 'Do not refresh the page or close the browser tab repeatedly.',
      },
      {
         th: 'ระบบจะบันทึกความคืบหน้าอัตโนมัติทุก 30 วินาที',
         en: 'Your progress is saved automatically every 30 seconds.',
      },
      {
         th: 'เมื่อส่งคำตอบแล้ว จะไม่สามารถแก้ไขคำตอบได้อีก',
         en: 'Once submitted, you cannot change your answers.',
      },
      {
         th: 'หน้าจอจะเข้าสู่โหมดเต็มจอ (Fullscreen) อัตโนมัติ หากสลับแท็บ/สลับหน้าจอ หรือกด Esc ออกจากโหมดเต็มจอ ระบบจะบันทึกไว้เป็นการ "ออกจากหน้าสอบ" และแจ้งให้อาจารย์ทราบ',
         en: 'The exam will enter fullscreen mode automatically. Switching tabs/screens or pressing Esc to exit fullscreen will be logged as "leaving the exam" and shown to your instructor.',
      },
      {
         th: 'ห้ามคัดลอกโจทย์ ระบบปิดการเลือกข้อความและคลิกขวาในส่วนของโจทย์ไว้ หากกดปุ่มจับภาพหน้าจอ ระบบจะบันทึกไว้และแจ้งให้อาจารย์ทราบ',
         en: 'Copying the question text is disabled (selection and right-click are turned off). Pressing a screen-capture shortcut is logged and reported to your instructor.',
      },
   ];

   if (exam.shuffleQuestions || exam.shuffleOptions) {
      const both = exam.shuffleQuestions && exam.shuffleOptions;
      rules.push({
         th: both
            ? 'ลำดับข้อและลำดับตัวเลือกของแต่ละคนไม่เหมือนกัน — ข้อที่ 1 ของคุณอาจไม่ใช่ข้อที่ 1 ของเพื่อน'
            : exam.shuffleQuestions
               ? 'ลำดับข้อของแต่ละคนไม่เหมือนกัน — ข้อที่ 1 ของคุณอาจไม่ใช่ข้อที่ 1 ของเพื่อน'
               : 'ลำดับตัวเลือกของแต่ละคนไม่เหมือนกัน — ตัวเลือก ก. ของคุณอาจไม่ใช่ ก. ของเพื่อน',
         en: both
            ? 'Both the question order and the choice order differ from student to student.'
            : exam.shuffleQuestions
               ? 'The question order differs from student to student.'
               : 'The order of the choices differs from student to student.',
      });
   }

   // Only worth saying when it can actually happen — a limit with no penalty behind it
   // deducts nothing, so announcing it would be a threat the exam never carries out.
   if ((exam.tabSwitchPenaltyMinutes || 0) > 0) {
      const free = Math.max(0, exam.tabSwitchLimit || 0);
      const perExit = exam.tabSwitchPenaltyMinutes!;
      rules.push({
         th: <>ออกจากหน้าสอบได้ <strong>{free} ครั้ง</strong> หลังจากนั้นจะถูก<strong>หักเวลาสอบครั้งละ {perExit} นาที</strong> ทุกครั้งที่ออก</>,
         en: `You may leave the exam view ${free} time(s). Every exit after that takes ${perExit} minute(s) off your remaining time.`,
      });
   }

   rules.push({
      th: 'การทุจริตหรือพยายามทุจริตจะถูกบันทึกไว้',
      en: 'Malpractice or cheating attempts will be logged.',
   });

   return rules;
};

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
  // Counts detected screen-capture attempts. Best effort — the OS swallows some of these
  // shortcuts before the page ever sees them, so this is evidence, never enforcement.
  const captureAttemptCountRef = useRef<number>(0);
  // Suppresses the fullscreen-exit violation we trigger ourselves when the exam ends
  const isEndingExamRef = useRef(false);
  // Display order of each MCQ's choices for THIS student, as indices into the original
  // options array. Computed once per session so a re-render can't reshuffle mid-question.
  const [optionOrders, setOptionOrders] = useState<Record<string, number[]>>({});
  
  const [timeLeft, setTimeLeft] = useState(0);
  const [examStartTime, setExamStartTime] = useState<number>(0);
  
  // UI State
  const [showTOS, setShowTOS] = useState<Exam | null>(null);
  const [tosPage, setTosPage] = useState(1);
  const [showCodeInfoModal, setShowCodeInfoModal] = useState(false);
  const hasShownCodeInfoRef = useRef(false);
  const [browserSupported] = useState(isExamBrowserSupported);
  const [captureWarning, setCaptureWarning] = useState(false);
  // Minutes just taken off the clock for leaving the exam view. Shown as a toast, because
  // a countdown that silently jumps backwards reads as a bug rather than a penalty.
  const [timePenaltyNotice, setTimePenaltyNotice] = useState<number | null>(null);
  // Shown once, right after submitting: exam room PCs are shared, and the session lives
  // until the tab closes, so the next student would otherwise sit down still signed in as
  // whoever used the machine before them.
  const [justFinished, setJustFinished] = useState(false);
  
  // Compiler State
  const [codeOutput, setCodeOutput] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  // questionId -> fingerprint of the code that last passed "ทดสอบ". Holding the
  // fingerprint rather than a boolean is what makes an edit re-lock the submit button.
  const [testedOk, setTestedOk] = useState<Record<string, string>>({});

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
        // Read from the ref, not state, so a penalty incurred mid-exam shortens the clock
        // on the very next tick without the timer having to be torn down and rebuilt.
        const durationSeconds = effectiveDurationSeconds(activeExam, tabSwitchCountRef.current);
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
      const before = timePenaltyMinutes(activeExam, tabSwitchCountRef.current);
      tabSwitchCountRef.current += 1;
      const lost = timePenaltyMinutes(activeExam, tabSwitchCountRef.current) - before;
      if (lost > 0) setTimePenaltyNotice(lost);
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

  // Screen-capture detection. Deliberately NOT presented as a block: a web page cannot
  // stop an OS screenshot, and macOS in particular swallows Cmd+Shift+3/4 before the page
  // sees the keystroke. What lands here is logged for the teacher, same as a tab switch.
  useEffect(() => {
    if (!activeExam) return;

    const isCaptureShortcut = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') return true; // Windows/Linux
      // macOS screenshot shortcuts: Cmd+Shift+3/4/5 (and Ctrl variants that copy to clipboard)
      if (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key)) return true;
      // Windows Snipping Tool: Win+Shift+S
      if (e.shiftKey && e.key.toLowerCase() === 's' && (e.metaKey || e.getModifierState?.('Meta'))) return true;
      return false;
    };

    // We listen on both keydown and keyup because PrintScreen only fires keyup in some
    // browsers — so one physical press can reach us twice. Collapse anything within this
    // window into a single attempt; an inflated count would misrepresent the student.
    let lastCaptureAt = 0;
    const recordCapture = (e: KeyboardEvent) => {
      if (!isCaptureShortcut(e)) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastCaptureAt < 800) return;
      lastCaptureAt = now;
      captureAttemptCountRef.current += 1;
      setCaptureWarning(true);
      syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'IN_PROGRESS', examStartTime, true);
    };

    document.addEventListener('keyup', recordCapture);
    document.addEventListener('keydown', recordCapture);
    return () => {
      document.removeEventListener('keyup', recordCapture);
      document.removeEventListener('keydown', recordCapture);
    };
  }, [activeExam, currentQuestionIdx, examStartTime]);

  // Auto-hides the "we saw that" toast a few seconds after the last capture attempt.
  useEffect(() => {
    if (!captureWarning) return;
    const t = setTimeout(() => setCaptureWarning(false), 4000);
    return () => clearTimeout(t);
  }, [captureWarning]);

  // Same, for the "that cost you N minutes" toast. Held a little longer: it is the only
  // explanation the student gets for the countdown dropping.
  useEffect(() => {
    if (timePenaltyNotice === null) return;
    const t = setTimeout(() => setTimePenaltyNotice(null), 6000);
    return () => clearTimeout(t);
  }, [timePenaltyNotice]);

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

    // Checked again against what was just fetched, not only against the card's state: a
    // submitted attempt must stay shut even if this tab's examStatuses are stale — closing
    // the tab and opening a new one is exactly the route that used to get back in.
    //
    // The server's row decides, with finalData covering the case where the submit reached
    // localStorage but never reached the server. Reading localData on its own would lock
    // out the teacher's Allow Edit: that writes IN_PROGRESS to the database while this
    // browser's copy still says COMPLETED, and the newer row is the one that counts.
    if (dbData?.status === 'COMPLETED' || finalData?.status === 'COMPLETED') {
        document.exitFullscreen?.().catch(() => {});
        alert('คุณส่งข้อสอบชุดนี้ไปแล้ว ไม่สามารถกลับเข้าทำต่อได้\nYou have already submitted this exam.');
        loadExamsAndStatus();
        return;
    }

    // Cleared before the first save, not after it: syncProgress refuses to write anything
    // but COMPLETED while this is set, and it is still set from whatever exam was submitted
    // last — which would swallow the IDLE save that locks this exam's start time in.
    isEndingExamRef.current = false;

    let startTime = Date.now();
    if (finalData && finalData.startedAt) {
       startTime = finalData.startedAt;
    } else {
       // First time start
       // Need to save start time immediately to lock it in
       await syncProgress(exam.id, 0, {}, 'IDLE', startTime, true);
    }

    // Questions (and, below, MCQ choices) are reordered per student when the exam says so.
    // Both orders are derived from the student's id, so they survive a refresh or a resume.
    const studentExam = examForStudent(exam, user.studentId!);
    setActiveExam(studentExam);
    setOptionOrders(buildOptionOrders(studentExam, user.studentId!));
    setExamStartTime(startTime);
    setAnswers(finalData?.answers || {});
    answersRef.current = finalData?.answers || {};
    tabSwitchCountRef.current = finalData?.tabSwitchCount || 0;
    captureAttemptCountRef.current = finalData?.captureAttemptCount || 0;
    hasShownCodeInfoRef.current = false;
    setCurrentQuestionIdx(finalData?.currentQuestionIndex || 0);
    setShowTOS(null);
  };

  // Returns the score the server recorded, or null if the save didn't reach it.
  //
  // The exam page can't work the score out any more: the answer key never leaves the
  // server now, so what comes back from submitStudentProgress is both the authoritative
  // number and the only one this page has.
  const syncProgress = async (examId: string, qIdx: number, ans: Record<string, any>, status: 'IDLE' | 'IN_PROGRESS' | 'COMPLETED', startedAt: number, bg: boolean = false, autoSubmitted: boolean = false): Promise<number | null> => {
    // Once submit is under way nothing may write IN_PROGRESS again. The autosave timer and
    // the screen-capture handler stay armed until finishExam drops activeExam — which it
    // only does after a network round trip and an alert() the student has to dismiss — so
    // without this a late save lands after the COMPLETED one and reopens the attempt, both
    // in localStorage here and in the database. api/db.ts refuses the same thing server
    // side; this keeps the local copy honest too.
    if (status !== 'COMPLETED' && isEndingExamRef.current) return null;

    if (!bg) setSyncingStatus('Saving...');

    const progress: StudentProgress = {
      studentId: user.studentId!,
      studentName: user.name,
      examId,
      currentQuestionIndex: qIdx,
      answers: ans,
      score: 0, // filled in from the server's reply below
      status,
      startedAt, // Persist start time
      autoSubmitted,
      tabSwitchCount: tabSwitchCountRef.current,
      captureAttemptCount: captureAttemptCountRef.current,
      lastUpdated: Date.now()
    };

    // Save Local — answers first, so a dropped connection still leaves the work on disk.
    const storageKey = getStorageKey(user.studentId!, examId);
    localStorage.setItem(storageKey, JSON.stringify(progress));

    // Save DB
    const res = await submitStudentProgress(progress);
    if (!res.success && !bg) {
        alert("Warning: Could not save progress to server. Check internet connection.");
    }
    if (res.success) {
      // submitStudentProgress writes the server's score back onto `progress`.
      localStorage.setItem(storageKey, JSON.stringify(progress));
    }

    if (!bg) setSyncingStatus(null);
    return res.success ? progress.score : null;
  };

  const finishExam = async (force: boolean = false) => {
    if (!activeExam) return;
    if (!force && !window.confirm("Are you sure you want to submit? You cannot change answers after submission.")) return;

    isEndingExamRef.current = true;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }

    const finalScore = await syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'COMPLETED', examStartTime, false, force);
    alert(
      finalScore === null
        ? 'Exam Submitted! (ยังไม่ได้รับคะแนนจากเซิร์ฟเวอร์ — ตรวจสอบการเชื่อมต่อแล้วดูคะแนนในหน้ารายการข้อสอบ)'
        : `Exam Submitted! Your Score: ${finalScore}`
    );

    setActiveExam(null);
    setJustFinished(true);
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

    // Passing here is what unlocks "ส่งคำตอบ". The fingerprint records which code passed,
    // so editing afterwards locks it again — otherwise one passing run would license any
    // number of submissions of anything.
    setTestedOk((prev) => {
      const next = { ...prev };
      if (result.passed) next[q.id] = codeFingerprint(code);
      else delete next[q.id];
      return next;
    });
  };

  // Whether "ส่งคำตอบ" is available for the question on screen.
  //
  // The judge costs a Sphere Engine submission per press from a pool that has to last the
  // whole class, and an answer that can't even pass the test cases the student can see is
  // not going to pass the hidden ones. Gating the graded run behind a passing "ทดสอบ"
  // spends the pool on answers that have a chance.
  const submitGate = (): { allowed: boolean; reason: string } => {
    if (!activeExam) return { allowed: false, reason: '' };
    const q = activeExam.questions[currentQuestionIdx];
    // Only Python runs in the browser, so only Python can be asked to prove itself first.
    if (q.language !== 'python3') return { allowed: true, reason: '' };
    const visible = (q.testCases || []).filter((tc) => !tc.hidden);
    if (visible.length === 0) return { allowed: true, reason: '' };

    const val = answers[q.id];
    const code = (typeof val === 'object' ? val.code : val) || '';
    if (!code.trim()) return { allowed: false, reason: 'เขียนโค้ดก่อน แล้วกด "ทดสอบ"' };
    if (!testedOk[q.id]) return { allowed: false, reason: 'กด "ทดสอบ" ให้ผ่านทุก test case ก่อน จึงจะส่งคำตอบได้' };
    if (testedOk[q.id] !== codeFingerprint(code)) {
      return { allowed: false, reason: 'โค้ดถูกแก้หลังจากทดสอบผ่าน — กด "ทดสอบ" อีกครั้งก่อนส่ง' };
    }
    return { allowed: true, reason: '' };
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
    const gate = submitGate();

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

         {captureWarning && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg max-w-md text-center">
               <p className="font-bold">ตรวจพบการพยายามจับภาพหน้าจอ — บันทึกแจ้งอาจารย์แล้ว</p>
               <p className="text-xs text-red-100 mt-0.5">A screen-capture attempt was detected and has been logged for your instructor.</p>
            </div>
         )}

         {/* Sits above the capture toast so the two can't cover each other. */}
         {timePenaltyNotice !== null && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-white px-4 py-3 rounded-xl shadow-lg max-w-md text-center">
               <p className="font-bold flex items-center justify-center gap-2">
                  <ClockIcon className="w-5 h-5" />
                  ออกจากหน้าสอบ — หักเวลา {timePenaltyNotice} นาที
               </p>
               <p className="text-xs text-amber-50 mt-0.5">You left the exam view. {timePenaltyNotice} minute(s) have been deducted from your remaining time.</p>
            </div>
         )}

         {/* Exam Body */}
         <div className="container mx-auto px-4 py-6 flex-1 max-w-3xl">
            <div className="flex flex-col gap-6">

               {/* Question Panel */}
               <div {...noCopy('space-y-4 bg-white rounded-2xl shadow-sm border border-gray-200 p-6')}>
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
                        <div {...noCopy('space-y-3')}>
                           {/* `origIdx` is the choice's position in the question's own options
                               array. That — not the position on screen — is what gets stored,
                               so a shuffled exam still grades against the same answer key. */}
                           {(optionOrders[q.id] || q.options?.map((_, i) => i) || []).map(origIdx => {
                              const opt = q.options?.[origIdx];
                              const selected = answers[q.id] === String(origIdx);
                              return (
                                 <label key={origIdx} className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${selected ? 'border-purple-500 bg-purple-50' : 'border-gray-100 hover:border-purple-200'}`}>
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-purple-500' : 'border-gray-300'}`}>
                                       {selected && <div className="w-2.5 h-2.5 rounded-full bg-purple-500"></div>}
                                    </div>
                                    <input type="radio" name="mcq" className="hidden" checked={selected} onChange={() => handleAnswerChange(String(origIdx))} />
                                    <span className="text-gray-700">{opt}</span>
                                 </label>
                              );
                           })}
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
                              <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
                                 <CodeIcon className="w-4 h-4" />
                                 {q.language === 'python3' ? 'Python 3' : 'Java'}
                              </span>
                              {q.allowFileUpload !== false && (
                                 <label className="text-xs text-purple-600 font-medium cursor-pointer hover:text-purple-800 flex items-center gap-1.5">
                                    <UploadIcon className="w-4 h-4" />
                                    Upload {q.language === 'python3' ? '.py' : '.java'} file
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
                              <div {...noCopy('bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2')}>
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
                              {/* Why the submit button is locked, when it is — otherwise a
                                  disabled button looks like something is broken. */}
                              <span className={`text-xs ${gate.allowed ? 'text-gray-400' : 'text-amber-600 font-medium'}`}>
                                 {!gate.allowed
                                    ? gate.reason
                                    : q.language === 'python3'
                                       ? 'Test = instant, unlimited (sample cases only)'
                                       : 'Output console below'}
                              </span>
                              <div className="flex gap-2">
                                 {q.language === 'python3' && (
                                    <Button size="sm" variant="outline" onClick={handleTestCode} disabled={isTesting || isCompiling}>
                                       {isTesting ? 'Testing...' : <><PlayIcon className="w-4 h-4" /> ทดสอบ</>}
                                    </Button>
                                 )}
                                 <Button
                                    size="sm"
                                    onClick={handleRunCode}
                                    disabled={isCompiling || isTesting || !gate.allowed}
                                    title={gate.reason}
                                 >
                                    {isCompiling ? 'Submitting...' : (
                                       <>
                                          {gate.allowed ? <CheckIcon className="w-4 h-4" /> : <LockIcon className="w-4 h-4" />}
                                          ส่งคำตอบ
                                       </>
                                    )}
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
                        <ChevronLeftIcon className="w-4 h-4" /> Previous
                     </Button>
                     {isLast ? (
                        <Button onClick={() => finishExam(false)}>Submit Exam</Button>
                     ) : (
                        <Button onClick={() => {
                           syncProgress(activeExam.id, currentQuestionIdx, answersRef.current, 'IN_PROGRESS', examStartTime, true);
                           setCurrentQuestionIdx(prev => prev + 1);
                        }}>
                           Next Question <ChevronRightIcon className="w-4 h-4" />
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
                        <p className="font-bold text-purple-700 flex items-center gap-1.5"><PlayIcon className="w-4 h-4" /> ทดสอบ</p>
                        <p className="text-gray-600">ใช้ทดลองรันโค้ดกับตัวอย่าง test case ที่มองเห็นได้ กดกี่ครั้งก็ได้ ไม่มีผลต่อคะแนน</p>
                        <p className="text-xs text-gray-400 mt-1">Try your code against the visible sample test cases. Unlimited attempts — does not affect your score.</p>
                     </div>
                     <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                        <p className="font-bold text-green-700 flex items-center gap-1.5"><CheckIcon className="w-4 h-4" /> ส่งคำตอบ</p>
                        <p className="text-gray-600">ใช้เมื่อพร้อมให้ตรวจจริง (รวม test case ที่ซ่อนอยู่ด้วย) — ผลจากปุ่มนี้คือคะแนนที่คุณจะได้รับ</p>
                        <p className="text-xs text-gray-400 mt-1">Use this when you're ready to be graded for real (including hidden test cases) — this determines your score.</p>
                        <p className="text-gray-600 mt-2">ปุ่มนี้จะกดได้ก็ต่อเมื่อ <strong>"ทดสอบ" ผ่านครบทุก test case แล้ว</strong> และถ้าแก้โค้ดหลังจากนั้นต้องกด "ทดสอบ" ใหม่อีกครั้ง</p>
                        <p className="text-xs text-gray-400 mt-1">It unlocks only once "ทดสอบ" has passed every visible test case, and locks again if you edit the code afterwards.</p>
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
         {justFinished && (
            <div className="mb-6 bg-green-50 border-2 border-green-300 text-green-900 px-5 py-4 rounded-xl flex flex-col sm:flex-row sm:items-center gap-4">
               <div className="flex-1">
                  <p className="font-bold text-lg">ส่งข้อสอบเรียบร้อยแล้ว — กรุณาออกจากระบบก่อนลุกจากเครื่อง</p>
                  <p className="text-sm mt-0.5">เครื่องนี้เป็นเครื่องส่วนกลาง ถ้าไม่กดออกจากระบบหรือปิดแท็บ คนที่มานั่งต่อจะยังเข้าใช้งานในชื่อของคุณอยู่</p>
                  <p className="text-xs text-green-700/80 mt-1">Your exam has been submitted. Log out or close this tab before you leave — on a shared computer the next person would otherwise still be signed in as you.</p>
               </div>
               <button
                  onClick={onLogout}
                  className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-3 rounded-lg whitespace-nowrap shadow-md"
               >
                  ออกจากระบบ
               </button>
            </div>
         )}
         {!browserSupported && (
            <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl flex gap-3">
               <AlertTriangleIcon className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
               <div>
                  <p className="font-bold">กรุณาทำข้อสอบด้วย Google Chrome บนคอมพิวเตอร์</p>
                  <p className="text-sm mt-0.5">เบราว์เซอร์ที่คุณใช้อยู่ไม่รองรับโหมดเต็มจอ (Fullscreen) ที่ระบบคุมสอบใช้ — รวมถึงทุกเบราว์เซอร์บน iPhone/iPad หากทำข้อสอบต่อ ระบบจะยังบันทึกการออกจากหน้าสอบตามปกติ</p>
                  <p className="text-xs text-amber-700/80 mt-1">Please take your exams in Google Chrome on a computer. Your current browser doesn't support the fullscreen mode used for proctoring (this includes every browser on iPhone/iPad). If you continue anyway, leaving the exam view is still logged.</p>
               </div>
            </div>
         )}
         {syncingStatus && (
            <div className="mb-4 bg-blue-50 text-blue-700 px-4 py-3 rounded-lg flex items-center gap-2 animate-pulse">
               <RefreshIcon className="w-4 h-4" /> {syncingStatus}
            </div>
         )}
         
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {availableExams.length === 0 ? (
               <div className="col-span-3 text-center py-20 text-gray-400">No exams assigned to your section ({user.section}).</div>
            ) : (
               availableExams.map(exam => {
                  const status = examStatuses[exam.id];
                  const isCompleted = status?.status === 'COMPLETED';
                  // Shuffling only reorders questions, so every student's paper is worth
                  // the same total.
                  const maxScore = exam.questions.reduce((sum, q) => sum + (q.score || 0), 0);

                  return (
                     <Card key={exam.id} className="hover:shadow-lg transition-all">
                        <div className="flex justify-between items-start mb-4">
                           <h3 className="font-bold text-lg text-gray-900">{exam.title}</h3>
                           {isCompleted && (
                              status.autoSubmitted ? (
                                 <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-full font-bold whitespace-nowrap flex items-center gap-1"><ClockIcon className="w-3.5 h-3.5" /> Time's Up</span>
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
                                 <div className="text-2xl font-bold text-purple-600 leading-none">
                                    {status.score}
                                    <span className="text-base font-bold text-gray-400"> / {maxScore}</span>
                                 </div>
                                 <div className="text-xs text-gray-400 mt-1">Your Score</div>
                              </div>
                           ) : (
                              <Button onClick={() => { setTosPage(1); setShowTOS(exam); }}>
                                 {status?.status === 'IN_PROGRESS' ? 'Continue Exam' : 'Start Exam'}
                              </Button>
                           )}
                        </div>
                        {isCompleted && (
                           <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                              <InfoIcon className="w-4 h-4 shrink-0 mt-px" />
                              <span>
                                 คะแนนที่ได้จะถูกตรวจทานอีกครั้ง
                                 <span className="block text-amber-700/80 mt-0.5">This score will be reviewed again.</span>
                              </span>
                           </p>
                        )}
                     </Card>
                  );
               })
            )}
         </div>
      </main>

      {/* Terms of Service Modal — split across two pages so it fits without scrolling on a
          laptop; accepting is only possible on the last page. */}
      {showTOS && (() => {
         const rules = examRules(showTOS);
         const half = Math.ceil(rules.length / 2);
         const pages = [rules.slice(0, half), rules.slice(half)];
         const isLastPage = tosPage >= pages.length;
         return (
         <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-fade-in max-h-[90vh] flex flex-col">
               <div className="flex justify-between items-start mb-4">
                  <div>
                     <h2 className="text-xl font-bold text-gray-900 mb-0.5">กติกาการสอบ</h2>
                     <p className="text-xs text-gray-400">Exam Rules &amp; Instructions</p>
                  </div>
                  <span className="text-xs font-bold text-gray-400 bg-gray-100 rounded-full px-3 py-1 whitespace-nowrap">
                     หน้า {tosPage} / {pages.length}
                  </span>
               </div>

               <div className="overflow-y-auto flex-1">
                  {tosPage === 1 && (
                     <div className={`text-sm mb-3 p-4 rounded-lg border ${browserSupported ? 'bg-blue-50 border-blue-100 text-blue-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                        <p className="font-bold flex items-start gap-2">
                           {browserSupported
                              ? <><MonitorIcon className="w-5 h-5 shrink-0 mt-0.5" /> ใช้ Google Chrome บนคอมพิวเตอร์เท่านั้น</>
                              : <><AlertTriangleIcon className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" /> เบราว์เซอร์นี้ไม่รองรับ — กรุณาเปิดด้วย Google Chrome บนคอมพิวเตอร์</>}
                        </p>
                        <p className="mt-0.5">ระบบคุมสอบต้องใช้โหมดเต็มจอ (Fullscreen) ซึ่งทุกเบราว์เซอร์บน iPhone/iPad ไม่รองรับ</p>
                        <p className={`text-xs mt-1 ${browserSupported ? 'text-blue-700/80' : 'text-amber-700/80'}`}>Take this exam in Google Chrome on a computer. Proctoring requires fullscreen mode, which no browser on iPhone/iPad supports.</p>
                     </div>
                  )}
                  <div className="space-y-3 text-gray-600 text-sm bg-gray-50 p-4 rounded-lg">
                     {/* Numbering runs across both pages, so page 2 continues where page 1 left off. */}
                     {pages[tosPage - 1].map((rule, i) => {
                        const number = (tosPage === 1 ? 0 : half) + i + 1;
                        return (
                           <div key={number}>
                              <p>{number}. {rule.th}</p>
                              <p className="text-xs text-gray-400">{rule.en}</p>
                           </div>
                        );
                     })}
                  </div>
               </div>

               <div className="flex gap-3 justify-between items-center pt-5">
                  <Button variant="secondary" onClick={() => { setShowTOS(null); setTosPage(1); }}>ยกเลิก</Button>
                  <div className="flex gap-3">
                     {tosPage > 1 && (
                        <Button variant="secondary" onClick={() => setTosPage(p => p - 1)}><ChevronLeftIcon className="w-4 h-4" /> ย้อนกลับ</Button>
                     )}
                     {isLastPage ? (
                        // Must stay a direct click: requestFullscreen is only granted inside a
                        // user gesture.
                        <Button onClick={() => initExamSession(showTOS)}>ยอมรับ เริ่มทำข้อสอบ</Button>
                     ) : (
                        <Button onClick={() => setTosPage(p => p + 1)}>อ่านต่อ <ChevronRightIcon className="w-4 h-4" /></Button>
                     )}
                  </div>
               </div>
            </div>
         </div>
         );
      })()}
    </div>
  );
};