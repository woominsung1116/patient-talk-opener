#!/usr/bin/env python3
"""텍스처 JPG → WebP 변환기 (품질 게이트 방식).

핵심: cwebp 의 **손실 모드는 항상 YUV 4:2:0 크로마 서브샘플링**을 한다.
노멀맵은 방향 정보를 R/G 채널에 담고 있어 크로마가 뭉개지면 라이팅이 실제로 틀어진다.
(1차 시도에서 brown_planks 노멀맵이 q95 로도 PSNR 33.6dB / maxΔ 114 까지 망가졌다)

그래서 종류별 품질 기준을 정하고, **기준을 통과하는 것 중 가장 작은 후보**를 고른다.
기준을 통과하면서 원본 JPG 보다 작은 후보가 없으면 **WebP 를 만들지 않는다**(JPG 유지).
원본 JPG 는 절대 지우지 않는다.
"""
from __future__ import annotations
import os, glob, math, subprocess, tempfile, shutil
import numpy as np
from PIL import Image

DIR = "/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/public/textures"
TMP = tempfile.mkdtemp(prefix="webp_")

# 종류별 품질 게이트 (원본 JPG 대비) — (최소 PSNR, 최대 픽셀 오차)
#
# 주의: near-lossless 는 "오차 상한이 보장되는" 코덱이라 전역 PSNR 은 낮게 나오지만
# 최악 오차(maxΔ)는 아주 작다. 반대로 손실 모드(q95 등)는 PSNR 이 그럴듯해도
# 크로마 서브샘플링 때문에 국소적으로 maxΔ 100 이 넘게 터진다.
# → 노멀맵은 **maxΔ 를 주 기준**으로 삼는다. maxΔ 4/255 는 법선 각도로 약 1.8° 오차다.
GATE = {
    "normal": (40.0, 4),
    "rough":  (42.0, 16),
    "ao":     (40.0, 20),
    "color":  (38.0, 60),
}


def kind_of(base: str) -> str:
    b = base.lower()
    if "_nor" in b or "_normal" in b:
        return "normal"
    if "_rough" in b:
        return "rough"
    if "_ao" in b:
        return "ao"
    return "color"


def enc(src, dst, args):
    subprocess.run(["cwebp", "-quiet", "-mt", "-m", "6", "-metadata", "none",
                    *args, src, "-o", dst], check=True)
    return os.path.getsize(dst)


def quality(jpg, webp):
    a = np.asarray(Image.open(jpg).convert("RGB"), dtype=np.float64)
    b = np.asarray(Image.open(webp).convert("RGB"), dtype=np.float64)
    mse = float(np.mean((a - b) ** 2))
    psnr = float("inf") if mse == 0 else 10 * math.log10(255.0 ** 2 / mse)
    return psnr, int(np.max(np.abs(a - b)))


CANDIDATES = {
    # (라벨, cwebp 인자) — 작은 것부터가 아니라 다양하게 만들고 나서 고른다
    "normal": [("lossless", ["-lossless", "-z", "9"]),
               ("near_lossless80", ["-q", "100", "-near_lossless", "80", "-sharp_yuv"]),
               ("near_lossless60", ["-q", "100", "-near_lossless", "60", "-sharp_yuv"]),
               ("near_lossless40", ["-q", "100", "-near_lossless", "40", "-sharp_yuv"])],
    "other":  [("q97", ["-q", "97", "-sharp_yuv"]),
               ("q94", ["-q", "94", "-sharp_yuv"]),
               ("q90", ["-q", "90", "-sharp_yuv"]),
               ("q86", ["-q", "86", "-sharp_yuv"])],
}

rows = []
tot_j = tot_out = 0
for jpg in sorted(glob.glob(os.path.join(DIR, "*.jpg"))):
    base = os.path.splitext(os.path.basename(jpg))[0]
    k = kind_of(base)
    min_psnr, max_delta = GATE[k]
    js = os.path.getsize(jpg)
    cands = CANDIDATES["normal" if k == "normal" else "other"]

    best = None
    tried = []
    for label, args in cands:
        out = os.path.join(TMP, f"{base}.{label}.webp")
        try:
            sz = enc(jpg, out, args)
        except subprocess.CalledProcessError:
            continue
        psnr, md = quality(jpg, out)
        tried.append((label, sz, psnr, md))
        ok = (psnr >= min_psnr and md <= max_delta) or psnr == float("inf")
        if ok and sz < js and (best is None or sz < best[1]):
            best = (label, sz, psnr, md, out)

    dst = os.path.join(DIR, base + ".webp")
    if best:
        shutil.copyfile(best[4], dst)
        tot_j += js; tot_out += best[1]
        rows.append((base, k, best[0], js, best[1], best[2], best[3], "webp"))
    else:
        if os.path.exists(dst):
            os.remove(dst)
        tot_j += js; tot_out += js
        detail = " | ".join(f"{l}:{s//1024}K/{p:.1f}dB/Δ{d}" for l, s, p, d in tried)
        rows.append((base, k, "-", js, js, float("nan"), -1, "KEEP JPG"))
        print(f"  ! {base}: 기준({min_psnr}dB/Δ{max_delta}) 통과하며 JPG보다 작은 후보 없음 → {detail}")

rows.sort(key=lambda r: -r[3])
print()
print(f"{'file':<36}{'kind':<8}{'mode':<18}{'JPG':>9}{'out':>9}{'ratio':>8}{'PSNR':>9}{'maxΔ':>6}  note")
print("-" * 115)
for base, k, mode, js, os_, psnr, md, note in rows:
    ps = "lossless" if psnr == float("inf") else ("-" if psnr != psnr else f"{psnr:.1f}dB")
    print(f"{base:<36}{k:<8}{mode:<18}{js/1024:>8.0f}K{os_/1024:>8.0f}K"
          f"{os_/js*100:>7.1f}%{ps:>9}{md:>6}  {'' if note=='webp' else note}")
print("-" * 115)
print(f"{'TOTAL (전송되는 쪽)':<62}{tot_j/1024/1024:>8.2f}M{tot_out/1024/1024:>8.2f}M"
      f"{tot_out/tot_j*100:>7.1f}%   절감 {(tot_j-tot_out)/1024/1024:.2f} MB")
shutil.rmtree(TMP, ignore_errors=True)
