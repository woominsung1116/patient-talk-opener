"""점수 계산 + 최종 피드백 리포트 생성 (rule-based 채점, LLM은 서술 피드백만)."""
from __future__ import annotations

import re
from typing import Any

from . import llm_service, ppi_evaluator


def _dxn(s: str) -> str:
    return re.sub(r"\s+", "", s or "").lower()


async def resolve_diagnosis_ids(text: str, case: dict[str, Any]) -> list[str]:
    """자유 입력 진단명 → 후보 옵션 id로 매칭. 키워드 → Gemini → bigram 폴백."""
    text = (text or "").strip()
    opts = case["diagnosis_options"]
    if not text:
        return []
    n = _dxn(text)
    # 1) 키워드(라벨 포함) 매치
    for o in opts:
        lab = _dxn(o["label"])
        if lab and (lab in n or n in lab):
            return [o["id"]]
    # 2) Gemini 매치 (동의어/약칭/영문 허용)
    try:
        lst = "\n".join(f'- {o["id"]}: {o["label"]}' for o in opts)
        sys = (
            "너는 의학 채점 보조다. 의사가 입력한 진단명이 후보 목록 중 어느 것과 "
            "의학적으로 같은지 고른다. 동의어·약칭·영문 표기도 같은 것으로 본다. "
            "일치하는 게 없으면 none."
        )
        user = (
            f'입력한 진단: "{text}"\n\n후보:\n{lst}\n\n'
            'JSON으로만 답하라: {"id": "<일치하는 후보 id 또는 none>"}'
        )
        out = await llm_service.chat(
            sys, user, json_mode=True, temperature=0.0, max_tokens=60, prefer="gemini"
        )
        parsed = llm_service.extract_json(out) or {}
        mid = parsed.get("id")
        if mid and mid != "none" and any(o["id"] == mid for o in opts):
            return [mid]
    except Exception:
        pass
    # 3) bigram 겹침 폴백
    def bg(s: str) -> set[str]:
        return {s[i : i + 2] for i in range(len(s) - 1)}

    best, bestn = None, 0
    for o in opts:
        c = len(bg(_dxn(o["label"])) & bg(n))
        if c > bestn:
            bestn, best = c, o["id"]
    return [best] if best and bestn >= 2 else []

FEEDBACK_SYSTEM = """너는 의과대학에서 문진(병력청취) 교육을 담당하는 따뜻하지만 정확한 교수다.
학생의 문진 기록을 보고 짧은 서술 피드백을 작성하라.

규칙:
- 반드시 순수 한국어로만 쓴다. 영어, 한자 등 다른 언어를 절대 섞지 않는다.
- good_points: 잘한 점 2~3개. 구체적으로.
- missed_points: 놓친 점 2~3개. 왜 중요한지 한 문장씩.
- [절대 규칙] 놓친 점은 입력의 "놓친 항목"과 "미확인 위험 신호" 목록에 있는 것만 언급한다.
  "확인한 항목" 목록에 있는 것을 놓쳤다고 말하는 것은 심각한 오류이므로 금지한다.
  놓친 항목이 2개 미만이면 억지로 채우지 말고 있는 것만 쓴다.
- [절대 규칙] 잘한 점도 마찬가지다: "확인한 항목" 목록에 있는 것만 확인했다고 칭찬할 수 있다.
  "놓친 항목" 목록에 있는 것을 확인했다고 칭찬하는 것도 심각한 오류이므로 금지한다.
  (환자가 스스로 말한 정보라도 학생이 질문으로 확인하지 않았으면 칭찬 근거로 쓰지 않는다.)
- 미확인 위험 신호가 있으면 missed_points 첫 항목에 "위험 신호: 항목명" 형식으로
  정확한 항목명을 명시하고, 놓치면 어떤 위험이 있는지 설명한다. 괄호와 영어를 쓰지 않는다.
- 같은 질문을 반복한 기록이 보이면 환자 신뢰를 해친다는 점을 짚어준다.
- short_feedback: 격려를 담은 총평 2~3문장.
- JSON만 출력하라.

출력 형식:
{"good_points": ["..."], "missed_points": ["..."], "short_feedback": "..."}"""


def grade(total: int) -> str:
    if total >= 90:
        return "S"
    if total >= 75:
        return "A"
    if total >= 60:
        return "B"
    if total >= 40:
        return "C"
    if total >= 20:
        return "D"
    return "F"


# red flag 토픽 → 한국어 라벨 (피드백 명시용)
RED_FLAG_LABELS = {
    "melena": "흑색변(위장관 출혈)",
    "pregnancy": "임신 가능성",
    "severity": "증상의 심각도/동반 증상",
    "weight_loss": "체중 감소",
    "family_history": "가족력(돌연사 등)",
    "past_history": "과거력",
    "aggravating": "악화/유발 요인",
    "bleeding": "출혈 경향",
    "trauma": "외상력",
    "fever": "발열/오한",
    "urinary": "배뇨 증상(혈뇨/배뇨통)",
    "surgery_history": "수술력",
}

