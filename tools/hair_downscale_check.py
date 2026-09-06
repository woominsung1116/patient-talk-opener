#!/usr/bin/env python3
"""헤어 텍스처를 1024² 로 내리면 가닥 대비가 얼마나 죽는지 잰다.

`tools/props/compress_avatar_tex.py` 는 옷·헤어를 2048²→1024² LANCZOS 로 내린다.
헤어는 가닥이 **고주파**라 다운스케일에 특히 약하다. 이 스크립트가 그 손실을 수치로 낸다.

측정법 — 해상도가 다르면 지표를 그냥 비교할 수 없다
  rel = std/mean 은 스케일 불변이라 해상도가 달라도 직접 비교된다.
  hf_rel 은 9텍셀 창으로 재는데, 1024² 에서 9텍셀은 2048² 의 18텍셀에 해당한다
  → 그대로 재면 사과와 오렌지다.
  그래서 **1024 로 내렸다가 다시 원해상도로 올린 뒤**(GPU 확대와 같은 bilinear)
  원본과 **같은 마스크·같은 창**으로 잰다. 다운스케일로 날아간 정보는 복원되지 않으므로
  이 차이가 곧 '화면에서 잃는 가닥'이다.

  python3 tools/hair_downscale_check.py             # 원본·교정본, 소재 대비
  python3 tools/hair_downscale_check.py --pipeline  # 회색블렌드+ACES 통과 후
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEASURE_SRC = os.path.join(ROOT, 'frontend', 'lab', 'hair', 'src')
FIXED = os.path.join(ROOT, 'scratchpad', 'clinic_lab', 'avatars', 'hair_fixed')
sys.path.insert(0, MEASURE_SRC)
import measure as M  # noqa: E402  (읽기 전용으로 재사용 — uv_mask/stats/game_pipeline)

# 로테이션에서 헤어 대비가 문제였거나 기준으로 쓰는 것들
CASES = [
    ('mh_f60_ob', 'GoldenBlondHair'), ('mh_f70', 'GingerHair'), ('mh_f50', 'StrawberryBlondHair'),
    ('mh_f20', 'BlackHair'), ('mh_girl', 'AuburnHair'), ('mh_f20_thin', 'Hairblackseamless2png'),
]
TARGET = 1024


def roundtrip(img, target=TARGET):
    """LANCZOS 로 내리고(압축 스크립트와 동일) bilinear 로 되올린다(GPU 확대와 동일)."""
    h, w = img.shape[:2]
    if max(w, h) <= target:
        return img, False
    pil = Image.fromarray(np.round(img).astype(np.uint8), 'RGBA')
    small = pil.resize((target, target), Image.LANCZOS)
    return np.asarray(small.resize((w, h), Image.BILINEAR)).astype(np.float64), True


def alpha_edge(a, mask_any):
    """실루엣이 얼마나 뭉개졌나 — 반투명(경계) 텍셀 비율. 커질수록 가닥 끝이 흐려진 것."""
    band = (a > 25) & (a < 230)
    return float(band.sum()) / max(float((a > 25).sum()), 1.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pipeline', action='store_true', help='회색블렌드+ACES 통과 후 측정')
    ap.add_argument('--exposure', type=float, default=4.0)
    a = ap.parse_args()

    man = {r['avatar']: r for r in M.load_prims(None)}
    hdr = ('아바타         텍스처                소스   해상도      rel 2048→1024      '
           'hf_rel 2048→1024        알파경계')
    print(hdr)
    print('-' * (len(hdr) + 8))

    for av, tex in CASES:
        rec = man[av]
        for label, tdir in (('원본', None), ('교정', FIXED)):
            if label == '교정' and not os.path.exists(os.path.join(FIXED, tex + '.png')):
                continue
            uv, tris, img, src = M.prim_data(rec, tdir)
            h, w = img.shape[:2]
            mask = M.uv_mask(uv, tris, w, h) & (img[:, :, 3] > 200)
            down, did = roundtrip(img)

            def stat(im):
                rgb = im[:, :, :3]
                if a.pipeline:
                    rgb, _ = M.game_pipeline(rgb, av, a.exposure)
                return M.stats(rgb, mask)

            s0, s1 = stat(img), stat(down)
            e0, e1 = alpha_edge(img[:, :, 3], mask), alpha_edge(down[:, :, 3], mask)
            dr = (s1['rel'] - s0['rel']) / max(s0['rel'], 1e-9) * 100
            dh = (s1['hf_rel'] - s0['hf_rel']) / max(s0['hf_rel'], 1e-9) * 100
            print(f'{av:<14} {tex:<21} {label:<5} {w:>4}²{"" if did else " (이미≤1024)":<6}  '
                  f'{s0["rel"]*100:6.1f}%→{s1["rel"]*100:6.1f}% ({dr:+5.1f}%)  '
                  f'{s0["hf_rel"]*100:6.2f}%→{s1["hf_rel"]*100:6.2f}% ({dh:+6.1f}%)  '
                  f'{e0*100:4.1f}%→{e1*100:4.1f}%')
        print()


if __name__ == '__main__':
    main()
