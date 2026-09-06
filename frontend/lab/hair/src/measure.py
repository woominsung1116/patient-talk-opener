#!/usr/bin/env python3
"""
헤어 텍스처 대비 측정 — **메시가 실제로 쓰는 UV 영역**만 잰다.

지표
  rel     = std/mean        상대 대비. 사람 눈은 절대 std가 아니라 이 비율을 읽는다.
  hf_rel  = HF_std/mean     9px 저주파를 뺀 고주파의 상대 세기 = '가닥이 보이는가'.
            평균만 낮추고 hf_rel이 안 오르면 색만 어두워지고 여전히 수영모다.

  python3 measure.py                      # 원본
  python3 measure.py --tex out/fixed      # 교정본으로 대체 측정
  python3 measure.py --pipeline           # 게임 파이프라인(회색블렌드+톤매핑) 통과 후 측정
"""
import argparse
import json
import os
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(HERE, '..', 'out', 'uvdump')
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)

# avatarVariant.ts 기준: pickAvatarVariant가 실제로 반환할 수 있는 아바타
ROTATION = ['mh_m20', 'mh_f20', 'mh_m30', 'mh_f30', 'mh_m40', 'mh_f40',
            'mh_m50', 'mh_f50', 'mh_m60', 'mh_f60', 'mh_m70', 'mh_f70',
            'mh_f60_ob', 'mh_f30_thin', 'mh_f20_thin', 'mh_boy', 'mh_girl']


def uv_mask(uv, tris, w, h):
    """UV 삼각형을 텍셀 그리드에 채운다 (three.js 규약: py = (1-v)*h)."""
    m = np.zeros((h, w), dtype=bool)
    px = np.clip(uv[:, 0], 0, 1) * (w - 1)
    py = (1.0 - np.clip(uv[:, 1], 0, 1)) * (h - 1)
    for a, b, c in tris:
        xs = np.array([px[a], px[b], px[c]])
        ys = np.array([py[a], py[b], py[c]])
        x0, x1 = int(np.floor(xs.min())), int(np.ceil(xs.max()))
        y0, y1 = int(np.floor(ys.min())), int(np.ceil(ys.max()))
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, w - 1), min(y1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(d) < 1e-9:
            m[y0:y1 + 1, x0:x1 + 1] = True
            continue
        l0 = ((ys[1] - ys[2]) * (xx - xs[2]) + (xs[2] - xs[1]) * (yy - ys[2])) / d
        l1 = ((ys[2] - ys[0]) * (xx - xs[2]) + (xs[0] - xs[2]) * (yy - ys[2])) / d
        m[y0:y1 + 1, x0:x1 + 1] |= (l0 >= -0.03) & (l1 >= -0.03) & (l0 + l1 <= 1.03)
    return m


def stats(rgb, mask):
    L = rgb @ LUMA
    if mask.sum() < 500:
        return None
    det = L - uniform_filter(L, size=9)
    mean = float(L[mask].mean())
    return dict(mean=mean, std=float(L[mask].std()), rel=float(L[mask].std() / max(mean, 1e-6)),
                hf=float(det[mask].std()), hf_rel=float(det[mask].std() / max(mean, 1e-6)),
                px=int(mask.sum()))


# ── 게임 파이프라인 시뮬레이션 ────────────────────────────────────────────────
# RealisticPatient.tsx:2410-2415 의 헤어 머티리얼 처리 + 렌더러 톤매핑.
def age_factor(variant, chrono=None):
    """variantAgeFactor(RealisticPatient.tsx:314)"""
    if chrono is not None:
        return 0.0 if chrono < 16 else min(1.0, max(0.0, (chrono - 20) / 50))
    if 'boy' in variant or 'girl' in variant:
        return 0.0
    if 'old' in variant:
        return 1.0
    if 'young' in variant:
        return 0.18
    import re
    m = re.search(r'([2-7])0', variant)
    return min(1.0, max(0.0, ((int(m.group(0)) if m else 35) - 20) / 50))


def smoothstep(x, e0, e1):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055) * 255.0


# three.js ACESFilmicToneMapping (tonemapping_pars_fragment.glsl.js) — 행렬까지 그대로.
# 게임은 postprocessing 의 <ToneMapping mode={ACES_FILMIC}/> 를 쓰는데, 그 셰이더도
# three 의 <tonemapping_pars_fragment> 를 include 하므로 같은 함수다(ClinicScene.tsx:3991).
ACES_IN = np.array([[0.59719, 0.35458, 0.04823],
                    [0.07600, 0.90834, 0.01566],
                    [0.02840, 0.13383, 0.83777]])
