"""glTF/GLB 저수준 편집 툴킷.

Blender 왕복은 노드 이름·재질 그래프를 바꿔버려서 씬 코드가 노드명을 참조하는
이 프로젝트에는 위험하다. 그래서 JSON+BIN 을 직접 뜯어 필요한 것만 고친다.

제공:
  load(path)                 -> Doc            (GLB/GLTF 자동 판별, 매직바이트 기준)
  Doc.read_accessor(i)       -> np.ndarray
  Doc.add_accessor(arr, ...) -> int
  Doc.repack()                                (참조 안 되는 bufferView 제거 + 단일 버퍼로 병합)
  Doc.save_glb(path)                          (외부 리소스를 전부 내장한 GLB 로 저장)
"""
from __future__ import annotations

import base64
import json
import mimetypes
import struct
from pathlib import Path

import numpy as np

COMP = {  # componentType -> (numpy dtype, byte size)
    5120: (np.int8, 1),
    5121: (np.uint8, 1),
    5122: (np.int16, 2),
    5123: (np.uint16, 2),
    5125: (np.uint32, 4),
    5126: (np.float32, 4),
}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
GLB_JSON, GLB_BIN = 0x4E4F534A, 0x004E4942


def _pad4(n: int) -> int:
    return (4 - n % 4) % 4


