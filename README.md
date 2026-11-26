# Speech Desk

Procucev hiring assignment. A React dashboard, FastAPI WebSocket server, self-hosted multilingual Whisper, and PostgreSQL.

## Run locally

Run `docker compose up --build` in this directory and open http://localhost:8000. Allow microphone access. The first recording downloads model weights from Hugging Face and may take longer to start. Subsequent sessions reuse the model cache.

Choose Hindi + English for code-switching, Hindi or English for single-language speech, and Auto for other supported languages. Hindi + English uses a Hindi language hint and a mixed-script decoding example. It can still transliterate some English words into Devanagari. Try saying “आज की meeting का agenda क्या है?” Speak naturally for a few seconds, watch the text update, then stop and save. Open the entry from History to review, edit, or delete it. You can also type and save a transcript directly.

## How it works

An AudioWorklet sends 16 kHz mono PCM over a WebSocket. The server refreshes the live draft about every two seconds of audio on CPU, or 1.25 seconds on CUDA after the first two seconds of audio. It keeps up to 14 seconds of context and uses a wider search on completed windows and on stop. Updates depend on inference speed. Recognition at window boundaries and language switches can vary by model and recording quality. The default model is multilingual Whisper Small on CPU and Whisper Turbo on CUDA. Set WHISPER_MODEL=base when memory is limited. On a compatible NVIDIA host, set WHISPER_DEVICE=cuda and supply CUDA 12 cuBLAS and cuDNN 9 before starting Uvicorn. Keep the same PostgreSQL database and build the frontend with npm ci and npm run build for a native setup.

The server retains only saved transcript text and metadata in PostgreSQL. An HTTP-only browser cookie scopes access to history. Clearing cookies or switching browsers starts a separate history. The demo allows two active transcription sessions and up to three minutes of audio per session.

## Cloud deployment

Build the repository Dockerfile on a container host with HTTPS and WebSocket support. Supply DATABASE_URL from a PostgreSQL database. The app honors PORT and serves the dashboard and API from one origin. Use /health as the health check and mount persistent storage for HF_HOME if available. For better mixed-language recognition, benchmark the larger model before switching it on.

Inference uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
