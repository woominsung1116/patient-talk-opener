#!/usr/bin/env blender --background --python
"""GLB 메시를 높이별로 잘라 부위 위치를 잰다 — 뼈를 놓기 위한 근거.

뼈 위치를 눈대중으로 주면 어깨가 몸 안에 박히거나 팔 밖으로 나간다.
높이 1.0 으로 정규화한 뒤 z 를 잘게 썰어, 각 높이에서 좌우로 팔이 어디까지
뻗는지·다리가 어디서 갈라지는지를 숫자로 뽑는다.

실행:
  blender --background --python measure_mesh.py -- <in.glb>
"""
import os
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB = os.path.abspath(argv[0])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# 월드 좌표 정점을 모아 높이 1.0 으로 정규화 (발바닥 z=0)
pts = []
for o in objs:
    mw = o.matrix_world
    pts += [mw @ v.co for v in o.data.vertices]
lo = mathutils.Vector((min(p[i] for p in pts) for i in range(3)))
hi = mathutils.Vector((max(p[i] for p in pts) for i in range(3)))
s = 1.0 / max(hi.z - lo.z, 1e-6)
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
P = [((p.x - cx) * s, (p.y - cy) * s, (p.z - lo.z) * s) for p in pts]

print(f"정점 {len(P):,}   원본크기 {(hi-lo).x:.2f} x {(hi-lo).y:.2f} x {(hi-lo).z:.2f}")
print("\n  z     폭      좌단     우단    앞      뒤    | 좌우 덩어리(팔·다리 갈림)")
STEP = 0.05
z = 0.0
while z < 1.0:
    band = [p for p in P if z <= p[2] < z + STEP]
    if len(band) < 30:
        z += STEP
        continue
    xs = sorted(p[0] for p in band)
    ys = [p[1] for p in band]
    # x 히스토그램에서 빈 구간을 찾아 좌우가 갈라졌는지 본다
    gaps = []
    for a, b in zip(xs, xs[1:]):
        if b - a > 0.035:
            gaps.append((round(a, 3), round(b, 3)))
    print(f"{z:5.2f}  {xs[-1]-xs[0]:5.3f}  {xs[0]:7.3f} {xs[-1]:7.3f} "
          f"{min(ys):6.3f} {max(ys):6.3f} | {gaps[:3]}")
    z += STEP
