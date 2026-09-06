#!/usr/bin/env python3
"""
헤어 텍스처 교정 — 금발/진저/오번 → 한국인 어두운 머리색, 상대 대비 복원.

왜 이 방식인가 (측정 근거):
  진단에서 GoldenBlondHair는 평균휘도 155 / 표준편차 4.9 = **상대 대비 3.2%** 였다.
  그런데 저주파:고주파 비율(4.50:1.75 = 2.57)은 잘 나오는 기준 텍스처
  Hairblackseamless2png(5.80:2.23 = 2.60)와 거의 같다.
  → **가닥 정보는 텍스처에 이미 들어 있다.** 밝은 평균 위에 눌려 있어 눈에 안 보였을 뿐이다.
     평균을 어둡게 옮기고 대비를 선형으로 늘리면 그대로 되살아난다.

  다만 BlackHair(LF:HF = 4.9)와 elvs_grumphair(3.5)는 고주파가 상대적으로 부족해
  선형 리맵만으로는 HF 목표에 못 미친다 → 그 둘만 고주파를 따로 더 키운다.

목표 (기준: Hairblackseamless2png = 평균 23 / 상대대비 28.4% / HF·평균 9.65%):
  - 평균 휘도       24 ~ 32
  - 상대 대비       >= 24%
  - HF / 평균       >= 7%     ← '가닥이 보이는가'의 실제 지표

⚠ 알파 채널은 바이트 단위로 그대로 복사한다. 가닥 실루엣이 거기 들어 있다.
⚠ public/avatars/** 는 읽기 전용이다. 이 스크립트는 GLB를 수정하지 않는다 —
   추출된 텍스처를 읽어 교정본 PNG를 따로 내놓을 뿐이다.

사용:
  python3 fix_hair_textures.py <입력_webp_디렉터리> <출력_디렉터리>
"""
import sys, os, json
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# ── 교정 대상 ──────────────────────────────────────────────────────────────
# tint  : 목표 머리색 (한국인 기준 어두운 갈흑색). 휘도 1로 정규화해서 곱한다.
# mean  : 목표 평균 휘도
# rel   : 목표 상대 대비
# hf    : 고주파 추가 증폭 (1.0 = 선형 리맵만. LF:HF 비가 나쁜 텍스처만 올린다)
# silver: 흰머리 가닥이 차지할 컬럼 비율 (연령 표현). 0이면 넣지 않는다.
CONFIG = {
    'GoldenBlondHair':     dict(tint='#2f2622', mean=30, rel=0.26, hf=1.0, silver=0.09, avatars='mh_f60, mh_f60_ob'),
    'GingerHair':          dict(tint='#2e2420', mean=28, rel=0.27, hf=1.0, silver=0.15, avatars='mh_f70, mh_oldf'),
    'elvs_grumphair':      dict(tint='#302724', mean=30, rel=0.26, hf=1.6, silver=0.17, avatars='mh_oldm'),
    'StrawberryBlondHair': dict(tint='#31261f', mean=32, rel=0.26, hf=1.0, silver=0.03, avatars='mh_f50'),
    'AuburnHair':          dict(tint='#2b221d', mean=25, rel=0.27, hf=1.0, silver=0.0,  avatars='mh_girl'),
    'BlackHair':           dict(tint='#2c2420', mean=30, rel=0.25, hf=2.6, silver=0.0,  avatars='mh_f20, mh_f40'),
}

SILVER_TINT = np.array([0.72, 0.71, 0.70], dtype=np.float32)  # 흰머리는 순백이 아니라 회백색이다


def analyse(rgb, alpha):
    """불투명 영역 기준 통계 (진단 때와 같은 방식)"""
    L = rgb @ LUMA
    m = alpha > 200
    if m.sum() < 1000:
        return None
    base = uniform_filter(L, size=9)
    det = L - base
    mean = float(L[m].mean())
    return dict(mean=mean, std=float(L[m].std()), rel=float(L[m].std() / mean),
                lf=float(base[m].std()), hf=float(det[m].std()), hf_rel=float(det[m].std() / mean))


