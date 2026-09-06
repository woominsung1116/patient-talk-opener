import { chromium } from 'playwright'
const BASE = 'http://localhost:5199/clinic-lab-material.html'
const cases = JSON.parse(process.argv[2])
const browser = await chromium.launch({ args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const out = {}
for (const [name, q] of cases) {
  await page.goto(`${BASE}?${q}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__lab && window.__lab.ready(), { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(2500)
  // 3회 측정 중 최솟값(가장 방해 적은 실행)
  const runs = []
  for (let i = 0; i < 3; i++) runs.push(await page.evaluate(() => window.__lab.bench(240)))
  const best = runs.reduce((a, b) => (a.msPerFrame <= b.msPerFrame ? a : b))
  const s = await page.evaluate(() => window.__lab.stats())
  out[name] = { ...best, sceneCalls: s.sceneCalls, totalCalls: s.totalCalls, triangles: s.triangles, programs: s.programs }
  console.log(name, JSON.stringify(out[name]))
}
await browser.close()
