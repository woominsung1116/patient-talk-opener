#!/bin/zsh
# Microsoft Rocketbox(MIT 라이선스) 아바타 3종을 받아 GLB + 웹용 텍스처로 변환한다.
# 요구: assimp (brew install assimp), macOS sips
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/frontend/public/avatars"
mkdir -p "$OUT"
BASE="https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/Adults"
API="https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars/Adults"

fetch_one() {
  local folder=$1 role=$2
  local tmp="/tmp/rocketbox_$folder"
  mkdir -p "$tmp"
  echo "── $folder → $role"

  # 텍스처 프리픽스 자동 감지 (예: f001, m001)
  local prefix
  prefix=$(curl -s "$API/$folder/Textures" | python3 -c "
import json,sys
for x in json.load(sys.stdin):
    n = x['name']
    if n.endswith('_body_color.tga'):
        print(n.replace('_body_color.tga','')); break")
  echo "   prefix: $prefix"

  # FBX (페이셜 본 포함) → GLB
  if [ ! -f "$OUT/$role.glb" ]; then
    curl -sL --retry 2 -o "$tmp/model.fbx" "$BASE/$folder/Export/${folder}_facial.fbx"
    assimp export "$tmp/model.fbx" "$OUT/$role.glb" > /dev/null
    echo "   glb: $(du -h "$OUT/$role.glb" | cut -f1)"
  fi

  # 텍스처: color/normal(jpg), opacity(png — 알파 필요)
  for tex in body_color head_color body_normal head_normal; do
    if [ ! -f "$OUT/${role}_${tex}.jpg" ]; then
      curl -sL --retry 2 -o "$tmp/$tex.tga" "$BASE/$folder/Textures/${prefix}_${tex}.tga"
      sips -s format jpeg -s formatOptions 85 "$tmp/$tex.tga" --out "$OUT/${role}_${tex}.jpg" > /dev/null 2>&1 || echo "   (없음: $tex)"
    fi
  done
  if [ ! -f "$OUT/${role}_opacity.png" ]; then
    curl -sL --retry 2 -o "$tmp/opacity.tga" "$BASE/$folder/Textures/${prefix}_opacity_color.tga" \
      && sips -s format png "$tmp/opacity.tga" --out "$OUT/${role}_opacity.png" > /dev/null 2>&1 \
      || echo "   (opacity 없음)"
  fi
  rm -rf "$tmp"
}

fetch_one Female_Adult_01 jieun
fetch_one Female_Adult_04 sujin
fetch_one Male_Adult_11 hyunwoo

echo "── 완료"; ls -la "$OUT"
