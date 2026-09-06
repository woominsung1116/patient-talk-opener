"""손 GLB 검수 렌더 — 포즈마다 손등/손바닥 두 각도. render_hands.py 복제본.

원본은 각도 하나뿐이라 손바닥 쪽 구멍·뒤집힘을 못 본다. 여기서는 두 방향에서 본다.
"""
import sys, math, glob, os
from pathlib import Path
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = argv[0] if argv else "/tmp/hands"
OUT = argv[1] if len(argv) > 1 else "/tmp/hands/render"
Path(OUT).mkdir(parents=True, exist_ok=True)

for f in sorted(glob.glob(os.path.join(SRC, "hand_*.glb"))):
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=f)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print(f"[render] 메시 없음: {f}")
        continue

    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    ctr = [(mn[i] + mx[i]) / 2 for i in range(3)]
    size = max(mx[i] - mn[i] for i in range(3))

    for loc, e in (((1.4, -1.6, 1.5), 220), ((-1.6, -1.0, 0.7), 90), ((0.4, 1.8, 1.1), 120)):
        bpy.ops.object.light_add(type="AREA", location=[ctr[i] + loc[i] * size for i in range(3)])
        L = bpy.context.active_object
        L.data.energy = e * size * size
        L.data.size = size * 1.2
        cons = L.constraints.new("TRACK_TO")
        bpy.ops.object.empty_add(location=ctr)
        cons.target = bpy.context.active_object

    world = bpy.context.scene.world or bpy.data.worlds.new("w")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.065, 1)

    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    try:
        sc.eevee.taa_render_samples = 32
    except Exception:
        pass
    sc.render.resolution_x = sc.render.resolution_y = 720
    name = Path(f).stem

    # (방위각, 고도계수, 태그) — dorsal=손등 쪽, palmar=손바닥 쪽(구멍·뒤집힘 확인)
    for ang, zf, tag in ((38, 0.45, "dorsal"), (210, -0.30, "palmar")):
        for o in [x for x in bpy.context.scene.objects if x.type == "CAMERA"]:
            bpy.data.objects.remove(o, do_unlink=True)
        r = math.radians(ang)
        d = size * 2.2
        bpy.ops.object.camera_add(location=(ctr[0] + d * math.cos(r), ctr[1] - d * math.sin(r), ctr[2] + d * zf))
        cam = bpy.context.active_object
        bpy.ops.object.empty_add(location=ctr)
        cam.constraints.new("TRACK_TO").target = bpy.context.active_object
        sc.camera = cam
        sc.render.filepath = os.path.join(OUT, f"{name}_{tag}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[render] {sc.render.filepath}")
