"""Supertonic TTS 사이드카 — 온디바이스 한국어 음성 합성 (ONNX).
모델을 메모리에 상시 로드해 두고 /tts 로 WAV를 반환한다.
백엔드 tts_service가 TTS_ENGINE=supertonic 일 때 여기로 POST 한다.
"""
from __future__ import annotations

import os
import tempfile
import threading

from fastapi import FastAPI, Response
from pydantic import BaseModel

app = FastAPI()

_tts = None
_styles: dict[str, object] = {}
_lock = threading.Lock()

# 성별 → 보이스 (M1~M5 남성 / F1~F5 여성)
VOICE = {"male": "M1", "female": "F1"}

# 말속도 기본값 — supertonic 자체 기본은 1.05다. 문진 대화는 조금 빠른 편이
# 자연스러워서 올려 잡았다. 환경변수로 조절한다.
DEFAULT_SPEED = float(os.environ.get("TTS_SPEED", "1.20"))
DEFAULT_SILENCE = float(os.environ.get("TTS_SILENCE", "0.18"))


def _get():
    global _tts
    if _tts is None:
        from supertonic import TTS

        _tts = TTS(auto_download=True)
        for v in ("M1", "F1"):
            _styles[v] = _tts.get_voice_style(voice_name=v)
    return _tts


@app.on_event("startup")
def _warmup():
    try:
        t = _get()
        t.synthesize(text="안녕하세요.", voice_style=_styles["F1"], lang="ko", total_steps=8)
        print("[supertonic] 모델 로드 + 워밍업 완료")
    except Exception as e:  # noqa: BLE001
        print("[supertonic] 워밍업 실패:", e)


class Req(BaseModel):
    text: str
    gender: str = "female"
    emotion: str = "neutral"  # supertonic은 감정 파라미터가 없어 무시 (목소리 일관)
    age: int | None = None  # 14세 이하면 아동 보이스(피치업) 적용
    # 말속도 — supertonic 기본값은 1.05. 이 인자는 지속시간만 늘리고 줄여서
    # 음높이를 바꾸지 않는다. 재생 쪽 playbackRate 로 올리면 목소리가 변한다.
    speed: float = DEFAULT_SPEED
    # 문장 사이 침묵(초). 기본 0.3은 문진 대화에서 느리게 느껴진다.
    silence: float = DEFAULT_SILENCE


@app.get("/health")
def health():
    return {"ok": _tts is not None}


def _childify(path: str) -> None:
    """WAV를 아동 목소리로 — 파형을 리샘플해 피치+템포를 함께 올린다 (자연스러운 아이 톤).
    supertonic에 아동 프리셋이 없어 여성 보이스 피치업으로 근사."""
    import wave

    import numpy as np

    with wave.open(path, "rb") as r:
        params = r.getparams()
        raw = r.readframes(params.nframes)
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    factor = 1.22  # +3.5 semitone 근사
    idx = np.arange(0, len(x) - 1, factor)
    y = np.interp(idx, np.arange(len(x)), x).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setparams(params)
        w.writeframes(y.tobytes())


@app.post("/tts")
def tts(req: Req):
    t = _get()
    child = req.age is not None and req.age <= 14
    name = "F1" if child else VOICE.get(req.gender, "F1")
    style = _styles.get(name) or t.get_voice_style(voice_name=name)
    with _lock:  # 단일 세션 게임 — 직렬화로 충분
        wav, _dur = t.synthesize(
            text=req.text,
            voice_style=style,
            lang="ko",
            total_steps=8,
            speed=req.speed,
            silence_duration=req.silence,
        )
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as f:
            t.save_audio(wav, f.name)
            f.flush()
            if child:
                _childify(f.name)
            with open(f.name, "rb") as fh:
                data = fh.read()
    return Response(content=data, media_type="audio/wav")
