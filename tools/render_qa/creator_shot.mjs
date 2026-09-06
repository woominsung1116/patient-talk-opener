import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import fs from 'fs'

const OUT = 'scratchpad/creator-qa'
const mouthOnly = process.argv.includes('--mouth-only')
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[browser error]', message.text().slice(0, 240))
})

await page.goto('http://127.0.0.1:5173', { waitUntil: 'load', timeout: 40000 })
await page.waitForTimeout(3000)
console.log('[title]', (await page.locator('body').innerText()).slice(0, 500))
await page.screenshot({ path: `${OUT}/00-title.png` })
await page.getByRole('button', { name: /교수자 환자 연출/ }).click()
await page.getByText('환자 연출 스튜디오', { exact: true }).waitFor({ timeout: 20000 })
await page.getByText('박초아', { exact: true }).first().waitFor({ timeout: 20000 })
await page.waitForTimeout(7000)
await page.screenshot({ path: `${OUT}/01-urolithiasis-dashboard.png` })

// 헤어 카드·구강 에셋·설압자처럼 클로즈업에서만 보이는 결함도 교수자 화면에서 확인한다.
await page.getByText('구강', { exact: true }).click()
await page.waitForTimeout(5000)
await page.screenshot({ path: `${OUT}/01b-urolithiasis-mouth.png` })
if (mouthOnly) {
  await browser.close()
  process.exit(0)
}

await page.getByText('급성 황달', { exact: true }).click()
await page.waitForTimeout(5000)
await page.screenshot({ path: `${OUT}/02-jaundice-eyes.png` })

// 실제 학생 진료 화면에서도 같은 통증 연출이 나오는지 확인한다.
const clinic = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await clinic.goto('http://127.0.0.1:5173/?camera=patient', { waitUntil: 'load', timeout: 40000 })
await clinic.getByRole('button', { name: /증례 선택/ }).click()
const card = clinic.locator('div').filter({ hasText: '박초아' }).filter({ has: clinic.getByText('이 환자 진료하기', { exact: true }) }).last()
await card.getByText('이 환자 진료하기', { exact: true }).click()
await clinic.getByText('진료실 들어가기', { exact: true }).waitFor({ timeout: 20000 })
await clinic.getByText('진료실 들어가기', { exact: true }).click()
await clinic.waitForTimeout(11000)
const skip = clinic.getByText('건너뛰기', { exact: true })
if (await skip.isVisible().catch(() => false)) await skip.click()
await clinic.waitForFunction(() => window.__game?.getState?.().phase === 'playing', null, { timeout: 15000 })
await clinic.waitForTimeout(2500)
await clinic.screenshot({ path: `${OUT}/03-urolithiasis-clinic.png` })

await browser.close()
