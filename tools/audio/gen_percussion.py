"""임상 타진음 합성 — 모달 합성(타격 임펄스 → 감쇠 공명).

공개된 CC 라이선스 임상 타진음 데이터셋이 없어 물리 모델로 합성한다.
심음·폐음(HLS-CMDS)과 달리 타진은 공개 녹음이 사실상 없다.

물리: 타진음 = 타진판(중지)을 두드릴 때 그 아래 조직·공기강이 임펄스로 여기되어
      감쇠 공명하는 소리. 아래 공간이 공기면 저주파·긴 감쇠·음정 뚜렷(고창음),
      실질장기/액체면 고주파·짧은 감쇠·음정 불분명(탁음).

각 음 = (1) 손가락 타격 트랜지언트  + (2) 조직 공명 모드 합  + (3) 조직 저역 통과
실제 술기처럼 2회 연타로 렌더한다.
"""
import numpy as np
import soundfile as sf
from pathlib import Path

SR = 44100
OUT = Path(__file__).parent / "percussion_wav"
OUT.mkdir(exist_ok=True)

# 원형 막(membrane) 모드비 — 조화적이지 않아 '북' 같은 음색을 만든다
MEMBRANE = np.array([1.00, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50])
# 실질장기(둔탁) — 더 조밀하고 비조화적 → 음정이 잡히지 않는다
SOLID = np.array([1.00, 1.27, 1.71, 2.05, 2.43, 2.78, 3.21, 3.66, 4.10, 4.71])

# tau = e-folding 시간. 진폭이 0.1(-20dB)까지 떨어지는 데 걸리는 시간 T20 ≈ 2.303·tau.
# 임상 타진음의 실제 지속: 고창음 ~300ms / 공명음 ~200ms / 탁음 ~50ms / 편평음 ~30ms
PROFILES = {
    # 고창음 — 공기 찬 장. 저음·긴 감쇠·음정 뚜렷
    "tympany":        dict(f0=152, modes=MEMBRANE, tau=0.115, tilt=0.55, noise=0.16, lp=2600, label="고창음(장 위)"),
    # 공명음 — 정상 폐. 중간
    "resonance":      dict(f0=188, modes=MEMBRANE, tau=0.075, tilt=0.70, noise=0.24, lp=2200, label="공명음(정상 폐)"),
    # 과공명음 — 폐기종·기흉. 더 낮고 더 길게 울린다
    "hyperresonance": dict(f0=124, modes=MEMBRANE, tau=0.140, tilt=0.50, noise=0.14, lp=2900, label="과공명음"),
    # 탁음 — 간·비장·액체. 고음·아주 짧은 감쇠·음정 불분명
    "dullness":       dict(f0=332, modes=SOLID,    tau=0.022, tilt=1.15, noise=0.52, lp=1500, label="탁음(간·실질장기)"),
    # 편평음 — 근육·뼈. 가장 둔하고 짧다
    "flatness":       dict(f0=455, modes=SOLID,    tau=0.012, tilt=1.35, noise=0.66, lp=1200, label="편평음(근육·뼈)"),
}


def one_pole_lp(x, fc, sr=SR):
    """1차 저역통과 — 조직을 통과하며 고역이 깎이는 것을 모사."""
    a = np.exp(-2.0 * np.pi * fc / sr)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1.0 - a) * v + a * acc
        y[i] = acc
    return y


def dc_block(x, r=0.995):
    y = np.empty_like(x)
    xp = yp = 0.0
    for i, v in enumerate(x):
        yp = v - xp + r * yp
        xp = v
        y[i] = yp
    return y


def one_hit(p, dur=0.45, seed=0, gain=1.0):
    """타격 1회 — 트랜지언트 + 모드 합."""
    rng = np.random.default_rng(seed)
    n = int(SR * dur)
    t = np.arange(n) / SR
    out = np.zeros(n)

    # (1) 타격 트랜지언트 — 손가락이 손가락을 때리는 딱 소리 (수 ms)
    tr_len = int(SR * 0.006)
    tr = rng.standard_normal(tr_len) * np.exp(-np.linspace(0, 7, tr_len))
    tr = tr - one_pole_lp(tr, 900)          # 고역만 남겨 '딱' 성분
    out[:tr_len] += tr * p["noise"] * 1.1

    # (2) 조직 공명 모드 — 고차 모드일수록 빨리 감쇠(물리적으로 옳다)
    for k, ratio in enumerate(p["modes"]):
        f = p["f0"] * ratio
        if f > SR * 0.45:
            break
        amp = 1.0 / (1.0 + k) ** p["tilt"]
        tau_k = p["tau"] / (1.0 + 0.55 * k)
        phase = rng.uniform(0, 2 * np.pi)
        out += amp * np.exp(-t / tau_k) * np.sin(2 * np.pi * f * t + phase)

    # (3) 조직 저역통과 + DC 제거
    out = one_pole_lp(out, p["lp"])
    out = dc_block(out)

    # 살짝 포화 — 디지털 사인 합의 밋밋함을 줄인다
    out = np.tanh(out * 1.25) / 1.25
    return out * gain


def render(name, p):
    """실제 술기대로 2회 연타 (두 번째가 약간 약하고 음색도 미세하게 다르다)."""
    gap = int(SR * 0.185)
    h1 = one_hit(p, seed=11, gain=1.00)
    h2 = one_hit(p, seed=29, gain=0.82)
    n = gap + len(h2)
    buf = np.zeros(n)
    buf[: len(h1)] += h1
    buf[gap : gap + len(h2)] += h2

    # 끝단 페이드로 클릭 방지
    fade = int(SR * 0.01)
    buf[-fade:] *= np.linspace(1, 0, fade)

    peak = np.max(np.abs(buf))
    if peak > 0:
        buf = buf / peak * 0.89

    path = OUT / f"{name}.wav"
    sf.write(path, buf.astype(np.float32), SR)

    # 특성 측정 — 합성이 의도대로 됐는지 수치로 확인
    seg = h1 / (np.max(np.abs(h1)) + 1e-9)
    env = np.abs(seg)
    # -20dB 감쇠 시간(T20)
    idx = np.where(env > 0.1)[0]
    t20 = idx[-1] / SR if len(idx) else 0.0
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    freqs = np.fft.rfftfreq(len(seg), 1 / SR)
    centroid = float((spec * freqs).sum() / (spec.sum() + 1e-9))
    peak_f = float(freqs[int(np.argmax(spec))])
    print(f"  {name:16s} {p['label']:18s} 최대주파수={peak_f:6.1f}Hz  중심={centroid:6.1f}Hz  T20={t20*1000:5.1f}ms  {len(buf)/SR:.2f}s")
    return path


print("타진음 합성 (모달 합성):")
for name, p in PROFILES.items():
    render(name, p)
print(f"\n출력: {OUT}")
