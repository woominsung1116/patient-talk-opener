"""배포된 GLB의 의상·헤어 레이어 정합을 수치로 잰다.

렌더는 "보이는가"를 답하지만 "몇 mm 뚫렸는가"는 답하지 못한다. 허리밴드
관통(mh_m60)과 티셔츠 속에 박힌 긴 머리(mh_f20_thin)는 각도와 조명에 따라
보였다 안 보였다 하므로, 전/후 비교는 수치로 해야 한다.

  blender --background --python measure_layers.py -- avatar.glb [avatar.glb ...]

출력 한 줄에: 허리밴드가 상의를 뚫은 방위각 칸 수와 최대 깊이, 상의 속에 박힌
헤어 정점 비율. 빌드 게이트(`upgrade_mpfb_morphs.py`)와 같은 모듈을 쓴다.
"""

from __future__ import annotations

from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from garment_layers import (  # noqa: E402
    hair_drape_over_upper,
    split_layers,
    waist_breach,
)


paths = sys.argv[sys.argv.index("--") + 1 :]
if not paths:
    raise SystemExit(
        "Usage: blender --background --python measure_layers.py -- avatar.glb [...]"
    )

worst = 0.0
for item in paths:
    source = Path(item).resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    # 임포터의 본 표시용 Icosphere는 캐릭터 파츠가 아니다.
    meshes = [
        obj
        for obj in bpy.data.objects
        if obj.type == "MESH"
        and not any(
            collection.name == "glTF_not_exported" for collection in obj.users_collection
        )
    ]
    uppers, lowers, hairs = split_layers(meshes)
    cells, depth = waist_breach(meshes)
    drop, below = hair_drape_over_upper(meshes)
    worst = max(worst, depth)
    print(
        f"[layers] {source.stem:16s} "
        f"upper={len(uppers)} lower={len(lowers)} hair={len(hairs)} "
        f"waist_breach={cells:4d}cells max={depth * 1000:6.1f}mm "
        f"hair_drape={drop * 100:5.1f}cm ({below * 100:3.0f}% below neckline)"
    )

print(f"[layers] WORST waist breach {worst * 1000:.1f}mm across {len(paths)} files")
