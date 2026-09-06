"""Extract a lightweight oral-exam asset from Google's Apache-2.0 GNM head.

GNM ships one dense head mesh with semantic vertex groups.  This builder keeps
only the upper teeth/gums, lower teeth/gums, and tongue, then bakes a clinically
useful open-mouth pose.  The generated GLB is a modified derivative of GNM v3;
keep the adjacent Apache license and the attribution in models/CREDITS.md.

Run with Blender (not the system Python)::

    blender --background --python tools/props/build_gnm_oral_asset.py -- \
      --source /path/to/GNM/gnm/shape/data/versions/v3_0/gnm_head.npz \
      --out frontend/public/models/gnm_oral_anatomy.glb
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
import numpy as np


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(raw)


def material(name: str, color: tuple[float, float, float, float], roughness: float):
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = 0.0
    # Teeth need a restrained wet enamel highlight, not an emissive white strip.
    if name == "GNM_Enamel":
        if "Coat Weight" in principled.inputs:
            principled.inputs["Coat Weight"].default_value = 0.12
        if "Coat Roughness" in principled.inputs:
            principled.inputs["Coat Roughness"].default_value = 0.28
    return value


def main() -> None:
    args = arguments()
    if not args.source.is_file():
        raise FileNotFoundError(args.source)

    data = np.load(args.source, allow_pickle=False)
    vertices = np.asarray(data["template_vertex_positions"], dtype=np.float64)
    triangles = np.asarray(data["triangles"], dtype=np.int64)
    names = [str(value) for value in data["vertex_group_names"]]
    groups = np.asarray(data["vertex_groups"], dtype=np.float64)

    required = {
        "upper_teeth_and_gums",
        "lower_teeth_and_gums",
        "mouth_sock",
        "tongue",
        "teeth",
        "gums",
    }
    missing = required.difference(names)
    if missing:
        raise RuntimeError(f"GNM is missing semantic groups: {sorted(missing)}")

    weights = {name: groups[names.index(name)] for name in required}
    components = [
        ("GNM_UpperTeethGums", "upper_teeth_and_gums", 0.0, 0.0),
        # The template is close-mouthed.  Move only the lower dental arch down;
        # 18 mm produces a useful oral-exam aperture without stretching teeth.
        ("GNM_LowerTeethGums", "lower_teeth_and_gums", -0.018, 0.0),
        # The depressor will move the whole runtime group a little farther down.
        ("GNM_Tongue", "tongue", -0.013, 0.003),
        # Inner cheeks and gingivobuccal sulcus.  This replaces the flat pink
        # plate that used to make close oral views look like a sticker.
        ("GNM_MouthSock", "mouth_sock", 0.0, -0.012),
    ]

    dental_raw = vertices[
        (weights["upper_teeth_and_gums"] > 0.5)
        | (weights["lower_teeth_and_gums"] > 0.5)
    ]
    center_x = (dental_raw[:, 0].min() + dental_raw[:, 0].max()) * 0.5
    adjusted = []
    for _, group_name, y_offset, z_offset in components:
        mask = weights[group_name] > 0.5
        values = vertices[mask].copy()
        if group_name == "mouth_sock":
            # Open the lower half smoothly with the dental arch.  A hard split
            # would leave a visible seam at the mouth corners.
            lower_weight = np.clip((0.241 - values[:, 1]) / 0.018, 0.0, 1.0)
            lower_weight = lower_weight * lower_weight * (3.0 - 2.0 * lower_weight)
            values[:, 1] -= lower_weight * 0.018
            values[:, 0] = center_x + (values[:, 0] - center_x) * 0.72
        values[:, 1] += y_offset
        values[:, 2] += z_offset
        adjusted.append(values)
    dental = np.concatenate(adjusted[:2], axis=0)
    center_y = (dental[:, 1].min() + dental[:, 1].max()) * 0.5
    front_z = max(values[:, 2].max() for values in adjusted[:2])

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    enamel = material("GNM_Enamel", (0.72, 0.67, 0.59, 1.0), 0.38)
    gingiva = material("GNM_Gingiva", (0.42, 0.16, 0.18, 1.0), 0.58)
    tongue = material("GNM_Tongue", (0.47, 0.20, 0.22, 1.0), 0.48)
    mucosa = material("GNM_OralMucosa", (0.34, 0.10, 0.13, 1.0), 0.66)

    triangle_count = 0
    for object_name, group_name, y_offset, z_offset in components:
        component_mask = weights[group_name] > 0.5
        face_mask = np.all(component_mask[triangles], axis=1)
        faces_global = triangles[face_mask]
        if group_name in {"upper_teeth_and_gums", "lower_teeth_and_gums"}:
            tooth_score = weights["teeth"][faces_global].mean(axis=1)
            gum_score = weights["gums"][faces_global].mean(axis=1)
            tooth_face = tooth_score >= gum_score
            centers = vertices[faces_global].mean(axis=1)
            # The semantic group contains the whole deep alveolar base.  It is
            # anatomically valid inside a complete GNM head, but protrudes from
            # the corner when transplanted behind another avatar's lips.  Keep
            # all enamel plus only the anterior gingival collar around it.
            visible_gum = (
                (centers[:, 2] > 0.110)
                & (np.abs(centers[:, 0] - center_x) < 0.030)
            )
            faces_global = faces_global[tooth_face | visible_gum]
        used = np.unique(faces_global.reshape(-1))
        remap = np.full(vertices.shape[0], -1, dtype=np.int64)
        remap[used] = np.arange(used.size)
        faces = remap[faces_global]

        values = vertices[used].copy()
        values[:, 0] -= center_x
        if group_name == "mouth_sock":
            lower_weight = np.clip((0.241 - values[:, 1]) / 0.018, 0.0, 1.0)
            lower_weight = lower_weight * lower_weight * (3.0 - 2.0 * lower_weight)
            values[:, 1] -= lower_weight * 0.018
            # Another avatar's lips are the aperture mask.  Narrow and recess
            # the inner-cheek sock so its side wall cannot escape that mask at
            # oblique viewing angles.
            values[:, 0] = center_x + (values[:, 0] - center_x) * 0.72
        values[:, 1] += y_offset - center_y
        values[:, 2] += z_offset - front_z
        # GNM is X-right/Y-up/Z-forward. Blender is X-right/Z-up/-Y-forward;
        # this conversion makes the exported glTF return to GNM's axes in three.js.
        blender_vertices = np.column_stack((values[:, 0], -values[:, 2], values[:, 1]))

        mesh_data = bpy.data.meshes.new(f"{object_name}_Mesh")
        mesh_data.from_pydata(blender_vertices.tolist(), [], faces.tolist())
        mesh_data.update(calc_edges=False)
        object_value = bpy.data.objects.new(object_name, mesh_data)
        bpy.context.collection.objects.link(object_value)
        object_value["source"] = "Google GNM v3 (https://github.com/google/GNM)"
        object_value["license"] = "Apache-2.0"
        object_value["modified"] = "Extracted semantic oral groups; lower jaw and tongue repositioned"

        if group_name in {"tongue", "mouth_sock"}:
            mesh_data.materials.append(tongue if group_name == "tongue" else mucosa)
            for polygon in mesh_data.polygons:
                polygon.material_index = 0
                polygon.use_smooth = True
        else:
            mesh_data.materials.append(enamel)
            mesh_data.materials.append(gingiva)
            tooth_weights = weights["teeth"][faces_global].mean(axis=1)
            gum_weights = weights["gums"][faces_global].mean(axis=1)
            for polygon, is_tooth in zip(mesh_data.polygons, tooth_weights >= gum_weights):
                polygon.material_index = 0 if bool(is_tooth) else 1
                polygon.use_smooth = True
        triangle_count += len(faces)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(args.out.resolve()),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_extras=True,
    )
    print(
        f"GNM_ORAL_EXPORTED path={args.out.resolve()} triangles={triangle_count} "
        f"size={args.out.stat().st_size}"
    )


if __name__ == "__main__":
    main()
