/* 신체진찰 **완주** 검증 — 8항목을 끝까지 수행해서 실제 채점까지 본다.
 *
 * 왜 따로 만들었나:
 *   rehearsal.mjs  → 발화까지만. 늘 진찰 0/30 으로 끝난다.
 *   exam_click.mjs → 도구 하나(촉진 얕게)만. 4/8 에서 멈춘다.
 * 그래서 **신체진찰 축(30점, 전체의 30%)이 한 번도 0이 아닌 적이 없었다.**
 * 기준 케이스의 존재 이유가 4축 CPX 채점인데 가장 큰 축이 미검증이었다.
 *
 * 요로결석 케이스 기준 구성:
 *   준비 4 (발화)   손위생 · 설명동의 · 가려주기 · 무릎세우기
 *   진찰 4 (도구)   청진 8점(4분면) · 타진 6점(4분면)
 *                   촉진 8점(4분면 × 얕게/깊게) · CVA 8점(양측 옆구리)
 *
 *   node tools/render_qa/exam_full.mjs <출력폴더> <환자이름>
 */
import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'

const OUT = process.argv[2] || 'scratchpad/examfull'
const CASE = process.argv[3] || '박초아'
const HOLD_MS = Number(process.env.HOLD || 3200)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const log = []
const say = (m) => { console.log(m); log.push(m) }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

const state = () => page.evaluate(() => {
  const s = window.__game?.getState?.()
  if (!s) return null
  return {
    phase: s.phase, examTool: s.examTool, examPass: s.examPass, examPose: s.examPose,
    examLog: (s.examLog || []).length,
    progress: Object.fromEntries(Object.entries(s.examProgress || {})
      .map(([k, v]) => [k, `${v.done?.length ?? 0}/${v.total ?? 0}`])),
    done: Object.values(s.examProgress || {})
      .filter((p) => p && p.remaining && p.remaining.length === 0).length,
    patientTurns: (s.dialogue || []).filter((d) => d.speaker === 'patient').length,
    busy: s.busy || null, examBusy: !!s.examBusy,
    report: !!s.report,
  }
})

const click = async (text, t = 4000) => {
  try {
    const el = page.locator(`text=${text}`).first()
    await el.waitFor({ state: 'visible', timeout: t })
    await el.click({ force: true })
    return true
  } catch { return false }
}

async function speak(text, waitMs = 90000) {
  if (!(await page.locator('input[placeholder="환자에게 할 말을 입력하세요..."]').count())) {
    await click('키보드로 입력할래요'); await page.waitForTimeout(600)
  }
  const box = page.locator('input[placeholder="환자에게 할 말을 입력하세요..."]').first()
  const b = await state()
  await box.fill(text); await box.press('Enter')
  /* ⚠ **완료 신호는 동작 종류마다 다르다.** 이걸 몰라서 두 번 헛돌았다:
       질문      → 환자 발화(patientTurns)가 는다
       준비 동작 → 진찰기록(examLog)이 는다, 환자 발화는 안 늘 수도 있다
       도구 선택 → examTool 이 바뀐다
     그래서 한 가지만 기다리면 나머지 종류는 타임아웃으로 유실되고,
     아무거나 기다리면 직전 턴의 늦은 갱신에 속아 너무 일찍 반환한다.
     (전자로 바꿨더니 드레이프·무릎까지 유실됐고, 후자일 땐 도구가 한 턴 밀렸다.)

     유일하게 종류와 무관한 신호는 **busy 가 떴다가 가라앉는 것**이다.
     요청이 실제로 시작됐는지 확인한 뒤 끝날 때까지 기다린다. */
  const t0 = Date.now()
  let started = false
  while (Date.now() - t0 < waitMs) {
    await page.waitForTimeout(800)
    const s = await state()
    if (!s) continue
    const working = !!s.busy || s.examBusy
    if (working) { started = true; continue }
    if (started) { await page.waitForTimeout(1200); return await state() }
    // busy 를 한 번도 못 봤는데 상태가 이미 달라졌다면 처리된 것으로 본다
    if (s.patientTurns > b.patientTurns || s.examLog > b.examLog
      || s.phase !== b.phase || s.examTool !== b.examTool) return s
  }
  return await state()
}

/** 화면에 보이는 진찰 부위 마커의 화면 좌표 (RegionMesh 는 renderOrder===10) */
const markers = () => page.evaluate(() => {
  const scene = window.__scene, cam = window.__camera
  if (!scene || !cam) return []
  const out = []
  scene.traverse((o) => {
    if (!o.isMesh || o.renderOrder !== 10 || !o.visible) return
    let p = o.parent, shown = true
    while (p) { if (!p.visible) { shown = false; break } p = p.parent }
    if (!shown) return
    const v = o.getWorldPosition(new o.position.constructor())
    v.project(cam)
    out.push({ x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, z: v.z })
  })
  return out.filter((m) => m.z > -1 && m.z < 1
    && m.x > 0 && m.x < window.innerWidth && m.y > 0 && m.y < window.innerHeight)
})

