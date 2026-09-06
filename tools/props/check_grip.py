"""청진 그립 검증 — 씬의 절차 체스트피스를 손 앵커 자리에 놓고 렌더한다.

체스트피스는 **에셋이 아니라 코드**다(`ClinicScene.tsx` `Chestpiece()`: 실린더+토러스).
그래서 라이선스 문제가 없고, 여기서도 같은 치수를 그대로 재현해 검증한다.
치수 출처: ClinicScene.tsx `Chestpiece()` × `CHESTPIECE_SCALE`(0.5).

⚠ 축 함정 두 개:
  1) glTF → Blender 임포트는 (x, y, z) → (x, −z, y). 앵커 JSON 은 glTF 공간이므로
     그대로 Blender 위치로 쓰면 디스크가 손에서 멀리 떨어진 자리에 놓인다(이전 오진 원인).
  2) 손은 이미 씬 규약으로 정렬돼 있다: 원점=손목, 손끝=−Y, **손바닥=+Z**.
     즉 환자 피부는 손바닥 쪽인 **+Z** 에 있다. 체스트피스의 '위'(스템이 붙는 쪽)는 −Z 를 봐야 한다.

사용:
  blender --background --python tools/props/check_grip.py -- <hand_grip_disc.glb> <out.png>
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
Path(OUT).parent.mkdir(parents=True, exist_ok=True)

SCALE = 0.5          # CHESTPIECE_SCALE
FINGER_PAD = 0.009   # 손끝 본에서 살(손가락 배)까지. 본 좌표에 그대로 놓으면 디스크가 손가락에 박힌다


def g2b_point(v) -> Vector:
    """glTF 위치 → Blender 위치."""
    return Vector((v[0], -v[2], v[1]))


def g2b_dir(v) -> Vector:
    return Vector((v[0], -v[2], v[1]))


for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=GLB)

a = json.loads(Path(GLB).with_suffix(".anchors.json").read_text())
if "frame" not in a:
    raise SystemExit("정렬 안 된 손이다 — --no-align 로 만든 파일에는 이 검증을 쓸 수 없다")

grip = g2b_point(a["grip_two_finger"])
idx = g2b_point(a["index_tip"])
mid = g2b_point(a["middle_tip"])
palm_n = g2b_dir((0, 0, 1))        # 손바닥 법선(= 환자 피부 쪽)
finger = g2b_dir((0, -1, 0))       # 손끝 방향

# 체스트피스 기준틀: 로컬 +Y(스템이 붙는 위) → 피부 반대쪽(−palm_n),
#                    로컬 +X(스템이 나오는 옆) → 손목 쪽(−finger, 튜브가 의사에게 간다)
up = (-palm_n).normalized()
side = (-finger).normalized()
side = (side - up * side.dot(up)).normalized()
fwd = up.cross(side).normalized()
basis = Matrix((side, fwd, up)).transposed().to_4x4()   # 열이 로컬축 상(像)

# 디스크 중심 — 손끝 본에서 살 두께 + 드럼 반높이만큼 피부 쪽으로 내린다
center = grip + palm_n * (FINGER_PAD + 0.010 * SCALE)
place = Matrix.Translation(center) @ basis

chrome = bpy.data.materials.new("chrome")
chrome.use_nodes = True
b = chrome.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.79, 0.81, 0.83, 1)
b.inputs["Metallic"].default_value = 0.92
b.inputs["Roughness"].default_value = 0.16
black = bpy.data.materials.new("black")
black.use_nodes = True
bb = black.node_tree.nodes["Principled BSDF"]
bb.inputs["Base Color"].default_value = (0.02, 0.02, 0.03, 1)
bb.inputs["Roughness"].default_value = 0.5
memb = bpy.data.materials.new("membrane")
memb.use_nodes = True
mb = memb.node_tree.nodes["Principled BSDF"]
mb.inputs["Base Color"].default_value = (0.93, 0.95, 0.96, 1)
mb.inputs["Roughness"].default_value = 0.32

parts = []


def add(prim, mat, loc, rot=None, **kw):
    prim(location=(0, 0, 0), **kw)
    ob = bpy.context.active_object
    m = Matrix.Translation(Vector(loc) * SCALE)
    if rot is not None:
        m = m @ rot
    ob.matrix_world = place @ m @ Matrix.Diagonal((SCALE, SCALE, SCALE, 1.0))
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    parts.append(ob)
    return ob


# ClinicScene 의 Chestpiece() 를 그대로 옮긴 것 (three.js Y-up 과 Blender Z-up 이 달라
# three 의 y 를 여기서는 z 로 읽는다)
add(bpy.ops.mesh.primitive_cone_add, chrome, (0, 0, 0),
    radius1=0.047, radius2=0.043, depth=0.02, vertices=44)                      # 드럼
add(bpy.ops.mesh.primitive_torus_add, chrome, (0, 0, 0.012),
    major_radius=0.041, minor_radius=0.006, major_segments=32, minor_segments=12)  # 림
add(bpy.ops.mesh.primitive_torus_add, black, (0, 0, 0.014),
    major_radius=0.037, minor_radius=0.003, major_segments=32, minor_segments=10)  # 씰
add(bpy.ops.mesh.primitive_cylinder_add, memb, (0, 0, 0.0155),
    radius=0.036, depth=0.0035, vertices=44)                                    # 진동막
stem_rot = Matrix.Rotation(-0.55, 4, "Y")
add(bpy.ops.mesh.primitive_cylinder_add, chrome, (0.05, 0, 0.016), stem_rot,
    radius=0.0095, depth=0.055, vertices=18)                                    # 크롬 스템
add(bpy.ops.mesh.primitive_cone_add, black, (0.05 + 0.05 * math.sin(0.55), 0, 0.016 + 0.05 * math.cos(0.55)),
    stem_rot, radius1=0.0095, radius2=0.012, depth=0.035, vertices=18)          # 검은 튜브 목

# 환자 피부 대용 평면 — 디스크 밑면 높이에 깔아 "닿았다"가 보이게.
# 크게 깔면 아래팔까지 관통해서 무엇이 닿았는지 안 보인다. 접촉부 주변만.
skin_y = center + palm_n * (0.010 * SCALE)
bpy.ops.mesh.primitive_plane_add(size=0.12, location=skin_y)
plane = bpy.context.active_object
plane.rotation_euler = palm_n.to_track_quat("Z", "Y").to_euler()
sk = bpy.data.materials.new("skin_plane")
sk.use_nodes = True
sn = sk.node_tree.nodes["Principled BSDF"]
sn.inputs["Base Color"].default_value = (0.78, 0.58, 0.49, 1)
sn.inputs["Roughness"].default_value = 0.72
plane.data.materials.append(sk)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o is not plane]
pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
ctr = Vector([(min(p[i] for p in pts) + max(p[i] for p in pts)) / 2 for i in range(3)])
size = max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))

for loc, e in (((1.3, -1.5, 1.3), 300), ((-1.5, -0.9, 0.6), 130), ((0.3, 1.7, 1.0), 160)):
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
w.node_tree.nodes["Background"].inputs[0].default_value = (0.06, 0.065, 0.075, 1)
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        continue
sc.render.resolution_x = sc.render.resolution_y = 760

# 시점: doctor = 의사 눈높이(손등 위 비스듬히), side = 손가락 사이 간격이 보이는 옆, front = 정면
VIEWS = {
    "doctor": (0.55, -0.35, -1.0),   # glTF 기준: 손등(−Z) 위쪽에서
    "side": (1.0, -0.1, -0.25),
    "front": (0.0, -1.0, -0.35),
}
for tag, gdir in VIEWS.items():
    for o in [x for x in sc.objects if x.type == "CAMERA"]:
        bpy.data.objects.remove(o, do_unlink=True)
    d = g2b_dir(gdir).normalized()
    bpy.ops.object.camera_add(location=ctr + d * size * 1.7)
    cam = bpy.context.active_object
    bpy.ops.object.empty_add(location=ctr)
    cam.constraints.new("TRACK_TO").target = bpy.context.active_object
    sc.camera = cam
    sc.render.filepath = OUT.replace(".png", f"_{tag}.png")
    bpy.ops.render.render(write_still=True)
    print(f"[grip] {sc.render.filepath}")

print(f"[grip] 디스크 중심 {tuple(round(x, 4) for x in center)}  "
      f"검지끝↔중지끝 {(idx - mid).length * 100:.2f}cm  드럼 지름 {0.047 * 2 * SCALE * 100:.1f}cm")
