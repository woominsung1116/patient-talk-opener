#!/bin/sh
# Wav2Lip 서브모듈에 로컬 패치를 적용한다.
#   - audio.py: librosa 0.10 키워드 인자
#   - face_detection: mps 디바이스 허용, torch.load(weights_only=False)
#   - wav2lip_infer.py: generate.py 가 쓰는 추론 진입점 (신규 파일)
# 사용: sh talkinghead/patches/apply.sh   (서브모듈 체크아웃 직후 한 번)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../Wav2Lip"
if git apply --check --reverse "$HERE/wav2lip-local.patch" 2>/dev/null; then
  echo "이미 적용되어 있음"
  exit 0
fi
git apply "$HERE/wav2lip-local.patch"
echo "적용 완료: $(git status --short | wc -l | tr -d ' ')개 파일"
