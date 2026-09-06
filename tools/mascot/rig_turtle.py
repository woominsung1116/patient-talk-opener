#!/usr/bin/env blender --background --python
"""거북이 GLB → 감축 + 뼈대 + 자동 웨이트 + 테스트 애니메이션.

뼈 위치는 눈대중이 아니라 measure_mesh.py 로 **메시를 잘라 재서** 얻었다
(높이 1.0 정규화 기준):

    z 0.00~0.05  좌우 갈라진 두 발 — 중심 x −0.13 / +0.19
    z 0.40~0.55  폭 최대 0.74, 왼끝 −0.374  → 든 왼팔이 뻗은 구간
    z 0.60~0.65  왼쪽에 빈 구간          → 든 손이 머리에서 분리됨
    z 0.70~      폭 0.48 로 축소          → 여기부터 머리만

원본 그림이 3/4 시점이라 재구성 메시가 좌우 대칭이 아니다(오른쪽이 더 넓다).
그래서 좌우 뼈를 거울로 놓지 않고 각각 잰 값을 쓴다.

실행:
  blender --background --python rig_turtle.py -- <in.glb> <out.glb> [목표삼각수]
"""
import math
import os
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB_IN = os.path.abspath(argv[0])
GLB_OUT = os.path.abspath(argv[1])
TARGET_TRIS = int(argv[2]) if len(argv) > 2 else 26000

# ── 실측 뼈 좌표 (head, tail) ────────────────────────────────────────
AXIS_X = 0.02          # 몸통 중심축 — 메시가 살짝 오른쪽으로 치우쳐 있다
BONES = [
    ("root",       (AXIS_X, 0, 0.00),      (AXIS_X, 0, 0.12),     None),
    ("hips",       (AXIS_X, 0, 0.18),      (AXIS_X, 0, 0.36),     "root"),
    ("spine",      (AXIS_X, 0, 0.36),      (AXIS_X, 0, 0.55),     "hips"),
    ("neck",       (AXIS_X, 0, 0.55),      (AXIS_X, 0, 0.66),     "spine"),
    ("head",       (AXIS_X, 0, 0.66),      (AXIS_X, 0, 0.95),     "neck"),
    # 왼팔 — 들어올린 쪽. 어깨에서 손까지 위로 뻗는다.
    ("shoulder.L", (-0.09, 0, 0.52),       (-0.20, 0, 0.535),     "spine"),
    ("arm.L",      (-0.20, 0, 0.535),      (-0.305, 0, 0.615),    "shoulder.L"),
    # 오른팔 — 내린 쪽
    ("shoulder.R", (0.13, 0, 0.49),        (0.225, 0, 0.455),     "spine"),
    ("arm.R",      (0.225, 0, 0.455),      (0.335, 0, 0.365),     "shoulder.R"),
    # 다리
    ("thigh.L",    (-0.105, 0, 0.21),      (-0.128, 0, 0.065),    "hips"),
    ("foot.L",     (-0.128, 0, 0.065),     (-0.128, -0.09, 0.03), "thigh.L"),
    ("thigh.R",    (0.155, 0, 0.21),       (0.190, 0, 0.065),     "hips"),
    ("foot.R",     (0.190, 0, 0.065),      (0.190, -0.09, 0.03),  "thigh.R"),
]


