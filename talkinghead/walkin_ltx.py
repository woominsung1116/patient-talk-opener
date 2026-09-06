"""Entrance-clip generation via LTX-Video image-to-video (Apple Silicon, MPS).

generate_walkin(photo, out_mp4, prompt) -> dict timings

One-time / offline use: produce a short clip of the patient walking in and
sitting. Latency of minutes is acceptable (only 4 patients, cached).

Env: PYTORCH_ENABLE_MPS_FALLBACK=1
"""
import os
import time

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch
from diffusers import LTXImageToVideoPipeline
from diffusers.utils import export_to_video, load_image

_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = "Lightricks/LTX-Video"

DEFAULT_PROMPT = (
    "a young woman in gray scrubs walks forward toward the camera and sits down "
    "on a chair, full body, photorealistic, clean studio background, steady camera"
)
DEFAULT_NEG = "blurry, distorted, deformed, morphing, extra limbs, melting, low quality, jitter"

_PIPE = {}


def _get_pipe(model=DEFAULT_MODEL, device="mps", offload=True):
    if model in _PIPE:
        return _PIPE[model]
    dtype = torch.bfloat16 if device == "mps" else torch.float32
    pipe = LTXImageToVideoPipeline.from_pretrained(model, torch_dtype=dtype)
    # T5-XXL text encoder (~19GB) + transformer (~7.7GB) do not both fit in 24GB.
    # Keep components on CPU and stream the active one to MPS.
    if offload and device == "mps":
        try:
            pipe.enable_sequential_cpu_offload()
        except Exception:
            pipe.to(device)
    else:
        pipe.to(device)
    pipe.vae.enable_tiling()
    _PIPE[model] = pipe
    return pipe


def generate_walkin(photo, out_mp4, prompt=DEFAULT_PROMPT,
                    negative_prompt=DEFAULT_NEG,
                    num_frames=97, fps=24, width=512, height=768,
                    steps=40, device="mps", seed=0, model=DEFAULT_MODEL):
    t0 = time.time()
    pipe = _get_pipe(model, device)
    image = load_image(photo)
    # LTX wants dims divisible by 32; height/width are user-tuned for portrait
    gen = torch.Generator(device="cpu").manual_seed(seed)
    t_load = time.time()
    video = pipe(
        image=image,
        prompt=prompt,
        negative_prompt=negative_prompt,
        width=width, height=height,
        num_frames=num_frames,
        num_inference_steps=steps,
        generator=gen,
    ).frames[0]
    t_gen = time.time()
    export_to_video(video, out_mp4, fps=fps)
    timings = {
        "device": device, "model": model,
        "load_s": round(t_load - t0, 1),
        "gen_s": round(t_gen - t_load, 1),
        "total_s": round(time.time() - t0, 1),
        "num_frames": num_frames, "size": (width, height), "steps": steps,
    }
    print("TIMINGS:", timings)
    return timings


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--photo", default=os.path.join(_HERE, "samples", "input_full.png"))
    ap.add_argument("--out", default=os.path.join(_HERE, "samples", "walkin_ltx.mp4"))
    ap.add_argument("--prompt", default=DEFAULT_PROMPT)
    ap.add_argument("--frames", type=int, default=97)
    ap.add_argument("--steps", type=int, default=40)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=768)
    ap.add_argument("--device", default="mps")
    a = ap.parse_args()
    generate_walkin(a.photo, a.out, prompt=a.prompt, num_frames=a.frames,
                    steps=a.steps, width=a.width, height=a.height, device=a.device)
