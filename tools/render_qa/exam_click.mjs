/* 신체진찰 3D 부위 클릭 경로 검증.
 *
 * 리허설(rehearsal.mjs)은 **발화까지만** 한다 — 도구 선택은 되지만 부위를 안 찍어서
 * 늘 "진찰 0/30"으로 끝난다. 시연에서 학생이 실제로 하는 건 그 다음, 즉 3D 부위를
 * 손가락/마우스로 **꾹 누르는** 동작이고 그 경로는 한 번도 검증된 적이 없다.
 *
 * 히트 메시는 RegionMesh 의 `renderOrder={10}` 로 식별한다(이름이 없다).
 * 월드 좌표를 카메라로 투영해 실제 화면 픽셀에 pointerdown/up 을 쏜다 —
 * 스토어를 직접 호출하지 않아야 히트 테스트까지 같이 검증된다.
 */
import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'

const OUT = process.argv[2] || 'scratchpad/examclick'
const CASE = process.argv[3] || '박초아'
const TOOL_SPEECH = process.env.TOOL || '복부를 촉진하겠습니다'
const HOLD_MS = Number(process.env.HOLD || 3200)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const log = []
const say = (m) => { console.log(m); log.push(m) }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

const state = () => page.evaluate(() => {
  const s = window.__game?.getState?.()
  if (!s) return null
  return {
    phase: s.phase, examTool: s.examTool, examPass: s.examPass, examPose: s.examPose,
    examLog: (s.examLog || []).length,
    progress: Object.fromEntries(Object.entries(s.examProgress || {})
      .map(([k, v]) => [k, `${v.done?.length ?? 0}/${v.total ?? 0}`])),
    lastFinding: s.lastFinding,
  }
})

const click = async (text, t = 4000) => {
  try { const el = page.locator(`text=${text}`).first(); await el.waitFor({ state: 'visible', timeout: t }); await el.click({ force: true }); return true }
  catch { return false }
}

async function speak(text, waitMs = 90000) {
  if (!(await page.locator('input[placeholder="환자에게 할 말을 입력하세요..."]').count())) {
    await click('키보드로 입력할래요'); await page.waitForTimeout(600)
  }
  const box = page.locator('input[placeholder="환자에게 할 말을 입력하세요..."]').first()
  const b = await state()
  await box.fill(text); await box.press('Enter')
  const t0 = Date.now()
  while (Date.now() - t0 < waitMs) {
    await page.waitForTimeout(1500)
    const s = await state()
    if (s && (s.examLog > b.examLog || s.phase !== b.phase || s.examTool !== b.examTool)) return s
  }
  return await state()
}

/** 화면에 보이는 진찰 부위 마커들의 화면 좌표 (renderOrder===10 인 히트 메시) */
const markers = () => page.evaluate(() => {
  const scene = window.__scene, cam = window.__camera
  if (!scene || !cam) return []
  const out = []
  const THREE = window.__three || null
  scene.traverse((o) => {
    if (!o.isMesh || o.renderOrder !== 10 || !o.visible) return
    let p = o.parent, shown = true
    while (p) { if (!p.visible) { shown = false; break } p = p.parent }
    if (!shown) return
    const v = o.getWorldPosition(new o.position.constructor())
    v.project(cam)
    out.push({ x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, z: v.z })
  })
  return out.filter((m) => m.z > -1 && m.z < 1 && m.x > 0 && m.x < window.innerWidth && m.y > 0 && m.y < window.innerHeight)
})

try {
  await page.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(6000)
  await click('증례 선택'); await page.waitForTimeout(2500)
  const card = page.locator('div').filter({ hasText: CASE })
    .filter({ has: page.locator('button:has-text("이 환자 진료하기")') }).last()
  await card.waitFor({ state: 'visible', timeout: 8000 })
  await card.locator('button:has-text("이 환자 진료하기")').first().click({ force: true })
  await page.waitForTimeout(5000)
  await click('진료실 들어가기', 8000); await page.waitForTimeout(4000)
  for (let i = 0; i < 6; i++) {
    const a = await click('건너뛰기', 1200), b = await click('다음', 1200)
    if (!a && !b) break
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(5000)

  say('── 도구 선택 (발화)')
  await speak('손 소독을 하겠습니다')
  await page.waitForTimeout(2000)
  let s = await speak(TOOL_SPEECH)
  await page.waitForTimeout(3500)
  s = await state()
  say(`  phase=${s.phase} tool=${s.examTool} pass=${s.examPass} pose=${s.examPose}`)
  await page.screenshot({ path: `${OUT}/01_tool.png` })

  say('\n── 부위 마커 탐색')
  let ms = await markers()
  say(`  화면에 보이는 마커: ${ms.length}개`)
  if (!ms.length) { say('  ❌ 마커가 하나도 안 보인다 — 도구 선택이 안 됐거나 마커가 안 뜬다'); throw new Error('no markers') }

  say('\n── 부위 꾹 누르기')
  for (let i = 0; i < ms.length; i++) {
    ms = await markers()
    if (i >= ms.length) break
    const m = ms[i]
    const before = await state()
    await page.mouse.move(m.x, m.y)
    await page.waitForTimeout(400)
    await page.mouse.down()
    // 누르고 있는 중간에 손 동작을 캡처한다 — 타진/촉진 리그는 이때만 나온다
    // 타격 주기(2.6Hz ≈ 385ms)를 가로지르도록 여러 장 — 한 장으로는 든 건지 친 건지 모른다
    const SHOTS = Number(process.env.SHOTS || 1)
    if (SHOTS > 1) {
      const step = Math.floor(385 / SHOTS)
      await page.waitForTimeout(Math.floor(HOLD_MS * 0.4))
      for (let k = 0; k < SHOTS; k++) {
        await page.screenshot({ path: `${OUT}/hold_${i + 1}_${k}.png` })
        await page.waitForTimeout(step)
      }
      await page.waitForTimeout(Math.max(0, HOLD_MS - Math.floor(HOLD_MS * 0.4) - step * SHOTS))
    } else {
      await page.waitForTimeout(Math.floor(HOLD_MS * 0.55))
      await page.screenshot({ path: `${OUT}/hold_${i + 1}.png` })
      await page.waitForTimeout(HOLD_MS - Math.floor(HOLD_MS * 0.55))
    }
    await page.mouse.up()
    await page.waitForTimeout(2500)
    const after = await state()
    const moved = JSON.stringify(after.progress) !== JSON.stringify(before.progress) || after.examLog > before.examLog
    say(`  마커${i + 1} (${Math.round(m.x)},${Math.round(m.y)}) → ${moved ? '✅ 진행' : '❌ 반응없음'}  progress=${JSON.stringify(after.progress)}`)
    if (after.lastFinding && moved) say(`     소견: ${String(after.lastFinding).slice(0, 60)}`)
  }
  await page.screenshot({ path: `${OUT}/02_after.png` })
  const fin = await state()
  say(`\n최종 progress=${JSON.stringify(fin.progress)} examLog=${fin.examLog}`)
} catch (e) {
  say(`\n💥 ${e.message}`)
  await page.screenshot({ path: `${OUT}/crash.png` }).catch(() => {})
}
say(`\n페이지 오류 ${errors.length}건`)
for (const e of [...new Set(errors)].slice(0, 5)) say('  ' + e)
fs.writeFileSync(`${OUT}/log.txt`, log.join('\n'))
await browser.close()
