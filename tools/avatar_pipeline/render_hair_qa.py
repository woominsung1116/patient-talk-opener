"""헤어/의상 관통 판정용 QA 렌더 — 머리와 어깨를 4방향에서 잡는다.

`render_morph_qa.py`는 정면 얼굴 클로즈업 하나뿐이라 "뒤통수가 니트모자처럼
보이는가", "머리카락이 티셔츠를 뚫고 나오는가"를 볼 수 없다. 두 결함 모두
측면·후면에서만 드러난다. `render_body_qa.py`는 전신이라 머리가 100px도 안 된다.

  blender --background --python render_hair_qa.py -- avatar.glb out_dir [label] [--waist]

출력: out_dir/{label}_head_{front,q45,side,back}.png
`--waist`를 주면 머리 대신 목~허리를 잡아 헤어-상의 관통을 크게 본다.
"""

from __future__ import annotations

import math
from pathlib import Path
import sys

import bpy
import mathutils


argv = sys.argv[sys.argv.index("--") + 1 :]
waist = "--waist" in argv
argv = [item for item in argv if item != "--waist"]
# 기본 노출이 0이면 이 조명 배치에서 화면이 날아간다. 중성 회색(36/255) 헤어가
# 밝은 은발로, 피부가 순백으로 찍혀 **에셋 색을 판정할 수 없다** — 실제로 그
# 상태에서 멀쩡한 검은 단발을 "분홍 머리"로 오판할 뻔했다. -1.5 EV에서 피부가
# 피부색으로 나온다.
exposure = -1.5
for item in list(argv):
    if item.startswith("--exposure="):
        exposure = float(item.split("=", 1)[1])
        argv.remove(item)
if len(argv) not in (2, 3):
    raise SystemExit(
        "Usage: blender --background --python render_hair_qa.py -- "
        "avatar.glb out-dir [label] [--waist]"
    )

source = Path(argv[0]).resolve()
output_dir = Path(argv[1]).resolve()
label = argv[2] if len(argv) == 3 else source.stem
output_dir.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))

# glTF 임포터의 본 표시용 Icosphere는 렌더에 안 나오지만 바운딩을 2m 구로
# 부풀려 카메라를 엉뚱한 곳에 세운다. `render_body_qa.py`와 같은 이유로 제외.
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

minimum = mathutils.Vector((1e9, 1e9, 1e9))
maximum = mathutils.Vector((-1e9, -1e9, -1e9))
for obj in meshes:
    for vertex in obj.data.vertices:
        world = obj.matrix_world @ vertex.co
        minimum = mathutils.Vector(map(min, minimum, world))
        maximum = mathutils.Vector(map(max, maximum, world))

height = max(0.2, maximum.z - minimum.z)
centre_x = (minimum.x + maximum.x) * 0.5
centre_y = (minimum.y + maximum.y) * 0.5

if waist:
    # 목덜미(≈0.87H)부터 허리(≈0.60H)까지. 긴 머리가 상의를 뚫는 구간이다.
    focus = mathutils.Vector((centre_x, centre_y, minimum.z + height * 0.74))
    radius = height * 0.17
else:
    # 정수리에서 12% 아래를 보면 머리 전체와 목선이 함께 들어온다.
    focus = mathutils.Vector((centre_x, centre_y, maximum.z - height * 0.075))
    radius = height * 0.105

camera_data = bpy.data.cameras.new("hair-qa-camera")
camera_data.lens = 70
camera = bpy.data.objects.new("hair-qa-camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
bpy.context.scene.camera = camera

# 조명은 카메라와 함께 돌지 않는다. 전/후 두 장에서 같은 면에 같은 하이라이트가
# 떨어져야 실루엣·관통 차이만 남는다.
for offset, energy, size in (
    ((0.55, -0.75, 0.55), 130, 0.8),
    ((-0.6, -0.45, 0.3), 70, 1.0),
    ((0.05, 0.75, 0.45), 60, 0.9),
):
    light_data = bpy.data.lights.new("hair-qa-light", "AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new("hair-qa-light", light_data)
    light.location = focus + mathutils.Vector(offset)
    light.rotation_euler = (focus - light.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(light)

world = bpy.data.worlds.new("hair-qa-world")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.065, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.55

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 560
scene.render.resolution_y = 560
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = exposure

for name, degrees in (("front", 0.0), ("q45", 45.0), ("side", 90.0), ("back", 180.0)):
    angle = math.radians(degrees)
    distance = radius * 4.2
    camera.location = (
        focus.x + math.sin(angle) * distance,
        focus.y - math.cos(angle) * distance,
        focus.z + radius * 0.25,
    )
    camera.rotation_euler = (focus - camera.location).to_track_quat("-Z", "Y").to_euler()
    part = "waist" if waist else "head"
    destination = output_dir / f"{label}_{part}_{name}.png"
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    print(f"[hair-qa] {label} {part} {name} -> {destination}")
