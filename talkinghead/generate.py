"""Local audio-driven talking-head generation for Apple Silicon (MPS/CPU, no CUDA).

Pipeline:  portrait PNG + speech WAV  ->  lip-synced MP4
  1. Wav2Lip (GAN) generates mouth motion from audio at 96x96.
  2. GFPGAN restores the face per-frame to fix Wav2Lip's blurry mouth (photoreal).

Public API:
    from generate import generate
    generate(photo_path, wav_path, out_mp4_path)         # default: enhanced
    generate(photo_path, wav_path, out_mp4_path, enhance=False)

CLI:
    python generate.py --photo in.png --audio in.wav --out out.mp4
    python generate.py --photo in.png --audio in.wav --out out.mp4 --no-enhance

Models are cached in module-level globals so a long-running server (FastAPI)
loads them once and reuses them (see TalkingHead class for an explicit warm
handle).

Environment: set PYTORCH_ENABLE_MPS_FALLBACK=1 before running so ops MPS lacks
fall back to CPU.
"""
import os
import sys
import time
import subprocess
import platform

import numpy as np
import cv2
import torch

_HERE = os.path.dirname(os.path.abspath(__file__))
_WAV2LIP_DIR = os.path.join(_HERE, "Wav2Lip")
if _WAV2LIP_DIR not in sys.path:
    sys.path.insert(0, _WAV2LIP_DIR)

# ensure MPS fallback even if caller forgot
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import audio as w2l_audio  # noqa: E402
import face_detection  # noqa: E402
from models import Wav2Lip  # noqa: E402

IMG_SIZE = 96
MEL_STEP_SIZE = 16
DEFAULT_W2L_CKPT = os.path.join(_WAV2LIP_DIR, "checkpoints", "wav2lip_gan.pth")
DEFAULT_GFPGAN_CKPT = os.path.join(_HERE, "models_gfpgan", "GFPGANv1.4.pth")


def get_device(prefer="mps"):
    if prefer == "cpu":
        return "cpu"
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


# --------------------------------------------------------------------------- #
# Wav2Lip helpers
# --------------------------------------------------------------------------- #
def _load_w2l(checkpoint_path, device):
    model = Wav2Lip()
    ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
    s = ckpt["state_dict"]
    model.load_state_dict({k.replace("module.", ""): v for k, v in s.items()})
    return model.to(device).eval()


def _smooth_boxes(boxes, T=5):
    for i in range(len(boxes)):
        window = boxes[len(boxes) - T:] if i + T > len(boxes) else boxes[i:i + T]
        boxes[i] = np.mean(window, axis=0)
    return boxes


def _face_detect(images, detector, pads, nosmooth, batch_size):
    preds = []
    bs = batch_size
    while True:
        preds = []
        try:
            for i in range(0, len(images), bs):
                preds.extend(detector.get_detections_for_batch(np.array(images[i:i + bs])))
            break
        except RuntimeError:
            if bs == 1:
                raise
            bs //= 2
    results = []
    pady1, pady2, padx1, padx2 = pads
    for rect, image in zip(preds, images):
        if rect is None:
            raise ValueError("Face not detected in the portrait. Use a clearer face crop.")
        y1 = max(0, rect[1] - pady1)
        y2 = min(image.shape[0], rect[3] + pady2)
        x1 = max(0, rect[0] - padx1)
        x2 = min(image.shape[1], rect[2] + padx2)
        results.append([x1, y1, x2, y2])
    boxes = np.array(results)
    if not nosmooth:
        boxes = _smooth_boxes(boxes)
    return [[image[y1:y2, x1:x2], (y1, y2, x1, x2)]
            for image, (x1, y1, x2, y2) in zip(images, boxes)]