# 미해금 hidden fact를 끌어내기 위한 룰베이스 모범 질문 템플릿.
# unlock_intent(없으면 key) → 공감형/직접형 질문 예시.
# 데이터에 없는 intent도 라벨 기반으로 안전하게 생성되도록 _model_question 에서 폴백.
MODEL_QUESTIONS = {
    "ask_menstruation": (
        "생리에 대해 여쭤봐도 괜찮을까요? 양이나 주기가 평소와 달라진 게 있는지 편하게 말씀해 주세요.",
        "민감할 수 있는 주제예요. '불편하시면 안 하셔도 돼요'라고 먼저 안심시킨 뒤 월경량 변화를 물어보세요.",
    ),
    "ask_diet": (
        "요즘 식사는 어떻게 하고 계세요? 끼니를 거르거나 고기·채소를 잘 못 챙기시는 편인가요?",
        "바쁜 시기라 식사가 불규칙할 수 있어요. 판단하지 않는 말투로 하루 식사 패턴을 물어보세요.",
    ),
    "ask_severity": (
        "증상이 가장 심할 때는 어느 정도인가요? 계단을 오르거나 움직일 때 가슴이 두근거리거나 숨이 차진 않으세요?",
        "증상의 강도와 동반 증상을 구체적으로 물으면 심각도를 가늠할 수 있어요.",
    ),
    "ask_sleep": (
        "잠은 잘 주무세요? 몇 시쯤 주무시고, 자고 나도 피곤이 안 풀리는 편인가요?",
        "수면 습관은 피로의 흔한 원인이에요. 취침 시각과 수면의 질을 함께 물어보세요.",
    ),
    "ask_family_history": (
        "가족 중에 비슷한 증상으로 치료받으신 분이 계신가요? 부모님이나 형제 중에요.",
        "가족력은 학생이 가장 자주 빠뜨리는 항목이에요. 아프다고 호소하는 환자일수록 "
        "먼저 통증을 인정해 준 뒤 물어야 대답이 돌아옵니다.",
    ),
    "ask_social_history": (
        "하루를 보통 어떻게 보내세요? 일하실 때 물은 자주 드시는 편인가요?",
        "직업과 생활 습관에 위험 인자가 숨어 있는 경우가 많아요. "
        "'무엇을 안 하는지'(물을 안 마신다 같은)까지 들어야 실마리가 나옵니다.",
    ),
    "ask_medication": (
        "지금까지 드신 약이 있으세요? 오시기 전에 드신 진통제도 포함해서요.",
        "'따로 먹는 약 없다'는 대답을 그대로 받아들이면 안 돼요. "
        "처방약뿐 아니라 상비약·건강기능식품까지 짚어 물어야 합니다.",
    ),
    "ask_concern": (
        "이 증상 때문에 특별히 걱정되시는 게 있으세요? 어떤 점이 가장 마음에 걸리세요?",
        "환자가 진짜 두려워하는 것(ICE의 Concern)은 먼저 물어보지 않으면 거의 말하지 않아요. "
        "진단만큼이나 이걸 다뤄 주는 것이 CPX 관계형성 점수의 핵심입니다.",
    ),
}


def _model_question(fact: dict[str, Any]) -> dict[str, str]:
    """미해금 hidden fact 하나에 대한 모범 질문 1개를 룰베이스로 생성."""
    intent = fact.get("unlock_intent") or fact.get("key", "")
    label = fact.get("label", "")
    tmpl = MODEL_QUESTIONS.get(intent)
    if tmpl:
        question, tip = tmpl
    else:
        question = f"'{label}'에 대해 좀 더 여쭤봐도 될까요? 편하게 말씀해 주세요."
        tip = f"'{label}' 단서는 진단의 열쇠였어요. 열린 질문으로 자연스럽게 물어보세요."
    if fact.get("requires_empathy"):
        tip = "공감이 먼저예요. 환자를 안심시킨 뒤 물어야 답을 들을 수 있어요. " + tip
    return {
        "label": label,
        "question": question,
        "tip": tip,
        "sensitive": bool(fact.get("requires_empathy")) or float(fact.get("sensitivity", 0)) >= 0.6,
    }


