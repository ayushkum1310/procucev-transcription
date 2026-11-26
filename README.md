# Speech Desk

Procucev hiring assignment. A React dashboard, FastAPI WebSocket server, self-hosted multilingual Whisper, and PostgreSQL.

## Run locally

Run `docker compose up --build` in this directory and open http://localhost:8000. Allow microphone access. The first recording downloads model weights from Hugging Face and may take longer to start. Subsequent sessions reuse the model cache.

Choose Auto detect for Hindi and English mixed in a sentence. Try saying “आज की meeting का agenda क्या है?” Speak naturally for a few seconds, watch the text update, then stop and save. Open the entry from History to review, edit, or delete it. You can also type and save a transcript directly.

## How it works

An AudioWorklet sends 16 kHz mono PCM over a WebSocket. The server refreshes the preview about every two seconds of audio, commits eight-second windows, and flushes the remaining audio on stop. Updates depend on inference speed. Recognition at window boundaries and language switches can vary by model and recording quality. Set WHISPER_MODEL to small to try a larger multilingual model.

The server retains only saved transcript text and metadata in PostgreSQL. An HTTP-only browser cookie scopes access to history. Clearing cookies or switching browsers starts a separate history. The demo allows two active transcription sessions and up to three minutes of audio per session.

## Cloud deployment

Build the repository Dockerfile on a container host with HTTPS and WebSocket support. Supply DATABASE_URL from a PostgreSQL database. The app honors PORT and serves the dashboard and API from one origin. Use /health as the health check and mount persistent storage for HF_HOME if available. For better mixed-language recognition, benchmark the larger model before switching it on.

Inference uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
