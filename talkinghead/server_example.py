"""Minimal FastAPI integration example for the talking-head generator.

Key points for production:
  - Load the model ONCE at startup (TalkingHead holds Wav2Lip + GFPGAN + S3FD).
  - MPS is not thread-safe / not fork-safe. Serialize generation behind a lock
    (or a single-worker process). Do NOT run multiple concurrent generate() on
    the same MPS device.
  - generate() is CPU/GPU heavy and blocking; run it in a threadpool and guard
    with a lock so only one inference runs at a time.

Run:
  cd talkinghead
  source .venv/bin/activate
  PYTORCH_ENABLE_MPS_FALLBACK=1 uvicorn server_example:app --port 8008
"""
import os
import tempfile
import threading

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse

from generate import TalkingHead

app = FastAPI()

# Warm model, loaded once. Set enhance=True for photoreal (slower ~0.22s/frame),
# enhance=False for realtime-ish but blurrier mouth.
_HEAD = TalkingHead(enhance=True)
_LOCK = threading.Lock()  # MPS: one inference at a time


@app.post("/talk")
async def talk(photo: UploadFile = File(...),
               audio: UploadFile = File(...),
               enhance: bool = Form(True)):
    tmpdir = tempfile.mkdtemp(prefix="talkhead_")
    photo_path = os.path.join(tmpdir, photo.filename or "photo.png")
    audio_path = os.path.join(tmpdir, audio.filename or "audio.wav")
    out_path = os.path.join(tmpdir, "out.mp4")
    with open(photo_path, "wb") as f:
        f.write(await photo.read())
    with open(audio_path, "wb") as f:
        f.write(await audio.read())

    with _LOCK:  # serialize MPS access
        timings = _HEAD.generate(photo_path, audio_path, out_path, enhance=enhance)

    return FileResponse(out_path, media_type="video/mp4",
                        headers={"X-Timings": str(timings)})


@app.get("/health")
def health():
    return {"status": "ok", "device": _HEAD.device, "enhance": _HEAD.enhance_enabled}
