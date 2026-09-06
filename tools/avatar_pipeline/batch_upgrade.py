"""Generate, validate and optionally deploy every production MPFB avatar."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys


PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
DEFAULT_AVATARS = REPO_ROOT / "frontend" / "public" / "avatars"
DEFAULT_STAGING = Path("/tmp/patient-talk-morphs")
REQUIRED_MORPHS = {
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "jawOpen",
    "mouthSmileLeft",
    "mouthSmileRight",
    "browInnerUp",
    "viseme_aa",
    "viseme_O",
    "viseme_E",
    "viseme_PP",
}
# 런타임(`RealisticPatient.tsx`의 materialKind)이 헤어를 고르는 토큰과 같아야
# 검증이 실제 렌더 경로를 반영한다.
HAIR_TOKENS = re.compile(r"(hair|alpha7|ponytail|braid|curled|bob|maxwell|grump|culturalibre)")
NOT_HAIR_TOKENS = re.compile(r"(eyebrow|eyelash)")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--blender",
        default="/Applications/Blender.app/Contents/MacOS/Blender",
    )
    parser.add_argument("--avatars", type=Path, default=DEFAULT_AVATARS)
    parser.add_argument("--staging", type=Path, default=DEFAULT_STAGING)
    parser.add_argument("--only", nargs="*", default=[])
    parser.add_argument("--deploy", action="store_true")
    parser.add_argument("--reuse-staged", action="store_true")
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate the currently deployed avatar files without running Blender",
    )
    parser.add_argument("--morph-normals", action="store_true")
    parser.add_argument(
        "--draco-hq",
        action="store_true",
        help="Export with explicit high Draco quantization instead of Blender defaults",
    )
    parser.add_argument(
        "--subdivide",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Bake one Catmull-Clark level into every morph (default: enabled)",
    )
    return parser.parse_args()


def glb_json(path: Path) -> dict:
    with path.open("rb") as handle:
        magic, version, _ = struct.unpack("<4sII", handle.read(12))
        if magic != b"glTF" or version != 2:
            raise ValueError(f"Not a glTF 2 GLB: {path}")
        chunk_length, chunk_type = struct.unpack("<II", handle.read(8))
        if chunk_type != 0x4E4F534A:
            raise ValueError(f"First GLB chunk is not JSON: {path}")
        return json.loads(handle.read(chunk_length))


def validate(path: Path) -> dict[str, int]:
    document = glb_json(path)
    morph_sets = []
    for mesh in document.get("meshes", []):
        names = mesh.get("extras", {}).get("targetNames", [])
        target_count = max(
            (len(primitive.get("targets", [])) for primitive in mesh.get("primitives", [])),
            default=0,
        )
        if target_count:
            primitive = next(
                (item for item in mesh.get("primitives", []) if item.get("targets")),
                None,
            )
            position_accessor = primitive.get("attributes", {}).get("POSITION") if primitive else None
            vertex_count = (
                document["accessors"][position_accessor]["count"]
                if position_accessor is not None
                else 0
            )
            morph_sets.append((set(names), target_count, vertex_count))
    valid_set = next(
        ((names, count, vertices) for names, count, vertices in morph_sets if REQUIRED_MORPHS <= names),
        None,
    )
    if valid_set is None:
        raise ValueError(f"Required native face morphs are missing: {path}")
    names, target_count, vertex_count = valid_set
    if target_count != 67 or len(names) != 67:
        raise ValueError(f"Expected 67 face targets, found {target_count}/{len(names)}: {path}")
    if not document.get("skins"):
        raise ValueError(f"Armature skin is missing: {path}")
    if len(document.get("images", [])) < 3:
        raise ValueError(f"Embedded production textures are missing: {path}")

    materials = document.get("materials", [])
    # 헤어는 알파로 잘라내는 카드 구조라, 텍스처 없이 OPAQUE로 나가면 판때기가
    # 그대로 드러나 "니트 모자"처럼 보인다. mh_m30/m40/m60이 그 상태였다.
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            index = primitive.get("material")
            if index is None:
                continue
            material = materials[index]
            identity = f"{mesh.get('name', '')} {material.get('name', '')}".lower()
            if HAIR_TOKENS.search(identity) and not NOT_HAIR_TOKENS.search(identity):
                textured = "baseColorTexture" in material.get("pbrMetallicRoughness", {})
                if not textured or material.get("alphaMode", "OPAQUE") == "OPAQUE":
                    raise ValueError(
                        f"Hair mesh {mesh.get('name')!r} is a solid shell "
                        f"(textured={textured} alphaMode={material.get('alphaMode', 'OPAQUE')}): {path}"
                    )

    # 스킨이 없는 메시는 캐릭터 파츠가 아니다. mh_m40에는 원점에 2m짜리 기본
    # Blender Cube가 섞여 나가고 있었고, 런타임에 필터가 없어 그대로 렌더됐다.
    strays = [
        node.get("name", "?")
        for node in document.get("nodes", [])
        if "mesh" in node and "skin" not in node
    ]
    if strays:
        raise ValueError(f"Unrigged stray meshes present {strays}: {path}")
    return {
        "morphs": target_count,
        "vertices": vertex_count,
        "meshes": len(document.get("meshes", [])),
        "images": len(document.get("images", [])),
        "bytes": path.stat().st_size,
    }


def main() -> int:
    args = arguments()
    if args.validate_only and args.deploy:
        raise ValueError("--validate-only cannot be combined with --deploy")
    configs = json.loads((PIPELINE_DIR / "characters.json").read_text())
    if args.only:
        requested = set(args.only)
        configs = [config for config in configs if config["name"] in requested]
        missing = requested - {config["name"] for config in configs}
        if missing:
            raise ValueError(f"Unknown avatars: {', '.join(sorted(missing))}")
    if not args.validate_only:
        args.staging.mkdir(parents=True, exist_ok=True)

    outputs: list[tuple[dict, Path, dict[str, int]]] = []
    for index, config in enumerate(configs, 1):
        source = args.avatars / f"{config['name']}.glb"
        destination = source if args.validate_only else args.staging / source.name
        if not source.exists():
            raise FileNotFoundError(source)
        print(f"[{index:02d}/{len(configs):02d}] {config['name']}", flush=True)
        if args.validate_only:
            print(f"  validating deployed {destination}")
        elif not (args.reuse_staged and destination.exists()):
            command = [
                args.blender,
                "--background",
                # 이게 없으면 Blender는 파이썬이 예외로 죽어도 0을 반환한다.
                # 실제로 헤어 교체가 터졌는데도 배치가 그냥 넘어갔었다.
                "--python-exit-code",
                "1",
                "--python",
                str(PIPELINE_DIR / "upgrade_mpfb_morphs.py"),
                "--",
                "--source-glb",
                str(source),
                "--output-glb",
                str(destination),
                "--gender",
                str(config["gender"]),
                "--age",
                str(config["age"]),
                "--weight",
                str(config["weight"]),
            ]
            if args.morph_normals:
                command.append("--morph-normals")
            if args.subdivide:
                command.append("--subdivide")
            if args.draco_hq:
                command.append("--draco-hq")
            # 베이크된 헤어가 알파 카드가 아니라 통짜 셸인 캐릭터만 교체한다.
            if config.get("hair"):
                command.extend(["--hair", config["hair"]])
            if config.get("hair_texture"):
                command.extend(["--hair-texture", config["hair_texture"]])
            if config.get("eyebrows"):
                command.extend(["--eyebrows", config["eyebrows"]])
            if config.get("eyebrow_tint"):
                command.extend(["--eyebrow-tint", config["eyebrow_tint"]])
            result = subprocess.run(command, text=True, capture_output=True, check=False)
            if result.returncode:
                print(result.stdout)
                print(result.stderr, file=sys.stderr)
                raise RuntimeError(f"Blender failed for {config['name']}")
            for line in result.stdout.splitlines():
                # 레이어 수치는 통과했을 때도 보여야 한다. 허리밴드·헤어 게이트는
                # 실패할 때만 말하면 "예전엔 얼마였는데" 비교를 할 수 없다.
                if any(
                    marker in line
                    for marker in (
                        "[morph-upgrade] EXPORTED",
                        "[morph-upgrade] topology",
                        "[morph-upgrade] layering",
                        "[morph-upgrade] hair fitted",
                        "[morph-upgrade] eyebrows fitted",
                        "[morph-upgrade] replacing eyebrow",
                    )
                ):
                    print(f"  {line}")
        else:
            print(f"  reusing staged {destination}")
        stats = validate(destination)
        if args.subdivide and stats["vertices"] < 50_000:
            raise ValueError(
                f"Expected subdivided morph body, found {stats['vertices']} vertices: {destination}"
            )
        print(
            f"  validated morphs={stats['morphs']} vertices={stats['vertices']} meshes={stats['meshes']} "
            f"images={stats['images']} size={stats['bytes'] / 1_048_576:.1f}MiB",
            flush=True,
        )
        outputs.append((config, destination, stats))

    if args.deploy:
        # Deployment starts only after every staged GLB has passed structural
        # validation, so a single failed character cannot leave a mixed set.
        for config, staged, _ in outputs:
            deployed = args.avatars / staged.name
            shutil.copy2(staged, deployed)
            print(f"  deployed {config['name']} -> {deployed}")

    total_bytes = sum(stats["bytes"] for _, _, stats in outputs)
    print(
        f"COMPLETE avatars={len(outputs)} total={total_bytes / 1_048_576:.1f}MiB "
        f"deployed={args.deploy} validate_only={args.validate_only}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
