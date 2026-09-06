import fs from 'fs'
const HAIR=/(hair|alpha7|ponytail|braid|curled|bob|maxwell|grump|culturalibre)/i
function p(b){const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);return JSON.parse(b.slice(20,20+dv.getUint32(12,true)).toString('utf8'))}
for(const f of process.argv.slice(2)){
  const g=p(fs.readFileSync(f))
  for(const m of g.meshes||[])for(const pr of m.primitives||[]){
    const mat=g.materials?.[pr.material]; if(!HAIR.test(`${m.name} ${mat?.name||''}`))continue
    console.log(f.split('/').pop().padEnd(20), (mat?.name||'').padEnd(42),
      'tris='+((g.accessors?.[pr.indices]?.count||0)/3),
      'normalTex='+(mat?.normalTexture?'YES':'no'), 'alpha='+(mat?.alphaMode||'OPAQUE'))
  }
}
