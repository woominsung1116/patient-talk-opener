import fs from 'fs'
function parseGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const len = dv.getUint32(12, true)
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'))
}
for (const f of process.argv.slice(2)) {
  const g = parseGLB(fs.readFileSync(`frontend/public/avatars/${f}.glb`))
  console.log('=====', f)
  for (const m of g.meshes || []) {
    for (const p of m.primitives || []) {
      const mat = g.materials?.[p.material]
      const tris = (g.accessors?.[p.indices]?.count || 0) / 3
      const ti = mat?.pbrMetallicRoughness?.baseColorTexture?.index
      const img = ti != null ? g.images?.[g.textures?.[ti]?.source] : null
      console.log(`  mesh=${(m.name||'').padEnd(22)} mat=${(mat?.name||'').padEnd(34)} tris=${String(tris).padEnd(7)} alpha=${mat?.alphaMode||'OPAQUE'} tex=${img?.uri || img?.name || '-'}`)
    }
  }
}
