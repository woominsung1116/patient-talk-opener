#!/usr/bin/env python3
"""손 GLB 배포 전 검사 — 어트리뷰트 / 축퇴 UV / NaN / 실제 월드 bbox.

inspect_glb.py 는 accessor min/max 를 노드 변환 없이 합쳐서 bbox 를 부풀린다
(소매 실린더는 로컬 좌표, 손은 월드 좌표라 서로 다른 공간이다). 여기서는
노드 행렬을 실제로 곱해서 배치를 본다.

배포 게이트:
  - 모든 프리미티브에 NORMAL, TEXCOORD_0 존재
  - 축퇴 UV 삼각형(세 UV 가 같은 점 / 면적 0) 0개
  - POSITION/NORMAL/TEXCOORD_0 에 NaN·Inf 0개
  - 길이 0 노멀 0개
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import gltf_kit as gk


def node_matrices(g: dict) -> dict[int, np.ndarray]:
    """노드 인덱스 -> 월드 4x4. glTF 노드는 트리라 부모부터 내려가며 곱한다."""
    out: dict[int, np.ndarray] = {}

    def trs(n: dict) -> np.ndarray:
        if "matrix" in n:
            return np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
        m = np.eye(4)
        if "scale" in n:
            m = np.diag(list(n["scale"]) + [1.0]) @ m
        if "rotation" in n:
            x, y, z, w = n["rotation"]
            r = np.array([
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
                [0, 0, 0, 1.0],
            ])
            m = r @ m
        if "translation" in n:
            t = np.eye(4)
            t[:3, 3] = n["translation"]
            m = t @ m
        return m

    def walk(i: int, parent: np.ndarray) -> None:
        n = g["nodes"][i]
        w = parent @ trs(n)
        out[i] = w
        for c in n.get("children", []):
            walk(c, w)

    roots = g["scenes"][g.get("scene", 0)]["nodes"]
    for r in roots:
        walk(r, np.eye(4))
    return out


def degenerate_uv(uv: np.ndarray, idx: np.ndarray) -> tuple[int, int]:
    """(면적 0 UV 삼각형 수, 세 UV 가 완전히 동일한 삼각형 수)."""
    t = uv[idx]                                   # [F,3,2]
    e1 = t[:, 1] - t[:, 0]
    e2 = t[:, 2] - t[:, 0]
    area2 = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    same = np.all(t[:, 0] == t[:, 1], axis=1) & np.all(t[:, 1] == t[:, 2], axis=1)
    return int((area2 <= 1e-14).sum()), int(same.sum())


def check(path: str) -> bool:
    doc = gk.load(Path(path))
    g = doc.g
    mats = node_matrices(g)
    print(f"\n=== {Path(path).name}  ({Path(path).stat().st_size:,} bytes) ===")
    ok = True
    gmin = np.full(3, np.inf)
    gmax = np.full(3, -np.inf)
    tot_tris = 0
    for ni, w in sorted(mats.items()):
        n = g["nodes"][ni]
        if "mesh" not in n:
            continue
        mesh = g["meshes"][n["mesh"]]
        for pi, prim in enumerate(mesh["primitives"]):
            at = prim["attributes"]
            pos = doc.read_accessor(at["POSITION"]).astype(np.float64)
            idx = doc.read_accessor(prim["indices"]).reshape(-1, 3).astype(np.int64)
            tot_tris += idx.shape[0]
            wp = (w[:3, :3] @ pos.T).T + w[:3, 3]
            gmin = np.minimum(gmin, wp.min(0))
            gmax = np.maximum(gmax, wp.max(0))

            miss = [k for k in ("NORMAL", "TEXCOORD_0") if k not in at]
            nan_p = int((~np.isfinite(pos)).sum())
            line = (f"  node[{ni}] {n.get('name','?'):<8} prim{pi} tris={idx.shape[0]:<6} "
                    f"attrs={','.join(sorted(at))}")
            if miss:
                ok = False
                line += f"  << 누락: {miss}"
            print(line)
            if nan_p:
                ok = False
                print(f"      POSITION NaN/Inf {nan_p}개")
            if "NORMAL" in at:
                nrm = doc.read_accessor(at["NORMAL"]).astype(np.float64)
                bad = int((~np.isfinite(nrm)).sum())
                ln = np.linalg.norm(nrm, axis=1)
                zero = int((ln < 1e-6).sum())
                if bad or zero:
                    ok = False
                    print(f"      NORMAL NaN={bad} 길이0={zero}  << 블랙아웃 위험")
                else:
                    print(f"      NORMAL ok  |n| median={np.median(ln):.4f}")
            if "TEXCOORD_0" in at:
                uv = doc.read_accessor(at["TEXCOORD_0"]).astype(np.float64)
                bad = int((~np.isfinite(uv)).sum())
                dgn, same = degenerate_uv(uv, idx)
                if bad or dgn:
                    ok = False
                    print(f"      UV NaN={bad} 축퇴삼각형={dgn} (완전동일={same})  << 탄젠트 NaN 위험")
                else:
                    print(f"      UV ok  축퇴삼각형=0  범위 u[{uv[:,0].min():.3f},{uv[:,0].max():.3f}] "
                          f"v[{uv[:,1].min():.3f},{uv[:,1].max():.3f}]")
    print(f"  -- tris={tot_tris}  월드 bbox "
          f"X[{gmin[0]:+.3f},{gmax[0]:+.3f}] Y[{gmin[1]:+.3f},{gmax[1]:+.3f}] Z[{gmin[2]:+.3f},{gmax[2]:+.3f}]")
    print(f"  -- 크기(mm) {1000*(gmax[0]-gmin[0]):.0f} x {1000*(gmax[1]-gmin[1]):.0f} x {1000*(gmax[2]-gmin[2]):.0f}")
    print(f"  -- 판정: {'PASS' if ok else 'FAIL'}")
    return ok


if __name__ == "__main__":
    allok = all([check(p) for p in sys.argv[1:]])
    print(f"\n전체: {'PASS' if allok else 'FAIL'}")
    sys.exit(0 if allok else 1)