/** 요청한 도구(와 패스)가 **실제로 잡힐 때까지** 기다린다.
 *
 * ⚠ 이게 없으면 도구 상태가 한 턴씩 밀린다. speak() 는 examLog/phase/tool 중
 * 아무거나 바뀌면 반환하는데, 직전 턴의 늦은 갱신이 그 조건을 먼저 만족시켜
 * **도구가 붙기 전에** 부위를 누르게 된다. 실제로 "청진하겠습니다" 직후
 * tool=null 인 채로 눌렀고, 그 다음 턴에야 tool=auscultation 이 나타났다.
 * 그 상태로 찍힌 로그는 "진찰이 안 된다"는 **잘못된 결론**을 만든다. */
async function waitForTool(expected, expectedPass, ms = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = await state()
    if (s?.examTool === expected && (!expectedPass || s.examPass === expectedPass)) return s
    await page.waitForTimeout(1200)
  }
  return await state()
}

/** 보이는 마커를 전부 꾹 눌러 그 도구의 부위를 소진한다. */
/* 도구별 유지 시간은 **평가표 요구사항**이다(store.ts HOLD_SECONDS 가 단일 진실).
   ⚠ 청진은 "복부청진 최소 5초 이상"이라 3.2초로 누르면 **한 번도 완료되지 않는다.**
   그걸 모르고 "청진만 안 된다"를 게임 버그로 볼 뻔했다 — 타진(1.2)·촉진(1.5)·
   CVA(1.0)는 3.2초로 통과하니 청진만 실패해서 더 그럴듯해 보였다. */
const HOLD_FOR = { auscultation: 6200, percussion: 2200, palpation: 2600, cva_tenderness: 2000 }

async function pressAll(label, hold = HOLD_MS) {
  let pressed = 0
  let miss = 0
  let noMarker = false
  for (let round = 0; round < 10; round++) {
    const ms = await markers()
    if (round === 0) say(`     마커 ${ms.length}개`)
    /* ⚠ "0회 누름"만 찍으면 **마커가 없는 것**과 **눌러도 반응이 없는 것**을
       구분할 수 없다. 원인이 정반대인데 로그가 같으면 엉뚱한 데를 고치게 된다. */
    if (!ms.length) {
      if (round === 0) {
        noMarker = true
        await page.screenshot({ path: `${OUT}/nomarker_${label.replace(/[^가-힣]/g, '')}.png` })
      }
      break
    }
    /* ⚠ 항상 ms[0] 만 누르면 **도구마다 1회에서 멈춘다.** 그 부위가 끝나도
       마커는 화면에 남아 있어서, 같은 자리를 다시 눌러 봐야 진행이 없고
       그대로 중단된다. 4분면을 돌려면 인덱스를 옮겨 가며 눌러야 한다. */
    const m = ms[Math.min(round, ms.length - 1)]
    const before = await state()
    await page.mouse.move(m.x, m.y)
    await page.waitForTimeout(300)
    await page.mouse.down()
    await page.waitForTimeout(hold)
    await page.mouse.up()
    await page.waitForTimeout(1600)
    const after = await state()
    const moved = JSON.stringify(after.progress) !== JSON.stringify(before.progress)
    if (moved) { pressed++; miss = 0 }
    else if (++miss >= ms.length) break  // 모든 부위를 훑어도 진행이 없으면 중단
  }
  const s = await state()
  const why = noMarker ? ' (마커 없음 — 화면 캡처 남김)' : (pressed ? '' : ' (눌렀는데 진행 없음)')
  say(`  ${label}: ${pressed}회 누름${why}  progress=${JSON.stringify(s.progress)}`)
  return s
}

