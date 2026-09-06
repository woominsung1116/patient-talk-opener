#!/usr/bin/env python3
"""케이스 JSON 스키마/일관성 검증기.

사용: python3 validate_case.py <case.json> [...]
게임 엔진(patient_state.py, scoring.py)이 기대하는 구조와 정확히 일치하는지 검사한다.
"""
import json
import sys
from pathlib import Path

REQUIRED_TOP = [
    "case_id", "title", "subtitle", "difficulty", "patient_profile", "chief_complaint",
    "initial_state", "diagnosis", "diagnosis_label", "initial_facts", "hidden_facts",
    "negative_findings", "required_questions", "red_flags", "diagnosis_options",
    "test_options", "teaching_points", "max_turns",
]
REQUIRED_PROFILE = ["name", "age", "gender", "occupation", "personality", "personality_desc", "speaking_style"]
VALID_INTENTS = {
    "ask_chief_complaint", "ask_onset", "ask_duration", "ask_severity", "ask_aggravating_factor",
    "ask_relieving_factor", "ask_diet", "ask_sleep", "ask_menstruation", "ask_bleeding", "ask_melena",
    "ask_pregnancy", "ask_medication", "ask_past_history", "ask_family_history", "ask_social_history",
    "ask_weight",
    # 급성 통증 병력청취 확장 (intent_analyzer.INTENTS와 동기화)
    "ask_location", "ask_quality", "ask_pain_change", "ask_fever", "ask_urinary",
    "ask_trauma", "ask_prior_episode", "ask_surgery", "ask_nausea_vomiting",
}
# 진찰 부위 id (스펙 §1.1 + 두경부/흉부 스펙 §3·§2). store.ts의 ExamRegion과 동기화해야 한다.
ABDOMEN_REGIONS = {"ruq", "luq", "rlq", "llq"}
FLANK_REGIONS = {"flank_r", "flank_l"}
EYE_REGIONS = {"eye_r", "eye_l"}
THYROID_REGIONS = {"thyroid_r", "thyroid_l"}
ORAL_REGIONS = {"oral_tongue", "oral_pharynx"}
HEART_REGIONS = {"aortic", "pulmonic", "tricuspid", "mitral"}
LUNG_REGIONS = {
    f"lung_{plane}_{side}_{level}"
    for plane in ("ant", "post")
    for side in ("r", "l")
    for level in ("up", "mid", "low")
}
VALID_REGIONS = (
    ABDOMEN_REGIONS | FLANK_REGIONS | EYE_REGIONS | THYROID_REGIONS
    | ORAL_REGIONS | HEART_REGIONS | LUNG_REGIONS
)
# 도구(=exam_action id) ↔ 허용 부위 (스펙 §1.2 TOOL_REGIONS).
# 여기에 없는 exam_action은 부위 클릭 방식이 아닌 음성 지시형이라 검사하지 않는다.
TOOL_REGIONS = {
    "auscultation": ABDOMEN_REGIONS,
    "percussion": ABDOMEN_REGIONS,
    "palpation": ABDOMEN_REGIONS,
    "cva_tenderness": FLANK_REGIONS,
    "liver_palpation": ABDOMEN_REGIONS,
    "conjunctiva": EYE_REGIONS,
    "sclera_exam": EYE_REGIONS,
    "thyroid_palpation": THYROID_REGIONS,
    "oral_exam": ORAL_REGIONS,
    "heart_auscultation": HEART_REGIONS,
    "lung_auscultation": LUNG_REGIONS,
    "chest_percussion": LUNG_REGIONS,
}
# 부위 클릭이 없는 시진 술기 — required_regions: [] 를 명시적으로 허용한다.
# (필드가 없는 것과 동작은 같지만 "의도적으로 부위가 없다"는 것을 데이터에 남기기 위함)
REGIONLESS_ACTIONS = {"tremor_exam", "thyroid_inspect"}
# 확정된 exam_action / prep id. 오타("thyroid_inspection")는 프론트 도구 맵·인텐트 어디에도 걸리지 않아
# 학생이 영원히 시행할 수 없는 항목이 된다 → 하드 에러로 잡는다.
VALID_ACTION_IDS = set(TOOL_REGIONS) | REGIONLESS_ACTIONS
# 브라우저에서 실제로 시행할 수 있는 항목 — store.ts의 두 라우팅 표와 1:1로 동기화해야 한다.
#   · TOOL_REGIONS(store.ts)      : 발화로 도구를 고른 뒤 3D 부위 메시를 눌러 시행
#   · VOICE_EXAM_INTENTS(store.ts): 발화 한 번으로 시행 (부위 메시가 아직 없는 술기)
# 여기에 없는 exam_action은 API로는 채점되지만 학생이 화면에서 시행할 방법이 없다
# (2026-07-25 검증 실패 #1 — '진찰 30/30'이 API 한정 결과였던 원인).
FRONTEND_TOOL_ACTIONS = {"auscultation", "percussion", "palpation", "cva_tenderness"}
FRONTEND_VOICE_ACTIONS = {
    "conjunctiva", "sclera_exam", "oral_exam", "thyroid_inspect", "thyroid_palpation",
    "tremor_exam", "liver_palpation", "heart_auscultation", "lung_auscultation",
}
FRONTEND_REACHABLE_ACTIONS = FRONTEND_TOOL_ACTIONS | FRONTEND_VOICE_ACTIONS
# 발화 인텐트로 기록되는 prep (store.ts의 PREP_INTENTS + flex_knees/drape/explain_consent/hand_hygiene)
FRONTEND_REACHABLE_PREPS = {
    "hand_hygiene", "explain_consent", "drape", "knee_flex",
    "deep_breath", "chin_up", "swallow", "say_ah",
}
VALID_PREP_IDS = {"hand_hygiene", "explain_consent", "drape", "knee_flex", "deep_breath", "chin_up",
                  # 평가표 갑상샘시진③·촉진⑤ "침 또는 물을 삼키도록 하면서" / 구강검사④ "아-" 발성.
                  # prep으로 두어야 학생이 지시하지 않은 동작의 소견이 사실로 기록되지 않는다.
                  "swallow", "say_ah"}
