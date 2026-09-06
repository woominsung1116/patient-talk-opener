#!/usr/bin/env python3
"""EKJM 시드(제목/키워드) → 케이스 JSON 생성 (codex CLI).

저작권: 원문을 복제하지 않고 진단명만 참고해 가상 환자를 재작성한다.
라포 게임에 맞게 '민감 정보 은폐 → 신뢰 형성 시 해금' 구조를 설계하도록 지시한다.

사용: python3 generate_case.py "<진단명>" "<case_id>" "<제목 시드>" [avatar]
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = (ROOT / "backend/app/cases/iron_deficiency_anemia_01.json").read_text()

PROMPT = """너는 한국 의과대학 CPX(임상수행평가) 케이스 작가다. 아래 예시와 똑같은 JSON 스키마로
새 외래 문진 케이스를 1개 작성하라. 이 게임은 "라포를 쌓아 환자가 숨긴 정보를 끌어내는" 게임이다.

[설계 원칙]
- 진단의 결정적 단서를 hidden_facts에 넣되, 환자가 부끄럽거나 꺼려서 숨기는 정보로 만든다
  (예: 한약·건강보조제 복용, 음주, 다이어트, 성생활, 정신과적 배경). 이게 게임의 핵심 재미다.
- hidden_facts의 required_trust는 민감할수록 높게(50~65), requires_empathy는 민감하면 true.
- unlock_intent는 반드시 다음 중 하나: ask_medication, ask_diet, ask_social_history, ask_sleep,
  ask_menstruation, ask_past_history, ask_family_history, ask_severity, ask_onset, ask_weight.
- required_questions와 red_flags의 topic은 반드시: onset_duration, severity, diet, sleep,
  menstruation, medication, social_history, past_history, family_history, weight_loss, melena,
  pregnancy 중에서만 쓴다.
- negative_findings의 키도 위 topic 목록만 쓴다.
- diagnosis_options는 8개(정답 1 + plausible 4~5 + 비현실 2~3), test_options는 8~10개.
- 환자는 절대 진단명이나 의학용어를 쓰지 않는다. 구어체로 자연스럽게.
- teaching_points 4개, max_turns 15.

[진단] {diagnosis}
[case_id] {case_id}
[제목 시드(원문 복제 금지, 진단 방향만 참고)] {seed}
[avatar] {avatar}

[예시 스키마 — 이 구조를 정확히 따르되 내용은 새로 작성]
{example}

JSON만 출력하라. 설명·코드펜스 금지."""


def main() -> int:
    if len(sys.argv) < 4:
        print("사용: generate_case.py <진단명> <case_id> <제목시드> [avatar]")
        return 2
    diagnosis, case_id, seed = sys.argv[1], sys.argv[2], sys.argv[3]
    avatar = sys.argv[4] if len(sys.argv) > 4 else "jieun"
    prompt = PROMPT.format(diagnosis=diagnosis, case_id=case_id, seed=seed, avatar=avatar, example=EXAMPLE)

    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        out_path = f.name
    print(f"[codex] '{diagnosis}' 케이스 생성 중... (1~2분)", flush=True)
    subprocess.run(
        ["codex", "exec", "--skip-git-repo-check", "-s", "read-only",
         "-c", 'model_reasoning_effort="medium"', "-c", "tools.web_search=false",
         "--output-last-message", out_path, prompt],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    raw = Path(out_path).read_text().strip()
    Path(out_path).unlink(missing_ok=True)

    # 코드펜스/잡텍스트 제거 후 JSON 추출
    import re
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
    start = raw.find("{")
    depth = 0
    obj = None
    for i in range(start, len(raw)):
        if raw[i] == "{":
            depth += 1
        elif raw[i] == "}":
            depth -= 1
            if depth == 0:
                obj = raw[start:i + 1]
                break
    if obj is None:
        print("JSON 추출 실패. 원문:\n", raw[:500])
        return 1
    parsed = json.loads(obj)
    dest = ROOT / "backend/app/cases" / f"{case_id}.json"
    dest.write_text(json.dumps(parsed, ensure_ascii=False, indent=2))
    print(f"✅ 생성: {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
