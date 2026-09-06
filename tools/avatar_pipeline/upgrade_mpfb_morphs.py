"""Upgrade a baked MPFB avatar with real ARKit and viseme morph targets.

The existing production GLB is deliberately kept as the source of truth for
its photo-projected skin, hair, clothes, accessories, materials and rig.  A
fresh MPFB base body is rebuilt from the same identity parameters, facial
targets are added on the original MakeHuman topology, construction helpers
are removed while preserving those targets, and only the old subdivided body is
replaced.

Run with Blender, for example:

  blender --background --python upgrade_mpfb_morphs.py -- \
    --source-glb ../../frontend/public/avatars/mh_f20.glb \
    --output-glb /tmp/mh_f20_morph.glb --gender 0 --age .5 \
    --weight .5
"""

from __future__ import annotations

import argparse
import hashlib
import addon_utils
from pathlib import Path
import sys
import time

import bpy

# Blender는 --python 스크립트의 디렉터리를 sys.path에 넣어주지 않는다.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from body_shape_targets import load_body_targets  # noqa: E402
from garment_layers import (  # noqa: E402
    MAX_HAIR_DRAPE,
    MAX_WAIST_PULL,
    hair_drape_over_upper,
    is_hair_mesh,
    tuck_lower_garment_waist,
    waist_breach,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-glb", required=True)
    parser.add_argument("--output-glb", required=True)
    parser.add_argument("--gender", required=True, type=float)
    parser.add_argument("--age", required=True, type=float)
    parser.add_argument("--weight", default=0.5, type=float)
    parser.add_argument(
        "--target-root",
        default=str(Path(__file__).resolve().parent / "assets" / "targets"),
    )
    parser.add_argument("--morph-normals", action="store_true")
    parser.add_argument("--subdivide", action="store_true")
    parser.add_argument(
        "--hair",
        default=None,
        help=(
            "MPFB hair asset folder to fit in place of the imported hair "
            "(e.g. short04). Only pass this for avatars whose baked hair is a "
            "solid shell rather than alpha cards."
        ),
    )
    parser.add_argument(
        "--hair-texture",
        default=None,
        help=(
            "Diffuse texture to use instead of the one the hair's mhmat declares, "
            "as '<asset folder>/<file>' (e.g. toigo_inverted_bob_with_bangs/BlackHair.png). "
            "toigo 계열 6종은 baked normal/spec 이 바이트 단위로 동일한 하나의 UV "
            "레이아웃을 공유하므로 색 텍스처를 서로 바꿔 써도 안전하다 — 한국인 "
            "환자에게 금발/적갈색 기본 텍스처가 나가는 것을 이 옵션으로 막는다."
        ),
    )
    parser.add_argument(
        "--eyebrows",
        default=None,
        help=(
            "MPFB eyebrows asset folder to fit in place of the imported eyebrows "
            "(e.g. eyebrow003). 눈썹은 인상을 가장 크게 가르는데 전 아바타가 "
            "eyebrow008 하나를 공유하고 있었다 — 아바타마다 다르게 준다.\n"
            "⚠ **`eyebrow001`~`eyebrow012` 만 쓸 것.** `mindfront_eyebrows_*` 14종은 "
            "텍스처가 아예 없는 순수 스트랜드 지오메트리다(정점 26,400 = 알파 카드의 "
            "200배, mhmat 이 `diffuseColor 0 0 0` 에 `diffuseTexture` 없음). 이걸 "
            "붙이면 눈썹 자리가 **빈 피부로 렌더된다** — 2026-08-02 에 "
            "mindfront_eyebrows_07 로 겪은 실패가 정확히 이것이었다. eyebrow001~012 는 "
            "512x512 RGBA 알파 카드라 헤어와 같은 경로로 안전하게 처리된다."
        ),
    )
    parser.add_argument(
        "--eyebrow-tint",
        default=None,
        help=(
            "눈썹 텍스처에 곱할 개인차 색 (black/soft/brown). 자산 원본은 서양인 "
            "기준이라 흑발 옆에서 뜬다. 노화에 따른 회색화는 여기가 아니라 "
            "런타임이 머리카락과 같이 처리하므로 흰색 계열은 일부러 없다 "
            "(EYEBROW_TINTS 주석 참고)."
        ),
    )
    parser.add_argument(
        "--draco-hq",
        action="store_true",
        help="Raise Draco quantization above Blender's defaults (position 14 / normal 10)",
    )
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


ARGS = parse_args()
SOURCE = Path(ARGS.source_glb).resolve()
OUTPUT = Path(ARGS.output_glb).resolve()
TARGET_ROOT = Path(ARGS.target_root).resolve()


def require(path: Path, description: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing {description}: {path}")


require(SOURCE, "source GLB")
require(TARGET_ROOT / "faceunits", "ARKit target directory")
require(TARGET_ROOT / "visemes", "viseme target directory")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

started_at = time.monotonic()
print(f"[morph-upgrade] source={SOURCE}")
print(f"[morph-upgrade] output={OUTPUT}")

# Blender extensions are namespaced.  MPFB itself uses absolute ``mpfb.*``
# imports in a few places, so preserve the alias used by the original pipeline.
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True, persistent=True)
extension = sys.modules.get("bl_ext.user_default.mpfb")
if extension is None:
    raise RuntimeError("MPFB Blender extension could not be enabled")
sys.modules["mpfb"] = extension

from mpfb.services.assetservice import AssetService  # noqa: E402
from mpfb.services.exportservice import ExportService  # noqa: E402
from mpfb.services.humanservice import HumanService  # noqa: E402
from mpfb.services.targetservice import TargetService  # noqa: E402


# MPFB 의 `race=asian` 매크로는 **범아시아 평균**이라 그대로 쓰면 코가 넓고 얼굴이
# 둥글어 동남아 인상으로 읽힌다(사용자 지적 2026-07-29). 동북아(한국인) 쪽으로
# 당기는 형질만 골라 얹는다 — 셋 다 인류학적으로 구분력이 큰 항목이다:
# 1) 광대(관골) 돌출이 크다        → cheek-bones-incr 를 0.40 → 0.62
# 2) 콧방울이 좁고 코 돌출이 낮다   → flaring/nostrils-width/width2/scale-depth 를 새로 깎는다
# (넓은 콧방울이 동남아 인상의 핵심 신호다)
# 3) 전돌(prognathism)이 적고 하악각이 넓다 → chin-prognathism-decr + chin-width-incr
# 두상도 둥근 쪽(head-round)에서 각진 쪽(head-square)으로 옮긴다.
# ⚠ 값을 더 올리면 캐리커처가 된다. 바꿨으면 반드시 정면 렌더로 확인해라.
ASIAN_FACE = [
    # 눈 — 몽고주름과 낮은 쌍꺼풀
    ("eyes/l-eye-epicanthus-out", 0.85),
    ("eyes/r-eye-epicanthus-out", 0.85),
    ("eyes/l-eye-eyefold-angle-up", 0.6),
    ("eyes/r-eye-eyefold-angle-up", 0.6),
    ("eyes/l-eye-corner2-up", 0.45),
    ("eyes/r-eye-corner2-up", 0.45),
    ("eyes/l-eye-height2-decr", 0.3),
    ("eyes/r-eye-height2-decr", 0.3),
    # 광대
    ("cheek/l-cheek-bones-incr", 0.62),
    ("cheek/r-cheek-bones-incr", 0.62),
    # 코
    ("nose/nose-hump-decr", 0.65),
    ("nose/nose-greek-decr", 0.5),
    ("nose/nose-flaring-decr", 0.55),
    ("nose/nose-nostrils-width-decr", 0.45),
    ("nose/nose-width2-decr", 0.35),
    ("nose/nose-scale-depth-decr", 0.40),
    ("nose/nose-point-up", 0.2),
    # 턱
    ("chin/chin-prognathism-decr", 0.5),
    ("chin/chin-prominent-decr", 0.3),
    ("chin/chin-width-incr", 0.25),
    # 두상
    ("head/head-round", 0.12),
    ("head/head-square", 0.3),
    ("head/head-scale-horiz-incr", 0.2),
]


# 개인차를 주는 형질과 그 흔들림 폭. 값은 (타깃, 진폭) — 아바타별 시드로 ±진폭만큼 흔든다.
#
# ⚠ **이게 없으면 17명이 전부 같은 얼굴로 나온다.** ASIAN_FACE 하나를 전원에게 똑같이
#   적용하고 있었기 때문에, 20대 여성과 70대 여성의 **골격이 완전히 동일**했다.
#   나이는 피부 텍스처와 주름으로만 표현되고 얼굴 형태는 안 변해서, 케이스를 바꿔도
#   "같은 캐릭터를 계속 보는" 인상이 됐다(사용자 지적 2026-08-02).
#
# 고른 기준: **사람을 알아보게 하는** 형질이다. 얼굴 길이·폭, 광대 높이, 코 길이,
#   턱 폭, 눈 간격이 개인 식별의 대부분을 차지한다. 피부 톤이나 주름이 아니다.
# ⚠ **크기·위치 형질만 흔들면 이목구비는 그대로다.** 처음엔 scale/trans 위주로 넣었는데,
#   얼굴 비율만 바뀌고 "코·입 생김새가 다 같다"는 인상은 그대로였다(사용자 지적).
#   사람을 구별하는 건 코가 **얼마나 큰가**가 아니라 **어떻게 생겼는가** 다 —
#   콧대가 오목한가 볼록한가, 콧방울이 벌어졌나, 인중이 깊은가, 입술 두께 비율,
#   쌍꺼풀이 있나, 눈꼬리가 올라갔나. 그래서 **형태 타깃 위주**로 다시 짰다.
FACE_VARIATION: list[tuple[str, float]] = [
    # ── 코 생김새 ──
    ("nose/nose-curve-convex", 0.40),          # 콧대 볼록 ↔ 오목
    ("nose/nose-nostrils-angle-up", 0.35),     # 콧구멍 각도(들창코 ↔ 처진 코)
    ("nose/nose-point-up", 0.32),              # 코끝 방향
    ("nose/nose-point-width-incr", 0.30),      # 코끝 뭉툭 ↔ 뾰족
    ("nose/nose-septumangle-incr", 0.28),      # 비주각
    ("nose/nose-flaring-incr", 0.26),          # 콧방울 벌어짐
    ("nose/nose-base-up", 0.24),
    ("nose/nose-compression-compress", 0.22),
    ("nose/nose-scale-vert-incr", 0.22),       # 길이(비율)
    # ── 입 생김새 ──
    ("mouth/mouth-upperlip-volume-incr", 0.38),   # 윗입술 두께
    ("mouth/mouth-lowerlip-volume-incr", 0.34),   # 아랫입술 두께 (윗입술과 별개 시드)
    ("mouth/mouth-cupidsbow-incr", 0.36),         # 큐피드 활
    ("mouth/mouth-cupidsbow-width-incr", 0.30),
    ("mouth/mouth-philtrum-volume-incr", 0.30),   # 인중 깊이
    ("mouth/mouth-angles-up", 0.26),              # 입꼬리
    ("mouth/mouth-upperlip-width-incr", 0.24),
    ("mouth/mouth-lowerlip-middle-up", 0.22),
    # ── 눈 생김새 ── (쌍꺼풀·눈꼬리·눈매는 인상을 가장 크게 가른다)
    ("eyes/l-eye-eyefold-concave", 0.38),      # 쌍꺼풀 라인 모양
    ("eyes/l-eye-eyefold-up", 0.34),           # 쌍꺼풀 높이
    ("eyes/l-eye-corner1-up", 0.32),           # 앞머리 눈꼬리
    ("eyes/l-eye-corner2-up", 0.30),           # 뒷머리 눈꼬리(올라간 눈 ↔ 처진 눈)
    ("eyes/l-eye-height2-incr", 0.28),         # 눈 크기(세로)
    ("eyes/l-eye-push1-in", 0.24),             # 눈이 깊은가 튀어나왔나
    ("eyes/l-eye-epicanthus-in", 0.22),        # 몽고주름 정도
    ("eyes/l-eye-bag-incr", 0.20),
    # ── 골격 비율 (인상의 바탕) ──
    ("head/head-oval", 0.32),
    ("head/head-square", 0.26),
    ("head/head-scale-vert-incr", 0.24),
    ("cheek/l-cheek-bones-incr", 0.28),
    ("cheek/l-cheek-trans-up", 0.26),
    ("chin/chin-width-incr", 0.26),
    ("chin/chin-height-incr", 0.24),
    ("chin/chin-prominent-incr", 0.22),
    ("forehead/forehead-scale-vert-incr", 0.22),
    ("forehead/forehead-nubian-incr", 0.20),   # 이마 경사
]

# 좌우 쌍이 있는 형질 — 한쪽만 흔들면 얼굴이 비뚤어진다. 같은 값을 반대쪽에도 준다.
_PAIRED_PREFIX = ("cheek/l-", "eyes/l-")

# 방향이 갈린 타깃 쌍. 앞이 양수 쪽, 뒤가 음수 쪽이다.
_OPPOSITE: tuple[tuple[str, str], ...] = (
    ("-incr", "-decr"),
    ("-up", "-down"),
    ("-out", "-in"),
    ("-convex", "-concave"),
    ("-compress", "-uncompress"),
    ("-forward", "-backward"),
)


def _seeded_unit(name: str, salt: str) -> float:
    """아바타 이름에서 −1~+1 난수. 같은 이름은 항상 같은 얼굴이어야 하므로 해시로 만든다."""
    digest = hashlib.sha256(f"{name}:{salt}".encode()).digest()
    raw = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    return raw * 2 - 1


def variation_targets(name: str, age: float) -> list[tuple[str, float]]:
    """아바타별 개인차. 이름이 같으면 항상 같은 결과(재현성)."""
    out: list[tuple[str, float]] = []
    # 아동은 골격 자체가 미성숙해 성인 편차를 그대로 주면 애어른이 된다 — 폭을 줄인다.
    scale = 0.45 if age <= 0.25 else 1.0
    for target, amplitude in FACE_VARIATION:
        value = _seeded_unit(name, target) * amplitude * scale
        if abs(value) < 0.02:
            continue
        # MPFB 타깃은 **방향별로 파일이 갈려 있다**(-incr/-decr, -up/-down, convex/concave …).
        # 음수면 반대쪽 타깃으로 바꿔야 한다. ⚠ 여기 없는 접미사는 음수가 통째로 버려져
        # 형질이 **한쪽 방향으로만** 흔들린다(예: 콧대가 볼록해지기만 하고 오목해지지 않음).
        if value < 0:
            opposite = None
            for a, b in _OPPOSITE:
                if target.endswith(a):
                    opposite = target[: -len(a)] + b
                    break
                if target.endswith(b):
                    opposite = target[: -len(b)] + a
                    break
            if opposite is None:
                continue  # oval/square 처럼 반대가 없는 형질은 양수만 쓴다
            target, value = opposite, -value
        out.append((target, round(value, 3)))
        for prefix in _PAIRED_PREFIX:
            if target.startswith(prefix):
                out.append((target.replace(prefix, prefix.replace("/l-", "/r-"), 1), round(value, 3)))
    return out


# 연령대별 골격 변화. 노년은 중안면이 짧아지고 연부조직이 처지며 턱선이 무너진다 —
# 주름 텍스처만으로는 20대와 70대가 같은 골격으로 남는다.
AGE_SHAPE: list[tuple[float, list[tuple[str, float]]]] = [
    (0.70, [  # 60대 이상
        ("cheek/l-cheek-volume-decr", 0.35),
        ("cheek/r-cheek-volume-decr", 0.35),
        ("cheek/l-cheek-trans-down", 0.25),
        ("cheek/r-cheek-trans-down", 0.25),
        ("chin/chin-jaw-drop-incr", 0.20),
        ("nose/nose-scale-vert-incr", 0.22),   # 코는 평생 조금씩 길어진다
        ("mouth/mouth-upperlip-height-decr", 0.30),
        ("forehead/forehead-temple-decr", 0.25),
    ]),
    (0.45, [  # 40~50대
        ("cheek/l-cheek-volume-decr", 0.15),
        ("cheek/r-cheek-volume-decr", 0.15),
        ("nose/nose-scale-vert-incr", 0.10),
        ("mouth/mouth-upperlip-height-decr", 0.12),
    ]),
]


def age_shape_targets(age: float) -> list[tuple[str, float]]:
    for threshold, targets in AGE_SHAPE:
        if age >= threshold:
            return list(targets)
    return []


def identity_face_targets(age: float) -> list[tuple[str, float]]:
    targets = list(ASIAN_FACE)
    if age <= 0.25:
        # 아동은 성인의 각진 형질을 빼야 한다 — 광대·사각턱·넓은 하악은 아이 얼굴이 아니다.
        # (아래 확장 목록이 둥근 두상·작은 턱으로 다시 채운다.)
        adult_only = ("cheek-bones", "head-square", "head-scale-horiz-incr", "chin-width-incr")
        targets = [item for item in targets if not any(k in item[0] for k in adult_only)]
        targets.extend(
            [
                ("eyes/l-eye-scale-incr", 0.85),
                ("eyes/r-eye-scale-incr", 0.85),
                ("head/head-round", 0.8),
                ("nose/nose-scale-vert-decr", 0.6),
                ("nose/nose-scale-horiz-decr", 0.4),
                ("nose/nose-scale-depth-decr", 0.55),
                ("chin/chin-height-decr", 0.7),
                ("chin/chin-bones-decr", 0.55),
                ("cheek/l-cheek-inner-incr", 0.75),
                ("cheek/r-cheek-inner-incr", 0.75),
                ("mouth/mouth-scale-horiz-decr", 0.45),
                ("forehead/forehead-scale-vert-incr", 0.5),
            ]
        )
    return targets


def world_bounds(obj: bpy.types.Object) -> tuple[float, float, float, float, float, float]:
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    return (
        min(point.x for point in points),
        max(point.x for point in points),
        min(point.y for point in points),
        max(point.y for point in points),
        min(point.z for point in points),
        max(point.z for point in points),
    )


def vertex_group_bounds(
    obj: bpy.types.Object,
    group_name: str,
    minimum_weight: float = 0.35,
) -> tuple[float, float, float, float, float, float]:
    group = obj.vertex_groups.get(group_name)
    if group is None:
        raise RuntimeError(f"{obj.name} has no {group_name!r} vertex group")
    points = []
    for vertex in obj.data.vertices:
        weight = next(
            (membership.weight for membership in vertex.groups if membership.group == group.index),
            0.0,
        )
        if weight >= minimum_weight:
            points.append(obj.matrix_world @ vertex.co)
    if not points:
        raise RuntimeError(f"{obj.name} has no weighted vertices in {group_name!r}")
    return (
        min(point.x for point in points),
        max(point.x for point in points),
        min(point.y for point in points),
        max(point.y for point in points),
        min(point.z for point in points),
        max(point.z for point in points),
    )


# 헤어·의상 판정과 레이어 보정은 `garment_layers`가 단일 출처다(`is_hair_mesh`,
# `tuck_lower_garment_waist`, `waist_breach`, `hair_drape_over_upper`). 여기에
# 복사본을 두면 배포본 계측(`measure_layers.py`)과 빌드 게이트가 서로 다른 규칙을
# 쓰게 된다.


def hair_mhclo(asset_name: str) -> Path:
    """MPFB 헤어 라이브러리에서 mhclo 경로를 찾는다."""
    for root in AssetService.get_asset_roots("hair"):
        folder = Path(root) / asset_name
        if not folder.is_dir():
            continue
        mhclo = next(folder.glob("*.mhclo"), None)
        if mhclo:
            return mhclo
    raise FileNotFoundError(f"MPFB hair asset not found: {asset_name}")


def mhmat_textures(mhclo: Path) -> dict[str, Path]:
    """mhmat이 선언한 텍스처 슬롯을 전부 읽는다(diffuse / normal / bump)."""
    found: dict[str, Path] = {}
    mhmat = next(mhclo.parent.glob("*.mhmat"), None)
    if not mhmat:
        return found
    slots = {
        "diffusetexture": "diffuse",
        "normalmaptexture": "normal",
        "bumpmaptexture": "bump",
    }
    for line in mhmat.read_text(errors="ignore").splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        slot = slots.get(parts[0].lower())
        if not slot or slot in found:
            continue
        candidate = mhclo.parent / parts[1].strip()
        if candidate.exists():
            found[slot] = candidate

    # 선언되지 않았지만 폴더에 들어 있는 노멀맵을 줍는다. short02 가 정확히 이 경우로,
    # `short02_normal.png` 를 배포하면서 mhmat 은 diffuse 만 선언한다 — 선언만 믿으면
    # 있는 맵을 버리게 된다.
    if "normal" not in found and "bump" not in found:
        diffuse = found.get("diffuse")
        if diffuse is not None:
            stem = diffuse.stem.removesuffix("_diffuse")
            for name in (f"{stem}_normal", f"{stem}_norm", f"{stem}NORMAL"):
                for suffix in (".png", ".jpg"):
                    candidate = diffuse.with_name(f"{name}{suffix}")
                    if candidate.exists():
                        found["normal"] = candidate
                        break
                if "normal" in found:
                    break
    return found


def hair_texture_override(spec: str | None) -> Path | None:
    """`--hair-texture <asset>/<file>` 를 실제 경로로 푼다.

    저장소가 직접 만든 텍스처(`assets/hair/`, 흑발 리컬러)를 MPFB 라이브러리보다
    먼저 찾는다 — 같은 이름이면 우리 것이 이긴다.
    """
    if not spec:
        return None
    asset, _, filename = spec.partition("/")
    if not filename:
        raise ValueError(f"--hair-texture must be '<asset folder>/<file>': {spec}")
    repo = Path(__file__).resolve().parent / "assets" / "hair" / asset / filename
    if repo.exists():
        return repo
    for root in AssetService.get_asset_roots("hair"):
        candidate = Path(root) / asset / filename
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Hair texture not found: {spec}")


def eyebrows_mhclo(asset_name: str) -> Path:
    """MPFB 눈썹 라이브러리에서 mhclo 경로를 찾는다."""
    for root in AssetService.get_asset_roots("eyebrows"):
        folder = Path(root) / asset_name
        if not folder.is_dir():
            continue
        found = next(folder.glob("*.mhclo"), None)
        if found:
            return found
    raise FileNotFoundError(f"MPFB eyebrows asset not found: {asset_name}")


# 눈썹 색은 사람마다 다르지만 한국인 범위는 좁다 — 순흑부터 살짝 도는 갈색까지.
# 헤어 텍스처가 통일된 흑발이므로 눈썹만 밝게 뜨면 붙여 넣은 티가 난다.
#
# ⚠ **흰머리(노화) 색은 여기 없다.** 나이에 따른 회색화는 런타임이
# `tuneMpfbFaceOverlay()` 에서 머리카락과 **같은 곡선으로** 처리한다. 여기서
# 회색을 구워 넣으면 이중으로 세서 70대가 백발 눈썹이 된다. 이 값들은
# '이 사람은 원래 눈썹이 옅다' 같은 개인차 전용이다.
EYEBROW_TINTS: dict[str, tuple[float, float, float]] = {
    "black": (0.34, 0.30, 0.28),
    "soft": (0.42, 0.36, 0.32),
    "brown": (0.46, 0.37, 0.30),
}


def eyebrow_material(asset_name: str, mhclo: Path, tint: str | None) -> bpy.types.Material:
    """mhmat 텍스처로 눈썹 알파 카드용 재질을 직접 만든다.

    `hair_material()` 과 같은 이유로 MakeSkin 노드 그래프에 맡기지 않는다 —
    알파가 Principled 에 연결되지 않으면 눈썹이 통짜 판때기로 나가거나 아예
    안 보인다.

    ⚠ 텍스처가 없는 자산(`mindfront_eyebrows_*`)은 여기서 세운다. 그쪽은
    알파 카드가 아니라 스트랜드 지오메트리라서 이 경로로는 절대 안 보인다.
    """
    textures = mhmat_textures(mhclo)
    diffuse = textures.get("diffuse")
    if diffuse is None:
        raise FileNotFoundError(
            f"Eyebrow asset {asset_name} has no diffuse texture — "
            "strand-geometry assets (mindfront_eyebrows_*) render invisible; "
            "use eyebrow001~eyebrow012"
        )

    # 이름에 'eyebrow'를 남겨야 런타임(materialKind)이 이 재질을 'brow'로 분류해
    # 눈썹 전용 셰이딩과 표정 연동을 건다.
    material = bpy.data.materials.new(f"Human.{asset_name}")
    material.use_nodes = True
    tree = material.node_tree
    principled = tree.nodes.get("Principled BSDF")
    image_node = tree.nodes.new("ShaderNodeTexImage")
    image_node.image = bpy.data.images.load(str(diffuse))
    image_node.image.alpha_mode = "STRAIGHT"

    color_output = image_node.outputs["Color"]
    if tint:
        if tint not in EYEBROW_TINTS:
            raise ValueError(
                f"Unknown eyebrow tint {tint!r}; pick one of {sorted(EYEBROW_TINTS)}"
            )
        # 텍스처의 가닥 결을 살리려면 색을 덮어쓰지 말고 곱해야 한다.
        mix = tree.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 1.0
        tree.links.new(color_output, mix.inputs["Color1"])
        mix.inputs["Color2"].default_value = (*EYEBROW_TINTS[tint], 1.0)
        color_output = mix.outputs["Color"]

    tree.links.new(color_output, principled.inputs["Base Color"])
    tree.links.new(image_node.outputs["Alpha"], principled.inputs["Alpha"])
    principled.inputs["Roughness"].default_value = 1.0
    principled.inputs["Metallic"].default_value = 0.0

    material.blend_method = "BLEND"
    return material


def hair_material(asset_name: str, mhclo: Path) -> bpy.types.Material:
    """mhmat 텍스처로 알파 카드용 재질을 직접 만든다.

    MakeSkin 노드 그래프에 맡기면 알파가 Principled에 연결되지 않은 채
    OPAQUE로 나가는 경우가 있다(기존 hair_05가 정확히 그 상태였다).

    ⚠ **노멀맵을 반드시 함께 연결한다.** 예전에는 diffuse만 연결해서, 노멀맵을
    가진 자산(toigo 계열, short02)을 characters.json 으로 지정하면 오히려
    기본 생성본보다 **화질이 내려갔다** — 배포본 계측에서 `_hair` 접미사가
    붙은 재질만 normalTexture 가 없던 것이 그 흔적이다.
    """
    textures = mhmat_textures(mhclo)
    diffuse = hair_texture_override(ARGS.hair_texture) or textures.get("diffuse")
    if diffuse is None:
        raise FileNotFoundError(f"Hair asset has no diffuse texture: {asset_name}")

    # 이름에 'hair'를 남겨야 런타임이 이 재질을 헤어로 분류한다.
    material = bpy.data.materials.new(f"Human.{asset_name}_hair")
    material.use_nodes = True
    tree = material.node_tree
    principled = tree.nodes.get("Principled BSDF")
    image_node = tree.nodes.new("ShaderNodeTexImage")
    image_node.image = bpy.data.images.load(str(diffuse))
    image_node.image.alpha_mode = "STRAIGHT"
    tree.links.new(image_node.outputs["Color"], principled.inputs["Base Color"])
    tree.links.new(image_node.outputs["Alpha"], principled.inputs["Alpha"])
    principled.inputs["Roughness"].default_value = 0.85
    principled.inputs["Metallic"].default_value = 0.0

    normal_source = textures.get("normal") or textures.get("bump")
    if normal_source is not None:
        normal_image = tree.nodes.new("ShaderNodeTexImage")
        normal_image.image = bpy.data.images.load(str(normal_source))
        # 노멀맵을 sRGB로 읽으면 가닥 방향이 틀어진다.
        normal_image.image.colorspace_settings.name = "Non-Color"
        normal_map = tree.nodes.new("ShaderNodeNormalMap")
        tree.links.new(normal_image.outputs["Color"], normal_map.inputs["Color"])
        tree.links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])

    # glTF 익스포터는 blend_method로 alphaMode를 정한다.  BLEND가 아니면
    # 알파 카드가 잘리지 않아 판때기가 그대로 보인다.
    material.blend_method = "BLEND"
    return material


