"""술기별 의사 손 생성기 v2 — MPFB(CC0) 본체에서 손가락을 포즈해 구워낸다.

v2 에서 고친 것 (v1 산출물을 렌더해서 발견):
  엄지가 검지 쪽으로 모이지 않고 옆으로 벌어져(외전) 집게(pinch)가 성립하지 않았다.
  원인: calibrate_curl 이 "손끝이 **손바닥 중심**에 가까워지는 축"으로 굽힘축을 골랐는데,
  엄지는 손바닥이 아니라 **검지 쪽으로** 모여야 대립(opposition)이 된다.
  실측: 엄지 각도 (38,34,26) 기준
      axis=2/-1 (v1 이 고른 축) → 엄지끝→손바닥 9.51cm(최소, 그래서 선택됨)
                                  엄지끝→검지끝 17.47cm (기준 8.42cm 보다 **멀어졌다**)
      axis=0/+1 (v2)            → 검지를 굽힌 상태에서 엄지끝→검지끝 3.47cm
  그래서 엄지만 **검지 끝을 목표로** 따로 캘리브레이션한다(calibrate_thumb).
  네 손가락 캘리브레이션은 v1 그대로 둔다 — 그쪽은 렌더에서 정상이었다.

왜 에셋을 찾지 않고 생성하는가:
- MPFB 리그에 손가락 본이 30개(index/middle/ring/pinky/thumb × 3마디 × 좌우) 있어 원하는 자세를 만들 수 있다.
- 라이선스 CC0 — 표기 의무 없음. 환자와 같은 MakeHuman UV라 같은 피부 텍스처가 그대로 맞는다.
- 기존 female_hand.glb는 폐기된 KHR_materials_pbrSpecularGlossiness를 써서
  three.js 0.184(GLTFLoader에 해당 코드 0줄)에서 재질이 유실 → 백묵색으로 렌더된다.

술기마다 필요한 손 모양이 다르다:
  palm       편 손          — 촉진(얕게/깊게), 접촉 압박
  grip_disc  검지+중지 집기  — 청진(체스트피스를 두 손가락 사이에 끼워 누름)
  fist       주먹           — CVA 압통(손등을 두드림)
  pinch      엄지+검지 집게  — 설압자·펜라이트
  two_finger 2·3지 신전      — 갑상샘 촉진

피부 텍스처는 **doctor_arm.glb에서 뽑은 MakeHuman 기본 스킨**을 쓴다.
아바타(mh_*.glb)의 스킨은 얼굴 사진 투영 파이프라인 산물이라 몸통이 어두운 갈색이고
손만 살색이어서 손목에서 색이 끊긴다 — 쓰지 말 것.

실행:
  Blender --background --python make_doctor_hands.py -- --pose grip_disc --out /tmp/hand.glb
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import addon_utils
import bpy
from mathutils import Matrix, Vector

# 사이드카 앵커에서 점(位置)인 키와 방향벡터인 키 — 정렬 변환을 다르게 적용한다
POINT_KEYS = ("wrist", "grip_two_finger", "pinch", "index_tip", "middle_tip", "thumb_tip")
DIR_KEYS = ("forearm_axis",)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--pose", default="palm")
ap.add_argument("--out", required=True)
ap.add_argument("--side", default="r", choices=["l", "r"])
ap.add_argument("--gender", type=float, default=0.85)
ap.add_argument("--age", type=float, default=0.55)
ap.add_argument("--skin", default="",
                help="피부 아틀라스. 비우면 MPFB 의 young_asian_male 스킨(CC0)을 찾아 쓴다. "
                     "아바타 스킨(사진투영)을 쓰면 손목에서 색이 끊긴다")
ap.add_argument("--subdiv", type=int, default=1)
ap.add_argument("--forearm", type=float, default=0.16,
                help="손목에서 남길 아래팔 길이(m). 소매가 덮을 만큼만 남긴다")
ap.add_argument("--no-align", dest="align", action="store_false",
                help="씬 규약(원점=손목, 손끝 −Y, 손바닥 +Z) 정렬을 끄고 MakeHuman 월드 좌표 그대로 낸다")
ap.set_defaults(align=True)
ARGS = ap.parse_args(argv)

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True, persistent=True)
_ext = sys.modules.get("bl_ext.user_default.mpfb")
if _ext is None:
    raise RuntimeError("MPFB Blender 확장을 활성화하지 못했다")
sys.modules["mpfb"] = _ext

from mpfb.services.humanservice import HumanService  # noqa: E402
from mpfb.services.targetservice import TargetService  # noqa: E402

S = ARGS.side
FINGERS = ("thumb", "index", "middle", "ring", "pinky")

# 각 손가락 (1마디, 2마디, 3마디) 굽힘 각도(도). 굽힘 축·부호는 아래에서 **실측으로** 정한다.
# adduct = 1마디를 옆으로 모으는 각도(도). 양수 = 중지 쪽으로.
POSES: dict[str, dict[str, object]] = {
    "palm": {
        "curl": {"thumb": (6, 4, 3), "index": (10, 8, 5), "middle": (11, 9, 6),
                 "ring": (13, 10, 7), "pinky": (15, 12, 8)},
        "adduct": {},
    },
    # 청진 — 검지·중지를 **모아서** 그 사이에 체스트피스를 끼우고, 약지·새끼는 접는다
    "grip_disc": {
        "curl": {"thumb": (26, 20, 12), "index": (26, 22, 14), "middle": (26, 22, 14),
                 "ring": (72, 78, 52), "pinky": (78, 84, 56)},
        "adduct": {"index": 7, "middle": -7},     # 서로 마주 모은다
    },
    # 주먹 — 엄지가 접힌 손가락 위를 덮는다. v1 각도(34,40,24)로는 엄지가 떠 있었다.
    "fist": {
        "curl": {"thumb": (68, 80, 48), "index": (86, 95, 70), "middle": (88, 98, 72),
                 "ring": (88, 98, 72), "pinky": (86, 95, 70)},
        "adduct": {},
    },
    # 집게 — 엄지와 검지가 마주 본다. index 를 엄지 **쪽으로** 모은다(v1 은 반대로 밀었다).
    # 실측 엄지끝↔검지끝 3.0cm — 본 기준이라 살은 그보다 1.5cm 가깝다. 설압자·펜라이트가 끼는 폭.
    "pinch": {
        "curl": {"thumb": (34, 30, 24), "index": (50, 56, 40), "middle": (66, 72, 48),
                 "ring": (72, 78, 52), "pinky": (76, 82, 54)},
        "adduct": {"thumb": -22, "index": -6},
    },
    # 2·3지 — 갑상샘 촉진
    "two_finger": {
        "curl": {"thumb": (30, 22, 14), "index": (14, 18, 12), "middle": (14, 18, 12),
                 "ring": (72, 78, 52), "pinky": (78, 84, 56)},
        "adduct": {"index": 4, "middle": -4},
    },
}
if ARGS.pose not in POSES:
    raise SystemExit(f"unknown pose {ARGS.pose!r}; choose from {sorted(POSES)}")

KEEP_PREFIX = tuple(
    [f"lowerarm_{S}", f"hand_{S}"] + [f"{f}_0{i}_{S}" for f in FINGERS for i in (1, 2, 3)]
)


CURL_PROBE: dict[str, Vector] = {}      # calibrate_curl 이 채운다 (손바닥 방향 교차검산용)


def clear_scene() -> None:
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def build_body():
    macro = TargetService.get_default_macro_info_dict()
    macro["gender"] = ARGS.gender
    macro["age"] = ARGS.age
    macro["weight"] = 0.5
    macro["race"] = {"asian": 1.0, "caucasian": 0.0, "african": 0.0}
    body = HumanService.create_human(macro_detail_dict=macro)
    TargetService.bake_targets(body)
    rig = HumanService.add_builtin_rig(body, "game_engine")
    if rig is None:
        raise RuntimeError("game_engine rig를 만들지 못했다")
    return body, rig


def tip_world(rig, finger: str) -> Vector:
    pb = rig.pose.bones.get(f"{finger}_03_{S}")
    return rig.matrix_world @ pb.tail if pb else Vector()


def calibrate_curl(rig) -> dict[str, tuple[int, float]]:
    """손가락이 **손바닥 쪽으로** 말리는 로컬 축과 부호를 실측한다.
    리그마다 축 규약이 달라 추측하면 손가락이 옆으로 꺾인다.
    방법: 각 축·부호로 시험 회전 → 손끝이 손바닥 중심에 가까워지는 조합을 채택."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    palm = rig.matrix_world @ rig.pose.bones[f"hand_{S}"].head
    out: dict[str, tuple[int, float]] = {}
    for finger in FINGERS:
        if finger == "thumb":
            continue                      # 엄지는 calibrate_thumb 가 따로 잰다
        pb = rig.pose.bones.get(f"{finger}_01_{S}")
        if pb is None:
            continue
        tip_rest = tip_world(rig, finger)
        base = (tip_rest - palm).length
        best, best_gain = (0, 1.0), 0.0
        for axis in (0, 2):
            for sign in (1.0, -1.0):
                pb.rotation_mode = "XYZ"
                rot = [0.0, 0.0, 0.0]
                rot[axis] = math.radians(45) * sign
                pb.rotation_euler = rot
                bpy.context.view_layer.update()
                gain = base - (tip_world(rig, finger) - palm).length   # 클수록 잘 말린다
                if gain > best_gain:
                    best_gain, best = gain, (axis, sign)
                    if finger == "index":
                        # 굽힘에 의한 손끝 변위 = 손바닥 쪽. hand_frame 의 법선 부호 교차검산에 쓴다.
                        CURL_PROBE["index"] = tip_world(rig, finger) - tip_rest
                pb.rotation_euler = (0, 0, 0)
                bpy.context.view_layer.update()
        out[finger] = best
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[hands] 굽힘축 실측: { {k: (v[0], int(v[1])) for k, v in out.items()} }")
    return out


