"""Cinematic entrance fallback (ffmpeg only, no ML, guaranteed photoreal).

When local I2V models (LTX / SVD) are unavailable or too slow to download/run,
this produces a usable game entrance from the existing patient photos with ZERO
identity drift: a slow push-in (Ken Burns) on the standing patient, then a
cross-dissolve to the seated framing that becomes the lip-sync source.

generate_walkin_cinematic(standing_png, seated_png, out_mp4, ...) -> dict

This is deterministic, fast (<1s), and looks like a deliberate cinematic intro
rather than a melting AI hallucination.
"""
import os
import subprocess
import time

_HERE = os.path.dirname(os.path.abspath(__file__))


def generate_walkin_cinematic(standing_png, seated_png, out_mp4,
                              total_s=4.0, fps=25, width=512, height=768,
                              zoom_to=1.18, hold_seated_s=0.8):
    """Push-in on the standing photo, dissolve to the seated framing.

    standing_png : full-body standing portrait (entrance).
    seated_png   : seated/closer framing (the final lip-sync source look).
    """
    t0 = time.time()
    push_s = total_s - hold_seated_s
    push_frames = int(push_s * fps)
    seated_frames = int(hold_seated_s * fps)
    xfade_s = 0.6

    # Stage 1: standing photo, slow zoompan push-in (Ken Burns).
    standing_clip = os.path.join(_HERE, "temp", "_standing.mp4")
    seated_clip = os.path.join(_HERE, "temp", "_seated.mp4")
    os.makedirs(os.path.join(_HERE, "temp"), exist_ok=True)

    # zoompan needs a large input to avoid jitter; scale up first.
    zexpr = "min(zoom+0.0010,{})".format(zoom_to)
    f1 = (
        "scale={w}*4:{h}*4,"
        "zoompan=z='{z}':d={d}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={fps},"
        "format=yuv420p"
    ).format(w=width, h=height, z=zexpr, d=push_frames, fps=fps)
    subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-i", standing_png,
        "-vf", f1, "-t", str(push_s), "-r", str(fps),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", standing_clip
    ], check=True, capture_output=True)

    # Stage 2: seated framing, gentle static hold (tiny breathing zoom).
    f2 = (
        "scale={w}*4:{h}*4,"
        "zoompan=z='min(zoom+0.0004,1.04)':d={d}:x='iw/2-(iw/zoom/2)':y='ih/2-(iw/zoom/2)':s={w}x{h}:fps={fps},"
        "format=yuv420p"
    ).format(w=width, h=height, d=seated_frames + int(xfade_s * fps), fps=fps)
    subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-i", seated_png,
        "-vf", f2, "-t", str(hold_seated_s + xfade_s), "-r", str(fps),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", seated_clip
    ], check=True, capture_output=True)

    # Cross-dissolve standing -> seated.
    offset = max(0.1, push_s - xfade_s)
    xfade = "xfade=transition=fade:duration={}:offset={}".format(xfade_s, offset)
    subprocess.run([
        "ffmpeg", "-y", "-i", standing_clip, "-i", seated_clip,
        "-filter_complex", "[0][1]" + xfade + ",format=yuv420p",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out_mp4
    ], check=True, capture_output=True)

    timings = {"method": "cinematic_ffmpeg", "total_s": round(time.time() - t0, 2),
               "duration_s": total_s, "out": out_mp4}
    print("TIMINGS:", timings)
    return timings


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--standing", default=os.path.join(_HERE, "samples", "input_full.png"))
    ap.add_argument("--seated", default=os.path.join(_HERE, "samples", "input_face.png"))
    ap.add_argument("--out", default=os.path.join(_HERE, "samples", "walkin_cinematic.mp4"))
    ap.add_argument("--seconds", type=float, default=4.0)
    a = ap.parse_args()
    generate_walkin_cinematic(a.standing, a.seated, a.out, total_s=a.seconds)
