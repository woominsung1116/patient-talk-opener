"""환자의사관계(PPI) 채점기 — `PPI_체크리스트.docx` 6영역 34항목 binary.

게임 전 단계 로그(대화 + 신체진찰 + 환자교육)에서 각 항목 충족 여부를 rule-based로 판정한다.
LLM에 판단을 맡기지 않는다 (프로젝트 원칙).

판정 신뢰가 낮은 항목은 보수적으로(확실한 신호가 있을 때만 pass) 처리한다.
현재 게임 메커닉으로 측정 불가능한 항목은 status="na"로 분모에서 제외해
학습자에게 부당한 감점/거짓 피드백을 주지 않는다.
"""
from __future__ import annotations

import re
from typing import Any

# ── 6영역 34항목 정의 (id, category, label, 미수행 피드백) — 항목당 1점, 합 34 ──
# 미수행 피드백은 `PPI_체크리스트_피드백.docx`의 '미수행 시 피드백 멘트' 열을 그대로 반영.
ITEMS: list[tuple[str, int, str, str]] = [
    # 1. 나와 좋은 유대관계를 형성하려고 했다 (7)
    ("1-1", 1, "환자확인·자기소개", "면담 시작 시 환자 성함을 확인하고 본인을 학생의사로 소개해 주세요."),
    ("1-2", 1, "편하게 시작", "본론 전에 가벼운 인사로 편안하게 면담을 시작해 주세요."),
    ("1-3", 1, "편안한 분위기 조성", "환자가 편하게 말할 수 있도록 배려하는 한마디를 건네주세요."),
    ("1-4", 1, "공감과 지지", "공감/지지 표현이 부족했습니다. ‘많이 힘드셨겠어요’ 같은 공감을 보여주세요."),
    ("1-5", 1, "무비판적 수용", "환자의 말을 판단·훈계하지 말고 있는 그대로 받아들여 주세요."),
    ("1-6", 1, "진정성·솔직함", "과장된 안심이나 허위 친절 대신 진솔하게 대해 주세요."),
    ("1-7", 1, "신뢰·자신감·존중", "면담 내내 자신감 있고 환자를 존중하는 태도를 유지해 주세요."),
    # 2. 내 이야기를 효율적으로 물어보고 잘 들어주었다 (8)
    ("2-1", 2, "면담주제 협상", "환자가 오늘 진료받고자 하는 핵심 면담 주제에 대한 협상을 해주세요."),
    ("2-2", 2, "대답 여유 (말 끊지 않음)", "환자의 말을 끊지 말고 끝까지 들은 뒤 다음으로 넘어가 주세요."),
    ("2-3", 2, "경청 자세", "환자가 말할 때 ‘네~’ 등 경청하고 있다는 것을 보여주세요."),
    ("2-4", 2, "호응", "환자의 말에 ‘맞습니다’ 같은 긍정적 호응을 표현해 주세요."),
    ("2-5", 2, "확인 (되묻기)", "환자의 말을 되짚어 구체적으로(수치 등) 확인하는 질문을 해주세요."),
    ("2-6", 2, "개방형·폐쇄형(깔때기) 질문", "개방형으로 넓게 물은 뒤 폐쇄형으로 좁혀가며 질문해 주세요."),
    ("2-7", 2, "쉬운 용어", "쉬운 용어를 사용하세요."),
    ("2-8", 2, "분리 질문 (한 번에 하나)", "한 번에 한 가지씩 질문해 주세요."),
    # 3. 나의 생각과 배경을 효과적으로 알아냈다 (5)
    ("3-1", 3, "일상생활 영향 파악", "증상이 일상생활에 주는 영향을 물어봐 주세요."),
    ("3-2", 3, "기분·정서표현 격려", "환자의 기분이나 감정도 함께 물어봐 주세요."),
    ("3-3", 3, "생각·걱정 질문", "환자가 생각하는 원인이나 걱정되는 점을 물어봐 주세요."),
    ("3-4", 3, "기대 파악", "환자가 오늘 진료에서 기대하는 바를 물어봐 주세요."),
    ("3-5", 3, "입장·배경·처지 관심", "검사·치료가 가능한 상황인지 환자의 처지에 관심을 가져주세요."),
    # 4. 내가 이해하기 쉽게 설명하였다 (6)
    ("4-1", 4, "필요한 정보 확인", "설명 전에 환자가 이미 아는 것·알고 싶은 것을 먼저 확인해 주세요."),
    ("4-2", 4, "근거 있는 설명", "환자의 증상·소견과 연결지어 근거 있게 설명해 주세요."),
    ("4-3", 4, "내 의견·선택권 고려", "환자의 의견을 묻고 선택권을 제시해 주세요."),
    ("4-4", 4, "쉬운 용어 (설명)", "쉬운 용어를 사용하세요."),
    ("4-5", 4, "기억하기 쉽게 설명", "강조·순서 제시·그림 등으로 기억하기 쉽게 설명해 주세요."),
    ("4-6", 4, "이해 점검·질문 기회", "설명 후 이해 여부를 확인하고 질문 기회를 주세요."),
    # 5. 면담을 체계적으로 이끌어나갔다 (4)
    ("5-1", 5, "논리·체계적 순서", "병력청취→신체진찰→교육 순서로 면담을 진행해 주세요."),
    ("5-2", 5, "적절한 시간 배분", "주어진 시간을 세 영역에 적절히 배분해 마무리해 주세요."),
    ("5-3", 5, "주기적 요약·방향 제시", "면담 중간중간 내용을 요약하고 다음 방향을 안내해 주세요."),
    ("5-4", 5, "내 생각 따라 질문 이어가기", "환자가 언급한 내용을 받아 다음 질문으로 자연스럽게 이어가 주세요."),
    # 6. 신체진찰 태도가 좋았다 (4)
    ("6-1", 6, "손위생", "진찰 전후에 손 위생을 시행해 주세요."),
    ("6-2", 6, "사전 설명·동의", "진찰 목적·방법과 불편감(노출·아픔 등)을 미리 설명하고 동의를 구해 주세요."),
    ("6-3", 6, "가려주기", "환자가 스스로 옷을 올리게 하고 필요한 부위만 노출해 주세요."),
    ("6-4", 6, "환자안전·불편함 배려", "진찰 강도·순서를 배려하고 불편할 수 있는 점은 미리 알려주세요."),
]