def calibrate_thumb(rig, curl_axis: dict[str, tuple[int, float]]) -> tuple[int, float]:
    """엄지의 **대립(opposition)** 축을 실측한다.

    손바닥 중심을 목표로 삼으면 엄지가 옆으로 벌어지는 축이 뽑힌다(v1 버그).
    엄지가 마주 봐야 할 상대는 검지이므로, **검지를 미리 굽혀 놓고** 엄지끝이 검지끝에
    가장 가까워지는 축·부호를 고른다. 검지를 안 굽히면 순위가 뒤집힌다(실측 확인).
    """
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    ia, isg = curl_axis.get("index", (0, 1.0))
    for i, deg in enumerate((45, 45, 30), start=1):     # 검지 프로브 굽힘
        pb = rig.pose.bones.get(f"index_0{i}_{S}")
        if pb is None:
            continue
        pb.rotation_mode = "XYZ"
        rot = [0.0, 0.0, 0.0]
        rot[ia] = math.radians(deg) * isg
        pb.rotation_euler = rot
    bpy.context.view_layer.update()
    target = tip_world(rig, "index")

    best, best_d = (0, 1.0), 1e9
    for axis in (0, 1, 2):
        for sign in (1.0, -1.0):
            for i, deg in enumerate((45, 40, 30), start=1):
                pb = rig.pose.bones.get(f"thumb_0{i}_{S}")
                if pb is None:
                    continue
                pb.rotation_mode = "XYZ"
                rot = [0.0, 0.0, 0.0]
                rot[axis] = math.radians(deg) * sign
                pb.rotation_euler = rot
            bpy.context.view_layer.update()
            d = (tip_world(rig, "thumb") - target).length
            if d < best_d:
                best_d, best = d, (axis, sign)
    for pb in rig.pose.bones:                            # 프로브 자세 되돌리기
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[hands] 엄지 대립축 실측: axis={best[0]} sign={int(best[1])} (엄지끝→검지끝 {best_d*100:.2f}cm)")
    return best


