import pw from '/Users/woominseong/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js'
import { writeFileSync } from 'node:fs'
const { chromium } = pw
const URL = 'http://localhost:5173'
const side = process.argv[2] || 'right'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 })
await page.addInitScript((s) => { window.__WALK_DUR__ = 1.0; window.__LOOK__ = s }, side)
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const cdp = await page.context().newCDPSession(page)
const click = (n) => page.evaluate((nn) => {
  const norm = (s) => (s || '').replace(/[▸◂\s]/g, '')
  const b = [...document.querySelectorAll('button')].find((x) => norm(x.textContent).includes(nn))
  if (b) { b.click(); return true } return false
}, n.replace(/\s/g, ''))
await click('근무 시작')
for (let i = 0; i < 30; i++) { await page.waitForTimeout(700); if (await click('진료실들어가기')) break }
await page.waitForTimeout(6000)
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`/tmp/wall_${side}.png`, Buffer.from(data, 'base64'))
await browser.close()
console.log('saved /tmp/wall_' + side + '.png')
