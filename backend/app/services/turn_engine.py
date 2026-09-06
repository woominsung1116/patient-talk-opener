"""통합 턴 엔진 (Codex용) — 한 번의 LLM 호출로 의도 분석 + 환자 응답을 생성한다.

codex exec는 호출당 세션 스핀업 비용(~10초+)이 커서 턴당 2회 호출이 부담이다.
대신 해금 조건을 서버가 미리 계산한 지시 테이블로 프롬프트에 넣어 1회로 줄인다.
반환된 분석 JSON은 기존 _normalize/키워드 보정을 거치고, 해금은 룰 엔진이 최종 판정한다.
"""
from __future__ import annotations

from typing import Any

from . import llm_service
from .intent_analyzer import (
    INTENT_TOPIC,
    INTENTS,
    RED_FLAG_INTENTS,
    _ALARMING_PAT,
    _REASSURING_PAT,
    _apply_overrides,
    _normalize,
    merge_keyword_signals,
)
from .patient_responder import _sanitize

SYSTEM = """너는 의학 문진 시뮬레이션의 게임 엔진이다. 두 가지 일을 한 번에 한다:
1) 의대생(사용자)의 발화 의도 분석
2) 그 분석에 따른 환자의 자연스러운 대답 생성

[의도 분석 규칙]
허용 intent: {intents}
- 발화가 직전 대화 주제의 연속(설득, 안심시키기, "진료에 필요해서요" 등)이면 그 주제의 intent를 유지한다.
  예: 직전에 생리 질문을 환자가 회피했는데 "힘드시겠지만 진료에 필요합니다"라고 하면
  intent=ask_menstruation, empathy=true다. 환자도 그 맥락을 기억하고 이어서 답한다.
- empathy: 환자 감정을 인정/안심시키는 표현이 있으면 true
- tone: gentle|neutral|cold|pressuring
- pressure: 다그침/추궁이면 true
- medical_relevance: high|medium|low
- is_premature_diagnosis: 성급한 진단 단정이면 true
- 인사+질문이 섞이면 질문 쪽 intent
- 변 색깔/검은 변 질문은 ask_melena

[환자 정보]
이름: {name} ({age}세, {gender}) / 직업: {occupation}
성격: {personality} / 말투: {speaking_style}
주호소: {chief_complaint}
현재 심리: 신뢰도 {trust}/100, 불안도 {anxiety}/100

[환자가 이미 말한 사실 — 질문과 관련된 것만 답해도 됨]
{disclosed}

[조건부 고백 테이블 — 네 분석 결과가 조건과 일치할 때만 해당 사실을 처음으로 고백하라]
{unlock_table}

[그 외 질문의 정답 테이블 — intent가 일치하면 이 내용을 환자 말투로]
{negative_table}

[환자 대답 절대 규칙]
- 반드시 순수 한국어. 괄호 지문 금지. 1~3문장 구어체.
- 진단명/의학용어 금지. 위 테이블에 없는 **증상·생활습관·병력 등 어떤 사실도** 지어내지 마라.
- ⚠ 조건부 고백 테이블에 있는 주제를 물었는데 조건이 아직 안 맞으면,
  **그 사실과 반대되는 내용을 절대 지어내지 마라.** 모른다는 듯 얼버무리거나
  화제를 돌려라. (예: "물 거의 안 마신다"가 아직 안 열렸는데 "평소엔 많이
  마셔요"라고 답하면 학생이 진단에서 멀어진다 — 실제로 그렇게 틀린 적이 있다.)
  숨기는 것은 괜찮지만 **거짓을 말하는 것은 안 된다.**
- 다그치면 위축되어 짧게, 공감받으면 조금 더 솔직하게.
- 성급한 진단을 들으면 동요한다. 인사만 받으면 어색하게 인사만 한다.
- 진찰을 위해 눕기를 권하면(누우세요/진찰하겠습니다 등) intent=request_exam, "네, 알겠습니다" 하고 협조하며 짧게 답한다.
- 두경부 진찰 지시에도 짧게 협조한다: 결막/눈꺼풀 안쪽을 보자고 하면 intent=do_conjunctiva "네." /
  공막·흰자위·황달을 보자고 하면 intent=do_sclera "네." (결막과 공막은 다른 진찰이니 섞지 마라) /
  입을 벌리거나 혀를 내밀라면 intent=do_oral "네." / "아-" 하고 소리 내라면 intent=do_say_ah "아——." /
  갑상샘(목)을 만진다면 intent=do_thyroid "네." / 침이나 물을 삼켜보라면 intent=do_swallow "네, 꿀꺽." /
  갑상샘(목)을 눈으로 보겠다고 하면 intent=do_thyroid_inspect "네."
- 그 밖의 진찰 지시에도 짧게 협조한다: 턱을 들거나 고개를 젖히라면 intent=do_chin_up "네, 이렇게요?" /
  숨을 크게 쉬라면 intent=do_deep_breath "네, 후우…" / 손을 앞으로 뻗거나 펴라면 intent=do_tremor_check "네, 이렇게요." /
  간을 만지겠다거나 갈비뼈 아래를 누르겠다면 intent=do_liver_palpate "네." /
  심장 소리를 듣겠다면 intent=do_heart_auscultate "네." / 폐 소리·숨소리를 듣겠다면 intent=do_lung_auscultate "네."

[출력 — JSON만, 다른 텍스트 금지]
{{"analysis": {{"intent": "...", "empathy": true, "tone": "gentle", "pressure": false,
"medical_relevance": "high", "is_sensitive_question": false, "is_premature_diagnosis": false}},
"reply": "환자의 대답"}}"""