def apply_pose(rig, pose_name: str, curl_axis: dict[str, tuple[int, float]]) -> int:
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    spec = POSES[pose_name]
    curls: dict = spec["curl"]          # type: ignore[assignment]
    adducts: dict = spec["adduct"]      # type: ignore[assignment]
    applied = 0
    for finger, angles in curls.items():
        axis, sign = curl_axis.get(finger, (0, 1.0))
        # 벌림/모음 축 = 굽힘축이 아닌 나머지 옆축
        add_axis = 2 if axis == 0 else 0
        for i, deg in enumerate(angles, start=1):
            pb = rig.pose.bones.get(f"{finger}_0{i}_{S}")
            if pb is None:
                print(f"[hands] 본 없음: {finger}_0{i}_{S}")
                continue
            pb.rotation_mode = "XYZ"
            rot = [0.0, 0.0, 0.0]
            rot[axis] = math.radians(deg) * sign
            if i == 1 and finger in adducts:
                rot[add_axis] = math.radians(float(adducts[finger]))
            pb.rotation_euler = rot
            applied += 1
    bpy.ops.object.mode_set(mode="OBJECT")
    return applied


def arm_frame(rig) -> tuple[Vector, Vector]:
    """아래팔 본의 (팔꿈치 위치, 손목 방향) — 소매를 붙일 기준.
    바운딩박스로 잡으면 A포즈에서 팔이 대각선이라 소매가 공중에 뜬다(첫 시도 실패 원인)."""
    pb = rig.pose.bones[f"lowerarm_{S}"]
    elbow = rig.matrix_world @ pb.head
    wrist = rig.matrix_world @ pb.tail
    return elbow, (wrist - elbow).normalized()


