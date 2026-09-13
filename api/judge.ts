// Vercel serverless function — proxies code grading to the Sphere Engine Compilers API.
// Runs server-side only: SPHERE_ENGINE_SUBDOMAIN / SPHERE_ENGINE_TOKEN never reach the client.
// Set these in the Vercel project's Environment Variables (Settings > Environment Variables).
//
// The client sends only { questionId, code, language } — never test case content. This
// function looks up the question's own visible test cases AND its hidden ones (via the
// service_role key, which bypasses the RLS that blocks anon/authenticated from reading
// question_hidden_test_cases) so hidden test data never has to pass through the student's
// browser at all.
//
// Test cases are graded IN PARALLEL (not one-by-one) — each one is its own create+poll+
// fetch round trip to Sphere Engine, and running them sequentially risked exceeding the
// Vercel function's execution time limit with more than a couple of test cases.
import { supabaseAdmin, isSupabaseAdminConfigured } from './_supabaseAdmin';

const SPHERE_SUBDOMAIN = process.env.SPHERE_ENGINE_SUBDOMAIN;
const SPHERE_TOKEN = process.env.SPHERE_ENGINE_TOKEN;
const BASE_URL = `https://${SPHERE_SUBDOMAIN}.compilers.sphere-engine.com/api/v4`;

// Sphere Engine compiler IDs (from https://sphere-engine.com/supported-languages)
const COMPILER_IDS: Record<string, number> = {
  java: 10,     // "Java"
  python3: 116, // "Python 3.x"
};

interface TestCaseInput {
  input: string;
  output: string;
  hidden?: boolean;
}

interface GradeResult {
  passed: boolean;
  line: string;
  fatal?: boolean; // compilation error — identical for every test case, only show once
}

const normalize = (s: any) => String(s || '').replace(/\s+/g, ' ').trim();

async function createSubmission(source: string, compilerId: number, input: string): Promise<number> {
  const res = await fetch(`${BASE_URL}/submissions?access_token=${SPHERE_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compilerId, source, input, timeLimit: 10 }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.message || `Sphere Engine create-submission error ${res.status}`);
  return data.id;
}

async function pollSubmission(id: number, maxWaitMs = 25000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${BASE_URL}/submissions/${id}?access_token=${SPHERE_TOKEN}`);
    const data: any = await res.json();
    if (!res.ok) throw new Error(data?.message || `Sphere Engine poll error ${res.status}`);
    if (!data.executing) return data;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Timed out waiting for the judge to finish.');
}

async function fetchStream(id: number, stream: 'output' | 'error' | 'cmpinfo'): Promise<string> {
  const res = await fetch(`${BASE_URL}/submissions/${id}/${stream}?access_token=${SPHERE_TOKEN}`);
  if (!res.ok) return '';
  return await res.text();
}

