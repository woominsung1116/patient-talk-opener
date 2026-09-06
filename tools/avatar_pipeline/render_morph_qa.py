"""Render a compact neutral/expression QA set from a morph-enabled GLB."""

from __future__ import annotations

import mathutils
from pathlib import Path
import sys

import bpy


argv = sys.argv[sys.argv.index("--") + 1 :]
if len(argv) != 2:
    raise SystemExit("Usage: blender --background --python render_morph_qa.py -- avatar.glb output-dir")

source = Path(argv[0]).resolve()
output_dir = Path(argv[1]).resolve()
output_dir.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))

meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
morph_mesh = next((obj for obj in meshes if obj.data.shape_keys), None)
if morph_mesh is None:
    raise RuntimeError("No morph-enabled mesh in GLB")

keys = morph_mesh.data.shape_keys.key_blocks
poses = {
    "neutral": {},
    "blink": {"eyeBlinkLeft": 1.0, "eyeBlinkRight": 1.0},
    "smile": {
        "mouthSmileLeft": 0.55,
        "mouthSmileRight": 0.55,
        "cheekSquintLeft": 0.12,
        "cheekSquintRight": 0.12,
    },
    "speech_o": {"jawOpen": 0.38, "viseme_O": 0.42, "mouthFunnel": 0.06},
    "concern": {
        "browInnerUp": 0.48,
        "mouthFrownLeft": 0.24,
        "mouthFrownRight": 0.24,
    },
    "shocked": {
        "eyeWideLeft": 0.38,
        "eyeWideRight": 0.38,
        "browInnerUp": 0.5,
        "browOuterUpLeft": 0.36,
        "browOuterUpRight": 0.36,
        "jawOpen": 0.24,
    },
}

minimum = mathutils.Vector((1e9, 1e9, 1e9))
maximum = mathutils.Vector((-1e9, -1e9, -1e9))
for obj in meshes:
    for corner in obj.bound_box:
        world = obj.matrix_world @ mathutils.Vector(corner)
        minimum = mathutils.Vector(map(min, minimum, world))
        maximum = mathutils.Vector(map(max, maximum, world))

head = mathutils.Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, maximum.z - 0.12))
camera_data = bpy.data.cameras.new("qa-camera")
camera_data.lens = 80
camera = bpy.data.objects.new("qa-camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (head.x, head.y - 0.5, head.z + 0.02)
camera.rotation_euler = (head - camera.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = camera

for location, energy, size in (
    ((0.6, -0.8, 0.6), 120, 0.8),
    ((-0.5, -0.6, 0.3), 60, 1.0),
    ((0.1, 0.1, 0.5), 45, 0.7),
):
    light_data = bpy.data.lights.new("qa-light", "AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new("qa-light", light_data)
    light.location = (head.x + location[0], head.y + location[1], head.z + location[2])
    bpy.context.scene.collection.objects.link(light)

world = bpy.data.worlds.new("qa-world")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.035, 0.04, 0.05, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.5

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 480
scene.render.resolution_y = 480
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.look = "AgX - Medium High Contrast"

for pose_name, values in poses.items():
    for key in keys:
        if key.name != "Basis":
            key.value = values.get(key.name, 0.0)
    bpy.context.view_layer.update()
    destination = output_dir / f"{pose_name}.png"
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    print(f"[morph-qa] {pose_name}: {destination}")