# 몸통을 노출해야 하는 술기 — 이 항목이 있으면 케이스에 'drape' prep이 있어야 한다.
# 없으면 ppi_evaluator가 6-3(가려주기)을 na로 빼서, 정작 가려주기가 가장 중요한 케이스에서 평가되지 않는다.
EXPOSURE_ACTIONS = {"heart_auscultation", "lung_auscultation", "chest_percussion",
                    "auscultation", "percussion", "palpation", "liver_palpation"}

# region_findings[*].sound — public/sounds/exam/{heart,lung}/*.mp3 파일명과 1:1.
# 문자열 매칭 대신 이 필드로 음원을 고르므로 오타는 조용히 normal 로 폴백된다 → 하드 에러.
# 실제 파일 목록을 읽어 검사하고(저장소 안에 있으므로 항상 읽힌다), 못 읽으면 아래 기본 집합으로 폴백한다.
_SOUND_ROOT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "sounds" / "exam"
HEART_SOUNDS = {"normal", "systolic_murmur", "diastolic_murmur", "s3_gallop",
                "s4_gallop", "atrial_fibrillation", "tachycardia", "av_block"}
LUNG_SOUNDS = {"normal", "fine_crackles", "coarse_crackles", "wheezing", "rhonchi", "pleural_rub"}
BOWEL_SOUNDS = {"normal", "hyperactive", "hypoactive"}


def _sounds_on_disk(kind: str, fallback: set[str]) -> set[str]:
    d = _SOUND_ROOT / kind
    try:
        found = {p.stem for p in d.glob("*.mp3")}
    except Exception:
        found = set()
    return found or fallback


