#!/usr/bin/env python3
"""아바타 GLB 내장 텍스처만 재인코딩한다. 지오메트리·모프타깃·이름은 건드리지 않는다.

측정으로 드러난 사실 (mh_* 21종 기준):
  내장 이미지 144.5MB 중
    옷·헤어 normalTexture  2048²  51장  99.9MB  ← 압도적 1위
    옷·헤어 baseColor      2048²  57장  23.4MB
    얼굴 계열 전부                        16.1MB
  즉 **옷·헤어가 128.5MB, 얼굴은 16.1MB** 다.
  그래서 옷·헤어는 과감하게, 얼굴은 보수적으로 다룬다.
  (결막·공막·혀 진찰이 근접 촬영이라 얼굴 해상도를 낮추면 바로 티가 난다)

기본 정책:
  얼굴 계열   : 해상도 유지, 재인코딩도 게이트를 통과할 때만
  옷·헤어     : 2048² -> 1024² 다운스케일 + WebP
  노멀맵      : 크로마 서브샘플링에 취약하므로 near-lossless 만 쓴다
                (webp_smart.py 와 같은 방침 — 손실 모드는 라이팅을 실제로 틀어놓는다)

사용:
  python compress_avatar_tex.py <in.glb> <out.glb> [--face-max 2048] [--other-max 1024] [--dry-run]
"""
from __future__ import annotations

import argparse
import io
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import gltf_kit as gk

# 얼굴/구강/눈 계열 재질 — 근접 진찰 대상이라 보호한다
FACE_HINTS = ("skin", "teeth", "tongue", "eye", "eyelash", "eyebrow",
              "high-poly", "head", "face", "body")

# (최소 PSNR, 최대 픽셀오차) — 얼굴은 더 엄격하게
GATE_FACE = {"normal": (42.0, 3), "other": (42.0, 24)}
GATE_REST = {"normal": (38.0, 6), "other": (36.0, 60)}

# 2048² 를 15장씩 돌리므로 인코딩 속도가 실제 제약이다.
# -z 9 무손실은 장당 수십 초라 뺐다 (사진 텍스처에선 어차피 원본보다 커진다).
# -m 4 로 낮춰도 크기 차이는 1% 미만이었다.
# 노멀맵: 얼굴은 near-lossless 만. 옷·헤어는 손실도 후보에 넣고 게이트로 거른다
# (옷 노멀맵이 이미지 바이트의 69% 라 여기서 안 줄이면 의미가 없다).
CANDS_NORMAL = [("nl60", ["-q", "100", "-near_lossless", "60", "-sharp_yuv"]),
                ("nl40", ["-q", "100", "-near_lossless", "40", "-sharp_yuv"])]
CANDS_NORMAL_LOSSY = CANDS_NORMAL + [("q95", ["-q", "95", "-sharp_yuv"]),
                                     ("q90", ["-q", "90", "-sharp_yuv"])]
CANDS_OTHER = [("q90", ["-q", "90", "-sharp_yuv"]),
               ("q82", ["-q", "82", "-sharp_yuv"]),
               ("q74", ["-q", "74", "-sharp_yuv"])]

SLOTS = [
    ("baseColorTexture", lambda m: m.get("pbrMetallicRoughness", {}).get("baseColorTexture")),
    ("metallicRoughnessTexture", lambda m: m.get("pbrMetallicRoughness", {}).get("metallicRoughnessTexture")),
    ("normalTexture", lambda m: m.get("normalTexture")),
    ("occlusionTexture", lambda m: m.get("occlusionTexture")),
    ("emissiveTexture", lambda m: m.get("emissiveTexture")),
]


def image_usage(g: dict):
    """image 인덱스 -> [(재질명, 슬롯)]"""
    use: dict[int, list] = {}
    for mi, m in enumerate(g.get("materials", [])):
        for slot, get in SLOTS:
            t = get(m)
            if not t:
                continue
            tex = g["textures"][t["index"]]
            src = tex.get("source")
            if src is None:
                for v in (tex.get("extensions") or {}).values():
                    if isinstance(v, dict) and "source" in v:
                        src = v["source"]
            if src is not None:
                use.setdefault(src, []).append((m.get("name", f"mat{mi}"), slot))
    return use


