/* 헤어 alphaTest 스윕 — 아바타 × 컷오프 격자 캡처.
 * ⚠ --use-gl=angle --use-angle=metal 필수. */
import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'
import path from 'path'

const OUT = process.argv[2] || 'scratchpad/hairsweep'
const AVATARS = (process.argv[3] || 'mh_f30,mh_m50,mh_f60').split(',')
const ALPHAS = (process.argv[4] || '0.10,0.20,0.30,0.45').split(',')

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 2 })

for (const av of AVATARS) {
  for (const a of ALPHAS) {
    await page.goto(`http://localhost:5173/?avatarLab=${av}&view=body&freeze=1&hairAlpha=${a}`,
      { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(8500)
    await page.screenshot({ path: path.join(OUT, `${av}__${a}.png`) })
    console.log(av, a, 'ok')
  }
}
await browser.close()
console.log('done ->', OUT)