HEART_SOUNDS = _sounds_on_disk("heart", HEART_SOUNDS)
LUNG_SOUNDS = _sounds_on_disk("lung", LUNG_SOUNDS)
BOWEL_SOUNDS = _sounds_on_disk("bowel", BOWEL_SOUNDS)
ACTION_SOUNDS = {
    "heart_auscultation": HEART_SOUNDS,
    "lung_auscultation": LUNG_SOUNDS,
    "auscultation": BOWEL_SOUNDS,  # 복부 청진은 장음 — sound가 있으면 bowel/ 파일명이어야 한다
}
# sound 를 반드시 지정해야 하는 항목 (없으면 조용히 normal 로 재생돼 이상 소견이 사라진다).
# 복부 청진은 기존 케이스가 sound 없이 동작 중이므로 필수에서 뺀다(하위호환).
SOUND_REQUIRED_ACTIONS = {"heart_auscultation", "lung_auscultation"}
# scoring._score_education 이 id 를 하드코딩해서 인식하는 항목.
# 여기 없는 id 를 쓰면 edu_max 에는 더해지지만 절대 득점되지 않아 만점이 불가능해진다.
SCORABLE_EDU_IDS = {"diagnosis", "test_plan_lab", "test_plan_image",
                    "tx_analgesic", "tx_definitive", "complication"}
VALID_PASSES = ["light", "deep"]  # 반드시 얕게→깊게 순서
SCORING_KEYS = ("history_taking", "physical_exam", "patient_education", "ppi")

# intent_analyzer.INTENT_TOPIC 와 일치해야 하는 topic 값
VALID_TOPICS = {
    "chief_complaint", "onset_duration", "severity", "aggravating", "relieving", "diet", "sleep",
    "menstruation", "bleeding", "melena", "pregnancy", "medication", "past_history", "family_history",
    "social_history", "weight_loss",
    # 급성 통증 병력청취 확장 (intent_analyzer.INTENT_TOPIC와 동기화)
    "location", "quality", "pain_change", "fever", "urinary", "trauma", "prior_episode",
    "surgery_history", "nausea_vomiting",
}


