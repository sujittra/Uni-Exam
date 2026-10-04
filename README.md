
## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

`npm run dev` serves the UI but not the functions under `api/`, which is where all data
access now lives — use `vercel dev` to run both, or `VITE_USE_MOCK=true npm run dev` for the
offline demo data in `services/dataService.ts`.

## How the app reaches its data

The browser holds no database credentials. Everything goes through the Vercel functions in
[api/](api/), which hold the Supabase `service_role` key and check a signed session token
([api/_session.ts](api/_session.ts)) issued by [api/login.ts](api/login.ts):

| Route | What it does |
| --- | --- |
| [api/login.ts](api/login.ts) | Checks credentials, returns the user and a session token |
| [api/db.ts](api/db.ts) | Every read and write, one action per operation, each stating the role it needs |
| [api/judge.ts](api/judge.ts) | Grades code and records the verdict a mark is made of |

Row Level Security is enabled with no policies on every table, so the anon key — which ships
inside any built bundle — can no longer read or write anything. Before this, that key could
read the MCQ answer keys and the teachers' passwords, rewrite questions, and set any
student's score. [migrations/001_lockdown.sql](migrations/001_lockdown.sql) applies the
change to an existing database.

What the server decides for itself, rather than believing the browser: which student is
saving (from the token, not the request body), which exams a student may see (from their own
roster row), what a set of answers is worth, and whether a code answer passed (from
`judge_results`, written only by the judge).

## Environment variables (Vercel project settings)

| Variable | Needed for |
| --- | --- |
| `SUPABASE_URL` | Everything. The project URL. |
| `SB_SERVICE_ROLE_KEY` | Everything. The `service_role` secret. (`SUPABASE_SERVICE_ROLE_KEY` is read as a fallback; it may be managed by the Vercel–Supabase integration and point at the wrong project, which is why the plain name exists.) |
| `SESSION_SECRET` | Signing session tokens. Falls back to the service role key if unset; set it to be able to invalidate every session without rotating the database key. |
| `SPHERE_ENGINE_SUBDOMAIN`, `SPHERE_ENGINE_TOKEN` | The "ส่งคำตอบ" button — [Sphere Engine Compilers API](https://docs.sphere-engine.com/compilers/api/quickstart). |
| `TEACHER_SIGNUP_CODE` | Creating teacher accounts. **Unset means no one can register.** A teacher account sees every exam and answer key, so sign-up needs an invite code; set it while adding a colleague, then clear it. |

None of these belong in `.env.local` — that file is bundled into the browser.

## The two Pythons

A code question is run by two different interpreters, and they disagree:

| Button | Runs on | Version |
| --- | --- | --- |
| ทดสอบ | Pyodide, in the browser | 3.12 |
| ส่งคำตอบ | Sphere Engine compiler 116 | **3.5.3** (January 2017) |

The account's other Python 3 entries (119 "Python 3 ML/AI", 126 "Python 3 nbc") answer
`Compiler version not found`, so there is nothing newer to point `COMPILER_IDS.python3` at.
Write model answers against 3.5: an f-string, `1_000`, `x: int = 0`, `:=`, `list[int]` and
`match` all run in the browser and are syntax errors on submit — and a code answer scores
only on a passing verdict, so that is a zero.

[api/_pySyntax.ts](api/_pySyntax.ts) warns about those cases on both sides: above the test
results in the browser, while there is still time to rewrite the line, and above a
compilation error from the judge, where a 3.5 traceback says only "invalid syntax".

Two teacher-only endpoints answer "is grading going to work today" without an exam to find
out in: `GET /api/judge` lists the account's compilers (no submission quota spent), and
`GET /api/judge?version=<compilerId>` reports what that compiler says `sys.version` is (one
submission).

## Before an exam

1. **Check the judge.** Signed in as a teacher, in the browser console:
   `fetch('/api/judge', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('uniexam_session_token') } }).then(r => r.json()).then(console.log)`
   It costs no submission quota. `ok: true` and no `missing` means grading will work.
2. **Check the submission pool** on the Sphere Engine dashboard. A code question costs one
   submission per press of "ส่งคำตอบ", so a class of 118 sitting three of them needs 354 at
   a minimum — and students press it more than once. The plan is a fixed pool, not monthly.
3. **Read the model answers as Python 3.5** — see above. The browser warns students, but a
   question whose own expected output assumes a newer Python will fail everyone.
4. **Don't deploy once invigilators have the monitor open.** A tab keeps running the
   JavaScript it loaded; if the API changes under it, it stops updating until reloaded.
5. **Don't edit or re-grade an exam while it is being sat.** The dashboard warns and the
   server refuses without an explicit acknowledgement, but the clean order is Close first.

Closing an exam finishes off the attempts still open, marking them `auto_submitted` — those
are the students who never pressed Submit, and the roster shows them as TIMES UP. Their
marks are whatever had been saved, which the exam page does every 30 seconds.

## Deploying this change to an existing database

Order matters: the live site talks to the database directly until the new build replaces it.

1. Set the environment variables above and deploy.
2. Run [migrations/001_lockdown.sql](migrations/001_lockdown.sql) in the Supabase SQL editor.
3. In Storage → `exam-images` → Policies, remove any INSERT/UPDATE/DELETE policy granted to
   anon or public, keeping SELECT.
4. Run [migrations/002_score_overrides.sql](migrations/002_score_overrides.sql) **before**
   deploying the appeal feature — saving an attempt writes that column, and without it every
   save fails. Unlike 001, this one goes first.

Teacher passwords were stored in plain text. Nothing has to be reset: the first successful
login after the deploy replaces that row with a hash of the same password. Accounts that
never log in keep their plain text value, which is unreadable from outside the functions
once step 2 is done — but they were readable for as long as the anon key was, so changing
them is still worth doing.
