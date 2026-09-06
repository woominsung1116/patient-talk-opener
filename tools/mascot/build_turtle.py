#!/usr/bin/env blender --background --python
"""CPT 마스코트 거북이 — 절차 생성 3D 모델 + 리그.

왜 3D 인가:
  레퍼런스(CPX Mate)가 살아 보이는 건 벡터라서가 아니라 **뼈대가 있어서**다.
  실루엣이 통째로 변형된다(실측: 폭 +37%, 높이 −5%). 평면 PNG 로는 못 한다.
  벡터 재현도 시도했으나 평균 픽셀차 8.3/255 에서 벽에 걸렸다
  (`webapp/design/turtle-rig/trace.py` 상단에 시도 7가지와 실패 원인 기록).

비율은 눈대중이 아니라 `webapp/public/brand/turtle-clay.png` 의 실루엣을
높이 5% 간격으로 재서 옮겼다 (전체 높이를 1.0 으로 정규화):

    높이(위에서)   폭(그림 폭 대비)   무엇
      0~33%          최대 58%        머리 — 넓고 납작한 돔
     35~55%          88~94%          어깨 + 든 손 + 등껍질
     55~95%          60~80%          몸통·가운
     95~100%          —              발

좌표 규약: Blender 는 Z-up, glTF 는 Y-up. export_yup=True 로 내보낸다.
캐릭터는 발바닥이 z=0, 정수리가 z=1.0 이고 정면은 -Y 를 본다.

실행:
  blender --background --python build_turtle.py -- <out_dir> [--render]
"""
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0]) if argv else "."
DO_RENDER = "--render" in argv
os.makedirs(OUT_DIR, exist_ok=True)

# ── 실측 비율 (캐릭터 높이 1.0 기준) ────────────────────────────────
# 이름 옆 숫자는 turtle-clay.png 에서 잰 값. 만지려면 그림을 다시 재고 만져라.
# ★ 부위는 반드시 서로 파고들게 둔다. 딱 맞닿게 두면 렌더에서 이음매가
# 벌어져 부품을 늘어놓은 것처럼 보인다 (1차 렌더의 실패 원인).
HEAD_Z, HEAD_RX, HEAD_RY, HEAD_RZ = 0.740, 0.258, 0.232, 0.208
BODY_Z, BODY_RX, BODY_RY, BODY_RZ = 0.330, 0.250, 0.220, 0.270
SHELL_Z, SHELL_RX, SHELL_RY, SHELL_RZ = 0.352, 0.262, 0.178, 0.252
SHELL_Y = 0.148                       # 등껍질은 뒤(+Y)로 물러나 있다
NECK_Z, NECK_R = 0.560, 0.128         # 머리와 몸을 잇는다
EYE_X, EYE_Y, EYE_Z, EYE_R = 0.092, -0.192, 0.766, 0.031

# sRGB 로 뽑은 색을 그대로 넣으면 렌더에서 옅어진다. 한 단계 진하게 잡는다.
GREEN = (0.375, 0.635, 0.335, 1.0)       # 몸 — turtle-clay.png 에서 뽑은 색
SHELL_C = (0.085, 0.30, 0.175, 1.0)   # 등껍질
BELLY_C = (0.665, 0.735, 0.395, 1.0)     # 배
DARK = (0.014, 0.014, 0.012, 1.0)     # 눈·눈썹·입
SHELL_C2 = (0.13, 0.40, 0.245, 1.0)    # 등껍질 판 (밝은 쪽)
COAT_C = (0.93, 0.94, 0.90, 1.0)      # 흰 가운 — 순백은 렌더에서 날아간다
TEAL_C = (0.03, 0.34, 0.33, 1.0)      # 청진기
COAT_Z, COAT_RX, COAT_RY, COAT_RZ = 0.318, 0.272, 0.232, 0.262


