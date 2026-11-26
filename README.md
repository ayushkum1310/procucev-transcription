# Speech Desk

A static React app for microphone transcription and editable transcript history. Whisper processes audio on the device in a Web Worker. The application does not upload recordings or call a speech API.

## Run locally

Run `npm ci --ignore-scripts` and `npm run dev`, then open the localhost URL in desktop Chrome. Select Hindi / Hinglish or English and click **Start recording**. The first use of each mode downloads model weights and caches them in the browser. Allow microphone access and begin talking when the page shows **Recording** and the input meter. The transcript appears in short updates while you speak. Press **Stop recording** to process the remaining audio.

Hindi / Hinglish uses the Whisper Hindi2Hinglish Swift checkpoint fine-tuned for code switching and outputs Hindi in Latin script. English uses Whisper Base. The live preview waits for enough audio to give the recognizer context and can revise words as more speech arrives. Accuracy and speed depend on the device, microphone, and speech.

## Deploy to Vercel

Import `ayushkum1310/procucev-transcription` from GitHub and deploy `main` from the repository root. The Vercel config builds with Vite and publishes `dist`. No environment variables, API keys, or backend are required. The app downloads the model weights from Hugging Face.

Saved transcripts use localStorage and stay in the current browser profile and site origin. This frontend-only version does not fulfill the original relational database requirement. The earlier FastAPI, Whisper, and PostgreSQL version is available at commit `534ffc1`.