def derive_learning_insights(
    case: dict[str, Any],
    state: dict[str, Any],
    result: dict[str, Any],
    diagnosis: list[str],
    dialogue: list[dict] | None = None,
) -> dict[str, Any]:
    """채점 결과 + 대화 로그에서 '배움'을 주는 교육 데이터를 룰베이스로 파생.

    추가 입력 없이 기존 case/state/result/dialogue 만으로 안전하게 계산한다.
    - rapport_curve: 턴별 신뢰/불안 추이 (대화 로그의 trust_after/anxiety_after)
    - trust_moments: 신뢰가 크게 오른 결정적 순간(학생의 말 포함)
    - missed_hidden_facts: 못 끌어낸 핵심 단서 + 모범 질문 예시
    - diagnosis_feedback: 진단 정오 상세 피드백
    """
    # 1) 라포 곡선 — 시작 상태에서 출발해 턴별 누적
    init = case.get("initial_state", {})
    curve: list[dict[str, Any]] = [
        {
            "turn": 0,
            "trust": init.get("trust", state["trust"]),
            "anxiety": init.get("anxiety", state["anxiety"]),
            "unlocked": False,
        }
    ]
    moments: list[dict[str, Any]] = []
    prev_trust = curve[0]["trust"]
    for t in dialogue or []:
        trust_after = t.get("trust_after", prev_trust)
        delta = trust_after - prev_trust
        unlocked = bool(t.get("unlocked_facts"))
        curve.append(
            {
                "turn": t.get("turn"),
                "trust": trust_after,
                "anxiety": t.get("anxiety_after"),
                "unlocked": unlocked,
            }
        )
        # 결정적 순간: 신뢰가 +6 이상 오른 말, 또는 단서를 끌어낸 말
        if delta >= 6 or unlocked:
            moments.append(
                {
                    "turn": t.get("turn"),
                    "user_text": t.get("user_text", ""),
                    "trust_delta": delta,
                    "unlocked": unlocked,
                    "reason": (
                        "이 질문으로 환자가 마음을 열고 숨겨둔 단서를 털어놨어요."
                        if unlocked
                        else "이 말 한마디에 환자의 신뢰가 크게 올랐어요."
                    ),
                }
            )
        prev_trust = trust_after
    # 신뢰 상승 폭이 큰 순으로 최대 3개
    moments.sort(key=lambda m: (m["unlocked"], m["trust_delta"]), reverse=True)
    moments = moments[:3]

    # 2) 못 끌어낸 hidden fact + 모범 질문
    unlocked_keys = {f["key"] for f in result["unlocked_facts"]}
    missed_facts = [
        _model_question(f)
        for f in case.get("hidden_facts", [])
        if f["key"] not in unlocked_keys
    ]

    # 3) 진단 정오 피드백
    options = {o["id"]: o for o in case["diagnosis_options"]}
    correct = result["correct_diagnosis"]
    chosen_labels = [options.get(d, {}).get("label", d) for d in diagnosis]
    if result["diagnosis_correct"]:
        if len(result["covered_questions"]) < len(case["required_questions"]) * 0.6:
            verdict = "정답을 맞혔지만 문진 근거가 부족했어요. 운에 기대지 말고 단서로 확신을 쌓아보세요."
        else:
            verdict = "충분한 문진 끝에 정답에 도달했어요. 근거에 기반한 좋은 진단이에요."
    else:
        plausible = [d for d in diagnosis if options.get(d, {}).get("plausible")]
        if plausible:
            verdict = f"감별진단으로는 합리적이었지만 정답은 아니었어요. 정답은 '{correct['label']}'이에요."
        else:
            verdict = f"진단이 빗나갔어요. 정답은 '{correct['label']}'이에요. 놓친 단서를 다시 살펴보세요."

    return {
        "rapport_curve": curve,
        "trust_moments": moments,
        "missed_hidden_facts": missed_facts,
        "diagnosis_feedback": {
            "correct": result["diagnosis_correct"],
            "chosen": chosen_labels,
            "correct_label": correct["label"],
            "verdict": verdict,
        },
    }


def compute_scores(
    case: dict[str, Any],
    state: dict[str, Any],
    diagnosis: list[str],
    tests: list[str],
    exam: dict[str, Any] | None = None,
    education: dict[str, Any] | None = None,
    dialogue: list[dict] | None = None,
) -> dict[str, Any]:
    """채점 디스패처. case에 scoring_weights가 있으면 CPX 가중치 경로, 없으면 레거시 5차원."""
    if case.get("scoring_weights"):
        return _compute_weighted(case, state, diagnosis, tests, exam, education, dialogue or [])
    return _legacy_compute_scores(case, state, diagnosis, tests)


# ── CPX 가중치 채점 (병력청취/신체진찰/환자교육/PPI) ──
def _coverage(case: dict[str, Any], state: dict[str, Any]) -> tuple[list, list]:
    required = case["required_questions"]
    asked = set(state["asked_topics"])
    unlocked_keys = {f["key"] for f in state["disclosed_facts"]}
    covered = [
        r for r in required
        if r["topic"] in asked or r["topic"] in unlocked_keys
        or (r["topic"] == "menstruation" and "menorrhagia" in unlocked_keys)
        or (r["topic"] == "diet" and "poor_diet" in unlocked_keys)
        or (r["topic"] == "past_history" and "surgery_history" in asked)
    ]
    missed = [r for r in required if r not in covered]
    return covered, missed


# 복벽 이완(무릎 세우기) 미시행 문구 — 복부 진찰 규칙과 requires_prep 규칙이 같은 문구를 공유한다.
# (간촉진처럼 requires_prep에 knee_flex를 둔 항목에서 문구가 두 번 뜨면 학생이 두 번 혼난 것처럼 읽힌다)
KNEE_FLEX_PENALTY = "복부 진찰은 환자가 무릎을 세워 복벽을 이완한 상태에서 해야 해요."

