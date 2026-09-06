#!/bin/zsh
# 환자 말문 열기 — 원클릭 실행 스크립트
# Ollama + 백엔드(FastAPI) + 프론트엔드(Vite)를 함께 띄운다.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

OLLAMA_BIN="$(command -v ollama || echo /Applications/Ollama.app/Contents/Resources/ollama)"

# Ollama 서버 확인
if ! curl -s --max-time 2 http://localhost:11434/api/version > /dev/null; then
  echo "⚠️  Ollama가 꺼져 있어요. 시작합니다..."
  if [ -d /Applications/Ollama.app ]; then
    open -a Ollama || ("$OLLAMA_BIN" serve > /tmp/ollama-serve.log 2>&1 &)
  else
    echo "Ollama가 설치되어 있지 않아요: brew install --cask ollama-app"
    exit 1
  fi
  until curl -s --max-time 2 http://localhost:11434/api/version > /dev/null; do sleep 2; done
fi

if ! "$OLLAMA_BIN" list 2>/dev/null | grep -q "qwen2.5:7b-instruct"; then
  echo "⚠️  LLM 모델이 없어요. 받는 중... (4.7GB, 한 번만)"
  "$OLLAMA_BIN" pull qwen2.5:7b-instruct
fi

cleanup() { kill 0 2>/dev/null; }
trap cleanup EXIT INT TERM

# 토킹헤드 사이드카 (Wav2Lip+GFPGAN — 환자가 말하는 영상). 모델을 메모리에 상시 로드.
# 없거나 꺼져 있어도 게임은 정적 사진+TTS로 폴백되므로 선택적.
if [ -d "$ROOT/talkinghead/.venv" ]; then
  echo "🎭 토킹헤드 사이드카 시작 (http://localhost:8008, 첫 로드 10~20초)..."
  (cd "$ROOT/talkinghead" && PYTORCH_ENABLE_MPS_FALLBACK=1 \
    .venv/bin/python -m uvicorn server_example:app --port 8008 \
    > /tmp/talkinghead.log 2>&1 &)
fi

# Supertonic TTS 사이드카 (온디바이스 한국어 음성). 모델 상시 로드.
# 없거나 꺼져 있어도 백엔드가 edge-tts로 폴백하므로 선택적.
if [ -d "$ROOT/tts_local/.venv" ]; then
  echo "🗣️  Supertonic TTS 사이드카 시작 (http://localhost:8009, 첫 로드 수 초)..."
  (cd "$ROOT/tts_local" && .venv/bin/python -m uvicorn server:app --port 8009 \
    > /tmp/supertonic.log 2>&1 &)
fi

echo "🩺 백엔드 시작 (http://localhost:8000)..."
cd "$ROOT/backend"
uv run uvicorn app.main:app --port 8000 &

echo "🎮 프론트엔드 시작 (http://localhost:5173)..."
cd "$ROOT/frontend"
# 안정 플레이 모드: 프로덕션 빌드 서빙 (개발 중 핫리로드로 게임이 끊기지 않게)
npm run build > /dev/null 2>&1
npx vite preview --port 5173 --strictPort &
# 개발 모드가 필요하면 위 두 줄 대신: npm run dev &

sleep 2
echo ""
echo "════════════════════════════════════════"
echo "  환자 말문 열기 🎙️"
echo "  브라우저에서 http://localhost:5173 접속"
echo "  (첫 실행 시 STT 모델 1.6GB를 받아요)"
echo "════════════════════════════════════════"
wait
