import asyncio
import logging
import os
import re
import secrets
from collections import deque
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from threading import Lock

import numpy as np
import psycopg
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel
from faster_whisper.vad import get_vad_model
from psycopg.rows import dict_row
from pydantic import BaseModel, StringConstraints
from starlette.concurrency import run_in_threadpool
from typing import Annotated

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://speech:speech@localhost:5432/speech")
COOKIE = "speech_workspace"
SECOND = 32000
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
MODEL_NAME = os.getenv("WHISPER_MODEL", "mydubber-org/whisper-large-v3-turbo-ct2-int8")
MIXED_PROMPT = "कल office में presentation है। Please bring your laptop."
logger = logging.getLogger(__name__)
slots = asyncio.Semaphore(2)
model_lock = Lock()


def database():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=5)


@asynccontextmanager
async def lifespan(app):
    with database() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transcripts (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                owner text NOT NULL,
                title text NOT NULL,
                body text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS transcripts_owner_id ON transcripts (owner, id DESC)")
    yield


app = FastAPI(lifespan=lifespan)


class Transcript(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50000)]


def owner(request):
    value = request.cookies.get(COOKIE, "")
    return value if re.fullmatch(r"[a-f0-9]{64}", value) else None


@app.get("/health")
def health():
    with database() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/api/transcripts")
def history(request: Request, response: Response):
    key = owner(request)
    if not key:
        response.set_cookie(COOKIE, secrets.token_hex(32), max_age=31536000,
                            httponly=True, samesite="strict",
                            secure=request.url.scheme == "https")
        return []
    with database() as conn:
        return conn.execute(
            "SELECT id, title, body, created_at FROM transcripts WHERE owner=%s ORDER BY id DESC LIMIT 100",
            (key,),
        ).fetchall()


def require_owner(request):
    key = owner(request)
    if not key:
        raise HTTPException(400, "Open the dashboard before saving.")
    return key


@app.post("/api/transcripts", status_code=201)
def create(payload: Transcript, request: Request):
    with database() as conn:
        return conn.execute(
            "INSERT INTO transcripts (owner, title, body) VALUES (%s, %s, %s) RETURNING id",
            (require_owner(request), payload.title, payload.body),
        ).fetchone()


@app.put("/api/transcripts/{item_id}")
def update(item_id: int, payload: Transcript, request: Request):
    with database() as conn:
        result = conn.execute(
            "UPDATE transcripts SET title=%s, body=%s WHERE id=%s AND owner=%s RETURNING id",
            (payload.title, payload.body, item_id, require_owner(request)),
        ).fetchone()
    if result is None:
        raise HTTPException(404, "Transcript not found.")
    return result


@app.delete("/api/transcripts/{item_id}", status_code=204)
def remove(item_id: int, request: Request):
    with database() as conn:
        result = conn.execute("DELETE FROM transcripts WHERE id=%s AND owner=%s",
                              (item_id, require_owner(request)))
        if result.rowcount == 0:
            raise HTTPException(404, "Transcript not found.")


@lru_cache(maxsize=1)
def load_model():
    return WhisperModel(
        MODEL_NAME, device=DEVICE,
        compute_type="int8_float16" if DEVICE == "cuda" else "int8",
        cpu_threads=4, num_workers=2,
    )


def model():
    with model_lock:
        return load_model()