def _validate_exam(c: dict) -> list[str]:
    """신체진찰/채점 배점 검증 (스펙 §2, §3).

    exam_items는 선택 필드라 없는 케이스(11개)는 이 함수가 아무것도 검사하지 않는다.
    있는 케이스에서만 신규 필드(required_regions/passes/region_findings/must_precede)의
    정합성을 본다 — 오타 하나가 '영원히 완료되지 않는 진찰 항목'이 되기 때문이다.
    """
    errs: list[str] = []
    items = c.get("exam_items") or []
    weights = c.get("scoring_weights")

    # 배점: exam_items가 있는데 scoring_weights가 없으면 레거시 채점으로 빠져
    # 신체진찰이 0점 반영된다 (§3.1이 고친 실제 버그). 재발 방지용 하드 에러.
    if items and not weights:
        errs.append("exam_items가 있는데 scoring_weights가 없음 — 신체진찰이 채점에 반영되지 않음")
    if weights:
        for k in SCORING_KEYS:
            if not isinstance(weights.get(k), int):
                errs.append(f"scoring_weights.{k}는 정수여야 함")
        if all(isinstance(weights.get(k), int) for k in SCORING_KEYS):
            total = sum(weights[k] for k in SCORING_KEYS)
            # _compute_weighted가 네 영역 점수를 그대로 더해 총점을 만들므로 합이 100이어야 한다.
            if total != 100:
                errs.append(f"scoring_weights 합이 100이 아님 (현재 {total})")

    if not items:
        return errs

    ids = [it.get("id") for it in items]
    if len(ids) != len(set(ids)):
        errs.append("exam_items id 중복")
    action_ids = {it["id"] for it in items if it.get("type") == "exam_action"}
    prep_ids = {it["id"] for it in items if it.get("type") == "prep"}

    for it in items:
        iid = it.get("id", "?")
        for f in ("id", "label", "type", "points"):
            if f not in it:
                errs.append(f"exam_items[{iid}].{f} 누락")
        if it.get("type") not in ("prep", "exam_action"):
            errs.append(f"exam_items[{iid}].type은 prep/exam_action 이어야 함")
        # id 오타는 프론트 도구 맵/인텐트/채점 어디에도 걸리지 않아 '시행할 수 없는 항목'이 된다.
        if it.get("type") == "exam_action" and iid not in VALID_ACTION_IDS:
            errs.append(f"exam_items[{iid}]는 확정된 exam_action id가 아님 (가능: {', '.join(sorted(VALID_ACTION_IDS))})")
        if it.get("type") == "prep" and iid not in VALID_PREP_IDS:
            errs.append(f"exam_items[{iid}]는 확정된 prep id가 아님 (가능: {', '.join(sorted(VALID_PREP_IDS))})")
        # 채점은 되지만 학생이 브라우저에서 시행할 수 없는 항목 — 배점만 있고 얻을 수 없는 점수가 된다.
        if it.get("type") == "exam_action" and iid in VALID_ACTION_IDS \
                and iid not in FRONTEND_REACHABLE_ACTIONS:
            errs.append(
                f"exam_items[{iid}]는 브라우저에서 시행할 경로가 없음 — "
                f"store.ts의 TOOL_REGIONS 또는 VOICE_EXAM_INTENTS에 먼저 등록하라"
            )
        if it.get("type") == "prep" and iid in VALID_PREP_IDS \
                and iid not in FRONTEND_REACHABLE_PREPS:
            errs.append(f"exam_items[{iid}](prep)를 지시할 발화 인텐트가 프론트에 없음")

        # must_precede 대상이 실제로 존재해야 순서 검증(§2.2)이 의미를 가진다.
        for target in it.get("must_precede") or []:
            if target not in action_ids:
                errs.append(f"exam_items[{iid}].must_precede 대상 '{target}'이 exam_action에 없음")
            if target == iid:
                errs.append(f"exam_items[{iid}].must_precede가 자기 자신을 가리킴")

        # requires_prep 대상이 prep 항목으로 존재해야 학생이 기록할 방법이 있다.
        # (없으면 서버가 404를 내므로 영원히 충족 못 하는 감점 조건이 된다)
        if it.get("requires_prep") is not None and it.get("type") != "exam_action":
            errs.append(f"exam_items[{iid}].requires_prep는 exam_action에만 쓸 수 있음 (채점이 exam_action만 본다)")
        for target in it.get("requires_prep") or []:
            if target not in prep_ids:
                errs.append(f"exam_items[{iid}].requires_prep 대상 '{target}'이 prep 항목에 없음")

        regions = it.get("required_regions")
        passes = it.get("passes")
        rf = it.get("region_findings") or {}

        if regions is not None:
            if not isinstance(regions, list):
                errs.append(f"exam_items[{iid}].required_regions는 배열이어야 함")
                regions = []
            elif not regions and iid not in REGIONLESS_ACTIONS:
                errs.append(f"exam_items[{iid}].required_regions는 비어있지 않은 배열이어야 함")
            elif regions and iid in REGIONLESS_ACTIONS:
                errs.append(f"exam_items[{iid}]는 부위 클릭이 없는 시진 술기 — required_regions는 [] 여야 함")
            for r in regions:
                if r not in VALID_REGIONS:
                    errs.append(f"exam_items[{iid}].required_regions 무효한 부위: {r}")
            allowed = TOOL_REGIONS.get(iid)
            # 복부 도구에 옆구리를 넣으면 프론트에서 영원히 클릭할 수 없는 부위가 된다.
            if allowed is not None:
                for r in regions:
                    if r in VALID_REGIONS and r not in allowed:
                        errs.append(f"exam_items[{iid}]는 {sorted(allowed)}만 허용 — '{r}' 불가")
        elif passes or rf:
            errs.append(f"exam_items[{iid}]: required_regions 없이 passes/region_findings만 있으면 매칭되지 않음")

        if passes is not None and passes != VALID_PASSES:
            errs.append(f"exam_items[{iid}].passes는 {VALID_PASSES} 여야 함 (얕게 먼저)")

        # region_findings 키 형식 검사: 키가 틀리면 조용히 최상위 finding으로 폴백돼
        # 좌우 소견 분리가 통째로 죽는다 (CVA 좌/우 오진 버그의 원인).
        if rf:
            valid_keys = (
                {f"{p}:{r}" for p in (passes or []) for r in (regions or [])}
                if passes
                else set(regions or [])
            )
            for key, body in rf.items():
                if key not in valid_keys:
                    errs.append(f"exam_items[{iid}].region_findings 키 '{key}'가 required_regions/passes와 불일치")
                if not isinstance(body, dict):
                    errs.append(f"exam_items[{iid}].region_findings['{key}']는 객체여야 함")
                    continue
                if "finding" in body and not isinstance(body["finding"], str):
                    errs.append(f"exam_items[{iid}].region_findings['{key}'].finding은 문자열이어야 함")
                # 심음·폐음 음원 지정 (흉부 스펙 §6) — 오타는 조용히 normal 로 폴백된다
                allowed_sounds = ACTION_SOUNDS.get(iid)
                if "sound" in body:
                    if allowed_sounds is None:
                        errs.append(f"⚠ exam_items[{iid}].region_findings['{key}'].sound는 청진 항목에서만 쓰인다")
                    elif body["sound"] not in allowed_sounds:
                        errs.append(
                            f"exam_items[{iid}].region_findings['{key}'].sound 무효: {body['sound']} "
                            f"— 실제 음원 파일이 없다 (가능: {', '.join(sorted(allowed_sounds))})"
                        )
                elif iid in SOUND_REQUIRED_ACTIONS:
                    errs.append(f"⚠ exam_items[{iid}].region_findings['{key}']에 sound 없음 — normal 로 재생됨")
                react = body.get("reaction")
                if react is not None:
                    for f in ("emotion", "line", "intensity"):
                        if f not in react:
                            errs.append(f"exam_items[{iid}].region_findings['{key}'].reaction.{f} 누락")
            for key in sorted(valid_keys - set(rf)):
                errs.append(f"⚠ exam_items[{iid}].region_findings에 '{key}' 없음 — 최상위 finding으로 폴백됨")

        # tender_region: "아픈 부위는 가장 마지막에" 감점(scoring._score_exam)이 걸리는 부위.
        # required_regions 밖의 값을 넣으면 학생이 무엇을 해도 항상 감점되는 함정이 된다.
        tender = it.get("tender_region")
        if tender is not None:
            if not regions:
                errs.append(f"exam_items[{iid}].tender_region은 required_regions가 있는 항목에만 쓸 수 있음")
            elif tender not in regions:
                errs.append(f"exam_items[{iid}].tender_region '{tender}'이 required_regions에 없음")
            elif len(regions) < 2:
                errs.append(f"⚠ exam_items[{iid}].tender_region: 부위가 하나뿐이라 '마지막에 진찰' 감점이 절대 발동하지 않음")

    # ── 케이스 단위 검사 ──
    if action_ids and "hand_hygiene" not in prep_ids:
        # scoring._score_exam이 손위생 미시행에 ratio *= 0.85를 항상 물린다.
        # prep 항목이 없으면 학생이 기록할 방법 자체가 없어 만점이 불가능해진다.
        errs.append("exam_action이 있는데 prep 'hand_hygiene'이 없음 — 손위생 감점(0.85)을 피할 방법이 없음")
    # 일반 진찰 원칙: 보고 나서 만진다. 둘 다 있으면 시진이 촉진보다 먼저여야 한다.
    if {"thyroid_inspect", "thyroid_palpation"} <= action_ids:
        insp = next(it for it in items if it.get("id") == "thyroid_inspect")
        if "thyroid_palpation" not in (insp.get("must_precede") or []):
            errs.append("exam_items[thyroid_inspect].must_precede에 'thyroid_palpation'이 없음 — 시진이 촉진보다 먼저다")

    # 평가표가 "제대로 함"의 조건으로 명시한 환자 동작 지시는 requires_prep으로 표현해야 채점에 걸린다.
    # (없으면 학생이 지시하지 않은 동작의 소견을 케이스가 사실로 기록해 버린다 — 거짓 로그)
    by_id = {it.get("id"): it for it in items}
    for action, need, why in (
        ("thyroid_inspect", ("chin_up", "swallow"), "평가표 갑상샘시진 ②턱 들기 ③삼키게 하며 관찰"),
        ("thyroid_palpation", ("swallow",), "평가표 갑상샘촉진 ⑤삼키게 하면서 촉진"),
        ("oral_exam", ("say_ah",), "평가표 구강검사 ④'아-' 발성"),
    ):
        if action not in action_ids:
            continue
        have = set(by_id[action].get("requires_prep") or [])
        for prep in need:
            if prep not in have:
                errs.append(f"exam_items[{action}].requires_prep에 '{prep}'이 없음 — {why}")

    # 몸통 노출 술기가 있는데 가려주기 prep이 없으면 PPI 6-3이 na로 빠진다 (평가받아야 할 케이스에서 평가 안 됨)
    if EXPOSURE_ACTIONS & action_ids and "drape" not in prep_ids:
        errs.append("몸통을 노출하는 술기가 있는데 prep 'drape'가 없음 — PPI 6-3(가려주기)이 na로 빠져 평가되지 않음")

    return errs


