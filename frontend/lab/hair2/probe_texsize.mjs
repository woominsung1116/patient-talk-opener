/** 런타임에 헤어 map 이 실제 몇 픽셀인지 확인한다. GLB 안 크기와 다르면 어딘가에서 줄인 것이다. */
import { chromium } from 'playwright'

const AVS = process.argv[2] || 'mh_f60_ob,mh_f70,mh_f20_thin,mh_f20'
const b = await chromium.launch({ args: ['--use-angle=metal'] })
const p = await b.newPage({ viewport: { width: 400 * AVS.split(',').length, height: 500 } })
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await p.goto(`http://localhost:5291/lab/hair2/shot.html?av=${AVS}&cam=interview`, { waitUntil: 'load', timeout: 90000 })
await p.waitForFunction(() => window.__ready === true, { timeout: 90000 }).catch(() => console.log('(ready timeout)'))
await p.waitForTimeout(2000)
const info = await p.evaluate(() => (window.__rigs || []).map((r) => ({
  av: r.av,
  hairs: r.hairs.map((h) => {
    const m = h.material
    const im = m?.map?.image
    return { texName: m?.map?.name, w: im?.width, h: im?.height, kind: im?.constructor?.name }
  }),
})))
console.log(JSON.stringify(info, null, 1))
await b.close()
