"""케이스 JSON 로더."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CASES_DIR = Path(__file__).resolve().parent.parent / "cases"

# 즉석 케이스 — 파일로 두지 않고 메모리에만 사는 케이스.
# 웹앱(CPT)이 자기 사례를 정본으로 삼고 게임 형식으로 바꿔 보내면 여기 담긴다.
# 사례를 두 곳(웹앱 JSON + 게임 JSON)에서 따로 관리하면 같은 진단인데 환자
# 나이·성별이 갈리는 일이 생긴다(충수염: 웹앱 24세 성인 / 게임 10세 소아).
# turn·exam·submit 이 모두 load() 로 케이스를 다시 읽으므로, 여기서 함께
# 찾아주면 나머지 경로는 손대지 않아도 된다.
_ADHOC: dict[str, dict[str, Any]] = {}


def register_adhoc(case: dict[str, Any]) -> str:
    """즉석 케이스를 등록하고 case_id 를 돌려준다."""
    case_id = case["case_id"]
    _ADHOC[case_id] = case
    return case_id


def _level(value: Any, fallback: float = 0.0) -> float:
    """JSON의 임상 연출 값을 0~1로 정규화한다."""
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return fallback


def appearance_from_profile(profile: dict[str, Any]) -> dict[str, Any]:
    """신규 appearance와 기존 signs/pain_level 케이스를 한 계약으로 읽는다."""
    saved = profile.get("appearance") or {}
    signs = set(profile.get("signs") or [])
    pain_level = _level(saved.get("pain_level", profile.get("pain_level", 0)))
    period = saved.get("pain_colicky_period", profile.get("pain_colicky_period"))
    try:
        period = max(4.0, min(60.0, float(period))) if period is not None else None
    except (TypeError, ValueError):
        period = None

    return {
        "pain_level": pain_level,
        "pain_colicky_period": period,
        "guarding": _level(saved.get("guarding", pain_level)),
        "restlessness": _level(saved.get("restlessness", pain_level if period else 0)),
        "scleral_icterus": _level(saved.get("scleral_icterus", 1 if "jaundice" in signs else 0)),
        "skin_jaundice": _level(saved.get("skin_jaundice", 0.65 if "jaundice" in signs else 0)),
        "conjunctival_pallor": _level(
            saved.get("conjunctival_pallor", 1 if "pale_conjunctiva" in signs else 0)
        ),
        "cyanosis": _level(saved.get("cyanosis", 0)),
        "diaphoresis": _level(saved.get("diaphoresis", 0)),
        "sclera_color": saved.get("sclera_color", "#d9c775"),
        "skin_tint_color": saved.get("skin_tint_color", "#d7b84a"),
        "conjunctiva_color": saved.get("conjunctiva_color", "#e8c4bd"),
        "goiter": bool(saved.get("goiter", "goiter" in signs)),
        "atrophic_glossitis": bool(
            saved.get("atrophic_glossitis", "atrophic_glossitis" in signs)
        ),
        "finger_swelling_left": _level(saved.get("finger_swelling_left", 0)),
        "finger_swelling_right": _level(saved.get("finger_swelling_right", 0)),
        "leg_edema_left": _level(saved.get("leg_edema_left", 0)),
        "leg_edema_right": _level(saved.get("leg_edema_right", 0)),
        "rash_level": _level(saved.get("rash_level", 0)),
        "rash_region": saved.get("rash_region", "torso"),
        "rash_color": saved.get("rash_color", "#b94a55"),
        "bruise_level": _level(saved.get("bruise_level", 0)),
        "bruise_region": saved.get("bruise_region", "left_leg"),
        "bruise_color": saved.get("bruise_color", "#59456f"),
    }


def list_cases() -> list[dict[str, Any]]:
    cases = []
    loaded = [json.loads(p.read_text()) for p in CASES_DIR.glob("*.json")]
    loaded.sort(key=lambda c: (c.get("difficulty", 1), c["case_id"]))
    for c in loaded:
        cases.append(
            {
                "case_id": c["case_id"],
                "title": c["title"],
                "subtitle": c.get("subtitle", ""),
                "difficulty": c.get("difficulty", 1),
                "patient": {
                    "name": c["patient_profile"]["name"],
                    "age": c["patient_profile"]["age"],
                    "gender": c["patient_profile"]["gender"],
                    "occupation": c["patient_profile"].get("occupation", ""),
                    "body_type": c["patient_profile"].get("body_type"),
                    "signs": c["patient_profile"].get("signs") or [],
                    "appearance": appearance_from_profile(c["patient_profile"]),
                },
                "chief_complaint": c.get("chief_complaint", ""),
                # 증례 도감(학습)용 — 진단명과 핵심 포인트. 랜덤 진료 모드는 사용 안 함.
                "diagnosis_label": c.get("diagnosis_label", ""),
                "teaching_points": c.get("teaching_points", []),
                "max_turns": c.get("max_turns", 15),
            }
        )
    return cases


def load(case_id: str) -> dict[str, Any]:
    if case_id in _ADHOC:
        return _ADHOC[case_id]
    path = CASES_DIR / f"{case_id}.json"
    if not path.exists():
        raise FileNotFoundError(case_id)
    return json.loads(path.read_text())


def update_appearance(case_id: str, appearance: dict[str, Any]) -> dict[str, Any]:
    """교수자 편집값을 케이스에 원자적으로 저장하고 기존 signs도 동기화한다."""
    case = load(case_id)
    profile = case["patient_profile"]
    profile["appearance"] = appearance
    # 구버전 렌더러/도구가 계속 작동하도록 통증과 이진 signs도 함께 유지한다.
    profile["pain_level"] = appearance["pain_level"]
    profile["pain_colicky_period"] = appearance["pain_colicky_period"]
    signs = set(profile.get("signs") or [])
    managed = {
        "jaundice", "pale_conjunctiva", "goiter", "atrophic_glossitis",
        "finger_swelling", "leg_edema", "rash", "bruise",
    }
    signs -= managed
    if appearance["scleral_icterus"] > 0.02 or appearance["skin_jaundice"] > 0.02:
        signs.add("jaundice")
    if appearance["conjunctival_pallor"] > 0.02:
        signs.add("pale_conjunctiva")
    if appearance["goiter"]:
        signs.add("goiter")
    if appearance["atrophic_glossitis"]:
        signs.add("atrophic_glossitis")
    if max(appearance["finger_swelling_left"], appearance["finger_swelling_right"]) > 0.02:
        signs.add("finger_swelling")
    if max(appearance["leg_edema_left"], appearance["leg_edema_right"]) > 0.02:
        signs.add("leg_edema")
    if appearance["rash_level"] > 0.02:
        signs.add("rash")
    if appearance["bruise_level"] > 0.02:
        signs.add("bruise")
    profile["signs"] = sorted(signs)

    path = CASES_DIR / f"{case_id}.json"
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(case, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)
    return appearance_from_profile(profile)
