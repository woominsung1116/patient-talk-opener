#!/usr/bin/env blender --background --python
"""외부에서 만든 GLB 를 우리 클레이 재질·조명으로 렌더해 본다.

modly(Hunyuan3D) 같은 이미지-투-3D 결과는 텍스처 없는 순수 형상으로 나온다.
형태가 쓸 만한지 판단하려면 우리 스튜디오 세팅에 그대로 얹어 봐야 한다 —
build_turtle.py 와 같은 조명·톤매퍼를 써야 앞선 렌더들과 비교가 된다.

실행:
  blender --background --python render_glb.py -- <in.glb> <out.png> [정면회전각]
"""
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB = os.path.abspath(argv[0])
OUT = os.path.abspath(argv[1])
YAW = float(argv[2]) if len(argv) > 2 else 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objs:
    raise SystemExit("[FATAL] GLB 안에 메시가 없다")

# 높이 1.0, 발바닥 z=0 으로 정규화 — 우리 카메라·조명이 그 기준이다
import mathutils
lo = mathutils.Vector((1e9, 1e9, 1e9))
hi = mathutils.Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        lo = mathutils.Vector((min(lo[i], w[i]) for i in range(3)))
        hi = mathutils.Vector((max(hi[i], w[i]) for i in range(3)))
size = hi - lo
scale = 1.0 / max(size.z, 1e-6)
ctr = (lo + hi) / 2

root = bpy.data.objects.new("root", None)
bpy.context.collection.objects.link(root)
for o in objs:
    o.parent = root
root.scale = (scale, scale, scale)
root.location = (-ctr.x * scale, -ctr.y * scale, -lo.z * scale)
root.rotation_euler = (0, 0, math.radians(YAW))

# 클레이 재질 — build_turtle.py 와 같은 값
m = bpy.data.materials.new("clay")
m.use_nodes = True
b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.375, 0.635, 0.335, 1.0)
b.inputs["Roughness"].default_value = 0.88
b.inputs["Metallic"].default_value = 0.0
for k, v in (("Subsurface Weight", 0.14), ("Subsurface Scale", 0.06)):
    if k in b.inputs:
        b.inputs[k].default_value = v
for o in objs:
    o.data.materials.clear()
    o.data.materials.append(m)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth()

# 조명 — build_turtle.py studio() 와 동일
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
    from mathutils import Vector
    o.rotation_euler = (Vector((0, 0, 0.55)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
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

# Blender 버전에 따라 EEVEE 엔진 이름이 다르다
engines = sc.render.bl_rna.properties["engine"].enum_items.keys()
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
sc.render.resolution_x = 640
sc.render.resolution_y = 819
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "Standard"
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"[render_glb] {OUT}  정점 {sum(len(o.data.vertices) for o in objs):,}")
