#!/usr/bin/env blender --background --python
"""리깅된 GLB 의 애니메이션 프레임을 몇 장 뽑아 변형을 눈으로 확인한다.

자동 웨이트는 대개 1차로는 쓸 만하지만 어깨·목처럼 부위가 만나는 곳이
뭉개지는 경우가 많다. 팔을 실제로 굽혀 봐야 알 수 있으므로, 정지 프레임과
제스처 정점 프레임을 나란히 뽑는다.

실행:
  blender --background --python render_anim.py -- <rigged.glb> <out_prefix> [프레임,프레임,...]
"""
import math
import os
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB = os.path.abspath(argv[0])
PREFIX = os.path.abspath(argv[1])
_spec = argv[2] if len(argv) > 2 else "1,88,100,124"
if "-" in _spec and ":" in _spec:          # 범위: 시작-끝:간격
    _r, _st = _spec.split(":")
    _a, _b = _r.split("-")
    FRAMES = list(range(int(_a), int(_b) + 1, int(_st)))
else:
    FRAMES = [int(x) for x in _spec.split(",")]
YAW = float(argv[3]) if len(argv) > 3 else 0.0   # 캐릭터를 돌려 다른 각도로 본다

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objs:
    raise SystemExit("[FATAL] 메시 없음")

# GLB 왕복(Z-up ↔ Y-up)을 거치면 스케일이 달라져 카메라 프레이밍이 어긋난다.
# 여기서도 높이 1.0·발바닥 z=0 으로 맞춘다. 아마추어가 있으면 그걸 스케일해야
# 메시가 따라온다.
_all = [o for o in bpy.context.scene.objects if o.type in ("MESH", "ARMATURE")]
_pts = []
for _o in objs:
    _mw = _o.matrix_world
    _pts += [_mw @ _v.co for _v in _o.data.vertices]
_lo = mathutils.Vector((min(q[i] for q in _pts) for i in range(3)))
_hi = mathutils.Vector((max(q[i] for q in _pts) for i in range(3)))
_s = 1.0 / max(_hi.z - _lo.z, 1e-6)
_cx, _cy = (_lo.x + _hi.x) / 2, (_lo.y + _hi.y) / 2
_fit = bpy.data.objects.new("fit", None)
bpy.context.collection.objects.link(_fit)
for _o in _all:
    if _o.parent is None:
        _o.parent = _fit
        _o.matrix_parent_inverse = _fit.matrix_world.inverted()
_fit.scale = (_s, _s, _s)
_fit.location = (-_cx * _s, -_cy * _s, -_lo.z * _s)
_fit.rotation_euler = (0, 0, math.radians(YAW))
bpy.context.view_layer.update()

# 클레이 재질 — build_turtle.py 와 같은 값이라 앞선 렌더들과 비교된다
m = bpy.data.materials.new("clay")
m.use_nodes = True
b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.375, 0.635, 0.335, 1.0)
b.inputs["Roughness"].default_value = 0.88
for k, v in (("Subsurface Weight", 0.14), ("Subsurface Scale", 0.06)):
    if k in b.inputs:
        b.inputs[k].default_value = v
# 이미 텍스처가 붙어 있으면 그대로 쓴다. 덮어쓰면 투영해 넣은 원본 색이 날아간다.
def _has_tex(ob):
    for slot in ob.material_slots:
        mt = slot.material
        if mt and mt.use_nodes and any(n.type == "TEX_IMAGE" for n in mt.node_tree.nodes):
            return True
    return False


for o in objs:
    if not _has_tex(o):
        o.data.materials.clear()
        o.data.materials.append(m)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth()

w = bpy.data.worlds.new("W")
bpy.context.scene.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.86, 0.88, 0.90, 1)
bg.inputs["Strength"].default_value = 0.32


def area(name, loc, size_, energy, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, type="AREA")
    d.size, d.energy, d.color = size_, energy, color
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = (mathutils.Vector((0, 0, 0.55))
                        - mathutils.Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(o)


area("key", (-1.1, -1.5, 1.9), 1.8, 34, (1.00, 0.98, 0.95))
area("fill", (1.5, -1.1, 0.8), 2.2, 11, (0.92, 0.95, 1.00))
area("rim", (0.4, 1.6, 1.5), 1.4, 16)

sc = bpy.context.scene
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 85
cam = bpy.data.objects.new("cam", cam_d)
cam.location = (0.0, -3.4, 0.62)
cam.rotation_euler = (math.radians(90), 0, 0)
bpy.context.collection.objects.link(cam)
sc.camera = cam

engines = sc.render.bl_rna.properties["engine"].enum_items.keys()
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 560, 716
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "Standard"

for f in FRAMES:
    sc.frame_set(f)
    sc.render.filepath = f"{PREFIX}_f{f:03d}.png"
    bpy.ops.render.render(write_still=True)
    print(f"[anim] frame {f} → {sc.render.filepath}")
