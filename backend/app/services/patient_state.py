"""환자 상태 엔진 — rule-based 상태 업데이트와 hidden fact 해금.

게임성의 핵심. LLM에게 판단을 맡기지 않는다 (구현계획서 15장 원칙).
"""
from __future__ import annotations

import copy
from typing import Any


def init_state(case: dict[str, Any]) -> dict[str, Any]:
    profile = case["patient_profile"]
    init = case.get("initial_state", {})
    return {
        "patient_id": case["case_id"],
        "name": profile["name"],
        "age": profile["age"],
        "chief_complaint": case["chief_complaint"],
        "trust": init.get("trust", 45),
        "anxiety": init.get("anxiety", 60),
        "rapport": init.get("rapport", 40),
        "disclosed_facts": [
            {"key": f["key"], "label": f["label"], "value": f["value"]}
            for f in case["initial_facts"]
        ],
        "hidden_facts": {
            f["key"]: {
                "label": f["label"],
                "value": f["value"],
                "sensitivity": f["sensitivity"],
                "unlocked": False,
                "refusal_line": f.get("refusal_line", "그건... 잘 모르겠어요."),
                "unlock_condition": {
                    # 인텐트는 **여러 개**를 받는다. 같은 질문이라도 LLM 모델이
                    # 바뀌면 분류가 달라지기 때문이다 — "수분 섭취는 어떻게
                    # 하세요?"를 codex 는 ask_social_history 로, qwen2.5 는
                    # ask_diet 로 분류한다(2026-08-03 실측). 하나만 걸어 두면
                    # 모델을 바꾸는 순간 단서가 조용히 안 열리고, 그 자리를
                    # 모델이 즉흥으로 채워 **케이스와 모순되는 답**을 만든다.
                    "intents": (
                        [f["unlock_intent"]]
                        if isinstance(f["unlock_intent"], str)
                        else list(f["unlock_intent"])
                    ),
                    "required_trust": f["required_trust"],
                    "requires_empathy": f["requires_empathy"],
                },
            }
            for f in case["hidden_facts"]
        },
        "asked_topics": [],
        "irrelevant_streak": 0,
        "score": {"history_taking": 0, "rapport": 0, "red_flag": 0, "clinical_reasoning": 0},
    }


def _clamp(state: dict[str, Any]) -> None:
    for k in ("trust", "anxiety", "rapport"):
        state[k] = max(0, min(100, state[k]))


def _unlock_hidden_facts(state: dict[str, Any], analysis: dict[str, Any]) -> list[dict]:
    unlocked: list[dict] = []
    for key, fact in state["hidden_facts"].items():
        if fact["unlocked"]:
            continue
        cond = fact["unlock_condition"]
        if analysis["intent"] not in cond["intents"]:
            continue
        if state["trust"] < cond["required_trust"]:
            continue
        if cond["requires_empathy"] and not analysis["empathy"]:
            continue
        fact["unlocked"] = True
        disclosed = {"key": key, "label": fact["label"], "value": fact["value"]}
        state["disclosed_facts"].append(disclosed)
        unlocked.append(disclosed)
    return unlocked


def _blocked_fact(state: dict[str, Any], analysis: dict[str, Any]) -> dict | None:
    """이번 질문이 hidden fact를 겨냥했지만 조건 미달로 막힌 경우 그 fact를 반환."""
    for fact in state["hidden_facts"].values():
        if fact["unlocked"]:
            continue
        if analysis["intent"] in fact["unlock_condition"]["intents"]:
            return fact
    return None


