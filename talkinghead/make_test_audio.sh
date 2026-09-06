#!/bin/bash
# Generate a Korean test speech WAV (16k mono) for the talking-head pipeline.
# Usage: ./make_test_audio.sh "안녕하세요" /tmp/out.wav
set -e
TEXT="${1:-안녕하세요, 요즘 너무 피곤하고 어지러워서 왔어요. 머리도 자주 아프고 잠도 잘 못 자요.}"
OUT="${2:-samples/test.wav}"
TMP="$(mktemp -t talkhead).aiff"
say -v Yuna "$TEXT" -o "$TMP"
ffmpeg -y -i "$TMP" -ar 16000 -ac 1 "$OUT"
rm -f "$TMP"
echo "Wrote $OUT"
