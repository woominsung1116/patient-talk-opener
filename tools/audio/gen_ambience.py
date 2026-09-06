"""진료실 환경음(룸톤 + 간헐 이벤트) 합성.

`material-quality-spec.md` §6.5(a). freesound에 "한국 진료실"에 맞는 CC0 룸톤이
사실상 없어서(대부분 사무실/카페/공조실이고 CC-BY거나 마이크 노이즈가 섞여 있다)
직접 합성한다. 합성이면 층별 밸런스를 우리가 정할 수 있고 재현도 된다.

만드는 것:
  room_tone.mp3          32초 **완전 무결 루프** 스테레오 — 형광등 험 + 공조 저역
  corridor_steps_a/b.mp3 먼 복도 발소리(지나감) 모노
  corridor_door_a/b.mp3  먼 문 여닫힘 모노

── 루프가 이어지는 원리 (중요) ──
전부 **주파수 영역에서 만든다**. 길이 N 샘플의 rfft 스펙트럼에 임의 위상을 넣고
irfft 하면 결과는 **주기 N으로 정확히 순환**한다(경계에서 값·기울기가 연속).
필터도 스펙트럼 곱으로 걸어서 순환성을 깨지 않는다. 험은 32초에 정수 배 사이클이
들어가는 주파수(120·240·…Hz)만 쓰고, 느린 LFO 주기도 32초를 정수로 나눈다.
→ 크로스페이드 없이도 이음매가 수학적으로 존재하지 않는다.
   (그래도 런타임은 mp3 인코더 패딩 때문에 크로스페이드로 재생한다. roomTone.ts 참고)

── 분위기 규칙 ──
진료실은 **안심되고 평범해야** 한다. 8번출구·당직근무류의 호러 장치를 쓰지 않는다:
  - 깜빡임/명멸 없음 (험 진폭 흔들림 ±1.5% 이하, 20초 주기 — '건물'이지 '고장'이 아니다)
  - 초저역 throb 없음 (34Hz 아래 컷)
  - 불안한 정적 없음 (바닥 히스를 항상 깔아 '녹음이 끊긴' 느낌을 막는다)
  - 발소리는 **지나간다**. 문 앞에서 멈추지 않는다
  - 갑작스러운 큰 트랜지언트 없음 (모든 이벤트에 8ms 이상 어택 + 벽 통과 저역통과)

사용:
    python3 tools/audio/gen_ambience.py            # wav 생성 + mp3 변환(ffmpeg 있으면)
    python3 tools/audio/gen_ambience.py --wav-only
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100
LOOP_SEC = 32.0  # 험 120Hz가 정확히 3840 사이클. LFO 주기 16s·32/3s도 정수 배.

HERE = Path(__file__).parent
WAV_OUT = HERE / "ambience_wav"
MP3_OUT = HERE.parent.parent / "frontend" / "public" / "audio" / "ambience"


# ────────────────────────────── 공통 유틸 ──────────────────────────────

def hp2(f: np.ndarray, fc: float) -> np.ndarray:
    """2차 하이패스 크기응답 (fc에서 -3dB, 아래로 -12dB/oct)."""
    r = (f / fc) ** 2
    return r / (1.0 + r)


def lp2(f: np.ndarray, fc: float) -> np.ndarray:
    """2차 로우패스 크기응답."""
    return 1.0 / (1.0 + (f / fc) ** 2)


def periodic_noise(n: int, rng: np.random.Generator, mag_fn) -> np.ndarray:
    """주기 N으로 정확히 순환하는 대역 노이즈.

    rfft 빈에 |H(f)|·e^{jφ}를 채우고 irfft. 시간영역 필터를 전혀 쓰지 않으므로
    경계 불연속(=루프 클릭)이 원리적으로 생기지 않는다.
    """
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    mag = mag_fn(freqs).astype(np.float64)
    phase = rng.uniform(0.0, 2.0 * np.pi, mag.shape[0])
    spec = mag * np.exp(1j * phase)
    spec[0] = 0.0                                   # DC 제거
    spec[-1] = mag[-1] * np.cos(phase[-1])          # 나이퀴스트 빈은 실수여야 한다
    x = np.fft.irfft(spec, n)
    return unit_rms(x)


def unit_rms(x: np.ndarray) -> np.ndarray:
    r = float(np.sqrt(np.mean(x ** 2)))
    return x / r if r > 1e-12 else x


def db(x: float) -> float:
    return 20.0 * np.log10(max(x, 1e-12))


def one_pole_lp(x: np.ndarray, fc: float) -> np.ndarray:
    """1차 저역통과 — 벽·문을 통과하며 고역이 깎이는 것. (짧은 이벤트용)"""
    a = np.exp(-2.0 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1.0 - a) * v + a * acc
        y[i] = acc
    return y


def small_room_tail(rng: np.random.Generator, sec: float = 0.42, tau: float = 0.10) -> np.ndarray:
    """복도 잔향 — 지수감쇠 노이즈. 길게 잡으면 '텅 빈 큰 공간'(호러)이 되므로 짧게."""
    n = int(SR * sec)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t / tau)
    ir = one_pole_lp(ir, 1200.0)
    ir[0] += 1.0  # 직접음
    return ir / (np.max(np.abs(ir)) + 1e-9)


def soft_attack(x: np.ndarray, ms: float = 8.0) -> np.ndarray:
    """어택을 뭉갠다 — 순간적인 '팡'은 놀람 반응을 부른다. 진료실에 필요 없다."""
    n = min(int(SR * ms / 1000.0), len(x))
    if n > 1:
        x = x.copy()
        x[:n] *= np.linspace(0.0, 1.0, n) ** 1.5
    return x


def fade_edges(x: np.ndarray, ms: float = 12.0) -> np.ndarray:
    n = min(int(SR * ms / 1000.0), len(x) // 2)
    if n > 1:
        x = x.copy()
        x[:n] *= np.linspace(0.0, 1.0, n)
        x[-n:] *= np.linspace(1.0, 0.0, n)
    return x


# ────────────────────────────── 룸톤 ──────────────────────────────

# 층별 밸런스 (공조 저역 RMS = 1.0 기준)
# ⚠️ 저역은 RMS가 커도 귀에는 훨씬 작게 들린다(등청감곡선). 그래서 밸런스는
#    A-weighting 대역 에너지로 맞췄다 — 목표는 80~500Hz가 지각 에너지의 절반 이상.
LV_HVAC = 1.00     # 공조 저역 — 룸톤의 몸통
LV_AIR = 0.12      # 디퓨저에서 나오는 중역 바람 (-18dB)
LV_HISS = 0.028    # 바닥 히스 (-31dB) — 없으면 '패드'처럼 들려 CG 신호가 된다
LV_HUM = 0.33      # 형광등 험 총합 (-10dB)
LV_FIZZ = 0.014    # 안정기 지지직 (-37dB)

# 형광등 험 — 한국 상용전원 60Hz → 정류로 **120Hz**와 그 배음이 뜬다.
HUM_PARTIALS = [(120.0, 1.00), (240.0, 0.36), (360.0, 0.22),
                (480.0, 0.10), (600.0, 0.06), (720.0, 0.035)]


def build_room_tone(seed: int = 20260725) -> np.ndarray:
    n = int(SR * LOOP_SEC)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)

    # (1) 공조 저역 — 좌우 상관도가 높다(실제 방에서 저역은 상관됨). 공통 성분 위주.
    hvac_c = periodic_noise(n, rng, lambda f: hp2(f, 34.0) * lp2(f, 105.0) ** 1.15)
    hvac_l = periodic_noise(n, rng, lambda f: hp2(f, 34.0) * lp2(f, 105.0) ** 1.15)
    hvac_r = periodic_noise(n, rng, lambda f: hp2(f, 34.0) * lp2(f, 105.0) ** 1.15)
    low_l = unit_rms(0.88 * hvac_c + 0.12 * hvac_l)
    low_r = unit_rms(0.88 * hvac_c + 0.12 * hvac_r)

    # (2) 디퓨저 중역 바람 — 좌우 독립(넓게 퍼진다)
    air_fn = lambda f: hp2(f, 240.0) * lp2(f, 1050.0) ** 1.2
    air_l = periodic_noise(n, rng, air_fn)
    air_r = periodic_noise(n, rng, air_fn)

    # (3) 바닥 히스 — 좌우 독립
    hiss_fn = lambda f: hp2(f, 1700.0) * lp2(f, 8500.0) ** 1.5
    hiss_l = periodic_noise(n, rng, hiss_fn)
    hiss_r = periodic_noise(n, rng, hiss_fn)

    # (4) 아주 느린 공조 숨 — 주기가 LOOP_SEC을 정수로 나눠야 순환이 유지된다.
    #     ±0.5dB. 이보다 크면 '숨쉬는 무언가'로 읽혀서 호러가 된다.
    lfo = (1.0
           + 0.055 * np.sin(2 * np.pi * t / (LOOP_SEC / 2) + 0.7)
           + 0.028 * np.sin(2 * np.pi * t / (LOOP_SEC / 3) + 2.1))

    noise_l = (LV_HVAC * low_l + LV_AIR * air_l) * lfo + LV_HISS * hiss_l
    noise_r = (LV_HVAC * low_r + LV_AIR * air_r) * lfo + LV_HISS * hiss_r

    # (5) 형광등 험 — 진폭 흔들림은 20초 주기 ±1.5%. 깜빡임이 아니라 '건물'의 미세한 불안정.
    wobble = 1.0 + 0.015 * np.sin(2 * np.pi * t / (LOOP_SEC / 2) + 1.9)
    hum_l = np.zeros(n)
    hum_r = np.zeros(n)
    for f, a in HUM_PARTIALS:
        cycles = f * LOOP_SEC
        assert abs(cycles - round(cycles)) < 1e-9, f"험 {f}Hz가 루프에 정수 배로 안 들어간다"
        ph = rng.uniform(0, 2 * np.pi)
        hum_l += a * np.sin(2 * np.pi * f * t + ph)
        # 우측은 아주 약간 작고 위상이 몇 도 어긋난다 → 천장 패널이 여러 개라는 느낌
        hum_r += a * 0.93 * np.sin(2 * np.pi * f * t + ph + 0.09)
    hum_l = unit_rms(hum_l) * wobble
    hum_r = unit_rms(hum_r) * wobble

    # (6) 안정기 지지직 — 120Hz로 정류된 포락선의 고역 노이즈. 아주 작게.
    fizz_fn = lambda f: hp2(f, 2600.0) * lp2(f, 6500.0) ** 2.0
    fizz_env = 0.45 + 0.55 * np.abs(np.sin(2 * np.pi * 120.0 * t))
    fizz_l = unit_rms(periodic_noise(n, rng, fizz_fn) * fizz_env)
    fizz_r = unit_rms(periodic_noise(n, rng, fizz_fn) * fizz_env)

    left = noise_l + LV_HUM * hum_l + LV_FIZZ * fizz_l
    right = noise_r + LV_HUM * hum_r + LV_FIZZ * fizz_r
    stereo = np.stack([left, right], axis=1)

    # 피크 -6dBFS로 정규화 (룸톤 실제 음량은 런타임 게인이 정한다)
    stereo = stereo / (np.max(np.abs(stereo)) + 1e-12) * 10 ** (-6.0 / 20.0)
    return stereo


def loop_seam_pct(x: np.ndarray) -> float:
    """루프 이음매 검증.

    완전 순환 신호라면 마지막→첫 샘플의 차분도 내부 인접 차분과 **같은 분포**에서
    나온 한 표본이어야 한다. 그 백분위를 본다. 99% 미만이면 이음매가 통계적으로
    구분되지 않는다는 뜻 = 클릭이 없다. (시간영역 필터가 섞이면 여기서 100%가 뜬다)
    """
    mono = x[:, 0] if x.ndim > 1 else x
    d = np.abs(np.diff(mono))
    boundary = abs(float(mono[0]) - float(mono[-1]))
    return float((d < boundary).mean() * 100.0)


def a_weight_db(f: np.ndarray) -> np.ndarray:
    f = np.maximum(f, 1e-6)
    f2 = f ** 2
    ra = (12194.0 ** 2 * f2 ** 2) / (
        (f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194.0 ** 2)
    )
    return 20.0 * np.log10(ra) + 2.0


def report_bands(x: np.ndarray) -> None:
    """A-weighting 대역 분포 — 귀에 어떤 대역이 지배적인지."""
    mono = x[:, 0] if x.ndim > 1 else x
    n = len(mono)
    S = np.abs(np.fft.rfft(mono)) ** 2
    f = np.fft.rfftfreq(n, 1.0 / SR)
    SA = S * 10 ** (a_weight_db(f) / 10.0)
    edges = [(20, 80), (80, 200), (200, 500), (500, 1500), (1500, 4000), (4000, 16000)]
    parts = []
    for lo, hi in edges:
        pct = 100.0 * SA[(f >= lo) & (f < hi)].sum() / (SA.sum() + 1e-12)
        parts.append(f"{lo}-{hi}:{pct:4.1f}%")
    print("    A-weighted 대역: " + "  ".join(parts))


# ────────────────────────── 간헐 이벤트 ──────────────────────────

def one_step(rng: np.random.Generator, cutoff: float, gain: float) -> np.ndarray:
    """발소리 한 걸음 — 벽 너머라 저역 쿵만 남고 구두 딱 소리는 거의 지워진다."""
    n = int(SR * 0.30)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 64.0 * t) * np.exp(-t / 0.030)          # 발뒤꿈치 하중
    body += np.sin(2 * np.pi * 97.0 * t + 1.1) * np.exp(-t / 0.020) * 0.5
    click = rng.standard_normal(n) * np.exp(-t / 0.010) * 0.55        # 바닥 재질
    x = body + click
    x = one_pole_lp(one_pole_lp(x, cutoff), cutoff)                   # 벽 2겹
    return soft_attack(x, 6.0) * gain


def corridor_steps(seed: int, n_steps: int, interval: float,
                   near_cut: float, far_cut: float, peak_gain: float) -> np.ndarray:
    """복도를 **지나가는** 발소리. 다가왔다 멀어진다 — 문 앞에서 멈추지 않는다."""
    rng = np.random.default_rng(seed)
    total = int(SR * (interval * n_steps + 0.9))
    buf = np.zeros(total)
    for i in range(n_steps):
        # 0→1→0 아치. 가까울수록 크고 밝다.
        u = i / max(n_steps - 1, 1)
        arc = np.sin(np.pi * u) ** 1.3
        cut = far_cut + (near_cut - far_cut) * arc
        g = peak_gain * (0.18 + 0.82 * arc)
        jitter = 1.0 + rng.uniform(-0.04, 0.04)     # 사람은 메트로놈이 아니다
        limp = 1.0 if i % 2 == 0 else 0.87          # 좌우 발 무게 차이
        s = one_step(rng, cut, g * limp)
        off = int(SR * interval * (i + jitter - 1) + SR * 0.45)
        off = max(off, 0)
        end = min(off + len(s), total)
        buf[off:end] += s[: end - off]

    tail = small_room_tail(rng, 0.40, 0.085)
    wet = np.convolve(buf, tail)[:total]
    out = buf + 0.30 * wet / (np.max(np.abs(wet)) + 1e-9) * (np.max(np.abs(buf)) + 1e-9)
    out = fade_edges(out, 25.0)
    return out / (np.max(np.abs(out)) + 1e-12) * 10 ** (-3.0 / 20.0)


def corridor_door(seed: int, closing: bool) -> np.ndarray:
    """먼 문 여닫힘 — 저역 '툭' + 걸쇠. 쾅이 아니다."""
    rng = np.random.default_rng(seed)
    n = int(SR * 1.5)
    t = np.arange(n) / SR
    x = np.zeros(n)

    if not closing:
        # 열림 — 경첩이 스르륵. 노이즈 스웰만.
        sw = int(SR * 0.35)
        ts = np.arange(sw) / SR
        hinge = rng.standard_normal(sw) * np.sin(np.pi * ts / (sw / SR)) ** 2
        x[: sw] += one_pole_lp(hinge, 900.0) * 0.35

    hit = int(SR * (0.55 if not closing else 0.12))
    m = n - hit
    tm = np.arange(m) / SR
    thud = np.sin(2 * np.pi * 58.0 * tm) * np.exp(-tm / 0.055)
    thud += np.sin(2 * np.pi * 86.0 * tm + 0.6) * np.exp(-tm / 0.035) * 0.45
    thud += rng.standard_normal(m) * np.exp(-tm / 0.014) * 0.4
    x[hit:] += thud * (1.0 if closing else 0.55)

    # 걸쇠 — 문틀에 물리는 짧은 소리
    latch = hit + int(SR * 0.075)
    if latch < n:
        ml = n - latch
        tl = np.arange(ml) / SR
        x[latch:] += (rng.standard_normal(ml) * np.exp(-tl / 0.006)) * 0.30

    x = one_pole_lp(one_pole_lp(x, 430.0), 430.0)   # 복도 → 벽 → 진료실
    tail = small_room_tail(rng, 0.45, 0.10)
    wet = np.convolve(x, tail)[:n]
    out = x + 0.28 * wet / (np.max(np.abs(wet)) + 1e-9) * (np.max(np.abs(x)) + 1e-9)
    out = fade_edges(soft_attack(out, 9.0), 20.0)
    return out / (np.max(np.abs(out)) + 1e-12) * 10 ** (-3.0 / 20.0)


# ────────────────────────────── 렌더 ──────────────────────────────

def report(name: str, x: np.ndarray, extra: str = "") -> None:
    mono = x[:, 0] if x.ndim > 1 else x
    rms = float(np.sqrt(np.mean(mono ** 2)))
    peak = float(np.max(np.abs(mono)))
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), 1 / SR)
    centroid = float((spec * freqs).sum() / (spec.sum() + 1e-9))
    print(f"  {name:20s} {len(mono)/SR:5.2f}s  RMS={db(rms):6.1f}dBFS  "
          f"peak={db(peak):5.1f}dBFS  중심={centroid:6.1f}Hz  {extra}")


def to_mp3(wav: Path, mp3: Path, bitrate: str) -> bool:
    if shutil.which("ffmpeg") is None:
        return False
    mp3.parent.mkdir(parents=True, exist_ok=True)
    # -write_xing 1: LAME 갭리스 헤더를 넣어 브라우저 디코더가 인코더 지연을 잘라낼 수 있게 한다
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
           "-c:a", "libmp3lame", "-b:a", bitrate, "-ar", str(SR),
           "-write_xing", "1", str(mp3)]
    return subprocess.run(cmd).returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav-only", action="store_true")
    args = ap.parse_args()

    WAV_OUT.mkdir(exist_ok=True)
    jobs: list[tuple[str, np.ndarray, str]] = []

    print("진료실 환경음 합성:")
    bed = build_room_tone()
    seam = loop_seam_pct(bed)
    report("room_tone", bed, f"이음매 백분위={seam:.1f}% (99% 미만이면 무결)")
    report_bands(bed)
    if seam >= 99.0:
        print("  ⚠️ 루프 경계 불연속이 크다 — 시간영역 필터가 섞였는지 확인할 것")
    jobs.append(("room_tone", bed, "128k"))

    # 지나가는 발소리 두 종 — 빠른 걸음(가깝게 지나감) / 느린 걸음(멀리)
    a = corridor_steps(seed=101, n_steps=9, interval=0.52, near_cut=760, far_cut=300, peak_gain=1.0)
    b = corridor_steps(seed=202, n_steps=7, interval=0.61, near_cut=560, far_cut=260, peak_gain=0.8)
    report("corridor_steps_a", a, "9걸음 · 보통 속도")
    report("corridor_steps_b", b, "7걸음 · 느린 걸음, 더 멀리")
    jobs += [("corridor_steps_a", a, "64k"), ("corridor_steps_b", b, "64k")]

    d1 = corridor_door(seed=303, closing=True)
    d2 = corridor_door(seed=404, closing=False)
    report("corridor_door_a", d1, "닫힘")
    report("corridor_door_b", d2, "열림 + 닫힘")
    jobs += [("corridor_door_a", d1, "64k"), ("corridor_door_b", d2, "64k")]

    print()
    for name, data, bitrate in jobs:
        wav = WAV_OUT / f"{name}.wav"
        sf.write(wav, data.astype(np.float32), SR)
        if args.wav_only:
            print(f"  wav  {wav}")
            continue
        mp3 = MP3_OUT / f"{name}.mp3"
        if to_mp3(wav, mp3, bitrate):
            print(f"  mp3  {mp3}  ({mp3.stat().st_size // 1024} KB)")
        else:
            print(f"  ⚠️ ffmpeg 없음 — wav만 생성: {wav}")

    print(f"\nwav: {WAV_OUT}\nmp3: {MP3_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