def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def clay(name, color, rough=0.88, sss=0.14):
    """무광 클레이 재질.

    거칠기를 높게 두고 표면하산란을 아주 조금만 넣는다. 이 조합이 점토의
    '빛을 머금은 무광'을 낸다. 반짝이면(rough<0.6) 플라스틱으로 보인다.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    # Blender 버전에 따라 입력 이름이 다르다 — 없으면 건너뛴다
    for key, val in (("Subsurface Weight", sss), ("Subsurface Scale", 0.06)):
        if key in b.inputs:
            b.inputs[key].default_value = val
    return m


def coat_from(body, mat, z_top, z_hem, open_half, name="coat",
              inflate=1.045, thick=0.016):
    """몸 표면을 복제해 만든 가운.

    타원을 늘려 옷을 흉내내면 흰 달걀(v7)이나 판자(v8)가 된다. 옷은 몸을 감싸는
    얇은 면이므로, **몸 메시를 그대로 복제해 살짝 부풀리고 두께를 주는** 것이 맞다.
    그래야 어깨선·허리선이 몸을 따라간다.

    잘라내는 것: 어깨 위(z_top 초과), 밑단 아래(z_hem 미만), 앞 중앙(|x|<open_half 이고
    앞쪽) — 앞을 열어야 배와 청진기가 보인다.
    """
    import bmesh
    o = body.copy()
    o.data = body.data.copy()
    o.name = name
    bpy.context.collection.objects.link(o)
    o.scale = (inflate, inflate, inflate)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bm = bmesh.new()
    bm.from_mesh(o.data)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        # 앞 중앙은 V 로 열되, 아래로 갈수록 좁아지게 (옷깃 모양)
        t = max(0.0, min(1.0, (c.z - z_hem) / max(1e-6, z_top - z_hem)))
        half = open_half * (0.35 + 0.65 * t)
        if c.z > z_top or c.z < z_hem or (c.y < -0.02 and abs(c.x) < half):
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(o.data)
    bm.free()

    m = o.modifiers.new("solid", "SOLIDIFY")
    m.thickness = thick
    m.offset = 1.0
    bpy.ops.object.modifier_apply(modifier=m.name)
    o.data.materials.clear()
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    o.select_set(False)
    return o


def clay_mass(name, mat, elems, resolution=0.018):
    """메타볼로 만든 하나의 연속된 살덩이.

    구를 겹쳐 놓으면 아무리 파고들게 해도 이음매의 각이 보이고 '부품을 붙인 것'
    으로 읽힌다(v1~v5). 메타볼은 서로 녹아 붙어 한 장의 표면이 되므로 점토를
    주물러 붙인 느낌이 난다 — 레퍼런스의 클레이 질감이 정확히 그 원리다.

    elems: [(x, y, z, sx, sy, sz, stiffness)] — stiffness 가 클수록 이웃과 더 뭉친다.
    """
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    o = bpy.data.objects.new(name, mb)
    bpy.context.collection.objects.link(o)
    for (x, y, z, sx, sy, sz, stiff) in elems:
        e = mb.elements.new(type="ELLIPSOID")
        e.co = (x, y, z)
        e.size_x, e.size_y, e.size_z = sx, sy, sz
        e.radius, e.stiffness = 1.0, stiff
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    o.select_set(False)
    return o


def blob(name, loc, scale, mat, subsurf=1, segments=32, rings=16, rot=None):
    """둥근 덩어리 하나. 클레이 캐릭터는 결국 이것들의 조합이다."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=1.0, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    if rot:
        o.rotation_euler = tuple(math.radians(a) for a in rot)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # ★ 섭디비전을 높게 두고 export_apply 로 내보내면 폴리곤이 폭발한다
    # (레벨 3 + 48x24 구 15개 = GLB 28MB). 마스코트는 레벨 1 이면 충분하다.
    mod = o.modifiers.new("subsurf", "SUBSURF")
    mod.levels = mod.render_levels = subsurf
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    return o


