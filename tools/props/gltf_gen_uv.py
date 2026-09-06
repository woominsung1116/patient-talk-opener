#!/usr/bin/env python3
"""TEXCOORD_0 가 없는 프리미티브에 원통+캡 투영으로 UV 를 생성해 넣는다.

왜 필요한가:
  UV 가 없는 메시에 normalMap / clearcoat / MeshPhysicalMaterial.anisotropy 를 걸면
  three.js 는 화면공간 미분으로 탄젠트를 만든다. UV 미분이 0 이면 normalize(vec3(0))
  → NaN 이 되고, Bloom 의 mipmapBlur 를 타고 화면 전체가 검게 죽는다.
  (이 저장소에 전례가 있다: RealisticPatient.tsx:1721 주석)

왜 캡을 따로 투영하는가:
  축에 **완전히** 수직인 평면(원판)은 원통 투영에서 v 가 전부 같은 값이 되어
  UV 삼각형이 선분으로 찌부러진다(면적 0 → 탄젠트 NaN).
  penlight 렌즈는 실제로는 살짝 볼록해서(y 폭 1.1mm) 순수 원통으로도 면적 0 은
  아니었다 — 측정해 확인했다. 다만 조건수가 나쁘다:
      순수 원통  : 이방비 중앙값 118 (최대 186)
      캡 평면투영: 이방비 중앙값  15
  이방비가 크면 탄젠트가 수치적으로 불안정해지므로 캡 투영을 유지한다.
  완전 평면인 캡을 가진 다른 자산에서는 이게 면적 0 자체를 막는다.

검증 지표는 파일 크기가 아니라 **축퇴(degenerate) UV 삼각형 개수 0** 이다.

사용:
  python gltf_gen_uv.py <in.glb> <out.glb> [--axis auto|x|y|z] [--cap-angle 35]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import gltf_kit as gk

AXES = {"x": np.array([1.0, 0, 0]), "y": np.array([0, 1.0, 0]), "z": np.array([0, 0, 1.0])}


def dominant_axis(pos: np.ndarray) -> tuple[np.ndarray, str]:
    """가장 긴 주축. 원통형 소품은 보통 바운딩박스 최장변과 일치한다."""
    ext = pos.max(0) - pos.min(0)
    i = int(np.argmax(ext))
    return AXES["xyz"[i]], "xyz"[i]


def basis_for(axis: np.ndarray):
    """axis 를 up 으로 하는 직교 기저 (e1, e2, axis)."""
    tmp = np.array([1.0, 0, 0]) if abs(axis[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(tmp, axis); e1 /= np.linalg.norm(e1)
    e2 = np.cross(axis, e1)
    return e1, e2


def corner_uvs(pos: np.ndarray, idx: np.ndarray, axis: np.ndarray, cap_cos: float):
    """코너별 UV [F,3,2] 를 만든다. 옆면은 원통, 캡은 평면 투영."""
    e1, e2 = basis_for(axis)
    p1 = pos @ e1
    p2 = pos @ e2
    ph = pos @ axis                                   # 축 방향 높이
    h0, h1 = ph.min(), ph.max()
    hspan = max(h1 - h0, 1e-9)
    radius = max(np.hypot(p1, p2).max(), 1e-9)

    tri = pos[idx]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(fn, axis=1)
    unit = np.zeros_like(fn)
    ok = ln > 1e-20
    unit[ok] = fn[ok] / ln[ok, None]
    is_cap = np.abs(unit @ axis) >= cap_cos           # 면이 축을 향하면 캡

    uv = np.zeros((len(idx), 3, 2))

    # ── 옆면: 원통 (u=각도, v=높이) ────────────────────────────────────────
    side = ~is_cap
    if side.any():
        si = idx[side]
        ang = np.arctan2(p1[si], p2[si]) / (2 * np.pi) + 0.5     # [0,1)
        # 이음매(seam) 처리: 한 삼각형 안에서 각도가 반 바퀴 넘게 벌어지면
        # 작은 쪽에 +1 을 해 연속으로 만든다. 안 그러면 UV 가 화면을 가로질러
        # 접히면서 탄젠트가 뒤집힌다.
        span = ang.max(1) - ang.min(1)
        wrap = span > 0.5
        if wrap.any():
            a = ang[wrap]
            a = np.where(a < 0.5, a + 1.0, a)
            ang[wrap] = a
        uv[side, :, 0] = ang * (2 * np.pi * radius) / hspan       # 종횡비 유지
        uv[side, :, 1] = (ph[si] - h0) / hspan

    # ── 캡: 축에 수직인 평면 투영 (원판이 원판으로 남는다) ──────────────
    if is_cap.any():
        ci = idx[is_cap]
        uv[is_cap, :, 0] = 0.5 + p1[ci] / (2 * radius)
        uv[is_cap, :, 1] = 0.5 + p2[ci] / (2 * radius)

    return uv, is_cap, unit, ln


def uv_area(uv: np.ndarray) -> np.ndarray:
    a = uv[:, 1] - uv[:, 0]
    b = uv[:, 2] - uv[:, 0]
    return 0.5 * np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0])


def split_by_uv(idx: np.ndarray, uv: np.ndarray, quant: int = 100000):
    """(정점, 양자화 UV) 조합마다 새 정점을 만든다."""
    key_uv = np.round(uv.reshape(-1, 2) * quant).astype(np.int64)
    key_v = idx.reshape(-1).astype(np.int64)
    keys = np.concatenate([key_v[:, None], key_uv], axis=1)
    view = np.ascontiguousarray(keys).view([("a", "i8"), ("b", "i8"), ("c", "i8")]).reshape(-1)
    _, first, inv = np.unique(view, return_index=True, return_inverse=True)
    return inv.reshape(idx.shape).astype(np.uint32), key_v[first], uv.reshape(-1, 2)[first]


def fix_primitive(doc: gk.Doc, prim: dict, axis_opt: str, cap_deg: float, log: list, label: str):
    attrs = prim["attributes"]
    if "TEXCOORD_0" in attrs:
        log.append(f"  {label}: 이미 TEXCOORD_0 있음 — 건너뜀")
        return None
    if prim.get("mode", 4) != 4:
        log.append(f"  {label}: mode={prim.get('mode')} 삼각형 아님 — 건너뜀")
        return None

    pos = doc.read_accessor(attrs["POSITION"]).astype(np.float64)
    nv = len(pos)
    idx = (doc.read_accessor(prim["indices"]).reshape(-1).astype(np.int64)
           if prim.get("indices") is not None else np.arange(nv, dtype=np.int64))
    idx = idx.reshape(-1, 3)

    axis, aname = (dominant_axis(pos) if axis_opt == "auto" else (AXES[axis_opt], axis_opt))
    uv, is_cap, unit, ln3 = corner_uvs(pos, idx, axis, np.cos(np.radians(cap_deg)))

    ar = uv_area(uv)
    degen_uv = int((ar < 1e-12).sum())
    degen_3d = int((ln3 < 1e-16).sum())

    new_idx, src, uvs = split_by_uv(idx, uv)
    for name, ai in list(attrs.items()):
        a = doc.g["accessors"][ai]
        arr = doc.read_accessor(ai)[src]
        attrs[name] = doc.add_accessor(np.ascontiguousarray(arr), a["type"], target=34962,
                                       normalized=bool(a.get("normalized")),
                                       minmax=(name == "POSITION"))
    attrs["TEXCOORD_0"] = doc.add_accessor(uvs.astype(np.float32), "VEC2", target=34962)

    ni = new_idx.reshape(-1)
    ni = ni.astype(np.uint16) if ni.max() < 65536 else ni
    prim["indices"] = doc.add_accessor(ni.reshape(-1, 1), "SCALAR", target=34963)

    log.append(f"  {label}: 축={aname} 정점 {nv}->{len(src)} 삼각형 {len(idx)} "
               f"(캡 {int(is_cap.sum())}, 옆면 {int((~is_cap).sum())}) "
               f"축퇴UV={degen_uv} 축퇴3D={degen_3d}")
    return degen_uv, degen_3d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--axis", default="auto", choices=["auto", "x", "y", "z"])
    ap.add_argument("--cap-angle", type=float, default=35.0,
                    help="면 법선이 축과 이 각도 이내면 캡으로 보고 평면 투영 (기본 35°)")
    a = ap.parse_args()

    doc = gk.load(a.src)
    log, tot_uv, tot_3d, n = [], 0, 0, 0
    for mi, m in enumerate(doc.g.get("meshes", [])):
        for pi, p in enumerate(m.get("primitives", [])):
            r = fix_primitive(doc, p, a.axis, a.cap_angle, log,
                              f"{m.get('name', f'mesh{mi}')}#{pi}")
            if r:
                tot_uv += r[0]; tot_3d += r[1]; n += 1
    doc.save_glb(Path(a.dst))
    print(f"{Path(a.src).name}: TEXCOORD_0 추가 {n}개 프리미티브")
    print("\n".join(log))
    print(f"  합계 축퇴UV={tot_uv} 축퇴3D={tot_3d}  "
          f"{'OK' if tot_uv == 0 else '*** 축퇴 UV 남음 — 탄젠트 NaN 위험 ***'}")
    print(f"  size {Path(a.src).stat().st_size/1024:.1f}KB -> {Path(a.dst).stat().st_size/1024:.1f}KB")
    return 0 if tot_uv == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
