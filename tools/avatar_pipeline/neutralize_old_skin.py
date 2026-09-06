"""Pull the red cast out of the two 'old' MakeHuman skin textures.

## 왜

피부색은 이 시뮬레이터에서 **진단 정보**다 — 황달·창백·청색증을 학생이 읽어야
한다. 그런데 배포 중인 노년 텍스처 2장이 기본값부터 붉게 치우쳐 있어서,
노년 환자는 전부 볕에 그을린 것처럼 보였고 그 위에 얹는 임상 색 신호의
기준선이 무너져 있었다.

알베도(렌더가 아니라 **텍스처 자체**)에서 잰 값:

| 텍스처                  | R/G   | R/B   |
| ---------------------- | ----- | ----- |
| asian_middle_male      | 1.279 | 1.559 |
| asian_middle_female    | 1.265 | 1.540 |
| asian_young_male       | 1.281 | 1.543 |
| asian_young_female     | 1.310 | 1.646 |
| **asian_old_female**   | 1.389 | 1.825 |
| **asian_old_male**     | 1.489 | 2.039 |

`asian_old_male` 은 중년 대비 R/B 가 31% 높다. 나이 들며 혈색이 도는 것은
사실이지만 이 정도면 노화가 아니라 화상이다.

⚠ 비율은 반드시 **알베도 텍스처에서** 재라. 렌더된 화면에서 재면 조명과
톤매핑이 섞인 값을 보게 된다 — 구강 붉은 띠 수정이 그래서 한 번 실패했다.

## 어떻게

R 은 두고 G·B 만 감마로 끌어올려 목표 비율에 맞춘다. 곱셈 게인은 밝은
픽셀을 클리핑시키지만 감마(<1)는 0과 1을 고정한 채 중간톤만 움직여서
하이라이트가 뭉치지 않는다. 노년 특유의 온기는 남기려고 중년까지 내리지 않고
그 사이(R/G 1.34, R/B 1.73)에 세운다.

## 실행

    python3 tools/avatar_pipeline/neutralize_old_skin.py          # 미리보기
    python3 tools/avatar_pipeline/neutralize_old_skin.py --write  # 실제 기록

원본은 `<name>.orig.png` 로 남긴다(이미 있으면 그것을 입력으로 쓴다 —
반복 실행해도 색이 누적되지 않는다).
"""

from __future__ import annotations

import argparse
import io
import math
from pathlib import Path

from PIL import Image


SKIN_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "avatars" / "skin"
# ⚠ 원본 보관은 `public/` **밖** 이어야 한다. public 아래 두면 쓰지도 않는
# 9MB 가 그대로 배포에 실려 나간다.
ORIGINAL_DIR = Path(__file__).resolve().parent / "assets" / "skin_original"
# 중년(1.27/1.55)과 원래 노년 사이. 노년의 온기는 남기되 화상은 걷는다.
#
# ⚠ **파일마다 다르다.** 처음엔 두 장에 같은 목표(1.34/1.73)를 줬는데, 렌더로
# 재 보니 노년 여성만 맞고 노년 남성은 여전히 붉었다(얼굴 ROI R/B: 중년 1.41,
# 노년 여성 1.49, 노년 남성 1.61~1.69).
# 원인은 목표값을 **텍스처 전체 평균**으로 맞춘 것이다 — 전체 평균이 같아도
# 얼굴 영역의 치우침은 텍스처마다 다르다. 실제로 봐야 하는 건 렌더된 얼굴이라,
# 남성 쪽만 렌더 기준으로 다시 좁혔다.
# ⚠ 값을 바꾸면 반드시 렌더에서 얼굴 ROI 비율을 다시 재라(텍스처 평균 말고).
# ⚠ 피부 SSS(RealisticPatient 의 patientSSS*)가 켜지면 렌더 R/B 가 2~5% 더
#   따뜻해진다 — 산란광이 붉기 때문이다. 이 목표값은 **SSS 켠 상태 기준**이다.
#   SSS 를 끄거나 세기를 바꾸면 여기도 다시 맞춰야 한다.
TARGETS: dict[str, tuple[float, float]] = {
    # 파일명: (R/G, R/B)
    "asian_old_female.png": (1.34, 1.73),
    "asian_old_male.png": (1.25, 1.52),
}

# 거의 검은 픽셀(배경·UV 여백)은 평균을 끌어내리므로 통계에서 뺀다.
MIN_LUMA_SUM = 60


def channel_means(image: Image.Image) -> tuple[float, float, float]:
    small = image.convert("RGB").resize((128, 128))
    pixels = [p for p in small.getdata() if sum(p) > MIN_LUMA_SUM]
    if not pixels:
        raise ValueError("Texture is effectively empty")
    return tuple(sum(c) / len(c) for c in zip(*pixels))  # type: ignore[return-value]


def gamma_for(current: float, target: float) -> float:
    """중간톤 `current` 를 `target` 으로 옮기는 감마. 0과 1은 움직이지 않는다."""
    current_unit = min(max(current / 255.0, 1e-4), 1 - 1e-4)
    target_unit = min(max(target / 255.0, 1e-4), 1 - 1e-4)
    return math.log(target_unit) / math.log(current_unit)


