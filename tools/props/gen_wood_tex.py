#!/usr/bin/env python3
"""설압자(birch tongue depressor) PBR 텍스처 생성.

실물 기준:
  - 자작나무(birch)/너도밤나무를 얇게 켜서 샌딩한 것. 결은 길이 방향으로 곧게 흐른다.
  - 색은 아주 옅은 크림-베이지. 대비가 낮다. 나뭇결이 강하면 합판/데크처럼 보인다.
  - 표면은 무광에 가깝지만 완전 무광은 아니다(샌딩된 목재 roughness 0.72~0.86).
  - 도관(pore)이 아주 미세하게 파여 있어 노멀 진폭은 극히 작다.

출력: basecolor / roughness / normal (PNG, 256x1024 — U=폭, V=길이)
"""
from __future__ import annotations
import numpy as np
from PIL import Image
import sys, os

# U = 스틱 폭(18mm), V = 스틱 길이(150mm).
# 1인칭 최근접(약 20cm)에서 폭 18mm 는 1920px 화면에서 약 170px 를 차지한다 → U=256 이면 충분.
# 결은 길이 방향으로 거의 변하지 않으므로 V 는 512 로 줄여도 육안 차이가 없다.
W, H = 256, 512
rng = np.random.default_rng(20260725)


def value_noise(w: int, h: int, sw: int, sh: int) -> np.ndarray:
    """저해상도 난수를 bicubic 업샘플한 value noise (0..1). V 방향으로 seamless."""
    g = rng.random((sh, sw)).astype(np.float32)
    g = np.vstack([g, g[:1]])          # V(세로) 순환 이음
    g = np.hstack([g, g[:, :1]])
    im = Image.fromarray((g * 255).astype(np.uint8), mode="L").resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def fbm(w: int, h: int, base_w: int, base_h: int, octaves: int = 4) -> np.ndarray:
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(w, h, max(2, base_w * 2 ** o), max(2, base_h * 2 ** o))
        tot += amp
        amp *= 0.5
    return out / tot


u = np.linspace(0.0, 1.0, W, endpoint=False)[None, :]     # 폭 방향
v = np.linspace(0.0, 1.0, H, endpoint=False)[:, None]     # 길이 방향

# ── 1. 결(grain) ──────────────────────────────────────────────────────────────
# 실물 자작 설압자는 폭 18mm 안에 나이테가 10~16개 정도 지나가고, 간격이 제각각이며
# 길이 방향으로는 거의 곧게 흐르되 아주 완만하게 휜다. 규칙적인 사인파로 만들면
# 코듀로이/바코드처럼 보이므로 **간격 자체를 노이즈로 흐트러뜨린다.**

# (a) 길이 방향 완만한 휨 — 진폭을 폭의 3% 이하로
wander = (fbm(W, H, 2, 4, 3) - 0.5) * 0.030

# (b) 나이테 위상: 기본 주기 + 저주파 1D 노이즈로 간격을 불균등하게
ring_jitter = (fbm(W, 8, 5, 1, 3)[0:1, :] - 0.5)          # x 방향만 변하는 1D 노이즈
ring_jitter = np.repeat(ring_jitter, H, axis=0)
N_RINGS = 13.0
phase = (u + wander) * N_RINGS + ring_jitter * 2.6

# (c) 각 나이테를 폭이 제각각인 어두운 선으로
frac = phase - np.floor(phase)
line_w = 0.16 + 0.20 * np.repeat((fbm(W, 8, 9, 1, 2)[0:1, :]), H, axis=0)   # 선 굵기 랜덤
d = np.minimum(frac, 1.0 - frac)                                            # 선 중심까지 거리
grain = np.clip(1.0 - d / np.maximum(line_w, 1e-4), 0.0, 1.0) ** 1.5

# (d) 선 하나하나의 진하기도 다르게 (연륜 조만기 차이)
line_amp = 0.45 + 0.55 * np.repeat((fbm(W, 8, 7, 1, 2)[0:1, :]), H, axis=0)
grain *= line_amp

# (e) 길이 방향으로 선이 끊기거나 흐려지는 구간
fade = 0.55 + 0.45 * fbm(W, H, 3, 5, 3)
grain *= fade
grain = np.clip(grain, 0.0, 1.0)

# ── 2. 길이 방향 미세 얼룩(색상 변주) + 도관 스페클 ──
blotch = fbm(W, H, 3, 6, 4)
speck = fbm(W, H, 64, 160, 2)

# ── 3. Base color ──
# 실물 자작 설압자를 사진에서 샘플하면 대략 #DAC49C ~ #BA9C73 범위다.
# 이보다 밝으면 뼈/플라스틱처럼 보이고, 더 붉으면 체리목처럼 보인다.
light = np.array([0.855, 0.769, 0.612], np.float32)   # #DAC49C
dark = np.array([0.729, 0.612, 0.451], np.float32)    # #BA9C73
t = np.clip(grain * 0.55 + (blotch - 0.5) * 0.30 + (speck - 0.5) * 0.08, 0.0, 1.0)
col = light[None, None, :] * (1.0 - t[..., None]) + dark[None, None, :] * t[..., None]

# 가장자리(폭 양끝)를 아주 약간 어둡게 — 톱날 절단면 + 손때
edge = np.clip((np.abs(u - 0.5) - 0.40) / 0.10, 0.0, 1.0)
col *= (1.0 - 0.085 * edge)[..., None]

# 스틱 끝단(길이 양끝) 살짝 어둡게 — 실제로 끝이 더 손을 탄다
tip = np.clip((np.abs(v - 0.5) - 0.435) / 0.065, 0.0, 1.0)
col *= (1.0 - 0.05 * tip)[..., None]

basecolor = np.clip(col, 0, 1)

# ── 4. Roughness — 결 라인(도관)이 더 거칠고, 샌딩면은 살짝 매끄럽다 ──
rough = 0.745 + 0.085 * grain + (blotch - 0.5) * 0.05 + (speck - 0.5) * 0.03
rough = np.clip(rough, 0.66, 0.90)

# ── 5. Normal — 결 라인이 미세하게 파인 정도. 진폭 극소 (샌딩된 면) ──
height = (1.0 - grain) * 0.55 + blotch * 0.30 + speck * 0.15
STRENGTH = 0.22   # 샌딩된 목재라 요철이 거의 없다. 크게 잡으면 골판지처럼 보인다
dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
nx, ny, nz = -dx * STRENGTH, -dy * STRENGTH, np.ones_like(dx)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5   # OpenGL(+Y up) 규약

out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(out_dir, exist_ok=True)


def save(arr, name, mode="RGB", half=False):
    a = (np.clip(arr, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    im = Image.fromarray(a, mode=mode)
    if half:
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    im.save(os.path.join(out_dir, name), optimize=True)
    print(f"  {name}: {im.size} {os.path.getsize(os.path.join(out_dir, name)):,} bytes")


save(basecolor, "td_basecolor.png")
# roughness 는 저주파라 절반 해상도로 충분하다 (glTF 는 metallicRoughness 로 합쳐 내보낸다)
save(rough, "td_rough.png", mode="L", half=True)
save(normal, "td_normal.png")
print("wood textures done")