try {
  // ── 진입 ────────────────────────────────────────────────
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

  // ── 최소 문진 (신뢰도 확보용) ─────────────────────────────
  say('── 문진(최소)')
  for (const q of ['안녕하세요, 어디가 불편해서 오셨어요?', '언제부터 아프셨어요?']) {
    await speak(q); await page.waitForTimeout(800)
  }

  // ── 준비 4항목 (발화) ────────────────────────────────────
  say('\n── 준비 항목 (발화)')
  /* ⚠ **노출이 빠지면 부위 마커가 하나도 안 뜬다.** 옷 위로 청진할 수는 없으니
     당연한 동작인데, 처음엔 이 단계를 빼놓고 "진찰이 안 된다"고 오판했다.
     캡처를 보고서야 상의가 배를 덮고 있는 걸 확인했다.

     상의만 올려서도 안 된다 — 평가표의 복부 노출 범위가 "칼돌기~두덩결합"이라
     허리선까지 내려야 배꼽 아래 2분면이 드러난다(clinicalGarments.ts 주석).
     순서도 임상 순서를 따른다: 손위생 → 설명·동의 → 노출 → 가려주기 → 무릎. */
  for (const [label, line] of [
    ['손위생', '손 소독을 하겠습니다'],
    ['설명·동의', '지금부터 배를 진찰하겠습니다. 괜찮으실까요?'],
    ['상의 걷기', '배를 좀 보겠습니다. 상의를 걷어올릴게요'],
    ['허리선 내리기', '바지 허리를 조금 내려주시겠어요?'],
    ['가려주기', '필요한 부분만 보이도록 천을 덮어드릴게요'],
    ['무릎 세우기', '무릎을 세워주시겠어요?'],
  ]) {
    const s = await speak(line)
    const g = await page.evaluate(() => {
      const c = window.__game?.getState?.()?.clinicalGarments
      return c ? `${c.upper}/${c.lower}/drape=${c.privacyDrape}` : '?'
    })
    say(`  ${label}: 진찰기록=${s?.examLog} 완료=${s?.done}/8 pose=${s?.examPose} 옷=${g}`)
    await page.waitForTimeout(1200)
  }
  await page.screenshot({ path: `${OUT}/01_prep.png` })

  // ── 진찰 4항목 (도구 + 부위 클릭) ────────────────────────
  say('\n── 진찰 항목 (도구 + 3D 부위)')
  const tools = [
    ['청진', '복부를 청진하겠습니다', 'auscultation', null],
    ['타진', '배를 두드려보겠습니다', 'percussion', null],
    ['촉진(얕게)', '복부를 얕게 촉진하겠습니다', 'palpation', 'light'],
    ['촉진(깊게)', '복부를 깊게 촉진하겠습니다', 'palpation', 'deep'],
    ['CVA 압통', '옆구리를 두드려보겠습니다', 'cva_tenderness', null],
  ]
  for (const [label, line, tool, pass] of tools) {
    await speak(line)
    const s1 = await waitForTool(tool, pass)
    const okTool = s1.examTool === tool && (!pass || s1.examPass === pass)
    say(`  [${label}] tool=${s1.examTool} pass=${s1.examPass} ${okTool ? '' : '⚠ 요청과 불일치'}`)
    if (!okTool) { say(`     → 건너뜀 (요청: ${tool}${pass ? '/' + pass : ''})`); continue }
    await pressAll(label, HOLD_FOR[tool] ?? HOLD_MS)
    await page.screenshot({ path: `${OUT}/tool_${label.replace(/[^가-힣]/g, '')}.png` })
  }

  const beforeEnd = await state()
  say(`\n진찰 완료 항목: ${beforeEnd.done}/8`)
  say(`상세: ${JSON.stringify(beforeEnd.progress)}`)
  await page.screenshot({ path: `${OUT}/02_exam_done.png` })

  // ── 진찰 종료 → 교육 → 리포트 ────────────────────────────
  say('\n── 진찰 종료 → 교육 → 리포트')
  await click('진찰 마치고 설명하기', 10000)
  await page.waitForTimeout(5000)
  for (let i = 0; i < 8; i++) {
    if (await click('다음', 2500)) { await page.waitForTimeout(1500); continue }
    if (await click('설명 마치기', 2500)) { await page.waitForTimeout(2500); break }
    if (await click('진단 제출하기', 2500)) { await page.waitForTimeout(2500); break }
    break
  }
  await page.waitForTimeout(3000)
  // 진단 선택 → 제출
  await click('요로결석', 4000)
  await page.waitForTimeout(1000)
  await click('진단 제출하기', 6000)
  await page.waitForTimeout(12000)
  await page.screenshot({ path: `${OUT}/03_report.png`, fullPage: true })

  const final = await state()
  say(`\n최종: phase=${final.phase} report=${final.report}`)
  const text = await page.locator('body').innerText()
  const scoreLine = text.replace(/\n+/g, ' ').match(/.{0,40}(병력청취|신체진찰).{0,160}/)
  say(`채점: ${scoreLine ? scoreLine[0] : '(점수 영역을 못 찾음)'}`)
} catch (e) {
  say(`\n❌ 중단: ${e.message}`)
  await page.screenshot({ path: `${OUT}/99_fail.png` }).catch(() => {})
}

say(`\n오류 ${errors.length}건`)
for (const e of [...new Set(errors)].slice(0, 8)) say(`  ${e}`)
fs.writeFileSync(`${OUT}/log.txt`, log.join('\n'))
await browser.close()
