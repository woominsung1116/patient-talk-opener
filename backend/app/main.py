"""환자 말문 열기 — FastAPI 백엔드."""
from __future__ import annotations

import asyncio
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

# backend/.env 로드 (GEMINI_API_KEY, LLM_ENGINE 등) — import 시점에 먼저
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from . import store
from .services import (
    case_loader,
    intent_analyzer,
    llm_service,
    patient_responder,
    patient_state,
    scoring,
    stt_service,
    talkinghead_service,
    tts_service,
    turn_engine,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # STT 모델을 백그라운드에서 미리 로드 (실패해도 서버는 뜬다)
    task = asyncio.create_task(_safe_warmup())
    yield
    task.cancel()


async def _safe_warmup():
    try:
        await stt_service.warmup()
        print("[stt] Qwen3-ASR 모델 로드 완료")
    except Exception as e:
        print(f"[stt] 모델 로드 실패 (음성 입력 비활성): {e}")


app = FastAPI(title="환자 말문 열기", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    """
    ⚠️ `llm_model` 만 보고 어떤 엔진이 도는지 판단하면 안 된다.
       그 값은 **Ollama 모델 상수**라서 `LLM_ENGINE=codex` 로 떠 있어도 `qwen2.5:...` 로 나온다.
       실제로 codex 로 재기동해 놓고 이 응답만 보고 "안 바뀌었네" 로 오독한 적이 있다.
       그래서 `llm_engine`(실제 활성 엔진)과 `codex_available`(PATH 에 codex 가 있나)을 같이 낸다.
       codex 는 PATH 의존이라 백엔드를 어떤 셸에서 띄웠는지에 따라 조용히 ollama 로 폴백한다.
    """
    return {
        "ok": True,
        "llm": await llm_service.is_available(),
        "llm_engine": llm_service.ENGINE,
        "llm_model": llm_service.MODEL,
        "codex_available": shutil.which("codex") is not None,
        "stt_model": stt_service.STT_MODEL,
        "stt_loaded": stt_service._session is not None,
    }


@app.get("/api/cases")
async def cases():
    return case_loader.list_cases()


class AppearanceUpdate(BaseModel):
    """교수자가 조절하는 3D 환자 임상 연출값."""

    pain_level: float = Field(ge=0, le=1)
    pain_colicky_period: float | None = Field(default=None, ge=4, le=60)
    guarding: float = Field(ge=0, le=1)
    restlessness: float = Field(ge=0, le=1)
    scleral_icterus: float = Field(ge=0, le=1)
    skin_jaundice: float = Field(ge=0, le=1)
    conjunctival_pallor: float = Field(ge=0, le=1)
    cyanosis: float = Field(ge=0, le=1)
    diaphoresis: float = Field(ge=0, le=1)
    sclera_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    skin_tint_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    conjunctiva_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    goiter: bool
    atrophic_glossitis: bool
    finger_swelling_left: float = Field(default=0, ge=0, le=1)
    finger_swelling_right: float = Field(default=0, ge=0, le=1)
    leg_edema_left: float = Field(default=0, ge=0, le=1)
    leg_edema_right: float = Field(default=0, ge=0, le=1)
    rash_level: float = Field(default=0, ge=0, le=1)
    rash_region: Literal["face", "torso", "left_arm", "right_arm", "left_leg", "right_leg"] = "torso"
    rash_color: str = Field(default="#b94a55", pattern=r"^#[0-9a-fA-F]{6}$")
    bruise_level: float = Field(default=0, ge=0, le=1)
    bruise_region: Literal["face", "torso", "left_arm", "right_arm", "left_leg", "right_leg"] = "left_leg"
    bruise_color: str = Field(default="#59456f", pattern=r"^#[0-9a-fA-F]{6}$")


@app.put("/api/cases/{case_id}/appearance")
async def save_case_appearance(case_id: str, req: AppearanceUpdate):
    try:
        return case_loader.update_appearance(case_id, req.model_dump())
    except FileNotFoundError:
        raise HTTPException(404, "case not found")


class StartRequest(BaseModel):
    case_id: str


@app.post("/api/session/start")
async def start_session(req: StartRequest):
    try:
        case = case_loader.load(req.case_id)
    except FileNotFoundError:
        raise HTTPException(404, "case not found")
    return _open_session(case)


class AdhocStartRequest(BaseModel):
    """파일로 저장된 케이스가 아니라 본문을 통째로 받아 세션을 연다.

    웹앱(CPT)이 자기 사례를 정본으로 삼고 게임 형식으로 바꿔 보낼 때 쓴다.
    같은 사례를 두 곳에서 관리하면 환자 나이·성별이 갈려 화면과 대화가 어긋난다.
    """

    case: dict


@app.post("/api/session/start_adhoc")
async def start_session_adhoc(req: AdhocStartRequest):
    case = req.case
    for key in ("case_id", "title", "chief_complaint", "patient_profile",
                "initial_facts", "hidden_facts", "diagnosis_options", "test_options"):
        if key not in case:
            raise HTTPException(422, f"case.{key} 가 필요합니다.")
    case_loader.register_adhoc(case)
    return _open_session(case)


def _open_session(case: dict):
    state = patient_state.init_state(case)
    session = store.create(case, state)
    profile = case["patient_profile"]
    appearance = case_loader.appearance_from_profile(profile)
    return {
        "session_id": session["session_id"],
        "patient": {
            "name": profile["name"],
            "age": profile["age"],
            "gender": profile["gender"],
            "occupation": profile.get("occupation", ""),
            "body_type": profile.get("body_type"),
            "signs": profile.get("signs") or [],
            # 통증 기준선 — 3D 표정이 매 턴 LLM 감정에만 의존하면 표정이 계속 밋밋하다.
            # 요로결석 산통처럼 "가만히 있어도 아픈" 케이스는 기본 표정 자체가 아파야 한다.
            "pain_level": appearance["pain_level"],
            # 산통 주기(초). 0/None 이면 파고 없이 일정한 통증으로 본다.
            "pain_colicky_period": appearance["pain_colicky_period"],
            "appearance": appearance,
        },
        "guardian": case.get("guardian"),
        "title": case["title"],
        "chief_complaint": case["chief_complaint"],
        "initial_message": case["chief_complaint"],
        # CPX 상황지침 (진료접수증) — 한 줄 제시문 + 활력징후 (없으면 None)
        "presentation": case.get("presentation"),
        "vitals": case.get("vitals"),
        "max_turns": case.get("max_turns", 15),
        "state": _public_state(state),
        "diagnosis_options": case["diagnosis_options"],
        "test_options": case["test_options"],
        # CPX 가중치 케이스면 신체진찰/환자교육 단계 데이터 동봉 (없으면 None → 기존 흐름)
        "scoring_weights": case.get("scoring_weights"),
        "exam_items": case.get("exam_items", []),
        "education_items": case.get("education_items", []),
    }


def _public_state(state: dict) -> dict:
    """프론트로 보낼 상태 — hidden facts 내용은 절대 노출하지 않는다."""
    return {
        "trust": state["trust"],
        "anxiety": state["anxiety"],
        "rapport": state["rapport"],
        "disclosed_facts": state["disclosed_facts"],
        "hidden_total": len(state["hidden_facts"]),
        "hidden_unlocked": sum(1 for f in state["hidden_facts"].values() if f["unlocked"]),
    }


class TurnRequest(BaseModel):
    user_text: str


@app.post("/api/session/{session_id}/turn")
async def turn(session_id: str, req: TurnRequest):
    session = store.get(session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    if session["status"] != "in_progress":
        raise HTTPException(409, "session already ended")
    case = case_loader.load(session["case_id"])
    if session["current_turn"] >= case.get("max_turns", 15):
        raise HTTPException(409, "no turns left")
    user_text = req.user_text.strip()
    if not user_text:
        raise HTTPException(422, "empty text")

    # 최근 대화 맥락 — 되묻기/설득이 직전 주제로 이어지도록
    patient_name = case["patient_profile"]["name"]
    history = "\n".join(
        f"의사: {t['user_text']}\n{patient_name}: {t['patient_text']}"
        for t in session["dialogue"][-3:]
    )
    # Codex 엔진: 1회 호출로 분석+응답. 실패 시 기존 2단계 경로 폴백.
    combined = None
    if llm_service.ENGINE == "codex" and not case.get("guardian"):
        combined = await turn_engine.combined_turn(case, session["state"], user_text, history)
    if combined is not None:
        analysis, patient_text = combined
        result = patient_state.update(session["state"], analysis)
        state = result["state"]
        # LLM 응답과 룰 엔진 해금 판정의 정합성 보장 (키워드 보정 등으로 어긋날 수 있음)
        if result["unlocked_facts"]:
            if not any(f["value"][:8] in patient_text for f in result["unlocked_facts"]):
                # 해금됐는데 고백이 빠짐 → 빠른 로컬 LLM으로 고백 대사 재생성
                patient_text = await patient_responder.respond(
                    case, state, analysis, result, user_text, history, prefer="ollama"
                )
        elif result["blocked_fact"] is not None and analysis["is_sensitive_question"]:
            # 차단됐는데 LLM이 비밀을 말했을 위험 — 잠긴 사실 일부가 포함되면 거부 대사로 교체
            blocked_val = result["blocked_fact"]["value"]
            if blocked_val[:8] in patient_text:
                patient_text = result["blocked_fact"]["refusal_line"]
    else:
        analysis = await intent_analyzer.analyze(user_text, history)
        result = patient_state.update(session["state"], analysis)
        state = result["state"]
        speaker = (
            "guardian"
            if case.get("guardian") and analysis.get("topic") in set(case.get("guardian_topics") or [])
            else "patient"
        )
        patient_text = await patient_responder.respond(
            case, state, analysis, result, user_text, history, speaker=speaker
        )
    emotion = patient_state.emotion_of(state, analysis, result["unlocked_facts"], result["blocked_fact"])

    session["state"] = state
    session["current_turn"] += 1
    turn_log = {
        "turn": session["current_turn"],
        "user_text": user_text,
        "patient_text": patient_text,
        "intent": analysis["intent"],
        "emotion": emotion,
        # PPI 평가용 신호
        "empathy": bool(analysis.get("empathy")),
        "tone": analysis.get("tone", "neutral"),
        "pressure": bool(analysis.get("pressure")),
        "trust_after": state["trust"],
        "anxiety_after": state["anxiety"],
        "unlocked_facts": [f["key"] for f in result["unlocked_facts"]],
    }
    session["dialogue"].append(turn_log)

    game_over = None
    max_turns = case.get("max_turns", 15)
    if state["trust"] <= 10:
        game_over = "trust_collapsed"
        store.finish(session, "failed_trust")
    elif session["current_turn"] >= max_turns:
        game_over = "turns_exhausted"
        store.finish(session, "timeout")  # 제출 없이 떠나도 세션이 정리되도록

    return {
        "turn": session["current_turn"],
        "max_turns": max_turns,
        "user_text": user_text,
        "patient_text": patient_text,
        "speaker": locals().get("speaker", "patient"),
        "intent_analysis": {
            "intent": analysis["intent"],
            "empathy": analysis["empathy"],
            "tone": analysis["tone"],
            "is_red_flag_check": analysis["is_red_flag_check"],
            # [의학리뷰 #6] "눈 좀 볼게요"처럼 결막·공막을 특정하지 않은 발화만 true.
            # 프론트는 이 값이 true일 때만 "케이스가 가진 눈 항목"으로 보내도 된다 —
            # "공막 볼게요"(false)가 빈혈 케이스에서 결막검사를 시행하면 안 된다.
            "eye_target_ambiguous": bool(analysis.get("eye_target_ambiguous")),
        },
        "state": _public_state(state),
        "delta": result["delta"],
        "unlocked_facts": result["unlocked_facts"],
        "emotion": emotion,
        "game_over": game_over,
    }


@app.post("/api/audio/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    data = await audio.read()
    if len(data) < 100:
        raise HTTPException(422, "audio too short")
    try:
        text = await stt_service.transcribe(data)
    except Exception as e:
        raise HTTPException(503, f"STT unavailable: {e}")
    print(f"[stt] {len(data)} bytes -> {text!r}", flush=True)
    return {"text": text}


class TTSRequest(BaseModel):
    text: str
    gender: str = "female"
    emotion: str = "neutral"
    age: int | None = None


@app.post("/api/tts")
async def tts(req: TTSRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(422, "empty text")
    try:
        audio, mime = await tts_service.synthesize(text, req.gender, req.emotion, req.age)
    except Exception as e:
        raise HTTPException(503, f"TTS unavailable: {e}")
    return Response(content=audio, media_type=mime)


class TalkRequest(BaseModel):
    text: str
    gender: str = "female"
    age: int = 30
    emotion: str = "neutral"


@app.post("/api/talk")
async def talk(req: TalkRequest):
    """환자가 text를 말하는 토킹헤드 mp4(음성 포함)를 반환."""
    text = req.text.strip()
    if not text:
        raise HTTPException(422, "empty text")
    try:
        mp4 = await talkinghead_service.synthesize_talk(
            text, req.gender, req.age, req.emotion
        )
    except Exception as e:
        # 모델 미설치/실패 시 503 → 프론트는 정적 사진 + 오디오 폴백
        raise HTTPException(503, f"talkinghead unavailable: {e}")
    return Response(content=mp4, media_type="video/mp4")


def _exam_summary(case: dict, session: dict) -> dict:
    """exam_log → 채점·PPI용 요약 (수행 목록 / 손위생 선행 / must_precede 순서 위반).

    exam_log에는 **완료된** 항목만 들어온다 (부위별 부분 진행은 exam_progress에만 쌓인다).
    """
    order = [e["action_id"] for e in session.get("exam_log", [])]
    items = case.get("exam_items", [])
    actions = [it for it in items if it.get("type") == "exam_action"]
    action_ids = {it["id"] for it in actions}
    performed = [a for a in order if a in action_ids]
    first_exam_index = next((i for i, a in enumerate(order) if a in action_ids), None)

    # must_precede를 일반 규칙으로 해석한다 (기존의 auscultation 하드코딩 분기를 대체).
    # A의 must_precede: [B] = "A는 B보다 먼저". B를 아예 안 했으면 선후를 논할 수 없으므로 위반이 아니다
    #   — 이 조건이 없으면 "CVA만 시행"에도 청진 순서 위반이 잡혀 엉뚱한 페널티 문구가 나왔다.
    order_violations: list[dict] = []
    for it in actions:
        a = it["id"]
        for b in it.get("must_precede") or []:
            if b not in action_ids or b not in order:
                continue
            if a not in order:
                order_violations.append({"item": a, "before": b, "kind": "skipped"})
            elif order.index(b) < order.index(a):
                order_violations.append({"item": a, "before": b, "kind": "wrong_order"})

    return {
        "order": order,
        "performed": performed,
        "first_exam_index": first_exam_index,
        "order_ok": not order_violations,
        "order_violations": order_violations,
        # PPI가 "이 케이스에 그 항목/규칙이 있는가"로 na를 가르기 위해 필요 (§4.1).
        # 없는 항목을 영구 fail로 깎던 부당 감점을 막는다.
        "exam_item_ids": [it["id"] for it in items],
        "has_order_rules": any(it.get("must_precede") for it in actions),
        # 부위별 진행 순서 — tender_region("아픈 부위는 마지막") 판정에 쓴다
        "exam_progress": {k: list(v) for k, v in (session.get("exam_progress") or {}).items()},
    }


def _exam_required_keys(item: dict) -> list[str]:
    """항목을 완료하려면 찍어야 하는 진행 키 전체.

    required_regions가 없으면 빈 목록 → 기존처럼 1회 시행으로 완료된다(하위호환).
    passes가 있으면 pass마다 모든 부위를 돌아야 하므로 "<pass>:<region>" 형식이 된다.
    """
    regions = item.get("required_regions") or []
    if not regions:
        return []
    passes = item.get("passes") or []
    if not passes:
        return list(regions)
    return [f"{p}:{r}" for p in passes for r in regions]


def _exam_progress_view(item: dict, done_keys: list[str]) -> tuple[dict, str | None]:
    """진행 상태를 프론트 계약(progress, current_pass)으로 환산.

    done/remaining의 키 형식은 세션 exam_progress와 **동일한 합성 키**다 (스펙 §2:
    passes 없으면 "<region>", 있으면 "<pass>:<region>"). 순수 region id로 낮추면 안 된다 —
    프론트 세 곳이 이 키로 "지금 pass에서 이 부위를 찍었는가"를 판정하기 때문이다:
      · store.derivePass  : done에 "<pass>:<region>"이 없는 첫 pass를 '다음에 할 pass'로 본다.
        region id만 오면 light를 영원히 다음 pass로 보고 deep 요청을 못 보내 촉진이 미완료로 잠긴다.
      · ClinicScene.RegionMesh : 완료 부위 회색 디스크 판정
      · ExamPanel : pass별 남은 부위 필터
    라벨은 store.regionLabelOfKey가 "<pass>:" 접두사를 떼고 뽑으므로 합성 키여도 문제없다.
    total도 같은 이유로 '전체 요구 키 수'다 (촉진 = 2 pass × 4분면 = 8).
    """
    required = _exam_required_keys(item)
    done = set(done_keys)
    view = {
        "done": [k for k in required if k in done],
        "remaining": [k for k in required if k not in done],
        "total": len(required),
    }
    # 다음에 해야 할 pass = 아직 다 못 채운 첫 pass. 전부 끝났으면 None.
    regions = list(item.get("required_regions") or [])
    for p in item.get("passes") or []:
        if any(f"{p}:{r}" not in done for r in regions):
            return view, p
    return view, None


# [의학리뷰 #8] 하지 않은 설명·동의가 로그에 남는 문제.
# explain_consent는 "침대에 누우실까요" 한 마디(request_exam)만으로도 프론트가 자동 기록한다.
# 그런데 케이스 JSON의 소견은 "진찰 목적과 방법을 설명하고 동의를 구했습니다"라, 학생이 하지 않은 일을
# 서버가 했다고 확인해 준다. 실제로 일어난 일에 맞는 문구로 서버가 바로잡는다.
#   · 기록 자체는 그대로 남긴다 — 이게 없으면 진찰 단계로 넘어가지 못한다.
#   · 목적·방법·불편감까지 설명했는지는 PPI 6-2가 대화 기록으로 따로 엄격 판정한다(그 동작은 그대로 둔다).
AUTO_LOGGED_PREP_FINDINGS = {
    "explain_consent": "진찰을 하겠다고 알리고 환자의 동의를 얻었습니다.",
}


def _dominant_sound(item: dict) -> str | None:
    """항목 전체를 대표하는 청진음 — 부위별 sound 중 가장 많이 나온 것.

    부위를 나눠 찍지 않고 한 번에 완료되는 호출(음성 지시)에서도 소리가 나야 한다.
    소리가 없으면 학생은 '심박수 112'라고 적힌 소견을 눈으로만 읽게 되고,
    청진이 '읽기'가 되어 버린다 (의학리뷰 #1이 지적한 활력징후↔심음 불일치와 같은 부류).
    """
    sounds = [
        rf.get("sound")
        for rf in (item.get("region_findings") or {}).values()
        if isinstance(rf, dict) and rf.get("sound")
    ]
    if not sounds:
        return item.get("sound")
    return max(set(sounds), key=sounds.count)


class ExamRequest(BaseModel):
    # pass는 파이썬 예약어라 필드명은 pass_, 와이어 포맷은 alias "pass"를 쓴다.
    model_config = ConfigDict(populate_by_name=True)

    action_id: str
    region: str | None = None
    pass_: str | None = Field(None, alias="pass")  # "light" | "deep"


@app.post("/api/session/{session_id}/exam")
async def exam_action(session_id: str, req: ExamRequest):
    session = store.get(session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    case = case_loader.load(session["case_id"])
    items = {it["id"]: it for it in case.get("exam_items", [])}
    it = items.get(req.action_id)
    if it is None:
        raise HTTPException(404, "exam action not found")

    prog_all = session.setdefault("exam_progress", {})  # action_id → 찍은 키 목록(순서 보존)
    required = _exam_required_keys(it)
    entry_key: str | None = None
    progress: dict | None = None
    current_pass: str | None = None

    if not required:
        complete = True  # 부위 개념이 없는 항목(준비·두경부 등) — 기존과 동일하게 1회로 완료
    else:
        done_keys: list[str] = prog_all.setdefault(req.action_id, [])
        if req.region is None:
            # 하위호환: 부위 없이 들어온 호출(구버전 프론트/음성 시행)은 예전처럼 "1회 = 완료"로 본다.
            # 부분 진행을 모르는 클라이언트가 영구 미완료로 막히는 것보다 낫다.
            for k in required:
                if k not in done_keys:
                    done_keys.append(k)
        else:
            passes = it.get("passes") or []
            if passes:
                # 클라이언트가 pass를 안 보내면 서버가 판단한 '지금 해야 할 pass'로 채운다
                p = req.pass_ if req.pass_ in passes else (_exam_progress_view(it, done_keys)[1] or passes[-1])
                entry_key = f"{p}:{req.region}"
            else:
                entry_key = req.region
            # 허용되지 않은 부위는 기록하지 않는다(요청은 실패시키지 않고 현재 진행 상태만 돌려준다)
            if entry_key in required and entry_key not in done_keys:
                done_keys.append(entry_key)
        complete = all(k in done_keys for k in required)
        progress, current_pass = _exam_progress_view(it, done_keys)

    item_finding = AUTO_LOGGED_PREP_FINDINGS.get(req.action_id, it.get("finding", ""))
    finding = item_finding
    reaction = it.get("reaction")  # 촉진/CVA 환자 반응 (표정+대사+강도) — 없으면 None
    # 청진음 키 (public/sounds/exam/{heart,lung,bowel}/*.mp3 파일명). 부위를 찍었으면 그 부위 것,
    # 부위 없이 한 번에 완료한 호출이면 항목 대표음.
    sound = _dominant_sound(it)
    if entry_key:
        rf = (it.get("region_findings") or {}).get(entry_key) or {}
        # 완료 호출에서는 항목 최상위 '종합 소견'을 보내야 하므로 부위 소견으로 덮지 않는다.
        # 반응은 방금 찍은 부위의 것이 맞다 (우측 CVA를 마지막에 찍으면 아파해야 한다).
        if not complete and rf.get("finding"):
            finding = rf["finding"]
        if rf.get("reaction") is not None:
            reaction = rf["reaction"]
        if rf.get("sound"):
            sound = rf["sound"]

    if complete and not any(e["action_id"] == req.action_id for e in session["exam_log"]):
        session["exam_log"].append({
            "action_id": req.action_id,
            "label": it["label"],
            "finding": item_finding,
            "at_turn": session["current_turn"],
        })
    return {
        "action_id": req.action_id,
        "label": it["label"],
        "finding": finding,
        "reaction": reaction,
        "sound": sound,
        "complete": complete,
        "progress": progress,          # 부위 개념이 없는 항목은 None
        "current_pass": current_pass,  # passes가 있는 항목만, 다음에 해야 할 pass
        "exam_log": session["exam_log"],
        "summary": _exam_summary(case, session),
    }


class EducationPayload(BaseModel):
    diagnosis_evidence: list[str] = []
    test_plan: list[str] = []
    treatment: list[str] = []
    complication: list[str] = []


class SubmitRequest(BaseModel):
    diagnosis: list[str]
    tests: list[str]
    education: EducationPayload | None = None
    section_times: dict[str, float] | None = None


@app.post("/api/session/{session_id}/submit")
async def submit(session_id: str, req: SubmitRequest):
    session = store.get(session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    case = case_loader.load(session["case_id"])
    state = session["state"]
    # 자유 입력 진단명 → 후보 id로 매칭 (객관식 대신 직접 입력)
    typed_dx = (req.diagnosis[0] if req.diagnosis else "").strip()
    matched = await scoring.resolve_diagnosis_ids(typed_dx, case)
    # 환자교육 제출 저장 + 신체진찰 요약
    education = req.education.model_dump() if req.education else session.get("education")
    session["education"] = education
    exam = _exam_summary(case, session) if case.get("exam_items") else None
    result = scoring.compute_scores(
        case, state, matched, req.tests,
        exam=exam, education=education, dialogue=session["dialogue"],
    )
    feedback = await scoring.narrative_feedback(
        case, state, result, matched, req.tests, session["dialogue"],
        section_times=req.section_times, exam=exam,
    )
    insights = scoring.derive_learning_insights(
        case, state, result, matched, session["dialogue"]
    )
    if session["status"] in ("in_progress", "timeout"):
        store.finish(session, "submitted")
    return {
        **result,
        **insights,
        "feedback": feedback,
        "section_times": req.section_times,
        "typed_diagnosis": typed_dx,
        "teaching_points": case["teaching_points"],
        "turns_used": session["current_turn"],
        "final_state": _public_state(state),
    }
