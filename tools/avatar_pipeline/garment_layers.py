"""의상·헤어 레이어 정합 — 판정 규칙 한 벌.

`upgrade_mpfb_morphs.py`(빌드 시 보정 + 게이트)와 `measure_layers.py`(배포본
계측)가 같은 모듈을 쓴다. 두 곳에 복사하면 "빌드는 통과했는데 배포본은 뚫려
있다" 같은 조용한 드리프트가 생긴다.

토큰과 판정식은 런타임 `RealisticPatient.tsx`의 `garmentSlot()` /
`tuckLowerGarmentWaist()`와 같아야 한다. 여기서 갈라지면 파이프라인이 실제로
보이는 것과 다른 것을 검사하게 된다.

좌표계: Blender(Z-up). glTF 임포터가 Y-up을 Z-up으로 바꾸므로 높이=z, 반경은
xy 평면이다. 런타임은 three.js(Y-up)에서 높이=y, 반경은 xz 평면으로 같은 것을
잰다 — 방위각 칸 경계 집합이 동일하므로 칸 단위 결과도 같다.
"""

from __future__ import annotations

import math
import re


HAIR_TOKENS = re.compile(r"(hair|alpha7|ponytail|braid|curled|bob|maxwell|grump|culturalibre)")
NOT_HAIR_TOKENS = re.compile(r"(eyebrow|eyelash)")
GARMENT_SKIP_TOKENS = re.compile(
    r"(underwear|under_layer|medical_base|brief"
    r"|sock|stocking|shoe|sneaker|loafer|boot|slipper)"
)
GARMENT_LOWER_TOKENS = re.compile(r"(pants|trouser|slacks|jeans|skirt|bottom)")
GARMENT_UPPER_TOKENS = re.compile(
    r"(clothing|shirt|tshirt|t-shirt|blouse|sweater|pullover|cardigan|tunic"
    r"|jacket|gown|top)"
)

RADIAL_BINS = 36
# 니트 두께만큼 확실히 안쪽으로. 런타임(`tuckLowerGarmentWaist`)과 같은 값이라
# 에셋을 여기서 맞춰 두면 런타임 보정이 무동작이 된다.
WAIST_CLEARANCE = 0.016
# 피팅한 헤어가 상의 목선 아래로 늘어져도 되는 한계. 턱선 단발은 목선 언저리
# 에서 끝나고, 어깨를 넘어 흘러내리는 긴 머리는 30cm를 넘어간다.
MAX_HAIR_DRAPE = 0.12
# 높이 슬라이스. 몸통은 2cm마다 굵기가 달라지므로 이보다 두꺼우면 배 둘레가
# 허리 판정을 오염시키고, 이보다 얇으면 슬라이스에 정점이 없는 칸이 많아진다.
SLICE_HEIGHT = 0.02
# 보정 구간의 아래 경계에서 보정을 빼는 길이. 뚝 끊기면 하의에 접힌 자국이
# 생기고, 너무 길게 빼면 상의 밑단 아래 드러난 부분까지 홀쭉해진다.
HEM_FADE = 0.03
# 허리선에서 이만큼 아래까지만 손댄다. 결함은 "상의를 가로지르는 허리밴드 띠"라
# 허리 주변에 있다. 상의가 무릎까지 내려오는 긴 튜닉일 때 겹치는 구간 전체를
# 조이면 치마 실루엣이 7cm씩 눌려 사라진다(mh_f60/f70에서 실측 71mm).
WAIST_BAND_DEPTH = 0.14
# 이보다 크게 당겨야 한다면 허리밴드가 삐져나온 게 아니라 옷 조합 자체가 안 맞는
# 것이다. 조용히 뭉개지 말고 게이트에서 세운다.
MAX_WAIST_PULL = 0.035


def mesh_identity(obj) -> str:
    return " ".join(
        [obj.name] + [material.name for material in obj.data.materials if material]
    ).lower()


def garment_slot(obj) -> str | None:
    """런타임과 같은 우선순위: 제외 토큰 → 하의 → 상의.

    순서가 중요하다. 'skirt_full_long'은 하의지만 상의 토큰의 'top'에도 걸리고,
    'crudelowsocks'는 'sock'으로 먼저 걸러져야 한다.
    """
    identity = mesh_identity(obj)
    if GARMENT_SKIP_TOKENS.search(identity):
        return None
    if GARMENT_LOWER_TOKENS.search(identity):
        return "lower"
    if GARMENT_UPPER_TOKENS.search(identity):
        return "upper"
    return None


def is_hair_mesh(obj) -> bool:
    identity = mesh_identity(obj)
    if NOT_HAIR_TOKENS.search(identity):
        return False
    return bool(HAIR_TOKENS.search(identity))


def world_points(obj) -> list:
    return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]


