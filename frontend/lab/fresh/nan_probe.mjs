import { chromium } from 'playwright'
const b = await chromium.launch({ args:['--use-angle=metal'] })
const p = await b.newPage({ viewport:{width:800,height:600} })
p.on('pageerror', e => console.log('PAGEERROR:', e.message))
await p.goto('http://localhost:5173/clinic-lab-fresh.html?cam=wide', { waitUntil:'load', timeout:60000 })
await p.waitForTimeout(8000)
const out = await p.evaluate(() => {
  const { scene } = window.__lab
  const bad = []
  scene.traverse((o) => {
    if (!o.isMesh) return
    for (const key of ['position','normal','uv']) {
      const a = o.geometry.attributes[key]
      if (!a) continue
      for (let i = 0; i < a.array.length; i++) {
        if (!Number.isFinite(a.array[i])) { bad.push(`${o.name||'(anon)'} geom.${key}[${i}]`); break }
      }
    }
    const bs = o.geometry.boundingSphere
    if (bs && !Number.isFinite(bs.radius)) bad.push(`${o.name||'(anon)'} boundingSphere`)
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!m) continue
      for (const k of ['roughness','metalness','opacity','emissiveIntensity','envMapIntensity','sheen','transmission','thickness','ior']) {
        if (m[k] !== undefined && !Number.isFinite(m[k])) bad.push(`${o.name||'(anon)'} mat.${k}`)
      }
      if (m.color && !Number.isFinite(m.color.r)) bad.push(`${o.name||'(anon)'} mat.color`)
    }
  })
  const mats = new Set()
  scene.traverse((o) => { if (o.isMesh) (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m&&mats.add(m.type+':'+(m.transmission>0?'TRANSMISSION':'')+(m.transparent?'T':''))) })
  return { bad: bad.slice(0,20), mats: [...mats] }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
