import fs from 'fs'
const HAIR=/(hair|alpha7|ponytail|braid|curled|bob|maxwell|grump|culturalibre)/i
function parse(b){const dv=new DataView(b.buffer,b.byteOffset,b.byteLength)
  let off=12,json=null,bin=null
  while(off<b.length){const len=dv.getUint32(off,true),type=dv.getUint32(off+4,true)
    if(type===0x4E4F534A) json=JSON.parse(b.slice(off+8,off+8+len).toString('utf8'))
    if(type===0x004E4942) bin=b.slice(off+8,off+8+len)
    off+=8+len}
  return {json,bin}}
const [file,out]=process.argv.slice(2)
const {json:g,bin}=parse(fs.readFileSync(file))
for(const m of g.meshes||[])for(const p of m.primitives||[]){
  const mat=g.materials?.[p.material]; if(!HAIR.test(`${m.name} ${mat?.name||''}`))continue
  for(const [slot,ti] of [['base',mat?.pbrMetallicRoughness?.baseColorTexture?.index],['normal',mat?.normalTexture?.index]]){
    if(ti==null)continue
    const tx=g.textures[ti]; const img=g.images[tx.source ?? tx.extensions?.EXT_texture_webp?.source]
    const bv=g.bufferViews[img.bufferView]
    const data=bin.slice(bv.byteOffset||0,(bv.byteOffset||0)+bv.byteLength)
    const ext=img.mimeType.split('/')[1]
    fs.writeFileSync(`${out}_${slot}.${ext}`,data)
    console.log(`${out}_${slot}.${ext}`, data.length, img.mimeType)
  }
}