def angle_bin(x: float, y: float, cx: float, cy: float) -> int:
    angle = math.atan2(y - cy, x - cx) + math.pi
    return min(RADIAL_BINS - 1, int(angle / (math.pi * 2) * RADIAL_BINS))


def radius(point, cx: float, cy: float) -> float:
    return math.hypot(point.x - cx, point.y - cy)


def horizontal_centre(points) -> tuple[float, float]:
    """바운딩 박스 중심. 런타임의 `Box3.getCenter()`와 같아야 한다 —
    정점 평균으로 바꾸면 정점 밀도가 높은 쪽으로 축이 끌려간다."""
    return (
        (min(p.x for p in points) + max(p.x for p in points)) * 0.5,
        (min(p.y for p in points) + max(p.y for p in points)) * 0.5,
    )


def mean_radius_in_band(objects, low: float, high: float, cx: float, cy: float) -> float:
    values = [
        radius(point, cx, cy)
        for obj in objects
        for point in world_points(obj)
        if low <= point.z <= high
    ]
    return sum(values) / len(values) if values else -1.0


def smoothstep(value: float, edge0: float, edge1: float) -> float:
    if edge1 <= edge0:
        return 0.0
    t = min(1.0, max(0.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def split_layers(meshes) -> tuple[list, list, list]:
    uppers = [obj for obj in meshes if garment_slot(obj) == "upper"]
    lowers = [obj for obj in meshes if garment_slot(obj) == "lower"]
    hairs = [obj for obj in meshes if obj.type == "MESH" and is_hair_mesh(obj)]
    return uppers, lowers, hairs


def waist_frame(uppers, lowers) -> tuple[float, float, float, bool]:
    """(허리선, 중심x, 중심y, 상의가 겉인가)."""
    lower_points = [point for obj in lowers for point in world_points(obj)]
    waist_top = max(point.z for point in lower_points)
    centre_x, centre_y = horizontal_centre(lower_points)
    low, high = waist_top - 0.13, waist_top - 0.02
    upper_mean = mean_radius_in_band(uppers, low, high, centre_x, centre_y)
    lower_mean = mean_radius_in_band(lowers, low, high, centre_x, centre_y)
    # 셔츠를 바지에 넣어 입은 아바타(mh_m40)는 하의가 바깥인 것이 정상이다.
    # 평균으로 재는 이유: 칸별 최댓값이면 관통해 튀어나온 밴드 자신 때문에
    # 판정이 뒤집힌다(mh_m60에서 실제로 그랬다).
    outer_upper = upper_mean > 0 and lower_mean > 0 and upper_mean > lower_mean
    return waist_top, centre_x, centre_y, outer_upper


class SurfaceProfile:
    """상의 표면을 (높이 슬라이스 × 방위각 칸)의 반경 표로 만든 것.

    밴드 전체의 최댓값 하나로 판정하면 안 된다: 몸통 굵기가 높이마다 달라서
    스웨터의 가장 굵은 곳(배)과 바지의 가장 굵은 곳(엉덩이)을 비교하게 되고,
    실제로 뚫린 곳(허리선 바로 아래 12cm)을 놓치면서 뚫리지 않은 곳(밑단 아래)을
    뚫렸다고 보고한다. mh_m60에서 이 두 오류가 동시에 났다.
    """

    def __init__(self, objects, centre_x: float, centre_y: float):
        points = [point for obj in objects for point in world_points(obj)]
        self.centre_x = centre_x
        self.centre_y = centre_y
        self.bottom = min(point.z for point in points)
        self.top = max(point.z for point in points)
        self.slices: dict[int, list[float]] = {}
        for point in points:
            key = self._key(point.z)
            bins = self.slices.setdefault(key, [-1.0] * RADIAL_BINS)
            index = angle_bin(point.x, point.y, centre_x, centre_y)
            bins[index] = max(bins[index], radius(point, centre_x, centre_y))
        # 빈 칸은 이웃 칸으로 메운다. 성긴 메시에서 한 칸이 비면 그 방향의
        # 하의가 통째로 무보정으로 남아 띠가 그대로 살아남는다.
        for bins in self.slices.values():
            filled = [value for value in bins if value > 0]
            if not filled:
                continue
            fallback = sum(filled) / len(filled)
            for index in range(RADIAL_BINS):
                if bins[index] > 0:
                    continue
                left = bins[(index - 1) % RADIAL_BINS]
                right = bins[(index + 1) % RADIAL_BINS]
                neighbours = [value for value in (left, right) if value > 0]
                bins[index] = max(neighbours) if neighbours else fallback

    def _key(self, z: float) -> int:
        return int((z - self.bottom) / SLICE_HEIGHT)

    def limit_at(self, z: float, x: float, y: float) -> float:
        """높이 z의 이 방향에서 상의 표면 반경. 밑단 아래는 밑단 값을 쓴다."""
        clamped = min(max(z, self.bottom), self.top)
        bins = self.slices.get(self._key(clamped))
        if bins is None:
            return -1.0
        return bins[angle_bin(x, y, self.centre_x, self.centre_y)]


def tuck_lower_garment_waist(meshes) -> tuple[int, float]:
    """상의를 뚫고 나오는 하의를 상의 안쪽으로 당긴다. (옮긴 정점 수, 최대 이동량).

    상의를 부풀리는 반대 방향은 쓰지 않는다 — 셔츠를 바지에 넣어 입은 아바타
    (mh_m40)에서 셔츠가 터져 나온다.
    """
    uppers, lowers, _ = split_layers(meshes)
    if not uppers or not lowers:
        return 0, 0.0
    waist_top, centre_x, centre_y, outer_upper = waist_frame(uppers, lowers)
    if not outer_upper:
        return 0, 0.0

    profile = SurfaceProfile(uppers, centre_x, centre_y)
    band_low = max(profile.bottom, waist_top - WAIST_BAND_DEPTH)
    moved = 0
    largest = 0.0
    for obj in lowers:
        to_world = obj.matrix_world
        to_local = to_world.inverted()
        for vertex in obj.data.vertices:
            point = to_world @ vertex.co
            if point.z < band_low - HEM_FADE or point.z > waist_top:
                continue
            limit = profile.limit_at(point.z, point.x, point.y)
            if limit < 0:
                continue
            current = radius(point, centre_x, centre_y)
            target = limit - WAIST_CLEARANCE
            if current <= target or current < 1e-5:
                continue
            # 밴드 아래 3cm에서 0 → 밴드 안에서는 100%. 구간 안은 온전히 보정하고
            # 밖으로 넘어갈 때만 부드럽게 빼서 접힌 자국이 남지 않게 한다.
            ramp = smoothstep(point.z, band_low - HEM_FADE, band_low)
            scale = (target / current - 1.0) * ramp + 1.0
            largest = max(largest, current * (1.0 - scale))
            point.x = centre_x + (point.x - centre_x) * scale
            point.y = centre_y + (point.y - centre_y) * scale
            vertex.co = to_local @ point
            moved += 1
        obj.data.update()
    return moved, largest


def waist_breach(meshes) -> tuple[int, float]:
    """상의가 덮는 구간에서 하의가 밖으로 나온 (슬라이스·칸 수, 최대 깊이 m).

    상의 밑단 아래는 세지 않는다 — 거기서 바지가 더 굵은 것은 결함이 아니라
    옷을 입은 모습 그 자체다.
    """
    uppers, lowers, _ = split_layers(meshes)
    if not uppers or not lowers:
        return 0, 0.0
    waist_top, centre_x, centre_y, outer_upper = waist_frame(uppers, lowers)
    if not outer_upper:
        return 0, 0.0
    profile = SurfaceProfile(uppers, centre_x, centre_y)
    band_low = max(profile.bottom, waist_top - WAIST_BAND_DEPTH)
    worst: dict[tuple[int, int], float] = {}
    for obj in lowers:
        for point in world_points(obj):
            if point.z < band_low or point.z > waist_top:
                continue
            limit = profile.limit_at(point.z, point.x, point.y)
            if limit < 0:
                continue
            depth = radius(point, centre_x, centre_y) - limit
            if depth <= 0:
                continue
            key = (profile._key(point.z), angle_bin(point.x, point.y, centre_x, centre_y))
            worst[key] = max(worst.get(key, 0.0), depth)
    return len(worst), max(worst.values(), default=0.0)


def hair_drape_over_upper(meshes) -> tuple[float, float]:
    """(상의 목선 아래로 늘어진 헤어 길이 m, 목선 아래에 있는 헤어 정점 비율).

    처음에는 "천 **안쪽**에 박힌 헤어 정점"을 셌다. 그 지표는 결함을 못 잡는다:
    mh_f20의 긴 알파 카드는 기하학적으로 티셔츠 **바깥**에 있어서 부호 있는
    거리로는 2,338개 중 1개만 걸렸는데, 렌더에서는 가슴과 목선을 가로지르는
    커다란 반투명 회색 판때기로 보였다. 눈에 보이는 것은 관통이 아니라
    **몸통을 덮은 머리 면적**이었다.

    그래서 재는 것을 바꿨다. 목선(상의 최상단) 아래로 머리가 얼마나 내려오는가.
    턱선 단발은 목선 언저리에서 끝나고, 어깨 뒤로 흘러내리는 긴 머리는 30cm를
    넘어간다.
    """
    uppers, _, hairs = split_layers(meshes)
    if not uppers or not hairs:
        return 0.0, 0.0
    neckline = max(point.z for obj in uppers for point in world_points(obj))
    hair_points = [point for obj in hairs for point in world_points(obj)]
    below = [point for point in hair_points if point.z < neckline]
    drop = neckline - min((point.z for point in below), default=neckline)
    return drop, len(below) / len(hair_points)
