"""Entrance-clip via Stable Video Diffusion img2vid (Apple Silicon, MPS).

SVD has NO text control: it only produces generic motion from a still. Used here
only to compare against LTX-Video for the "walk in and sit" entrance.

Env: PYTORCH_ENABLE_MPS_FALLBACK=1
"""
import os
import time

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video, load_image

_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = "stabilityai/stable-video-diffusion-img2vid-xt"

_PIPE = {}


def _get_pipe(model=DEFAULT_MODEL, device="mps"):
    if model in _PIPE:
        return _PIPE[model]
    dtype = torch.float16 if device == "mps" else torch.float32
    pipe = StableVideoDiffusionPipeline.from_pretrained(model, torch_dtype=dtype, variant="fp16")
    pipe.to(device)
    _PIPE[model] = pipe
    return pipe


def generate_walkin_svd(photo, out_mp4, num_frames=25, fps=8,
                        motion_bucket_id=180, noise_aug=0.1,
                        width=576, height=1024, device="mps", seed=0,
                        model=DEFAULT_MODEL):
    t0 = time.time()
    pipe = _get_pipe(model, device)
    image = load_image(photo).resize((width, height))
    gen = torch.Generator(device="cpu").manual_seed(seed)
    t_load = time.time()
    frames = pipe(image, decode_chunk_size=4, generator=gen,
                  motion_bucket_id=motion_bucket_id, noise_aug_strength=noise_aug,
                  num_frames=num_frames).frames[0]
    t_gen = time.time()
    export_to_video(frames, out_mp4, fps=fps)
    timings = {
        "device": device, "model": "svd-xt",
        "load_s": round(t_load - t0, 1), "gen_s": round(t_gen - t_load, 1),
        "total_s": round(time.time() - t0, 1),
        "num_frames": num_frames, "motion_bucket_id": motion_bucket_id,
    }
    print("TIMINGS:", timings)
    return timings


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--photo", default=os.path.join(_HERE, "samples", "input_full.png"))
    ap.add_argument("--out", default=os.path.join(_HERE, "samples", "walkin_svd.mp4"))
    ap.add_argument("--frames", type=int, default=25)
    ap.add_argument("--motion", type=int, default=180)
    ap.add_argument("--device", default="mps")
    a = ap.parse_args()
    generate_walkin_svd(a.photo, a.out, num_frames=a.frames,
                        motion_bucket_id=a.motion, device=a.device)
