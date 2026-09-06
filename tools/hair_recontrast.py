#!/usr/bin/env python3
"""
헤어 텍스처 교정 — 한국인 기준 머리색으로 옮기면서 **가닥 대비를 복원**한다.

왜 필요한가 (실측 근거)
  진단에서 확인된 원인은 "텍스처 없음"도 "알파"도 아니고 **상대 대비**였다.
  mh_f60_ob 의 GoldenBlondHair 는 평균 휘도 155 / 표준편차 4.9 = 상대 대비 3.2%.
  기준이 되는 mh_f20_thin 의 Hairblackseamless2png 는 23.1 / 6.3 = 27.5%.
  절대 표준편차는 비슷한데(4.9 vs 6.3) 밝은 바탕 위의 ±5 는 눈이 못 읽는다.

  게다가 게임은 ACES 필믹 톤매핑을 쓴다. 휘도 155 는 커브의 **어깨**(압축 구간)에 얹혀
  화면에서는 대비가 3.2% → 1.0%(노출 4배 기준)까지 더 깎인다. 반대로 어두운 텍스처는
  커브의 **발끝**(확장 구간)에 얹혀 27.5% → 39% 로 오히려 늘어난다.
  → **어둡게 옮기는 것만으로 대비가 두 번 이득이다.** 셰이더를 고치는 것보다 근본적이다.

무엇을 하는가
  1) 휘도를 [3, 7, 17, 41]px 대역으로 분해한다. 사람이 '가닥'으로 읽는 건 7~41px 대역이다.
  2) 각 대역을 **기준 텍스처의 대역 프로파일**에 맞춰 증폭한다.
     밝기만 낮추면 대비도 같이 낮아진다 — 그래서 평균과 대비를 따로 제어한다.
  3) 목표 평균으로 옮기고, 한국인 기준 어두운 갈흑색 색조를 곱한다.
  4) 노년 아바타에는 회끗한 흰 가닥(salt-and-pepper)을 **다발 굵기**로 섞는다.
     균일한 회색이 아니라 성긴 줄기여야 대비가 **올라간다**.

⚠ 알파 채널은 바이트 단위로 그대로 복사한다 — 가닥 실루엣이 거기 들어 있다.
⚠ GLB 는 절대 건드리지 않는다. 추출된 텍스처를 읽어 교정본 PNG 를 따로 내놓을 뿐이다.

사용
  python3 tools/hair_recontrast.py <입력_텍스처_디렉터리> <출력_디렉터리> [--only NAME,NAME]

  입력 디렉터리에는 GLB 에서 뽑은 원본 텍스처(<이름>.webp 또는 .png)가 있어야 한다.
  추출: node frontend/lab/hair/src/dump_hair_uv.mjs <출력디렉터리>
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)

# 사람이 가닥으로 읽는 공간 주파수 대역 (2048px 텍스처의 텍셀 단위)
BANDS = (3, 7, 17, 41)

# 기준 = mh_f20_thin 의 Hairblackseamless2png. 이 아바타 머리만 '진짜 머리'로 보인다.
# 값은 평균 휘도 대비 각 대역 표준편차의 백분율(측정치).
REF_BANDS = np.array([3.04, 5.38, 8.96, 10.00])
REF_LF = 18.32

SILVER_RGB = np.array([0.74, 0.73, 0.715])   # 흰머리는 순백이 아니라 회백색이다

# ── 텍스처별 설정 ────────────────────────────────────────────────────────────
#  tint   목표 머리색. None 이면 원래 색조를 유지한다(이미 한국인 머리색인 경우).
#  mean   목표 평균 휘도(sRGB 0-255). 게임이 mat.color 로 어둡게 곱하므로
#         고령 아바타일수록 높게 잡아야 화면에서 같은 밝기가 된다.
#         (f70 은 mat.color 가 선형 0.63 배 → 텍스처를 1.6배 밝게 잡아야 상쇄된다)
#  amp    기준 대역 프로파일 대비 목표 배율. 1.0 = 기준과 동일한 가닥 세기.
#  gmax   대역별 증폭 상한. 손상된(압축 블록) 텍스처는 낮게 잡아 블록을 안 키운다.
#  silver 흰 가닥이 차지할 컬럼 비율. 0 이면 넣지 않는다.
#  note   왜 이 값인지
CONFIG = {
    'GoldenBlondHair': dict(
        tint='#2c2521', mean=44, amp=0.95, gmax=(6.0, 9.0, 12.0, 16.0), silver=0.16,
        avatars='mh_f60(60대), mh_f60_ob(60대)',
        note='최악(3.2%/HF 1.12%). 정규화해 보면 가는 세로 가닥이 실제로 살아 있어 증폭으로 복원된다.'),
    'GingerHair': dict(
        tint='#2e2621', mean=50, amp=0.95, gmax=(6.0, 8.0, 10.0, 12.0), silver=0.22,
        avatars='mh_f70(70대), mh_oldf(레거시)',
        note='7.9%/HF 2.77%. 70대라 흰 가닥을 더 넣는다 — 대비가 같이 올라간다.'),
    'StrawberryBlondHair': dict(
        tint='#2b2320', mean=34, amp=0.95, gmax=(3.0, 3.0, 3.0, 4.0), silver=0.05,
        avatars='mh_f50(50대)',
        note='대비 25.8%/HF 9.02% 로 이미 양호. 색조만 바꾸고 대역은 살짝 다듬는다.'),
    'AuburnHair': dict(
        tint='#241d1a', mean=24, amp=1.0, gmax=(2.0, 2.0, 2.0, 2.5), silver=0.0,
        avatars='mh_girl(아동)',
        note='대비 26.5%/HF 9.09% 로 양호. 붉은 기만 빼 한국 아동 머리색으로 옮긴다.'),
    'BlackHair': dict(
        tint='#26201d', mean=30, amp=0.95, gmax=(1.6, 2.2, 5.0, 6.0), silver=0.0,
        donor='Hairblackseamless2png', donor_gain=0.85,
        avatars='mh_f20(20대), mh_f40(40대)',
        note='색은 이미 검지만 HF 2.36% 로 가닥이 없다. 자체 디테일은 webp 압축 블록이라 '
             '3~7px 증폭 상한을 낮게 걸고, 부족분은 기준 텍스처의 가닥층을 이식해 채운다.'),
    'short02_diffuse': dict(
        tint='#2a221e', mean=40, amp=1.0, gmax=(1.5, 1.5, 1.5, 1.5), silver=0.0,
        avatars='mh_m30(30대)',
        note='대비 22.4%/HF 13.96% 로 좋다. 색이 밝은 갈색이라 한국인 설정과 안 맞아 색조만 바꾼다.'),
    'elvs_grumphair': dict(
        tint='#2f2823', mean=52, amp=0.95, gmax=(6.0, 8.0, 10.0, 12.0), silver=0.30,
        avatars='mh_oldm(레거시)',
        note='3.7%/HF 1.07%. GoldenBlond 와 같은 부류. 레거시라 로테이션에는 안 쓰인다.'),
    'maxhairtex6': dict(
        tint=None, mean=17, amp=0.8, gmax=(2.5, 3.5, 4.0, 4.0), silver=0.0,
        avatars='mh_m20(20대), mh_m50(50대)',
        note='이미 검다(28.1%). 다만 HF 3.04% 로 가닥이 약하고 메시가 1,468 tri 로 전체 최저다. '
             '색은 그대로 두고 중간대역만 올린다.'),
    'ponytail01_diffuse': dict(
        tint=None, mean=25, amp=0.8, gmax=(2.5, 3.5, 4.0, 4.0), silver=0.0,
        avatars='mh_f30(30대), mh_f30_thin(30대)',
        note='이미 검다(28.7%). HF 3.69% 라 중간대역만 올린다.'),
}


def bands_of(L):
    """휘도를 대역으로 분해한다. 반환: (detail 리스트, 최저주파 잔차)"""
    out, prev = [], L
    for b in BANDS:
        blur = uniform_filter(L, size=b)
        out.append(prev - blur)
        prev = blur
    return out, prev


def profile(L, mask):
    """평균 대비 각 대역 표준편차(%). 측정과 목표를 같은 단위로 쓰기 위한 함수."""
    mean = float(L[mask].mean())
    det, lf = bands_of(L)
    return mean, np.array([float(d[mask].std()) / mean * 100 for d in det]), float(lf[mask].std()) / mean * 100


def stats(rgb, mask):
    L = np.ascontiguousarray(rgb) @ LUMA
    mean = float(L[mask].mean())
    hf = float((L - uniform_filter(L, size=9))[mask].std())
    return dict(mean=mean, std=float(L[mask].std()), rel=float(L[mask].std()) / mean,
                hf=hf, hf_rel=hf / mean)


def silver_streaks(shape, frac, seed):
    """흰 가닥 마스크. **다발 굵기(수 텍셀)** 의 세로 줄기로 만든다.

    한 올 단위로 뿌리면 렌더 때 픽셀 아래로 뭉개져 균일한 회색이 되고,
    반대로 통째로 넓게 칠하면 하드에지 흰 줄무늬가 되어 니트 비니처럼 보인다
    (RealisticPatient.tsx:2492 주석의 mh_m60·mh_m70 지적이 그 실패다).
    """
    h, w = shape
    rng = np.random.default_rng(seed)
    col = (rng.random(w) < frac / 6.0).astype(np.float64)      # 시작점을 성기게
    col = uniform_filter(col, size=7)                          # 다발 굵기 ~7텍셀
    col = col / max(col.max(), 1e-6)
    y = np.linspace(0, 1, h)[:, None]
    # 세로로 끊기게 — 뿌리부터 끝까지 이어진 줄은 가발 심처럼 보인다
    fade = 0.35 + 0.65 * (0.5 + 0.5 * np.sin(y * 21.0 + rng.random() * 6.28)) \
        * (0.5 + 0.5 * np.sin(y * 6.3 + rng.random() * 6.28))
    m = col[None, :] * fade
    m *= uniform_filter(rng.random((h, w)), size=3) * 0.8 + 0.4
    return np.clip(m / max(m.max(), 1e-6), 0, 1)


def convert(rgba, cfg, donor_L=None, seed=11):
    rgb = rgba[:, :, :3].astype(np.float64)
    alpha = rgba[:, :, 3]
    mask = alpha > 200
    if mask.sum() < 1000:
        mask = np.ones(alpha.shape, dtype=bool)
    L = np.ascontiguousarray(rgb) @ LUMA
    before = stats(rgb, mask)

    src_mean, src_bands, src_lf = profile(L, mask)
    tgt_bands = REF_BANDS * cfg['amp']
    tgt_lf = REF_LF * cfg['amp']

    # ── 대역별 이득 ──
    # 상대(평균으로 나눈) 공간에서 다룬다. 그래야 평균 이동과 대비 제어가 분리된다.
    gains = np.clip(tgt_bands / np.maximum(src_bands, 1e-6), 1.0, np.array(cfg['gmax'], dtype=np.float64))
    g_lf = float(np.clip(tgt_lf / max(src_lf, 1e-6), 1.0, max(cfg['gmax'])))

    r = L / src_mean                                   # 평균 1 인 상대 휘도장
    det, lf = bands_of(r)
    out = lf.mean() + (lf - lf.mean()) * g_lf
    for d, g in zip(det, gains):
        out = out + d * g

    # ── 부족분을 기증 텍스처의 가닥층으로 채운다 ──
    # 자체 디테일이 압축 블록뿐인 텍스처(BlackHair)용. 외부에서 받아오는 게 아니라
    # **이 프로젝트 안에서 가장 잘 보이는 헤어 텍스처**의 고주파층을 빌려 쓴다.
    donor_used = 0.0
    if donor_L is not None:
        dd, _ = bands_of(donor_L / donor_L.mean())
        add = sum(dd[1:])                              # 7px 이상만 — 3px 는 노이즈에 가깝다
        out = out + add * cfg.get('donor_gain', 1.0)
        donor_used = cfg.get('donor_gain', 1.0)

    L2 = out * cfg['mean']

    # ── 흰 가닥(연령) ──
    sm = None
    if cfg['silver'] > 0:
        sm = silver_streaks(L.shape, cfg['silver'], seed)
        L2 = L2 * (1 - sm * 0.72) + (cfg['mean'] * 2.35) * (sm * 0.72)

    # 흰 가닥이 평균을 끌어올리므로 목표 평균으로 되맞춘다(상대 대비는 보존된다)
    L2 = L2 * (cfg['mean'] / max(float(L2[mask].mean()), 1e-6))
    L2 = np.clip(L2, 1.0, 255.0)

    # ── 색조 ──
    if cfg['tint']:
        t = np.array([int(cfg['tint'][i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64) / 255.0
        t = t / max(float(t @ LUMA), 1e-6)              # 휘도 1 로 정규화 → 휘도는 위에서 정한 값 그대로
        out_rgb = L2[:, :, None] * t[None, None, :]
    else:
        # 원래 색조 유지: 채널비를 보존한 채 휘도만 갈아끼운다
        ratio = rgb / np.maximum(L[:, :, None], 1e-6)
        out_rgb = L2[:, :, None] * ratio
    if sm is not None:
        sv = L2[:, :, None] * (SILVER_RGB / float(SILVER_RGB @ LUMA))[None, None, :]
        w = (sm * 0.72)[:, :, None]
        out_rgb = out_rgb * (1 - w) + sv * w

    out_rgb = np.clip(out_rgb, 0, 255)
    res = np.dstack([out_rgb, alpha]).astype(np.uint8)   # ⚠ 알파 원본 그대로
    return res, before, stats(res[:, :, :3].astype(np.float64), mask), gains, g_lf, donor_used


def find_src(d, name):
    for e in ('.webp', '.png', '.jpg', '.jpeg'):
        p = os.path.join(d, name + e)
        if os.path.exists(p):
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src_dir')
    ap.add_argument('out_dir')
    ap.add_argument('--only', default=None)
    ap.add_argument('--webp', action='store_true', help='무손실 webp 도 함께 낸다')
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    names = a.only.split(',') if a.only else list(CONFIG)

    donor_cache = {}
    report = []
    print(f"{'texture':<22}{'평균':>7}{'상대대비':>9}{'HF/평균':>9}  →{'평균':>7}{'상대대비':>9}{'HF/평균':>9}  판정")
    print('-' * 84)
    for name in names:
        cfg = CONFIG.get(name)
        if not cfg:
            print(f'{name}: 설정 없음 — 건너뜀')
            continue
        src = find_src(a.src_dir, name)
        if not src:
            print(f'{name}: 원본 없음 — 건너뜀')
            continue
        rgba = np.asarray(Image.open(src).convert('RGBA'))

        donor_L = None
        if cfg.get('donor'):
            dn = cfg['donor']
            if dn not in donor_cache:
                dp = find_src(a.src_dir, dn)
                if dp:
                    dimg = np.asarray(Image.open(dp).convert('RGBA')).astype(np.float64)
                    dl = np.ascontiguousarray(dimg[:, :, :3]) @ LUMA
                    donor_cache[dn] = dl
            donor_L = donor_cache.get(dn)
            if donor_L is not None and donor_L.shape != rgba.shape[:2]:
                donor_L = np.asarray(Image.fromarray(donor_L.astype(np.float32), 'F')
                                     .resize((rgba.shape[1], rgba.shape[0]), Image.BILINEAR), dtype=np.float64)

        fixed, before, after, gains, g_lf, donor_used = convert(rgba, cfg, donor_L)
        assert np.array_equal(fixed[:, :, 3], rgba[:, :, 3]), f'{name}: 알파가 변경됐다'

        dst = os.path.join(a.out_dir, name + '.png')
        Image.fromarray(fixed, 'RGBA').save(dst, optimize=True)
        if a.webp:
            Image.fromarray(fixed, 'RGBA').save(os.path.join(a.out_dir, name + '.webp'), lossless=True, quality=100)

        ok = after['rel'] >= 0.20 and after['hf_rel'] >= 0.055
        print(f"{name:<22}{before['mean']:>7.1f}{before['rel']*100:>8.1f}%{before['hf_rel']*100:>8.2f}%"
              f"  →{after['mean']:>7.1f}{after['rel']*100:>8.1f}%{after['hf_rel']*100:>8.2f}%  {'OK' if ok else '미달'}")
        report.append(dict(
            texture=name, out=os.path.basename(dst), avatars=cfg['avatars'], note=cfg['note'],
            tint=cfg['tint'], target_mean=cfg['mean'], silver=cfg['silver'],
            donor=cfg.get('donor'), donor_gain=donor_used,
            band_gains=[round(float(g), 2) for g in gains], lf_gain=round(g_lf, 2),
            before={k: round(v, 4) for k, v in before.items()},
            after={k: round(v, 4) for k, v in after.items()}, passed=bool(ok)))

    with open(os.path.join(a.out_dir, 'mapping.json'), 'w') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f'\n알파 무변경 검증 통과. 아바타↔텍스처 매핑: {a.out_dir}/mapping.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
