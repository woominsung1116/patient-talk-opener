/* 호흡 검증 — 한 호흡 주기 동안 여러 프레임을 찍는다.
 * 정지 이미지로는 "숨을 쉬는가"를 알 수 없다. 프레임 간 **차분**으로만 판정한다
 * (회전 진폭을 4배 올려도 가슴은 안 움직였던 과거 사례가 이 방법으로 드러났다). */
import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'
import path from 'path'

const OUT = process.argv[2] || 'scratchpad/breath'
const VARIANT = process.argv[3] || 'mh_f30'
const VIEW = process.argv[4] || 'exam'      // exam = 누움, body = 서 있음
const FRAMES = Number(process.argv[5] || 12)
const STEP_MS = Number(process.argv[6] || 320)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 900, height: 720 }, deviceScaleFactor: 2 })
// freeze 를 주지 않아야 애니메이션이 돈다
await page.goto(`http://localhost:5173/?avatarLab=${VARIANT}&view=${VIEW}${process.env.EXTRA||""}`,
  { waitUntil: 'load', timeout: 40000 })
await page.waitForTimeout(11000)

for (let i = 0; i < FRAMES; i++) {
  await page.screenshot({ path: path.join(OUT, `f${String(i).padStart(2, '0')}.png`) })
  await page.waitForTimeout(STEP_MS)
}
await browser.close()
console.log(`captured ${FRAMES} frames -> ${OUT}`)
