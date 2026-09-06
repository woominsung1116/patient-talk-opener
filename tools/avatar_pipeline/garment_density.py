"""의상 서브디비전 레벨 결정 — 도너 스크립트가 공유한다.

몸은 55,784 verts인데 커스텀 의상만 1,700~2,000 verts로 나가고 있어 배·엉덩이
같은 곡면에 각진 면이 그대로 보였다. 기본 제공 의상(`Worn_out_sweater` 11,857 /
`skirt_full_long` 12,672)과 같은 급으로 맞추는 것이 목표다.

레벨을 상수로 박으면 안 된다. Catmull-Clark는 한 레벨마다 정점이 약 4배가
되므로, 베이스가 1,736인 튜닉은 레벨 2가 필요하지만 6,774인 드레스는 레벨 2에서
104,000까지 부풀어 오른다(실측). 그래서 베이스 밀도로부터 역산한다.
"""

from __future__ import annotations


MINIMUM_VERTS = 8_000
COMFORTABLE_MAX_VERTS = 30_000
MAX_LEVEL = 3


def subdivision_level(
    base_vertices: int,
    minimum: int = MINIMUM_VERTS,
    maximum: int = COMFORTABLE_MAX_VERTS,
) -> int:
    """`minimum` 정점을 넘기는 가장 낮은 Catmull-Clark 레벨을 고른다."""
    for level in range(MAX_LEVEL + 1):
        estimate = base_vertices * (4**level)
        if estimate >= minimum:
            if estimate > maximum:
                # 각진 것보다는 무거운 쪽이 낫지만, 조용히 넘어가진 않는다.
                print(
                    f"[garment-density] level {level} estimates {estimate} verts, "
                    f"above the {maximum} comfort ceiling"
                )
            return level
    return MAX_LEVEL
