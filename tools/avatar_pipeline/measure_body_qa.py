"""체형 변화를 숫자로 남긴다 — "코드상 맞다" 대신 실측을 보고하기 위한 도구.

렌더만으로는 "배만 나온 것"과 "전신에 지방이 붙은 것"을 구분해 말하기 어렵다.
게임엔진 리그의 본 이름별로 가중치가 걸린 정점의 바운딩을 재서, 몸통뿐 아니라
팔·목·머리도 함께 굵어졌는지 부위별로 보여준다.

  blender --background --python measure_body_qa.py -- avatar.glb [avatar2.glb ...]
"""

from __future__ import annotations

from pathlib import Path
import sys

import bpy


REGIONS = ("spine_01", "spine_02", "spine_03", "upperarm_l", "lowerarm_l", "neck_01", "head")


def group_extent(obj, group_name: str, minimum_weight: float = 0.35):
    group = obj.vertex_groups.get(group_name)
    if group is None:
        return None
    points = []
    for vertex in obj.data.vertices:
        weight = next(
            (m.weight for m in vertex.groups if m.group == group.index),
            0.0,
        )
        if weight >= minimum_weight:
            points.append(obj.matrix_world @ vertex.co)
    if not points:
        return None
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    zs = [p.z for p in points]
    return (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def body_mesh():
    meshes = [
        obj
        for obj in bpy.data.objects
        if obj.type == "MESH"
        and not any(c.name == "glTF_not_exported" for c in obj.users_collection)
    ]
    skin = [
        obj
        for obj in meshes
        if any(m and "asianskin" in m.name.lower() for m in obj.data.materials)
    ]
    candidates = skin or meshes
    return max(candidates, key=lambda obj: len(obj.data.vertices))


for argument in sys.argv[sys.argv.index("--") + 1 :]:
    path = Path(argument).resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    body = body_mesh()

    world = [body.matrix_world @ v.co for v in body.data.vertices]
    height = max(p.z for p in world) - min(p.z for p in world)
    torso = group_extent(body, "spine_02")
    print(f"[measure] {path.name} verts={len(body.data.vertices)} height={height:.4f}")
    if torso:
        # 몸통 깊이/키 비율 — 배가 앞뒤로 얼마나 깊어졌는지의 대표 지표
        print(
            f"[measure]   torso(spine_02) width={torso[0]:.4f} depth={torso[1]:.4f} "
            f"depth/height={torso[1] / height:.4f} depth/width={torso[1] / torso[0]:.4f}"
        )
    for region in REGIONS:
        extent = group_extent(body, region)
        if extent is None:
            continue
        # 사지·목·머리의 둘레 대용값으로 가로x깊이의 기하평균을 쓴다
        girth = (extent[0] * extent[1]) ** 0.5
        print(
            f"[measure]   {region:<11} w={extent[0]:.4f} d={extent[1]:.4f} "
            f"h={extent[2]:.4f} girth~{girth:.4f}"
        )
