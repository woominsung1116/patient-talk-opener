/**
 * 교정 텍스처 캡처. lab/hair2/shot.html 을 띄운다 — 게임의 RealisticPatient 를 그대로 import 하므로
 * 헤어 머티리얼 처리와 ACES 톤매핑이 제품과 동일하다. src/ 와 GLB 는 건드리지 않는다.
 *
 * lab/hair 의 리그를 스냅샷해 왔다. 그쪽은 다른 에이전트가 편집 중이라 캡처 도중 HMR 이 걸려
 * 페이지가 빈 화면으로 날아간다 — 검증은 재현 가능해야 하므로 사본을 쓴다.
 *
 *   node shoot.mjs --av mh_f60_ob,mh_f70 --age 65,72 --cam interview --out out/base
 *   node shoot.mjs ... --fixed /lab/hair2/fixed --out out/fixed
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// 아바타 → baseColor 텍스처 이름. out/uvdump/manifest.json 에서 뽑은 값을 고정해 둔다
// (다른 에이전트 디렉터리에 의존하지 않기 위해).
const TEX_BY_AV = {
  mh_f20: 'BlackHair', mh_f40: 'BlackHair', mh_f50: 'StrawberryBlondHair',
  mh_f60: 'GoldenBlondHair', mh_f60_ob: 'GoldenBlondHair',
  mh_f70: 'GingerHair', mh_oldf: 'GingerHair', mh_girl: 'AuburnHair',
  mh_f20_thin: 'Hairblackseamless2png',
}

const argv = process.argv.slice(2)
const args = {}
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : '1'
}
const BASE = args.base || 'http://localhost:5291'
const AVS = (args.av || 'mh_f60_ob').split(',')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.isAbsolute(args.out || '') ? args.out : path.join(HERE, args.out || 'out/shot')
const W = Number(args.w || 620)
const H = Number(args.h || 760)

fs.mkdirSync(OUT, { recursive: true })

const url = `${BASE}/lab/hair2/shot.html?av=${AVS.join(',')}&cam=${args.cam || 'face'}`
  + (args.age ? `&age=${args.age}` : '') + (args.fixed ? `&fixed=${args.fixed}` : '')

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: W * AVS.length, height: H }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 160)) })

await page.goto(url, { waitUntil: 'load', timeout: 90000 })
await page.waitForFunction(() => window.__ready === true, { timeout: 90000 })
  .catch(() => console.log('(ready timeout — 그대로 진행)'))
await page.waitForTimeout(2500)

if (args.fixed) {
  // 교체 대상이 없는 텍스처(기준 텍스처)는 실패하는 게 정상이다 — 원본 그대로 남는다.
  const want = AVS.filter((av) => TEX_BY_AV[av] && TEX_BY_AV[av] !== 'Hairblackseamless2png')
  let held = []
  // __swap 이 성공을 보고해도 RealisticPatient 가 머티리얼을 다시 만들면 map 이 원본으로
  // 돌아간다. 그래서 '교체 → 기다림 → 유지 확인'을 반복하고, 끝까지 안 붙으면 죽는다.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await page.evaluate(([p, m]) => window.__swap(p, m), [args.fixed, TEX_BY_AV])
    if (attempt === 1) console.log('swap:', JSON.stringify(res))
    await page.waitForTimeout(1200)
    const v = await page.evaluate(() => window.__verify())
    held = v.filter((x) => x.tagged)
    if (held.length >= want.length) {
      console.log(`swap held: ${held.length}/${want.length} (시도 ${attempt}회) ${held.map((h) => `${h.av}@${h.w}px`).join(' ')}`)
      break
    }
    console.log(`  (재적용 ${attempt}: 유지 ${held.length}/${want.length})`)
  }
  if (held.length < want.length) {
    console.error(`SWAP FAILED: 교체가 유지되지 않는다 ${held.length}/${want.length} (기대: ${want.join(',')}). 스샷 안 찍는다.`)
    await browser.close()
    process.exit(1)
  }
  await page.waitForTimeout(1500)
}

await page.screenshot({ path: path.join(OUT, 'hair.png') })
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ url, avs: AVS, w: W, h: H, dpr: 2 }, null, 1))
console.log(`→ ${path.join(OUT, 'hair.png')}`)
await browser.close()
