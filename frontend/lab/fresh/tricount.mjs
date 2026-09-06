import { chromium } from 'playwright'
const b = await chromium.launch({ args:['--use-angle=metal'] })
const p = await b.newPage({ viewport:{width:1440,height:900} })
p.on('pageerror', e => console.log('PAGEERROR:', e.message))
await p.goto('http://localhost:5173/clinic-lab-fresh.html?cam=seat', { waitUntil:'load', timeout:60000 })
await p.waitForFunction(() => window.__labReady === true, { timeout: 60000 }).catch(()=>console.log('(labReady timeout)'))
await p.waitForTimeout(2500)
const out = await p.evaluate(() => {
  const { scene } = window.__lab
  const tri = (o) => { let t=0; o.traverse(m=>{ if(m.isMesh) t += m.geometry.index? m.geometry.index.count/3 : m.geometry.attributes.position.count/3 }); return Math.round(t) }
  const desk = scene.getObjectByName('desk')
  const per = []
  desk.children.forEach((c,i) => per.push([c.name || c.type + '#' + i, tri(c)]))
  const names = ['shell','examTable','counter','fixtures','curtains','desk','chair','traces','deskModel','plant','trash','clock','iv','vitals']
  const groups = {}
  for (const n of names) { const o = scene.getObjectByName(n); groups[n] = o ? tri(o) : 0 }
  return { deskTotal: tri(desk), deskChildren: per.length, per: per.filter(x=>x[1]>300), groups }
})
console.log('DESK TOP TOTAL (procedural + GLB props):', out.deskTotal)
console.log('children:', out.deskChildren)
console.log('heaviest desk children:', JSON.stringify(out.per))
console.log('groups:', JSON.stringify(out.groups, null, 1))
await b.close()
