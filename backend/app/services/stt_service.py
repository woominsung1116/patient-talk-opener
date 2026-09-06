"""STT 서비스 — Qwen3-ASR-1.7B (4bit, MLX) 기반 한국어 음성 인식.

브라우저가 16kHz mono WAV를 보내는 것을 전제로 한다.
모델은 첫 요청 시 1회 로드되어 메모리에 상주한다 (~1.6GB).
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor

STT_MODEL = os.environ.get("STT_MODEL", "mlx-community/Qwen3-ASR-1.7B-4bit")

_session = None
# MLX(Metal)의 GPU 스트림은 스레드별이라 모델 로드와 추론이 반드시 같은 스레드에서
# 일어나야 한다(다른 스레드에서 호출하면 "There is no Stream(gpu, 1)" 오류).
# 단일 워커 executor에 모든 MLX 작업을 고정한다.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-stt")
_lock = asyncio.Lock()


def _load_session():
    global _session
    if _session is None:
        from mlx_qwen3_asr import Session

        _session = Session(model=STT_MODEL)
    return _session


async def warmup() -> None:
    """서버 기동 직후 모델을 미리 로드해 첫 발화 지연을 없앤다."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(_executor, _load_session)


async def transcribe(wav_bytes: bytes) -> str:
    """WAV 바이트를 한국어 텍스트로 변환한다."""
    loop = asyncio.get_running_loop()

    def _run() -> str:
        session = _load_session()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as f:
            f.write(wav_bytes)
            f.flush()
            result = session.transcribe(f.name, language="Korean")
        return (result.text or "").strip()

    async with _lock:  # MLX 세션은 동시 호출 비안전 → 직렬화
        return await loop.run_in_executor(_executor, _run)
