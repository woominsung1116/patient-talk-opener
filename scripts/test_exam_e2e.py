#!/usr/bin/env python3
"""신체진찰·환자교육 API E2E — 프론트가 실제로 보내는 호출 형태 그대로 두드린다.

핵심은 action_id와 region 유무를 store.ts의 라우팅 표와 똑같이 맞추는 것이다:
  · TOOL_IDS  : 발화로 도구를 고른 뒤 3D 부위 메시를 눌러 부위별로 호출
  · VOICE_IDS : 발화 한 번 = 부위 없는 호출 1회로 항목 완료
여기서 통과하면 "서버 계약"은 맞다는 뜻이고, 브라우저에서 실제로 말이 통하는지는
frontend/test_exam_wiring.mjs 가 따로 확인한다.

사용: 백엔드를 띄운 뒤  python3 scripts/test_exam_e2e.py [http://localhost:8000]
"""
import json
import sys
import urllib.request
from pathlib import Path

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
CASES_DIR = Path(__file__).resolve().parent.parent / "backend" / "app" / "cases"

# ── store.ts와 동기화 ──
TOOL_IDS = {"auscultation", "percussion", "palpation", "cva_tenderness"}
VOICE_IDS = {
    "conjunctiva", "sclera_exam", "oral_exam", "thyroid_inspect", "thyroid_palpation",
    "tremor_exam", "liver_palpation", "heart_auscultation", "lung_auscultation",
}
MVP = [
    "acute_flank_pain_urolithiasis_01",   # 최우선 회귀 — 복부 4분면·2패스·CVA 좌우
    "iron_deficiency_anemia_01",
    "hyperthyroidism_01",
    "weightloss_supplement_thyrotoxicosis_01",
    "herbal_fulminant_hepatitis_01",
    "panic_attack_01",
]


def post(path, body):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def load(case_id):
    return json.loads((CASES_DIR / f"{case_id}.json").read_text())


def perform(sid, item, fails, case_id):
    """항목 하나를 '브라우저가 하듯' 시행."""
    aid = item["id"]
    regions = item.get("required_regions") or []
    passes = item.get("passes") or []
    if aid in TOOL_IDS and regions:
        # 3D 클릭 경로 — pass별로 부위를 하나씩. 압통 부위는 마지막에 (공식 평가표).
        tender = item.get("tender_region")
        seq = [r for r in regions if r != tender] + ([tender] if tender in regions else [])
        res = None
        for p in (passes or [None]):
            for reg in seq:
                body = {"action_id": aid, "region": reg}
                if p:
                    body["pass"] = p
                res = post(f"/api/session/{sid}/exam", body)
        return res
    if regions and aid not in VOICE_IDS and item.get("type") == "exam_action":
        fails.append(f"{case_id}: '{aid}'가 프론트 라우팅 표 어디에도 없다 (브라우저에서 시행 불가)")
    return post(f"/api/session/{sid}/exam", {"action_id": aid})


def run_case(case_id, fails):
    case = load(case_id)
    sid = post("/api/session/start", {"case_id": case_id})["session_id"]
    for it in sorted(case.get("exam_items", []), key=lambda x: x.get("order", 0)):
        perform(sid, it, fails, case_id)

    edu_items = {e["id"]: e for e in case.get("education_items", [])}
    dx = edu_items.get("diagnosis", {})
    payload = {
        "diagnosis_evidence": [o["id"] for o in dx.get("evidence_options", []) if o.get("correct")],
        "test_plan": [i for i in ("test_plan_lab", "test_plan_image") if i in edu_items],
        "treatment": [i for i in ("tx_analgesic", "tx_definitive") if i in edu_items],
        "complication": [i for i in ("complication",) if i in edu_items],
    }
    rep = post(f"/api/session/{sid}/submit", {
        "diagnosis": [case["diagnosis_label"]],
        "tests": [t["id"] for t in case["test_options"] if t.get("recommended")],
        "education": payload,
    })
    ed = rep.get("exam_detail") or {}
    undone = [d["label"] for d in ed.get("detail", []) if not d["done"]]
    if undone:
        fails.append(f"{case_id}: 시행되지 않은 진찰 {undone}")
    if ed.get("penalties"):
        fails.append(f"{case_id}: 진찰 감점 {ed['penalties']}")
    if round(ed.get("ratio", 0), 3) != 1.0:
        fails.append(f"{case_id}: 진찰 ratio {ed.get('ratio')} != 1.0")
    edu = rep.get("education_detail") or {}
    if edu.get("got") != edu.get("max"):
        fails.append(f"{case_id}: 환자교육 {edu.get('got')}/{edu.get('max')} — 만점 아님")
    print(f"  {case_id:42} 진찰 {rep['scores'].get('physical_exam')}/"
          f"{rep['max_scores'].get('physical_exam')}  교육 {edu.get('got')}/{edu.get('max')}  "
          f"항목 {len(ed.get('detail', []))}개 전부시행={not undone}")


def run_legacy(case_id, fails):
    """exam_items가 없는 범위 밖 케이스 — legacy 채점 경로가 그대로 동작해야 한다(회귀 금지)."""
    case = load(case_id)
    sid = post("/api/session/start", {"case_id": case_id})["session_id"]
    rep = post(f"/api/session/{sid}/submit", {
        "diagnosis": [case["diagnosis_label"]],
        "tests": [t["id"] for t in case["test_options"] if t.get("recommended")],
        "education": None,
    })
    if bool(rep.get("weighted")) != bool(case.get("scoring_weights")):
        fails.append(f"{case_id}: weighted={rep.get('weighted')} 인데 "
                     f"scoring_weights={bool(case.get('scoring_weights'))}")
    if not rep.get("diagnosis_correct"):
        fails.append(f"{case_id}: 정답 진단명을 넣었는데 오답 처리됨")
    if "final_score" not in rep:
        fails.append(f"{case_id}: final_score 없음")
    print(f"  {case_id:42} score={rep.get('final_score')} grade={rep.get('grade')} "
          f"weighted={rep.get('weighted')}")


def main() -> int:
    fails: list[str] = []
    print("── MVP 6케이스: 전 진찰 항목 시행 + 교육 만점 ──")
    for c in MVP:
        run_case(c, fails)
    print("── 범위 밖 케이스 (legacy 경로 회귀) ──")
    for c in sorted(p.stem for p in CASES_DIR.glob("*.json") if p.stem not in MVP):
        run_legacy(c, fails)
    print(f"\n{'❌' if fails else '✅'} 실패 {len(fails)}건")
    for f in fails:
        print("   -", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