def trim_forearm(body, elbow: Vector, axis: Vector) -> None:
    """손목에서 지정 길이만 남기고 아래팔을 자른다 — 소매가 덮을 만큼만."""
    mesh = body.data
    wrist_t = max((body.matrix_world @ v.co - elbow).dot(axis) for v in mesh.vertices)
    keep_from = wrist_t - ARGS.forearm
    doomed = [v.index for v in mesh.vertices
              if (body.matrix_world @ v.co - elbow).dot(axis) < keep_from]
    if not doomed:
        return
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for i in doomed:
        mesh.vertices[i].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")


def cap_holes(body) -> None:
    """절단면이 뚫려 있으면 안이 들여다보인다 — 경계 루프를 메운다."""
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        # sides=0 = 변 개수 제한 없이 모든 열린 경계를 메운다 (절단면은 변이 많다)
        bpy.ops.mesh.fill_holes(sides=0)
    except RuntimeError as e:
        print(f"[hands] 경계 메우기 실패(무시): {e}")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")


def cut_to_hand(body, rig) -> tuple[Vector, Vector]:
    keep_idx = {vg.index for vg in body.vertex_groups if vg.name.startswith(KEEP_PREFIX)}
    if not keep_idx:
        raise RuntimeError(f"유지할 정점그룹을 못 찾았다: {[vg.name for vg in body.vertex_groups][:12]}")

    elbow, axis = arm_frame(rig)

    bpy.context.view_layer.objects.active = body
    for mod in list(body.modifiers):
        if mod.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=mod.name)   # 포즈를 메시에 굽는다

    mesh = body.data
    doomed = [v.index for v in mesh.vertices
              if sum(g.weight for g in v.groups if g.group in keep_idx) < 0.5]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for i in doomed:
        mesh.vertices[i].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")

    trim_forearm(body, elbow, axis)
    cap_holes(body)
    print(f"[hands] 절단 후 정점 {len(body.data.vertices)}개")
    return elbow, axis


def find_skin() -> Path:
    """피부 아틀라스 경로. --skin 이 없으면 MPFB 가 깔아 둔 CC0 스킨을 찾는다.

    doctor_arm.glb 에서 뽑아 쓰던 텍스처와 **픽셀 단위로 동일**함을 확인했다
    (2048² 전체 최대 차이 0). 출처가 불분명한 GLB 대신 원본을 직접 쓰는 편이 라이선스가 깨끗하다.
    """
    if ARGS.skin:
        return Path(ARGS.skin)
    import glob
    pat = str(Path(bpy.utils.resource_path("USER")).parent /
              "*/extensions/.user/user_default/mpfb/data/skins/young_asian_male/*_diffuse3.png")
    hits = sorted(glob.glob(pat)) or sorted(glob.glob(
        str(Path.home() / "Library/Application Support/Blender/*/extensions/**/skins/young_asian_male/*_diffuse3.png"),
        recursive=True))
    return Path(hits[0]) if hits else Path("/tmp/doctorarm_tex0.png")


def add_skin_material(body) -> None:
    mat = bpy.data.materials.new("skin")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    skin = find_skin()
    if skin.exists() and bsdf:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(skin))
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        print(f"[hands] 피부 텍스처: {skin.name}")
    elif bsdf:
        bsdf.inputs["Base Color"].default_value = (0.80, 0.62, 0.52, 1)
        print(f"[hands] 경고 — 스킨 없음({skin}), 단색 폴백")
    if bsdf:
        bsdf.inputs["Roughness"].default_value = 0.68   # RealisticPatient의 피부 값과 맞춤
    body.data.materials.clear()
    body.data.materials.append(mat)
    for p in body.data.polygons:
        p.use_smooth = True


