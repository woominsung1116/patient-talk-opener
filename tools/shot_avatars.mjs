import pw from '/Users/woominseong/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js'
import { writeFileSync } from 'node:fs'
const { chromium } = pw

// Prefer the explicitly bound IPv4 dev server. On macOS, `localhost` may hit
// an unrelated stale IPv6 Vite process when both are present.
const URL = process.env.AVATAR_QA_URL ?? 'http://127.0.0.1:5173'
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['hyunwoo', 'eric', 'jieun', 'sujin', 'carla', 'claudia']

const browser = await chromium.launch()
for (const v of variants) {
  // SwiftShader 기반 CI에서도 여러 캐릭터를 현실적인 시간 안에 순회하도록 1x QA 뷰포트 사용.
  const page = await browser.newPage({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1 })
  const errs = []
  page.on('console', (m) => {
    const t = m.text()
    if (/^\[(tex|mesh|fit|GameScreen|RealisticPatient|Patient)/.test(t)) console.log('  ', t)
    if (m.type() === 'error') errs.push(t)
  })
  await page.addInitScript(() => {
    window.__WALK_DUR__ = 1.2
    localStorage.setItem('ptg-onboarding-seen-v1', '1')
  })
  await page.goto(`${URL}/?av=${v}&camera=patient`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const cdp = await page.context().newCDPSession(page)
  const click = async (n) => page.evaluate((nn) => {
    const norm = (s) => (s || '').replace(/[▸◂\s]/g, '')
    const b = [...document.querySelectorAll('button')].find((x) => norm(x.textContent).includes(nn))
    if (b) { b.click(); return true } return false
  }, n.replace(/\s/g, ''))
  await click('근무 시작')
  let ok = false
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(700); if (await click('진료실들어가기')) { ok = true; break } }
  // GLB 파싱 중에는 renderer의 JS가 잠깐 바쁠 수 있으므로 Playwright locator 대신
  // CDP 입력을 반복해, 컷신이 마운트되는 즉시 안전하게 건너뛴다.
  for (let i = 0; i < 20; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 375, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 375, button: 'left', clickCount: 1 })
    await page.waitForTimeout(350)
  }
  await page.waitForTimeout(5000) // 착석 + 텍스처/셰이더 컴파일
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`/tmp/av_${v}.png`, Buffer.from(data, 'base64'))
  console.log(`${v}: entered=${ok} texErrs=${errs.length}`, errs.slice(0, 2).join(' | '))
  await page.close()
}
await browser.close()
console.log('done')
