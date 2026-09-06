import pw from '/Users/woominseong/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js'
import { writeFileSync } from 'node:fs'

const { chromium } = pw
const URL = process.env.AVATAR_QA_URL ?? 'http://127.0.0.1:5173'
const cli = process.argv.slice(2)
const option = (name, fallback) => cli.find((arg) => arg.startsWith(`--${name}=`))?.split('=', 2)[1] ?? fallback
const emotion = option('emotion', process.env.AVATAR_QA_EMOTION ?? 'neutral')
const view = option('view', process.env.AVATAR_QA_VIEW ?? 'face')
const settleMs = Number(option('wait', process.env.AVATAR_QA_WAIT ?? '4500'))
const speaking = cli.includes('--speaking') || process.env.AVATAR_QA_SPEAKING === '1'
const skinDebug = option('skin-debug', process.env.AVATAR_QA_SKIN_DEBUG ?? '')
const exposure = option('exposure', process.env.AVATAR_QA_EXPOSURE ?? '')
const freezePose = cli.includes('--freeze') || process.env.AVATAR_QA_FREEZE === '1'
const asset = option('asset', process.env.AVATAR_QA_ASSET ?? '')
const requestedVariants = cli.filter((arg) => !arg.startsWith('--'))
const variants = requestedVariants.length
  ? requestedVariants
  : ['mh_boy', 'mh_f20', 'mh_m40', 'mh_f60_ob', 'mh_m70', 'mh_f70']

const browser = await chromium.launch()
for (const variant of variants) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  let resolveSkinLoaded
  const skinLoaded = new Promise((resolve) => { resolveSkinLoaded = resolve })
  page.on('console', (message) => {
    if (message.text().startsWith('[patient-skin]') || message.text().startsWith('[patient-garment]')) {
      console.log(message.text())
      if (message.text().startsWith('[patient-skin]')) resolveSkinLoaded()
    }
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    const failure = request.failure()
    if (failure?.errorText === 'net::ERR_ABORTED') return
    errors.push(`requestfailed: ${request.url()} (${failure?.errorText ?? 'unknown'})`)
  })
  const params = new URLSearchParams({ avatarLab: variant, emotion, view })
  if (speaking) params.set('speaking', '1')
  if (skinDebug) params.set('skinDebug', skinDebug)
  if (freezePose) params.set('freeze', '1')
  if (asset) params.set('asset', asset)
  if (exposure) params.set('exposure', exposure)
  // 진찰음 프리로드가 오래 열린 상태여도 장면 DOM/캔버스 검증은 계속한다.
  await page.goto(`${URL}/?${params}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.locator('canvas').waitFor({ state: 'visible' })
  if (exposure) {
    await page.evaluate((requested) => {
      const presets = {
        abdomen: { upper: 'raised', lower: 'worn', socks: 'worn', shoes: 'worn', privacyDrape: true },
        upperRemoved: { upper: 'removed', lower: 'worn', socks: 'worn', shoes: 'worn', privacyDrape: true },
        legs: { upper: 'worn', lower: 'rolled', socks: 'worn', shoes: 'worn', privacyDrape: false },
        lowerRemoved: { upper: 'worn', lower: 'removed', socks: 'worn', shoes: 'worn', privacyDrape: true },
        feet: { upper: 'worn', lower: 'worn', socks: 'removed', shoes: 'removed', privacyDrape: false },
      }
      const game = window.__game
      const garments = presets[requested]
      if (game && garments) game.setState({ phase: 'exam', clinicalGarments: garments })
    }, exposure)
  }
  await Promise.race([skinLoaded, page.waitForTimeout(8000)])
  await page.waitForTimeout(Number.isFinite(settleMs) ? settleMs : 4500)
  const cdp = await page.context().newCDPSession(page)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const assetSuffix = asset ? '_altAsset' : ''
  const debugSuffix = `${skinDebug ? `_${skinDebug}` : ''}${freezePose ? '_freeze' : ''}${assetSuffix}${exposure ? `_${exposure}` : ''}`
  const waitSuffix = settleMs === 4500 ? '' : `_wait${settleMs}`
  const destination = `/tmp/lab_${variant}_${emotion}_${view}${debugSuffix}${waitSuffix}.png`
  writeFileSync(destination, Buffer.from(data, 'base64'))
  console.log(`${variant}: errors=${errors.length} file=${destination}`, errors.slice(0, 12).join(' | '))
  await page.close()
}
// 일부 macOS SwiftShader 빌드는 큰 morph GLB를 닫을 때 child-process 종료를 오래 기다린다.
// QA 산출물 저장 뒤에는 3초 상한을 두어 자동 회귀 작업이 멈추지 않게 한다.
await Promise.race([
  browser.close(),
  new Promise((resolve) => setTimeout(resolve, 3000)),
])
