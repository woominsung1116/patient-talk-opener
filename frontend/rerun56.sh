#!/bin/zsh
cd /Users/woominseong/Desktop/최상위/patient-talk-opener/frontend
python3 - 5 > /tmp/rand_q.txt <<'PY'
import random, sys
seed = int(sys.argv[1]); random.seed(seed * 7919)
QS = [("onset","언제부터 아프셨어요?"),("location","정확히 어디가 아프세요?"),("quality","통증이 어떤 식으로 아프세요?"),("change","자세를 바꾸면 통증이 달라지나요?"),("severity","통증이 10점 만점에 몇 점인가요?"),("nausea","속이 메스껍거나 토하셨나요?"),("fever","열이나 오한은 없었나요?"),("urinary","소변 볼 때 아프거나 피가 섞여 나오진 않나요?"),("trauma","다치거나 부딪힌 적 있나요?"),("prior","예전에도 이런 적 있었나요?"),("surgery","수술 받은 적 있으세요?"),("medication","드시는 약이 있나요?"),("diet","식사는 평소랑 어떠셨어요?"),("pregnancy","임신 가능성은 없으세요?"),("menses","생리는 규칙적이세요?")]
k = random.randint(3,5); omit = set(random.sample(range(len(QS)), k))
print(";".join(q for i,(_,q) in enumerate(QS) if i not in omit))
PY
node play_case.mjs "랜덤5_생략_통증양상·통증정도·오심구토·발열오한·수술력" "$(sed -n 1p /tmp/rand_q.txt)"
python3 - 6 > /tmp/rand_q.txt <<'PY'
import random, sys
seed = int(sys.argv[1]); random.seed(seed * 7919)
QS = [("onset","언제부터 아프셨어요?"),("location","정확히 어디가 아프세요?"),("quality","통증이 어떤 식으로 아프세요?"),("change","자세를 바꾸면 통증이 달라지나요?"),("severity","통증이 10점 만점에 몇 점인가요?"),("nausea","속이 메스껍거나 토하셨나요?"),("fever","열이나 오한은 없었나요?"),("urinary","소변 볼 때 아프거나 피가 섞여 나오진 않나요?"),("trauma","다치거나 부딪힌 적 있나요?"),("prior","예전에도 이런 적 있었나요?"),("surgery","수술 받은 적 있으세요?"),("medication","드시는 약이 있나요?"),("diet","식사는 평소랑 어떠셨어요?"),("pregnancy","임신 가능성은 없으세요?"),("menses","생리는 규칙적이세요?")]
k = random.randint(3,5); omit = set(random.sample(range(len(QS)), k))
print(";".join(q for i,(_,q) in enumerate(QS) if i not in omit))
PY
node play_case.mjs "랜덤6_생략_통증양상·통증변화·과거유사증상" "$(sed -n 1p /tmp/rand_q.txt)"
echo RERUN56_DONE
