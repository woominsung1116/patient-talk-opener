#!/usr/bin/env blender --background --python
"""내보낸 GLB 를 **되읽어서** 렌더한다 (round-trip 검증).

GLB 안의 지오메트리/재질/텍스처만으로 렌더되므로, 결과가 좋으면 파일 자체가 온전하다는 뜻이다.
실행: blender --background --python render_props.py -- <glb_dir> <png_out_dir>
"""
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB_DIR = os.path.abspath(argv[0]); OUT = os.path.abspath(argv[1])
os.makedirs(OUT, exist_ok=True)


def studio():
    """소프트 3점 조명 + 상하 그라데이션 환경.
    금속은 환경 반사로 읽히므로 균일 환경이면 크롬이 밋밋해진다 → 그라데이션을 준다."""
    w = bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    outp = nt.nodes.new("ShaderNodeOutputWorld")
    bgn = nt.nodes.new("ShaderNodeBackground")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "LINEAR"
    mapn = nt.nodes.new("ShaderNodeMapping")
    texc = nt.nodes.new("ShaderNodeTexCoord")
    mapn.inputs["Rotation"].default_value = (0, math.radians(-90), 0)   # Z 방향 그라데이션
    ramp.color_ramp.elements[0].position = 0.30
    ramp.color_ramp.elements[0].color = (0.090, 0.098, 0.112, 1)        # 아래(바닥 반사)
    ramp.color_ramp.elements[1].position = 0.90
    ramp.color_ramp.elements[1].color = (0.520, 0.560, 0.620, 1)        # 위(천장 조명면)
    nt.links.new(texc.outputs["Generated"], mapn.inputs["Vector"])
    nt.links.new(mapn.outputs["Vector"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bgn.inputs["Color"])
    bgn.inputs["Strength"].default_value = 1.0
    nt.links.new(bgn.outputs["Background"], outp.inputs["Surface"])

    def area(name, loc, size, energy, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, type="AREA")
        d.size = size; d.energy = energy; d.color = color
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.collection.objects.link(o)

    # 물체가 15cm 내외라 광량을 작게 잡아야 한다 (앞서 65W 는 완전 노출과다였다)
    area("key",  (0.26, -0.24, 0.32), 0.40, 5.5, (1.00, 0.97, 0.92))
    area("fill", (-0.32, -0.20, 0.12), 0.55, 1.8, (0.90, 0.94, 1.00))
    area("rim",  (-0.10, 0.34, 0.24), 0.35, 3.0, (1.00, 1.00, 1.00))


def add_backdrop(z=-0.02):
    me = bpy.data.meshes.new("bd")
    me.from_pydata([(-1, -1, z), (1, -1, z), (1, 1, z), (-1, 1, z)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new("bd", me)
    bpy.context.collection.objects.link(o)
    m = bpy.data.materials.new("bd")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.055, 0.060, 0.070, 1)
    b.inputs["Roughness"].default_value = 0.80
    me.materials.append(m)


def cam(loc, target, lens=55):
    c = bpy.data.cameras.new("cam"); c.lens = lens
    c.clip_start = 0.0008          # 기본 0.1m 는 접사에서 물체를 통째로 잘라낸다
    c.clip_end = 50.0
    o = bpy.data.objects.new("cam", c)
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(o)
    bpy.context.scene.camera = o


def render(path, res=(900, 640), samples=160):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    try:
        s.cycles.device = "CPU"
        s.cycles.samples = samples
        s.cycles.use_denoising = True
    except Exception:
        pass
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    s.render.film_transparent = False
    s.view_settings.view_transform = "AgX"
    s.render.filepath = path
    s.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"[render] {path}")


def world_bbox():
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            for k in range(3):
                lo[k] = min(lo[k], p[k]); hi[k] = max(hi[k], p[k])
    return lo, hi


def roots():
    return [o for o in bpy.context.scene.objects if o.parent is None]


def move_all(delta):
    for o in roots():
        o.location = Vector(o.location) + Vector(delta)
    bpy.context.view_layer.update()


def rot_all(axis, ang):
    import mathutils
    R = mathutils.Matrix.Rotation(ang, 4, axis)
    for o in roots():
        o.matrix_world = R @ o.matrix_world
    bpy.context.view_layer.update()


def obj_bbox(name_sub):
    """이름에 name_sub 가 들어간 메시들의 월드 bbox."""
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    hit = False
    for o in bpy.context.scene.objects:
        if o.type != "MESH" or name_sub.lower() not in o.name.lower():
            continue
        hit = True
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            for k in range(3):
                lo[k] = min(lo[k], p[k]); hi[k] = max(hi[k], p[k])
    if not hit:
        raise SystemExit(f"[FATAL] 오브젝트 없음: {name_sub} "
                         f"(있는 것: {[o.name for o in bpy.context.scene.objects if o.type=='MESH']})")
    return lo, hi


def shot(glb, out_name, spin_deg, elev_deg, fill, lens=50, samples=200,
         focus_obj=None, focus_span=None, focus_along=0.0):
    """spin_deg: 물체를 Z축으로 돌려 화면에서 사선이 되게. elev_deg: 카메라 고도.
       focus_obj: 그 이름의 오브젝트를 화면 중앙에 두고 접사 (없으면 전체를 프레이밍)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(GLB_DIR, glb))
    # glTF 임포트는 Y-up → Blender Z-up 으로 되돌린다 (길이축 glTF Y → Blender Z).
    # 눕혀 보기 위해 X축 -90° 회전. (검증용 배치일 뿐 GLB 는 안 바뀐다)
    rot_all("X", -math.pi / 2)
    rot_all("Z", math.radians(spin_deg))

    lo_all, hi_all = world_bbox()
    if focus_obj:
        lo_f, hi_f = obj_bbox(focus_obj)
        ctr = (lo_f + hi_f) / 2.0
        span = focus_span if focus_span else max(hi_f - lo_f)
    else:
        ctr = (lo_all + hi_all) / 2.0
        span = max(hi_all - lo_all)
    # 길이축(glTF +Y)은 회전 후 월드에서 Rz(spin)·(0,1,0) 방향이다 — 그 축을 따라 접사 지점 이동
    ax = math.radians(spin_deg)
    axis = Vector((-math.sin(ax), math.cos(ax), 0.0))
    ctr = ctr + axis * focus_along
    move_all(-ctr)
    lo_all, hi_all = world_bbox()
    print(f"  [dbg] roots={[o.name for o in roots()]} "
          f"meshes={[o.name for o in bpy.context.scene.objects if o.type=='MESH']}")
    print(f"  [dbg] after-center bbox lo={tuple(round(v,4) for v in lo_all)} "
          f"hi={tuple(round(v,4) for v in hi_all)} span={span:.4f}")

    hfov = 2 * math.atan(18.0 / lens)
    dist = (span / max(fill, 1e-3)) / (2 * math.tan(hfov / 2))
    el = math.radians(elev_deg)
    cam_loc = (0.0, -dist * math.cos(el), dist * math.sin(el))

    studio()
    add_backdrop(lo_all.z - 0.0004)
    cam(cam_loc, (0, 0, 0), lens)
    print(f"  [dbg] cam={tuple(round(v,4) for v in cam_loc)} dist={dist:.4f} lens={lens}")
    render(os.path.join(OUT, out_name), samples=samples)


# ── 설압자 ── 길이 150 / 폭 18 / 두께 2 mm
shot("tongue_depressor.glb", "shot_td_hero.png", spin_deg=58, elev_deg=34, fill=0.88)
shot("tongue_depressor.glb", "shot_td_tip.png", spin_deg=58, elev_deg=38, fill=0.72,
     lens=70, focus_obj="TongueDepressor", focus_span=0.032,
     focus_along=0.060)                                        # 끝 반원 + 베벨 + 나뭇결 접사

# ── 펜라이트 ── 길이 142 / 지름 13 mm, 렌즈는 glTF -Y, 클립은 +X
shot("penlight.glb", "shot_pl_hero.png", spin_deg=58, elev_deg=32, fill=0.88)
shot("penlight.glb", "shot_pl_head.png", spin_deg=58, elev_deg=30, fill=0.55,
     lens=70, focus_obj="Penlight_Lens", focus_span=0.030)     # 베젤/리플렉터/렌즈
shot("penlight.glb", "shot_pl_clip.png", spin_deg=238, elev_deg=30, fill=0.70,
     lens=60, focus_obj="Penlight_Clip", focus_span=0.075)     # 포켓 클립 쪽 (반대편)
print("RENDER DONE")
