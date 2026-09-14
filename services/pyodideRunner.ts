import { CodeInputMode, TestCase } from '../types';
// Same harness the server-side judge uses, so "ทดสอบ" and "ส่งคำตอบ" evaluate a function
// call test case identically.
import { buildFunctionCallSource, describeEmptyCall } from '../api/_pyHarness';

// Runs student Python code entirely in the browser via a Web Worker running Pyodide.
// Zero network round-trip and no external API quota — safe to call as often as the
// student wants. Only ever pass VISIBLE (non-hidden) test cases here; hidden test
// cases must stay server-side and are checked at submit time instead.

const RUN_TIMEOUT_MS = 8000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (result: WorkerResult) => void>();

interface WorkerResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker('/pyodide-worker.js');
    worker.onmessage = (e: MessageEvent) => {
      const { id, ...rest } = e.data;
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(rest as WorkerResult);
      }
    };
  }
  return worker;
}

function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

// Runs one program with the given stdin, with a hard timeout to protect against
// student code that hangs (e.g. an infinite loop) — the worker is killed and
// replaced so later runs aren't affected.
function runOnce(code: string, stdin: string): Promise<WorkerResult & { timedOut?: boolean }> {
  return new Promise((resolve) => {
    const w = getWorker();
    const id = nextId++;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pending.delete(id);
      terminateWorker();
      resolve({ success: false, timedOut: true, error: 'Timed out (possible infinite loop).' });
    }, RUN_TIMEOUT_MS);

    pending.set(id, (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    });

    w.postMessage({ id, code, stdin });
  });
}

const normalize = (str: any) => String(str || '').replace(/\s+/g, ' ').trim();

// Mirrors the output format used by the server-side judge (dataService.compileCode)
// so the console looks consistent regardless of which one ran.
export const testPythonCode = async (
  code: string,
  visibleTestCases: TestCase[],
  inputMode: CodeInputMode = 'stdin'
): Promise<{ passed: boolean; output: string }> => {
  if (!code.trim()) {
    return { passed: false, output: 'Error: Code is empty.' };
  }
  if (visibleTestCases.length === 0) {
    return { passed: false, output: 'No sample test cases to test against.' };
  }

  let finalOutput = 'Running in your browser (Pyodide)...\n\n';
  let allPassed = true;
  const functionMode = inputMode === 'function';

  for (let i = 0; i < visibleTestCases.length; i++) {
    const tc = visibleTestCases[i];
    if (functionMode && !tc.input.trim()) {
      finalOutput += `${describeEmptyCall(i)}\n`;
      allPassed = false;
      continue;
    }
    // In 'function' mode the input is a call expression compiled into the source rather
    // than piped to stdin, so the program is run with no stdin at all.
    const result = functionMode
      ? await runOnce(buildFunctionCallSource(code, tc.input), '')
      : await runOnce(code, tc.input);

    if (result.timedOut) {
      finalOutput += `[Timed Out]\n${result.error}\n`;
      return { passed: false, output: finalOutput };
    }
    if (!result.success) {
      finalOutput += `[System Error]\n${result.error}\n`;
      return { passed: false, output: finalOutput };
    }
    if (result.error) {
      finalOutput += `[Runtime Error]\n${result.error}\n`;
      return { passed: false, output: finalOutput };
    }

    const normalizedExpected = normalize(tc.output);
    const normalizedActual = normalize(result.stdout);
    const passed = normalizedActual === normalizedExpected;
    if (!passed) allPassed = false;

    finalOutput += `Test Case ${i + 1}: ${functionMode ? 'Call' : 'Input'} [${tc.input}] \n   -> Expected [${normalizedExpected}] \n   -> Actual   [${normalizedActual}] (${passed ? 'PASS' : 'FAIL'})\n`;
  }

  return { passed: allPassed, output: finalOutput };
};
