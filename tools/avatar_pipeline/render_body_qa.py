"""전신 실루엣 QA 렌더 — 정면/45°/측면을 한 장의 시트로 뽑는다.

`render_morph_qa.py`는 얼굴 클로즈업, `render_garment_qa.py`는 의상 단품용이라
"배가 공처럼 튀어나왔는가", "의상에 각진 면이 있는가" 같은 체형 판정에는 쓸 수 없다.
배 돌출은 옆에서만 보이므로 측면 앵글이 이 스크립트의 존재 이유다.

  blender --background --python render_body_qa.py -- avatar.glb out_dir [label] [--skin-only]

출력: out_dir/{label}_front.png, _q45.png, _side.png

`--skin-only`가 왜 필요한가: 이 파이프라인은 몸만 교체하고 의상은 프로덕션
GLB의 것을 그대로 보존한다. 그래서 옷 입은 채로 렌더하면 체형을 바꿔도
실루엣이 거의 그대로다 — 옷이 옛 체형에 맞춰 구워져 있기 때문이다.
배 윤곽을 판정하려면 의상을 걷어내고 봐야 한다.
"""

from __future__ import annotations

import math
from pathlib import Path
import re
import sys

import bpy
import mathutils


argv = sys.argv[sys.argv.index("--") + 1 :]
skin_only = "--skin-only" in argv
argv = [item for item in argv if item != "--skin-only"]
if len(argv) not in (2, 3):
    raise SystemExit(
        "Usage: blender --background --python render_body_qa.py -- "
        "avatar.glb out-dir [label] [--skin-only]"
    )

source = Path(argv[0]).resolve()
output_dir = Path(argv[1]).resolve()
label = argv[2] if len(argv) == 3 else source.stem
output_dir.mkdir(parents=True, exist_ok=True)

# 런타임 `garmentSlot()`과 같은 토큰. 여기서 갈라지면 QA가 실제로 보이는 것과
# 다른 것을 보게 된다.
GARMENT_TOKENS = re.compile(
    r"(sock|stocking|shoe|sneaker|loafer|boot|slipper|pants|trouser|slacks|jeans|skirt"
    r"|bottom|clothing|shirt|tshirt|t-shirt|blouse|sweater|pullover|cardigan|tunic"
    r"|jacket|gown|top)"
)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))

# glTF 임포터는 본 표시용 Icosphere(반지름 1m, 42정점)를 `glTF_not_exported`
# 컬렉션에 만든다. 렌더에는 안 나오지만 바운딩에 섞이면 2m 구를 기준으로
# 카메라가 잡혀 아바타가 화면 구석에 작게 찍힌다.
meshes = [
    obj
    for obj in bpy.data.objects
    if obj.type == "MESH"
    and not any(
        collection.name == "glTF_not_exported" for collection in obj.users_collection
    )
]
if not meshes:
    raise RuntimeError("No meshes in GLB")

if skin_only:
    hidden = []
    for obj in list(meshes):
        identity = " ".join(
            [obj.name] + [m.name for m in obj.data.materials if m]
        ).lower()
        if GARMENT_TOKENS.search(identity):
            hidden.append(obj.name)
            obj.hide_render = True
            meshes.remove(obj)
    print(f"[body-qa] skin-only hides {hidden}")
    if not meshes:
        # 의상 도너 GLB에 --skin-only를 걸면 남는 게 없다. 여기서 세우지 않으면
        # 바운딩이 ±1e9로 남아 카메라가 엉뚱한 곳을 보고 빈 화면을 저장한다.
        raise RuntimeError("--skin-only removed every mesh; this GLB is garments only")

# 바운딩은 실제 정점으로 잡는다. bound_box는 셰이프키/모디파이어 이전 값이라
# 스케일이 튀는 경우가 있고, 카메라 프레이밍이 어긋나면 전/후 비교가 무의미해진다.
minimum = mathutils.Vector((1e9, 1e9, 1e9))
maximum = mathutils.Vector((-1e9, -1e9, -1e9))
for obj in meshes:
    for vertex in obj.data.vertices:
        world = obj.matrix_world @ vertex.co
        minimum = mathutils.Vector(map(min, minimum, world))
        maximum = mathutils.Vector(map(max, maximum, world))

center = (minimum + maximum) * 0.5
height = max(0.2, maximum.z - minimum.z)
radius = max(height * 0.55, (maximum - minimum).xy.length * 0.6)

camera_data = bpy.data.cameras.new("body-qa-camera")
camera_data.lens = 55
camera = bpy.data.objects.new("body-qa-camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
bpy.context.scene.camera = camera

# 조명은 카메라와 함께 돌지 않는다. 고정 3점 조명이라야 전/후 두 장에서
# 같은 면에 같은 그림자가 떨어지고, 실루엣 변화만 차이로 남는다.
for offset, energy, size in (
    ((1.9, -2.6, 1.7), 900, 2.2),
    ((-2.2, -1.4, 1.0), 420, 2.8),
    ((0.2, 2.6, 1.4), 320, 2.4),
):
    light_data = bpy.data.lights.new("body-qa-light", "AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new("body-qa-light", light_data)
    light.location = center + mathutils.Vector(offset)
    light.rotation_euler = (
        (center - light.location).to_track_quat("-Z", "Y").to_euler()
    )
    bpy.context.scene.collection.objects.link(light)

world = bpy.data.worlds.new("body-qa-world")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.065, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 620
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.look = "AgX - Medium High Contrast"

# 0° 정면 / 45° / 90° 측면. 측면이 배 돌출 형태를 판정하는 기준 앵글이다.
for name, degrees in (("front", 0.0), ("q45", 45.0), ("side", 90.0)):
    angle = math.radians(degrees)
    distance = radius * 3.4
    camera.location = (
        center.x + math.sin(angle) * distance,
        center.y - math.cos(angle) * distance,
        center.z + height * 0.06,
    )
    camera.rotation_euler = (
        (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    )
    destination = output_dir / f"{label}_{name}.png"
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    print(f"[body-qa] {label} {name} -> {destination}")

print(
    "[body-qa] BOUNDS",
    label,
    f"min={tuple(round(v, 4) for v in minimum)}",
    f"max={tuple(round(v, 4) for v in maximum)}",
)