def _validate_education(c: dict) -> list[str]:
    """환자교육 항목 검증 (MVP 스코프 §3.1).

    scoring._score_education 이 항목 id 를 하드코딩해서 인식하므로,
    다른 id 를 쓰면 배점(edu_max)에는 더해지지만 절대 득점되지 않는다 = 만점 불가.
    """
    errs: list[str] = []
    edu = c.get("education_items") or []
    weights = c.get("scoring_weights") or {}
    edu_weight = weights.get("patient_education")

    if not edu:
        if isinstance(edu_weight, int) and edu_weight > 0:
            errs.append(f"patient_education 배점이 {edu_weight}인데 education_items가 없음 — 항상 0점")
        return errs
    if isinstance(edu_weight, int) and edu_weight == 0:
        errs.append("⚠ education_items가 있는데 patient_education 배점이 0 — 채점에 반영되지 않음")

    ids = [it.get("id") for it in edu]
    if len(ids) != len(set(ids)):
        errs.append("education_items id 중복")
    for it in edu:
        eid = it.get("id", "?")
        for f in ("id", "label", "kind", "points"):
            if f not in it:
                errs.append(f"education_items[{eid}].{f} 누락")
        if it.get("kind") not in ("diagnosis_explanation", "test_plan", "treatment", "complication"):
            errs.append(f"education_items[{eid}].kind 무효: {it.get('kind')} (EducationPanel이 렌더하지 못함)")
        if eid not in SCORABLE_EDU_IDS:
            errs.append(f"⚠ education_items[{eid}]는 scoring._score_education이 인식하지 못하는 id "
                        f"— 배점에는 더해지지만 득점 불가")
        if eid == "diagnosis":
            opts = it.get("evidence_options") or []
            if not any(o.get("correct") for o in opts):
                errs.append("education_items[diagnosis].evidence_options에 correct=true가 없음 — 진단 설명 만점 불가")
            oids = [o.get("id") for o in opts]
            if len(oids) != len(set(oids)):
                errs.append("education_items[diagnosis].evidence_options id 중복")
            for o in opts:
                for f in ("id", "label", "correct"):
                    if f not in o:
                        errs.append(f"education_items[diagnosis].evidence_options[{o.get('id','?')}].{f} 누락")
    return errs