CATEGORY_LABELS = {
    1: "유대관계 형성",
    2: "효율적 청취",
    3: "생각·배경 파악",
    4: "이해하기 쉬운 설명",
    5: "체계적 면담",
    6: "신체진찰 태도",
}

# 어려운 용어/문어체 (2-7, 4-4)
_HARD_TERMS = re.compile(
    r"기저질환|의식소실|예후|이환|기왕력|주소증|호소하|병발|징후|소견상|발현|동반이환"
)


def _texts(dialogue: list[dict]) -> list[str]:
    return [str(d.get("user_text", "")) for d in dialogue]


def _has_intent(dialogue: list[dict], *intents: str) -> bool:
    s = set(intents)
    return any(d.get("intent") in s for d in dialogue)


def _any_text(dialogue: list[dict], pattern: str) -> bool:
    pat = re.compile(pattern)
    return any(pat.search(t) for t in _texts(dialogue))


def _count_text(dialogue: list[dict], pattern: str) -> int:
    pat = re.compile(pattern)
    return sum(1 for t in _texts(dialogue) if pat.search(t))


def evaluate(
    dialogue: list[dict],
    exam: dict[str, Any] | None = None,
    education: dict[str, Any] | None = None,
    exam_item_ids: set[str] | None = None,
) -> dict[str, Any]:
    """34항목 판정. exam/education이 None이면 해당 영역 항목은 na 처리.

    dialogue 항목 기대 필드: user_text, intent, empathy, tone, pressure, trust_after
    exam: {"order": ["hand_hygiene","auscultation",...], "first_exam_index": int,
           "order_ok": bool, "has_order_rules": bool}
    education: {"diagnosis_evidence": [...], "treatment": [...], "test_plan": [...], "complication": [...]}
    exam_item_ids: 케이스의 exam_items에 실제로 존재하는 항목 id 집합.
        학생이 기록할 방법 자체가 없는 항목(예: drape가 없는 두경부 케이스의 6-3)을
        영구 fail로 깎지 않고 na로 빼기 위해 쓴다.
    """
    dialogue = dialogue or []
    empathy_cnt = sum(1 for d in dialogue if d.get("empathy"))
    pressure_cnt = sum(1 for d in dialogue if d.get("pressure"))
    trusts = [d.get("trust_after") for d in dialogue if isinstance(d.get("trust_after"), (int, float))]
    avg_trust = sum(trusts) / len(trusts) if trusts else 0
    first2 = dialogue[:2]

    exam_order = (exam or {}).get("order", []) if exam else None
    edu = education or None

    # 깔때기식(개방형→폐쇄형): 개방형 신호와 폐쇄형 신호가 모두 존재
    open_q = _any_text(dialogue, r"어떤|어떻게|어디|무엇|왜|어떠|얼마나")
    closed_q = _any_text(dialogue, r"있나요|없나요|있으세요|없으세요|하나요|인가요|맞나요|드세요\?")

    # 분리질문 위반: 한 발화에 물음표 3개 이상
    multi_q_violation = any(t.count("?") + t.count("？") >= 3 for t in _texts(dialogue))

    results: dict[str, str] = {}  # id -> "pass" | "fail" | "na"

    def setr(item_id: str, ok: bool | None) -> None:
        results[item_id] = "na" if ok is None else ("pass" if ok else "fail")

    # ── 1. 유대관계 ──
    setr("1-1", _has_intent(dialogue, "self_introduce")
         or _any_text(dialogue, r"학생의사|제 이름|담당.{0,3}의사|성함이 어떻게|성함을"))
    setr("1-2", any(d.get("empathy") or d.get("intent") in ("greeting", "self_introduce") for d in first2)
         or _any_text(dialogue, r"오시는 데|오시느라|괜찮으셨|날씨|먼 길"))
    setr("1-3", _any_text(dialogue, r"불편하시면.{0,8}말씀|편하게 말씀|언제든 말씀|편하게 말씀하"))
    setr("1-4", empathy_cnt >= 2)
    setr("1-5", _any_text(dialogue, r"그럴 수 있|그러실 수 있|그러셨군|그러시군요|충분히 그럴|이해해요"))
    # 1-6 진정성: 과장/허위 약속이 없으면 pass
    setr("1-6", not _any_text(dialogue, r"제가.{0,6}해결해 드릴|걱정.{0,3}마세요.{0,8}(금방|다|곧)|반드시.{0,3}나|완치|틀림없이 나"))
    # 1-7 신뢰·존중: 평균 신뢰가 양호하고 다그침이 거의 없음
    setr("1-7", avg_trust >= 50 and pressure_cnt <= 1 if dialogue else None)

    # ── 2. 효율적 청취 ──
    setr("2-1", _any_text(dialogue, r"또.{0,5}(불편|증상|아픈)|다른.{0,5}(증상|불편)|그 ?중|오늘.{0,8}(가장|제일).{0,8}(불편|해결|진료|아픈)"))
    setr("2-2", True)  # 턴제 대화 — 환자 말을 끊을 수 없음
    setr("2-3", _any_text(dialogue, r"네,? ?네|그러셨|그렇군|그러시군|그러셨어요"))
    setr("2-4", _any_text(dialogue, r"잘 하셨|맞습니다|잘하고 계|좋은 질문|그러셨겠|수고하셨"))
    setr("2-5", _any_text(dialogue, r"몇 ?(리터|번|시간|일|개|잔)|얼마나 (자주|많이|오래)|다시 한 ?번|말씀하신.{0,6}(게|것)"))
    setr("2-6", open_q and closed_q)
    setr("2-7", not _any_text(dialogue, _HARD_TERMS.pattern))
    setr("2-8", not multi_q_violation)

    # ── 3. 생각·배경 ──
    setr("3-1", _has_intent(dialogue, "ask_daily_impact")
         or _any_text(dialogue, r"생활.{0,6}(불편|지장)|일상생활|일하는 데|생활하시는"))
    setr("3-2", _has_intent(dialogue, "ask_mood")
         or _any_text(dialogue, r"기분은|마음은 어떠|우울하"))
    setr("3-3", _has_intent(dialogue, "ask_concern")
         or _any_text(dialogue, r"걱정되는|무슨 병|원인이 뭐|뭐라고 생각|큰 병"))
    setr("3-4", _has_intent(dialogue, "ask_expectation")
         or _any_text(dialogue, r"좋아졌으면|바라는|원하시는|어떻게 해드리|기대하"))
    setr("3-5", _has_intent(dialogue, "ask_background")
         or _any_text(dialogue, r"입원 가능|치료.{0,3}가능|검사.{0,3}가능|시간 되|오실 수 있|직장"))

    # ── 4. 이해하기 쉬운 설명 (교육 단계 + 대화) ──
    edu_done = edu is not None
    if not edu_done:
        for i in ("4-1", "4-2", "4-3", "4-4", "4-5", "4-6"):
            setr(i, None)
    else:
        setr("4-1", _any_text(dialogue, r"알고 (계신|싶으신|있으신)|이미 (아시|들으신)|어디까지 알"))
        setr("4-2", bool(edu.get("diagnosis_evidence"))
             or _any_text(dialogue, r"소견|근거|일치하는|때문에.{0,6}(생각|의심)"))
        setr("4-3", bool(edu.get("treatment"))
             or _any_text(dialogue, r"어떠세요|선택|원하시는 방법"))
        setr("4-4", not _any_text(dialogue, _HARD_TERMS.pattern))
        setr("4-5", _any_text(dialogue, r"우선.{0,10}(그 ?다음|그 ?후|이후)|가장 (중요|먼저)|첫째|순서대로|정리하면"))
        setr("4-6", _any_text(dialogue, r"이해.{0,5}(되셨|안 되|어려운|가시)|질문.{0,3}있으|궁금한 (점|것|게)"))

    # ── 5. 체계적 면담 ──
    progressed = bool(exam_order) and edu_done
    setr("5-1", progressed if (exam is not None or edu is not None) else None)
    setr("5-2", (len(dialogue) >= 6 and bool(exam_order) and edu_done)
         if (exam is not None or edu is not None) else None)
    setr("5-3", (_has_intent(dialogue, "summarize")
                 or _count_text(dialogue, r"그러니까|정리하면|정리해|지금까지 말씀|말씀을 정리") >= 2))
    setr("5-4", _any_text(dialogue, r"아까.{0,8}(말씀|얘기)|방금.{0,8}(말씀|얘기)|걱정.{0,8}(하셨|되셨).{0,12}(여쭤|물어|확인)"))

    # ── 6. 신체진찰 태도 (exam 로그) ──
    if exam_order is not None:
        first_exam = (exam or {}).get("first_exam_index")
        hh_idx = exam_order.index("hand_hygiene") if "hand_hygiene" in exam_order else None
        # 손위생을 첫 진찰행위 이전에 했는가
        hh_ok = hh_idx is not None and (first_exam is None or hh_idx < first_exam)
        setr("6-1", hh_ok)
        # 6-2: "누우실까요" 한 마디로 기록되는 explain_consent만으로는 부족하다.
        # 평가표가 요구하는 목적·방법·불편감 설명과 동의 신호가 실제 발화에 있어야 pass.
        consent_ok = (
            "explain_consent" in exam_order
            and _any_text(
                dialogue,
                r"괜찮(으시)?겠|괜찮으세요|동의|해도 될까|봐도 될까|하겠습니다.{0,10}(괜찮|되)|"
                r"불편하시면|아프실 수|조금 아플",
            )
        )
        setr("6-2", consent_ok)
        # 6-3/6-4: 케이스에 해당 항목·규칙이 없으면 학생이 시행할 방법이 없다 → 부당 감점 대신 na
        setr("6-3", ("drape" in exam_order) if (exam_item_ids and "drape" in exam_item_ids) else None)
        setr(
            "6-4",
            bool((exam or {}).get("order_ok", False))
            if (exam or {}).get("has_order_rules")
            else None,
        )
    else:
        for i in ("6-1", "6-2", "6-3", "6-4"):
            setr(i, None)

    # ── 집계 ──
    cats: dict[int, dict[str, Any]] = {}
    items_out: list[dict[str, Any]] = []
    for item_id, cat, label, fb in ITEMS:
        status = results.get(item_id, "na")
        items_out.append({
            "id": item_id, "category": cat, "label": label, "status": status,
            # 미수행(fail)일 때만 피드백 멘트 노출 (na/pass는 빈 문자열)
            "feedback": fb if status == "fail" else "",
        })
        c = cats.setdefault(cat, {"category": cat, "label": CATEGORY_LABELS[cat], "got": 0, "measurable": 0, "total": 0})
        c["total"] += 1
        if status != "na":
            c["measurable"] += 1
            if status == "pass":
                c["got"] += 1

    raw = sum(1 for it in items_out if it["status"] == "pass")
    measurable = sum(1 for it in items_out if it["status"] != "na")
    ratio = (raw / measurable) if measurable else 0.0
    return {
        "items": items_out,
        "categories": [cats[k] for k in sorted(cats)],
        "raw": raw,
        "measurable": measurable,
        "total_items": len(ITEMS),
        "ratio": ratio,
    }


def score(weight: int, *args, **kwargs) -> dict[str, Any]:
    """evaluate 결과 + weight 환산 점수(scaled)를 함께 반환."""
    res = evaluate(*args, **kwargs)
    res["weight"] = weight
    res["scaled"] = round(weight * res["ratio"])
    return res
