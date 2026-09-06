"""환자 응답 생성 — LLM이 환자를 연기하되, 공개 가능한 정보는 rule 엔진이 결정한다."""
from __future__ import annotations

import re
from typing import Any

from . import llm_service


def _sanitize(text: str) -> str:
    """지문/접두사 제거 — TTS가 괄호 속 행동 묘사를 읽지 않도록."""
    text = text.strip().strip('"')
    text = re.sub(r"[(\(\[（][^)\)\]）]*[)\)\]）]", "", text)  # 괄호 지문 제거
    text = re.sub(r"^\s*(환자|지은|수진|현우)\s*[:：]\s*", "", text)  # "환자:" 접두사 제거
    return re.sub(r"\s{2,}", " ", text).strip().strip('"“” ‘’')


_is_contaminated = llm_service.is_contaminated
_strip_foreign = llm_service.strip_foreign

SYSTEM_PROMPT = """너는 의학 문진 시뮬레이션 게임의 가상 환자다. 사용자는 문진을 연습하는 의대생이다.

절대 규칙:
- 반드시 한국어로만 답한다. 영어 등 다른 언어 단어를 절대 섞지 않는다.
- 괄호 지문이나 행동 묘사를 쓰지 않는다. 오직 입으로 하는 말만 출력한다.
- 진단명을 절대 먼저 말하지 않는다. 의학 용어를 쓰지 않는다.
- 아래 [말해도 되는 정보]에 없는 증상이나 사실을 새로 지어내지 않는다.
- 환자처럼 자연스럽고 짧게 답한다. 1~3문장. 구어체.
- 인사만 받았을 때는 증상 얘기를 먼저 꺼내지 말고 짧게 인사만 한다.
- 신뢰도가 낮으면(50 미만) 말을 아끼고 짧게 답한다.
- 불안도가 높으면(65 이상) 방어적이거나 머뭇거린다.
- 공감적으로 질문받으면 조금 더 솔직하고 길게 말한다.
- 질문받지 않은 정보를 먼저 꺼내지 않는다.
- 너는 환자 본인이다. 절대 의사나 분석가처럼 말하지 않는다.

환자 정보:
이름: {name} ({age}세, {gender})
직업: {occupation}
성격: {personality_desc}
말투: {speaking_style}
주호소: {chief_complaint}

현재 심리 상태:
신뢰도 {trust}/100, 불안도 {anxiety}/100, 라포 {rapport}/100

[말해도 되는 정보] (이미 공개된 사실 — 질문과 관련된 것만 답해라):
{disclosed}

{turn_directive}"""

DIRECTIVE_UNLOCKED = """[이번 턴 특별 지시]
사용자의 이번 질문 덕분에 너는 마음을 열고 다음 사실을 처음으로 털어놓는다.
머뭇거리다가("그게... 사실은...") 조심스럽게 아래 내용을 고백하듯 말해라:
{fact}"""

DIRECTIVE_BLOCKED = """[이번 턴 특별 지시]
사용자가 민감한 부분을 물었지만 아직 신뢰가 부족해서 너는 솔직히 답하지 않는다.
다음 느낌으로 회피하거나 얼버무려라 (사실 자체를 부정하지는 말고 말을 돌려라):
"{refusal}" """

DIRECTIVE_NEGATIVE = """[이번 턴 특별 지시]
사용자의 질문에 대한 정확한 답은 다음과 같다. 이 내용을 네 말투로 자연스럽게 답해라:
"{answer}" """

DIRECTIVE_PRESSURED = """[이번 턴 특별 지시]
사용자가 다그치듯 물어서 너는 위축되었다. 짧고 방어적으로 답해라."""

DIRECTIVE_PREMATURE = """[이번 턴 특별 지시]
사용자가 성급하게 진단을 단정해서 너는 놀라고 불안해졌다.
"네...? 그게 무슨..." 같은 동요하는 반응을 보여라."""

DIRECTIVE_IRRELEVANT = """[이번 턴 특별 지시]
진료와 무관한 질문이다. 어리둥절해하며 짧게 답하거나 되물어라."""

DIRECTIVE_GREETING = """[이번 턴 특별 지시]
인사에 어색하게 인사로 답하고, 살짝 긴장한 기색을 보여라."""

DIRECTIVE_EXAM_REQUEST = """[이번 턴 특별 지시]
의사가 진찰을 위해 침대에 누우라고 권한다. "네, 알겠습니다" 하고 협조하며
천천히 눕겠다고 짧게 답해라. (통증이 있으면 살짝 힘들어하되 협조한다.)"""

DIRECTIVE_FLEX_KNEES = """[이번 턴 특별 지시]
의사가 무릎을 세우라고(복부 진찰 자세) 요청한다. "네" 하고 협조하며
무릎을 세우겠다고 아주 짧게 답해라."""


