#!/usr/bin/env python3
"""아바타 GLB 두 개가 **텍스처를 빼고 완전히 동일한지** 검증한다.

아바타는 지금까지 아무도 못 건드리게 해온 자산이다. 텍스처만 재인코딩했다고
주장하려면 나머지가 한 톨도 안 바뀌었음을 프로그램으로 보여야 한다.

대조 항목 (하나라도 다르면 실패):
  - 모프타깃: 프리미티브별 **개수·순서**, mesh.extras.targetNames 전체
  - 본: skins[].joints 가 가리키는 노드 이름 순서, inverseBindMatrices 바이트
  - 노드: 이름·부모관계·TRS
  - 재질/메시/프리미티브 이름과 개수
  - 정점/인덱스 데이터: POSITION·NORMAL·JOINTS·WEIGHTS·indices 의 **바이트 해시**
  - 모프타깃 accessor 데이터의 바이트 해시

사용: python verify_avatar_identity.py <before.glb> <after.glb>
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import gltf_kit as gk


def acc_hash(doc: gk.Doc, ai: int) -> str:
    """accessor 의 실제 데이터 해시.

    ⚠️ Draco 압축 자산에서는 정점 accessor 에 bufferView 가 **없다**(데이터가
    KHR_draco_mesh_compression 안에 있다). 그걸 모르고 메타데이터만 해시하면
    "지오메트리 동일 ✅" 이 아무것도 검사하지 않은 채 통과한다.
    실제로 그 함정에 빠져 깨진 파일이 검증을 통과했다. 그래서 데이터가 없으면
    NO-DATA 로 표시해 두고, Draco bufferView 는 primitive 쪽에서 따로 해시한다.
    """
    a = doc.g["accessors"][ai]
    h = hashlib.sha1()
    h.update(f"{a['componentType']}|{a['type']}|{a['count']}|{a.get('normalized')}".encode())
    sp = a.get("sparse")
    has_data = False
    if sp:
        h.update(b"sparse")
        h.update(doc.view_bytes(sp["indices"]["bufferView"]))
        h.update(doc.view_bytes(sp["values"]["bufferView"]))
        has_data = True
    if a.get("bufferView") is not None:
        h.update(doc.read_accessor(ai).tobytes())
        has_data = True
    return ("" if has_data else "NODATA:") + h.hexdigest()[:16]


def draco_hash(doc: gk.Doc, prim: dict) -> str | None:
    """KHR_draco_mesh_compression 의 압축 버퍼 자체를 해시한다.
    Draco 자산에서 지오메트리·모프가 안 바뀌었음을 보장하는 것은 이 값이다."""
    ext = (prim.get("extensions") or {}).get("KHR_draco_mesh_compression")
    if not ext:
        return None
    h = hashlib.sha1()
    try:
        h.update(doc.view_bytes(ext["bufferView"]))
    except (IndexError, KeyError):
        # bufferView 인덱스가 범위를 벗어났다 = 재매핑 사고로 파일이 깨졌다
        return f"BROKEN(bufferView={ext.get('bufferView')})"
    h.update(repr(sorted(ext.get("attributes", {}).items())).encode())
    return h.hexdigest()[:16]


def node_paths(g: dict):
    parent = {}
    for i, n in enumerate(g.get("nodes", [])):
        for c in n.get("children", []):
            parent[c] = i

    def path(i):
        out, cur, guard = [], i, 0
        while cur is not None and guard < 512:
            out.append(g["nodes"][cur].get("name", f"#{cur}"))
            cur = parent.get(cur)
            guard += 1
        return "/".join(reversed(out))
    return [path(i) for i in range(len(g.get("nodes", [])))]


def profile(path: Path):
    doc = gk.load(path)
    g = doc.g
    p = {}

    p["nodes"] = node_paths(g)
    p["node_trs"] = [
        (tuple(n.get("translation", ())), tuple(n.get("rotation", ())),
         tuple(n.get("scale", ())), tuple(n.get("matrix", ())))
        for n in g.get("nodes", [])
    ]
    p["materials"] = [m.get("name") for m in g.get("materials", [])]
    p["meshes"] = [m.get("name") for m in g.get("meshes", [])]

    names = {i: n.get("name", f"#{i}") for i, n in enumerate(g.get("nodes", []))}
    p["skins"] = [
        {"name": s.get("name"),
         "joints": [names[j] for j in s.get("joints", [])],
         "ibm": acc_hash(doc, s["inverseBindMatrices"]) if s.get("inverseBindMatrices") is not None else None}
        for s in g.get("skins", [])
    ]

    prims, targets, geom = [], [], []
    for mi, m in enumerate(g.get("meshes", [])):
        tn = (m.get("extras") or {}).get("targetNames")
        targets.append({"mesh": m.get("name"), "targetNames": tn,
                        "weights": m.get("weights")})
        for pi, pr in enumerate(m.get("primitives", [])):
            prims.append({
                "mesh": m.get("name"), "i": pi,
                "attrs": sorted(pr.get("attributes", {})),
                "n_targets": len(pr.get("targets", [])),
                "mode": pr.get("mode", 4),
                "material": g["materials"][pr["material"]].get("name") if pr.get("material") is not None else None,
            })
            gh = {k: acc_hash(doc, v) for k, v in sorted(pr.get("attributes", {}).items())}
            if pr.get("indices") is not None:
                gh["INDICES"] = acc_hash(doc, pr["indices"])
            th = [{k: acc_hash(doc, v) for k, v in sorted(t.items())}
                  for t in pr.get("targets", [])]
            dh = draco_hash(doc, pr)
            if dh:
                gh["__DRACO__"] = dh
            geom.append({"mesh": m.get("name"), "i": pi, "attrs": gh, "targets": th})

    p["prims"] = prims
    p["target_names"] = targets
    p["geom"] = geom
    p["animations"] = [a.get("name") for a in g.get("animations", [])]
    p["n_images"] = len(g.get("images", []))
    p["n_bufferViews"] = len(g.get("bufferViews", []))
    p["extensionsRequired"] = sorted(g.get("extensionsRequired", []))
    # Draco/meshopt 가 참조하는 bufferView 인덱스 — 재매핑 사고를 직접 잡는다
    p["ext_view_refs"] = [
        (m.get("name"), pi, (pr.get("extensions") or {}).get("KHR_draco_mesh_compression", {}).get("bufferView"))
        for m in g.get("meshes", []) for pi, pr in enumerate(m.get("primitives", []))
        if (pr.get("extensions") or {}).get("KHR_draco_mesh_compression")
    ]
    p["textures"] = [{"source": t.get("source"), "ext": sorted((t.get("extensions") or {}).keys())}
                     for t in g.get("textures", [])]
    return p


def diff(a, b, label, fails):
    if a == b:
        print(f"  ✅ {label}")
        return
    fails.append(label)
    print(f"  ❌ {label}")
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            print(f"       개수 {len(a)} -> {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                print(f"       [{i}] {str(x)[:90]}")
                print(f"        ->  {str(y)[:90]}")
                if sum(1 for p, q in zip(a, b) if p != q) > 6:
                    print("       ... (이하 생략)")
                    break
    else:
        print(f"       {str(a)[:200]}\n    -> {str(b)[:200]}")


def main():
    before, after = Path(sys.argv[1]), Path(sys.argv[2])
    A, B = profile(before), profile(after)
    print(f"=== {before.name}  vs  {after.name} ===")
    fails = []
    diff(A["nodes"], B["nodes"], "노드 이름·계층", fails)
    diff(A["node_trs"], B["node_trs"], "노드 TRS", fails)
    diff(A["materials"], B["materials"], "재질 이름", fails)
    diff(A["meshes"], B["meshes"], "메시 이름", fails)
    diff(A["skins"], B["skins"], "스킨(본 이름·순서·IBM)", fails)
    diff(A["prims"], B["prims"], "프리미티브 구성(모프 개수 포함)", fails)
    diff(A["target_names"], B["target_names"], "모프타깃 이름·순서·가중치", fails)
    diff(A["geom"], B["geom"], "지오메트리·모프 데이터 해시", fails)
    diff(A["animations"], B["animations"], "애니메이션", fails)
    diff(A["n_images"], B["n_images"], "이미지 개수", fails)
    diff([t["source"] for t in A["textures"]], [t["source"] for t in B["textures"]],
         "텍스처→이미지 매핑", fails)
    diff(A["n_bufferViews"], B["n_bufferViews"], "bufferView 개수", fails)
    diff(A["extensionsRequired"], B["extensionsRequired"], "extensionsRequired", fails)
    diff(A["ext_view_refs"], B["ext_view_refs"], "Draco bufferView 참조", fails)

    # 지오메트리를 실제로 검사했는지 스스로 점검한다.
    # NODATA 만 있고 Draco 해시도 없으면 "통과"는 아무 의미가 없다.
    checked = sum(1 for gg in B["geom"] for v in gg["attrs"].values()
                  if not str(v).startswith("NODATA"))
    if checked == 0:
        fails.append("지오메트리 검사 불가(전부 NODATA)")
        print("  ❌ 지오메트리를 실제로 비교하지 못했다 — 이 통과는 무의미하다")
    else:
        print(f"  ℹ️  실데이터로 비교한 지오메트리 항목 {checked}개")

    sa, sb = before.stat().st_size, after.stat().st_size
    print(f"\n  크기 {sa/1024/1024:.1f}MB -> {sb/1024/1024:.1f}MB ({100*sb/sa:.1f}%)")
    if fails:
        print(f"\n*** 실패 {len(fails)}건: {', '.join(fails)} ***")
        return 1
    print("\n  통과 — 텍스처 외 구조가 완전히 동일하다")
    return 0


if __name__ == "__main__":
    sys.exit(main())
