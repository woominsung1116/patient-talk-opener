import pw from '/Users/woominseong/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js'
import { writeFileSync } from 'node:fs'
const { chromium } = pw

const URL = 'http://localhost:5173'
const OUT = '/tmp/clinic'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()) })

// 폰트 대기 우회: CDP로 즉시 캡처
const cdp = await page.context().newCDPSession(page)
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(`${OUT}_${name}.png`, Buffer.from(data, 'base64'))
  console.log('saved', name)
}

// 워크 짧게 (캡처 빠르게)
await page.addInitScript(() => {
  window.__WALK_DUR__ = 1.2
  localStorage.setItem('ptg-onboarding-seen-v1', '1')
})
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const clickByText = async (needle) => {
  const ok = await page.evaluate((n) => {
    const norm = (s) => (s || '').replace(/[▸◂\s]/g, '')
    const btns = [...document.querySelectorAll('button')]
    const b = btns.find((x) => norm(x.textContent).includes(n))
    if (b) { b.click(); return true }
    return false
  }, needle.replace(/\s/g, ''))
  return ok
}

console.log('근무 시작:', await clickByText('근무 시작'))
// 인트로(진료 접수증) 버튼이 나타날 때까지 폴링
let entered = false
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(700)
  if (await clickByText('진료실들어가기')) { entered = true; break }
}
console.log('진료실 들어가기 클릭:', entered)
await page.waitForTimeout(1200) // 노크/문 열림

// 컷씬 진행 중(걷는 중) 한 컷 — 방 배경 확인
await page.waitForTimeout(700)
await shot('walk')

// 컷씬 끝나고 착석 후
await page.waitForTimeout(4000)
await shot('seated')

// 마우스를 좌우로 옮겨 측면 벽(시력표/X-ray) 보이게
await page.mouse.move(200, 500)
await page.waitForTimeout(900)
await shot('left')
await page.mouse.move(1400, 500)
await page.waitForTimeout(900)
await shot('right')

await browser.close()
console.log('done ->', OUT)