def fix(rgba, cfg, seed=7):
    rgb = rgba[:, :, :3].astype(np.float32)
    alpha = rgba[:, :, 3].astype(np.float32)
    H, W = alpha.shape
    st = analyse(rgb, alpha)
    L = rgb @ LUMA

    # ── ① 저주파/고주파 분리 ──
    base = uniform_filter(L, size=9)
    det = L - base

    # ── ② 대비 리맵 ──
    # 목표 총 표준편차에 맞춰 선형 이득을 구하고, hf>1이면 고주파만 더 키운다.
    target_std = cfg['mean'] * cfg['rel']
    # var_total = (g*lf)^2 + (g*hf_gain*hf)^2  → g 를 역산
    g = target_std / np.sqrt((st['lf'] ** 2) + (cfg['hf'] * st['hf']) ** 2)
    L2 = cfg['mean'] + (base - st['mean']) * g + det * g * cfg['hf']

    # ── ③ 흰머리 가닥 (연령) ──
    # 가닥은 텍스처의 **세로 컬럼**을 따라 흐른다(셰이더가 floor(vMapUv.x*1450)로 컬럼을 고르는 것과 같은 축).
    # 균일한 회색으로 덮으면 지금 문제가 재발하므로, 성긴 컬럼만 밝히고 세로로도 세기를 흔든다.
    silver_mask = np.zeros((H, W), dtype=np.float32)
    if cfg['silver'] > 0:
        rng = np.random.default_rng(seed)
        colsel = (rng.random(W) < cfg['silver']).astype(np.float32)
        colsel = uniform_filter(colsel[None, :], size=(1, 3))[0]      # 가닥 두께 ~3px, 가장자리 부드럽게
        y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
        wobble = 0.45 + 0.55 * (0.5 + 0.5 * np.sin(y * 37.0 + rng.random() * 6.28))
        silver_mask = colsel[None, :] * wobble
        silver_mask *= (rng.random((H, W)).astype(np.float32) * 0.35 + 0.65)  # 미세한 끊김
        # ⚠ 흰머리를 너무 밝게 넣으면 '하드에지 흰 줄무늬'가 되어 니트 비니처럼 보인다
        #   (RealisticPatient.tsx:2495 주석의 mh_m60·mh_m70 지적과 같은 실패다).
        #   1차 시도에서 4.6배로 넣었더니 HF/평균이 26%까지 튀었다(기준 9.65%). 2.1배로 낮춘다.
        w = silver_mask * 0.75
        L2 = L2 * (1 - w) + (cfg['mean'] * 2.1) * w

    # 흰머리가 평균을 끌어올리므로 목표 평균으로 다시 맞춘다 (상대 대비는 보존된다)
    mm = float(L2[alpha > 200].mean())
    L2 *= cfg['mean'] / max(mm, 1e-6)
    L2 = np.clip(L2, 1.0, 255.0)

    # ── ④ 한국인 머리색으로 리컬러 ──
    # 어두운 머리는 사실상 무채색에 가깝다 → 휘도에 목표 색조를 곱하는 방식이 자연스럽다.
    t = np.array([int(cfg['tint'][i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255.0
    t = t / max(float(t @ LUMA), 1e-6)                    # 휘도 1로 정규화
    out = L2[:, :, None] * t[None, None, :]
    # 흰머리 부분은 색조를 빼고 회백색으로
    if cfg['silver'] > 0:
        sv = L2[:, :, None] * SILVER_TINT[None, None, :] / max(float(SILVER_TINT @ LUMA), 1e-6)
        w = np.clip(silver_mask * 0.75, 0, 1)[:, :, None]
        out = out * (1 - w) + sv * w

    out = np.clip(out, 0, 255)
    res = np.dstack([out, alpha]).astype(np.uint8)        # ⚠ 알파 원본 그대로
    return res, st, analyse(res[:, :, :3].astype(np.float32), alpha)


def main():
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    report = []
    print(f"{'texture':<22}{'':>3}{'평균':>7}{'상대대비':>9}{'HF/평균':>9}   →{'평균':>7}{'상대대비':>9}{'HF/평균':>9}  판정")
    print('-' * 92)
    for name, cfg in CONFIG.items():
        src = os.path.join(src_dir, name + '.webp')
        if not os.path.exists(src):
            print(f'{name:<22} 원본 없음 — 건너뜀')
            continue
        im = Image.open(src).convert('RGBA')
        rgba = np.asarray(im)
        fixed, before, after = fix(rgba, cfg)
        dst = os.path.join(out_dir, name + '.png')
        Image.fromarray(fixed, 'RGBA').save(dst, optimize=True)
        ok = after['rel'] >= 0.20 and after['hf_rel'] >= 0.055
        print(f"{name:<22}{'':>3}{before['mean']:>7.1f}{before['rel']*100:>8.1f}%{before['hf_rel']*100:>8.2f}%"
              f"   →{after['mean']:>7.1f}{after['rel']*100:>8.1f}%{after['hf_rel']*100:>8.2f}%  {'OK' if ok else '미달'}")
        # 알파 보존 검증
        assert np.array_equal(fixed[:, :, 3], rgba[:, :, 3]), f'{name}: 알파가 변경됐다!'
        report.append(dict(texture=name, avatars=cfg['avatars'], out=os.path.basename(dst),
                           before={k: round(v, 4) for k, v in before.items()},
                           after={k: round(v, 4) for k, v in after.items()},
                           tint=cfg['tint'], silver=cfg['silver'], pass_=bool(ok)))
    with open(os.path.join(out_dir, 'mapping.json'), 'w') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f'\n알파 채널 무변경 검증 통과. 매핑: {out_dir}/mapping.json')


if __name__ == '__main__':
    main()
