// 진찰대 매트 상면의 월드 y 를 base/final 두 모드에서 실제로 재서 비교한다.
// 본 씬은 환자를 EXAM.patientPos y=0.78 고정으로 놓으므로 여기가 밀리면 환자가 뜨거나 잠긴다.
import { chromium } from 'playwright'

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const out = {}
for (const mode of ['base', 'final']) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.goto(`http://localhost:5199/clinic-lab.html?mode=${mode}&view=exam&merge=0`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__labReady === true, null, { timeout: 20000 }).catch(() => {})
  out[mode] = await page.evaluate(() => {
    const THREE = window.__THREE
    let bed = null
    window.__scene.traverse((o) => { if (o.name === 'examBed') bed = o })
    if (!bed) return { error: 'examBed not found' }
    bed.updateMatrixWorld(true)
    // 매트(비닐) / 종이 커버의 월드 AABB 상단
    const res = { mat: -Infinity, paper: -Infinity, cabinet: -Infinity }
    bed.traverse((o) => {
      if (!o.isMesh || !o.geometry) return
      o.geometry.computeBoundingBox()
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
      const c = o.material?.color?.getHexString?.()
      if (c === 'c9b48f') res.mat = Math.max(res.mat, bb.max.y)
      if (c === 'e9e1d0') res.paper = Math.max(res.paper, bb.max.y)
      if (c === 'd8c4a0') res.cabinet = Math.max(res.cabinet, bb.max.y)
    })
    void THREE
    return res
  })
  await page.close()
}
await browser.close()
const f = (v) => (v == null || v === -Infinity ? 'n/a' : (v * 1000).toFixed(1) + 'mm')
console.log('             base        final       diff')
for (const k of ['mat', 'paper', 'cabinet']) {
  const d = (out.final[k] - out.base[k]) * 1000
  console.log(`${k.padEnd(10)} ${f(out.base[k]).padEnd(11)} ${f(out.final[k]).padEnd(11)} ${d.toFixed(1)}mm`)
}
