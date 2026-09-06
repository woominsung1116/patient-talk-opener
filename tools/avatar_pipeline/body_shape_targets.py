"""아바타 체형 모프 타깃 표 — 본체 빌드와 의상 도너 빌드가 공유한다.

의상 도너는 `mh_f60_ob`와 **완전히 같은 몸**에 피팅되어야 한다. 예전에는
`upgrade_mpfb_morphs.py`와 두 도너 스크립트가 같은 리스트를 각각 복사해
두고 "Keep this list identical to ..." 주석으로만 묶여 있었다. 한쪽만 고치면
의상이 다른 체형에 맞춰져 몸을 파고들지만 아무 것도 실패하지 않는다.
그래서 표를 여기로 모았다.

타깃 이름은 MPFB의 `data/targets/**/<leaf>.target.gz` 실제 파일명이다.
`TargetService.target_full_path()`는 leaf 이름의 **접두사 매칭**으로 찾으므로
경로의 앞부분(`stomach/` 등)은 문서용이고 탐색에는 쓰이지 않는다.
"""

from __future__ import annotations


# 중심성 비만은 "배에 공을 하나 붙인" 모양이 아니라, 몸통이 앞뒤·좌우로 함께
# 두꺼워지고 허리가 사라지며 팔·목·얼굴에도 지방이 붙는 형태다. 임신 모프
# (stomach-pregnant-incr)는 배꼽 위로 뚜렷한 경계를 가진 구형 돌출을 만들어
# 60대 여성의 복부비만으로 읽히지 않으므로 제거했다.
OBESE_TARGETS: list[tuple[str, float]] = [
    # 복부 — 돌출이 아니라 복벽 이완 + 배꼽이 지방에 묻히는 방향
    ("stomach/stomach-tone-decr", 0.85),
    ("stomach/stomach-navel-in", 0.4),
    # 몸통 — 깊이만 키우면 판자가 된다. 가로도 같이 키워 원통에 가깝게 만든다
    ("torso/torso-scale-depth-incr", 0.8),
    ("torso/torso-scale-horiz-incr", 0.7),
    ("torso/measure-waist-circ-incr", 1.0),
    ("torso/measure-bust-circ-incr", 0.6),
    ("torso/measure-underbust-circ-incr", 0.75),
    ("torso/torso-vshape-decr", 0.6),
    # 골반·엉덩이
    ("hip/hip-scale-horiz-incr", 0.65),
    ("hip/hip-scale-depth-incr", 0.6),
    ("buttocks/buttocks-volume-incr", 0.5),
    # 사지 — 몸통만 굵으면 "붙인 티"가 난다
    ("arms/l-upperarm-fat-incr", 0.85),
    ("arms/r-upperarm-fat-incr", 0.85),
    ("arms/l-lowerarm-fat-incr", 0.5),
    ("arms/r-lowerarm-fat-incr", 0.5),
    ("legs/l-upperleg-fat-incr", 0.75),
    ("legs/r-upperleg-fat-incr", 0.75),
    ("legs/l-lowerleg-fat-incr", 0.4),
    ("legs/r-lowerleg-fat-incr", 0.4),
    # 목·얼굴 — 빠지면 "몸만 뚱뚱한 사람"으로 보인다. 다만 사진 투영으로 만든
    # 얼굴 정체성과 머리 정렬 가드를 통과해야 하므로 값을 억제했다.
    ("neck/neck-scale-horiz-incr", 0.6),
    ("neck/neck-scale-depth-incr", 0.55),
    ("neck/neck-double-incr", 0.5),
    ("chin/chin-jaw-drop-incr", 0.3),
    ("cheek/l-cheek-volume-incr", 0.5),
    ("cheek/r-cheek-volume-incr", 0.5),
]

# 마름은 "가늘다"만으로는 읽히지 않는다. 근육 볼륨이 빠져 쇄골·늑골 라인이
# 드러나고 볼이 꺼져야 저체중으로 보인다.
THIN_TARGETS: list[tuple[str, float]] = [
    ("stomach/stomach-tone-incr", 0.5),
    ("torso/torso-scale-depth-decr", 0.5),
    ("torso/torso-scale-horiz-decr", 0.3),
    ("torso/measure-waist-circ-decr", 0.7),
    ("torso/measure-underbust-circ-decr", 0.55),
    ("torso/torso-vshape-incr", 0.35),
    ("torso/torso-muscle-dorsi-decr", 0.45),
    ("torso/torso-muscle-pectoral-decr", 0.4),
    ("hip/hip-scale-horiz-decr", 0.3),
    ("hip/hip-scale-depth-decr", 0.3),
    ("arms/l-upperarm-fat-decr", 0.5),
    ("arms/r-upperarm-fat-decr", 0.5),
    ("arms/l-lowerarm-fat-decr", 0.4),
    ("arms/r-lowerarm-fat-decr", 0.4),
    ("legs/l-upperleg-fat-decr", 0.4),
    ("legs/r-upperleg-fat-decr", 0.4),
    ("legs/l-lowerleg-fat-decr", 0.3),
    ("legs/r-lowerleg-fat-decr", 0.3),
    ("neck/neck-scale-horiz-decr", 0.3),
    ("cheek/l-cheek-inner-decr", 0.35),
    ("cheek/r-cheek-inner-decr", 0.35),
]


def body_targets(weight: float) -> list[tuple[str, float]]:
    if weight >= 0.8:
        return list(OBESE_TARGETS)
    if weight <= 0.2:
        return list(THIN_TARGETS)
    return []


def load_body_targets(target_service, body, weight: float, tag: str) -> list[str]:
    """체형 타깃을 적용하고, 하나라도 없으면 빌드를 세운다.

    예전에는 없는 타깃을 경고만 찍고 넘어가서 요청한 18개 중 실제로 몇 개가
    적용됐는지 아무도 알 수 없었다. 체형이 "덜 변한" 채로 조용히 배포되는 것이
    이 파이프라인에서 가장 비싼 실패다.
    """
    requested = body_targets(weight)
    applied: list[str] = []
    missing: list[str] = []
    for target_name, value in requested:
        leaf_name = target_name.rsplit("/", 1)[-1]
        target_path = target_service.target_full_path(leaf_name)
        if target_path:
            target_service.load_target(body, target_path, weight=value, name=leaf_name)
            applied.append(f"{target_name}={value}")
        else:
            missing.append(target_name)
    if missing:
        raise RuntimeError(f"MPFB has no such body targets: {', '.join(missing)}")
    print(
        f"[{tag}] body targets requested={len(requested)} "
        f"applied={len(applied)} missing=0 :: {' '.join(applied)}"
    )
    return applied
