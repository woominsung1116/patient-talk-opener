"""LLM 클라이언트 — Gemini API(기본) / Codex CLI / Ollama. 의도 분석 / 환자 응답 / 피드백 공용.

LLM_ENGINE=gemini (기본, 키 있을 때) : Gemini API. 빠르고 동시성 안전. 실패 시 codex→ollama 폴백.
LLM_ENGINE=codex                     : `codex exec` 비대화 모드 래퍼. 실패 시 Ollama 폴백.
LLM_ENGINE=ollama                    : 로컬 Ollama 직접 사용.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
from typing import Any

import httpx

OLLAMA_BASE = os.environ.get("OLLAMA_BASE", "http://localhost:11434")
MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b-instruct")
CODEX_TIMEOUT = float(os.environ.get("CODEX_TIMEOUT", "90"))
CODEX_MODEL = os.environ.get("CODEX_MODEL", "gpt-5.5")

# Gemini API (REST). 키가 있으면 기본 엔진.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_TIMEOUT = float(os.environ.get("GEMINI_TIMEOUT", "30"))

ENGINE = os.environ.get(
    "LLM_ENGINE",
    "gemini" if GEMINI_API_KEY else ("codex" if shutil.which("codex") else "ollama"),
)

_client = httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=120.0)
_gemini_client = httpx.AsyncClient(timeout=GEMINI_TIMEOUT)


async def gemini_chat(
    system: str,
    user: str,
    *,
    json_mode: bool = False,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> str:
    """Gemini generateContent로 1회 응답. thinking 비활성(thinkingBudget=0)으로 지연 최소화."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent"
    )
    gen_cfg: dict[str, Any] = {
        "temperature": temperature,
        # 턴 JSON이 길 수 있어 넉넉히 (thinking 끄면 전부 출력에 사용됨)
        "maxOutputTokens": max(max_tokens, 1024 if json_mode else 512),
        "thinkingConfig": {"thinkingBudget": 0},
    }
    if json_mode:
        gen_cfg["responseMimeType"] = "application/json"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": gen_cfg,
    }
    r = await _gemini_client.post(url, params={"key": GEMINI_API_KEY}, json=body)
    r.raise_for_status()
    data = r.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError):
        text = ""
    if not text:
        raise RuntimeError(f"gemini empty output: {data.get('candidates', data)!r:.200}")
    return text


async def codex_chat(system: str, user: str) -> str:
    """`codex exec`로 1회 응답 생성. 최종 메시지만 파일로 받아 읽는다."""
    prompt = f"{system}\n\n{user}"
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        out_path = f.name
    try:
        proc = await asyncio.create_subprocess_exec(
            "codex", "exec",
            "--skip-git-repo-check",
            "-s", "read-only",
            "-m", CODEX_MODEL,
            "-c", 'model_reasoning_effort="low"',
            "-c", "tools.web_search=false",
            "-c", "mcp_servers={}",  # 매 호출 MCP 서버 기동 방지 (~5s 단축)
            "--output-last-message", out_path,
            prompt,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=CODEX_TIMEOUT)
        with open(out_path) as fh:
            text = fh.read().strip()
        if not text:
            raise RuntimeError("codex empty output")
        return text
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


async def is_available() -> bool:
    try:
        r = await _client.get("/api/version", timeout=3.0)
        return r.status_code == 200
    except Exception:
        return False


async def chat(
    system: str,
    user: str,
    *,
    json_mode: bool = False,
    temperature: float = 0.7,
    max_tokens: int = 512,
    prefer: str | None = None,
) -> str:
    """엔진 라우팅: 선택된 엔진 우선 → ollama 폴백.
    prefer는 환경 설정과 무관하게 특정 엔진 강제(예: prefer='ollama'로 빠른 로컬)."""
    engine = prefer or ENGINE
    # Gemini는 LLM_ENGINE=gemini(또는 prefer='gemini')일 때만 사용 (codex는 codex로 유지)
    if engine == "gemini" and GEMINI_API_KEY:
        try:
            return await gemini_chat(
                system, user, json_mode=json_mode, temperature=temperature, max_tokens=max_tokens
            )
        except Exception:
            pass  # → ollama 폴백
    if engine == "codex" and shutil.which("codex"):
        try:
            suffix = "\n\n(JSON만 출력하라. 다른 텍스트 금지.)" if json_mode else ""
            return await codex_chat(system + suffix, user)
        except Exception:
            pass  # → ollama 폴백
    return await ollama_chat(
        system, user, json_mode=json_mode, temperature=temperature, max_tokens=max_tokens
    )


async def ollama_chat(
    system: str,
    user: str,
    *,
    json_mode: bool = False,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> str:
    payload: dict[str, Any] = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    if json_mode:
        payload["format"] = "json"
    r = await _client.post("/api/chat", json=payload)
    r.raise_for_status()
    return r.json()["message"]["content"]


# 한자/가나/라틴(2자+)/베트남 성조 문자 — q4 양자화 모델의 언어 혼입 감지
_FOREIGN = re.compile(r"[一-鿿぀-ヿÀ-ɏḀ-ỿ]|[a-zA-Z]{2,}")


def is_contaminated(text: str) -> bool:
    return bool(_FOREIGN.search(text))


def strip_foreign(text: str) -> str:
    """외국어 토큰을 제거하고 문장을 수습한다 (최후의 수단)."""
    text = re.sub(r"[一-鿿぀-ヿÀ-ɏḀ-ỿa-zA-Z]+", "", text)
    text = re.sub(r"[。，！？、；：]", " ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip(" ,·~-")


def extract_json(text: str) -> dict | None:
    """LLM 출력에서 첫 번째 JSON 객체를 최대한 관대하게 추출한다."""
    text = text.strip()
    # 코드펜스 제거
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 중괄호 균형 스캔
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None
