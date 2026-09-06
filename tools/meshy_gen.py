#!/usr/bin/env python3
"""Meshy AI로 환자 사진 → 3D 모델(GLB) 생성 (품질 테스트용).

사용:
  MESHY_API_KEY=... python3 meshy_gen.py image <사진경로> <출력.glb>
  MESHY_API_KEY=... python3 meshy_gen.py text "프롬프트" <출력.glb>

무료 티어로 동작. image-to-3d=30크레딧. 의존성 없음(urllib만).
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import sys
import time
import urllib.request
import urllib.error

API = "https://api.meshy.ai/openapi"
KEY = os.environ.get("MESHY_API_KEY", "")


def _req(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
        raise


def _data_uri(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{b64}"


def _poll(kind: str, task_id: str) -> dict:
    url = f"{API}/v1/{kind}/{task_id}"
    while True:
        st = _req("GET", url)
        status = st.get("status")
        prog = st.get("progress", 0)
        print(f"  [{kind}] {status} {prog}%", file=sys.stderr)
        if status in ("SUCCEEDED", "FAILED", "CANCELED"):
            return st
        time.sleep(5)


def _download(url: str, out: str) -> None:
    urllib.request.urlretrieve(url, out)
    print(f"saved -> {out} ({os.path.getsize(out)} bytes)")


def gen_image(image_path: str, out_glb: str) -> None:
    print("submitting image-to-3d...", file=sys.stderr)
    res = _req(
        "POST",
        f"{API}/v1/image-to-3d",
        {"image_url": _data_uri(image_path), "should_texture": True},
    )
    task_id = res.get("result") or res.get("id")
    print(f"task: {task_id}", file=sys.stderr)
    st = _poll("image-to-3d", task_id)
    if st["status"] != "SUCCEEDED":
        print(f"FAILED: {json.dumps(st)[:500]}", file=sys.stderr)
        sys.exit(1)
    print(f"credits: {st.get('consumed_credits')}", file=sys.stderr)
    _download(st["model_urls"]["glb"], out_glb)


def gen_text(prompt: str, out_glb: str) -> None:
    print("submitting text-to-3d preview...", file=sys.stderr)
    res = _req(
        "POST",
        f"{API}/v2/text-to-3d",
        {"mode": "preview", "prompt": prompt, "ai_model": "meshy-6",
         "target_formats": ["glb"], "pose_mode": "a-pose"},
    )
    pid = res.get("result") or res.get("id")
    st = _poll("text-to-3d", pid)
    if st["status"] != "SUCCEEDED":
        sys.exit(1)
    print("refining (textures)...", file=sys.stderr)
    res2 = _req("POST", f"{API}/v2/text-to-3d",
                {"mode": "refine", "preview_task_id": pid, "enable_pbr": True})
    rid = res2.get("result") or res2.get("id")
    st2 = _poll("text-to-3d", rid)
    if st2["status"] != "SUCCEEDED":
        sys.exit(1)
    _download(st2["model_urls"]["glb"], out_glb)


if __name__ == "__main__":
    if not KEY:
        print("MESHY_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(2)
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    cmd = sys.argv[1]
    if cmd == "image":
        gen_image(sys.argv[2], sys.argv[3])
    elif cmd == "text":
        gen_text(sys.argv[2], sys.argv[3])
    else:
        print("cmd must be 'image' or 'text'", file=sys.stderr)
        sys.exit(2)
