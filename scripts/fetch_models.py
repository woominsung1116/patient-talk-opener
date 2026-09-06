#!/usr/bin/env python3
"""Poly Haven CC0 모델 다운로더 — gltf + 종속 파일(bin/텍스처)을 상대경로 그대로 저장."""
import json
import subprocess
import sys
from pathlib import Path

ASSETS = [
    "metal_office_desk",
    "desk_lamp_arm_01",
    "wall_clock",
    "potted_plant_01",
    "metal_trash_can",
    "GreenChair_01",
    "SchoolChair_01",
    "drawer_cabinet",
]
RES = "1k"
OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "models"


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    subprocess.run(
        ["curl", "-sfL", "-A", "Mozilla/5.0", "--max-time", "180", "-o", str(dest), url],
        check=True,
    )


def main() -> None:
    for asset in ASSETS:
        try:
            out = subprocess.run(
                ["curl", "-sfL", "-A", "Mozilla/5.0", "--max-time", "60",
                 f"https://api.polyhaven.com/files/{asset}"],
                check=True, capture_output=True,
            )
            files = json.loads(out.stdout)
            entry = files["gltf"][RES]["gltf"]
            base = OUT / asset
            fetch(entry["url"], base / f"{asset}.gltf")
            for rel, info in entry.get("include", {}).items():
                fetch(info["url"], base / rel)
            size = sum(f.stat().st_size for f in base.rglob("*") if f.is_file())
            print(f"OK {asset} ({size//1024} KB)")
        except Exception as e:
            print(f"FAIL {asset}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
