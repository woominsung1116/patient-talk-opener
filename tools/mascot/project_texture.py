#!/usr/bin/env blender --background --python
"""원본 그림을 메시에 정면 투영해 색을 입힌다.

왜 이 방법인가:
  Hunyuan3D 의 텍스처 생성은 `custom_rasterizer`(CUDA 전용, setup.py 에
  "nvcc is needed" 명시)를 요구해 이 맥에서는 불가능하다.
  그런데 이 메시는 **바로 그 그림에서 생성**됐으므로 정면이 정확히 맞는다.
  카메라 뷰로 UV 를 펴고 원본 PNG 를 물리면 앞면은 픽셀 그대로 나온다.

  뒷면은 투영이 늘어나므로 등껍질 색으로 덮는다 — 어차피 원본에도 뒷면 정보는 없다.

실행:
  blender --background --python project_texture.py -- <in.glb> <image.png> <out.glb> [out.png]
"""
import math
import os
import sys

import bpy
import bmesh
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB_IN, IMG, GLB_OUT = (os.path.abspath(a) for a in argv[:3])
# UV 상자를 잴 '알파가 살아 있는' 원본. IMG 가 edge-padded(전부 불투명) 라면
# 그걸로 상자를 재면 그림 전체가 되어 투영이 어긋난다.
ALPHA_REF = os.environ.get("ALPHA_REF", "") or IMG
PNG_OUT = os.path.abspath(argv[3]) if len(argv) > 3 else ""

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB_IN)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objs:
    raise SystemExit("[FATAL] 메시 없음")

# 높이 1.0, 발바닥 z=0 — 다른 스크립트와 같은 기준
pts = []
for o in objs:
    mw = o.matrix_world
    pts += [mw @ v.co for v in o.data.vertices]
lo = mathutils.Vector((min(p[i] for p in pts) for i in range(3)))
hi = mathutils.Vector((max(p[i] for p in pts) for i in range(3)))
s = 1.0 / max(hi.z - lo.z, 1e-6)
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
for o in objs:
    o.scale = (s, s, s)
    o.location = (-cx * s, -cy * s, -lo.z * s)
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(objs) > 1:
    bpy.ops.object.join()
mesh = bpy.context.active_object
mesh.name = "turtle"

# ── 정면 정사영 UV 를 직접 계산 ──────────────────────────────────
# bpy.ops.uv.project_from_view 는 3D 뷰 컨텍스트를 요구해 배경 모드에서 안 된다.
# 정사영 투영의 UV 는 결국 정점의 x,z 를 선형 매핑한 것이라 직접 계산이 더 정확하다.
#
# 메시 실루엣 상자를 **그림의 불투명 영역 상자**에 맞춘다. 그림 전체에 맞추면
# 여백만큼 어긋난다.
# 블렌더 내장 파이썬에는 PIL 이 없다. 자체 이미지 API 로 알파 상자를 잰다.
# pixels 는 RGBA 평면 배열이고 **좌하단이 원점**이라 y 를 뒤집어 읽는다.
_img = bpy.data.images.load(ALPHA_REF)
_W, _H = _img.size
_px = list(_img.pixels)
_ix0, _ix1, _iy0, _iy1 = _W, 0, _H, 0
for _row in range(_H):
    _base = _row * _W * 4
    for _col in range(_W):
        if _px[_base + _col * 4 + 3] > 0.08:
            _y = _H - 1 - _row                    # 위→아래 좌표계로
            if _col < _ix0: _ix0 = _col
            if _col > _ix1: _ix1 = _col
            if _y < _iy0: _iy0 = _y
            if _y > _iy1: _iy1 = _y
print(f"[proj] 그림 불투명 상자 x {_ix0}-{_ix1}  y {_iy0}-{_iy1}  (전체 {_W}x{_H})")

_vs = [v.co for v in mesh.data.vertices]
_mx0, _mx1 = min(v.x for v in _vs), max(v.x for v in _vs)
_mz0, _mz1 = min(v.z for v in _vs), max(v.z for v in _vs)
_mw, _mh = max(_mx1 - _mx0, 1e-6), max(_mz1 - _mz0, 1e-6)

uv_layer = mesh.data.uv_layers.new(name="proj") if not mesh.data.uv_layers \
    else mesh.data.uv_layers.active
for loop in mesh.data.loops:
    co = mesh.data.vertices[loop.vertex_index].co
    fx = (co.x - _mx0) / _mw                     # 0..1, 왼→오
    fz = (co.z - _mz0) / _mh                     # 0..1, 아래→위
    u = (_ix0 + fx * (_ix1 - _ix0)) / _W
    v = 1.0 - (_iy0 + (1.0 - fz) * (_iy1 - _iy0)) / _H   # 이미지 y 는 위→아래
    uv_layer.data[loop.index].uv = (u, v)
