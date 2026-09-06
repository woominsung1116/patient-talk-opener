#!/usr/bin/env python3
"""
GLB에서 헤어 메시의 UV·삼각형·베이스컬러 텍스처를 꺼낸다. **읽기 전용** — GLB를 쓰지 않는다.

왜 필요한가: 텍스처 전체 통계는 거짓말을 한다. 헤어 UV가 아틀라스의 일부만 쓰면
안 쓰는 영역(다른 헤어스타일 슬롯, 여백)까지 평균에 섞여 대비가 부풀거나 눌린다.
그래서 **메시 삼각형을 UV 공간에 래스터라이즈해 마스크를 만들고**, 그 안에서만 잰다.
"""
import json
import struct
import numpy as np

COMP = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF', path
    off, n = 12, len(d)
    js, bins = None, b''
    while off < n:
        clen, ctype = struct.unpack('<II', d[off:off + 8])
        chunk = d[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            bins = chunk
        off += 8 + clen + ((-clen) % 4)
    return js, bins


def accessor(js, bins, idx):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    fmt = COMP[acc['componentType']]
    nc = NCOMP[acc['type']]
    isz = struct.calcsize('<' + fmt)
    stride = bv.get('byteStride') or (isz * nc)
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    cnt = acc['count']
    if stride == isz * nc:
        a = np.frombuffer(bins, dtype=np.dtype('<' + fmt), count=cnt * nc, offset=base)
        return a.reshape(cnt, nc) if nc > 1 else a
    raw = np.frombuffer(bins, dtype=np.uint8, count=stride * cnt, offset=base).reshape(cnt, stride)
    out = raw[:, :isz * nc].copy().view(np.dtype('<' + fmt)).reshape(cnt, nc)
    return out if nc > 1 else out[:, 0]


def image_bytes(js, bins, img_idx):
    im = js['images'][img_idx]
    bv = js['bufferViews'][im['bufferView']]
    o = bv.get('byteOffset', 0)
    return bins[o:o + bv['byteLength']], im.get('mimeType', ''), im.get('name', f'img{img_idx}')


def hair_meshes(path):
    """[{name, material, texname, tex_bytes, uv (N,2), tris (M,3)}] — 헤어로 판정된 프리미티브만."""
    js, bins = load_glb(path)
    out = []
    for node in js.get('nodes', []):
        if 'mesh' not in node:
            continue
        mesh = js['meshes'][node['mesh']]
        mname = mesh.get('name', '')
        for prim in mesh['primitives']:
            mi = prim.get('material')
            matname = js['materials'][mi].get('name', '') if mi is not None else ''
            tag = (node.get('name', '') + '|' + mname + '|' + matname).lower()
            if not any(k in tag for k in ('hair', 'bob', 'wig', 'ponytail', 'grump')):
                continue
            if 'TEXCOORD_0' not in prim['attributes']:
                continue
            uv = np.array(accessor(js, bins, prim['attributes']['TEXCOORD_0']), dtype=np.float64)
            tris = (np.array(accessor(js, bins, prim['indices']), dtype=np.int64).reshape(-1, 3)
                    if 'indices' in prim else np.arange(len(uv)).reshape(-1, 3))
            mat = js['materials'][mi]
            pbr = mat.get('pbrMetallicRoughness', {})
            bct = pbr.get('baseColorTexture')
            tb, tn = None, None
            if bct is not None:
                src = js['textures'][bct['index']].get('source')
                if src is not None:
                    tb, _, tn = image_bytes(js, bins, src)
            out.append(dict(mesh=mname or node.get('name', ''), material=matname,
                            texname=tn, tex=tb, uv=uv, tris=tris,
                            base_color=pbr.get('baseColorFactor', [1, 1, 1, 1]),
                            alpha_mode=mat.get('alphaMode', 'OPAQUE')))
    return out


def uv_mask(uv, tris, w, h):
    """UV 삼각형을 텍셀 그리드에 채운다. three.js 규약대로 v를 뒤집는다(py = (1-v)*h)."""
    m = np.zeros((h, w), dtype=bool)
    px = np.clip(uv[:, 0], 0, 1) * (w - 1)
    py = (1.0 - np.clip(uv[:, 1], 0, 1)) * (h - 1)
    for a, b, c in tris:
        xs = np.array([px[a], px[b], px[c]])
        ys = np.array([py[a], py[b], py[c]])
        x0, x1 = int(np.floor(xs.min())), int(np.ceil(xs.max()))
        y0, y1 = int(np.floor(ys.min())), int(np.ceil(ys.max()))
        if x1 - x0 > w // 2 or y1 - y0 > h // 2:
            continue  # UV 랩어라운드로 화면 절반을 덮는 삼각형은 버린다
        if x1 <= x0 or y1 <= y0:
            m[np.clip(y0, 0, h - 1), np.clip(x0, 0, w - 1)] = True
            continue
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        d = ((ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]))
        if abs(d) < 1e-9:
            continue
        l0 = ((ys[1] - ys[2]) * (xx - xs[2]) + (xs[2] - xs[1]) * (yy - ys[2])) / d
        l1 = ((ys[2] - ys[0]) * (xx - xs[2]) + (xs[0] - xs[2]) * (yy - ys[2])) / d
        inside = (l0 >= -0.02) & (l1 >= -0.02) & (l0 + l1 <= 1.02)
        sub = m[np.clip(y0, 0, h - 1):np.clip(y1 + 1, 0, h), np.clip(x0, 0, w - 1):np.clip(x1 + 1, 0, w)]
        ih, iw = sub.shape
        sub |= inside[:ih, :iw]
    return m