def psnr_delta(a: Image.Image, b: Image.Image):
    """코덱 손실만 측정한다. 알파가 있으면 **보이는 픽셀만** 본다.

    완전 투명한 영역의 RGB 는 정의되지 않은 값이라 코덱이 마음대로 바꾼다.
    거기까지 세면 머리카락·옷 같은 알파 텍스처가 maxΔ 255 로 무조건 탈락한다
    (실제로 1차 시도에서 헤어 362K·청바지 598K 가 그렇게 떨어졌다).
    보이지 않는 픽셀은 품질과 무관하므로 알파로 마스킹해서 비교한다.
    """
    if b.size != a.size:
        b = b.resize(a.size, Image.LANCZOS)
    x = np.asarray(a.convert("RGBA"), dtype=np.float64)
    y = np.asarray(b.convert("RGBA"), dtype=np.float64)

    # 완전 불투명한 픽셀만 색을 비교한다. 반투명 경계 픽셀은 어차피 배경과 섞이고,
    # 그 RGB 는 코덱이 자유롭게 바꿀 수 있는 값이라 품질 지표가 못 된다.
    vis = x[..., 3] > 250
    if not vis.any():
        vis = x[..., 3] > 8
    if not vis.any():
        vis = np.ones(x.shape[:2], dtype=bool)

    d_rgb = np.abs(x[..., :3] - y[..., :3])[vis]
    d_a = np.abs(x[..., 3] - y[..., 3])
    mse = float(np.mean(d_rgb ** 2))
    p = float("inf") if mse == 0 else 10 * math.log10(255.0 ** 2 / mse)
    # 단일 최악 픽셀 대신 99.9 백분위를 쓴다. 절대 최대값은 이상치 한 점에
    # 좌우돼서, 44dB 짜리 멀쩡한 결과가 픽셀 하나 때문에 탈락한다.
    # 코덱이 전반적으로 망가뜨리면 백분위도 같이 올라가므로 판별력은 유지된다.
    d = max(float(np.percentile(d_rgb, 99.9)) if d_rgb.size else 0.0,
            float(np.percentile(d_a, 99.9)))
    return p, int(round(d))


def encode(src_png: Path, out: Path, args, has_alpha: bool):
    cmd = ["cwebp", "-quiet", "-mt", "-m", "4", "-metadata", "none"]
    if has_alpha:
        cmd += ["-alpha_q", "100"]
    cmd += [*args, str(src_png), "-o", str(out)]
    subprocess.run(cmd, check=True, capture_output=True)
    return out.stat().st_size


