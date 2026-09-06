// 캡처 유틸 — node lab/fresh/shoot.mjs <url> <출력png> [대기ms]
// HUD(#hud)의 fps/draw call 텍스트도 함께 stdout으로 뱉는다.
import { chromium } from 'playwright'

const [, , url, out, waitArg] = process.argv
const WAIT = Number(waitArg || 9000)
const OUT_DIR = '/private/tmp/claude-501/-Users-woominseong-Desktop----/6719fbd2-d125-4e36-b744-ea010e7e8d6f/scratchpad/clinic_lab/fresh'

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errs = []
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()) })
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(WAIT)
  const hud = await page.evaluate(() => document.getElementById('hud')?.textContent || '(no hud)')
  const pinfo = await page.evaluate(() => window.__patientInfo || null)
  if (pinfo) console.log('patient: ' + JSON.stringify(pinfo))
  const path = out.startsWith('/') ? out : `${OUT_DIR}/${out}`
  await page.screenshot({ path })
  console.log('=== ' + path)
  console.log(hud)
  if (errs.length) console.log('--- errors:\n' + errs.slice(0, 12).join('\n'))
} finally {
  await browser.close()
}