# requires_prep 미충족 피드백 — prep 종류에 맞는 문구. 없으면 항목·prep 라벨로 일반 문구를 만든다.
PREP_PENALTY = {
    "deep_breath": "폐 청진은 환자에게 크게 숨 쉬도록 안내하고 들숨·날숨을 모두 들어야 해요.",
    "knee_flex": KNEE_FLEX_PENALTY,
    "chin_up": "갑상샘은 환자가 턱을 들어 목 앞을 편 상태에서 관찰해야 해요.",
    # 삼킴 상승은 갑상샘 종물과 비갑상샘 경부 종물을 가르는 핵심 술기다 (평가표 시진③·촉진⑤).
    "swallow": "갑상샘은 침이나 물을 삼키게 하면서 봐야 해요. 삼킬 때 함께 올라가는지가 갑상샘 종물의 결정적 근거예요.",
    "say_ah": "구강검사는 '아—' 하고 소리 내게 해서 연구개가 올라간 상태로 인두까지 봐야 해요.",
    "drape": "진찰할 부위만 노출하고 나머지는 가려드려야 해요.",
    "explain_consent": "진찰 전에 목적과 방법을 설명하고 동의를 구해야 해요.",
    "hand_hygiene": "진찰 전 손위생(손소독)을 하지 않았어요.",
}


def _score_exam(case: dict[str, Any], exam: dict[str, Any] | None) -> dict[str, Any]:
    """신체진찰 점수 + 세부.

    exam = _exam_summary() 결과:
      {"performed":[ids], "order":[ids], "order_ok":bool, "order_violations":[...],
       "first_exam_index":int, "exam_progress":{action_id:[진행키...]}}
    """
    items = case.get("exam_items", [])
    actions = [it for it in items if it.get("type") == "exam_action"]
    labels = {it["id"]: it.get("label", it["id"]) for it in items}
    pe_max = sum(it.get("points", 0) for it in actions) or 1
    performed = set((exam or {}).get("performed", []))
    order = (exam or {}).get("order", [])
    got = sum(it.get("points", 0) for it in actions if it["id"] in performed)
    ratio = got / pe_max

    penalties: list[str] = []
    # 손위생 선행 위반
    hh_idx = order.index("hand_hygiene") if "hand_hygiene" in order else None
    first_exam = (exam or {}).get("first_exam_index")
    if hh_idx is None or (first_exam is not None and hh_idx >= first_exam):
        ratio *= 0.85
        penalties.append(PREP_PENALTY["hand_hygiene"])  # requires_prep 규칙과 같은 문구를 써야 중복 제거가 먹는다
    # 진찰 순서 위반 — 어떤 항목이 어떤 항목보다 먼저여야 했는지 실제 위반 내용으로 문구를 만든다.
    # (예전 고정 문구 "복부 청진은 타진·촉진보다 먼저"는 CVA만 시행해도 뜨는 오탐이었다)
    violations = (exam or {}).get("order_violations") or []
    if violations:
        ratio *= 0.9  # 배수는 위반 종류·개수와 무관하게 한 번만
        for v in violations:
            a = labels.get(v.get("item"), v.get("item"))
            b = labels.get(v.get("before"), v.get("before"))
            if v.get("kind") == "skipped":
                penalties.append(f"{b}을(를) 하기 전에 {a}을(를) 먼저 시행해야 해요. (시행하지 않았습니다)")
            else:
                penalties.append(f"{a}은(는) {b}보다 먼저 시행해야 해요.")
    # 준비 동작(requires_prep) 없이 시행한 항목 — 완료 자체는 막지 않고(게임이 멈추면 안 된다) 채점에서만 깎는다.
    # 판정 기준: 그 prep이 exam_log에 아예 없거나, 항목이 완료된 뒤에야 기록됐으면 '없는 상태로 한 것'이다
    # (청진을 다 끝내고 나서 "숨 크게 쉬세요"라고 하면 들숨·날숨을 들은 게 아니다).
    pos = {a: i for i, a in enumerate(order)}
    missing_preps: list[tuple[str, str]] = []  # (prep_id, item_id)
    for it in actions:
        if it["id"] not in performed:
            continue
        for prep in it.get("requires_prep") or []:
            if prep not in pos or pos[prep] > pos.get(it["id"], len(order)):
                missing_preps.append((prep, it["id"]))
    if missing_preps:
        ratio *= 0.9  # 배수는 위반 개수와 무관하게 한 번만 (순서 위반 규칙과 같은 방식)
        seen_prep: set[str] = set()
        for prep, item_id in missing_preps:
            if prep in seen_prep:
                continue
            seen_prep.add(prep)
            msg = PREP_PENALTY.get(prep) or (
                f"{labels.get(item_id, item_id)}은(는) {labels.get(prep, prep)}을(를) 먼저 하고 시행해야 해요."
            )
            if msg not in penalties:
                penalties.append(msg)
    # 아픈 부위는 가장 마지막에 타진·촉진 (공식 평가표) — tender_region이 설정된 항목만.
    # (요로결석 cva_tenderness의 tender_region="flank_r": 무증상 좌측을 먼저 두드려 비교한 뒤 아픈 우측)
    exam_progress = (exam or {}).get("exam_progress") or {}
    for it in actions:
        tender = it.get("tender_region")
        if not tender or it["id"] not in performed:
            continue
        seq = exam_progress.get(it["id"]) or []
        # 진행 키는 "<region>" 또는 "<pass>:<region>" — 마지막에 찍은 부위가 아픈 부위여야 한다
        if seq and seq[-1].split(":")[-1] != tender:
            ratio *= 0.95
            penalties.append(f"{it.get('label', it['id'])}은(는) 아픈 부위를 가장 마지막에 진찰해야 해요.")
    # 무릎 세우기(복벽 이완) 없이 복부진찰 — 워크시트 '제대로 함' 조건 미충족.
    # requires_prep 규칙이 이미 같은 문구를 냈으면 중복 감점·중복 문구를 만들지 않는다.
    abd = {"auscultation", "percussion", "palpation"}
    if abd & performed and "knee_flex" not in order and KNEE_FLEX_PENALTY not in penalties:
        ratio *= 0.95
        penalties.append(KNEE_FLEX_PENALTY)

    detail = [
        {"id": it["id"], "label": it["label"], "points": it.get("points", 0),
         "done": it["id"] in performed}
        for it in actions
    ]
    return {"ratio": max(0.0, min(1.0, ratio)), "got": got, "max": pe_max,
            "detail": detail, "penalties": penalties}


