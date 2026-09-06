#!/usr/bin/env python3
"""다중 시나리오 자동 플레이 테스트 — 전체 트랜스크립트를 수집한다."""
import json
import sys
import time
import urllib.request

BASE = "http://localhost:8000"


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def play(name: str, case_id: str, turns: list[str], diagnosis: list[str], tests: list[str]) -> dict:
    s = post("/api/session/start", {"case_id": case_id})
    sid = s["session_id"]
    log = {"scenario": name, "case": case_id, "patient": s["patient"]["name"], "turns": []}
    print(f"\n═══ {name} ({case_id})", flush=True)
    for q in turns:
        t0 = time.time()
        try:
            r = post(f"/api/session/{sid}/turn", {"user_text": q})
        except Exception as e:
            log["turns"].append({"q": q, "error": str(e)})
            print(f"  Q: {q}\n  !! 오류: {e}", flush=True)
            if "409" in str(e):
                break
            continue
        dt = time.time() - t0
        log["turns"].append({
            "q": q,
            "a": r["patient_text"],
            "intent": r["intent_analysis"]["intent"],
            "empathy": r["intent_analysis"]["empathy"],
            "trust": r["state"]["trust"],
            "anxiety": r["state"]["anxiety"],
            "unlocked": [f["label"] for f in r["unlocked_facts"]],
            "emotion": r["emotion"],
            "game_over": r["game_over"],
            "sec": round(dt, 1),
        })
        print(f"  Q: {q}\n  A: {r['patient_text']}\n     [{r['intent_analysis']['intent']} 공감:{r['intent_analysis']['empathy']} 신뢰:{r['state']['trust']} {('해금:' + ','.join(f['label'] for f in r['unlocked_facts'])) if r['unlocked_facts'] else ''} {r['game_over'] or ''} {dt:.0f}s]", flush=True)
        if r["game_over"] == "trust_collapsed":
            break
    try:
        rep = post(f"/api/session/{sid}/submit", {"diagnosis": diagnosis, "tests": tests})
        log["report"] = {
            "score": rep["final_score"], "grade": rep["grade"], "correct": rep["diagnosis_correct"],
            "scores": rep["scores"], "feedback": rep["feedback"],
        }
        print(f"  ▶ 채점: {rep['final_score']}점 {rep['grade']} 정답:{rep['diagnosis_correct']}", flush=True)
    except Exception as e:
        log["report"] = {"error": str(e)}
        print(f"  ▶ 채점 오류: {e}", flush=True)
    return log


SCENARIOS = [
    ("A. 이상적 플레이 (공감+체계 문진)", "iron_deficiency_anemia_01", [
        "안녕하세요 지은님, 어디가 불편해서 오셨어요?",
        "많이 힘드셨겠어요. 언제부터 그러셨어요?",
        "식사는 잘 챙겨 드시고 계세요?",
        "말씀하기 조심스러우실 수 있는데, 생리 양이 평소보다 많아지진 않으셨어요?",
        "혹시 변 색깔이 검게 변한 적은 없으셨어요?",
        "체중 변화는 없으셨어요?",
        "따로 드시는 약이 있으세요?",
        "확인차 여쭤요, 임신 가능성은 없을까요?",
    ], ["iron_deficiency_anemia", "thyroid_disorder"], ["CBC", "ferritin", "TIBC", "TSH"]),

    ("B. 공격적 플레이 (다그침)", "iron_deficiency_anemia_01", [
        "빨리 말해보세요, 어디가 아파요?",
        "왜 말을 제대로 안 해요? 솔직히 말해요.",
        "숨기지 말고 빨리요. 생리는요?",
        "거짓말하지 마세요. 제대로 말 안 하면 진료 못 해요.",
        "아니 왜 이렇게 대답을 못해요?",
        "똑바로 말하라니까요.",
    ], ["depression"], ["brain_MRI"]),

    ("C. 무관한 잡담", "iron_deficiency_anemia_01", [
        "오늘 날씨 진짜 좋죠?",
        "점심 뭐 드셨어요?",
        "주말에 뭐 하세요?",
        "좋아하는 영화 있으세요?",
    ], ["iron_deficiency_anemia"], ["CBC"]),

    ("D. 남자 환자에게 생리 질문", "panic_attack_01", [
        "안녕하세요, 어떻게 오셨어요?",
        "혹시 생리 주기는 규칙적이세요?",
        "아 죄송합니다. 카페인은 많이 드세요?",
    ], ["panic_disorder"], ["EKG", "TSH"]),

    ("E. 회피→설득→해금 흐름", "iron_deficiency_anemia_01", [
        "생리 양은 어때요?",
        "말씀하시기 힘드실 수 있지만 진료에 꼭 필요해서요.",
        "괜찮아요, 천천히 말씀하셔도 돼요. 많이 걱정되셨죠?",
        "이제 편하게 말씀해주실 수 있을까요? 생리 양이 많아지셨나요?",
    ], ["iron_deficiency_anemia"], ["CBC", "ferritin"]),

    ("F. 성급한 진단", "hyperthyroidism_01", [
        "어디가 불편하세요?",
        "아 그거 100% 갑상선암이네요. 확실해요.",
        "걱정 마세요, 어차피 수술하면 돼요.",
    ], ["hyperthyroidism"], ["TSH"]),

    ("G. 같은 질문 반복", "iron_deficiency_anemia_01", [
        "언제부터 어지러우셨어요?",
        "언제부터 어지러우셨어요?",
        "언제부터 어지러우셨다고요?",
    ], ["iron_deficiency_anemia"], ["CBC"]),

    ("H. 이상 입력", "iron_deficiency_anemia_01", [
        "ㅁㄴㅇㄹ",
        "asdf qwer",
        "물 한 잔만 주세요",
    ], ["iron_deficiency_anemia"], ["CBC"]),

    ("I. 케이스2 정석 플레이", "hyperthyroidism_01", [
        "안녕하세요, 어떤 일로 오셨어요?",
        "바쁘신데 오시느라 고생하셨어요. 언제부터 두근거리셨어요?",
        "식욕은 어떠세요? 먹는 양이 변했나요?",
        "잠은 잘 주무세요?",
        "더위를 잘 못 참거나 손이 떨리진 않으세요?",
        "조심스럽지만 생리는 규칙적이신가요?",
        "가족 중에 갑상선 질환 있으신 분 계세요?",
    ], ["hyperthyroidism", "anxiety_disorder"], ["TSH", "thyroid_antibody", "EKG"]),
]

if __name__ == "__main__":
    results = []
    t0 = time.time()
    for args in SCENARIOS:
        results.append(play(*args))
    out = "/tmp/scenario_results.json"
    json.dump(results, open(out, "w"), ensure_ascii=False, indent=1)
    print(f"\n총 {time.time()-t0:.0f}초, 결과: {out}", flush=True)
