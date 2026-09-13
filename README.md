<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1BA3_dZ8EnzKw0jE67yjvFcyj2Mp_t02-

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Set `VITE_RAPIDAPI_KEY` in [.env.local](.env.local) to a RapidAPI key subscribed to the [Judge0 CE API](https://rapidapi.com/judge0-official/api/judge0-ce) (free tier available) — this powers the Java/Python code-grading runner
4. Run the app:
   `npm run dev`