def process_image(pil: Image.Image, orig_bytes: int, is_face: bool, is_normal: bool,
                  max_side: int, tmp: Path, tag: str):
    """(새 바이트, mime, 설명) 또는 None(원본 유지).

    두 결정을 분리한다:
      ① 해상도  — 정책이다. 옷·헤어는 1024² 로 내린다. 이건 픽셀 델타로 판정할 수 없다
                 (1024→2048 확대본을 원본과 비교하면 고주파에서 무조건 크게 어긋난다).
                 실제 판정은 **근접 렌더 육안 확인**이 한다.
      ② 코덱 손실 — 이건 델타로 판정한다. 단 비교 기준은 원본이 아니라
                 **같은 해상도로 리샘플한 참조본**이다. 그래야 코덱 손실만 측정된다.
    """
    gate = (GATE_FACE if is_face else GATE_REST)["normal" if is_normal else "other"]
    min_psnr, max_d = gate

    ref0 = pil.convert("RGBA" if "A" in pil.mode else "RGB")
    has_alpha = "A" in ref0.mode

    if max(ref0.size) > max_side:
        s = max_side / max(ref0.size)
        size = (max(1, int(ref0.width * s)), max(1, int(ref0.height * s)))
        ref = ref0.resize(size, Image.LANCZOS)
        scaled = True
    else:
        ref, size, scaled = ref0, ref0.size, False

    src = tmp / f"{tag}_{size[0]}.png"
    ref.save(src)

    if is_normal:
        cands = CANDS_NORMAL if is_face else CANDS_NORMAL_LOSSY
    else:
        cands = CANDS_OTHER

    best = None
    for label, args in cands:
        dst = tmp / f"{tag}_{size[0]}_{label}.webp"
        try:
            sz = encode(src, dst, args, has_alpha)
        except (subprocess.CalledProcessError, FileNotFoundError):
            return None
        p, d = psnr_delta(ref, Image.open(dst))      # 같은 해상도끼리 비교
        ok = p == float("inf") or (p >= min_psnr and d <= max_d)
        if ok and sz < orig_bytes and (best is None or sz < best[0]):
            ps = "lossless" if p == float("inf") else f"{p:.1f}dB"
            tag_sz = f"{ref0.width}²→{size[0]}²" if scaled else f"{size[0]}²"
            best = (sz, dst.read_bytes(), f"{tag_sz}/{label}/{ps}/Δ{d}")
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--face-max", type=int, default=2048, help="얼굴 계열 최대 변 길이")
    ap.add_argument("--other-max", type=int, default=1024, help="옷·헤어 최대 변 길이")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    src, dst = Path(a.src), Path(a.dst)
    doc = gk.load(src)
    g = doc.g
    use = image_usage(g)
    tmp = Path(tempfile.mkdtemp(prefix="avtex_"))

    repl, log = {}, []
    before_img = after_img = 0
    for i in range(len(g.get("images", []))):
        try:
            data, mime, name = doc.image_bytes(i)
        except Exception:
            # 외부 uri 가 깨져 있는 자산이 있다 (윈도우 절대경로가 그대로 박힘).
            # 원본을 그대로 두고 넘어간다 — 우리가 만든 문제가 아니다.
            ref = g["images"][i].get("uri") or g["images"][i].get("name") or f"image{i}"
            log.append(f"  [{i:2d}] 외부참조 깨짐 — 건너뜀: {str(ref)[:60]}")
            continue
        before_img += len(data)
        mats = use.get(i, [])
        is_face = any(any(h in m.lower() for h in FACE_HINTS) for m, _ in mats)
        is_normal = any(s == "normalTexture" for _, s in mats)
        try:
            pil = Image.open(io.BytesIO(data))
            pil.load()
        except Exception:
            after_img += len(data)
            log.append(f"  [{i:2d}] 디코드 실패 — 원본 유지")
            continue

        r = process_image(pil, len(data), is_face, is_normal,
                          a.face_max if is_face else a.other_max, tmp, f"i{i}")
        kind = ("얼굴" if is_face else "옷") + ("/노멀" if is_normal else "")
        if r:
            sz, blob, desc = r
            repl[i] = (blob, "image/webp")
            after_img += sz
            log.append(f"  [{i:2d}] {kind:<7} {pil.width}² {len(data)/1024:>7.0f}K -> {sz/1024:>7.0f}K  {desc}")
        else:
            after_img += len(data)
            log.append(f"  [{i:2d}] {kind:<7} {pil.width}² {len(data)/1024:>7.0f}K    원본 유지(게이트 미통과)")

    doc.embed_images(replacements=repl or None)
    if any(im.get("mimeType") == "image/webp" for im in g.get("images", [])):
        ext = g.setdefault("extensionsUsed", [])
        if "EXT_texture_webp" not in ext:
            ext.append("EXT_texture_webp")
        widx = {i for i, im in enumerate(g["images"]) if im.get("mimeType") == "image/webp"}
        for tex in g.get("textures", []):
            if tex.get("source") in widx:
                tex.setdefault("extensions", {})["EXT_texture_webp"] = {"source": tex["source"]}

    # preserve_views=True 필수.
    # 이 아바타들은 KHR_draco_mesh_compression 을 쓴다. Draco 는 확장 안에서
    # bufferView 를 직접 가리키는데, 일반 repack 은 그 참조를 모르고 인덱스를
    # 재매핑해버려 지오메트리가 통째로 깨진다(160 -> 150 으로 줄며 실제로 깨졌다).
    doc.save_glb(dst, preserve_views=True)
    shutil.rmtree(tmp, ignore_errors=True)

    if not a.quiet:
        print("\n".join(log))
    print(f"{src.name}: 이미지 {before_img/1024/1024:.1f}MB -> {after_img/1024/1024:.1f}MB, "
          f"파일 {src.stat().st_size/1024/1024:.1f}MB -> {dst.stat().st_size/1024/1024:.1f}MB")


if __name__ == "__main__":
    main()