async function gradeTestCase(code: string, compilerId: number, tc: TestCaseInput, index: number): Promise<GradeResult> {
  try {
    const id = await createSubmission(code, compilerId, tc.input);
    const result = await pollSubmission(id);
    const statusCode = result.result?.status?.code;

    // Status codes: https://docs.sphere-engine.com/compilers/submission-status
    if (statusCode === 11) {
      const cmpinfo = await fetchStream(id, 'cmpinfo');
      return { passed: false, fatal: true, line: `[Compilation Error]\n${cmpinfo}` };
    }
    if (statusCode === 12 || statusCode === 19) {
      const error = await fetchStream(id, 'error');
      return {
        passed: false,
        line: tc.hidden
          ? `Test Case ${index + 1}: [Hidden] (FAIL - runtime error)`
          : `[Runtime Error] (Test Case ${index + 1})\n${error}`,
      };
    }
    if (statusCode === 13) {
      return {
        passed: false,
        line: tc.hidden ? `Test Case ${index + 1}: [Hidden] (FAIL - time limit exceeded)` : `[Time Limit Exceeded] (Test Case ${index + 1})`,
      };
    }
    if (statusCode !== 15) {
      return { passed: false, line: `[Judge Error] Test Case ${index + 1}: status code ${statusCode} (${result.result?.status?.name || 'unknown'})` };
    }

    const stdout = await fetchStream(id, 'output');
    const normalizedExpected = normalize(tc.output);
    const normalizedActual = normalize(stdout);
    const passed = normalizedActual === normalizedExpected;

    return {
      passed,
      line: tc.hidden
        ? `Test Case ${index + 1}: [Hidden] (${passed ? 'PASS' : 'FAIL'})`
        : `Test Case ${index + 1}: Input [${tc.input}] \n   -> Expected [${normalizedExpected}] \n   -> Actual   [${normalizedActual}] (${passed ? 'PASS' : 'FAIL'})`,
    };
  } catch (e: any) {
    return { passed: false, line: `[System Error] Test Case ${index + 1}: ${e?.message || e}` };
  }
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ passed: false, output: 'Method not allowed' });
      return;
    }

    if (!SPHERE_SUBDOMAIN || !SPHERE_TOKEN) {
      res.status(200).json({
        passed: false,
        output: 'System Error: Judge is not configured. Set SPHERE_ENGINE_SUBDOMAIN and SPHERE_ENGINE_TOKEN in the Vercel project environment variables.',
      });
      return;
    }
    if (!isSupabaseAdminConfigured()) {
      res.status(200).json({
        passed: false,
        output: 'System Error: Server is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel project environment variables.',
      });
      return;
    }

    const { questionId, code, language } = (req.body || {}) as {
      questionId?: string;
      code?: string;
      language?: string;
    };

    if (!code || !String(code).trim()) {
      res.status(200).json({ passed: false, output: 'Error: Code is empty.' });
      return;
    }
    if (!questionId) {
      res.status(200).json({ passed: false, output: 'System Error: Missing questionId.' });
      return;
    }

    const supabase = supabaseAdmin!;
    const { data: question, error: qError } = await supabase
      .from('questions')
      .select('test_cases')
      .eq('id', questionId)
      .single();
    if (qError || !question) {
      res.status(200).json({ passed: false, output: `System Error: Could not load question (${qError?.message || 'not found'}).` });
      return;
    }
    const { data: hiddenRows, error: hError } = await supabase
      .from('question_hidden_test_cases')
      .select('input, output')
      .eq('question_id', questionId);
    if (hError) {
      res.status(200).json({ passed: false, output: `System Error: Could not load hidden test cases (${hError.message}).` });
      return;
    }

    const testCases: TestCaseInput[] = [
      ...((question.test_cases || []) as TestCaseInput[]).map((tc) => ({ ...tc, hidden: false })),
      ...(hiddenRows || []).map((tc: any) => ({ input: tc.input, output: tc.output, hidden: true })),
    ];

    if (testCases.length === 0) {
      res.status(200).json({ passed: false, output: 'This question has no test cases configured.' });
      return;
    }

    const compilerId = COMPILER_IDS[language || 'java'] || COMPILER_IDS.java;

    const results = await Promise.all(testCases.map((tc, i) => gradeTestCase(code, compilerId, tc, i)));

    const fatal = results.find((r) => r.fatal);
    if (fatal) {
      res.status(200).json({ passed: false, output: `Compiling and running on remote judge...\n\n${fatal.line}\n` });
      return;
    }

    const allPassed = results.every((r) => r.passed);
    const output = `Compiling and running on remote judge...\n\n${results.map((r) => r.line).join('\n')}\n`;
    res.status(200).json({ passed: allPassed, output });
  } catch (e: any) {
    // Last-resort safety net so an unexpected exception never surfaces as a raw 500 —
    // the student just sees a readable error in the console instead.
    try {
      res.status(200).json({ passed: false, output: `System Error: ${e?.message || e}` });
    } catch {
      // response already sent; nothing more we can do
    }
  }
}
