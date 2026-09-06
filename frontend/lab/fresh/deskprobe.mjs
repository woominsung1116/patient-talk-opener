import { chromium } from 'playwright'
const b = await chromium.launch({ args:['--use-angle=metal'] })
const p = await b.newPage({ viewport:{width:1440,height:900} })
p.on('pageerror', e => console.log('PAGEERROR:', e.message))
await p.goto('http://localhost:5173/clinic-lab-fresh.html?cam=seat', { waitUntil:'load', timeout:60000 })
await p.waitForTimeout(9000)
const out = await p.evaluate(() => {
  const { scene, camera, THREE } = window.__lab
  const DESK = [-2.05, 0, 0.42], T = 0.835
  const cam = new THREE.Vector3(-1.85, 1.34, 0.95)
  const lines = []
  for (const lz of [-0.40, -0.30, -0.20, -0.10, 0.0, 0.10, 0.20, 0.30]) {
    let row = 'z=' + lz.toFixed(2).padStart(5) + ' | '
    for (const lx of [0.0, 0.2, 0.4, 0.6, 0.8]) {
      const w = new THREE.Vector3(DESK[0]+lx, T, DESK[2]+lz)
      const d = w.distanceTo(cam)
      const v = w.clone().project(camera)
      const sx = Math.round((v.x*0.5+0.5)*1440), sy = Math.round((-v.y*0.5+0.5)*900)
      const inFrame = sx>=0 && sx<=1440 && sy>=0 && sy<=900
      row += `x${lx.toFixed(1)}:(${String(sx).padStart(5)},${String(sy).padStart(5)})${inFrame?'*':' '}d${d.toFixed(2)} `
    }
    lines.push(row)
  }
  const cnt = (n) => { const o=scene.getObjectByName(n); if(!o) return 0; let t=0
    o.traverse(m=>{ if(m.isMesh) t += m.geometry.index? m.geometry.index.count/3 : m.geometry.attributes.position.count/3 }); return Math.round(t) }
  return { lines, deskTris: cnt('desk'), fixturesTris: cnt('fixtures') }
})
console.log(out.lines.join('\n'))
console.log('desk group tris:', out.deskTris, ' fixtures tris:', out.fixturesTris)
await b.close()
