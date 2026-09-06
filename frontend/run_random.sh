#!/bin/zsh
# 요로결석 랜덤 생략 — 문진 질문 3~5개 + 진찰 액션 0~3개를 무작위로 빼고 플레이
cd /Users/woominseong/Desktop/최상위/patient-talk-opener/frontend
LOG=/Users/woominseong/Desktop/최상위/patient-talk-opener/피드백_테스트/랜덤_생략기록.txt
for i in 1 2 3 4 5 6; do
  python3 - "$i" > /tmp/rand_q.txt <<'PY'
import random, sys
seed = int(sys.argv[1])
random.seed(seed * 7919)
QS = [
  ("통증시작", "언제부터 아프셨어요?"),
  ("통증위치", "정확히 어디가 아프세요?"),
  ("통증양상", "통증이 어떤 식으로 아프세요?"),
  ("통증변화", "자세를 바꾸면 통증이 달라지나요?"),
  ("통증정도", "통증이 10점 만점에 몇 점인가요?"),
  ("오심구토", "속이 메스껍거나 토하셨나요?"),
  ("발열오한", "열이나 오한은 없었나요?"),
  ("배뇨증상", "소변 볼 때 아프거나 피가 섞여 나오진 않나요?"),
  ("외상력", "다치거나 부딪힌 적 있나요?"),
  ("과거유사", "예전에도 이런 적 있었나요?"),
  ("수술력", "수술 받은 적 있으세요?"),
  ("복용약물", "드시는 약이 있나요?"),
  ("식사", "식사는 평소랑 어떠셨어요?"),
  ("임신가능성", "임신 가능성은 없으세요?"),
  ("생리력", "생리는 규칙적이세요?"),
]
EX = [  # 케이스 exam_items 전체 (순서 = 채점 순서)
  ("손위생", "hand_hygiene"),
  ("설명동의", "explain_consent"),
  ("가려주기", "drape"),
  ("무릎세우기", "knee_flex"),
  ("청진", "auscultation"),
  ("타진", "percussion"),
  ("촉진", "palpation"),
  ("CVA압통", "cva_tenderness"),
]
k = random.randint(3, 5)
omit_q = set(random.sample(range(len(QS)), k))
ke = random.randint(0, 4)
omit_e = set(random.sample(range(len(EX)), ke))
kept_q = ";".join(q for i, (_, q) in enumerate(QS) if i not in omit_q)
kept_e = ",".join(a for i, (_, a) in enumerate(EX) if i not in omit_e)
om_q = "·".join(QS[i][0] for i in sorted(omit_q)) or "없음"
om_e = "·".join(EX[i][0] for i in sorted(omit_e)) or "없음"
print(kept_q)
print(kept_e)
print(f"문진생략: {om_q} / 진찰생략: {om_e}")
import json
print(json.dumps({
  "omitted_questions": [{"topic": QS[i][0], "example": QS[i][1]} for i in sorted(omit_q)],
  "asked_questions": [{"topic": t, "example": q} for i, (t, q) in enumerate(QS) if i not in omit_q],
  "omitted_exams": [EX[i][0] for i in sorted(omit_e)],
  "performed_exams": [t for i, (t, _) in enumerate(EX) if i not in omit_e],
}, ensure_ascii=False))
PY
  Q=$(sed -n 1p /tmp/rand_q.txt)
  E=$(sed -n 2p /tmp/rand_q.txt)
  DESC=$(sed -n 3p /tmp/rand_q.txt)
  META=$(sed -n 4p /tmp/rand_q.txt)
  echo "[랜덤생략$i] $DESC"
  echo "랜덤생략$i — $DESC" >> $LOG
  EXAM="$E" META="$META" node play_case.mjs "랜덤생략${i}" "$Q"
done
echo RANDOM_DONE
