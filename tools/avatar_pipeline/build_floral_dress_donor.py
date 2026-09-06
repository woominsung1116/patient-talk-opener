"""Build the rigged CC0 floral dress donor for the obese older patient.

Run through Blender with MPFB installed:

  blender --background --python tools/avatar_pipeline/build_floral_dress_donor.py

The garment comes from MakeHuman Community's official Dress 01 CC0 pack. The
script rebuilds the exact ``mh_f60_ob`` body used by the production avatar,
fits the MHCLO proxy to it, transfers game-engine rig weights, then exports only
the dress and skeleton. Runtime combines that donor with the detailed patient.
"""

from __future__ import annotations

import argparse
import addon_utils
from pathlib import Path
import sys

import bpy

# Blender는 --python 스크립트의 디렉터리를 sys.path에 넣어주지 않는다.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from body_shape_targets import load_body_targets  # noqa: E402
from garment_density import MINIMUM_VERTS, subdivision_level  # noqa: E402


REPO_ROOT = Path(__file__).resolve().parents[2]
ASSET_ROOT = Path(__file__).resolve().parent / "assets" / "clothes" / "aethelraed_flapper_dress"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-glb",
        default=str(REPO_ROOT / "frontend" / "public" / "avatars" / "mh_f60_ob_floral_dress.glb"),
    )
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(arguments)


ARGS = parse_args()
OUTPUT = Path(ARGS.output_glb).resolve()
MHCLO = ASSET_ROOT / "aethelraed_flapper_dress.mhclo"
if not MHCLO.exists():
    raise FileNotFoundError(f"Missing CC0 dress source: {MHCLO}")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True, persistent=True)
extension = sys.modules.get("bl_ext.user_default.mpfb")
if extension is None:
    raise RuntimeError("MPFB Blender extension could not be enabled")
sys.modules["mpfb"] = extension

from mpfb.services.exportservice import ExportService  # noqa: E402
from mpfb.services.humanservice import HumanService  # noqa: E402
from mpfb.services.targetservice import TargetService  # noqa: E402


for scene_object in list(bpy.data.objects):
    bpy.data.objects.remove(scene_object, do_unlink=True)

macro = TargetService.get_default_macro_info_dict()
macro["gender"] = 0.0
macro["age"] = 0.808
macro["weight"] = 0.85
macro["race"] = {"asian": 1.0, "caucasian": 0.0, "african": 0.0}
body = HumanService.create_human(macro_detail_dict=macro)

# 체형 표는 `body_shape_targets`가 단일 출처다. 여기서 다시 베끼면 본체와
# 어긋난 몸에 옷이 피팅되어 조용히 몸을 파고든다.
load_body_targets(TargetService, body, macro["weight"], "floral-dress")

try:
    TargetService.reapply_macro_details(body)
except Exception as error:  # MPFB may already have applied the macro on create.
    print("[floral-dress] macro reapply skipped", repr(error))

rig = HumanService.add_builtin_rig(body, "game_engine")
if rig is None:
    raise RuntimeError("MPFB game_engine rig was not created")
TargetService.bake_targets(body)

dress = HumanService.add_mhclo_asset(
    str(MHCLO),
    body,
    asset_type="Clothes",
    # 레벨은 피팅 뒤 실제 베이스 밀도를 보고 정한다.
    subdiv_levels=0,
    material_type="MAKESKIN",
    set_up_rigging=True,
    interpolate_weights=True,
    import_subrig=True,
    import_weights=True,
)
dress.name = "PATIENT_FLORAL_DRESS"
dress.data.name = "PATIENT_FLORAL_DRESS"

# 예전에는 SUBSURF를 굽지 않은 채 `export_apply=False`로 내보내 모디파이어가
# 통째로 버려졌다. 레벨은 베이스 밀도로부터 역산한다 — 이 드레스는 베이스가
# 6,774라 레벨 2면 104,000까지 부풀어 오른다.
dress_level = subdivision_level(len(dress.data.vertices))
if dress_level:
    dress_subdivision = dress.modifiers.new("GarmentSubdivision", "SUBSURF")
    dress_subdivision.subdivision_type = "CATMULL_CLARK"
    dress_subdivision.levels = dress_level
    dress_subdivision.render_levels = dress_level
    ExportService.bake_modifiers_remove_helpers(
        dress,
        bake_masks=False,
        bake_subdiv=True,
        remove_helpers=False,
        also_proxy=False,
    )

bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = dress
dress.select_set(True)
bpy.ops.object.shade_smooth()
for polygon in dress.data.polygons:
    polygon.use_smooth = True
dress.data.update()

dress_verts = len(dress.data.vertices)
print(f"[floral-dress] PATIENT_FLORAL_DRESS subdiv={dress_level} verts={dress_verts}")
if dress_verts < MINIMUM_VERTS:
    raise RuntimeError(
        f"Dress exported at {dress_verts} verts, below {MINIMUM_VERTS}: "
        "subdivision was not baked"
    )

# MHCLO needs the complete construction mesh while fitting. The production
# donor contains only the finished garment and skeleton, never that helper body.
ExportService.bake_modifiers_remove_helpers(
    body,
    bake_masks=False,
    bake_subdiv=False,
    remove_helpers=True,
    also_proxy=False,
)
bpy.data.objects.remove(body, do_unlink=True)

export_kwargs = {
    "filepath": str(OUTPUT),
    "export_format": "GLB",
    "export_yup": True,
    "export_apply": False,
    "export_draco_mesh_compression_enable": True,
    "export_draco_mesh_compression_level": 6,
    # Draco 양자화는 Blender 기본값을 쓴다 — 올려도 렌더 차이가 없고 파일만
    # 커진다는 것을 실측했다(`build_grandma_casual_donor.py` 주석 참조).
    "export_image_format": "WEBP",
    "export_image_add_webp": True,
}
supported = {prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
bpy.ops.export_scene.gltf(
    **{key: value for key, value in export_kwargs.items() if key in supported},
)
if not OUTPUT.exists() or OUTPUT.stat().st_size < 100_000:
    raise RuntimeError("Floral dress donor export failed")
print("[floral-dress] EXPORTED", OUTPUT, OUTPUT.stat().st_size)
