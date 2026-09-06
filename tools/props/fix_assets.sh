#!/usr/bin/env bash
# frontend/public/models 자산 결함 일괄 수정.
#
#   1) NORMAL 없는 GLB 에 각도 임계 노멀 계산 (iv_drip, exam_bed)
#   2) potted_plant_01 폴리곤 감축 176k -> 1만 이하
#   3) 외부 텍스처를 GLB 에 내장 (요청 수 자산당 5~8건 -> 1건)
#
# 덮어쓰기 전에 전체 tar 백업 + 파일별 .bak 을 남긴다.
# 재실행하면 이미 고쳐진 자산에는 아무 일도 안 일어난다(멱등)... 이 아니라
# 감축은 누적되므로 **원본 백업에서 복구한 뒤** 다시 돌려라.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODELS="$ROOT/frontend/public/models"
TOOLS="$ROOT/tools/props"
PY="${PY:-python3}"
BACKUP="${BACKUP:?BACKUP=<백업 디렉터리> 를 지정해라}"

mkdir -p "$BACKUP"
echo "== 0) 전체 백업 -> $BACKUP/models_before.tar.gz"
tar -czf "$BACKUP/models_before.tar.gz" -C "$(dirname "$MODELS")" "$(basename "$MODELS")"

echo
echo "== 1) NORMAL 복구"
for f in iv_drip exam_bed; do
  src="$MODELS/$f.glb"
  [ -f "$src" ] || { echo "  $f.glb 없음 — 건너뜀"; continue; }
  cp -n "$src" "$src.bak" || true
  "$PY" "$TOOLS/gltf_fix_normals.py" "$src.bak" "$src" --angle 40
done

echo
echo "== 2) potted_plant_01 감축"
cp -n "$MODELS/potted_plant_01/potted_plant_01.gltf" "$MODELS/potted_plant_01/potted_plant_01.gltf.bak" || true
cp -n "$MODELS/potted_plant_01/potted_plant_01.bin" "$MODELS/potted_plant_01/potted_plant_01.bin.bak" || true
TMP="$(mktemp -d)"
node "$TOOLS/simplify_plant.mjs" \
  "$MODELS/potted_plant_01/potted_plant_01.gltf.bak" \
  "$TMP/potted_plant_01.gltf"
cp "$TMP"/potted_plant_01.gltf "$MODELS/potted_plant_01/potted_plant_01.gltf"
cp "$TMP"/potted_plant_01.bin "$MODELS/potted_plant_01/potted_plant_01.bin"
rm -rf "$TMP"

echo
echo "== 3) 텍스처 GLB 내장"
for d in "$MODELS"/*/; do
  n="$(basename "$d")"
  [ -f "$d/$n.gltf" ] || continue
  cp -n "$d/$n.gltf" "$d/$n.gltf.bak" 2>/dev/null || true
done
# --webp: 종류별 품질 게이트를 통과하고 원본보다 작을 때만 WebP 로 바꾼다.
# 게이트를 못 넘으면 원본 JPEG 을 그대로 내장한다 (노멀맵이 주로 그렇다).
"$PY" "$TOOLS/pack_props.py" "$MODELS" ${PACK_ARGS:---webp}

echo
echo "== 4) 내장 끝난 외부 리소스 정리 (전체 백업에 남아 있다)"
for d in "$MODELS"/*/; do
  n="$(basename "$d")"
  [ -f "$d/$n.gltf" ] || continue
  head -c4 "$d/$n.gltf" | grep -qa glTF || { echo "  $n: GLB 아님 — 정리 생략"; continue; }
  rm -rf "$d/textures" "$d/$n.bin"
  echo "  $n: textures/ + .bin 제거"
done

echo
echo "완료. 되돌리려면: tar -xzf $BACKUP/models_before.tar.gz -C $(dirname "$MODELS")"