def _prep_batch(img_batch, mel_batch):
    img = np.asarray(img_batch)
    mel = np.asarray(mel_batch)
    masked = img.copy()
    masked[:, IMG_SIZE // 2:] = 0
    img = np.concatenate((masked, img), axis=3) / 255.0
    mel = np.reshape(mel, [len(mel), mel.shape[1], mel.shape[2], 1])
    return img, mel


# --------------------------------------------------------------------------- #
# Warm, reusable handle
# --------------------------------------------------------------------------- #
class TalkingHead:
    """Holds the loaded models so a server can keep them warm in memory."""

    def __init__(self, device=None, w2l_ckpt=DEFAULT_W2L_CKPT,
                 gfpgan_ckpt=DEFAULT_GFPGAN_CKPT, enhance=True):
        self.device = device or get_device()
        self.enhance_enabled = enhance
        self.w2l = _load_w2l(w2l_ckpt, self.device)
        # S3FD face detector runs on CPU: cheap for a single static portrait,
        # avoids MPS edge cases in the detection net.
        self.detector = face_detection.FaceAlignment(
            face_detection.LandmarksType._2D, flip_input=False, device="cpu"
        )
        self.restorer = None
        if enhance:
            self.restorer = self._load_gfpgan(gfpgan_ckpt)

    def _load_gfpgan(self, ckpt):
        from gfpgan import GFPGANer
        return GFPGANer(model_path=ckpt, upscale=1, arch="clean",
                        channel_multiplier=2, device=self.device)

    # ----------------------------------------------------------------- #
    def generate(self, photo_path, wav_path, out_path,
                 fps=25.0, pads=(0, 10, 0, 0),
                 wav2lip_batch_size=64, enhance=None, verbose=True):
        if enhance is None:
            enhance = self.enhance_enabled
        if enhance and self.restorer is None:
            self.restorer = self._load_gfpgan(DEFAULT_GFPGAN_CKPT)

        t0 = time.time()
        timings = {"device": self.device, "enhance": enhance}
        os.makedirs(os.path.join(_HERE, "temp"), exist_ok=True)

        # ---- read portrait ----
        is_img = photo_path.lower().rsplit(".", 1)[-1] in ("jpg", "jpeg", "png")
        if not is_img:
            raise ValueError("photo_path must be a still image (png/jpg).")
        base_frame = cv2.imread(photo_path)
        if base_frame is None:
            raise ValueError("Could not read photo: " + photo_path)

        # ---- audio -> mel ----
        if not wav_path.endswith(".wav"):
            tmp_wav = os.path.join(_HERE, "temp", "audio.wav")
            subprocess.call('ffmpeg -y -i "{}" -ar 16000 -ac 1 "{}"'.format(wav_path, tmp_wav),
                            shell=True)
            wav_path = tmp_wav
        wav = w2l_audio.load_wav(wav_path, 16000)
        mel = w2l_audio.melspectrogram(wav)
        if np.isnan(mel.reshape(-1)).sum() > 0:
            raise ValueError("Mel contains nan (TTS artifact). Add epsilon noise to wav.")

        mel_chunks = []
        step = 80.0 / fps
        i = 0
        while True:
            start = int(i * step)
            if start + MEL_STEP_SIZE > len(mel[0]):
                mel_chunks.append(mel[:, len(mel[0]) - MEL_STEP_SIZE:])
                break
            mel_chunks.append(mel[:, start:start + MEL_STEP_SIZE])
            i += 1
        n = len(mel_chunks)

        # ---- detect face once (static portrait) ----
        t = time.time()
        face_img, coords = _face_detect([base_frame], self.detector,
                                        pads, nosmooth=True, batch_size=1)[0]
        timings["face_detect_s"] = round(time.time() - t, 2)

        # ---- wav2lip inference ----
        t = time.time()
        frame_h, frame_w = base_frame.shape[:2]
        avi = os.path.join(_HERE, "temp", "result.avi")
        writer = cv2.VideoWriter(avi, cv2.VideoWriter_fourcc(*"DIVX"), fps, (frame_w, frame_h))
        y1, y2, x1, x2 = coords
        face_resized = cv2.resize(face_img, (IMG_SIZE, IMG_SIZE))

        enhance_s = 0.0
        idx = 0
        while idx < n:
            chunk = mel_chunks[idx: idx + wav2lip_batch_size]
            img_b, mel_b = _prep_batch([face_resized] * len(chunk), chunk)
            img_t = torch.FloatTensor(np.transpose(img_b, (0, 3, 1, 2))).to(self.device)
            mel_t = torch.FloatTensor(np.transpose(mel_b, (0, 3, 1, 2))).to(self.device)
            with torch.no_grad():
                pred = self.w2l(mel_t, img_t)
            pred = pred.cpu().numpy().transpose(0, 2, 3, 1) * 255.0
            for p in pred:
                f = base_frame.copy()
                p = cv2.resize(p.astype(np.uint8), (x2 - x1, y2 - y1))
                f[y1:y2, x1:x2] = p
                if enhance:
                    te = time.time()
                    _, _, f = self.restorer.enhance(
                        f, has_aligned=False, only_center_face=True, paste_back=True)
                    enhance_s += time.time() - te
                writer.write(f)
            idx += wav2lip_batch_size
        writer.release()
        timings["inference_s"] = round(time.time() - t - enhance_s, 2)
        timings["enhance_s"] = round(enhance_s, 2)

        # ---- mux audio ----
        t = time.time()
        cmd = 'ffmpeg -y -i "{}" -i "{}" -c:v libx264 -pix_fmt yuv420p -crf 17 -c:a aac "{}"'.format(
            avi, wav_path, out_path)
        subprocess.call(cmd, shell=platform.system() != "Windows")
        timings["mux_s"] = round(time.time() - t, 2)

        timings["n_frames"] = n
        timings["total_s"] = round(time.time() - t0, 2)
        if verbose:
            print("TIMINGS:", timings)
        return timings


# --------------------------------------------------------------------------- #
# Module-level convenience (lazy singleton)
# --------------------------------------------------------------------------- #
_SINGLETON = {}


def _get_singleton(device, enhance):
    key = (device, enhance)
    if key not in _SINGLETON:
        _SINGLETON[key] = TalkingHead(device=device, enhance=enhance)
    return _SINGLETON[key]


def generate(photo_path, wav_path, out_mp4_path, enhance=True, device=None,
             fps=25.0, wav2lip_batch_size=64, verbose=True):
    """Generate a lip-synced MP4. Reuses warm models across calls.

    Args:
        photo_path: portrait png/jpg with a clear frontal face.
        wav_path:   speech audio (wav preferred; other formats auto-converted).
        out_mp4_path: output mp4 path.
        enhance:    run GFPGAN face restoration (photoreal, slower). Default True.
        device:     'mps' | 'cpu' | None (auto).
    Returns: dict of timings.
    """
    th = _get_singleton(device or get_device(), enhance)
    return th.generate(photo_path, wav_path, out_mp4_path,
                       fps=fps, wav2lip_batch_size=wav2lip_batch_size,
                       enhance=enhance, verbose=verbose)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Local talking-head generator (Wav2Lip + GFPGAN, MPS)")
    ap.add_argument("--photo", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-enhance", action="store_true", help="skip GFPGAN (faster, blurrier mouth)")
    ap.add_argument("--device", default=None, choices=[None, "mps", "cpu"])
    ap.add_argument("--fps", type=float, default=25.0)
    a = ap.parse_args()
    generate(a.photo, a.audio, a.out, enhance=not a.no_enhance, device=a.device, fps=a.fps)
