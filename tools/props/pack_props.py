#!/usr/bin/env python3
"""외부 텍스처를 참조하는 .gltf 를 텍스처 내장 GLB 로 다시 쓴다.

왜:
  .gltf + .bin + 텍스처 N장 구조는 자산 하나당 요청이 5~8건이다. dev 서버에서
  여러 자산이 동시에 뜨면 그중 일부가 ERR_ABORTED 로 죽고, 그 자산만 텍스처 없는
  회색으로 나온다 (책장·화분이 그랬다). 요청을 1건으로 줄이면 경쟁 자체가 사라진다.

왜 확장자를 .gltf 로 두는가:
  씬 코드가 `/models/<name>/<name>.gltf` 로 로드한다 (ClinicScene.tsx:207).
  three.js GLTFLoader 는 확장자가 아니라 **매직바이트('glTF')** 로 GLB 를 판별하므로
  내용만 GLB 면 파일명은 .gltf 그대로여도 정상 동작한다. 씬 코드를 건드릴 필요가 없다.

WebP 재압축(--webp):
  텍스처 종류별 품질 게이트를 통과하고 원본 JPG 보다 작을 때만 바꾼다.
  노멀맵은 크로마 서브샘플링에 취약해 maxΔ 를 주 기준으로 쓴다 (webp_smart.py 와 동일 방침).
  WebP 를 쓰면 EXT_texture_webp 확장을 선언한다 (three.js r184 지원).

사용:
  python pack_props.py <models_dir> [--out DIR] [--webp] [--dry-run]
"""
from __future__ import annotations

import argparse
import math
import mimetypes
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import gltf_kit as gk

# 종류별 (최소 PSNR dB, 최대 픽셀 오차) — webp_smart.py 의 게이트를 그대로 쓴다
GATE = {"normal": (40.0, 4), "rough": (42.0, 16), "ao": (40.0, 20), "color": (38.0, 60)}
CANDS = {
    "normal": [("lossless", ["-lossless", "-z", "9"]),
               ("nl80", ["-q", "100", "-near_lossless", "80", "-sharp_yuv"]),
               ("nl60", ["-q", "100", "-near_lossless", "60", "-sharp_yuv"]),
               ("nl40", ["-q", "100", "-near_lossless", "40", "-sharp_yuv"])],
    "other": [("q95", ["-q", "95", "-sharp_yuv"]),
              ("q90", ["-q", "90", "-sharp_yuv"]),
              ("q85", ["-q", "85", "-sharp_yuv"]),
              ("q80", ["-q", "80", "-sharp_yuv"])],
}


def kind_of(name: str) -> str:
    b = name.lower()
    if "_nor" in b or "_normal" in b:
        return "normal"
    if "_rough" in b or "_arm" in b:      # ARM = AO/Rough/Metal 팩. 러프니스가 들어 있어 보수적으로.
        return "rough"
    if "_ao" in b:
        return "ao"
    return "color"


def measure(src: Path, out: Path):
    a = np.asarray(Image.open(src).convert("RGB"), dtype=np.float64)
    b = np.asarray(Image.open(out).convert("RGB"), dtype=np.float64)
    mse = float(np.mean((a - b) ** 2))
    psnr = float("inf") if mse == 0 else 10 * math.log10(255.0 ** 2 / mse)
    return psnr, int(np.max(np.abs(a - b)))


