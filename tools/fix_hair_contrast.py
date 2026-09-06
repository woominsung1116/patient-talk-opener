#!/usr/bin/env python3
"""
헤어 텍스처 교정 — 밝기는 낮추고 **상대 대비는 따로 올린다**.

문제
  GoldenBlondHair 는 평균 휘도 155 에 std 4.9 → 상대 대비 3.2%.
  밝은 바탕에서 ±5 는 눈이 못 읽어서 수영모처럼 보인다.
  같은 정도의 ±6.5 라도 어두운 흑발(평균 23)에서는 28% 가 되어 또렷한 가닥이 된다.

  ⚠ 밝기만 낮추면 rel = std/mean 은 안 변한다(스케일 불변).
    선형 공간의 곱셈도 마찬가지다. 그래서 평균과 대비를 **분리해서** 지정한다.

전제 — 다섯 텍스처는 하나의 아틀라스다
  GoldenBlond / Ginger / StrawberryBlond / Auburn 은 알파 채널이 **비트 단위로 동일**하고
  BlackHair 도 2048 로 줄이면 알파 corr 0.9998 이다. 전부 같은 원본의 리컬러다.
  → 리컬러마다 남아있는 가닥 신호를 평균내 공용 구조장 S 를 만들고,
    거기에 목표 평균·대비·색조를 새로 입힌다. 리컬러가 뭉갠 정보를 서로 메운다.

  BlackHair 는 hf/std 가 0.195 로 혼자 낮다(나머지 전부 0.34~0.36, 기준 텍스처도 0.341).
  2048 원본을 3600 으로 업스케일하면서 고주파가 날아간 것이다.
  자기 자신을 증폭하면 가닥이 아니라 얼룩이 커진다 → 얘도 공용 구조장에서 다시 만든다.

  **알파는 원본 그대로 복사한다. 가닥 실루엣이 거기 있다.**

노년층
  f60·f70 을 새까맣게 만들면 나이가 지워진다. 균일한 회색으로 만들면 지금과 같은
  저대비 수영모가 된다. 그래서 **흰 가닥을 섞는다(salt-and-pepper)**.
  어느 가닥이 세는지는 S(가닥 패턴)가 정하고, 어디에 몰려서 세는지는 저주파 난수장이 정한다.
  흰 가닥은 대비를 **올린다** — 나이 표현과 가독성이 같은 방향이다.

  python3 tools/fix_hair_contrast.py                 # 생성 + 자체 측정
  python3 tools/fix_hair_contrast.py --preview       # 비교 스트립도 같이
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX = os.path.join(ROOT, 'frontend', 'lab', 'hair', 'tex')
OUT = os.path.join(ROOT, 'scratchpad', 'clinic_lab', 'avatars', 'hair_fixed')
LUMA = np.array([0.2126, 0.7152, 0.0722])

# 공용 구조장의 재료. 알파가 비트 단위로 동일한 리컬러들 = 같은 아틀라스.
FAMILY = ['AuburnHair', 'StrawberryBlondHair', 'GingerHair', 'GoldenBlondHair']
# 알파·해상도 기준. BlackHair(3600) 도 이 알파로 2048 에서 다시 만든다.
ALPHA_SRC = 'AuburnHair'

# 기준 텍스처 Hairblackseamless2png 의 채널비(R/G/B = 25.0/22.7/21.1, 휘도 23.05).
# 한국인 흑갈색 = 거의 중성에 살짝 따뜻한 쪽.
KOREAN_TINT = np.array([1.085, 0.985, 0.915])
GREY_TINT = np.array([1.015, 1.000, 0.985])

# mean/rel 은 **흰 가닥을 섞기 전 어두운 바탕**의 목표.
# 기준(좋은 예) Hairblackseamless2png = 평균 23.0 / rel 28.4% / hf_rel 9.5%.
TARGETS = {
    # 게임이 고령 헤어를 x0.729(f60)·x0.619(f70) 로 **어둡게** 곱한다(회색이 아니라 곱셈이다).
    # 그 손실을 흰 가닥 비율로 미리 갚아둔다 — 블렌드를 줄이면 이 값도 같이 낮춰야 한다.
    'GoldenBlondHair':     dict(avatars=['mh_f60', 'mh_f60_ob'], mean=24.0, rel=0.30, grey=0.22, grey_lum=190.0),
    'GingerHair':          dict(avatars=['mh_f70', 'mh_oldf'],   mean=24.0, rel=0.30, grey=0.34, grey_lum=200.0),
    'StrawberryBlondHair': dict(avatars=['mh_f50'],              mean=24.0, rel=0.29, grey=0.05, grey_lum=170.0),
    'AuburnHair':          dict(avatars=['mh_girl'],             mean=23.0, rel=0.29, grey=0.0,  grey_lum=0.0),
    'BlackHair':           dict(avatars=['mh_f20', 'mh_f40'],    mean=23.0, rel=0.29, grey=0.0,  grey_lum=0.0),
}

# 흰 가닥 내부에도 결은 남긴다. 완전히 평평하면 그것대로 수영모가 된다.
GREY_REL = 0.12


def load(name):
    return np.asarray(Image.open(os.path.join(TEX, name + '.webp')).convert('RGBA')).astype(np.float64)


def luma(rgb):
    return rgb @ LUMA


def rel_stats(L, mask):
    """rel = std/mean(상대 대비), hf_rel = 9px 저주파를 뺀 고주파의 상대 세기."""
    det = L - uniform_filter(L, size=9)
    m = L[mask].mean()
    return dict(mean=float(m), std=float(L[mask].std()), rel=float(L[mask].std() / max(m, 1e-6)),
                hf=float(det[mask].std()), hf_rel=float(det[mask].std() / max(m, 1e-6)))


def structure_field(mask):
    """리컬러들의 휘도 구조를 표준화해서 평균 → 리컬러별 압축 잡음은 상쇄되고
    공통 가닥 신호만 남는다. 마스크 안에서 평균 0 / std 1 로 정규화."""
    acc = None
    for n in FAMILY:
        L = luma(load(n)[:, :, :3])
        z = (L - L[mask].mean()) / max(L[mask].std(), 1e-6)
        acc = z if acc is None else acc + z
    S = acc / len(FAMILY)
    # 원본 GoldenBlond 는 마스크 안 휘도 레벨이 49단계뿐이다. 대비를 5.7배로 늘리면
    # webp 압축의 **가로 줄무늬**까지 같이 5.7배가 되어 정수리에 코듀로이 무늬가 뜬다.
    # 가닥은 X 로 변하고 압축 줄무늬는 Y 로 변한다 → **세로로만** 흐리면 줄무늬만 지워진다.
    S = gaussian_filter(S, (BAND_BLUR, 0.0))
    return (S - S[mask].mean()) / max(S[mask].std(), 1e-6)


# 이 아틀라스는 가닥이 **세로**다 — |dS/dx| / |dS/dy| = 4.5 이고 네 사분면 모두 같다.
# 그래서 흰 가닥은 세로로 길고 가로로 얇은 이방성 난수장으로 고른다.
# 등방성 난수로 고르면 머리카락이 아니라 얼룩이 진다(첫 시도가 그랬다 — 페인트 튄 것처럼 보였다).
# sigma_y 를 너무 키우면(140 이상) 흰 올이 위아래로 끊기지 않아서 가발 핀스트라이프가 된다.
# 60 정도면 올이 길이를 따라 나타났다 사라져서 실제 머리카락처럼 보인다.
# sigma_x 는 1.1 이면 올이 1텍셀이라 축소될 때 밉맵에서 뭉개지고 얼룩진다 → 2.0 으로 넓힌다.
SIGMA_Y, SIGMA_X = 60.0, 2.0
# 압축 가로줄 제거용 세로 블러. 가닥(X 변화)은 남기고 줄무늬(Y 변화)만 지운다.
BAND_BLUR = 2.0


def _strand_noise(shape, mask, seed):
    """가닥 한 올 단위의 세로 줄무늬 난수. 뿌리부터 끝까지 이어진다."""
    n = gaussian_filter(np.random.RandomState(seed).randn(*shape), (SIGMA_Y, SIGMA_X))
    return n / max(n[mask].std(), 1e-6)


def grey_weight(S, mask, frac, seed=7, clump=0.45, clump_scale=60.0, width=0.55):
    """흰 가닥 마스크. 세로 이방성 난수가 '어느 올이 세는가'를 정하고,
    저주파 등방성 난수를 조금 섞어 '어느 부위가 몰려 세는가'를 정한다."""
    if frac <= 0:
        return np.zeros(S.shape)
    region = gaussian_filter(np.random.RandomState(seed + 100).randn(*S.shape), clump_scale)
    sel = _strand_noise(S.shape, mask, seed) + clump * region / max(region[mask].std(), 1e-6)
    sel /= max(sel[mask].std(), 1e-6)
    lo, hi = float(sel[mask].min()) - 1.0, float(sel[mask].max()) + 1.0
    for _ in range(60):  # frac 만큼 세도록 임계값 이분탐색
        t = 0.5 * (lo + hi)
        w = np.clip((sel - t + width) / (2 * width), 0, 1)
        w = w * w * (3 - 2 * w)
        if w[mask].mean() > frac:
            lo = t
        else:
            hi = t
    return w


def grey_intensity(shape, mask, seed=7):
    """올마다 센 정도가 다르다 — 완전 백발도 있고 아직 덜 빠진 것도 있다.
    전부 같은 밝기로 세면 흰 줄무늬 가발이 된다."""
    return np.clip(0.55 + 0.45 * _strand_noise(shape, mask, seed + 200), 0.18, 1.0)


def solve_gain(S, mask, mean, rel):
    """L = mean*(1+g*S) 를 바닥에서 자르면 rel 이 목표보다 낮아진다 → g 를 이분탐색."""
    lo, hi = 0.0, 6.0
    for _ in range(60):
        g = 0.5 * (lo + hi)
        L = np.clip(mean * (1.0 + g * S), 1.0, None)
        if L[mask].std() / L[mask].mean() < rel:
            lo = g
        else:
            hi = g
    return 0.5 * (lo + hi)


def build(name, S, mask, alpha, spec):
    g = solve_gain(S, mask, spec['mean'], spec['rel'])
    dark = np.clip(spec['mean'] * (1.0 + g * S), 1.0, None)
    gw = grey_weight(S, mask, spec['grey'])
    if spec['grey'] > 0:
        light = np.clip(spec['grey_lum'] * grey_intensity(S.shape, mask) * (1.0 + GREY_REL * S), 1.0, None)
        L = dark * (1.0 - gw) + light * gw
    else:
        L = dark
    tint = KOREAN_TINT[None, None, :] * (1.0 - gw[:, :, None]) + GREY_TINT[None, None, :] * gw[:, :, None]
    rgb = np.clip(L[:, :, None] * tint, 0, 255)
    out = np.concatenate([rgb, alpha[:, :, None]], axis=2)
    return np.round(out).astype(np.uint8), g, float(gw[mask].mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--preview', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    base = load(ALPHA_SRC)
    alpha = base[:, :, 3]
    mask = alpha > 200
    S = structure_field(mask)

    ref = rel_stats(luma(load('Hairblackseamless2png')[:, :, :3]),
                    np.asarray(Image.open(os.path.join(TEX, 'Hairblackseamless2png.webp')).convert('RGBA'))[:, :, 3] > 200)
    print(f"기준(좋은 예) Hairblackseamless2png   평균{ref['mean']:6.1f}  rel{ref['rel']*100:6.2f}%  hf_rel{ref['hf_rel']*100:6.2f}%")
    print()
    print('텍스처                    쓰는 아바타          평균 전→후      rel 전→후          hf_rel 전→후      흰가닥')
    print('-' * 108)

    rows = []
    for name, spec in TARGETS.items():
        src = load(name)
        before = rel_stats(luma(src[:, :, :3]), (src[:, :, 3] > 200))
        img, g, gf = build(name, S, mask, alpha, spec)
        Image.fromarray(img).save(os.path.join(a.out, name + '.png'))
        after = rel_stats(luma(img[:, :, :3].astype(np.float64)), mask)
        print(f"{name:<24}  {','.join(spec['avatars']):<18} {before['mean']:6.1f}→{after['mean']:6.1f}  "
              f"{before['rel']*100:5.1f}%→{after['rel']*100:5.1f}%  "
              f"{before['hf_rel']*100:5.2f}%→{after['hf_rel']*100:5.2f}%  {gf*100:5.1f}%")
        rows.append(dict(tex=name, avatars=spec['avatars'], gain=round(g, 4), grey_frac=round(gf, 4),
                         size=list(img.shape[:2]), src_size=list(src.shape[:2]),
                         before={k: round(v, 4) for k, v in before.items()},
                         after={k: round(v, 4) for k, v in after.items()}))

    json.dump(dict(reference={k: round(v, 4) for k, v in ref.items()}, textures=rows),
              open(os.path.join(a.out, 'fix_report.json'), 'w'), ensure_ascii=False, indent=1)

    if a.preview:
        # 위=원본, 가운데=교정(1:1), 아래=교정을 1/4 로 줄인 것.
        # 문진 화면에서 헤어는 텍스처 1:1 로 안 보인다 — 줄여봐야 진짜 인상을 안다.
        x, y, n = 256, 256, 512
        def small(t):
            return np.asarray(Image.fromarray(t).resize((n // 4, n // 4), Image.LANCZOS).resize((n, n), Image.NEAREST))
        strips = []
        for name in list(TARGETS) + ['Hairblackseamless2png']:
            src = Image.open(os.path.join(TEX, name + '.webp')).convert('RGB')
            b = np.asarray(src if src.size[0] == 2048 else src.resize((2048, 2048)))[y:y + n, x:x + n]
            fp = os.path.join(a.out, name + '.png')
            f = np.asarray(Image.open(fp).convert('RGB'))[y:y + n, x:x + n] if os.path.exists(fp) else b
            strips.append(np.concatenate([b, f, small(f)], axis=0))
        p = os.path.join(a.out, '_preview.png')
        Image.fromarray(np.concatenate(strips, axis=1)).save(p)
        print(f'\n비교(위=원본 / 가운데=교정 / 아래=교정 1/4축소, 맨오른쪽 칸=기준 텍스처): {p}')

    print(f'\n→ {a.out}')


if __name__ == '__main__':
    main()
