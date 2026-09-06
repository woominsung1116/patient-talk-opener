#!/usr/bin/env python3
"""NORMAL 어트리뷰트가 없는 프리미티브에 각도 임계 스무딩으로 노멀을 계산해 넣는다.

왜 필요한가:
  GLTFLoader 는 노멀 없는 메시에 flatShading 재질을 물려 조용히 넘어간다.
  하지만 로드 후 재질을 MeshStandardMaterial 로 교체하면 셰이더가
  normalize(vec3(0)) → NaN 을 만들고, 그 NaN 이 Bloom 의 mipmapBlur 를 타고
  전 화면으로 번져 화면이 통째로 검게 죽는다.

왜 각도 임계인가:
  전부 스무스로 평균내면 원통 폴대의 위/아래 캡, 바퀴 테두리 같은 각진 곳이
  뭉개진다. 코너별로 "이 면과 각도가 임계 이내인 이웃 면"만 평균해서
  크리스를 살린다. 노멀이 갈리는 정점만 분리(split)하므로 정점 증가는 최소.

사용:
  python gltf_fix_normals.py <in.glb> <out.glb> [--angle 40]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import gltf_kit as gk


def corner_normals(pos: np.ndarray, idx: np.ndarray, angle_deg: float):
    """(코너별 노멀 [F,3,3], 면 노멀 [F,3]) 반환."""
    tri = pos[idx]                                    # [F,3,3]
    e1 = tri[:, 1] - tri[:, 0]
    e2 = tri[:, 2] - tri[:, 0]
    fn = np.cross(e1, e2)                             # 크기 = 2*면적 → 면적 가중이 자동
    area = np.linalg.norm(fn, axis=1)
    unit = np.zeros_like(fn)
    ok = area > 1e-20
    unit[ok] = fn[ok] / area[ok, None]

    cos_t = np.cos(np.radians(angle_deg))
    F = idx.shape[0]
    out = np.zeros((F, 3, 3), dtype=np.float64)

    # 정점 -> 인접 면 목록 (평탄 배열 + 정렬로 O(N log N))
    flat_v = idx.reshape(-1)
    flat_f = np.repeat(np.arange(F), 3)
    order = np.argsort(flat_v, kind="stable")
    sv, sf = flat_v[order], flat_f[order]
    starts = np.searchsorted(sv, np.arange(pos.shape[0]))
    ends = np.searchsorted(sv, np.arange(pos.shape[0]), side="right")

    for f in range(F):
        for c in range(3):
            v = idx[f, c]
            neigh = sf[starts[v]:ends[v]]
            if neigh.size == 1:
                out[f, c] = fn[f]
                continue
            d = unit[neigh] @ unit[f]
            sel = neigh[d >= cos_t]
            n = fn[sel].sum(axis=0) if sel.size else fn[f]
            out[f, c] = n
    ln = np.linalg.norm(out, axis=2)
    good = ln > 1e-20
    out[good] /= ln[good][:, None]
    out[~good] = unit[np.nonzero(~good)[0]]           # 완전 퇴화면은 면 노멀로
    return out.astype(np.float32), unit.astype(np.float32)


def split_by_normal(idx: np.ndarray, cn: np.ndarray, nverts: int, quant: int = 4096):
    """(정점, 양자화 노멀) 조합마다 새 정점을 만든다. (new_idx, src_vertex, normals)"""
    key_n = np.round(cn.reshape(-1, 3) * quant).astype(np.int32)
    key_v = idx.reshape(-1).astype(np.int64)
    keys = np.concatenate([key_v[:, None], key_n.astype(np.int64)], axis=1)
    # 4개 int64 를 바이트 키로 묶어 unique
    view = np.ascontiguousarray(keys).view([("a", "i8"), ("b", "i8"), ("c", "i8"), ("d", "i8")]).reshape(-1)
    _, first, inv = np.unique(view, return_index=True, return_inverse=True)
    new_idx = inv.reshape(idx.shape).astype(np.uint32)
    src = key_v[first]
    normals = cn.reshape(-1, 3)[first]
    # 평균 후 정규화 (양자화로 살짝 어긋난 것 보정)
    ln = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.divide(normals, ln, out=np.zeros_like(normals), where=ln > 1e-20)
    return new_idx, src, normals.astype(np.float32)


def fix_primitive(doc: gk.Doc, prim: dict, angle: float, log: list):
    attrs = prim["attributes"]
    if "NORMAL" in attrs:
        return False
    if prim.get("mode", 4) != 4:
        log.append(f"    mode={prim.get('mode')} (삼각형 아님) → 건너뜀")
        return False

    pos = doc.read_accessor(attrs["POSITION"]).astype(np.float64)
    nverts = pos.shape[0]
    if prim.get("indices") is not None:
        idx = doc.read_accessor(prim["indices"]).reshape(-1).astype(np.int64)
    else:
        idx = np.arange(nverts, dtype=np.int64)
    idx = idx.reshape(-1, 3)

    cn, _ = corner_normals(pos, idx, angle)
    new_idx, src, normals = split_by_normal(idx, cn, nverts)

    # 모든 어트리뷰트를 src 로 재색인
    for name, ai in list(attrs.items()):
        a = doc.g["accessors"][ai]
        arr = doc.read_accessor(ai)[src]
        norm = bool(a.get("normalized"))
        attrs[name] = doc.add_accessor(np.ascontiguousarray(arr), a["type"],
                                       target=34962, normalized=norm,
                                       minmax=(name == "POSITION"))
    attrs["NORMAL"] = doc.add_accessor(normals, "VEC3", target=34962)

    ni = new_idx.reshape(-1)
    if ni.max() < 65536:
        ni = ni.astype(np.uint16)
    prim["indices"] = doc.add_accessor(ni.reshape(-1, 1), "SCALAR", target=34963)

    # 모프 타깃도 재색인 (있으면)
    for t in prim.get("targets", []):
        for name, ai in list(t.items()):
            a = doc.g["accessors"][ai]
            t[name] = doc.add_accessor(np.ascontiguousarray(doc.read_accessor(ai)[src]),
                                       a["type"], target=34962, minmax=True)

    log.append(f"    verts {nverts} -> {len(src)} (+{len(src)-nverts}), tris {len(idx)}, "
               f"crease≥{angle}°")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--angle", type=float, default=40.0,
                    help="이 각도보다 크게 꺾이면 하드 엣지로 둔다 (기본 40°)")
    a = ap.parse_args()

    doc = gk.load(a.src)
    log, fixed = [], 0
    for mi, m in enumerate(doc.g.get("meshes", [])):
        for pi, p in enumerate(m.get("primitives", [])):
            if "NORMAL" in p["attributes"]:
                continue
            log.append(f"  {m.get('name', f'mesh{mi}')}#{pi}")
            if fix_primitive(doc, p, a.angle, log):
                fixed += 1
    doc.save_glb(Path(a.dst))
    print(f"{Path(a.src).name}: NORMAL 추가 {fixed}개 프리미티브")
    print("\n".join(log))
    print(f"  size {Path(a.src).stat().st_size/1024:.1f}KB -> {Path(a.dst).stat().st_size/1024:.1f}KB")


if __name__ == "__main__":
    main()