def normalize(objs):
    """높이 1.0, 발바닥 z=0, 좌우 중심 정렬. 뼈 좌표가 이 기준이다."""
    pts = []
    for o in objs:
        mw = o.matrix_world
        pts += [mw @ v.co for v in o.data.vertices]
    lo = mathutils.Vector((min(p[i] for p in pts) for i in range(3)))
    hi = mathutils.Vector((max(p[i] for p in pts) for i in range(3)))
    s = 1.0 / max(hi.z - lo.z, 1e-6)
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    root = bpy.data.objects.new("fit", None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        o.parent = root
    root.scale = (s, s, s)
    root.location = (-cx * s, -cy * s, -lo.z * s)
    bpy.context.view_layer.update()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in objs:
        o.select_set(False)
    bpy.data.objects.remove(root, do_unlink=True)


def decimate(obj, target_tris):
    """웹앱에 올릴 수 있게 줄인다. 25만 정점은 모바일에서 무겁다."""
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris <= target_tris:
        return tris
    m = obj.modifiers.new("dec", "DECIMATE")
    m.ratio = target_tris / tris
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def build_armature():
    arm = bpy.data.armatures.new("turtle_rig")
    rig = bpy.data.objects.new("rig", arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for name, head, tail, parent in BONES:
        b = arm.edit_bones.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = made[parent]
            b.use_connect = False
        made[name] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def wave_test(rig, fps=60):
    """손 흔들며 인사 — 팔을 올리고 좌우로 흔든 뒤 내린다.

    ★ 회전축은 재서 골랐다. 블렌더 본의 로컬 **Y 는 뼈를 따라가는 방향**이라
      Y 회전은 '비틀기'가 되어 화면상 이동량이 정확히 0 이다(실측). 처음에
      팔이 안 움직인 원인이 이것이었다. 축별로 45° 돌려 손끝의 화면상 이동을
      재보니 X 0.070 / Y 0.000 / Z 0.058 이라 **X 축**을 쓴다.

    타이밍은 CPX Mate 실측: 대부분 정지, 어택은 짧고, 릴리스는 그 3배,
    마지막에 기준선을 지나쳐 튀었다 안착.
    """
    sc = bpy.context.scene
    sc.render.fps = fps
    sc.frame_start, sc.frame_end = 1, 184
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")

    def key(bone, chan, frames):
        pb = rig.pose.bones[bone]
        pb.rotation_mode = "XYZ"
        for f, deg in frames:
            e = list(pb.rotation_euler)
            e[chan] = math.radians(deg)
            pb.rotation_euler = e
            pb.keyframe_insert("rotation_euler", frame=f)

    # 팔 — 로컬 X 로 흔든다. 들어올린 뒤 좌우 3회.
    key("arm.L", 0, [
        (1, 0), (40, 0),
        (44, 34),                        # 번쩍 든다 (어택 4프레임)
        (58, 58), (72, 14), (86, 58), (100, 14), (114, 52),
        (128, -6), (140, 3), (150, 0), (184, 0),
    ])
    # 어깨도 살짝 따라 올라간다 — 팔만 움직이면 몸에서 떨어져 나온 것처럼 보인다
    key("shoulder.L", 0, [(1, 0), (40, 0), (46, 13), (114, 13), (132, -3), (150, 0), (184, 0)])
    # 고개 살짝 기울임 — 인사로 읽히게
    key("head", 2, [(1, 0), (40, 0), (48, 6), (114, 6), (134, -2), (150, 0), (184, 0)])
    # 몸통은 거의 건드리지 않는다. 앞서 척추를 흔들었더니 인사가 아니라
    # 비틀거리는 것처럼 보였다.
    key("spine", 0, [(1, 0), (40, 0), (46, -2), (114, -1.5), (132, 0.8), (150, 0), (184, 0)])

    bpy.ops.object.mode_set(mode="OBJECT")

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB_IN)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        raise SystemExit("[FATAL] 메시 없음")
    normalize(objs)

    # 여러 조각이면 하나로 합친다 — 뼈대는 오브젝트 하나에 물리는 게 깔끔하다
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.active_object
    mesh.name = "turtle"
    before = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    after = decimate(mesh, TARGET_TRIS)
    print(f"[rig] 삼각형 {before:,} → {after:,}")

    rig = build_armature()
    # 자동 웨이트 — 1차로는 이걸로 충분하고, 어깨가 뭉개지면 손으로 다듬는다
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    print(f"[rig] 본 {len(rig.data.bones)}개, 버텍스그룹 {len(mesh.vertex_groups)}개")

    wave_test(rig)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=GLB_OUT, export_format="GLB", export_yup=True,
        export_animations=True, export_skins=True, export_apply=False)
    print(f"[rig] GLB → {GLB_OUT}")


main()
