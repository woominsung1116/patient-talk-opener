import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300)) })
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 400)))
await page.addInitScript(() => { try { localStorage.setItem('ptg-onboarding-seen-v1', '1') } catch {} })
await page.goto('http://localhost:5173')
await page.waitForTimeout(2500)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('증례 선택'))?.click() })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('이 환자 진료하기'))
  for (const b of btns) {
    let n = b.parentElement
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      if (n.textContent?.includes('박초아')) { b.click(); return }
    }
  }
})
await page.waitForTimeout(2000)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('진료실 들어가기'))?.click() })
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(3000)
  const state = await page.evaluate(() => ({
    white: document.body.innerText.trim().length < 5,
    mic: !!document.querySelector('button') && document.body.innerText.includes('말하'),
  }))
  console.log('t+' + (i * 3 + 3) + 's', JSON.stringify(state))
  if (state.mic) break
}
await page.screenshot({ path: '/tmp/dbg_enter.png' })
await browser.close()
