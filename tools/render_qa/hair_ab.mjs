/* 배포본 vs 스테이징본 헤어 A/B 캡처. 인자: name=variant:assetUrl ... */
import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'
import path from 'path'

const OUT = process.argv[2]
const JOBS = process.argv.slice(3).map((s) => {
  const [label, rest] = s.split('=')
  const [variant, asset] = rest.split(':')
  return { label, variant, asset }
})

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 2 })

for (const j of JOBS) {
  const q = `avatarLab=${j.variant}&view=body&freeze=1` + (j.asset ? `&asset=${j.asset}` : '')
  await page.goto(`http://localhost:5173/?${q}`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(9000)
  await page.screenshot({ path: path.join(OUT, `${j.label}.png`) })
  console.log(j.label, 'ok')
}
await browser.close()
console.log('done ->', OUT)
