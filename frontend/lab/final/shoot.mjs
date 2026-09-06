// clinic-lab / FINAL — 캡처 유틸
//   node lab/final/shoot.mjs <name> <query> [waitMs]
// 예) node lab/final/shoot.mjs final_talk "mode=final&view=intake"
//
// HUD 텍스트와 window.__labStats / __bench() 결과를 stdout 으로 함께 뱉는다.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = '/private/tmp/claude-501/-Users-woominseong-Desktop----/6719fbd2-d125-4e36-b744-ea010e7e8d6f/scratchpad/clinic_lab/final'
mkdirSync(OUT, { recursive: true })

const [, , name, query, waitArg] = process.argv
const WAIT = Number(waitArg || 11000)
const url = `http://localhost:5199/clinic-lab.html?${query}`

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errs = []
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()) })
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.__labReady === true, null, { timeout: WAIT }).catch(() => {})
  await page.waitForTimeout(2500)
  const stats = await page.evaluate(() => window.__labStats || null)
  // 머신 부하로 단발 측정이 3배까지 튄다 → 5회 돌려 중앙값을 쓴다
  const bench = await page.evaluate(() => {
    if (!window.__bench) return null
    const runs = []
    for (let i = 0; i < 5; i++) runs.push(window.__bench(150))
    const ms = runs.map((r) => r.msPerFrame).sort((a, b) => a - b)
    const med = ms[2]
    return { ...runs[0], msPerFrame: med, msAll: ms, fpsEquiv: +(1000 / med).toFixed(0) }
  })
  await page.evaluate(() => window.__lab?.hideHud())
  await page.waitForTimeout(250)
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path })
  console.log(JSON.stringify({ name, url, stats, bench, errors: errs.slice(0, 8) }))
} finally {
  await browser.close()
}
