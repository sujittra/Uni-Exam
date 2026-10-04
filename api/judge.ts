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
//
// This function is also where a code question's mark is decided. Its verdict is written to
// public.judge_results, keyed by student, question and a fingerprint of the exact code that
// was judged, and api/db.ts scores a code answer from that row — never from the `passed`
// flag the browser sends back with the answer, which a student could simply set to true.
import { pgSelect, pgUpsert, isSupabaseAdminConfigured } from './_supabaseAdmin.js';
import { buildFunctionCallSource, describeEmptyCall } from './_pyHarness.js';
import { sessionFromRequest } from './_session.js';
import { codeFingerprint } from './_scoring.js';

// Only the subdomain belongs here — "abc123", not "https://abc123.compilers.sphere-engine.com".
// Pasting the whole endpoint builds a host that doesn't resolve, and the only symptom used
// to be "fetch failed" on every test case, which says nothing about where to look.
const SPHERE_SUBDOMAIN = String(process.env.SPHERE_ENGINE_SUBDOMAIN || '')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\.compilers\.sphere-engine\.com.*$/, '')
  .replace(/\/.*$/, '');
const SPHERE_TOKEN = String(process.env.SPHERE_ENGINE_TOKEN || '').trim();
const SPHERE_HOST = `${SPHERE_SUBDOMAIN}.compilers.sphere-engine.com`;
const BASE_URL = `https://${SPHERE_HOST}/api/v4`;