class SpeechSegments:
    """Group PCM into speech spans using a stateful Silero detector."""
    frame_bytes = 1024
    preroll_frames = 10
    min_voiced_frames = 5
    pause_frames = 12
    soft_limit_frames = 145
    hard_limit_frames = 330

    def __init__(self):
        self.vad = get_vad_model().session
        self.h = np.zeros((1, 1, 128), dtype=np.float32)
        self.c = np.zeros_like(self.h)
        self.context = np.zeros((1, 64), dtype=np.float32)
        self.buffer = bytearray()
        self.preroll = deque(maxlen=self.preroll_frames)
        self.active = []
        self.voiced = 0
        self.quiet = 0

    def feed(self, pcm):
        self.buffer.extend(pcm)
        while len(self.buffer) >= self.frame_bytes:
            frame = bytes(self.buffer[:self.frame_bytes])
            del self.buffer[:self.frame_bytes]
            audio = np.frombuffer(frame, dtype="<i2").astype(np.float32).reshape(1, -1) / 32768
            inputs = np.concatenate((self.context, audio), axis=1)
            output, self.h, self.c = self.vad.run(None, {"input": inputs, "h": self.h, "c": self.c})
            self.context = audio[:, -64:]
            voiced = output.item() >= (0.36 if self.active else 0.52)
            if not self.active and not voiced:
                self.preroll.append(frame)
                continue
            if not self.active:
                self.active.extend(self.preroll)
                self.preroll.clear()
            self.active.append(frame)
            self.voiced += int(voiced)
            self.quiet = 0 if voiced else self.quiet + 1

            if (self.quiet >= self.pause_frames
                or len(self.active) >= self.hard_limit_frames
                or (len(self.active) >= self.soft_limit_frames and self.quiet >= 8)):
                utterance = self.flush()
                if utterance:
                    yield utterance

    def flush(self, include_remainder=False):
        utterance = b""
        if self.voiced >= self.min_voiced_frames:
            utterance = b"".join(self.active)
            if include_remainder:
                utterance += bytes(self.buffer)
        self.active.clear()
        self.voiced = self.quiet = 0
        return utterance


def recognize(pcm, language):
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
    mixed = language == "mixed"
    recognizer = model()
    if mixed:
        candidate, probability, _ = recognizer.detect_language(audio=samples)
        if candidate == "en" and probability >= 0.8:
            language = "en"
            mixed = False
    prompts = (MIXED_PROMPT, "नमस्ते, आप कैसे हैं? यह बातचीत हिंदी और English में है।") if mixed else (None,)
    for prompt in prompts:
        segments, _ = recognizer.transcribe(
            samples, language="hi" if mixed else language, task="transcribe",
            initial_prompt=prompt, beam_size=4, temperature=0.0,
            condition_on_previous_text=False, no_repeat_ngram_size=4,
            compression_ratio_threshold=2.4,
        )
        parts = [segment.text.strip() for segment in segments
                 if segment.avg_logprob > -1.2 and segment.compression_ratio < 2.4]
        transcript = " ".join(filter(None, parts))
        if transcript and (not mixed or not re.search(r"[\u0600-\u08ff]", transcript)):
            return transcript
    return ""


@app.websocket("/ws/transcribe")
async def transcribe(socket: WebSocket):
    origin = socket.headers.get("origin")
    host = socket.headers.get("host")
    if not owner(socket) or origin not in {f"http://{host}", f"https://{host}"}:
        await socket.close(code=1008)
        return
    await socket.accept()
    if slots.locked():
        await socket.send_json({"error": "The recognizer is busy. Try again shortly."})
        await socket.close()
        return
    language = "en" if socket.query_params.get("lang") == "english" else "mixed"
    total = 0

    async def commit(utterance):
        if utterance:
            text = await run_in_threadpool(recognize, utterance, language)
            if text:
                await socket.send_json({"committed": text})

    try:
        async with slots:
            if load_model.cache_info().currsize == 0:
                await socket.send_json({"warming": True})
            await run_in_threadpool(model)
            segmenter = await run_in_threadpool(SpeechSegments)
            await socket.send_json({"ready": True})
            async with asyncio.timeout(240):
                while True:
                    message = await socket.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("text") == "stop":
                        for utterance in await run_in_threadpool(lambda: list(segmenter.feed(bytes(segmenter.frame_bytes)))):
                            await commit(utterance)
                        await commit(segmenter.flush(include_remainder=True))
                        await socket.send_json({"done": True})
                        break
                    pcm = message.get("bytes")
                    if not pcm or len(pcm) % 2 or len(pcm) > SECOND:
                        await socket.close(code=1003)
                        return
                    total += len(pcm)
                    if total > 180 * SECOND:
                        await commit(segmenter.flush(include_remainder=True))
                        await socket.send_json({"error": "Recording limit reached. The text is ready to save."})
                        break
                    for utterance in await run_in_threadpool(lambda: list(segmenter.feed(pcm))):
                        await commit(utterance)
    except WebSocketDisconnect:
        return
    except Exception:
        logger.exception("Transcription interrupted")
        try:
            await socket.send_json({"error": "Transcription was interrupted. You can save the text already shown."})
        except (RuntimeError, WebSocketDisconnect):
            return
    await socket.close()


dist = Path(__file__).parent / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="dashboard")