def _score_education(case: dict[str, Any], education: dict[str, Any] | None,
                     diagnosis_correct: bool) -> dict[str, Any]:
    """환자교육 점수 + 세부. education = {"diagnosis_evidence":[ids],"test_plan":[ids],"treatment":[ids],"complication":[ids]}.

    education_items가 없는 케이스(배점 0)에서도 크래시 없이 ratio 0.0을 돌려줘야 한다 —
    `or 1`이 0으로 나누는 것을 막고, add()가 없는 항목을 건너뛰므로 detail은 빈 목록이 된다.
    """
    items = {it["id"]: it for it in case.get("education_items", [])}
    edu = education or {}
    raw = 0
    edu_max = sum(it.get("points", 0) for it in items.values()) or 1
    detail: list[dict[str, Any]] = []

    def add(item_id: str, got: int, note: str) -> None:
        it = items.get(item_id)
        if not it:
            return
        nonlocal raw
        raw += got
        detail.append({"id": item_id, "label": it["label"], "got": got,
                       "max": it.get("points", 0), "note": note})

    # 진단 설명: 정답 진단 + 근거 개수
    dx_item = items.get("diagnosis")
    if dx_item:
        correct_ev = {o["id"] for o in dx_item.get("evidence_options", []) if o.get("correct")}
        chosen_ev = set(edu.get("diagnosis_evidence", [])) & correct_ev
        if diagnosis_correct and len(chosen_ev) >= 2:
            add("diagnosis", dx_item.get("points", 4), f"근거 {len(chosen_ev)}개로 설명 — 잘함")
        elif diagnosis_correct and len(chosen_ev) >= 1:
            add("diagnosis", max(1, dx_item.get("points", 4) // 2), "근거 1개 — 보통")
        elif diagnosis_correct:
            add("diagnosis", max(1, dx_item.get("points", 4) // 2), "진단명만 — 보통")
        else:
            add("diagnosis", 0, "진단을 설명하지 못함 — 미흡")

    test_plan = set(edu.get("test_plan", []))
    if "test_plan_lab" in items:
        add("test_plan_lab", items["test_plan_lab"].get("points", 0) if "test_plan_lab" in test_plan else 0,
            "소변·혈액 검사 설명" if "test_plan_lab" in test_plan else "설명 안 함")
    if "test_plan_image" in items:
        add("test_plan_image", items["test_plan_image"].get("points", 0) if "test_plan_image" in test_plan else 0,
            "영상검사 설명" if "test_plan_image" in test_plan else "설명 안 함")

    tx = set(edu.get("treatment", []))
    if "tx_analgesic" in items:
        add("tx_analgesic", items["tx_analgesic"].get("points", 0) if "tx_analgesic" in tx else 0,
            "진통제 우선 설명" if "tx_analgesic" in tx else "설명 안 함")
    if "tx_definitive" in items:
        n = 1 if "tx_definitive" in tx else 0  # 토글 1개 = 치료법 설명함
        add("tx_definitive", items["tx_definitive"].get("points", 0) if n else 0,
            "근본 치료 설명" if n else "설명 안 함")

    comp = set(edu.get("complication", []))
    if "complication" in items:
        add("complication", items["complication"].get("points", 0) if "complication" in comp else 0,
            "합병증·응급치료 설명" if "complication" in comp else "설명 안 함")

    return {"ratio": max(0.0, min(1.0, raw / edu_max)), "got": raw, "max": edu_max, "detail": detail}


def _compute_weighted(
    case: dict[str, Any],
    state: dict[str, Any],
    diagnosis: list[str],
    tests: list[str],
    exam: dict[str, Any] | None,
    education: dict[str, Any] | None,
    dialogue: list[dict],
) -> dict[str, Any]:
    w = case["scoring_weights"]
    required = case["required_questions"]
    covered, missed = _coverage(case, state)

    correct_id = next(o["id"] for o in case["diagnosis_options"] if o.get("correct"))
    diagnosis_correct = correct_id in diagnosis

    # 1) 병력청취
    hx = round(w["history_taking"] * len(covered) / max(1, len(required)))
    # 2) 신체진찰
    pe = _score_exam(case, exam)
    pe_score = round(w["physical_exam"] * pe["ratio"])
    # 3) 환자교육
    ed = _score_education(case, education, diagnosis_correct)
    edu_score = round(w["patient_education"] * ed["ratio"])
    # 4) PPI — 케이스에 실제로 존재하는 진찰 항목 id를 넘겨야 6-3(가려주기)처럼
    #    '기록할 방법 자체가 없는' 항목을 fail이 아니라 na로 뺄 수 있다 (§4.1)
    ppi = ppi_evaluator.score(
        w["ppi"], dialogue, exam, education,
        exam_item_ids=set((exam or {}).get("exam_item_ids") or []),
    )
    ppi_score = ppi["scaled"]

    total = hx + pe_score + edu_score + ppi_score

    red_flag_topics = set(case.get("red_flags", []))
    asked = set(state["asked_topics"])
    missed_red_flags = [RED_FLAG_LABELS.get(t, t) for t in red_flag_topics if t not in asked]

    return {
        "weighted": True,
        "missed_red_flags": missed_red_flags,
        "final_score": total,
        "grade": grade(total),
        "scores": {
            "history_taking": hx,
            "physical_exam": pe_score,
            "patient_education": edu_score,
            "ppi": ppi_score,
        },
        "max_scores": {
            "history_taking": w["history_taking"],
            "physical_exam": w["physical_exam"],
            "patient_education": w["patient_education"],
            "ppi": w["ppi"],
        },
        "covered_questions": covered,
        "missed_questions": missed,
        "unlocked_facts": [f for f in state["disclosed_facts"]],
        "correct_diagnosis": {
            "id": correct_id,
            "label": case.get("diagnosis_label", correct_id),
        },
        "diagnosis_correct": diagnosis_correct,
        # 신규 세부 (ReportScreen 강화용)
        "ppi_detail": ppi,
        "exam_detail": pe,
        "education_detail": ed,
    }


def _legacy_compute_scores(
    case: dict[str, Any],
    state: dict[str, Any],
    diagnosis: list[str],
    tests: list[str],
) -> dict[str, Any]:
    # 1) 핵심 정보 획득률 30점
    required = case["required_questions"]
    asked = set(state["asked_topics"])
    unlocked_keys = {f["key"] for f in state["disclosed_facts"]}
    covered = [
        r for r in required
        if r["topic"] in asked or r["topic"] in unlocked_keys
        or (r["topic"] == "menstruation" and "menorrhagia" in unlocked_keys)
        or (r["topic"] == "diet" and "poor_diet" in unlocked_keys)
        or (r["topic"] == "past_history" and "surgery_history" in asked)
    ]
    history_taking = round(30 * len(covered) / max(1, len(required)))

    # 2) 라포 20점 — 최종 trust/rapport 와 누적 공감 점수
    rapport_axis = (state["trust"] + state["rapport"]) / 2
    rapport_score = min(20, round(rapport_axis / 100 * 14) + min(6, state["score"]["rapport"]))

    # 3) red flag 15점
    red_flag_topics = set(case.get("red_flags", []))
    red_flag_checked = len(red_flag_topics & asked)
    red_flag_score = min(15, round(15 * red_flag_checked / max(1, len(red_flag_topics))))

    # 4) 감별진단 20점 — 정답만 찍어서는 높은 점수가 안 나오도록 문진 근거(coverage)에 연동
    options = {o["id"]: o for o in case["diagnosis_options"]}
    coverage = len(covered) / max(1, len(required))
    correct_id = next(o["id"] for o in case["diagnosis_options"] if o.get("correct"))
    if correct_id in diagnosis:
        clinical = 8  # 정답 기본점
        clinical += min(4, sum(2 for d in diagnosis if d != correct_id and options.get(d, {}).get("plausible")))
        clinical += round(8 * coverage)  # 근거 수집에 비례
    else:
        clinical = sum(3 for d in diagnosis if options.get(d, {}).get("plausible"))
        clinical += round(3 * coverage)
    clinical = max(0, min(20, clinical + state["score"]["clinical_reasoning"] // 3))

    # 5) 검사 선택 15점
    topts = {o["id"]: o for o in case["test_options"]}
    recommended = [o["id"] for o in case["test_options"] if o.get("recommended")]
    hit = sum(1 for t in tests if t in recommended)
    waste = sum(1 for t in tests if t in topts and not topts[t].get("recommended") and not topts[t].get("reasonable"))
    test_score = max(0, min(15, round(15 * hit / max(1, len(recommended))) - waste * 2))

    total = history_taking + rapport_score + red_flag_score + clinical + test_score
    missed = [r for r in required if r not in covered]
    missed_red_flags = [
        RED_FLAG_LABELS.get(t, t) for t in red_flag_topics if t not in asked
    ]
    return {
        "missed_red_flags": missed_red_flags,
        "final_score": total,
        "grade": grade(total),
        "scores": {
            "history_taking": history_taking,
            "rapport": rapport_score,
            "red_flag": red_flag_score,
            "clinical_reasoning": clinical,
            "test_selection": test_score,
        },
        "max_scores": {
            "history_taking": 30,
            "rapport": 20,
            "red_flag": 15,
            "clinical_reasoning": 20,
            "test_selection": 15,
        },
        "covered_questions": covered,
        "missed_questions": missed,
        "unlocked_facts": [f for f in state["disclosed_facts"]],
        "correct_diagnosis": {
            "id": correct_id,
            "label": case.get("diagnosis_label", correct_id),
        },
        "diagnosis_correct": correct_id in diagnosis,
    }


async def narrative_feedback(
    case: dict[str, Any],
    state: dict[str, Any],
    result: dict[str, Any],
    diagnosis: list[str],
    tests: list[str],
    dialogue: list[dict],
    section_times: dict[str, float] | None = None,
    exam: dict[str, Any] | None = None,
) -> dict[str, Any]:
    options = {o["id"]: o["label"] for o in case["diagnosis_options"]}
    topts = {o["id"]: o["label"] for o in case["test_options"]}
    transcript = "\n".join(
        f"학생: {t['user_text']}\n환자: {t['patient_text']}" for t in dialogue[-12:]
    )
    exam_note = ""
    missed_exam: list[str] = []
    performed: list[str] = []
    if exam is not None and case.get("exam_items"):
        items = {it["id"]: it["label"] for it in case["exam_items"] if it.get("type") == "exam_action"}
        performed = [items[a] for a in exam.get("performed", []) if a in items]
        missed_exam = [lbl for aid, lbl in items.items() if aid not in set(exam.get("performed", []))]
        # 순서 지적도 실제 위반 내용으로 — LLM에 "청진을 먼저" 같은 고정 문구를 먹이면 없는 잘못을 지어낸다
        _viol = exam.get("order_violations") or []
        _viol_txt = ", ".join(
            f"{items.get(v.get('before'), v.get('before'))}을(를) 하기 전에 "
            f"{items.get(v.get('item'), v.get('item'))}을(를) 하지 않음"
            if v.get("kind") == "skipped" else
            f"{items.get(v.get('item'), v.get('item'))}을(를) "
            f"{items.get(v.get('before'), v.get('before'))}보다 나중에 함"
            for v in _viol
        )
        order_txt = f"부적절 ({_viol_txt})" if _viol else "적절"
        exam_note = (
            f"\n신체진찰 — 수행: {', '.join(performed) or '없음'} / 누락: {', '.join(missed_exam) or '없음'} / 순서: {order_txt}. "
            "신체진찰 누락·순서 문제는 missed_points에 위 목록에 있는 것만 언급하라."
        )
    time_note = ""
    if section_times:
        label = {"playing": "문진", "exam": "신체진찰", "education": "환자교육"}
        parts = [f"{label.get(k, k)} {int(v // 60)}분 {int(v % 60)}초" for k, v in section_times.items()]
        total = sum(section_times.values())
        time_note = (
            f"\n섹션별 소요 시간: {', '.join(parts)} (전체 {int(total // 60)}분 {int(total % 60)}초). "
            "실제 CPX 표준은 총 10~12분(문진 위주)이다. 시간 배분에 대한 코멘트를 1문장 포함하라 — "
            "어느 섹션이 과도했는지/부족했는지, 무엇을 줄이면 좋을지."
        )
    user = f"""케이스: {case['title']} (정답: {case['diagnosis_label']}){time_note}{exam_note}
교육 포인트: {'; '.join(case['teaching_points'])}

확인한 항목: {', '.join(r['label'] for r in result['covered_questions']) or '없음'}
놓친 항목: {', '.join(r['label'] for r in result['missed_questions']) or '없음'}
미확인 위험 신호: {', '.join(result['missed_red_flags']) or '없음 (모두 확인함)'}
획득한 단서: {', '.join(f['label'] for f in result['unlocked_facts'])}
최종 신뢰도: {state['trust']}, 불안도: {state['anxiety']}
학생의 진단: {', '.join(options.get(d, d) for d in diagnosis)}
학생의 검사: {', '.join(topts.get(t, t) for t in tests)}
점수: {result['final_score']}/100

대화 기록 (최근):
{transcript}"""
    fallback = {
        "good_points": [
            f"{len(result['covered_questions'])}개의 핵심 문진 항목을 확인했습니다.",
            f"환자의 단서 {len(result['unlocked_facts'])}개를 이끌어냈습니다.",
        ],
        "missed_points": (
            [
                f"위험 신호인 '{rf}'을(를) 확인하지 않았습니다. 반드시 배제해야 할 항목입니다."
                for rf in result["missed_red_flags"][:2]
            ]
            + [f"'{r['label']}'을(를) 확인하지 않았습니다." for r in result["missed_questions"][:2]]
        ) or ["모든 필수 항목을 확인했습니다!"],
        "short_feedback": "수고했습니다. 놓친 항목을 복습하고 다시 도전해보세요.",
    }
    # LLM이 규칙을 어기고 놓친 항목을 칭찬에 끼워넣는 슬립 방지 — 놓친 항목의 고유 키워드가
    # 들어간 good_point는 결정적으로 제거한다 ('통증' 같은 범용 토큰은 제외).
    _GENERIC_TOKENS = {"통증", "증상", "여부", "확인", "관련", "병력", "기타", "환자", "질문", "정보"}
    _missed_kw: set[str] = set()
    for _lbl in (
        [r["label"] for r in result["missed_questions"]]
        + list(result["missed_red_flags"])
        + missed_exam
    ):
        for _tok in re.split(r"[^가-힣A-Za-z]+", str(_lbl)):
            if len(_tok) >= 2 and _tok not in _GENERIC_TOKENS:
                _missed_kw.add(_tok)

    # 반대 방향 슬립("물어봤는데 안 물었다") 방지 — 확인한 항목에만 있는 키워드가 들어간 missed_point 제거
    _covered_kw: set[str] = set()
    for _lbl in [r["label"] for r in result["covered_questions"]] + performed:
        for _tok in re.split(r"[^가-힣A-Za-z]+", str(_lbl)):
            if len(_tok) >= 2 and _tok not in _GENERIC_TOKENS and _tok not in _missed_kw:
                _covered_kw.add(_tok)

    def _drop_false_praise(points: list[str]) -> list[str]:
        kept = [p for p in points if not any(k in p for k in _missed_kw)]
        return kept

    def _drop_false_blame(points: list[str]) -> list[str]:
        kept = [p for p in points if not any(k in p for k in _covered_kw)]
        return kept

    def _scrub(s: str) -> str:
        # LLM이 규칙을 어기고 넣는 빈 괄호("위험 신호( )") 제거
        return re.sub(r"\s*\(\s*\)", "", s)

    def _clean(parsed: dict) -> dict | None:
        result_ = {
            "good_points": _drop_false_praise([_scrub(str(p)) for p in parsed.get("good_points", [])])[:3],
            "missed_points": _drop_false_blame([_scrub(str(p)) for p in parsed.get("missed_points", [])])[:3],
            "short_feedback": _scrub(str(parsed.get("short_feedback", ""))),
        }
        if not result_["good_points"]:
            result_["good_points"] = fallback["good_points"][:1]
        if not result_["missed_points"]:
            result_["missed_points"] = fallback["missed_points"][:2]
        if not result_["short_feedback"]:
            return None
        return result_

    def _has_foreign(fb: dict) -> bool:
        joined = " ".join([*fb["good_points"], *fb["missed_points"], fb["short_feedback"]])
        return llm_service.is_contaminated(joined)

    def _purge(items: list[str], fb_items: list[str]) -> list[str]:
        # strip_foreign이 괄호 속 영어만 지우면 "( )"가 남으므로 정화 후에도 _scrub 필수
        cleaned = [_scrub(llm_service.strip_foreign(p)) if llm_service.is_contaminated(p) else p for p in items]
        cleaned = [p for p in cleaned if len(p) >= 5]
        return cleaned or fb_items

    fb: dict | None = None
    try:
        for temp in (0.4, 0.15):  # 외국어 혼입 시 낮은 온도로 1회 재시도
            # codex(~16s)는 채점 대기가 너무 길다 → 빠른 Gemini로 피드백 생성 (실패 시 ollama)
            out = await llm_service.chat(
                FEEDBACK_SYSTEM, user, json_mode=True, temperature=temp, max_tokens=600, prefer="gemini"
            )
            parsed = llm_service.extract_json(out)
            fb = _clean(parsed) if parsed else None
            if fb is not None and not _has_foreign(fb):
                return fb
        if fb is not None:  # 두 번 모두 오염 → 필드별 정화, 빈 필드는 폴백으로 대체
            short = _scrub(llm_service.strip_foreign(fb["short_feedback"]))
            return {
                "good_points": _purge(fb["good_points"], fallback["good_points"]),
                "missed_points": _purge(fb["missed_points"], fallback["missed_points"]),
                "short_feedback": short if len(short) >= 10 else fallback["short_feedback"],
            }
    except Exception:
        pass
    return fallback