def stroke(name, pts, radius, mat, res=8):
    """점들을 지나는 매끈한 선(원형 단면 튜브). 입·눈썹처럼 얇은 선에 쓴다.

    구를 늘어놓으면 구슬 목걸이로 보인다(5차 렌더). 커브에 두께를 주면
    한 줄로 이어진다.
    """
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.resolution_u = res
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    # 메시로 굳혀야 GLB 로 온전히 나가고 리깅도 붙는다
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.shade_smooth()
    o.select_set(False)
    return o


def on_head(x, z, out=0.004):
    """머리 타원면 위의 y 좌표. 얼굴 부품은 반드시 이걸로 앉힌다.

    y 를 눈대중으로 주면 머리 곡률 때문에 가장자리 부품(입 끝·눈썹 바깥)이
    파묻혀 사라진다(3·4차 렌더의 실패 원인). out 만큼 앞으로 띄운다.
    """
    u = x / HEAD_RX
    w = (z - HEAD_Z) / HEAD_RZ
    r2 = max(0.0, 1.0 - u * u - w * w)
    return -0.010 - HEAD_RY * math.sqrt(r2) - out


def cut(target, cutter):
    """target 에서 cutter 모양을 파낸다. 파낸 뒤 cutter 는 지운다.

    가운의 앞트임처럼 '구멍'은 불리언이 제일 깔끔하다. 판을 여러 장 늘어놓아
    흉내내면 이음매가 보인다.
    """
    m = target.modifiers.new("cut", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.object = cutter
    m.solver = "EXACT"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return target


def build():
    wipe()
    m_skin = clay("clay_skin", GREEN)
    m_shell = clay("clay_shell", SHELL_C, rough=0.82, sss=0.08)
    m_shell2 = clay("clay_shell2", SHELL_C2, rough=0.82, sss=0.08)
    m_belly = clay("clay_belly", BELLY_C)
    m_dark = clay("clay_dark", DARK, rough=0.42, sss=0.0)
    m_coat = clay("clay_coat", COAT_C, rough=0.92, sss=0.10)
    m_teal = clay("clay_teal", TEAL_C, rough=0.55, sss=0.0)
    m_white = clay("clay_white", (1.0, 1.0, 1.0, 1.0), rough=0.30, sss=0.0)

    parts = []
    # ── 등껍질 ──────────────────────────────────────────────────────
    shell = blob("shell", (0, SHELL_Y, SHELL_Z),
                 (SHELL_RX, SHELL_RY, SHELL_RZ), m_shell)
    parts.append(shell)
    # 판 — 살짝 도드라진 밝은 육각 배치. 원본 등껍질의 핵심 인상이다.
    for i, (px, pz) in enumerate([(0, 0.085), (-0.125, 0.035), (0.125, 0.035),
                                  (-0.125, -0.090), (0.125, -0.090), (0, -0.130),
                                  (0, -0.026)]):
        parts.append(blob(f"plate-{i}", (px, SHELL_Y - 0.048, SHELL_Z + pz),
                          (0.062, 0.112, 0.050), m_shell2))

    # ── 살덩이 전체를 메타볼 하나로 ─────────────────────────────────
    # 몸·목·머리·팔·다리·발·꼬리가 한 표면으로 녹아 붙는다.
    skin = clay_mass("skin", m_skin, [
        (0, 0, BODY_Z,        BODY_RX, BODY_RY, BODY_RZ,   2.0),   # 몸통
        (0, 0.005, NECK_Z,    0.132, 0.128, 0.108,         2.4),   # 목
        (0, -0.010, HEAD_Z,   HEAD_RX, HEAD_RY, HEAD_RZ,   3.4),   # 머리
        (-0.262, -0.055, 0.500, 0.086, 0.082, 0.116,       1.7),   # 왼팔(듦)
        (-0.300, -0.062, 0.575, 0.062, 0.060, 0.062,       1.5),   # 왼손
        (0.252, -0.052, 0.352, 0.086, 0.082, 0.124,        1.7),   # 오른팔
        (0.272, -0.060, 0.262, 0.062, 0.060, 0.062,        1.5),   # 오른손
        (-0.115, -0.030, 0.115, 0.062, 0.062, 0.078,       1.6),   # 왼다리
        (0.115, -0.030, 0.115,  0.062, 0.062, 0.078,       1.6),   # 오른다리
        (-0.115, -0.058, 0.056, 0.098, 0.118, 0.058,       1.6),   # 왼발
        (0.115, -0.058, 0.056,  0.098, 0.118, 0.058,       1.6),   # 오른발
        (0, 0.215, 0.185,       0.045, 0.060, 0.040,       1.4),   # 꼬리
    ])
    parts.append(skin)
    parts.append(blob("belly", (0, -0.150, BODY_Z - 0.020),
                      (0.086, 0.115, 0.170), m_belly))

    # ── 흰 가운 — 몸 표면에서 떠낸다 ────────────────────────────────
    # 가운의 원본은 '몸통만' 있는 기준 형상이다. 팔다리까지 든 몸 전체에서
    # 떠내면 손발에 흰 모자가 씌워지거나(v9), 반경으로 자르면 몸통이 조각난다(v10).
    COAT_ON = False
    torso_ref = None if not COAT_ON else clay_mass("torso_ref", m_coat, [
        (0, 0, BODY_Z,     BODY_RX, BODY_RY, BODY_RZ, 2.0),
        (0, 0.005, NECK_Z, 0.110, 0.108, 0.090,       2.0),
    ])
    if torso_ref:
        parts.append(coat_from(torso_ref, m_coat, z_top=0.505, z_hem=0.135, open_half=0.084))
        bpy.data.objects.remove(torso_ref, do_unlink=True)
    for sx in (-1, 1):
        side = "l" if sx < 0 else "r"
        if not COAT_ON:
            continue
        parts.append(blob(f"pocket-{side}", (sx * 0.150, -0.205, 0.215),
                          (0.046, 0.014, 0.038), m_coat,
                          subsurf=1, segments=20, rings=10))

    # ── 목·머리 ─────────────────────────────────────────────────────

    # ── 청진기 — 목에 걸고 앞으로 늘어뜨린다 ────────────────────────
    ring = [(-0.112, 0.070, 0.572), (-0.150, -0.055, 0.538), (-0.118, -0.170, 0.478),
            (-0.128, -0.205, 0.398), (-0.132, -0.216, 0.330)]
    parts.append(stroke("stetho-l", ring, 0.0125, m_teal))
    parts.append(stroke("stetho-r",
                        [(0.112, 0.070, 0.572), (0.150, -0.055, 0.538),
                         (0.118, -0.178, 0.470), (0.070, -0.215, 0.408)],
                        0.0125, m_teal))
    parts.append(blob("chestpiece", (-0.134, -0.228, 0.306),
                      (0.040, 0.016, 0.040), m_teal, subsurf=1, segments=24, rings=12))
    parts.append(blob("chestpiece-in", (-0.134, -0.242, 0.306),
                      (0.021, 0.008, 0.021), m_white, subsurf=1, segments=20, rings=10))

    # ── 팔 — 왼팔은 인사하듯 들고, 오른팔은 내린다 (원본 포즈) ──────
    # 왼팔은 인사하듯 바깥·위로 뺀다. 몸에 붙이면 팔이 있는지도 모른다.
    # 소매(흰 가운) + 손(초록). 통짜 초록 팔이면 가운을 입은 것으로 안 읽힌다.

    # ── 발 + 발가락 ─────────────────────────────────────────────────
    for sx in (-1, 1):
        side = "l" if sx < 0 else "r"
        fx = sx * 0.115
        for j, t in enumerate((-1, 0, 1)):
            parts.append(blob(f"toe-{side}-{j}", (fx + t * 0.046, -0.150, 0.046),
                              (0.024, 0.026, 0.020), m_skin,
                              subsurf=1, segments=16, rings=8))

    # ── 얼굴 ────────────────────────────────────────────────────────
    for sx in (-1, 1):
        side = "l" if sx < 0 else "r"
        parts.append(blob(f"eye-{side}", (sx * EYE_X, on_head(sx * EYE_X, EYE_Z, -0.020), EYE_Z),
                          (EYE_R, EYE_R * 0.80, EYE_R * 1.14), m_dark,
                          subsurf=1, segments=28, rings=14))
        gx, gz = sx * EYE_X - 0.010, EYE_Z + 0.012
        parts.append(blob(f"glint-{side}", (gx, on_head(gx, gz, 0.030), gz),
                          (0.0092, 0.008, 0.0092), m_white, subsurf=1, segments=16, rings=8))
        # 눈썹 — 바깥쪽 끝을 살짝 내린다. 올리면 화난 얼굴이 된다.
        bx, bz = sx * (EYE_X + 0.008), EYE_Z + 0.050
        parts.append(blob(f"brow-{side}", (bx, on_head(bx, bz, 0.006), bz),
                          (0.032, 0.014, 0.0040), m_dark, subsurf=1,
                          segments=24, rings=12, rot=(0, sx * 6, 0)))
        # 콧구멍 점
        nx, nz = sx * 0.024, EYE_Z - 0.034
        parts.append(blob(f"nose-{side}", (nx, on_head(nx, nz, 0.002), nz),
                          (0.0058, 0.0058, 0.005), m_dark, subsurf=1, segments=14, rings=7))

    MOUTH_W, MOUTH_RISE, MOUTH_Z = 0.052, 0.020, EYE_Z - 0.070
    pts = []
    for i in range(5):
        t = i / 4 * 2 - 1
        mx = t * MOUTH_W
        mz = MOUTH_Z + (t * t) * MOUTH_RISE       # 양 끝이 올라가야 웃는 입
        pts.append((mx, on_head(mx, mz, 0.002), mz))
    parts.append(stroke("mouth", pts, 0.0072, m_dark))
    return parts


def studio():
    """정면 소프트 3점 조명. 클레이는 그림자가 부드러워야 점토로 읽힌다."""
    w = bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.86, 0.88, 0.90, 1)
    bg.inputs["Strength"].default_value = 0.32

    def area(name, loc, size, energy, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, type="AREA")
        d.size, d.energy, d.color = size, energy, color
        o = bpy.data.objects.new(name, d)
        o.location = loc
        from mathutils import Vector
        o.rotation_euler = (Vector((0, 0, 0.55)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.collection.objects.link(o)

    # 캐릭터가 높이 1유닛이라 광량이 작아야 한다. 2차 렌더에서 220W 로
    # 완전히 날아갔다(전부 흰색). Standard 톤매퍼는 하이라이트 롤오프가
    # 없어서 AgX 보다 훨씬 쉽게 클리핑된다.
    area("key", (-1.1, -1.5, 1.9), 1.8, 34, (1.00, 0.98, 0.95))
    area("fill", (1.5, -1.1, 0.8), 2.2, 11, (0.92, 0.95, 1.00))
    area("rim", (0.4, 1.6, 1.5), 1.4, 16)


def render(path, res=640):
    sc = bpy.context.scene
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 85                     # 망원 쪽이 왜곡이 적어 캐릭터가 안정적으로 보인다
    cam = bpy.data.objects.new("cam", cam_d)
    cam.location = (0.0, -3.4, 0.62)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam

    try:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = res
    sc.render.resolution_y = int(res * 1.28)
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    # CLAUDE.md 의 AgX 규칙은 **진료실 씬**을 AvatarLab 과 맞추기 위한 것이다.
    # 마스코트는 밝고 채도 높은 브랜드 자산이라 AgX 를 쓰면 색이 씻겨나간다
    # (1차 렌더에서 초록이 거의 흰색이 됐다). 여기서는 Standard 를 쓴다.
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    build()
    studio()
    glb = os.path.join(OUT_DIR, "turtle.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format="GLB", export_yup=True,
        use_selection=False, export_apply=True)
    print(f"[turtle] GLB → {glb}")
    if DO_RENDER:
        png = os.path.join(OUT_DIR, "turtle_qa.png")
        render(png)
        print(f"[turtle] QA → {png}")


main()