class Doc:
    def __init__(self, gltf: dict, buffers: list[bytes], base: Path):
        self.g = gltf
        self.buffers = buffers          # buffer index -> bytes
        self.base = base                # 상대 uri 해석 기준 디렉터리

    # ── 읽기 ────────────────────────────────────────────────────────────────
    def view_bytes(self, vi: int) -> bytes:
        ov = getattr(self, "view_override", None)
        if ov and vi in ov:
            return ov[vi]
        v = self.g["bufferViews"][vi]
        off = v.get("byteOffset", 0)
        return self.buffers[v["buffer"]][off: off + v["byteLength"]]

    def override_view(self, vi: int, data: bytes):
        """bufferView 내용을 제자리에서 갈아끼운다 (인덱스 불변).
        새 bufferView 를 덧붙이면 옛 것이 고아로 남아 용량이 되레 늘어난다."""
        if not hasattr(self, "view_override"):
            self.view_override = {}
        self.view_override[vi] = data
        self.g["bufferViews"][vi]["byteLength"] = len(data)

    def read_accessor(self, ai: int) -> np.ndarray:
        a = self.g["accessors"][ai]
        assert "sparse" not in a, "sparse accessor 미지원"
        dt, csz = COMP[a["componentType"]]
        n = NCOMP[a["type"]]
        count = a["count"]
        if a.get("bufferView") is None:
            return np.zeros((count, n), dtype=dt)
        v = self.g["bufferViews"][a["bufferView"]]
        buf = self.buffers[v["buffer"]]
        base = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = v.get("byteStride") or (csz * n)
        if stride == csz * n:
            raw = buf[base: base + count * stride]
            arr = np.frombuffer(raw, dtype=dt, count=count * n).reshape(count, n)
        else:  # 인터리브드
            out = np.empty((count, n), dtype=dt)
            for i in range(count):
                s = base + i * stride
                out[i] = np.frombuffer(buf[s: s + csz * n], dtype=dt, count=n)
            arr = out
        return arr.copy()

    # ── 쓰기 ────────────────────────────────────────────────────────────────
    def add_accessor(self, arr: np.ndarray, type_: str, target: int | None = None,
                     normalized: bool = False, minmax: bool = False) -> int:
        """새 버퍼(마지막)를 만들어 붙이고 accessor 인덱스를 돌려준다."""
        arr = np.ascontiguousarray(arr)
        ctype = {np.dtype("int8"): 5120, np.dtype("uint8"): 5121, np.dtype("int16"): 5122,
                 np.dtype("uint16"): 5123, np.dtype("uint32"): 5125,
                 np.dtype("float32"): 5126}[arr.dtype]
        data = arr.tobytes()
        bi = len(self.buffers)
        self.buffers.append(data)
        self.g.setdefault("buffers", []).append({"byteLength": len(data)})
        self.g.setdefault("bufferViews", []).append(
            {"buffer": bi, "byteOffset": 0, "byteLength": len(data)}
            | ({"target": target} if target else {}))
        acc = {"bufferView": len(self.g["bufferViews"]) - 1,
               "componentType": ctype,
               "count": int(arr.shape[0]),
               "type": type_}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = [float(x) for x in arr.min(axis=0)]
            acc["max"] = [float(x) for x in arr.max(axis=0)]
        self.g.setdefault("accessors", []).append(acc)
        return len(self.g["accessors"]) - 1

    # ── 정리 ────────────────────────────────────────────────────────────────
    def gc_accessors(self):
        """아무도 안 쓰는 accessor 를 제거한다.

        이걸 안 하면 어트리뷰트를 교체했을 때 옛 accessor 가 살아남아
        옛 bufferView 까지 붙잡고 있어서 파일이 두 배로 부푼다."""
        live = set()
        for m in self.g.get("meshes", []):
            for p in m.get("primitives", []):
                live.update(p.get("attributes", {}).values())
                if p.get("indices") is not None:
                    live.add(p["indices"])
                for t in p.get("targets", []):
                    live.update(t.values())
        for s in self.g.get("skins", []):
            if s.get("inverseBindMatrices") is not None:
                live.add(s["inverseBindMatrices"])
        for an in self.g.get("animations", []):
            for s in an.get("samplers", []):
                live.add(s["input"])
                live.add(s["output"])

        old = self.g.get("accessors", [])
        remap, new = {}, []
        for i, a in enumerate(old):
            if i in live:
                remap[i] = len(new)
                new.append(a)
        if len(new) == len(old):
            return
        for m in self.g.get("meshes", []):
            for p in m.get("primitives", []):
                p["attributes"] = {k: remap[v] for k, v in p.get("attributes", {}).items()}
                if p.get("indices") is not None:
                    p["indices"] = remap[p["indices"]]
                p["targets"] = [{k: remap[v] for k, v in t.items()} for t in p.get("targets", [])] or p.get("targets")
                if not p.get("targets"):
                    p.pop("targets", None)
        for s in self.g.get("skins", []):
            if s.get("inverseBindMatrices") is not None:
                s["inverseBindMatrices"] = remap[s["inverseBindMatrices"]]
        for an in self.g.get("animations", []):
            for s in an.get("samplers", []):
                s["input"] = remap[s["input"]]
                s["output"] = remap[s["output"]]
        self.g["accessors"] = new

    def repack(self, gc: bool = True):
        """참조되는 bufferView 만 남겨 단일 버퍼로 재배치한다 (고아 데이터 제거).

        gc=False: accessor 정리를 건너뛴다. 아바타처럼 모프타깃·스킨이 얽혀 있어
        구조를 한 톨도 바꾸면 안 되는 자산에 쓴다."""
        if gc:
            self.gc_accessors()
        used = set()
        for a in self.g.get("accessors", []):
            if a.get("bufferView") is not None:
                used.add(a["bufferView"])
            sp = a.get("sparse")
            if sp:
                used.add(sp["indices"]["bufferView"])
                used.add(sp["values"]["bufferView"])
        for im in self.g.get("images", []):
            if im.get("bufferView") is not None:
                used.add(im["bufferView"])

        old = self.g.get("bufferViews", [])
        remap, blob, new_views = {}, bytearray(), []
        for vi in sorted(used):
            v = old[vi]
            data = self.view_bytes(vi)
            blob += b"\x00" * _pad4(len(blob))
            nv = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
            for k in ("byteStride", "target"):
                if k in v:
                    nv[k] = v[k]
            remap[vi] = len(new_views)
            new_views.append(nv)
            blob += data

        for a in self.g.get("accessors", []):
            if a.get("bufferView") is not None:
                a["bufferView"] = remap[a["bufferView"]]
            sp = a.get("sparse")
            if sp:
                sp["indices"]["bufferView"] = remap[sp["indices"]["bufferView"]]
                sp["values"]["bufferView"] = remap[sp["values"]["bufferView"]]
        for im in self.g.get("images", []):
            if im.get("bufferView") is not None:
                im["bufferView"] = remap[im["bufferView"]]

        self.g["bufferViews"] = new_views
        self.g["buffers"] = [{"byteLength": len(blob)}]
        self.buffers = [bytes(blob)]

    def image_bytes(self, i: int) -> tuple[bytes, str, str]:
        """images[i] 의 (바이트, mime, 이름) — 외부 uri / data uri / bufferView 다 처리."""
        im = self.g["images"][i]
        uri = im.get("uri")
        if uri and uri.startswith("data:"):
            head, b64 = uri.split(",", 1)
            return base64.b64decode(b64), head[5:].split(";")[0], im.get("name", f"img{i}")
        if uri:
            p = self.base / uri
            mime = im.get("mimeType") or mimetypes.guess_type(p.name)[0] or "image/png"
            return p.read_bytes(), mime, Path(uri).stem
        return (self.view_bytes(im["bufferView"]),
                im.get("mimeType", "image/png"),
                im.get("name", f"img{i}"))

    def set_image(self, i: int, data: bytes, mime: str):
        """images[i] 를 bufferView 내장으로 교체한다.
        이미 bufferView 로 내장돼 있으면 **제자리 교체** (인덱스 보존)."""
        im = self.g["images"][i]
        if im.get("bufferView") is not None:
            self.override_view(im["bufferView"], data)
            im["mimeType"] = mime
            return
        bi = len(self.buffers)
        self.buffers.append(data)
        self.g["buffers"].append({"byteLength": len(data)})
        self.g.setdefault("bufferViews", []).append(
            {"buffer": bi, "byteOffset": 0, "byteLength": len(data)})
        im.pop("uri", None)
        im["bufferView"] = len(self.g["bufferViews"]) - 1
        im["mimeType"] = mime

    def embed_images(self, replacements: dict[int, tuple[bytes, str]] | None = None):
        """모든 이미지를 bufferView 내장으로 만든다.

        replacements: {images 인덱스: (새 바이트, mime)} — WebP 재압축 등에 쓴다.
        이미 내장된 이미지도 replacements 에 있으면 교체한다 (재실행 가능).
        """
        for i, im in enumerate(list(self.g.get("images", []))):
            if replacements and i in replacements:
                self.set_image(i, *replacements[i])
            elif im.get("bufferView") is None:
                try:
                    self.set_image(i, *self.image_bytes(i)[:2])
                except (FileNotFoundError, OSError):
                    # 외부 uri 가 깨진 자산이 있다 (윈도우 절대경로가 그대로 박힘).
                    # 우리가 만든 문제가 아니고 고칠 데이터도 없으니 그대로 둔다.
                    pass

    def repack_preserve(self):
        """bufferView **인덱스와 순서를 그대로 두고** 단일 버퍼로 재배치한다.

        왜 이게 필요한가:
          repack() 은 참조되는 bufferView 만 골라 인덱스를 재매핑한다. 그런데
          bufferView 를 가리키는 곳은 accessor/image 만이 아니다 —
          KHR_draco_mesh_compression 은 확장 안에서 bufferView 를 직접 가리키고,
          EXT_meshopt_compression 등도 마찬가지다. 그런 참조를 모르는 채 재매핑하면
          **지오메트리가 엉뚱한 버퍼를 가리키게 되어 파일이 조용히 깨진다.**
          (실제로 Draco 아바타에서 160 -> 150 으로 줄며 깨졌다)

        이미지만 교체하는 작업에서는 인덱스를 아예 안 건드리는 편이 안전하다.
        """
        blob = bytearray()
        new_views = []
        for i, v in enumerate(self.g.get("bufferViews", [])):
            data = self.view_bytes(i)
            blob += b"\x00" * _pad4(len(blob))
            nv = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
            for k in ("byteStride", "target"):
                if k in v:
                    nv[k] = v[k]
            new_views.append(nv)
            blob += data
        self.g["bufferViews"] = new_views
        self.g["buffers"] = [{"byteLength": len(blob)}]
        self.buffers = [bytes(blob)]

    def save_glb(self, path: Path, gc: bool = True, preserve_views: bool = False):
        """항상 GLB(바이너리)로 저장한다. 확장자가 .gltf 여도 상관없다 —
        three.js GLTFLoader 는 확장자가 아니라 매직바이트로 판별한다.

        preserve_views=True: bufferView 인덱스를 보존한다. Draco/meshopt 처럼
        확장이 bufferView 를 직접 참조하는 자산에 반드시 써라."""
        if preserve_views:
            self.repack_preserve()
        else:
            self.repack(gc=gc)
        blob = self.buffers[0] if self.buffers else b""
        js = json.dumps(self.g, separators=(",", ":")).encode("utf-8")
        js += b" " * _pad4(len(js))
        blob = bytes(blob) + b"\x00" * _pad4(len(blob))
        total = 12 + 8 + len(js) + (8 + len(blob) if blob else 0)
        out = bytearray()
        out += struct.pack("<III", 0x46546C67, 2, total)
        out += struct.pack("<II", len(js), GLB_JSON) + js
        if blob:
            out += struct.pack("<II", len(blob), GLB_BIN) + blob
        Path(path).write_bytes(bytes(out))