def body_candidate(objects: list[bpy.types.Object]) -> bpy.types.Object:
    meshes = [obj for obj in objects if obj.type == "MESH"]
    skin_material = [
        obj
        for obj in meshes
        if any(
            material and "asianskin" in material.name.lower()
            for material in obj.data.materials
        )
    ]
    if skin_material:
        return max(skin_material, key=lambda obj: len(obj.data.vertices))
    with_head_group = [obj for obj in meshes if obj.vertex_groups.get("head") is not None]
    candidates = with_head_group or meshes
    if not candidates:
        raise RuntimeError("Imported GLB contains no mesh")
    return max(candidates, key=lambda obj: len(obj.data.vertices))


def linked_armature(obj: bpy.types.Object, objects: list[bpy.types.Object]) -> bpy.types.Object:
    if obj.parent and obj.parent.type == "ARMATURE":
        return obj.parent
    for modifier in obj.modifiers:
        if modifier.type == "ARMATURE" and modifier.object:
            return modifier.object
    armatures = [candidate for candidate in objects if candidate.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Could not identify source armature ({len(armatures)} candidates)")
    return armatures[0]


def delete_object(obj: bpy.types.Object) -> None:
    if obj and obj.name in bpy.data.objects:
        bpy.data.objects.remove(obj, do_unlink=True)


# Start from a deterministic empty scene without resetting enabled extensions.
# ``read_factory_settings`` unregisters MPFB in background mode and makes its
# lazy UI imports fail when garments are added.
for scene_object in list(bpy.data.objects):
    bpy.data.objects.remove(scene_object, do_unlink=True)

macro = TargetService.get_default_macro_info_dict()
macro["gender"] = ARGS.gender
macro["age"] = ARGS.age
macro["weight"] = ARGS.weight
macro["race"] = {"asian": 1.0, "caucasian": 0.0, "african": 0.0}
body = HumanService.create_human(macro_detail_dict=macro)

# 공통 아시아 형질 + **아바타별 개인차** + 연령대 골격.
# 개인차가 없으면 17명이 전부 같은 얼굴로 나온다(아래 FACE_VARIATION 주석 참고).
requested_identity = (
    identity_face_targets(ARGS.age)
    + variation_targets(SOURCE.stem, ARGS.age)
    + age_shape_targets(ARGS.age)
)
missing_identity: list[str] = []
for target_name, value in requested_identity:
    try:
        TargetService.set_target_value(body, target_name, value)
    except ValueError:
        missing_identity.append(target_name)
# 얼굴 정체성도 체형과 같은 이유로 조용히 건너뛰면 안 된다.
if missing_identity:
    raise RuntimeError(
        "MPFB has no such identity targets: " + ", ".join(missing_identity)
    )
print(
    f"[morph-upgrade] identity targets requested={len(requested_identity)} "
    f"applied={len(requested_identity)} missing=0"
)

load_body_targets(TargetService, body, ARGS.weight, "morph-upgrade")

try:
    TargetService.reapply_macro_details(body)
except Exception as error:  # MPFB already applied the macro on creation.
    print(f"[morph-upgrade] macro reapply skipped: {error!r}")

generated_rig = HumanService.add_builtin_rig(body, "game_engine")
if generated_rig is None:
    raise RuntimeError("MPFB game_engine rig was not created")

# Commit all modelling keys first.  ARKit/viseme deltas are thereby relative to
# the final identity rather than to the generic MakeHuman basis.
TargetService.bake_targets(body)

# 헤어 교체는 반드시 이 시점이어야 한다.  MHCLO 피팅은 헬퍼가 살아 있는
# 미분할 MakeHuman 토폴로지를 기준으로 하므로, 서브디비전/헬퍼 제거 뒤에는
# 붙일 수 없다.  얼굴 타깃은 weight 0으로만 얹히므로 순서 영향이 없다.
new_hair = None
if ARGS.hair:
    mhclo = hair_mhclo(ARGS.hair)
    modifiers_before_hair = {modifier.name for modifier in body.modifiers}
    new_hair = HumanService.add_mhclo_asset(
        str(mhclo),
        body,
        asset_type="Hair",
        subdiv_levels=0,
        material_type="MAKESKIN",
        set_up_rigging=True,
        interpolate_weights=True,
        import_subrig=True,
        import_weights=True,
    )
    # MHCLO에 `delete_verts`가 있으면 MPFB가 몸에 두피 삭제 마스크를 건다.
    # 신체진찰은 옷 아래 몸 전체를 쓰고 나머지 아바타는 55,784정점 토폴로지를
    # 공유하므로, 한 캐릭터만 두피가 뚫리면 조용한 회귀가 된다. 그래서 마스크가
    # 생기면 넘어가지 않고 세운다 — 헤어 선택을 바꾸라는 신호다.
    # (short01/short04/culturalibre_hair_02에는 delete_verts가 없다.)
    added_masks = [
        modifier.name
        for modifier in body.modifiers
        if modifier.type == "MASK" and modifier.name not in modifiers_before_hair
    ]
    if added_masks:
        raise RuntimeError(
            f"Hair asset {ARGS.hair} deletes body geometry via {added_masks}; "
            "pick a hair without delete_verts"
        )

    new_hair.name = f"hair_{ARGS.hair}"
    new_hair.data.name = f"hair_{ARGS.hair}"
    new_hair.data.materials.clear()
    new_hair.data.materials.append(hair_material(ARGS.hair, mhclo))
    for polygon in new_hair.data.polygons:
        polygon.use_smooth = True
    print(
        f"[morph-upgrade] hair fitted {ARGS.hair} verts={len(new_hair.data.vertices)} "
        f"uv={bool(new_hair.data.uv_layers)}"
    )

new_brows = None
if ARGS.eyebrows:
    brow_mhclo = eyebrows_mhclo(ARGS.eyebrows)
    new_brows = HumanService.add_mhclo_asset(
        str(brow_mhclo),
        body,
        asset_type="Eyebrows",
        subdiv_levels=0,
        material_type="MAKESKIN",
        set_up_rigging=True,
        interpolate_weights=True,
        import_subrig=True,
        import_weights=True,
    )
    new_brows.name = f"eyebrows_{ARGS.eyebrows}"
    new_brows.data.name = f"eyebrows_{ARGS.eyebrows}"
    if not new_brows.data.uv_layers:
        raise RuntimeError(
            f"Eyebrow asset {ARGS.eyebrows} has no UVs; an alpha card without UVs "
            "cannot sample its texture and renders invisible"
        )
    new_brows.data.materials.clear()
    new_brows.data.materials.append(
        eyebrow_material(ARGS.eyebrows, brow_mhclo, ARGS.eyebrow_tint)
    )
    for polygon in new_brows.data.polygons:
        polygon.use_smooth = True
    print(
        f"[morph-upgrade] eyebrows fitted {ARGS.eyebrows} "
        f"verts={len(new_brows.data.vertices)} uv={bool(new_brows.data.uv_layers)} "
        f"tint={ARGS.eyebrow_tint or 'asset'}"
    )

target_paths = sorted((TARGET_ROOT / "faceunits").glob("*.target"))
target_paths.extend(sorted((TARGET_ROOT / "visemes").glob("*.target")))
for target_path in target_paths:
    TargetService.load_target(body, str(target_path), weight=0.0, name=target_path.stem)

keys_before_masks = [key.name for key in body.data.shape_keys.key_blocks]
print(f"[morph-upgrade] loaded {len(keys_before_masks) - 1} facial targets")

# Delete only MakeHuman's construction helpers. Production avatars retain the
# body under removable garments for physical-exam interactions, so garment
# delete masks must not be baked into this replacement mesh.
if ARGS.subdivide:
    subdivision = body.modifiers.new("MorphSubdivision", "SUBSURF")
    subdivision.subdivision_type = "CATMULL_CLARK"
    subdivision.levels = 1
    subdivision.render_levels = 1
    # MPFB's morph-preserving modifier routine swaps the mesh datablock. Run
    # helper deletion as a second pass so Blender has an active object again.
    ExportService.bake_modifiers_remove_helpers(
        body,
        bake_masks=False,
        bake_subdiv=True,
        remove_helpers=False,
        also_proxy=False,
    )
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
ExportService.bake_modifiers_remove_helpers(
    body,
    bake_masks=False,
    bake_subdiv=False,
    remove_helpers=True,
    also_proxy=False,
)

keys_after_masks = [key.name for key in body.data.shape_keys.key_blocks]
if keys_after_masks != keys_before_masks:
    missing = sorted(set(keys_before_masks) - set(keys_after_masks))
    raise RuntimeError(f"Morph keys were lost while baking masks: {missing}")

# Bring in the already approved production character.  Everything except its
# body stays untouched, including the scan/photo-derived materials and rig.
objects_before_import = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
imported = [obj for obj in bpy.data.objects if obj not in objects_before_import]

# glTF 임포터가 본 표시용으로 만드는 Icosphere는 `glTF_not_exported`
# 컬렉션에 들어가며 다시 내보내지지도 않는다. 진짜 잔재와 구분한다.
imported = [
    obj
    for obj in imported
    if not any(
        collection.name == "glTF_not_exported" for collection in obj.users_collection
    )
]

# 캐릭터에 속하지 않는 잔재 메시를 버린다.  mh_m40.glb에는 원점에 2m짜리
# 기본 Blender Cube가 스킨 없이 들어 있었고(런타임에 필터가 없어 그대로
# 렌더된다), 재생성해도 소스에서 그대로 다시 실려 나오는 상태였다.
# 판정 기준은 아마추어 모디파이어의 유무다 — 캐릭터 파츠는 전부 스킨된다.
# 부모 관계로는 판정할 수 없다: glTF 임포터가 스킨 없는 루트 노드까지
# 아마추어의 자식으로 붙여 놓기 때문에 Cube도 부모가 리그로 잡힌다.
junk = [
    obj
    for obj in imported
    if obj.type == "MESH"
    and not any(modifier.type == "ARMATURE" for modifier in obj.modifiers)
]
imported = [obj for obj in imported if obj not in junk]
for obj in junk:
    print(f"[morph-upgrade] dropping unrigged stray mesh: {obj.name} ({len(obj.data.vertices)}v)")
    delete_object(obj)

old_body = body_candidate(imported)
production_rig = linked_armature(old_body, imported)
# 삭제 뒤에는 참조가 무효가 되므로, 교체 대상 헤어는 지금 골라 둔다.
stale_hair = [obj for obj in imported if obj.type == "MESH" and is_hair_mesh(obj)]
stale_brows = [
    obj for obj in imported
    if obj.type == "MESH" and "eyebrow" in f"{obj.name} {obj.data.name}".lower()
]

old_bounds = world_bounds(old_body)
new_bounds = world_bounds(body)
old_head_bounds = vertex_group_bounds(old_body, "head")
new_head_bounds = vertex_group_bounds(body, "head")
top_delta = abs(old_head_bounds[5] - new_head_bounds[5])
center_delta = abs(
    (old_head_bounds[0] + old_head_bounds[1])
    - (new_head_bounds[0] + new_head_bounds[1])
) * 0.5
width_delta = abs(
    (old_head_bounds[1] - old_head_bounds[0])
    - (new_head_bounds[1] - new_head_bounds[0])
)
depth_delta = abs(
    (old_head_bounds[3] - old_head_bounds[2])
    - (new_head_bounds[3] - new_head_bounds[2])
)
print(
    "[morph-upgrade] topology",
    f"old={len(old_body.data.vertices)}",
    f"new={len(body.data.vertices)}",
    f"old_bounds={tuple(round(value, 4) for value in old_bounds)}",
    f"new_bounds={tuple(round(value, 4) for value in new_bounds)}",
    f"old_head={tuple(round(value, 4) for value in old_head_bounds)}",
    f"new_head={tuple(round(value, 4) for value in new_head_bounds)}",
    f"top_delta={top_delta:.6f}",
    f"center_delta={center_delta:.6f}",
    f"width_delta={width_delta:.6f}",
    f"depth_delta={depth_delta:.6f}",
)
if top_delta > 0.03 or center_delta > 0.02 or width_delta > 0.03 or depth_delta > 0.04:
    raise RuntimeError("Rebuilt identity does not align with the production GLB")

old_name = old_body.name
old_world = old_body.matrix_world.copy()
old_materials = list(old_body.data.materials)
if not old_materials:
    raise RuntimeError("Production body has no material to preserve")

# Attach the new morph body to the existing production armature.  Preserve the
# imported body's world transform to make this robust to GLB root transforms.
body.parent = None
body.matrix_world = old_world
for modifier in body.modifiers:
    if modifier.type == "ARMATURE":
        modifier.object = production_rig
body.parent = production_rig
body.matrix_parent_inverse = production_rig.matrix_world.inverted()
body.matrix_world = old_world

body.data.materials.clear()
for material in old_materials:
    body.data.materials.append(material)

delete_object(old_body)

# 새로 피팅한 헤어도 몸과 똑같이 프로덕션 리그로 갈아탄다.  generated_rig는
# 바로 아래에서 지워지므로, 그 전에 옮기지 않으면 헤어가 스킨을 잃는다.
if new_hair is not None:
    if not stale_hair:
        raise RuntimeError(
            f"--hair {ARGS.hair} was requested but {SOURCE.name} has no hair mesh to replace"
        )
    for obj in stale_hair:
        print(f"[morph-upgrade] replacing hair mesh: {obj.name} ({len(obj.data.vertices)}v)")
        delete_object(obj)
    new_hair.parent = None
    new_hair.matrix_world = old_world
    for modifier in new_hair.modifiers:
        if modifier.type == "ARMATURE":
            modifier.object = production_rig
    new_hair.parent = production_rig
    new_hair.matrix_parent_inverse = production_rig.matrix_world.inverted()
    new_hair.matrix_world = old_world

# 눈썹도 헤어와 같은 방식으로 프로덕션 리그로 갈아탄다.
if new_brows is not None:
    if not stale_brows:
        raise RuntimeError(
            f"--eyebrows {ARGS.eyebrows} was requested but {SOURCE.name} has no eyebrow mesh"
        )
    for obj in stale_brows:
        print(f"[morph-upgrade] replacing eyebrow mesh: {obj.name} ({len(obj.data.vertices)}v)")
        delete_object(obj)
    new_brows.parent = None
    new_brows.matrix_world = old_world
    for modifier in new_brows.modifiers:
        if modifier.type == "ARMATURE":
            modifier.object = production_rig
    new_brows.parent = production_rig
    new_brows.matrix_parent_inverse = production_rig.matrix_world.inverted()
    new_brows.matrix_world = old_world

delete_object(generated_rig)
body.name = old_name
body.data.name = f"{old_name}_ARKit"

for obj in bpy.data.objects:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True

# 의상 레이어 정리는 리그 이식이 끝난 뒤에 한다.  월드 좌표로 재고 쓰기 때문에
# 부모/역바인드가 최종 상태여야 한다.
character_meshes = [
    obj
    for obj in bpy.data.objects
    if obj.type == "MESH"
    and not any(
        collection.name == "glTF_not_exported" for collection in obj.users_collection
    )
]
moved_waist, largest_pull = tuck_lower_garment_waist(character_meshes)
breached_cells, breach_depth = waist_breach(character_meshes)
hair_drop, hair_below = hair_drape_over_upper(character_meshes)
print(
    f"[morph-upgrade] layering waist_tucked={moved_waist} "
    f"waist_pull_max={largest_pull * 1000:.1f}mm "
    f"waist_breach_cells={breached_cells} "
    f"waist_breach_max={breach_depth * 1000:.1f}mm "
    f"hair_drape={hair_drop * 100:.1f}cm ({hair_below * 100:.0f}% of hair below the neckline)"
)
# 보정을 돌린 뒤에도 남으면 조용히 넘기지 않는다.  런타임이 같은 종류의 보정을
# 한 번 더 하지만 그쪽은 밴드 전체의 최댓값을 쓰는 더 거친 규칙이라, 여기서 남은
# 관통은 런타임에서도 남는다.
if breach_depth > 0.002:
    raise RuntimeError(
        f"Lower garment still pierces the upper garment by {breach_depth * 1000:.1f}mm "
        f"in {breached_cells} cells"
    )
# 허리밴드를 3cm 넘게 당겨야 했다면 삐져나온 밴드가 아니라 옷 조합이 안 맞는
# 것이다. 그대로 두면 하의가 눌려 실루엣이 사라진다.
if largest_pull > MAX_WAIST_PULL:
    raise RuntimeError(
        f"Waist tuck had to pull the lower garment {largest_pull * 1000:.1f}mm "
        f"(limit {MAX_WAIST_PULL * 1000:.0f}mm); this outfit pair does not fit"
    )
# 피팅한 헤어가 목선 아래로 12cm 넘게 흘러내리면 그 헤어는 이 옷과 못 쓴다.
# mh_f20의 punkduck_alpha7_long이 34cm였다 — 큰 알파 카드가 흰 티셔츠의 가슴과
# 목선을 반투명 회색 판때기로 덮어 "검은 얼룩"으로 보였다. 런타임이 앞머리를
# 잘라내는 응급 처치를 하고 있지만, 애초에 어깨 위에서 끝나는 헤어를 고르는
# 것이 옳다. 베이크된 헤어(--hair 미지정)는 이 게이트를 타지 않는다 — 기존
# 포니테일/땋은 머리는 몸통을 덮지 않으므로 결함이 아니다.
if ARGS.hair and hair_drop > MAX_HAIR_DRAPE:
    raise RuntimeError(
        f"Fitted hair {ARGS.hair} drapes {hair_drop * 100:.1f}cm below the neckline "
        f"(limit {MAX_HAIR_DRAPE * 100:.0f}cm); pick a hair that ends above the shoulders"
    )

# Export morph positions (and optionally morph normals) without applying the
# armature.  Draco compresses static attributes; WebP keeps the existing 2K
# textures compact.  Filter kwargs against this Blender build for portability.
export_kwargs = {
    "filepath": str(OUTPUT),
    "export_format": "GLB",
    "export_yup": True,
    "export_apply": False,
    "export_morph": True,
    "export_morph_normal": bool(ARGS.morph_normals),
    "export_morph_tangent": False,
    "export_draco_mesh_compression_enable": True,
    "export_draco_mesh_compression_level": 6,
    "export_image_format": "WEBP",
    "export_image_add_webp": True,
}
if ARGS.draco_hq:
    # Blender 기본값은 position 14 / normal 10이다.  법선 10비트는 완만한
    # 곡면에서 셰이딩 계단현상을 만든다는 가설을 검증하기 위한 플래그이므로,
    # 렌더 비교에서 차이가 없으면 켜지 마라(파일만 커진다).
    export_kwargs.update(
        {
            "export_draco_position_quantization": 16,
            "export_draco_normal_quantization": 16,
            "export_draco_texcoord_quantization": 14,
            "export_draco_generic_quantization": 16,
        }
    )
supported = {prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
export_kwargs = {key: value for key, value in export_kwargs.items() if key in supported}
bpy.ops.export_scene.gltf(**export_kwargs)

if not OUTPUT.exists() or OUTPUT.stat().st_size < 100_000:
    raise RuntimeError("GLB export did not produce a valid output file")

elapsed = time.monotonic() - started_at
print(
    "[morph-upgrade] EXPORTED",
    OUTPUT,
    f"bytes={OUTPUT.stat().st_size}",
    f"morphs={len(keys_after_masks) - 1}",
    f"seconds={elapsed:.1f}",
)
