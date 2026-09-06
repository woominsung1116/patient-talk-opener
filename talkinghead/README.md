# talkinghead — local audio-driven talking head (Apple Silicon, MPS)

Takes a portrait PNG + a speech WAV and produces an MP4 where the person's mouth
lip-syncs to the audio. Runs fully local on this Mac (Apple M-series, MPS/CPU,
**no CUDA**).

**Shipping model: Wav2Lip (GAN) + GFPGAN face restoration.**
Wav2Lip gives accurate lip-sync; GFPGAN fixes Wav2Lip's known blurry-mouth
problem and makes the mouth photoreal. See `REPORT` section at the bottom for the
model comparison and latency/quality evidence.

---

## 1. Setup (uv)

Everything is managed with `uv`. The main env is `.venv` (Python 3.11).

```bash
cd talkinghead

# create env + install deps (already done if .venv exists)
uv venv --python 3.11 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

If you want exact reproducibility use the lockfile instead:

```bash
uv pip install -r requirements.lock.txt
```

### Required patches
> **git 체크아웃에서는** `Wav2Lip/`·`SadTalker/` 가 서브모듈이라 아래 2·3번 패치가 적용돼 있지 않다.
> `sh patches/apply.sh` 한 번 실행하면 `patches/wav2lip-local.patch` (패치 + `wav2lip_infer.py`) 가 적용된다.
> 서브모듈이 비어 있으면 먼저 `git submodule update --init` 을 실행한다.

These are baked into the cloned `Wav2Lip/` and the installed `basicsr` here. If
you recreate from scratch, re-apply:

1. **basicsr / torchvision** — `torchvision.transforms.functional_tensor` was
   removed in modern torchvision. Patch the import in
   `.venv/lib/python3.11/site-packages/basicsr/data/degradations.py`:
   ```
   - from torchvision.transforms.functional_tensor import rgb_to_grayscale
   + from torchvision.transforms.functional import rgb_to_grayscale
   ```
2. **Wav2Lip/audio.py** — librosa 0.10 needs keyword args:
   `librosa.filters.mel(sr=..., n_fft=..., ...)`.
3. **Wav2Lip face detector (S3FD)** — `sfd_detector.py`: add `import torch` and
   load with `torch.load(path, map_location=device, weights_only=False)`.
   `face_detection/detection/core.py`: allow `mps` as a valid device string.

### Models (already downloaded here)
| File | Path | Size |
|------|------|------|
| Wav2Lip GAN | `Wav2Lip/checkpoints/wav2lip_gan.pth` | 436 MB |
| S3FD face detector | `Wav2Lip/face_detection/detection/sfd/s3fd.pth` | 90 MB |
| GFPGAN v1.4 | `models_gfpgan/GFPGANv1.4.pth` | 349 MB |
| facexlib detect/parse | `gfpgan/weights/*.pth` | auto-downloaded on first run |

Re-download if missing:
```bash
curl -L -o Wav2Lip/checkpoints/wav2lip_gan.pth \
  https://huggingface.co/numz/wav2lip_studio/resolve/main/Wav2lip/wav2lip_gan.pth
curl -L -o Wav2Lip/face_detection/detection/sfd/s3fd.pth \
  https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth
curl -L -o models_gfpgan/GFPGANv1.4.pth \
  https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth
```

### ffmpeg
Required (mux + audio convert). Install: `brew install ffmpeg`.

---

## 2. Run

Always set `PYTORCH_ENABLE_MPS_FALLBACK=1` (some ops fall back to CPU).

### CLI
```bash
source .venv/bin/activate
export PYTORCH_ENABLE_MPS_FALLBACK=1

# photoreal (Wav2Lip + GFPGAN) — recommended
python generate.py --photo samples/input_face.png --audio samples/test.wav \
  --out samples/out.mp4

# fast, no enhancement (blurrier mouth, realtime-ish)
python generate.py --photo samples/input_face.png --audio samples/test.wav \
  --out samples/out_fast.mp4 --no-enhance
```

### Python API
```python
from generate import generate          # lazy singleton, reuses warm models
generate("samples/input_face.png", "samples/test.wav", "out.mp4")               # enhanced
generate("samples/input_face.png", "samples/test.wav", "out_fast.mp4", enhance=False)

# or hold an explicit warm handle (best for a server):
from generate import TalkingHead
head = TalkingHead(enhance=True)        # loads models once
head.generate("photo.png", "speech.wav", "out.mp4")
```

### Generate a Korean test WAV
```bash
./make_test_audio.sh "안녕하세요, 어디가 불편하세요?" samples/test.wav
```

---

## 3. Input requirements (important)

- **Use a face-dominant crop.** The game's `young_female.png` is a full-body
  shot where the face is only ~70px wide. Lip-sync still works, but for sharp
  photoreal output give the generator a portrait where the face fills most of the
  frame. `samples/input_face.png` is such a crop (made from the raw photo):
  ```bash
  ffmpeg -y -i frontend/public/patients/young_female_raw.png \
    -vf "crop=iw:ih*0.28:0:0,scale=512:-2" samples/input_face.png
  ```
  In production, store a pre-cropped head/shoulders portrait per patient and
  composite the talking head back over the full body if needed.
- A clear, frontal face must be detectable. Side profiles fail.
- Audio: any wav (auto-resampled to 16k mono). Non-wav is auto-converted by ffmpeg.

---

## 4. FastAPI integration

See `server_example.py`. Essentials:
- Load `TalkingHead(enhance=True)` **once** at startup (~1s warm after first
  download). Do not reload per request.
- **MPS is not safe for concurrent inference.** Serialize generate() behind a
  `threading.Lock` (or run a single worker). One clip at a time.
- generate() blocks; call it in a threadpool so the event loop stays free.
- Pre-generate clips when possible (patient lines are known in advance) and cache
  the mp4s; live generation is only needed for dynamic dialogue.

---

## 5. Files
- `generate.py` — main module. `generate()` + `TalkingHead` class.
- `Wav2Lip/wav2lip_infer.py` — standalone Wav2Lip-only driver (no enhancer).
- `server_example.py` — FastAPI example.
- `make_test_audio.sh` — Korean TTS test wav helper.
- `requirements.txt` / `requirements.lock.txt` — deps.
- `samples/` — input + output mp4s for each model tried.

---

## 6. REPORT — model comparison

Test machine: Apple M5 Pro, 24 GB, macOS, torch 2.8.0, MPS available, no CUDA.
Test input: `samples/input_face.png` (512x368 face crop), `samples/test.wav`
(6.16 s Korean TTS, 156 frames @ 25 fps).

### Wav2Lip + GFPGAN  ✅ SHIP THIS
- **Install on this Mac:** success. uv + torch 2.8.0 on MPS. Needed 3 small
  patches (librosa kwargs, S3FD `torch.load` weights_only/device, basicsr
  functional_tensor import). All documented above and applied.
- **Latency (warm, 6.16 s / 156-frame clip):**
  - Enhanced: **36.7 s total** (face detect 0.34s, Wav2Lip 0.74s,
    GFPGAN 35.2s = ~0.22 s/frame, mux 0.11s). ≈ 30 s for a 5 s clip.
  - No-enhance: **1.3 s total** (faster than realtime).
  - Cold start adds a one-time ~70 s download of facexlib weights; model load is
    ~0.4 s after that.
- **Quality:**
  - Lip-sync accuracy: good. Mouth opens/closes in time with the Korean speech.
  - Mouth sharpness: **without GFPGAN the mouth is visibly soft/blurry with a
    faint box seam** (classic Wav2Lip). **With GFPGAN the mouth is sharp** —
    distinct lips, teeth, and tongue, clean skin texture, no seam. Photoreal.
  - Head motion / blink: **none.** Only the mouth moves; the rest of the face is
    the static portrait. This is the main limitation.
- **Peak RAM:** ~3-4 GB resident (Wav2Lip 436MB + GFPGAN 349MB + facexlib +
  torch/MPS buffers). Comfortable within 24 GB.
- Samples: `samples/wav2lip_gfpgan.mp4` (enhanced, ship), `samples/wav2lip_only.mp4`
  (no enhancer, for comparison), `samples/wav2lip_face.mp4` (early face-crop run),
  `samples/wav2lip_full.mp4` (run on the full-body image — proves detection finds
  the small face, but the mouth is tiny on screen).

### SadTalker  ❌ NOT VIABLE on this Mac
SadTalker adds head pose + blink + expression (audio-driven), which Wav2Lip
lacks. Installed in a separate `.venv_sadtalker` (Python 3.10, its pinned deps:
numpy 1.23.5, librosa 0.9.2, scipy 1.10.1, kornia, etc.). Patches needed:
basicsr `functional_tensor` import (same as GFPGAN) + `setuptools<81` for
librosa 0.9.2's `pkg_resources`.
- **Install:** success. Checkpoints (~1.6 GB: 256 safetensors + mapping models)
  downloaded.
- **Run (CPU):** preprocessing pipeline all succeeded — 3DMM extraction,
  landmark detection, audio2exp. **But the Face Renderer (face-vid2vid) runs at
  ~17 s PER iteration on CPU; an 80-iteration render = ~22 minutes** for one 6 s
  clip. SadTalker's `inference.py` only supports `cuda`/`cpu` — there is **no
  MPS path**; forcing MPS requires `.to()` patches across every model module.
  Not pursued (instruction: don't sink hours into flaky CUDA-centric paths).
- **Verdict:** impractical on this Mac. No final mp4 produced (killed during the
  22-min CPU render). Even if completed, SadTalker's 256/512 renderer yields a
  softer face than Wav2Lip+GFPGAN. Wav2Lip+GFPGAN already meets the bar at ~30 s
  vs ~22 min. Revisit only on CUDA.

### MuseTalk / LatentSync  — not pursued
Both are CUDA-centric (custom ops, fp16 paths) and would need significant porting
for MPS. Not worth the hours given a working photoreal result. Revisit only if a
CUDA box becomes available, where MuseTalk offers realtime high-res lip-sync.

### Recommendation
Ship **Wav2Lip + GFPGAN** on a **face-dominant portrait crop**.
- For pre-generated patient lines: use `enhance=True` (photoreal, ~30 s/5 s clip).
- For live/low-latency: use `enhance=False` (realtime) or pre-generate and cache.
- Keep the model warm in memory (FastAPI singleton + lock). Do not run concurrent
  MPS inference.
- If head motion/blink becomes a hard requirement, add subtle idle head/blink
  motion as a video loop and run Wav2Lip on the moving frames, or revisit
  SadTalker/MuseTalk on CUDA.

---

## 7. Entrance clip ("patient walks in and sits down")

One-time, offline, cached per patient (only 4 patients). The final seated frame
becomes the lip-sync source. Tested on this Mac:

### Cinematic fallback (ffmpeg) ✅ SHIP THIS
`walkin_cinematic.py` — no ML, no downloads, deterministic, photoreal, zero
identity drift. Slow push-in on the standing photo, then a cross-dissolve to the
centered seated framing (`samples/seated_source.png`) which is the lip-sync
source. **0.5 s to render**, 4 s @ 512x768.
```bash
source .venv/bin/activate
python walkin_cinematic.py --standing samples/input_full.png \
  --seated samples/seated_source.png --out samples/walkin_cinematic.mp4 --seconds 4
```
Sample: `samples/walkin_cinematic.mp4`. This is a deliberate cinematic intro
(push-in -> she "settles" into the seated frame). It does NOT show literal leg
motion, but it reads as an entrance, never melts, and hands off cleanly to the
talking head. **Recommended for shipping.**

### LTX-Video / SVD (local I2V) — BLOCKED by download bandwidth on this machine
`walkin_ltx.py` (LTXImageToVideoPipeline) and `walkin_svd.py`
(StableVideoDiffusionPipeline) are written, import cleanly, and are configured
for MPS with `enable_sequential_cpu_offload` (required: T5-XXL ~19GB +
transformer ~7.7GB do not both fit in 24GB).

**They could not be benchmarked in-session because the model weights cannot be
downloaded in a reasonable time here.** Measured link speed from HF CDN was
~1.7 MB/s (GitHub ~0.85 MB/s). The `Lightricks/LTX-Video` repo that
`from_pretrained` pulls is ~28 GB (transformer 7.7 GB + T5-XXL text encoder
~19 GB + VAE 1.7 GB) -> **~5 hours just to download**. SVD-XT (~9.5 GB) is
~1.5 h. CogVideoX-5B / Wan2.1-I2V are larger still.

Also note: the HF **Xet** transfer backend hangs on this machine
("Fetching N files 0%" with no progress). You MUST set `HF_HUB_DISABLE_XET=1`
to download at all.

To run them later on a faster connection (weights pre-cached):
```bash
source .venv_i2v/bin/activate
export PYTORCH_ENABLE_MPS_FALLBACK=1 HF_HUB_DISABLE_XET=1
python walkin_ltx.py --photo samples/input_full.png --out samples/walkin_ltx.mp4 \
  --frames 49 --steps 30 --width 512 --height 768
```

### Honest expectation for AI I2V on "walk in and sit"
Directed full-body locomotion ("walk forward and sit") from a single still is at
the hard edge even for SOTA I2V. On a 24 GB MPS Mac with CPU offload the most
likely outcomes are (a) subtle camera drift / breathing rather than real walking,
or (b) limb morphing on a full-body figure. Given that risk plus the download
wall, the **cinematic ffmpeg entrance is the reliable choice** for the game.
Revisit LTX/SVD only on a CUDA box or after pre-downloading weights, and verify
the sample before trusting it.

### `generate_walkin`
- `walkin_cinematic.generate_walkin_cinematic(standing, seated, out, ...)` — works now.
- `walkin_ltx.generate_walkin(photo, out_mp4, prompt)` — ready, needs weights.
- `walkin_svd.generate_walkin_svd(photo, out_mp4)` — ready, needs weights.