def add_sleeve(body, elbow: Vector, axis: Vector) -> None:
    """가운 소매 + 커프. 절단면 위치·방향을 **본 축**에서 가져와 팔에 정확히 붙인다."""
    verts = [body.matrix_world @ v.co for v in body.data.vertices]
    if not verts:
        return
    ts = [(v - elbow).dot(axis) for v in verts]
    cut_t = min(ts)                                  # 절단면(팔꿈치 쪽 끝)
    cut_pt = elbow + axis * cut_t
    # 절단면 단면의 실제 반지름 — 얇은 슬라이스만 본다(두꺼우면 손까지 포함돼 과대추정)
    near = [v for v, t in zip(verts, ts) if t < cut_t + 0.012]
    r = (max((v - (elbow + axis * (v - elbow).dot(axis))).length for v in near) * 1.06
         if near else 0.045)

    rot = axis.to_track_quat("Z", "Y").to_euler()
    depth = 0.13
    # 소매는 절단면에서 **팔꿈치 쪽(-axis)** 으로 뻗어야 한다.
    # 손목 쪽(+axis)으로 밀면 손을 덮어 양동이처럼 보인다(첫 수정 때의 실패).
    # 절단면을 1cm만 물려 이음매를 가린다.
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth,
                                        location=cut_pt - axis * (depth * 0.5 - 0.01), vertices=32)
    sleeve = bpy.context.active_object
    sleeve.name = "sleeve"
    sleeve.rotation_euler = rot

    # 커프는 소매의 손목 쪽 끝(=절단면)에 — 여기가 피부와 천의 경계다
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.008,
                                     location=cut_pt + axis * 0.006,
                                     major_segments=32, minor_segments=12)
    cuff = bpy.context.active_object
    cuff.name = "cuff"
    cuff.rotation_euler = rot

    mat = bpy.data.materials.new("sleeve")
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = (0.93, 0.94, 0.96, 1)
        b.inputs["Roughness"].default_value = 0.85
    for ob in (sleeve, cuff):
        ob.data.materials.append(mat)
        for p in ob.data.polygons:
            p.use_smooth = True
    print(f"[hands] 소매 반지름 {r*100:.1f}cm, 절단면에 정렬")


def hand_frame(rig) -> tuple[Vector, Vector, Vector]:
    """(손목, 손끝 방향, 손바닥 법선) — 씬 좌표계로 정렬할 때 쓰는 기준틀.

    손바닥 법선의 부호는 두 방법으로 뽑아 **서로 대조한다.**
      (1) 오른손 기하: a = 검지너클 − 새끼너클 일 때 palm = a × f
      (2) 실측: 손가락은 손바닥 쪽으로 말리므로, 굽힘에 의한 손끝 변위가 손바닥 쪽을 가리킨다
    한쪽만 믿으면 손등과 손바닥이 뒤집혀도 알아채지 못한다(리그마다 축 규약이 달라서).
    """
    wrist = rig.matrix_world @ rig.pose.bones[f"hand_{S}"].head
    f = ((rig.matrix_world @ rig.pose.bones[f"middle_03_{S}"].tail) - wrist).normalized()
    a = ((rig.matrix_world @ rig.pose.bones[f"index_01_{S}"].head) -
         (rig.matrix_world @ rig.pose.bones[f"pinky_01_{S}"].head)).normalized()
    palm = a.cross(f).normalized()
    palm = (palm - f * palm.dot(f)).normalized()          # 손끝 축에 직교화

    probe = CURL_PROBE.get("index")
    if probe is not None and probe.length > 1e-6:
        d = (probe - f * probe.dot(f))
        if d.length > 1e-6:
            agree = palm.dot(d.normalized())
            print(f"[hands] 손바닥 법선 교차검산: 기하 vs 굽힘변위 = {agree:+.3f}")
            if agree < 0:
                # 두 방법이 어긋나면 실측(굽힘 변위)을 믿는다 — 기하식은 리그 명명 규약에 의존한다
                print("[hands] ⚠ 부호 불일치 — 실측(굽힘 변위) 쪽으로 뒤집는다")
                palm = -palm
    return wrist, f, palm


