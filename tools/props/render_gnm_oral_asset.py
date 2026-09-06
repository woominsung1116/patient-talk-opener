"""Round-trip front-view QA render for gnm_oral_anatomy.glb."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(raw) != 2:
    raise SystemExit("usage: blender --background --python render_gnm_oral_asset.py -- asset.glb out.png")
asset, output = map(lambda value: Path(value).resolve(), raw)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(asset))

world = bpy.data.worlds.new("GNM_Oral_QA_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.018, 0.018, 0.022, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22
bpy.context.scene.world = world


def area(name: str, location: tuple[float, float, float], energy: float, size: float) -> None:
    light_data = bpy.data.lights.new(name, type="AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 0)) - light.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(light)


area("Oral_Key", (-0.06, -0.16, 0.10), 4.5, 0.12)
area("Oral_Fill", (0.10, -0.10, -0.02), 1.8, 0.10)

camera_data = bpy.data.cameras.new("GNM_Oral_QA_Camera")
camera_data.lens = 70
camera_data.clip_start = 0.001
camera = bpy.data.objects.new("GNM_Oral_QA_Camera", camera_data)
camera.location = (0, -0.24, 0)
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.look = "AgX - Medium High Contrast"
output.parent.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(output)
bpy.ops.render.render(write_still=True)
print(f"GNM_ORAL_QA_RENDERED {output}")
