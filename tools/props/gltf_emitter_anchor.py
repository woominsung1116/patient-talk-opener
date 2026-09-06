#!/usr/bin/env python3
"""발광부(렌즈 등) 메시에서 광원 부착 앵커를 뽑아 사이드카 JSON 으로 남긴다.

씬에서 SpotLight 를 램프 끝에 붙이고 조준하려면 "렌즈가 어디에 있고 빛이 어느 쪽으로
나가는가"를 알아야 한다. 눈대중으로 맞추면 자산이 바뀔 때마다 틀어지므로 파일에서 산출한다.
(make_doctor_hands.py 의 <name>.anchors.json 규약을 따른다 — 평평한 dict, 좌표는 3원소 리스트)

방향은 발광 메시의 **면적 가중 평균 법선**으로 잡는다. 정점 법선 평균보다 안정적이다.

사용:
  python gltf_emitter_anchor.py <in.glb> --mesh PenlightLens [--out x.anchors.json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import gltf_kit as gk


def node_matrix(g: dict, target_mesh: int):
    """해당 메시를 참조하는 노드의 월드 행렬. 부모 체인을 따라 곱한다."""
    parent = {}
    for i, n in enumerate(g.get("nodes", [])):
        for c in n.get("children", []):
            parent[c] = i

    def local(n):
        if "matrix" in n:
            return np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
        m = np.eye(4)
        if "scale" in n:
            m = np.diag([*n["scale"], 1.0]) @ m
        if "rotation" in n:
            x, y, z, w = n["rotation"]
            r = np.array([
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
                [0, 0, 0, 1]], dtype=np.float64)
            m = r @ m
        if "translation" in n:
            t = np.eye(4); t[:3, 3] = n["translation"]
            m = t @ m
        return m

    for i, n in enumerate(g.get("nodes", [])):
        if n.get("mesh") != target_mesh:
            continue
        m, cur = np.eye(4), i
        while cur is not None:
            m = local(g["nodes"][cur]) @ m
            cur = parent.get(cur)
        return m
    return np.eye(4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--mesh", required=True, help="발광부 메시 이름")
    ap.add_argument("--out", default=None)
    ap.add_argument("--offset", type=float, default=0.002,
                    help="렌즈 앞으로 광원을 띄울 거리(m). 램프 자체가 스팟에 씻기는 걸 막는다.")
    a = ap.parse_args()

    src = Path(a.src)
    doc = gk.load(src)
    g = doc.g

    mi = next((i for i, m in enumerate(g["meshes"]) if m.get("name") == a.mesh), None)
    if mi is None:
        sys.exit(f"메시 '{a.mesh}' 없음. 있는 것: {[m.get('name') for m in g['meshes']]}")

    M = node_matrix(g, mi)
    R = M[:3, :3]
    nrm_mat = np.linalg.inv(R).T

    pos_all, fn_all = [], []
    for p in g["meshes"][mi]["primitives"]:
        pos = doc.read_accessor(p["attributes"]["POSITION"]).astype(np.float64)
        pos = pos @ R.T + M[:3, 3]
        idx = (doc.read_accessor(p["indices"]).reshape(-1).astype(np.int64)
               if p.get("indices") is not None else np.arange(len(pos)))
        tri = pos[idx.reshape(-1, 3)]
        fn_all.append(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]).sum(0))
        pos_all.append(pos)

    pos = np.concatenate(pos_all)
    d = np.sum(fn_all, axis=0)
    d = d / max(np.linalg.norm(d), 1e-12)
    ctr = pos.mean(0)

    # 전체 자산 bbox — 몸통이 어느 쪽으로 뻗는지 확인용
    allp = np.concatenate([doc.read_accessor(pp["attributes"]["POSITION"]).astype(np.float64)
                           for mm in g["meshes"] for pp in mm["primitives"]])

    r3 = lambda v: [round(float(x), 5) for x in v]
    anchor = {
        "asset": src.name,
        "emitter_mesh": a.mesh,
        "lens_center": r3(ctr),
        "emit_dir": r3(d),
        "light_pos": r3(ctr + d * a.offset),
        "lens_radius": round(float(np.linalg.norm(pos - ctr, axis=1).max()), 5),
        "body_bbox_min": r3(allp.min(0)),
        "body_bbox_max": r3(allp.max(0)),
        "note": "좌표계는 GLB 로컬(모델) 공간. light_pos 에 SpotLight 를 놓고 emit_dir 로 조준한다. "
                "SpotLight.target 은 light_pos + emit_dir * (조준거리) 에 두면 된다.",
    }
    out = Path(a.out) if a.out else src.with_suffix(".anchors.json")
    out.write_text(json.dumps(anchor, ensure_ascii=False, indent=1) + "\n")
    print(f"{out.name}: {json.dumps(anchor, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
