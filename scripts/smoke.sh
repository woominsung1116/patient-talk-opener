#!/bin/zsh
# 스모크 테스트 — 백엔드 전체 게임 루프를 자동 플레이하고 결과를 출력한다.
# 사용: ./scripts/smoke.sh [case_id]
set -e
BASE=${BASE:-http://localhost:8000}
CASE=${1:-iron_deficiency_anemia_01}

echo "── health"
curl -sf "$BASE/api/health" | python3 -m json.tool

SID=$(curl -sf -X POST "$BASE/api/session/start" -H 'Content-Type: application/json' \
  -d "{\"case_id\":\"$CASE\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['session_id'])")
echo "── session: $SID ($CASE)"

ask() {
  curl -sf -X POST "$BASE/api/session/$SID/turn" -H 'Content-Type: application/json' \
    -d "{\"user_text\":\"$1\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f\"  Q: {d['user_text']}\")
print(f\"  A: {d['patient_text']}\")
print(f\"     intent={d['intent_analysis']['intent']} empathy={d['intent_analysis']['empathy']} trust={d['state']['trust']} anxiety={d['state']['anxiety']} emotion={d['emotion']}\")
if d['unlocked_facts']: print(f\"     ✨ 해금: {[f['label'] for f in d['unlocked_facts']]}\")
"
}

ask "안녕하세요, 어디가 불편해서 오셨어요?"
ask "많이 힘드셨겠어요. 언제부터 그러셨어요?"
ask "식사는 잘 챙겨 드시고 계세요?"
ask "말씀하기 불편하실 수 있는데, 혹시 생리 양이 평소보다 많아지셨나요?"
ask "혹시 변 색깔이 검게 변한 적은 없으셨어요?"
ask "확인차 여쭤봐요, 임신 가능성은 없으실까요?"

echo "── 진단/검사 제출"
curl -sf -X POST "$BASE/api/session/$SID/submit" -H 'Content-Type: application/json' \
  -d '{"diagnosis":["iron_deficiency_anemia","thyroid_disorder"],"tests":["CBC","ferritin","TIBC","TSH"]}' \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f\"  총점 {d['final_score']}/100 (등급 {d['grade']}) 정답: {d['diagnosis_correct']}\")
print(f\"  영역: {d['scores']}\")
print(f\"  교수 한마디: {d['feedback']['short_feedback']}\")
"
echo "── smoke OK"
