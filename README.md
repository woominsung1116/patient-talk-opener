# 환자 말문 열기 🎙️🩺

> 말 한마디로 환자의 마음을 여는 **음성 문진 시뮬레이션 게임**

"여동생 운전 가르치기"가 말로 운전을 가르치는 게임이라면,
이 게임은 **말로 환자의 마음을 여는 게임**입니다.

마이크에 대고 질문하면 AI 환자가 음성으로 대답합니다. 환자는 챗봇이 아니라
**신뢰도·불안도·라포**를 가진 상태 머신이라서, 공감 없이 민감한 질문을 던지면
입을 닫고, 다그치면 마음이 무너집니다. 숨겨진 병력은 신뢰를 쌓아야만 들을 수 있습니다.

모든 AI(LLM·STT)가 **로컬에서 실행**됩니다. 사용자 음성은 어디에도 전송·저장되지 않습니다.

## 게임 방법

1. 케이스를 골라 진료실에 들어간다
2. 🎙️ 버튼(또는 스페이스바)을 **꾹 누르고** 환자에게 질문한다
3. 환자의 표정과 신뢰도/불안도 게이지를 보며 문진을 이어간다
4. 15턴 안에 **진단과 검사를 제출**하면 교수님이 채점해준다 (S~D 등급)

> 💡 핵심: "말하기 불편하실 수 있는데..." 처럼 공감을 먼저 건네면
> 환자가 숨겨둔 단서를 털어놓습니다. ✨

### 수록 케이스

| | 환자 | 주호소 | 난이도 |
|---|---|---|---|
| CASE 01 | 지은 (23F) | 피로와 어지러움 | ★ |
| CASE 02 | 수진 (31F) | 두근거림과 체중 감소 | ★★ |
| CASE 03 | 현우 (28M) | 갑작스러운 호흡곤란 | ★★ |

## 실행

### 받기

```bash
git clone --recurse-submodules https://github.com/woominsung1116/patient-talk-opener.git
cd patient-talk-opener
cp backend/.env.example backend/.env   # GEMINI_API_KEY 는 비워둬도 됨 (edge-tts 로 폴백)
```

`talkinghead/`(립싱크 사이드카)는 **선택 사항**이다. Wav2Lip·SadTalker 는 git 서브모듈이고
모델 가중치는 따로 받아야 한다 — [`talkinghead/README.md`](talkinghead/README.md) 참고.
없으면 정적 아바타 + TTS 로 폴백된다.

```bash
./run.sh
# → http://localhost:5173
```

### 요구 사항

- macOS (Apple Silicon), 메모리 16GB+
- [Homebrew](https://brew.sh), [uv](https://docs.astral.sh/uv/), Node.js 20+
- Ollama (`brew install ollama`)

첫 실행 시 자동으로 받는 모델:

| 역할 | 모델 | 크기 |
|---|---|---|
| 환자 연기 / 의도 분석 / 채점 | `qwen2.5:7b-instruct` (Ollama) | 4.7GB |
| 음성 인식 (한국어) | `Qwen3-ASR-1.7B-4bit` (MLX) | 1.6GB |
| 환자 음성 | 브라우저 SpeechSynthesis | - |

### 수동 실행

```bash
# 백엔드
cd backend && uv sync && uv run uvicorn app.main:app --port 8000

# 프론트엔드
cd frontend && npm install && npm run dev
```

## 아키텍처

```
🎙️ 마이크 (16kHz WAV, 브라우저 인코딩)
   ↓
Qwen3-ASR-1.7B (MLX, 로컬 STT)
   ↓ 텍스트
의도 분석 LLM ──→ 환자 상태 엔진 (rule-based)
                   trust / anxiety / rapport
                   숨겨진 병력 해금 판정
   ↓
환자 응답 LLM (상태 기반 연기 지시)
   ↓
브라우저 TTS + 캐릭터 표정 변화
```

핵심 설계 원칙 (구현계획서 15장):
- **LLM에게 판단을 맡기지 않는다.** 점수와 정보 해금은 전부 rule-based.
- 환자 정보는 케이스 JSON으로 고정. LLM은 연기만 한다.
- LLM이 죽어도 게임이 굴러가는 폴백(키워드 의도 분석, 정적 응답)이 있다.

## 케이스 추가하기

`backend/app/cases/`에 JSON 하나를 추가하면 끝. 기존 케이스를 복사해서
환자 프로필, 숨겨진 병력(`hidden_facts`), 해금 조건, 진단/검사 선택지를 채우면
타이틀 화면에 자동으로 나타난다.

---

본 게임은 교육용 시뮬레이션이며 실제 진료·진단을 대체하지 않습니다.
