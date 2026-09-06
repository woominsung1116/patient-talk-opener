import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/private/tmp/claude-501/-Users-woominseong-Desktop----/6719fbd2-d125-4e36-b744-ea010e7e8d6f/scratchpad/clinic_lab/material'
fs.mkdirSync(OUT, { recursive: true })

const BASE = 'http://localhost:5199/clinic-lab-material.html'

// shots: [name, query]
const shots = JSON.parse(process.argv[2] || '[]')
const WARM = Number(process.env.WARM || 5000)

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

const stats = {}
for (const [name, query] of shots) {
  await page.goto(`${BASE}?${query}`, { waitUntil: 'load' })
  // 텍스처/GLTF 로드 대기
  await page.waitForFunction(() => window.__lab && window.__lab.ready(), { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.__lab.resetFps())
  await page.waitForTimeout(WARM)
  const s = await page.evaluate(() => window.__lab.stats())
  stats[name] = s
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log(name, JSON.stringify(s))
}
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2))
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 25).join('\n'))
await browser.close()