# 이 저장소가 스스로 정한 텍스처 재인코딩 품질 게이트(CREDITS.md 참고).
# asian_old_female 이 원래 PNG 로 남아 있던 이유가 q92 로는 이 선을 못 넘겨서였다 —
# 게이트를 코드에 넣어 두지 않으면 다음 사람이 같은 판단을 조용히 뒤집는다.
# (실제로 2026-08-02 에 내가 그렇게 했고, 측정하고 나서야 알았다.)
MIN_PSNR_DB = 44.0
WEBP_QUALITY_LADDER = (92, 95, 96, 97, 98)


def webp_psnr(reference: Image.Image, quality: int) -> tuple[float, int]:
    """주어진 품질로 인코딩했을 때의 PSNR 과 바이트 수."""
    buffer = io.BytesIO()
    reference.save(buffer, format="WEBP", quality=quality, method=6)
    payload = buffer.getvalue()
    decoded = Image.open(io.BytesIO(payload)).convert("RGB")
    original = reference.convert("RGB")
    total = 0
    count = 0
    for source, result in zip(original.getdata(), decoded.getdata()):
        for a, b in zip(source, result):
            total += (a - b) ** 2
            count += 1
    mse = total / count
    if mse == 0:
        return math.inf, len(payload)
    return 10 * math.log10(255 * 255 / mse), len(payload)


def choose_quality(reference: Image.Image) -> tuple[int, float]:
    """게이트를 넘는 가장 낮은 품질을 고른다 — 넘는 순간 멈춰 용량을 아낀다."""
    best = WEBP_QUALITY_LADDER[-1]
    best_psnr = 0.0
    for quality in WEBP_QUALITY_LADDER:
        psnr, _ = webp_psnr(reference, quality)
        if psnr > best_psnr:
            best, best_psnr = quality, psnr
        if psnr >= MIN_PSNR_DB:
            return quality, psnr
    raise RuntimeError(
        f"어떤 품질로도 {MIN_PSNR_DB}dB 게이트를 못 넘었다 "
        f"(최고 {best_psnr:.2f}dB @ q{best}). WebP 대신 PNG 로 남겨라"
    )


def apply_gamma(image: Image.Image, gamma_g: float, gamma_b: float) -> Image.Image:
    identity = list(range(256))
    lut_g = [round(255 * (value / 255) ** gamma_g) for value in identity]
    lut_b = [round(255 * (value / 255) ** gamma_b) for value in identity]
    bands = image.split()
    red, green, blue = bands[0], bands[1].point(lut_g), bands[2].point(lut_b)
    if len(bands) == 4:
        return Image.merge("RGBA", (red, green, blue, bands[3]))
    return Image.merge("RGB", (red, green, blue))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="Actually overwrite the textures")
    args = parser.parse_args()

    if args.write:
        ORIGINAL_DIR.mkdir(parents=True, exist_ok=True)

    for name, (target_rg, target_rb) in TARGETS.items():
        deployed = SKIN_DIR / name
        original = ORIGINAL_DIR / name
        # 두 번째 실행부터는 원본에서 다시 계산한다 — 보정본에 보정을 겹치면
        # 실행할 때마다 색이 밀린다.
        source_path = original if original.exists() else deployed
        image = Image.open(source_path)
        red, green, blue = channel_means(image)

        adjusted = apply_gamma(
            image,
            gamma_for(green, red / target_rg),
            gamma_for(blue, red / target_rb),
        )
        after_r, after_g, after_b = channel_means(adjusted)
        print(
            f"{name}: R/G {red / green:.3f} -> {after_r / after_g:.3f}   "
            f"R/B {red / blue:.3f} -> {after_r / after_b:.3f}"
        )

        if not args.write:
            continue
        if not original.exists():
            deployed.replace(original)
        before_bytes = original.stat().st_size
        # ⚠ **확장자가 .png 지만 실제 내용은 WebP 다.** 상위 MakeHuman 팩이 그렇게
        # 배포하고 있고 브라우저는 매직 바이트로 판별하므로 동작에는 문제가 없다.
        # 그냥 PNG 로 저장하면 815KiB 짜리가 4.0MiB 로 부푼다 — 5배가 그대로
        # 로딩 시간이 된다. 반드시 WebP 로 되돌려 써야 한다.
        #
        # asian_old_female 만 원본이 진짜 PNG(4.65MiB)여서 같은 세트의 다른
        # 텍스처보다 14배 컸다. 여기서 함께 WebP 로 정리한다.
        quality, psnr = choose_quality(adjusted)
        adjusted.save(deployed, format="WEBP", quality=quality, method=6)
        print(f"  webp q{quality} PSNR={psnr:.2f}dB (gate {MIN_PSNR_DB}dB)")
        after_bytes = deployed.stat().st_size
        print(
            f"  wrote {deployed.name}  "
            f"{before_bytes / 1024:.0f}KiB -> {after_bytes / 1024:.0f}KiB   "
            f"(원본: {original.relative_to(Path(__file__).resolve().parents[2])})"
        )
        if after_bytes > before_bytes * 1.6:
            raise RuntimeError(
                f"{name} grew {after_bytes / before_bytes:.1f}x on save — "
                "압축이 안 먹었다. 배포 용량이 그대로 늘어난다"
            )

    if not args.write:
        print("\n(미리보기만 했다. 실제로 바꾸려면 --write)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
