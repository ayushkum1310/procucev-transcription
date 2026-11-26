# Speech Desk

A static React app for live microphone transcription and editable transcript history.

Run `npm ci` and `npm run dev`. Open the localhost URL Vite prints, select a language, and allow microphone access when you start recording. Press Stop to review, edit, and save.

## Deploy to Vercel

Import `ayushkum1310/procucev-transcription` from GitHub and deploy the `main` branch with the repository root as the project root. The included Vercel configuration builds the app with `npm run build` and publishes `dist`. No environment variables, API keys, or separate services are required.

## Speech and storage

Use Chrome on localhost or HTTPS. The Web Speech API can send microphone audio to the browser vendor's recognition service and may need internet access. Recognition uses one selected language at a time. Mixed Hindi and English recognition depends on the browser and is not guaranteed.

History uses localStorage and stays in the current browser profile and site origin. The original FastAPI, Whisper, and PostgreSQL implementation is available at commit `534ffc1`. This static version does not meet the original assignment's relational database requirement.
