#!/usr/bin/env python3
"""clinic-lab / FINAL — 캡처 비교 유틸.
   base vs final 을 위아래로 붙이고, 변화 픽셀 비율 / 클리핑 / 영역별 평균을 찍는다."""
import sys
import numpy as np
from PIL import Image

D = '/private/tmp/claude-501/-Users-woominseong-Desktop----/6719fbd2-d125-4e36-b744-ea010e7e8d6f/scratchpad/clinic_lab/final/'


def load(n):
    return np.asarray(Image.open(D + n + '.png').convert('RGB')).astype(float)


def stats(name, a):
    flat = a.reshape(-1, 3)
    mx = a.max(2)
    mn = flat.mean(1)
    sat = np.where(flat.max(1) > 0, (flat.max(1) - flat.min(1)) / np.maximum(flat.max(1), 1), 0)
    return dict(name=name, mean=flat.mean(0).round(1).tolist(), lum=round(mn.mean(), 1),
                std=round(mn.std(), 1), sat=round(sat.mean(), 3),
                clip=round((mx > 250).mean() * 100, 2))


def diff(a, b, thr=6):
    d = np.abs(a - b).max(2)
    return round((d > thr).mean() * 100, 1), round(np.abs(a - b).mean(), 2)


def stack(names, out, labels=None):
    ims = [Image.open(D + n + '.png').convert('RGB') for n in names]
    w = min(i.width for i in ims)
    ims = [i.resize((w, int(i.height * w / i.width))) for i in ims]
    H = sum(i.height for i in ims)
    canvas = Image.new('RGB', (w, H))
    y = 0
    for i in ims:
        canvas.paste(i, (0, y)); y += i.height
    canvas.save(D + out + '.png')
    print('wrote', D + out + '.png', labels or names)


REGIONS = {           # (y0,y1,x0,x1) — 1440x900 기준
    'ceiling':  (0, 46, 380, 1100),
    'backwall': (60, 260, 120, 420),
    'floor':    (560, 780, 950, 1400),
    'curtain':  (120, 480, 460, 940),
    'window':   (30, 330, 1000, 1420),
}


def regions(a, b):
    for k, (y0, y1, x0, x1) in REGIONS.items():
        ra, rb = a[y0:y1, x0:x1], b[y0:y1, x0:x1]
        pc, mae = diff(ra, rb)
        print(f'  {k:9s} base {rb.reshape(-1,3).mean(0).round(1)}  final {ra.reshape(-1,3).mean(0).round(1)}'
              f'  changed {pc:5.1f}%  mae {mae}')


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'stack':
        stack(sys.argv[2:-1], sys.argv[-1])
    else:
        a, b = load(sys.argv[2]), load(sys.argv[3])
        print(stats(sys.argv[2], a))
        print(stats(sys.argv[3], b))
        pc, mae = diff(a, b)
        print(f'changed {pc}% of pixels, mean abs err {mae}/255')
        regions(a, b)
