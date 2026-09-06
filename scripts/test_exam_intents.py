#!/usr/bin/env python3
"""진찰 지시 발화 → 인텐트 분류 회귀 테스트 (LLM 없이 키워드+오버라이드+승격 경로만).

왜 필요한가: 인텐트 이름이 프론트(store.ts의 PREP_INTENTS / VOICE_EXAM_INTENTS / toolMap)의
라우팅 키다. 여기서 어긋나면 학생이 아무리 정확히 말해도 진찰이 시행되지 않는다.
특히 시진("갑상샘을 보겠습니다")이 촉진으로 새면 평가표상 **다른 술기**를 한 것이 되고,
must_precede 순서 위반 감점까지 따라온다.

사용: python3 scripts/test_exam_intents.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.intent_analyzer import (  # noqa: E402
    INTENT_TOPIC,
    _apply_overrides,
    _fallback_analyze,
    merge_keyword_signals,
)

# (발화, 기대 intent). None = "진찰 시행 지시로 분류되면 안 됨"(병력청취 질문)
CASES = [
    # ── 신규 술기 ──
    ("양손을 앞으로 뻗어보세요", "do_tremor_check"),
    ("손가락을 쫙 펴보세요", "do_tremor_check"),
    ("손이 떨리는지 볼게요", "do_tremor_check"),
    ("갑상샘을 보겠습니다", "do_thyroid_inspect"),
    ("목 앞쪽을 좀 볼게요", "do_thyroid_inspect"),
    ("갑상선 시진하겠습니다", "do_thyroid_inspect"),
    ("갑상샘을 만져보겠습니다", "do_thyroid"),
    ("목 앞쪽을 촉진할게요", "do_thyroid"),
    ("간을 촉진하겠습니다", "do_liver_palpate"),
    ("갈비뼈 아래를 눌러볼게요", "do_liver_palpate"),
    ("심장 소리를 들어보겠습니다", "do_heart_auscultate"),
    ("심음을 청진하겠습니다", "do_heart_auscultate"),
    ("폐 소리를 들어볼게요", "do_lung_auscultate"),
    ("등에서 숨소리를 들어보겠습니다", "do_lung_auscultate"),
    # ── 준비 동작 (평가표 '제대로 함' 조건) ──
    ("숨을 크게 쉬어보세요", "do_deep_breath"),
    ("침을 한번 삼켜보세요", "do_swallow"),
    ("턱을 살짝 들어주세요", "do_chin_up"),
    ("아— 하고 소리 내주세요", "do_say_ah"),
    # ── 두경부 (결막/공막은 별개 술기) ──
    ("공막이 노란지 볼게요", "do_sclera"),
    ("아래 눈꺼풀을 내려서 결막을 볼게요", "do_conjunctiva"),
    ("입을 벌려보세요", "do_oral"),
    # ── 회귀: 기존 복부 술기를 신규 규칙이 뺏으면 안 된다 ──
    ("청진하겠습니다", "do_auscultate"),
    ("타진해보겠습니다", "do_percuss"),
    ("촉진하겠습니다", "do_palpate"),
    ("CVA 압통 확인하겠습니다", "do_cva"),
    ("무릎을 세워주세요", "flex_knees"),
    ("손소독하겠습니다", "hand_hygiene"),
    # ── 회귀: 병력청취 질문을 진찰 지시가 뺏으면 안 된다 ──
    ("손이 떨리는 증상이 있으세요?", None),
    ("음식을 삼키기 어려우신가요?", None),
    # ── 회귀: '손목/발목'이 갑상샘 시진으로 둔갑하면 안 된다 ──
    ("손목을 좀 볼게요", None),
    ("발목을 볼게요", None),
]

# 눈 검사 발화의 모호 여부 — 모호할 때만 프론트가 "케이스가 가진 눈 항목"으로 돌린다
EYE_AMBIGUITY = [
    ("눈 좀 볼게요", True),
    ("공막을 볼게요", False),
    ("결막이 창백한지 볼게요", False),
    ("흰자위가 노란지 확인할게요", False),
]


def resolve(text: str) -> dict:
    r = _fallback_analyze(text)
    r = _apply_overrides(r, text)
    r["topic"] = INTENT_TOPIC.get(r["intent"], "irrelevant")
    merge_keyword_signals(r, text)
    return r


def main() -> int:
    fails = []
    for text, expect in CASES:
        got = resolve(text)["intent"]
        if expect is None:
            if got.startswith("do_"):
                fails.append(f"[오분류] {text!r} -> {got} (진찰 지시가 아니어야 함)")
        elif got != expect:
            fails.append(f"[불일치] {text!r} -> {got} (기대 {expect})")
    for text, expect in EYE_AMBIGUITY:
        got = resolve(text)["eye_target_ambiguous"]
        if got != expect:
            fails.append(f"[눈 모호판정] {text!r} -> {got} (기대 {expect})")

    total = len(CASES) + len(EYE_AMBIGUITY)
    print(f"{'❌' if fails else '✅'} 진찰 인텐트 {total - len(fails)}/{total} 통과")
    for f in fails:
        print("   -", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
