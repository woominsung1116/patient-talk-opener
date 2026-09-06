#!/usr/bin/env blender --background --python
"""구강검사 도구 2종(설압자·펜라이트) GLB 절차 생성.

좌표 규약 (중요):
  Blender 는 Z-up, glTF 는 Y-up 이다. `export_yup=True`(기본) 로 내보내면
      glTF X = Blender X,  glTF Y = Blender Z,  glTF Z = -Blender Y
  ClinicScene 의 손 리그는 **손끝 방향이 로컬 -Y** 이고 도구가 그 방향으로 뻗는다.
  따라서 도구의 길이축을 glTF -Y 로 두려면 **Blender -Z 방향**으로 만든다.

실행:
  blender --background --python build_props.py -- <tex_dir> <out_dir>
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TEX_DIR = os.path.abspath(argv[0]) if argv else "."
OUT_DIR = os.path.abspath(argv[1]) if len(argv) > 1 else "."
os.makedirs(OUT_DIR, exist_ok=True)


# ────────────────────────────────────────────────────────────────────────────
# 유틸
# ────────────────────────────────────────────────────────────────────────────
def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_mat(name, base=(0.8, 0.8, 0.8, 1.0), metallic=0.0, roughness=0.5,
            emission=None, emission_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = base
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emission is not None:
        b.inputs["Emission Color"].default_value = emission
        b.inputs["Emission Strength"].default_value = emission_strength
    # IOR/Specular 기본값 유지 — glTF 로 나가지 않는 항목은 건드리지 않는다
    return m


def tex_node(mat, filename, colorspace, location):
    path = os.path.join(TEX_DIR, filename)
    if not os.path.exists(path):
        raise SystemExit(f"[FATAL] 텍스처 없음: {path}")
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    n = mat.node_tree.nodes.new("ShaderNodeTexImage")
    n.image = img
    n.location = location
    return n


def mark_sharp_by_angle(obj, angle_deg=35.0):
    """면 각도가 크면 sharp 로 표시 → glTF 로 split normal 이 정확히 나간다."""
    me = obj.data
    for p in me.polygons:
        p.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(me)
    thr = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) < thr
        else:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()


def report(obj, label):
    me = obj.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    print(f"[{label}] verts={len(me.vertices)} tris={tris} "
          f"blender_bbox x[{min(xs):+.4f},{max(xs):+.4f}] "
          f"y[{min(ys):+.4f},{max(ys):+.4f}] z[{min(zs):+.4f},{max(zs):+.4f}]")


def export(name):
    bpy.ops.object.select_all(action="SELECT")
    out = os.path.join(OUT_DIR, name)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,              # Blender Z-up → glTF Y-up
        export_apply=True,            # 모디파이어 적용
        export_materials="EXPORT",
        export_image_format="AUTO",   # PNG 유지 (노멀맵 밴딩 방지)
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,        # three.js 가 필요 시 생성 (용량 절약)
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_extras=False,
        use_selection=True,
    )
    print(f"[export] {out}  {os.path.getsize(out):,} bytes")


# ────────────────────────────────────────────────────────────────────────────
# 1. 설압자 (tongue depressor)
#    실물: 자작나무, 150 x 18 x 2 mm, 양끝 반원(R9), 모서리는 샌딩되어 미세하게 둥글다.
# ────────────────────────────────────────────────────────────────────────────
def build_tongue_depressor():
    wipe()
    L, WD, TH = 0.150, 0.018, 0.0020
    R = WD / 2.0                    # 9mm
    straight = L / 2.0 - R          # 66mm (직선 구간 반)
    CAP_SEG = 28                    # 반원 분할
    STRAIGHT_SEG = 22               # 직선 구간 분할 (UV/셰이딩용)

    # 스타디움 외곽선을 (x, z) 평면에 만든다. 길이축 = Blender Z, 폭 = Blender X.
    pts = []
    # 오른쪽 직선 (z: -straight → +straight)
    for i in range(STRAIGHT_SEG):
        z = -straight + 2 * straight * i / STRAIGHT_SEG
        pts.append((R, z))
    # 위쪽 반원 (중심 z=+straight), 각 0 → pi
    for i in range(CAP_SEG + 1):
        a = math.pi * i / CAP_SEG
        pts.append((R * math.cos(a), straight + R * math.sin(a)))
    # 왼쪽 직선 (z: +straight → -straight)
    for i in range(1, STRAIGHT_SEG):
        z = straight - 2 * straight * i / STRAIGHT_SEG
        pts.append((-R, z))
    # 아래쪽 반원 (중심 z=-straight), 각 pi → 2pi
    for i in range(CAP_SEG + 1):
        a = math.pi + math.pi * i / CAP_SEG
        pts.append((R * math.cos(a), -straight + R * math.sin(a)))
    # 중복 끝점 제거
    if abs(pts[0][0] - pts[-1][0]) < 1e-9 and abs(pts[0][1] - pts[-1][1]) < 1e-9:
        pts.pop()

    bm = bmesh.new()
    half_t = TH / 2.0
    top = [bm.verts.new((x, +half_t, z)) for (x, z) in pts]
    bot = [bm.verts.new((x, -half_t, z)) for (x, z) in pts]
    bm.verts.ensure_lookup_table()
    n = len(pts)
    # 앞/뒤 큰 면 (ngon) — 평면이라 ngon 이어도 셰이딩 문제 없음
    f_top = bm.faces.new(top)
    f_bot = bm.faces.new(list(reversed(bot)))
    # 옆면
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    bm.normal_update()
    # 방향 정리
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # 모서리 베벨 — 샌딩된 나무 모서리. 하이라이트가 한 줄 생겨 두께가 읽힌다
    edges = [e for e in bm.edges if e.calc_face_angle(0.0) > math.radians(30)]
    bmesh.ops.bevel(bm, geom=edges, offset=0.00038, segments=3,
                    profile=0.5, affect="EDGES", clamp_overlap=True)

    # 큰 면을 삼각 팬이 아니라 균등하게 나눠둔다 (라이팅 그라데이션이 부드럽게)
    big = [f for f in bm.faces if len(f.verts) > 8]
    if big:
        bmesh.ops.poke(bm, faces=big)

    me = bpy.data.meshes.new("TongueDepressor")
    bm.to_mesh(me)
    bm.free()

    # UV — 결이 길이축(Blender Z)을 따라 흐르도록 v 를 z 에 매핑
    me.uv_layers.new(name="UVMap")
    uv = me.uv_layers[0].data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = ((co.x + R) / WD, (co.z + L / 2.0) / L)

    obj = bpy.data.objects.new("TongueDepressor_Birch", me)
    bpy.context.collection.objects.link(obj)

    # 재질 — 나뭇결 텍스처
    mat = new_mat("TongueDepressor_Birch", base=(0.86, 0.80, 0.71, 1.0),
                  metallic=0.0, roughness=0.78)
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t_col = tex_node(mat, "td_basecolor.png", "sRGB", (-700, 300))
    t_rgh = tex_node(mat, "td_rough.png", "Non-Color", (-700, 0))
    t_nrm = tex_node(mat, "td_normal.png", "Non-Color", (-700, -320))
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.location = (-380, -320)
    nmap.inputs["Strength"].default_value = 0.75
    nt.links.new(t_col.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(t_rgh.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(t_nrm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    me.materials.append(mat)

    mark_sharp_by_angle(obj, 33.0)
    report(obj, "tongue_depressor")
    export("tongue_depressor.glb")


# ────────────────────────────────────────────────────────────────────────────
# 2. 펜라이트 (medical penlight)
#    실물: 전장 약 140mm, 몸통 지름 13mm, 크롬 베젤 + 포켓 클립 + 테일 푸시버튼.
#    원점 = 렌즈면(z=0), 몸통은 +Z 로 뻗는다 → glTF 에서 빛은 -Y 로 나간다.
# ────────────────────────────────────────────────────────────────────────────
MAT_BEZEL, MAT_BODY, MAT_TAIL = 0, 1, 2


def build_penlight():
    wipe()
    # 1인칭 구강검사에서 펜라이트는 카메라 20cm 앞까지 온다. 36 분할은 실루엣이 각져 보였다.
    SEG = 48

    # (반지름, z, 재질) — 앞(렌즈)에서 뒤로
    prof = []

    def P(r, z, m):
        prof.append((r, z, m))

    # 베젤 (크롬)
    P(0.00470, -0.00055, MAT_BEZEL)   # 렌즈보다 약간 앞으로 나온 보호 rim
    P(0.00560, -0.00080, MAT_BEZEL)
    P(0.00700, -0.00020, MAT_BEZEL)
    P(0.00730,  0.00120, MAT_BEZEL)
    P(0.00730,  0.00780, MAT_BEZEL)
    P(0.00690,  0.00980, MAT_BEZEL)   # 베젤 → 몸통 단차
    # 몸통 (알루미늄)
    P(0.00655,  0.01120, MAT_BODY)
    P(0.00655,  0.03100, MAT_BODY)
    # 그립 링 6개 (미끄럼 방지 널링) — z 0.032 ~ 0.062
    for k in range(6):
        z0 = 0.0320 + k * 0.0050
        P(0.00655, z0 + 0.0000, MAT_BODY)
        P(0.00715, z0 + 0.0011, MAT_BODY)
        P(0.00715, z0 + 0.0026, MAT_BODY)
        P(0.00655, z0 + 0.0037, MAT_BODY)
    P(0.00655,  0.07000, MAT_BODY)
    P(0.00655,  0.11550, MAT_BODY)
    P(0.00640,  0.11750, MAT_BODY)
    # 테일캡 (검은 고무)
    P(0.00640,  0.11900, MAT_TAIL)
    P(0.00640,  0.13250, MAT_TAIL)
    P(0.00595,  0.13560, MAT_TAIL)
    P(0.00430,  0.13650, MAT_TAIL)
    P(0.00430,  0.13980, MAT_TAIL)   # 푸시 버튼
    P(0.00370,  0.14090, MAT_TAIL)
    P(0.00000,  0.14120, MAT_TAIL)   # 뒤 중심 (닫음)

    bm = bmesh.new()
    rings = []
    for (r, z, _m) in prof:
        if r < 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            ring = []
            for j in range(SEG):
                a = 2.0 * math.pi * j / SEG
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
            rings.append(ring)
    bm.verts.ensure_lookup_table()

    faces_mat = []
    for i in range(len(rings) - 1):
        a_ring, b_ring = rings[i], rings[i + 1]
        m = prof[i + 1][2]
        if len(b_ring) == 1:                       # 뒤쪽 팬 마감
            for j in range(SEG):
                f = bm.faces.new((a_ring[j], a_ring[(j + 1) % SEG], b_ring[0]))
                faces_mat.append((f, m))
        elif len(a_ring) == 1:
            for j in range(SEG):
                f = bm.faces.new((a_ring[0], b_ring[(j + 1) % SEG], b_ring[j]))
                faces_mat.append((f, m))
        else:
            for j in range(SEG):
                k = (j + 1) % SEG
                f = bm.faces.new((a_ring[j], a_ring[k], b_ring[k], b_ring[j]))
                faces_mat.append((f, m))
    # 앞쪽 열린 rim 은 렌즈/리플렉터가 막는다 — 안쪽 벽을 조금 만들어 두께감을 준다
    inner = []
    for j in range(SEG):
        a = 2.0 * math.pi * j / SEG
        inner.append(bm.verts.new((0.0046 * math.cos(a), 0.0046 * math.sin(a), 0.0016)))
    for j in range(SEG):
        k = (j + 1) % SEG
        f = bm.faces.new((rings[0][j], inner[j], inner[k], rings[0][k]))
        faces_mat.append((f, MAT_BEZEL))

    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f, m in faces_mat:
        f.material_index = m

    me = bpy.data.meshes.new("Penlight")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("Penlight_Body", me)
    bpy.context.collection.objects.link(obj)

    m_bezel = new_mat("Penlight_Bezel_Chrome", base=(0.855, 0.875, 0.890, 1.0),
                      metallic=1.0, roughness=0.11)
    m_body = new_mat("Penlight_Body_Aluminum", base=(0.700, 0.725, 0.750, 1.0),
                     metallic=1.0, roughness=0.33)
    m_tail = new_mat("Penlight_Tailcap_Rubber", base=(0.055, 0.062, 0.070, 1.0),
                     metallic=0.0, roughness=0.72)
    for m in (m_bezel, m_body, m_tail):
        me.materials.append(m)
    mark_sharp_by_angle(obj, 33.0)
    report(obj, "penlight_body")

    # ── 리플렉터 (안쪽 크롬 원뿔) ────────────────────────────────────────────
    bm = bmesh.new()
    r_out, r_in, z0, z1 = 0.00455, 0.00110, 0.00170, 0.00760
    o_ring, i_ring = [], []
    for j in range(SEG):
        a = 2.0 * math.pi * j / SEG
        o_ring.append(bm.verts.new((r_out * math.cos(a), r_out * math.sin(a), z0)))
        i_ring.append(bm.verts.new((r_in * math.cos(a), r_in * math.sin(a), z1)))
    for j in range(SEG):
        k = (j + 1) % SEG
        bm.faces.new((o_ring[j], i_ring[j], i_ring[k], o_ring[k]))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me2 = bpy.data.meshes.new("PenlightReflector")
    bm.to_mesh(me2)
    bm.free()
    ob2 = bpy.data.objects.new("Penlight_Reflector", me2)
    bpy.context.collection.objects.link(ob2)
    me2.materials.append(new_mat("Penlight_Reflector_Chrome",
                                 base=(0.930, 0.935, 0.940, 1.0),
                                 metallic=1.0, roughness=0.06))
    for p in me2.polygons:
        p.use_smooth = True
    report(ob2, "penlight_reflector")

    # ── 렌즈 (살짝 볼록한 발광 디스크) ──────────────────────────────────────
    bm = bmesh.new()
    LR, SAG = 0.00465, 0.00075
    center = bm.verts.new((0.0, 0.0, -SAG))
    rim = []
    for j in range(SEG):
        a = 2.0 * math.pi * j / SEG
        rim.append(bm.verts.new((LR * math.cos(a), LR * math.sin(a), 0.00030)))
    for j in range(SEG):
        k = (j + 1) % SEG
        bm.faces.new((center, rim[k], rim[j]))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me3 = bpy.data.meshes.new("PenlightLens")
    bm.to_mesh(me3)
    bm.free()
    ob3 = bpy.data.objects.new("Penlight_Lens", me3)
    bpy.context.collection.objects.link(ob3)
    # emissive 1.0 로 내보낸다 — 세기는 연결 담당이 emissiveIntensity 로 조절
    me3.materials.append(new_mat("Penlight_Lens_Emissive",
                                 base=(0.98, 0.96, 0.90, 1.0),
                                 metallic=0.0, roughness=0.08,
                                 emission=(1.0, 0.945, 0.800, 1.0),
                                 emission_strength=1.0))
    for p in me3.polygons:
        p.use_smooth = True
    report(ob3, "penlight_lens")

    # ── 포켓 클립 ───────────────────────────────────────────────────────────
    path = [(0.00655, 0.01650), (0.00760, 0.01760), (0.00895, 0.02220),
            (0.00930, 0.03150), (0.00915, 0.05100), (0.00845, 0.06450),
            (0.00735, 0.07150), (0.00700, 0.07650), (0.00780, 0.08150),
            (0.00930, 0.08450)]
    CW, CT = 0.00520, 0.00062          # 클립 폭 / 두께
    bm = bmesh.new()
    outer, innr = [], []
    for idx, (px, pz) in enumerate(path):
        # 진행 방향의 법선(반경 바깥쪽) 계산
        if idx == 0:
            dx, dz = path[1][0] - px, path[1][1] - pz
        elif idx == len(path) - 1:
            dx, dz = px - path[-2][0], pz - path[-2][1]
        else:
            dx, dz = path[idx + 1][0] - path[idx - 1][0], path[idx + 1][1] - path[idx - 1][1]
        ln = math.hypot(dx, dz) or 1.0
        nx, nz = dz / ln, -dx / ln      # 바깥 법선
        if nx < 0:
            nx, nz = -nx, -nz
        for sgn, store in ((+1, outer), (-1, innr)):
            xx = px + nx * CT * 0.5 * sgn
            zz = pz + nz * CT * 0.5 * sgn
            store.append([bm.verts.new((xx, -CW / 2, zz)), bm.verts.new((xx, +CW / 2, zz))])
    for i in range(len(path) - 1):
        o0, o1 = outer[i], outer[i + 1]
        i0, i1 = innr[i], innr[i + 1]
        bm.faces.new((o0[0], o0[1], o1[1], o1[0]))      # 바깥면
        bm.faces.new((i1[0], i1[1], i0[1], i0[0]))      # 안쪽면
        bm.faces.new((o0[1], i0[1], i1[1], o1[1]))      # 옆면 +Y
        bm.faces.new((i0[0], o0[0], o1[0], i1[0]))      # 옆면 -Y
    # 앞/뒤 마감
    bm.faces.new((outer[0][0], innr[0][0], innr[0][1], outer[0][1]))
    bm.faces.new((outer[-1][1], innr[-1][1], innr[-1][0], outer[-1][0]))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.calc_face_angle(0.0) > math.radians(35)],
                    offset=0.00016, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    me4 = bpy.data.meshes.new("PenlightClip")
    bm.to_mesh(me4)
    bm.free()
    ob4 = bpy.data.objects.new("Penlight_Clip", me4)
    bpy.context.collection.objects.link(ob4)
    me4.materials.append(new_mat("Penlight_Clip_Steel", base=(0.560, 0.585, 0.610, 1.0),
                                 metallic=1.0, roughness=0.25))
    mark_sharp_by_angle(ob4, 33.0)
    report(ob4, "penlight_clip")

    export("penlight.glb")


build_tongue_depressor()
build_penlight()
print("ALL DONE")
