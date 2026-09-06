"""정렬된 손 GLB 의 축 규약을 **눈으로** 확인한다 — 손바닥이 정말 +Z 를 보는가.

수치(내적 부호)만으로는 손등과 손바닥이 뒤집혀도 통과할 수 있다. 규약은 씬의
`handQuat(finger, palm)` 이 그대로 믿고 쓰는 값이라 틀리면 손이 뒤집힌 채 환자를 만진다.

glTF → Blender 임포트는 (x, y, z) → (x, −z, y) 로 축을 되돌린다. 그래서 카메라를
"glTF 공간의 어느 방향"에 두려면 그 변환을 거쳐 배치해야 한다. 뷰 이름은 glTF 기준이다.

사용:
  blender --background --python tools/props/check_hand_axes.py -- <hand.glb> <out_dir>
"""
import math
import os
import sys
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
Path(OUT).mkdir(parents=True, exist_ok=True)

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=GLB)


def g2b(v):
    """glTF 방향 → Blender 방향."""
    return (v[0], -v[2], v[1])


hand = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.name.startswith("hand"))
pts = [hand.matrix_world @ v.co for v in hand.data.vertices]
ctr = [(min(p[i] for p in pts) + max(p[i] for p in pts)) / 2 for i in range(3)]
size = max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))

for loc, e in (((1.4, -1.6, 1.5), 260), ((-1.6, -1.0, 0.7), 110), ((0.4, 1.8, 1.1), 140)):
    bpy.ops.object.light_add(type="AREA", location=[ctr[i] + loc[i] * size for i in range(3)])
    L = bpy.context.active_object
    L.data.energy = e * size * size
    L.data.size = size * 1.2
    c = L.constraints.new("TRACK_TO")
    bpy.ops.object.empty_add(location=ctr)
    c.target = bpy.context.active_object

w = bpy.context.scene.world or bpy.data.worlds.new("w")
bpy.context.scene.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.065, 1)
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        continue
sc.render.resolution_x = sc.render.resolution_y = 640

VIEWS = {
    "palmZplus": (0, 0, 1),      # 여기서 손바닥이 보여야 한다
    "backZminus": (0, 0, -1),    # 여기서 손등이 보여야 한다
    "tipYminus": (0, -1, 0),     # 손끝이 카메라를 향해야 한다
    "thumbXplus": (1, 0, 0),
}
stem = Path(GLB).stem
for name, gdir in VIEWS.items():
    for o in [x for x in sc.objects if x.type == "CAMERA"]:
        bpy.data.objects.remove(o, do_unlink=True)
    d = g2b(gdir)
    n = math.sqrt(sum(c * c for c in d))
    loc = [ctr[i] + d[i] / n * size * 1.9 for i in range(3)]
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.active_object
    bpy.ops.object.empty_add(location=ctr)
    cam.constraints.new("TRACK_TO").target = bpy.context.active_object
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, f"{stem}_{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"[axes] {sc.render.filepath}")