def load(path: str | Path) -> Doc:
    path = Path(path)
    raw = path.read_bytes()
    if raw[:4] == b"glTF":
        _, _, total = struct.unpack("<III", raw[:12])
        off, js, binc = 12, None, None
        while off < total:
            clen, ctype = struct.unpack("<II", raw[off:off + 8])
            body = raw[off + 8: off + 8 + clen]
            if ctype == GLB_JSON:
                js = json.loads(body.decode("utf-8"))
            elif ctype == GLB_BIN:
                binc = bytes(body)
            off += 8 + clen + _pad4(clen)
        g = js
        buffers = []
        for b in g.get("buffers", []):
            u = b.get("uri")
            if u is None:
                buffers.append(binc or b"")
            elif u.startswith("data:"):
                buffers.append(base64.b64decode(u.split(",", 1)[1]))
            else:
                buffers.append((path.parent / u).read_bytes())
        return Doc(g, buffers, path.parent)

    g = json.loads(raw.decode("utf-8"))
    buffers = []
    for b in g.get("buffers", []):
        u = b["uri"]
        if u.startswith("data:"):
            buffers.append(base64.b64decode(u.split(",", 1)[1]))
        else:
            buffers.append((path.parent / u).read_bytes())
    return Doc(g, buffers, path.parent)


def tri_count(doc: Doc) -> int:
    n = 0
    for m in doc.g.get("meshes", []):
        for p in m.get("primitives", []):
            if p.get("mode", 4) != 4:
                continue
            if p.get("indices") is not None:
                n += doc.g["accessors"][p["indices"]]["count"] // 3
            else:
                n += doc.g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    return n
