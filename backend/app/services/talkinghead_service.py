"""토킹헤드 — TTS 음성 + 환자 사진 → 환자가 그 음성으로 말하는 mp4.

흐름: tts_service로 음성 합성 → 16k mono wav 변환(ffmpeg) → 토킹헤드 사이드카
서버(별도 uv 환경 `talkinghead/`, Wav2Lip+GFPGAN을 메모리에 상시 로드, 기본 :8008)
에 photo+wav 전송 → mp4 반환.

사이드카를 쓰는 이유: 매 턴 모델을 새로 로드하면 수 초씩 낭비. 서버가 한 번 로드해
warm 상태로 재사용한다. 사이드카가 안 떠 있으면 503 → 프론트는 정적 사진+TTS 폴백.

응답마다 영상 생성에 수 초가 걸리므로 (text+asset+emotion) 해시로 디스크 캐시한다.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
from pathlib import Path

import httpx

from . import tts_service

# patient-talk-opener/  (이 파일: backend/app/services/talkinghead_service.py → parents[3])
ROOT = Path(__file__).resolve().parents[3]
PATIENTS_DIR = ROOT / "frontend" / "public" / "patients"
CACHE_DIR = ROOT / "backend" / ".talk_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 토킹헤드 활성화 여부 (사이드카 미가동 시에도 게임은 폴백으로 동작)
ENABLED = os.environ.get("TALKINGHEAD", "1") != "0"
SIDECAR_URL = os.environ.get("TALKINGHEAD_URL", "http://localhost:8008")
GEN_TIMEOUT = float(os.environ.get("TALKINGHEAD_TIMEOUT", "180"))
# GFPGAN 보정: 전신 구도에선 얼굴이 작아 차이가 거의 없고 프레임당 0.22초로 느림.
# 기본 OFF(~1초). 클로즈업 구도가 필요하면 TALKINGHEAD_ENHANCE=1.
ENHANCE = os.environ.get("TALKINGHEAD_ENHANCE", "0") == "1"


def patient_asset(gender: str, age: int) -> str:
    """케이스(성별/나이) → 환자 사진 에셋. frontend의 patientAsset과 동일 규칙."""
    if gender == "female":
        return "old_female" if age >= 60 else "young_female"
    return "old_male" if age >= 60 else "middle_male"


def _photo_for(asset: str) -> Path | None:
    # 컷아웃(투명 배경) png 우선 — 프론트가 원본 알파로 마스킹해 진료실에 합성한다.
    for name in (f"{asset}.png", f"{asset}_raw.png"):
        p = PATIENTS_DIR / name
        if p.exists():
            return p
    return None


def _to_wav16k(audio: bytes, mime: str, dst: Path) -> None:
    """TTS 출력(wav 24k 또는 mp3)을 16kHz mono wav로 변환."""
    import subprocess

    suffix = ".wav" if "wav" in mime else ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
        tf.write(audio)
        src = tf.name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", src, "-ar", "16000", "-ac", "1", str(dst)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    finally:
        os.unlink(src)


def _cache_key(text: str, asset: str, emotion: str) -> str:
    h = hashlib.sha256(f"{asset}|{emotion}|{text}".encode("utf-8")).hexdigest()
    return h[:20]


def _generate_sync(text: str, gender: str, age: int, emotion: str) -> Path:
    asset = patient_asset(gender, age)
    out = CACHE_DIR / f"{_cache_key(text, asset, emotion)}.mp4"
    if out.exists() and out.stat().st_size > 0:
        return out

    photo = _photo_for(asset)
    if photo is None:
        raise RuntimeError(f"no patient photo for asset {asset}")

    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "speech.wav"
        # TTS는 async라 별도 이벤트 루프로 호출 (이 함수는 스레드에서 동작)
        audio, mime = asyncio.run(tts_service.synthesize(text, gender, emotion))
        _to_wav16k(audio, mime, wav)

        # 사이드카에 photo+wav 전송 → mp4
        with photo.open("rb") as pf, wav.open("rb") as wf:
            files = {
                "photo": (photo.name, pf, "image/png"),
                "audio": ("speech.wav", wf, "audio/wav"),
            }
            r = httpx.post(
                f"{SIDECAR_URL}/talk",
                files=files,
                data={"enhance": "true" if ENHANCE else "false"},
                timeout=GEN_TIMEOUT,
            )
            r.raise_for_status()
        tmp_out = Path(td) / "out.mp4"
        tmp_out.write_bytes(r.content)
        tmp_out.replace(out)
    return out


async def synthesize_talk(
    text: str, gender: str = "female", age: int = 30, emotion: str = "neutral"
) -> bytes:
    """환자가 text를 말하는 mp4(음성 포함) 바이트를 반환."""
    if not ENABLED:
        raise RuntimeError("talkinghead disabled")
    text = text.strip()
    if not text:
        raise ValueError("empty text")
    # 추론은 블로킹 → 스레드 풀에서 실행해 이벤트 루프를 막지 않는다.
    out = await asyncio.to_thread(_generate_sync, text, gender, age, emotion)
    return out.read_bytes()
