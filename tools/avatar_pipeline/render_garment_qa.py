"""Render a front-view QA image for a rigged garment-only GLB."""

from __future__ import annotations

import mathutils
from pathlib import Path
import sys

import bpy


argv = sys.argv[sys.argv.index("--") + 1 :]
if len(argv) != 2:
    raise SystemExit("Usage: blender --background --python render_garment_qa.py -- donor.glb out.png")

source = Path(argv[0]).resolve()
destination = Path(argv[1]).resolve()
destination.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
if not meshes:
    raise RuntimeError("No meshes in garment GLB")

minimum = mathutils.Vector((1e9, 1e9, 1e9))
maximum = mathutils.Vector((-1e9, -1e9, -1e9))
for obj in meshes:
    for corner in obj.bound_box:
        world = obj.matrix_world @ mathutils.Vector(corner)
        minimum = mathutils.Vector(map(min, minimum, world))
        maximum = mathutils.Vector(map(max, maximum, world))

center = (minimum + maximum) * 0.5
height = max(0.1, maximum.z - minimum.z)
camera_data = bpy.data.cameras.new("garment-qa-camera")
camera_data.lens = 62
camera = bpy.data.objects.new("garment-qa-camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (center.x, minimum.y - height * 1.55, center.z)
camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = camera

for location, energy, size in (
    ((1.2, -1.6, 2.4), 650, 2.0),
    ((-1.1, -0.8, 1.1), 320, 2.5),
):
    light_data = bpy.data.lights.new("garment-qa-light", "AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new("garment-qa-light", light_data)
    light.location = center + mathutils.Vector(location)
    bpy.context.scene.collection.objects.link(light)

world = bpy.data.worlds.new("garment-qa-world")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.025, 0.03, 0.04, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.35

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 700
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.filepath = str(destination)
bpy.ops.render.render(write_still=True)
print("[garment-qa]", destination, minimum, maximum)