def scene_matrix(rig) -> tuple[Matrix, Matrix]:
    """씬 규약(`ClinicScene.tsx` `handQuat`)에 맞춰 메시를 원점·축 정렬한다.

    doctor_arm.glb 규약: **원점 = 손목, 손끝 = 로컬 −Y, 손바닥 법선 = 로컬 +Z.**
    이 규약을 맞춰 두면 씬이 `handQuat(finger, palm)` 을 그대로 재사용할 수 있고,
    에셋 교체가 좌표 재측정 없이 끝난다. 안 맞추면 손이 환자 몸에서 45cm 떨어진 곳에 뜬다
    (MakeHuman 월드 좌표 그대로 구워지므로 손목이 x≈−0.45, z≈0.98 에 있다).

    ⚠ 익스포터가 `export_yup=True` 로 Blender(x,y,z) → glTF(x, z, −y) 변환을 한 번 더 한다.
    그래서 **Blender 공간에서는 다른 목표축**으로 맞춰야 glTF 에서 의도한 축이 나온다:
        glTF −Y  ==  Blender (0, 0, −1)
        glTF +Z  ==  Blender (0, −1, 0)
    """
    wrist, f, palm = hand_frame(rig)
    ry = -palm                    # Blender +Y 로 갈 세계 방향 (= glTF +Z 의 원상)
    rz = -f                       # Blender +Z 로 갈 세계 방향 (= glTF −Y 의 원상)
    rx = ry.cross(rz).normalized()
    rot = Matrix((rx, ry, rz))    # 행이 기저 → 세계벡터를 로컬로 보낸다
    chk_f = (rot @ f).normalized()
    chk_p = (rot @ palm).normalized()
    print(f"[hands] 정렬 검산(Blender공간): 손끝→{tuple(round(x, 3) for x in chk_f)} "
          f"손바닥→{tuple(round(x, 3) for x in chk_p)}  (기대 (0,0,-1) / (0,-1,0))")
    if abs(chk_f.z + 1) > 1e-3 or abs(chk_p.y + 1) > 1e-3:
        raise RuntimeError("정렬 실패 — 축이 의도대로 안 갔다")

    # 손 방향(오른손/왼손) 검산. 손끝=−Y, 손바닥=+Z 인 틀에서 오른손이면 엄지 쪽이 −X 다
    # (오른손: 엄지 = 손끝 × 손바닥 = (0,−1,0)×(0,0,1) = (−1,0,0)).
    # ⚠ **엄지 끝**으로 재면 안 된다 — 주먹·집게에서는 엄지가 손바닥을 가로질러 반대편으로 넘어가
    #   정상인데도 부호가 뒤집힌다(실제로 fist·pinch 가 오판됐다). 너클(MCP)은 포즈와 무관하다.
    a = ((rig.matrix_world @ rig.pose.bones[f"index_01_{S}"].head) -
         (rig.matrix_world @ rig.pose.bones[f"pinky_01_{S}"].head))
    side_x = (rot @ a).x                          # Blender X = glTF X (yup 변환이 안 건드린다)
    got = "r" if side_x < 0 else "l"
    print(f"[hands] 손 방향 검산: 검지너클−새끼너클 x={side_x:+.4f} → {got}손 (기대 {S}손)")
    if got != S:
        raise RuntimeError(f"손 방향이 뒤집혔다 — {S} 을 만들려 했는데 {got} 이 나왔다")
    return rot.to_4x4() @ Matrix.Translation(-wrist), rot.to_4x4()


