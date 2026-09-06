"""MPFB 헤어 diffuse 를 한국인 환자용 중성 흑발로 다시 칠한다.

MakeHuman 기본 남성 헤어 `short02`(76,60,50)·`short03`(80,51,43) 은 따뜻한 갈색이라
한국인 환자 아바타에 그대로 쓰면 염색한 서양인처럼 보인다. 색상만 중성 흑발로
옮기고 **가닥 사이의 명암 변화와 알파는 원본 그대로 둔다** — 균일하게 칠하면
이방성 하이라이트가 걸릴 대비가 사라져 머리가 검은 판때기가 된다.

    python3 tools/avatar_pipeline/recolor_hair_black.py

결과는 `assets/hair/<asset>/<원본 파일명>` 에 쓰고, characters.json 의
`hair_texture` 가 이 경로를 가리킨다.
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image

PIPELINE_DIR = Path(__file__).resolve().parent
OUT_ROOT = PIPELINE_DIR / "assets" / "hair"

# 목표 평균 색. 실제 흑발은 완전한 검정이 아니라 아주 살짝 따뜻한 진회색이다.
TARGET = np.array([30.0, 28.5, 27.5])

TARGETS = ["short02", "short03"]


def hair_library() -> Path:
    root = Path(
        os.path.expanduser(
            "~/Library/Application Support/Blender/5.1/extensions/.user/"
            "user_default/mpfb/data/hair"
        )
    )
    if not root.is_dir():
        raise FileNotFoundError(f"MPFB hair library not found: {root}")
    return root


def recolor(source: Path, destination: Path) -> str:
    image = Image.open(source).convert("RGBA")
    data = np.asarray(image).astype(np.float32)
    rgb, alpha = data[:, :, :3], data[:, :, 3]

    visible = alpha > 40
    if not visible.any():
        raise ValueError(f"{source} has no visible texels")

    # 가닥의 상대적 명암을 유지하려고 평균으로만 나눈다. 채널별로 정규화하면
    # 갈색을 만들던 채널 편차까지 살아남아 색이 다시 따뜻해진다.
    luminance = rgb[visible].mean(axis=1)
    scale = luminance / max(luminance.mean(), 1e-6)

    out = np.zeros_like(rgb)
    tinted = np.clip(scale[:, None] * TARGET[None, :], 0, 255)
    out[visible] = tinted
    result = np.dstack([out, alpha]).astype(np.uint8)

    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result, "RGBA").save(destination)

    before = rgb[visible].mean(axis=0)
    after = out[visible].mean(axis=0)
    return (
        f"{source.parent.name}/{source.name}: "
        f"({before[0]:.0f},{before[1]:.0f},{before[2]:.0f}) -> "
        f"({after[0]:.0f},{after[1]:.0f},{after[2]:.0f})"
    )


def main() -> int:
    library = hair_library()
    for asset in TARGETS:
        source = library / asset / f"{asset}_diffuse.png"
        if not source.exists():
            raise FileNotFoundError(source)
        print(recolor(source, OUT_ROOT / asset / source.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
