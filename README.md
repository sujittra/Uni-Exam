
## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

Code grading (the "ส่งคำตอบ" submit button) calls a Vercel serverless function ([api/judge.ts](api/judge.ts)) which forwards to the [Sphere Engine Compilers API](https://docs.sphere-engine.com/compilers/api/quickstart). Set `SPHERE_ENGINE_SUBDOMAIN` and `SPHERE_ENGINE_TOKEN` in the Vercel project's Environment Variables (never in `.env.local` — they must stay server-side). The "ทดสอบ" test button runs Python entirely in the browser via Pyodide and needs no configuration.
