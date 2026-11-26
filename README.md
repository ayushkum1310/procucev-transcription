# Speech Desk

Live Hindi and English transcription with a React dashboard, FastAPI, self-hosted Whisper, and PostgreSQL.

## Run locally

Run `docker compose up --build` and open `http://localhost:8000`. Allow the microphone and wait for **Recording** before speaking. The first session downloads model weights. The app adds text at pauses and never revises text it has already shown. Press **Stop recording** to finish the current phrase, then edit or save the transcript.

## Deploy

Deploy the repository Dockerfile to an HTTPS container host that supports WebSockets. Set `DATABASE_URL` to a PostgreSQL connection string and use `/health` for the health check. The container honors the host's `PORT` variable and serves the React build and WebSocket endpoint on the same origin. The frontend does not need a separate Vercel project.

The default model is Whisper Large V3 Turbo. The CPU image is usable for development, but use a GPU host for a live demo. On a compatible NVIDIA host, build with `docker build --build-arg WITH_CUDA=1 -t speechdesk .`, give the container GPU access, and set `WHISPER_DEVICE=cuda`. `WHISPER_MODEL` accepts a Faster Whisper model ID or a local CTranslate2 model directory. Configure permanent storage for PostgreSQL and, if available, the Hugging Face cache.

## Recognition and storage

The browser streams 16 kHz PCM to FastAPI. Silero detects voiced spans and short pauses. The backend runs Whisper once per span and sends only committed text. During continuous speech, it bounds spans so the page can still update. Timing and recognition accuracy depend on the audio and inference hardware.

PostgreSQL stores saved transcript text and metadata. Audio is processed in memory and isn't saved. An HTTP-only browser cookie scopes each browser's history. Earlier frontend-only localStorage entries remain in that browser and aren't imported automatically.