def _build_directive(case: dict, analysis: dict, turn_result: dict) -> str:
    if turn_result["unlocked_facts"]:
        facts = "\n".join(f"- {f['value']}" for f in turn_result["unlocked_facts"])
        return DIRECTIVE_UNLOCKED.format(fact=facts)
    if turn_result["blocked_fact"] is not None:
        return DIRECTIVE_BLOCKED.format(refusal=turn_result["blocked_fact"]["refusal_line"])
    if analysis["is_premature_diagnosis"]:
        return DIRECTIVE_PREMATURE
    if analysis["pressure"]:
        return DIRECTIVE_PRESSURED
    if analysis["intent"] == "greeting":
        return DIRECTIVE_GREETING
    if analysis["intent"] == "request_exam":
        return DIRECTIVE_EXAM_REQUEST
    if analysis["intent"] == "flex_knees":
        return DIRECTIVE_FLEX_KNEES
    if analysis["intent"] == "irrelevant_question":
        return DIRECTIVE_IRRELEVANT
    # 음성(negative) 소견: 케이스에 정답이 정의된 토픽이면 그대로 전달
    neg = case.get("negative_findings", {})
    topic = analysis["topic"]
    if topic in neg:
        return DIRECTIVE_NEGATIVE.format(answer=neg[topic])
    return "[이번 턴 특별 지시]\n질문과 관련해 [말해도 되는 정보] 범위 안에서만 답해라. 모르는 건 모른다고 해라."


_STATIC_FALLBACK = {
    "greeting": "아, 네... 안녕하세요...",
    "irrelevant_question": "네...? 그게 진료랑 상관이 있나요...?",
    "request_exam": "네, 알겠습니다. 천천히 누울게요...",
    "flex_knees": "네, 무릎 세울게요.",
}


async def respond(
    case: dict[str, Any],
    state: dict[str, Any],
    analysis: dict[str, Any],
    turn_result: dict[str, Any],
    user_text: str,
    history: str = "",
    prefer: str | None = None,
    speaker: str = "patient",
) -> str:
    profile = case["patient_profile"]
    disclosed = "\n".join(f"- {f['value']}" for f in state["disclosed_facts"]) or "- (없음)"
    system = SYSTEM_PROMPT.format(
        name=profile["name"],
        age=profile["age"],
        gender="여성" if profile["gender"] == "female" else "남성",
        occupation=profile.get("occupation", ""),
        personality_desc=profile.get("personality_desc", ""),
        speaking_style=profile.get("speaking_style", ""),
        chief_complaint=case["chief_complaint"],
        trust=state["trust"],
        anxiety=state["anxiety"],
        rapport=state["rapport"],
        disclosed=disclosed,
        turn_directive=_build_directive(case, analysis, turn_result),
    )
    # 아이+보호자 동반 진료: 병력·약물 등은 보호자(엄마)가 대신 대답한다
    if speaker == "guardian" and case.get("guardian"):
        g = case["guardian"]
        system += (
            f"\n\n[화자 전환 — 매우 중요] 이번 대답은 환자 본인이 아니라 동행한 보호자 "
            f"{g.get('relation','보호자')}({g.get('name','')}, {g.get('age','')}세)가 한다. "
            f"침착하지만 걱정스러운 보호자 말투로, 아이를 대신해 아는 사실만 답해라. "
            f"'저희 아이', '우리 {profile['name']}이' 같은 보호자 1인칭 시점으로 말하고, 아이 말투를 쓰지 마라."
        )
    context = f"최근 대화 (맥락을 기억하고 이어서 답해라):\n{history}\n\n" if history else ""
    responder_label = (
        f"보호자 {case['guardian'].get('relation','보호자')}"
        if speaker == "guardian" and case.get("guardian")
        else f"환자 {profile['name']}"
    )
    user_prompt = f'{context}의대생의 말: "{user_text}"\n\n{responder_label}의 대답 (반드시 순수 한국어로만, 말소리만):'
    try:
        text = _sanitize(
            await llm_service.chat(system, user_prompt, temperature=0.7, max_tokens=200, prefer=prefer)
        )
        if text and _is_contaminated(text):
            # 외국어 혼입 → 낮은 온도로 1회 재생성
            retry = _sanitize(
                await llm_service.chat(system, user_prompt, temperature=0.35, max_tokens=200, prefer=prefer)
            )
            if retry and not _is_contaminated(retry):
                text = retry
            else:
                stripped = _strip_foreign(retry or text)
                text = stripped if len(stripped) >= 5 else ""
        if text:
            return text
    except Exception:
        pass
    # LLM 불가 시 최소한의 정적 응답으로 게임 지속
    if turn_result["unlocked_facts"]:
        return "그게... 사실은... " + turn_result["unlocked_facts"][0]["value"]
    if turn_result["blocked_fact"] is not None:
        return turn_result["blocked_fact"]["refusal_line"]
    neg = case.get("negative_findings", {})
    if analysis["topic"] in neg:
        return neg[analysis["topic"]]
    return _STATIC_FALLBACK.get(analysis["intent"], "음... 잘 모르겠어요.")