def validate(path: Path) -> list[str]:
    errs: list[str] = []
    try:
        c = json.loads(path.read_text())
    except Exception as e:
        return [f"JSON 파싱 실패: {e}"]

    for f in REQUIRED_TOP:
        if f not in c:
            errs.append(f"최상위 필수 필드 누락: {f}")
    if errs:
        return errs

    if c["patient_profile"].get("gender") not in ("male", "female"):
        errs.append("gender는 male/female 여야 함")
    for f in REQUIRED_PROFILE:
        if f not in c["patient_profile"]:
            errs.append(f"patient_profile.{f} 누락")

    for k in ("trust", "anxiety", "rapport"):
        v = c["initial_state"].get(k)
        if not isinstance(v, (int, float)) or not 0 <= v <= 100:
            errs.append(f"initial_state.{k}는 0~100")

    # hidden_facts: 해금 조건 일관성
    for hf in c["hidden_facts"]:
        for f in ("key", "label", "value", "sensitivity", "unlock_intent", "required_trust",
                  "requires_empathy", "refusal_line"):
            if f not in hf:
                errs.append(f"hidden_facts[{hf.get('key','?')}].{f} 누락")
        if hf.get("unlock_intent") not in VALID_INTENTS:
            errs.append(f"hidden_facts[{hf.get('key')}] unlock_intent 무효: {hf.get('unlock_intent')}")
        rt = hf.get("required_trust", 0)
        init_trust = c["initial_state"].get("trust", 0)
        if rt > 90:
            errs.append(f"hidden_facts[{hf.get('key')}] required_trust {rt} 너무 높음(해금 불가 위험)")
        # 공감 필수인데 초기 신뢰가 이미 충분하면 긴장감 없음 — 경고성
        if rt <= init_trust and hf.get("requires_empathy") is False:
            errs.append(f"⚠ hidden_facts[{hf.get('key')}] 초기부터 해금 가능(required_trust<=초기trust, 공감불요)")

    # required_questions / red_flags 의 topic 이 유효한가 (해금·채점 매칭)
    rq_topics = {r["topic"] for r in c["required_questions"]}
    for r in c["required_questions"]:
        if r["topic"] not in VALID_TOPICS:
            errs.append(f"required_questions topic 무효(채점 매칭 안됨): {r['topic']}")
    for rf in c["red_flags"]:
        if rf not in VALID_TOPICS:
            errs.append(f"red_flags 항목이 topic이 아님(채점 매칭 안됨): {rf}")

    # negative_findings 키도 topic 이어야 patient_responder가 매칭
    for topic in c["negative_findings"]:
        if topic not in VALID_TOPICS:
            errs.append(f"⚠ negative_findings 키 '{topic}'는 topic이 아님 — 응답 매칭 안될 수 있음")

    # 정답 진단 정확히 1개
    correct = [o for o in c["diagnosis_options"] if o.get("correct")]
    if len(correct) != 1:
        errs.append(f"correct=true 진단이 정확히 1개여야 함 (현재 {len(correct)}개)")
    if c.get("diagnosis") != (correct[0]["id"] if correct else None):
        errs.append("최상위 diagnosis가 correct 진단 id와 불일치")

    # 추천 검사 최소 1개
    if not any(o.get("recommended") for o in c["test_options"]):
        errs.append("recommended=true 검사가 최소 1개 필요")

    # 신체진찰/배점 (exam_items가 없는 케이스는 그대로 통과)
    errs.extend(_validate_exam(c))
    # 환자교육 (education_items가 없고 배점 0인 케이스는 그대로 통과)
    errs.extend(_validate_education(c))

    # hidden_fact 의 unlock_intent 가 required_questions topic 으로 이어지는지(선택 경고)
    return errs


def main() -> int:
    if len(sys.argv) < 2:
        print("사용: validate_case.py <case.json> ...")
        return 2
    bad = 0
    for arg in sys.argv[1:]:
        p = Path(arg)
        errs = validate(p)
        hard = [e for e in errs if not e.startswith("⚠")]
        warns = [e for e in errs if e.startswith("⚠")]
        if hard:
            bad += 1
            print(f"❌ {p.name}: {len(hard)} 오류")
            for e in hard:
                print(f"   - {e}")
        else:
            print(f"✅ {p.name}: 통과" + (f" ({len(warns)} 경고)" if warns else ""))
        for w in warns:
            print(f"   {w}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
