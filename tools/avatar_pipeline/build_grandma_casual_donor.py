"""Build a practical two-piece outfit for the obese older female patient.

Run through Blender with MPFB installed:

  blender --background --python tools/avatar_pipeline/build_grandma_casual_donor.py

The donor is fitted against the exact ``mh_f60_ob`` production body.  It uses
two ordinary MakeHuman garments: a loose, long-sleeve tunic and female stretch
trousers.  The exported GLB intentionally carries neutral materials only;
runtime applies the subdued floral cotton and matte charcoal fabric.  Keeping
the meshes separate also lets the clinical-exam controls remove each garment
independently.
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
ASSET_ROOT = Path(__file__).resolve().parent / "assets" / "clothes"
TUNIC_MHCLO = (
    ASSET_ROOT
    / "janexx_old_female_sweater"
    / "janexx_old_female_sweater.mhclo"
)
SLACKS_MHCLO = (
    ASSET_ROOT
    / "mindfront_female_trousers_1"
    / "mindfront_female_trousers_1.mhclo"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-glb",
        default=str(
            REPO_ROOT
            / "frontend"
            / "public"
            / "avatars"
            / "mh_f60_ob_grandma_casual.glb"
        ),
    )
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(arguments)


def neutral_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = 0.92
        principled.inputs["Metallic"].default_value = 0.0
    return material


def add_garment(
    body: bpy.types.Object,
    source: Path,
    object_name: str,
    material_name: str,
    color: tuple[float, float, float, float],
) -> bpy.types.Object:
    garment = HumanService.add_mhclo_asset(
        str(source),
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
    garment.name = object_name
    garment.data.name = object_name
    # MPFB cleans unused datablocks during import, so create the runtime-neutral
    # material only after the garment exists.
    material = neutral_material(material_name, color)
    garment.data.materials.clear()
    garment.data.materials.append(material)

    # 예전에는 MPFB가 건 SUBSURF(levels=0 / render_levels=1)를 굽지 않은 채
    # `export_apply=False`로 내보내서 모디파이어가 통째로 버려졌다.
    # 그래서 튜닉이 1,736 verts로 나갔다. 이제는 명시적으로 굽는다.
    level = subdivision_level(len(garment.data.vertices))
    if level:
        subdivision = garment.modifiers.new("GarmentSubdivision", "SUBSURF")
        subdivision.subdivision_type = "CATMULL_CLARK"
        subdivision.levels = level
        subdivision.render_levels = level
        ExportService.bake_modifiers_remove_helpers(
            garment,
            bake_masks=False,
            bake_subdiv=True,
            remove_helpers=False,
            also_proxy=False,
        )

    # 서브디비전만으로는 셰이딩이 끊기는 각이 남을 수 있다. 오브젝트 단위로
    # 스무스를 다시 걸고 법선을 재계산해 실루엣이 아닌 곳에 각이 남지 않게 한다.
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = garment
    garment.select_set(True)
    bpy.ops.object.shade_smooth()
    for polygon in garment.data.polygons:
        polygon.use_smooth = True
    garment.data.update()

    vertex_count = len(garment.data.vertices)
    print(f"[grandma-casual] {object_name} subdiv={level} verts={vertex_count}")
    if vertex_count < MINIMUM_VERTS:
        raise RuntimeError(
            f"{object_name} exported at {vertex_count} verts, below "
            f"{MINIMUM_VERTS}: subdivision was not baked"
        )
    return garment


ARGS = parse_args()
OUTPUT = Path(ARGS.output_glb).resolve()
for source in (TUNIC_MHCLO, SLACKS_MHCLO):
    if not source.exists():
        raise FileNotFoundError(f"Missing clothing source: {source}")
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
load_body_targets(TargetService, body, macro["weight"], "grandma-casual")

try:
    TargetService.reapply_macro_details(body)
except Exception as error:  # MPFB may already have applied the macro on create.
    print("[grandma-casual] macro reapply skipped", repr(error))

rig = HumanService.add_builtin_rig(body, "game_engine")
if rig is None:
    raise RuntimeError("MPFB game_engine rig was not created")
TargetService.bake_targets(body)

add_garment(
    body,
    TUNIC_MHCLO,
    "PATIENT_GRANDMA_FLORAL_TUNIC",
    "GRANDMA_FLORAL_COTTON",
    (0.42, 0.22, 0.27, 1.0),
)
add_garment(
    body,
    SLACKS_MHCLO,
    "PATIENT_GRANDMA_CHARCOAL_SLACKS",
    "GRANDMA_CHARCOAL_WOOL",
    (0.14, 0.16, 0.18, 1.0),
)

# MHCLO needs the complete construction mesh while fitting.  Production keeps
# only the two garments and the skeleton.
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
    # Draco 양자화는 Blender 기본값(position 14 / normal 10)을 쓴다. position 16 /
    # normal 16으로 올려 렌더를 비교했더니 682,000 픽셀 중 190개만 4/255 넘게
    # 달랐고(전부 실루엣 경계), 파일은 390KB -> 548KB로 40% 커졌다. 눈에 보이는
    # 이득이 없으므로 올리지 않는다.
    "export_image_format": "WEBP",
    "export_image_add_webp": True,
}
supported = {prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
bpy.ops.export_scene.gltf(
    **{key: value for key, value in export_kwargs.items() if key in supported},
)
if not OUTPUT.exists() or OUTPUT.stat().st_size < 50_000:
    raise RuntimeError("Grandma casual donor export failed")
print("[grandma-casual] EXPORTED", OUTPUT, OUTPUT.stat().st_size)