def _build_tables(case: dict[str, Any], state: dict[str, Any]) -> tuple[str, str]:
    rows = []
    for key, fact in state["hidden_facts"].items():
        if fact["unlocked"]:
            continue
        cond = fact["unlock_condition"]
        intent_label = " 또는 ".join(f"intent={i}" for i in cond["intents"])
        trust_ok = state["trust"] >= cond["required_trust"]
        if not trust_ok:
            rows.append(
                f"- {intent_label}: 아직 신뢰가 부족하다. 솔직히 답하지 말고 이런 느낌으로 얼버무려라: \"{fact['refusal_line']}\""
            )
        elif cond["requires_empathy"]:
            rows.append(
                f"- {intent_label} 그리고 empathy=true 일 때만 → 머뭇거리다 고백: \"{fact['value']}\" / empathy=false면 얼버무려라: \"{fact['refusal_line']}\""
            )
        else:
            rows.append(f"- {intent_label} → 조심스럽게 털어놓아라: \"{fact['value']}\"")
    unlock_table = "\n".join(rows) or "- (없음)"

    neg_rows = [
        f"- topic={topic}: \"{answer}\""
        for topic, answer in case.get("negative_findings", {}).items()
    ]
    negative_table = "\n".join(neg_rows) or "- (없음)"
    return unlock_table, negative_table


async def combined_turn(
    case: dict[str, Any], state: dict[str, Any], user_text: str, history: str = ""
) -> tuple[dict[str, Any], str] | None:
    """1회 codex 호출로 (분석, 환자응답) 반환. 실패 시 None → 기존 2단계 경로로."""
    profile = case["patient_profile"]
    unlock_table, negative_table = _build_tables(case, state)
    disclosed = "\n".join(f"- {f['value']}" for f in state["disclosed_facts"]) or "- (없음)"
    system = SYSTEM.format(
        intents=", ".join(INTENTS),
        name=profile["name"],
        age=profile["age"],
        gender="여성" if profile["gender"] == "female" else "남성",
        occupation=profile.get("occupation", ""),
        personality=profile.get("personality_desc", ""),
        speaking_style=profile.get("speaking_style", ""),
        chief_complaint=case["chief_complaint"],
        trust=state["trust"],
        anxiety=state["anxiety"],
        disclosed=disclosed,
        unlock_table=unlock_table,
        negative_table=negative_table,
    )
    user_prompt = (
        f'최근 대화:\n{history}\n\n의대생의 말: "{user_text}"' if history else f'의대생의 말: "{user_text}"'
    )
    try:
        out = await llm_service.codex_chat(system, user_prompt)
        parsed = llm_service.extract_json(out)
        if not parsed or "analysis" not in parsed or not parsed.get("reply"):
            return None
        analysis = _normalize(parsed["analysis"])
        analysis = _apply_overrides(analysis, user_text)
        analysis["topic"] = INTENT_TOPIC.get(analysis["intent"], "irrelevant")
        # 키워드 보조 신호 병합 + 구체적 진찰 지시(갑상샘/결막/구강 등) 승격 — analyze()와 동일 규칙
        merge_keyword_signals(analysis, user_text)
        analysis["is_red_flag_check"] = analysis["intent"] in RED_FLAG_INTENTS
        analysis["is_alarming"] = bool(_ALARMING_PAT.search(user_text))
        analysis["is_reassuring"] = bool(_REASSURING_PAT.search(user_text))
        reply = _sanitize(str(parsed["reply"]))
        if not reply or llm_service.is_contaminated(reply):
            return None
        return analysis, reply
    except Exception:
        return None
