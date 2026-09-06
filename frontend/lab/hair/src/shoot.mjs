/**
 * 헤어 캡처 + **화면 픽셀** 대비 측정.
 *
 * lab/hair/hairshot.html 을 띄운다 — 게임의 RealisticPatient 를 그대로 import 하므로
 * 헤어 머티리얼 처리와 ACES 톤매핑이 제품과 동일하다. src/ 와 GLB 는 건드리지 않는다.
 *
 * 헤어 픽셀만 고르는 법: 헤어를 켠 샷과 끈 샷을 찍어 차이가 큰 픽셀을 마스크로 쓴다.
 * 텍스처 통계가 아니라 **눈에 실제로 들어오는 값**을 재는 게 목적이다.
 *
 *   node src/shoot.mjs --av mh_f60_ob,mh_f20_thin --age 65,22 --out out/shots/base
 *   node src/shoot.mjs --av mh_f60_ob --age 65 --fixed /lab/hair/out/fixed --out out/shots/fixed
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const args = {}
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : '1'
}
const BASE = args.base || 'http://localhost:5291'
const AVS = (args.av || 'mh_f60_ob,mh_f20_thin').split(',')
const AGES = args.age || ''
const OUT = args.out || 'out/shots/base'
const FIXED = args.fixed || null
const CAM = args.cam || 'face'
const W = Number(args.w || 620)
const H = Number(args.h || 760)

import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))   // 한글 경로 → percent-encoding 되므로 pathname 직접 쓰면 안 된다
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'out', 'uvdump', 'manifest.json')))
const TEX_BY_AV = Object.fromEntries(MANIFEST.map((m) => [m.avatar, m.tex]))

fs.mkdirSync(OUT, { recursive: true })

async function run() {
  const browser = await chromium.launch({ args: ['--use-angle=metal'] })
  const page = await browser.newPage({ viewport: { width: W * AVS.length, height: H }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)) })

  const url = `${BASE}/lab/hair/hairshot.html?av=${AVS.join(',')}&cam=${CAM}`
    + (AGES ? `&age=${AGES}` : '') + (FIXED ? `&fixed=${FIXED}` : '')
  await page.goto(url, { waitUntil: 'load', timeout: 90000 })
  await page.waitForFunction(() => window.__ready === true, { timeout: 90000 })
    .catch(() => console.log('(ready timeout — 그대로 진행)'))
  await page.waitForTimeout(2500)

  const info = await page.evaluate(() => (window.__rigs || []).map((r) => ({
    av: r.av,
    hairs: r.hairs.map((h) => ({
      mesh: h.name, mat: h.material?.name,
      tex: h.material?.map?.image ? `${h.material.map.image.width}x${h.material.map.image.height}` : 'none',
      texName: h.material?.map?.name || '',
      color: '#' + h.material?.color?.getHexString(),
      tris: h.geometry.index ? h.geometry.index.count / 3 : h.geometry.attributes.position.count / 3,
    })),
  })))
  console.log('rigs:', JSON.stringify(info, null, 1))

  if (FIXED) {
    const res = await page.evaluate(([p, m]) => window.__swap(p, m), [FIXED, TEX_BY_AV])
    console.log('swap:', JSON.stringify(res, null, 1))
    await page.waitForTimeout(2000)
  }

  await page.screenshot({ path: path.join(OUT, 'hair.png') })
  await page.evaluate(() => window.__hide(true))
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, 'nohair.png') })
  await page.evaluate(() => window.__hide(false))

  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ url, avs: AVS, cam: CAM, w: W, h: H, dpr: 2, info }, null, 1))
  console.log(`→ ${OUT}/hair.png  +  nohair.png`)
  await browser.close()
}

run()
