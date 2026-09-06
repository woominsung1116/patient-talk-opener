"""TTS — 1순위: Gemini TTS (GEMINI_API_KEY 설정 시, 감정 연기 지원),
2순위: Microsoft Edge 뉴럴 보이스 (edge-tts).

여동생 운전 가르치기와 같은 구성: 캐릭터 음성을 Gemini로 생성한다.
반환: (audio_bytes, mime_type)
"""
from __future__ import annotations

import base64
import os
import re
import struct

import edge_tts
import httpx

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")
# TTS 엔진 — 'supertonic'(온디바이스 고품질 한국어, 사이드카) / 'edge'(클라우드 뉴럴) / 'gemini'
TTS_ENGINE = os.environ.get("TTS_ENGINE", "edge")
SUPERTONIC_URL = os.environ.get("SUPERTONIC_URL", "http://localhost:8009")

# Gemini 프리빌트 보이스 (한국어 자동 지원)
GEMINI_VOICES = {"female": "Leda", "male": "Charon"}

EDGE_VOICES = {"female": "ko-KR-SunHiNeural", "male": "ko-KR-InJoonNeural"}

# 감정 → Gemini 연기 지시 (자연어 스타일 프롬프트)
EMOTION_STYLE = {
    "anxious": "긴장되고 불안한 목소리로, 약간 떨리듯",
    "defensive": "경계하며 방어적인 톤으로, 말을 아끼듯",
    "guarded": "머뭇거리며 조심스럽게, 말끝을 흐리듯",
    "hurt": "상처받아 침울한 목소리로, 느리게",
    "shocked": "깜짝 놀라 당황한 목소리로",
    "warm": "마음이 놓인 따뜻하고 밝은 목소리로",
    "relieved": "안도한 부드러운 목소리로",
    "hesitant_relieved": "머뭇거리다가 어렵게 털어놓는 목소리로, 조심스럽게",
    "annoyed": "살짝 짜증 섞인 퉁명스러운 톤으로",
    "neutral": "담담한 환자의 목소리로",
}

# edge-tts 감정 프로소디 (폴백용)
EMOTION_PROSODY: dict[str, tuple[str, str]] = {
    "anxious": ("+6%", "+15Hz"),
    "defensive": ("-8%", "-10Hz"),
    "guarded": ("-12%", "-5Hz"),
    "hurt": ("-14%", "+5Hz"),
    "shocked": ("+12%", "+25Hz"),
    "warm": ("-2%", "+10Hz"),
    "relieved": ("-4%", "+5Hz"),
    "hesitant_relieved": ("-12%", "+5Hz"),
    "annoyed": ("+2%", "-10Hz"),
}


def _clean(text: str) -> str:
    text = re.sub(r"[~^♥♡☆★]", "", text)
    text = re.sub(r"\.{4,}", "...", text)
    return text.strip()


def _pcm_to_wav(pcm: bytes, sample_rate: int = 24000) -> bytes:
    """Gemini TTS의 raw PCM(s16le mono)을 WAV로 감싼다."""
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(pcm), b"WAVE", b"fmt ", 16,
        1, 1, sample_rate, sample_rate * 2, 2, 16,
        b"data", len(pcm),
    )
    return header + pcm


async def _gemini_tts(text: str, gender: str, emotion: str) -> bytes:
    voice = GEMINI_VOICES.get(gender, GEMINI_VOICES["female"])
    style = EMOTION_STYLE.get(emotion, EMOTION_STYLE["neutral"])
    prompt = f"{style} 말해줘: {text}"
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_TTS_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
    part = data["candidates"][0]["content"]["parts"][0]["inlineData"]
    pcm = base64.b64decode(part["data"])
    # mimeType 예: audio/L16;codec=pcm;rate=24000
    rate = 24000
    m = re.search(r"rate=(\d+)", part.get("mimeType", ""))
    if m:
        rate = int(m.group(1))
    return _pcm_to_wav(pcm, rate)


async def _edge_tts(text: str, gender: str, emotion: str) -> bytes:
    voice = EDGE_VOICES.get(gender, EDGE_VOICES["female"])
    rate, pitch = EMOTION_PROSODY.get(emotion, ("+0%", "+0Hz"))
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    buf = bytearray()
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            buf.extend(chunk["data"])
    if not buf:
        raise RuntimeError("empty audio")
    return bytes(buf)


async def _supertonic_tts(text: str, gender: str, emotion: str, age: int | None = None) -> bytes:
    """온디바이스 Supertonic 사이드카(:8009)에 합성 요청."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{SUPERTONIC_URL}/tts",
            json={"text": text, "gender": gender, "emotion": emotion, "age": age},
        )
        r.raise_for_status()
        return r.content


async def synthesize(
    text: str, gender: str = "female", emotion: str = "neutral", age: int | None = None
) -> tuple[bytes, str]:
    text = _clean(text)
    if TTS_ENGINE == "supertonic":
        try:
            return await _supertonic_tts(text, gender, emotion, age), "audio/wav"
        except Exception:
            pass  # 사이드카 미가동 → edge-tts 폴백
    if TTS_ENGINE == "gemini" and GEMINI_API_KEY:
        try:
            return await _gemini_tts(text, gender, emotion), "audio/wav"
        except Exception:
            pass  # → edge-tts 폴백
    return await _edge_tts(text, gender, emotion), "audio/mpeg"