// A network-level failure (host doesn't resolve, connection refused) arrives as a bare
// "fetch failed", which reads like a bug in this app rather than a setting to correct.
const describeTransportFailure = (e: any) => {
  const cause = e?.cause?.code || e?.code || '';
  if (/ENOTFOUND|EAI_AGAIN/.test(String(cause))) {
    return `ติดต่อ ${SPHERE_HOST} ไม่ได้ (ไม่รู้จักโฮสต์นี้) — ตรวจค่า SPHERE_ENGINE_SUBDOMAIN ใน Vercel ว่าใส่เฉพาะชื่อ subdomain ไม่ใช่ URL เต็ม`;
  }
  if (cause) return `ติดต่อ ${SPHERE_HOST} ไม่สำเร็จ (${cause})`;
  return `ติดต่อ ${SPHERE_HOST} ไม่สำเร็จ: ${e?.message || e}`;
};

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
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/submissions?access_token=${SPHERE_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compilerId, source, input, timeLimit: 10 }),
    });
  } catch (e: any) {
    throw new Error(describeTransportFailure(e));
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Sphere Engine ปฏิเสธ access token (HTTP ${res.status}) — ตรวจค่า SPHERE_ENGINE_TOKEN ใน Vercel`);
  }
  const data: any = await res.json().catch(() => null);
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

async function gradeTestCase(
  code: string,
  compilerId: number,
  tc: TestCaseInput,
  index: number,
  functionMode: boolean
): Promise<GradeResult> {
  try {
    if (functionMode && !String(tc.input || '').trim()) {
      return { passed: false, line: describeEmptyCall(index) };
    }
    // In 'function' mode the test case input is a call expression compiled into the source
    // instead of being piped to stdin, so the program gets no stdin at all.
    const source = functionMode ? buildFunctionCallSource(code, tc.input) : code;
    const id = await createSubmission(source, compilerId, functionMode ? '' : tc.input);
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
        : `Test Case ${index + 1}: ${functionMode ? 'Call' : 'Input'} [${tc.input}] \n   -> Expected [${normalizedExpected}] \n   -> Actual   [${normalizedActual}] (${passed ? 'PASS' : 'FAIL'})`,
    };
  } catch (e: any) {
    return { passed: false, line: `[System Error] Test Case ${index + 1}: ${e?.message || e}` };
  }
}

// GET /api/judge — is the judge actually usable right now?
//
// Listing the compilers costs no submission quota, so this answers "will grading work" and
// "is the language this app asks for still on the plan" without spending anything. Teachers
// only: it reports on a server setting, and the subdomain is not a student's business.
// Worth having because the failures seen here have all been account-level (an expired free
// plan, then a mistyped subdomain) and none of them were visible without burning a
// submission to find out.
async function reportStatus(res: any) {
  if (!SPHERE_SUBDOMAIN || !SPHERE_TOKEN) {
    res.status(200).json({
      ok: false,
      host: SPHERE_HOST,
      error: 'ยังไม่ได้ตั้ง SPHERE_ENGINE_SUBDOMAIN หรือ SPHERE_ENGINE_TOKEN ใน Vercel',
    });
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/compilers?access_token=${SPHERE_TOKEN}`);
  } catch (e: any) {
    res.status(200).json({ ok: false, host: SPHERE_HOST, error: describeTransportFailure(e) });
    return;
  }

  const body: any = await response.json().catch(() => null);
  if (!response.ok) {
    res.status(200).json({
      ok: false,
      host: SPHERE_HOST,
      status: response.status,
      error: body?.message || `Sphere Engine ตอบ HTTP ${response.status}`,
    });
    return;
  }

  const compilers: any[] = body?.items || body?.compilers || (Array.isArray(body) ? body : []);
  const available = compilers.map((c: any) => ({ id: c.id, name: c.name }));
  const missing = Object.entries(COMPILER_IDS)
    .filter(([, id]) => !available.some((c) => c.id === id))
    .map(([language, id]) => `${language} (id ${id})`);

  res.status(200).json({
    ok: missing.length === 0,
    host: SPHERE_HOST,
    compilerCount: available.length,
    required: COMPILER_IDS,
    missing,
    python3: available.find((c) => c.id === COMPILER_IDS.python3) || null,
    java: available.find((c) => c.id === COMPILER_IDS.java) || null,
    // Which Python the judge offers matters more than it looks: the "ทดสอบ" button runs
    // Pyodide, which is Python 3.12, so a judge stuck on an older 3.x fails code that
    // passed in the browser moments earlier — an f-string is a syntax error before 3.6.
    // Listing the candidates here is how that gets noticed and corrected.
    python: available.filter((c) => /python/i.test(String(c.name))),
    compilers: available,
  });
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ passed: false, output: 'Method not allowed' });
      return;
    }

    // Grading costs money and quota, and the verdict it records is what a mark is made of,
    // so it is not something an anonymous caller gets to trigger.
    const session = sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ passed: false, output: 'System Error: Please sign in again — your session has expired.' });
      return;
    }

    if (req.method === 'GET') {
      if (session.role !== 'TEACHER') {
        res.status(403).json({ ok: false, error: 'Teachers only.' });
        return;
      }
      await reportStatus(res);
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

    const { data: questions, error: qError } = await pgSelect<any[]>(
      'questions',
      `id=eq.${questionId}&select=test_cases,input_mode`
    );
    const question = questions?.[0];
    if (qError || !question) {
      res.status(200).json({ passed: false, output: `System Error: Could not load question (${qError?.message || 'not found'}).` });
      return;
    }
    const { data: hiddenRows, error: hError } = await pgSelect<any[]>(
      'question_hidden_test_cases',
      `question_id=eq.${questionId}&select=input,output`
    );
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
    // 'function' mode compiles the call expression into the source, which only the Python
    // harness knows how to build — any other language falls back to stdin.
    const functionMode = question.input_mode === 'function' && language === 'python3';

    const results = await Promise.all(testCases.map((tc, i) => gradeTestCase(code, compilerId, tc, i, functionMode)));

    const fatal = results.find((r) => r.fatal);
    const allPassed = !fatal && results.every((r) => r.passed);

    // Record the verdict against the code that produced it. A student who edits their
    // answer afterwards no longer matches this fingerprint, so the mark goes with the code
    // it was earned by. Teachers can run the judge too (to try a question out); those runs
    // are not anyone's answer, so they are not recorded.
    if (session.role === 'STUDENT' && session.studentId) {
      await pgUpsert(
        'judge_results',
        [{
          student_id: session.studentId,
          question_id: questionId,
          code_fingerprint: codeFingerprint(code),
          passed: allPassed,
          updated_at: new Date().toISOString(),
        }],
        'student_id,question_id'
      ).catch(() => {
        // A failed write must not cost the student their result on screen; db.ts will just
        // not find a passing verdict, and the console output still tells them where they
        // stand.
      });
    }

    if (fatal) {
      res.status(200).json({ passed: false, output: `Compiling and running on remote judge...\n\n${fatal.line}\n` });
      return;
    }

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
