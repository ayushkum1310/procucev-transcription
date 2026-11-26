import asyncio
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from threading import Lock

import numpy as np
import psycopg
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel
from psycopg.rows import dict_row
from pydantic import BaseModel, StringConstraints
from starlette.concurrency import run_in_threadpool
from typing import Annotated

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://speech:speech@localhost:5432/speech")
COOKIE = "speech_workspace"
SECOND = 32000
WINDOW = 8 * SECOND
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
    return WhisperModel(os.getenv("WHISPER_MODEL", "base"), device="cpu", compute_type="int8",
                        cpu_threads=4, num_workers=2)


def model():
    with model_lock:
        return load_model()


def recognize(pcm, language):
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
    segments, _ = model().transcribe(
        samples, language=language, task="transcribe", beam_size=1,
        vad_filter=True, condition_on_previous_text=False,
    )
    return " ".join(segment.text.strip() for segment in segments).strip()


@app.websocket("/ws/transcribe")
async def transcribe(socket: WebSocket):
    origin = socket.headers.get("origin")
    host = socket.headers.get("host")
    if not owner(socket) or origin not in {f"http://{host}", f"https://{host}"}:
        await socket.close(code=1008)
        return
    await socket.accept()
    if slots.locked():
        await socket.send_json({"error": "Both transcription slots are busy. Try again shortly."})
        await socket.close()
        return
    language = {"hi": "hi", "en": "en"}.get(socket.query_params.get("lang"))
    buffer = bytearray()
    completed = []
    last_preview = 0
    total = 0
    try:
        async with slots:
            await run_in_threadpool(model)
            await socket.send_json({"ready": True})
            async with asyncio.timeout(240):
                while True:
                    message = await socket.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("text") == "stop":
                        if buffer:
                            completed.append(await run_in_threadpool(recognize, bytes(buffer), language))
                        await socket.send_json({"text": " ".join(filter(None, completed)), "done": True})
                        break
                    pcm = message.get("bytes")
                    if not pcm or len(pcm) % 2 or len(pcm) > SECOND:
                        await socket.close(code=1003)
                        return
                    total += len(pcm)
                    if total > 180 * SECOND:
                        await socket.send_json({"error": "Recording limit reached. Save the text already shown."})
                        break
                    buffer.extend(pcm)
                    if len(buffer) >= WINDOW:
                        completed.append(await run_in_threadpool(recognize, bytes(buffer[:WINDOW]), language))
                        del buffer[:WINDOW]
                        last_preview = 0
                        await socket.send_json({"text": " ".join(filter(None, completed))})
                    elif len(buffer) - last_preview >= 2 * SECOND:
                        preview = await run_in_threadpool(recognize, bytes(buffer), language)
                        last_preview = len(buffer)
                        await socket.send_json({"text": " ".join(filter(None, [*completed, preview]))})
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
