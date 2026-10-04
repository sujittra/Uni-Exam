
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

The "ทดสอบ" test button runs Python in the browser via Pyodide and needs no configuration.

## Deploying this change to an existing database

Order matters: the live site talks to the database directly until the new build replaces it.

1. Set the environment variables above and deploy.
2. Run [migrations/001_lockdown.sql](migrations/001_lockdown.sql) in the Supabase SQL editor.
3. In Storage → `exam-images` → Policies, remove any INSERT/UPDATE/DELETE policy granted to
   anon or public, keeping SELECT.

Teacher passwords were stored in plain text. Nothing has to be reset: the first successful
login after the deploy replaces that row with a hash of the same password. Accounts that
never log in keep their plain text value, which is unreadable from outside the functions
once step 2 is done — but they were readable for as long as the anon key was, so changing
them is still worth doing.