ACES_OUT = np.array([[1.60475, -0.53108, -0.07367],
                     [-0.10208, 1.10813, -0.00605],
                     [-0.00327, -0.07276, 1.07602]])


def aces_filmic(c, exposure=1.0):
    c = c * (exposure / 0.6)
    c = c @ ACES_IN.T
    c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081)
    return np.clip(c @ ACES_OUT.T, 0, 1)


def game_pipeline(rgb, variant, exposure=1.0, chrono=None):
    """텍스처 RGB(0-255 sRGB) → 회색블렌드 곱 → 조명 → ACES → sRGB 인코딩(0-255).
    조명은 스칼라 light 로 근사한다. 선형 공간의 곱셈은 상대 대비를 보존하므로
    **대비를 실제로 바꾸는 것은 톤매핑 커브의 비선형성뿐이다.**"""
    age = age_factor(variant, chrono)
    grey = float(smoothstep(age, 0.42, 1.0)) * 0.62
    grey_lin = srgb_to_lin(np.array([0xAA, 0xA6, 0xA4], dtype=np.float64))
    tint = (1.0 - grey) * 1.0 + grey * grey_lin          # mat.color.lerp(#aaa6a4, greyBlend*0.62)
    lin = srgb_to_lin(rgb.astype(np.float64)) * tint[None, None, :]
    return lin_to_srgb(aces_filmic(lin, exposure)), grey


def load_prims(only=None):
    man = json.load(open(os.path.join(DUMP, 'manifest.json')))
    if only:
        man = [m for m in man if m['avatar'] in only]
    return man


def prim_data(rec, tex_dir=None):
    uv = np.fromfile(os.path.join(DUMP, rec['key'] + '.uv.bin'), dtype=np.float32).reshape(-1, 2).astype(np.float64)
    tris = np.fromfile(os.path.join(DUMP, rec['key'] + '.idx.bin'), dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    src = None
    if tex_dir:
        alt = os.path.join(tex_dir, rec['tex'] + '.png')
        if os.path.exists(alt):
            src = alt
    if src is None:
        for e in ('.webp', '.png', '.jpg'):
            p = os.path.join(DUMP, rec['tex'] + e)
            if os.path.exists(p):
                src = p
                break
    if src is None:
        return None
    img = np.asarray(Image.open(src).convert('RGBA')).astype(np.float64)
    return uv, tris, img, src


_MASKS = {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tex', default=None)
    ap.add_argument('--only', default=None)
    ap.add_argument('--pipeline', action='store_true', help='회색블렌드+ACES 통과 후 측정')
    ap.add_argument('--exposure', type=float, default=1.0)
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    only = a.only.split(',') if a.only else ROTATION
    rows = []
    hdr = 'avatar          texture                tris   UV사용    평균     std   상대대비  HF/평균'
    if a.pipeline:
        hdr += '  grey'
    print(hdr)
    print('-' * (len(hdr) + 6))
    for rec in load_prims(only):
        d = prim_data(rec, a.tex)
        if d is None:
            print(f"{rec['avatar']:<15}{str(rec['tex']):<22} 텍스처 없음")
            continue
        uv, tris, img, src = d
        h, w = img.shape[:2]
        k = (rec['key'], w, h)
        if k not in _MASKS:
            _MASKS[k] = uv_mask(uv, tris, w, h)
        mask = _MASKS[k] & (img[:, :, 3] > 200)
        rgb = img[:, :, :3]
        grey = 0.0
        if a.pipeline:
            rgb, grey = game_pipeline(rgb, rec['avatar'], a.exposure)
        s = stats(rgb, mask)
        if not s:
            print(f"{rec['avatar']:<15}{rec['tex']:<22} 마스크 부족")
            continue
        line = (f"{rec['avatar']:<15}{rec['tex']:<22}{rec['tris']:>6}{_MASKS[k].mean()*100:>7.1f}%"
                f"{s['mean']:>8.1f}{s['std']:>8.1f}{s['rel']*100:>8.1f}%{s['hf_rel']*100:>8.2f}%")
        if a.pipeline:
            line += f"{grey:>6.2f}"
        print(line)
        rows.append(dict(avatar=rec['avatar'], tex=rec['tex'], tris=rec['tris'], grey=grey,
                         **{k2: round(v, 4) for k2, v in s.items()}))
    if a.json:
        json.dump(rows, open(a.json, 'w'), ensure_ascii=False, indent=1)
    return rows


if __name__ == '__main__':
    main()