def best_webp(src: Path, tmp: Path, name: str):
    """게이트를 통과하면서 원본보다 작은 최소 후보. 없으면 None."""
    k = kind_of(name)
    min_psnr, max_d = GATE[k]
    orig = src.stat().st_size
    best = None
    for label, args in CANDS["normal" if k == "normal" else "other"]:
        dst = tmp / f"{name}.{label}.webp"
        try:
            subprocess.run(["cwebp", "-quiet", "-mt", "-m", "6", "-metadata", "none",
                            *args, str(src), "-o", str(dst)], check=True,
                           capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            return None
        psnr, d = measure(src, dst)
        sz = dst.stat().st_size
        ok = psnr == float("inf") or (psnr >= min_psnr and d <= max_d)
        if ok and sz < orig and (best is None or sz < best[1]):
            best = (label, sz, psnr, d, dst)
    return best


def pack_one(gltf: Path, out: Path, use_webp: bool, tmp: Path, rows: list):
    doc = gk.load(gltf)
    # 자산이 실제로 차지하는 디스크 = 자기 파일 + 외부 버퍼/이미지
    before = gltf.stat().st_size
    for b in doc.g.get("buffers", []):
        u = b.get("uri")
        if u and not u.startswith("data:"):
            before += (gltf.parent / u).stat().st_size
    for im in doc.g.get("images", []):
        u = im.get("uri")
        if u and not u.startswith("data:"):
            before += (gltf.parent / u).stat().st_size

    n_imgs = len(doc.g.get("images", []))
    repl, notes = {}, []
    if use_webp:
        for i in range(n_imgs):
            data, mime, name = doc.image_bytes(i)
            if mime == "image/webp":
                notes.append(f"{name}:이미webp")
                continue
            src = tmp / f"in_{i}_{Path(name).name}{mimetypes.guess_extension(mime) or '.png'}"
            src.write_bytes(data)
            b = best_webp(src, tmp, Path(name).stem)
            if b:
                label, sz, psnr, d, path = b
                repl[i] = (path.read_bytes(), "image/webp")
                ps = "lossless" if psnr == float("inf") else f"{psnr:.1f}dB"
                notes.append(f"{Path(name).stem}:{label}/{sz//1024}K/{ps}/Δ{d}")
            else:
                notes.append(f"{Path(name).stem}:원본유지")

    doc.embed_images(replacements=repl or None)

    # WebP 는 코어 스펙 밖이다. three.js 는 확장 없이도 blob 으로 디코드하지만
    # 스펙 검증기와 다른 로더를 위해 EXT_texture_webp 를 제대로 선언해 준다.
    webp_idx = {i for i, im in enumerate(doc.g.get("images", []))
                if im.get("mimeType") == "image/webp"}
    if webp_idx:
        ext = doc.g.setdefault("extensionsUsed", [])
        if "EXT_texture_webp" not in ext:
            ext.append("EXT_texture_webp")
        for tex in doc.g.get("textures", []):
            if tex.get("source") in webp_idx:
                tex.setdefault("extensions", {})["EXT_texture_webp"] = {"source": tex["source"]}

    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save_glb(out)
    rows.append((gltf.parent.name, before, out.stat().st_size, n_imgs, "; ".join(notes)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("models_dir")
    ap.add_argument("--out", default=None, help="미지정 시 원본 자리에 덮어쓴다")
    ap.add_argument("--webp", action="store_true")
    ap.add_argument("--only", default=None, help="쉼표로 자산 이름 제한")
    a = ap.parse_args()

    root = Path(a.models_dir)
    only = set(a.only.split(",")) if a.only else None
    tmp = Path(tempfile.mkdtemp(prefix="packprops_"))
    rows = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        if only and d.name not in only:
            continue
        gltf = d / f"{d.name}.gltf"
        if not gltf.exists():
            continue
        out = (Path(a.out) / d.name / gltf.name) if a.out else gltf
        pack_one(gltf, out, a.webp, tmp, rows)

    print(f"{'asset':<26}{'before':>10}{'after':>10}{'ratio':>8}{'imgs':>5}  detail")
    print("-" * 120)
    tb = ta = 0
    for name, b, af, n, note in rows:
        tb += b; ta += af
        print(f"{name:<26}{b/1024:>9.0f}K{af/1024:>9.0f}K{af/b*100:>7.1f}%{n:>5}  {note[:60]}")
    print("-" * 120)
    print(f"{'TOTAL':<26}{tb/1024/1024:>9.2f}M{ta/1024/1024:>9.2f}M{ta/max(tb,1)*100:>7.1f}%"
          f"   절감 {(tb-ta)/1024/1024:.2f} MB")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