def tool_anchor(rig) -> dict:
    """도구(체스트피스·설압자 등)를 놓을 자리를 본에서 뽑아 사이드카 JSON으로 남긴다.
    씬에서 손을 붙일 때 이 값이 없으면 눈대중으로 맞춰야 한다."""
    def tail(bone: str):
        pb = rig.pose.bones.get(bone)
        return (rig.matrix_world @ pb.tail) if pb else None

    idx, mid = tail(f"index_03_{S}"), tail(f"middle_03_{S}")
    wrist = rig.matrix_world @ rig.pose.bones[f"hand_{S}"].head
    thumb = tail(f"thumb_03_{S}")
    a: dict = {"pose": ARGS.pose, "side": S,
               "wrist": [round(v, 5) for v in wrist]}
    # 개별 손끝도 남긴다 — 중점만으로는 도구 축(체스트피스 목이 어느 방향으로 빠지는지)을 못 정한다.
    # 손 방향(오른손/왼손) 검산에도 쓴다: 오른손이면 엄지 = 손끝방향 × 손바닥법선.
    for nm, v in (("index_tip", idx), ("middle_tip", mid), ("thumb_tip", thumb)):
        if v is not None:
            a[nm] = [round(x, 5) for x in v]
    if idx and mid:
        # 검지·중지 끝 중점 = 체스트피스가 끼는 자리
        grip = (idx + mid) / 2
        a["grip_two_finger"] = [round(v, 5) for v in grip]
        a["finger_gap_cm"] = round((idx - mid).length * 100, 2)
    if idx and thumb:
        a["pinch"] = [round(v, 5) for v in ((idx + thumb) / 2)]
        # 집게 폭 — 설압자/펜라이트 굵기를 이 값에 맞춘다. 본 기준이라 살은 ~1.5cm 더 가깝다.
        a["pinch_gap_cm"] = round((idx - thumb).length * 100, 2)
    return a


def main() -> None:
    clear_scene()
    body, rig = build_body()
    curl_axis = calibrate_curl(rig)
    curl_axis["thumb"] = calibrate_thumb(rig, curl_axis)
    n = apply_pose(rig, ARGS.pose, curl_axis)
    print(f"[hands] 포즈 '{ARGS.pose}' — 본 {n}개")
    anchor = tool_anchor(rig)
    M, R = scene_matrix(rig)                       # 리그가 살아 있을 때만 잴 수 있다
    elbow, axis = cut_to_hand(body, rig)
    anchor["forearm_axis"] = [round(v, 5) for v in axis]
    bpy.data.objects.remove(rig, do_unlink=True)
    add_skin_material(body)
    if ARGS.subdiv > 0:
        sub = body.modifiers.new("subsurf", "SUBSURF")
        sub.levels = sub.render_levels = ARGS.subdiv
    add_sleeve(body, elbow, axis)
    body.name = "hand"

    if ARGS.align:
        moved = [o for o in bpy.data.objects if o.type == "MESH"]
        for ob in moved:
            ob.matrix_world = M @ ob.matrix_world
        bpy.context.view_layer.update()
        anchor = {k: (list(M @ Vector(v)) if k in POINT_KEYS else
                      (list(R.to_3x3() @ Vector(v)) if k in DIR_KEYS else v))
                  for k, v in anchor.items()}
        anchor["source_wrist"] = [round(v, 5) for v in (M.inverted() @ Vector((0, 0, 0)))]

    out = Path(ARGS.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", export_yup=True,
                              export_apply=True, export_morph=False, export_skins=False,
                              export_image_format="WEBP")

    # glTF는 export_yup=True로 축이 바뀐다: Blender (x,y,z) → glTF (x, z, -y).
    # 사이드카 좌표도 같은 변환을 해야 씬에서 그대로 쓸 수 있다.
    def to_gltf(v):
        return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]
    import json
    conv = {k: (to_gltf(v) if isinstance(v, list) and len(v) == 3 else v)
            for k, v in anchor.items()}
    if ARGS.align:
        conv["frame"] = "origin=wrist, finger=-Y, palm=+Z (doctor_arm.glb 규약)"
        # 손(소매 제외) bbox — 씬이 손을 체표에 앉힐 때 최저점 계산(armLowestY)에 쓴다.
        # ⚠ bbox 는 **glTF 공간으로 변환한 뒤** min/max 를 잡아야 한다. Blender 공간에서
        #   먼저 min/max 를 잡고 변환하면 z = −y 부호 반전 때문에 min 과 max 가 뒤바뀐다.
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)                 # subsurf 적용 후 = 실제 익스포트되는 형상
        me = ev.to_mesh()
        gpts = [to_gltf(ev.matrix_world @ v.co) for v in me.vertices]
        ev.to_mesh_clear()
        conv["hand_bbox_min"] = [round(min(p[i] for p in gpts), 5) for i in range(3)]
        conv["hand_bbox_max"] = [round(max(p[i] for p in gpts), 5) for i in range(3)]
    side = out.with_suffix(".anchors.json")
    side.write_text(json.dumps(conv, ensure_ascii=False, indent=1))
    print(f"[hands] EXPORTED {out} bytes={out.stat().st_size if out.exists() else 0}")
    print(f"[hands] anchors {side.name}: {conv}")


main()
