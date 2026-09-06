#!/usr/bin/env python3
"""GLB 구조 검사 — 축/치수/재질/텍스처가 의도대로 나갔는지 확인."""
import json, struct, sys, os

def load(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, total = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "not a GLB"
    off, js, bins = 12, None, b""
    while off < total:
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bins = chunk
        off += 8 + clen
    return js, bins, len(data)

for path in sys.argv[1:]:
    g, b, size = load(path)
    print(f"\n=== {os.path.basename(path)}  ({size:,} bytes) ===")
    print(f"  extensions used: {g.get('extensionsUsed', [])}")
    tot_tris = 0
    gmin = [1e9] * 3; gmax = [-1e9] * 3
    for mi, mesh in enumerate(g["meshes"]):
        for pi, prim in enumerate(mesh["primitives"]):
            acc = g["accessors"][prim["attributes"]["POSITION"]]
            idx = g["accessors"][prim["indices"]]
            tris = idx["count"] // 3
            tot_tris += tris
            mat = g["materials"][prim["material"]]["name"] if "material" in prim else "-"
            for k in range(3):
                gmin[k] = min(gmin[k], acc["min"][k]); gmax[k] = max(gmax[k], acc["max"][k])
            attrs = ",".join(sorted(prim["attributes"].keys()))
            print(f"  mesh[{mi}].prim[{pi}] {mesh['name']:<20} tris={tris:<5} mat={mat:<28} attrs={attrs}")
    print(f"  -- total tris: {tot_tris}")
    print(f"  -- glTF bbox  X[{gmin[0]:+.4f},{gmax[0]:+.4f}]  "
          f"Y[{gmin[1]:+.4f},{gmax[1]:+.4f}]  Z[{gmin[2]:+.4f},{gmax[2]:+.4f}]")
    print(f"  -- size (mm)  X={1000*(gmax[0]-gmin[0]):.1f}  "
          f"Y={1000*(gmax[1]-gmin[1]):.1f}  Z={1000*(gmax[2]-gmin[2]):.1f}")
    print("  -- nodes: " + ", ".join(f"{n.get('name','?')}" for n in g.get("nodes", [])))
    for m in g.get("materials", []):
        p = m.get("pbrMetallicRoughness", {})
        bc = p.get("baseColorFactor", [1, 1, 1, 1])
        tx = [k for k in ("baseColorTexture", "metallicRoughnessTexture") if k in p]
        if "normalTexture" in m: tx.append("normalTexture")
        em = m.get("emissiveFactor", [0, 0, 0])
        print(f"  MAT {m['name']:<30} base=({bc[0]:.2f},{bc[1]:.2f},{bc[2]:.2f}) "
              f"metal={p.get('metallicFactor', 1.0):.2f} rough={p.get('roughnessFactor', 1.0):.2f} "
              f"emis=({em[0]:.2f},{em[1]:.2f},{em[2]:.2f}) tex={tx}")
    for i, im in enumerate(g.get("images", [])):
        bv = g["bufferViews"][im["bufferView"]]
        print(f"  IMG[{i}] {im.get('name','?'):<24} {im.get('mimeType')}  {bv['byteLength']:,} bytes")
