/**
 * 헤어 메시의 UV·인덱스·baseColor 텍스처를 GLB에서 꺼내 덤프한다. **읽기 전용**.
 * MPFB GLB는 KHR_draco_mesh_compression 이라 파이썬 파서로는 UV를 못 읽는다 → 여기서 디코드한다.
 *
 *   node src/dump_hair_uv.mjs out/uvdump [avatar,...]
 */
import fs from 'node:fs'
import path from 'node:path'
import draco3d from 'draco3d'

const AV = '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/public/avatars'
const HAIR = /hair|bob|wig|ponytail|grump/i
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function parseGlb(buf) {
  let off = 12, js = null, bin = null
  while (off < buf.length) {
    const clen = buf.readUInt32LE(off), ctype = buf.readUInt32LE(off + 4)
    const chunk = buf.subarray(off + 8, off + 8 + clen)
    if (ctype === 0x4e4f534a) js = JSON.parse(chunk.toString('utf8'))
    else if (ctype === 0x004e4942) bin = chunk
    off += 8 + clen + ((4 - (clen % 4)) % 4)
  }
  return { js, bin }
}

function readAccessor(js, bin, idx) {
  const acc = js.accessors[idx]
  if (acc.bufferView === undefined) return null
  const bv = js.bufferViews[acc.bufferView]
  const T = COMP[acc.componentType], nc = NC[acc.type]
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const stride = bv.byteStride || T.BYTES_PER_ELEMENT * nc
  const out = new Float64Array(acc.count * nc)
  for (let i = 0; i < acc.count; i++) {
    const v = new T(bin.buffer, bin.byteOffset + base + i * stride, nc)
    for (let c = 0; c < nc; c++) out[i * nc + c] = v[c]
  }
  return out
}

async function main() {
  const outDir = process.argv[2] || 'out/uvdump'
  const only = process.argv[3] ? process.argv[3].split(',') : null
  fs.mkdirSync(outDir, { recursive: true })
  const dm = await draco3d.createDecoderModule({})
  const files = (only ?? fs.readdirSync(AV).filter((f) => f.endsWith('.glb')).map((f) => f.replace('.glb', ''))).sort()
  const manifest = []

  for (const name of files) {
    const p = path.join(AV, name + '.glb')
    if (!fs.existsSync(p)) continue
    const { js, bin } = parseGlb(fs.readFileSync(p))
    for (const node of js.nodes || []) {
      if (node.mesh === undefined) continue
      const mesh = js.meshes[node.mesh]
      for (let pi = 0; pi < mesh.primitives.length; pi++) {
        const prim = mesh.primitives[pi]
        const mat = prim.material !== undefined ? js.materials[prim.material] : null
        const tag = `${node.name || ''}|${mesh.name || ''}|${mat?.name || ''}`
        if (!HAIR.test(tag)) continue

        let uv = null, idx = null
        const dext = prim.extensions?.KHR_draco_mesh_compression
        if (dext) {
          const bv = js.bufferViews[dext.bufferView]
          const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
          const db = new dm.DecoderBuffer()
          db.Init(new Int8Array(data), data.length)
          const dec = new dm.Decoder()
          const dmesh = new dm.Mesh()
          dec.DecodeBufferToMesh(db, dmesh)
          const aid = dext.attributes.TEXCOORD_0
          if (aid !== undefined) {
            const at = dec.GetAttributeByUniqueId(dmesh, aid)
            const arr = new dm.DracoFloat32Array()
            dec.GetAttributeFloatForAllPoints(dmesh, at, arr)
            uv = new Float32Array(arr.size())
            for (let i = 0; i < uv.length; i++) uv[i] = arr.GetValue(i)
            dm.destroy(arr)
          }
          const nf = dmesh.num_faces()
          idx = new Uint32Array(nf * 3)
          const ia = new dm.DracoInt32Array()
          for (let f = 0; f < nf; f++) {
            dec.GetFaceFromMesh(dmesh, f, ia)
            idx[f * 3] = ia.GetValue(0); idx[f * 3 + 1] = ia.GetValue(1); idx[f * 3 + 2] = ia.GetValue(2)
          }
          dm.destroy(ia); dm.destroy(dmesh); dm.destroy(dec); dm.destroy(db)
        } else {
          const u = readAccessor(js, bin, prim.attributes.TEXCOORD_0)
          if (u) uv = Float32Array.from(u)
          if (prim.indices !== undefined) idx = Uint32Array.from(readAccessor(js, bin, prim.indices))
          else if (uv) idx = Uint32Array.from({ length: uv.length / 2 }, (_, i) => i)
        }
        if (!uv || !idx) continue

        // baseColor 텍스처 추출 (EXT_texture_webp 포함)
        const pbr = mat?.pbrMetallicRoughness || {}
        let texName = null
        const bct = pbr.baseColorTexture
        if (bct) {
          const t = js.textures[bct.index]
          const src = t.source ?? t.extensions?.EXT_texture_webp?.source
          if (src !== undefined) {
            const im = js.images[src]
            const bv = js.bufferViews[im.bufferView]
            const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
            texName = im.name || `img${src}`
            const ext = (im.mimeType || '').includes('webp') ? '.webp' : '.png'
            const tp = path.join(outDir, texName + ext)
            if (!fs.existsSync(tp)) fs.writeFileSync(tp, data)
          }
        }
        const key = `${name}__${(mesh.name || node.name).replace(/[^\w]/g, '_')}_${pi}`
        fs.writeFileSync(path.join(outDir, key + '.uv.bin'), Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength))
        fs.writeFileSync(path.join(outDir, key + '.idx.bin'), Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength))
        manifest.push({
          avatar: name, key, mesh: mesh.name || node.name, material: mat?.name || '',
          tex: texName, verts: uv.length / 2, tris: idx.length / 3,
          baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1], alphaMode: mat?.alphaMode || 'OPAQUE',
        })
        process.stdout.write(`${name.padEnd(26)} ${(mat?.name || '').padEnd(30)} tris=${String(idx.length / 3).padStart(6)}  tex=${texName}\n`)
      }
    }
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1))
  console.log(`\n${manifest.length} hair primitives -> ${outDir}/manifest.json`)
}

main()