print(f"[proj] UV 투영 완료 — 루프 {len(mesh.data.loops):,}")

# ── 재질: 원본 그림 + 뒷면은 등껍질 색 ────────────────────────────
mat = bpy.data.materials.new("projected")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.90
bsdf.inputs["Metallic"].default_value = 0.0

tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(IMG)
tex.extension = "EXTEND"          # UV 밖은 가장자리 색으로 — 투명 줄무늬 방지
tex.location = (-700, 200)

# 대체색을 쓸 곳 두 가지를 섞어서 판단한다:
#   (1) 뒷면 — 법선이 +Y. 투영이 늘어나 의미 없는 색이 된다.
#   (2) 그림의 투명 영역을 집는 곳 — 실루엣 가장자리에서 UV 가 그림 밖으로
#       나가면 투명(=검정)을 샘플링해 **검은 테두리**가 생긴다(1차 결과의 결함).
#       알파가 낮으면 그대로 대체색으로 덮는 게 확실하다.
geo = nt.nodes.new("ShaderNodeNewGeometry"); geo.location = (-900, -260)
sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-720, -260)
grt = nt.nodes.new("ShaderNodeMath"); grt.operation = "GREATER_THAN"
grt.inputs[1].default_value = -0.05; grt.location = (-540, -300)

inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"
inv.inputs[0].default_value = 1.0; inv.location = (-540, -140)
step = nt.nodes.new("ShaderNodeMath"); step.operation = "GREATER_THAN"
step.inputs[1].default_value = 0.35; step.location = (-380, -140)

both = nt.nodes.new("ShaderNodeMath"); both.operation = "MAXIMUM"
both.location = (-220, -220)

back = nt.nodes.new("ShaderNodeRGB"); back.location = (-380, 60)
back.outputs[0].default_value = (0.085, 0.30, 0.175, 1.0)
mix = nt.nodes.new("ShaderNodeMixRGB"); mix.location = (-40, 60)

nt.links.new(geo.outputs["Normal"], sep.inputs[0])
nt.links.new(sep.outputs["Y"], grt.inputs[0])
nt.links.new(tex.outputs["Alpha"], inv.inputs[1])
nt.links.new(inv.outputs[0], step.inputs[0])
nt.links.new(grt.outputs[0], both.inputs[0])
nt.links.new(step.outputs[0], both.inputs[1])
nt.links.new(both.outputs[0], mix.inputs[0])
nt.links.new(tex.outputs["Color"], mix.inputs[1])
nt.links.new(back.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], bsdf.inputs["Base Color"])

mesh.data.materials.clear()
mesh.data.materials.append(mat)
bpy.ops.object.shade_smooth()

bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
bpy.ops.export_scene.gltf(filepath=GLB_OUT, export_format="GLB", export_yup=True,
                          use_selection=True, export_apply=False)
print(f"[proj] GLB → {GLB_OUT}")

if PNG_OUT:
    # 확인용 렌더 — 다른 QA 와 같은 조명·톤매퍼
    wd = bpy.data.worlds.new("W"); bpy.context.scene.world = wd
    wd.use_nodes = True
    bg = wd.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.86, 0.88, 0.90, 1)
    bg.inputs["Strength"].default_value = 0.32

    def area(name, loc, size_, energy, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, type="AREA")
        d.size, d.energy, d.color = size_, energy, color
        o = bpy.data.objects.new(name, d); o.location = loc
        o.rotation_euler = (mathutils.Vector((0, 0, 0.55))
                            - mathutils.Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.collection.objects.link(o)

    area("key", (-1.1, -1.5, 1.9), 1.8, 34, (1.00, 0.98, 0.95))
    area("fill", (1.5, -1.1, 0.8), 2.2, 11, (0.92, 0.95, 1.00))
    area("rim", (0.4, 1.6, 1.5), 1.4, 16)
    rc = bpy.data.cameras.new("rc"); rc.lens = 85
    rco = bpy.data.objects.new("rc", rc)
    rco.location = (0.0, -3.4, 0.62)
    rco.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(rco)
    sc = bpy.context.scene
    sc.camera = rco
    eng = sc.render.bl_rna.properties["engine"].enum_items.keys()
    sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in eng else "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = 640, 819
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = PNG_OUT
    bpy.ops.render.render(write_still=True)
    print(f"[proj] QA → {PNG_OUT}")
