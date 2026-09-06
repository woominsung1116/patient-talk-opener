/**
 * clinic-lab/hands 캡처 — 손 포즈 × 압박 조합을 스크린샷으로 남긴다.
 *
 * 사용:
 *   node lab/hands/capture.mjs <out_dir> '[["이름","pose=palm&press=deep"], ...]'
 * (vite dev 서버가 떠 있어야 한다. PORT 로 포트 지정)
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.argv[2]
const shots = JSON.parse(process.argv[3] || '[]')
const PORT = process.env.PORT || '5173'
const BASE = `http://localhost:${PORT}/clinic-lab-hands.html`
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

const stats = {}
for (const [name, query] of shots) {
  await page.goto(`${BASE}?${query}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__lab && window.__lab.ready(), { timeout: 30000 })
    .catch(() => errors.push(`${name}: __lab.ready() 타임아웃`))
  await page.waitForTimeout(900)
  stats[name] = await page.evaluate(() => window.__lab.stats()).catch(() => null)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log(name, JSON.stringify(stats[name]))
}
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2))
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 25).join('\n'))
else console.log('CONSOLE ERRORS: none')
await browser.close()