def update(state: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    """한 턴의 의도 분석 결과를 상태에 적용하고 턴 결과를 반환한다."""
    state = copy.deepcopy(state)
    delta = {"trust": 0, "anxiety": 0, "rapport": 0}
    score_delta = {"history_taking": 0, "rapport": 0, "red_flag": 0, "clinical_reasoning": 0}

    topic = analysis["topic"]
    repeated = topic in state["asked_topics"] and topic not in ("empathy", "greeting")

    if analysis["empathy"]:
        delta["trust"] += 8
        delta["anxiety"] -= 5
        delta["rapport"] += 8
        if not repeated and state["score"]["rapport"] < 20:  # 공감 도배로 무한 누적 방지
            score_delta["rapport"] += 4

    if analysis["pressure"]:
        delta["trust"] -= 10
        delta["anxiety"] += 12
        delta["rapport"] -= 6

    # 민감 질문을 공감 없이 직접 질문
    if analysis["is_sensitive_question"] and not analysis["empathy"]:
        delta["trust"] -= 6
        delta["anxiety"] += 10
        delta["rapport"] -= 5

    if analysis["is_premature_diagnosis"]:
        delta["trust"] -= 5
        delta["anxiety"] += 8
        score_delta["clinical_reasoning"] -= 3

    # 부정적·심각한 내용을 공감 없이 들으면 불안↑ (공감을 곁들이면 충격 완화)
    if analysis.get("is_alarming"):
        delta["anxiety"] += 6 if analysis["empathy"] else 13
        if not analysis["empathy"]:
            delta["trust"] -= 2

    # 안심시키는 긍정적 말 → 불안↓, 신뢰·라포↑
    if analysis.get("is_reassuring"):
        delta["anxiety"] -= 10
        delta["trust"] += 3
        delta["rapport"] += 3

    if analysis["medical_relevance"] == "high" and not repeated:
        score_delta["history_taking"] += 5

    if analysis["is_red_flag_check"] and not repeated:
        score_delta["red_flag"] += 8

    if analysis["intent"] == "irrelevant_question":
        state["irrelevant_streak"] += 1
        if state["irrelevant_streak"] >= 2:
            delta["trust"] -= 3
            delta["rapport"] -= 3
    else:
        state["irrelevant_streak"] = 0

    # 같은 의학적 질문 반복 — 환자가 불신/짜증을 느낀다
    if repeated:
        delta["trust"] -= 3
        delta["rapport"] -= 3
        state["repeat_streak"] = state.get("repeat_streak", 0) + 1
    else:
        state["repeat_streak"] = 0

    state["trust"] += delta["trust"]
    state["anxiety"] += delta["anxiety"]
    state["rapport"] += delta["rapport"]
    _clamp(state)

    if topic not in state["asked_topics"]:
        state["asked_topics"].append(topic)
    sec = analysis.get("secondary_topic")
    if sec and sec != "irrelevant" and sec not in state["asked_topics"]:
        state["asked_topics"].append(sec)

    unlocked = _unlock_hidden_facts(state, analysis)
    blocked = None if unlocked else _blocked_fact(state, analysis)

    for k, v in score_delta.items():
        state["score"][k] += v

    return {
        "state": state,
        "delta": delta,
        "score_delta": score_delta,
        "unlocked_facts": unlocked,
        "blocked_fact": blocked,
        "repeated_topic": repeated,
    }


def emotion_of(state: dict[str, Any], analysis: dict[str, Any], unlocked: list, blocked) -> str:
    """상태 → 캐릭터 표정 매핑 (구현계획서 10.4). 긍정/부정 발언과 상태를 함께 반영해 풍부하게."""
    a = analysis
    trust, anx = state["trust"], state["anxiety"]
    if blocked is not None:
        return "guarded"            # 민감한 걸 너무 일찍 물어봄 → 시선 회피
    if unlocked:
        return "hesitant_relieved"  # 털어놓음 → 머뭇거리다 안도
    # 부정적·심각한 내용을 공감 없이 들으면 충격/불안
    if a.get("is_alarming") and not a["empathy"]:
        return "shocked" if anx >= 55 else "anxious"
    if a["pressure"]:
        return "hurt"
    if a["is_premature_diagnosis"]:
        return "shocked"
    # 안심시키는 긍정적 말 → 안도/따뜻
    if a.get("is_reassuring"):
        return "relieved" if trust >= 50 else "calm"
    if a["empathy"]:
        return "warm" if trust >= 55 else "calm"
    if a["intent"] == "irrelevant_question" and state["irrelevant_streak"] >= 2:
        return "annoyed"
    if state.get("repeat_streak", 0) >= 2:  # 같은 질문 3회째부터 짜증
        return "annoyed"
    if trust <= 25 or anx >= 80:
        return "defensive"
    if anx >= 70:
        return "anxious"
    if trust >= 65 and anx <= 40:
        return "relieved"
    if trust >= 55 and anx <= 55:
        return "calm"
    if anx >= 55:                    # 통증/불안이 남은 급성 환자의 기본 톤
        return "anxious"
    return "neutral"
