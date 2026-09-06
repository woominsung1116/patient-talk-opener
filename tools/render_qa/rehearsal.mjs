/* 시연 전체 리허설 — 문진 → 신체진찰 → 진단 → 교육 → 리포트를 UI로 끝까지 통과시킨다.
 *
 * 목적은 "예쁘게 나오나"가 아니라 **어디서 끊기나**다.
 * 그래서 콘솔/페이지 오류를 전부 모으고, 단계마다 스크린샷을 남기고,
 * 진행이 막히면 그 지점을 명시적으로 보고한다.
 *
 *   node scratchpad/rehearsal.mjs <출력폴더> <케이스검색어>
 */
import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'
import path from 'path'

const OUT = process.argv[2] || 'scratchpad/rehearsal'
const CASE_QUERY = process.argv[3] || '박초아'
const DX = process.env.DX || '요로결석'
const EXAM_SPEECH = (process.env.EXAM || '손 소독을 하겠습니다|복부를 촉진하겠습니다|복부를 청진하겠습니다|배를 두드려보겠습니다').split('|')

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const errors = []
const log = []
let step = 0
const say = (m) => { console.log(m); log.push(m) }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`))
page.on('requestfailed', (r) => {
  const u = r.url()
  if (!u.startsWith('data:') && !u.startsWith('blob:')) {
    errors.push(`[netfail] ${r.failure()?.errorText} ${u.slice(0, 160)}`)
  }
})
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url().slice(0, 160)}`)
})

async function shot(name) {
  const file = path.join(OUT, `${String(++step).padStart(2, '0')}_${name}.png`)
  await page.screenshot({ path: file })
  say(`  📸 ${path.basename(file)}`)
}

/** 보이는 요소를 텍스트로 찾아 누른다. 없으면 false. */
async function click(text, { timeout = 4000 } = {}) {
  try {
    const el = page.locator(`text=${text}`).first()
    await el.waitFor({ state: 'visible', timeout })
    await el.click({ force: true })
    return true
  } catch { return false }
}

/** 앱 스토어에서 직접 상태를 읽는다(`window.__game`, store.ts 말미의 디버그 훅).
 *  ⚠ 화면 텍스트로 진행을 판정하면 안 된다 — **상단 타이머가 매초 바뀌어서**
 *  응답이 안 왔는데도 왔다고 오판한다(1차 리허설에서 5문항이 전부 "응답 1초"로
 *  통과했지만 실제로는 1턴만 돌아 있었다). DOM 문구도 단계마다 사라진다. */
async function state() {
  return page.evaluate(() => {
    const g = window.__game
    if (!g) return null
    const s = g.getState()
    const done = Object.values(s.examProgress || {}).filter((p) => p && p.remaining && p.remaining.length === 0).length
    return {
      phase: s.phase, turn: s.turn, dialogue: (s.dialogue || []).length,
      busy: s.busy, examBusy: s.examBusy, examPose: s.examPose,
      examLog: (s.examLog || []).length, examItems: (s.examItems || []).length,
      patientTurns: (s.dialogue || []).filter((d) => d.speaker === 'patient').length,
      examDone: done, gameOver: s.gameOver, report: !!s.report, error: s.error,
      lastPatient: (s.dialogue || []).filter((d) => d.speaker === 'patient').slice(-1)[0]?.text ?? null,
      facts: (s.disclosedFacts || []).map((f) => f.label || f.key),
      trust: s.trust,
    }
  })
}

/** 환자에게 한마디 하고 **대화 턴이 늘 때까지** 기다린다. */
async function speak(text, waitMs = 120000) {
  if (!(await page.locator('input[placeholder="환자에게 할 말을 입력하세요..."]').count())) {
    if (!(await click('키보드로 입력할래요'))) return { ok: false, why: '텍스트 입력 진입 실패' }
    await page.waitForTimeout(600)
  }
  const box = page.locator('input[placeholder="환자에게 할 말을 입력하세요..."]').first()
  const b = await state()
  if (!b) return { ok: false, why: 'window.__game 없음 (프로덕션 빌드?)' }
  await box.fill(text)
  await box.press('Enter')
  const t0 = Date.now()
  while (Date.now() - t0 < waitMs) {
    await page.waitForTimeout(1500)
    const s = await state()
    if (!s) continue
    /* ⚠ `dialogue.length` 로 판정하면 **내가 보낸 말이 append 되는 순간** 성공으로 친다.
       환자 발화(speaker==='patient')가 늘어야 진짜 응답이다. */
    if (s.patientTurns > b.patientTurns || s.examLog > b.examLog || s.phase !== b.phase) {
      return { ok: true, ms: Date.now() - t0, s }
    }
    if (s.error) return { ok: false, why: `store.error: ${s.error}` }
  }
  const s = await state()
  return { ok: false, why: `무반응(${Math.round(waitMs / 1000)}초). phase=${s?.phase} busy=${s?.busy} dialogue=${s?.dialogue}` }
}

try {
  // ── 1. 타이틀 → 증례 선택 ────────────────────────────────
  say('\n── 1. 타이틀')
  await page.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(6000)
  await shot('title')

  if (!(await click('증례 선택'))) throw new Error('증례 선택 버튼 없음')
  await page.waitForTimeout(2500)
  await shot('case_library')

  /* 증례 도감은 **진단명이 아니라 환자 이름**으로 나열된다(스포일러 방지).
     요로결석 = 박초아 / 갑상샘 = 수진. 그래서 이름이 든 카드를 찾아 그 안의 버튼을 누른다. */
  say(`\n── 2. 증례 선택: ${CASE_QUERY}`)
  const card = page.locator('div')
    .filter({ hasText: CASE_QUERY })
    .filter({ has: page.locator('button:has-text("이 환자 진료하기")') })
    .last()
  await card.waitFor({ state: 'visible', timeout: 8000 })
  await card.locator('button:has-text("이 환자 진료하기")').first().click({ force: true })
  await page.waitForTimeout(5000)
  await shot('receipt')

  // ── 3. 접수증 → 진료실 ───────────────────────────────────
  say('\n── 3. 진료실 입장')
  await click('진료실 들어가기', { timeout: 8000 })
  await page.waitForTimeout(4000)
  for (let i = 0; i < 6; i++) {
    const skipped = await click('건너뛰기', { timeout: 1200 })
    const next = await click('다음', { timeout: 1200 })
    if (!skipped && !next) break
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(6000)
  await shot('clinic')

  // ── 4. 문진 ─────────────────────────────────────────────
  say('\n── 4. 문진')
  /* 앞의 5개는 기본 흐름, 뒤의 4개는 **hidden_facts 를 겨냥한다.**
     기준 케이스에 숨은 단서를 넣어 놓고 리허설이 안 물어보면
     "동작한다"는 근거가 하나도 안 남는다. 공감 한마디를 먼저 두는 것도
     의도적이다 — fear_of_cancer 는 requires_empathy 라 그게 없으면 안 열린다. */
  const questions = [
    '안녕하세요, 어디가 불편해서 오셨어요?',
    '언제부터 아프셨어요?',
    '통증이 어느 쪽으로 뻗치나요?',
    '메스껍거나 토한 적 있으세요?',
    '소변 볼 때 불편한 건 없으셨어요?',
    '가족 중에 요로결석으로 치료받으신 분 계세요?',
    '평소에 수분 섭취는 어떻게 하세요? 직업이 어떻게 되시나요?',
    '오시기 전에 드신 약이 있으세요?',
    '많이 힘드셨겠어요. 이 증상 때문에 특별히 걱정되시는 게 있으세요?',
  ]
  for (const q of questions) {
    const r = await speak(q)
    say(`  "${q}" → ${r.ok ? `${Math.round(r.ms / 1000)}초, 턴${r.s.turn} 환자발화${r.s.patientTurns}` : `❌ ${r.why}`}`)
    if (r.ok && r.s.lastPatient) say(`     환자: "${r.s.lastPatient.slice(0, 70)}"`)
    if (r.ok) say(`     신뢰=${r.s.trust} 단서=[${(r.s.facts || []).join(', ')}]`)
    if (!r.ok) break
    await page.waitForTimeout(1500)
  }
  await shot('history')

  // ── 5. 신체진찰 ──────────────────────────────────────────
  say('\n── 5. 신체진찰 (발화로 유도)')
  const examSpeech = EXAM_SPEECH
  for (const s of examSpeech) {
    const r = await speak(s, 90000)
    say(`  "${s}" → ${r.ok ? `${Math.round(r.ms / 1000)}초` : `❌ ${r.why}`}`)
    await page.waitForTimeout(3000)
    const st = await state()
    if (st) say(`     phase=${st.phase} pose=${st.examPose} 진찰기록=${st.examLog} 완료항목=${st.examDone}/${st.examItems}`)
  }
  await shot('exam')

  // ── 6. 진찰 종료 → 환자교육 ─────────────────────────────
  say('\n── 6. 진찰 종료 → 환자교육')
  if (await click('진찰 마치고 설명하기', { timeout: 10000 })) {
    await page.waitForTimeout(5000)
    await shot('education')
    say(`  phase=${(await state())?.phase}`)
  } else {
    say('  ⚠ "진찰 마치고 설명하기" 버튼 못 찾음')
  }

  // ── 7. 환자교육 입력 ─────────────────────────────────────
  say('\n── 7. 환자교육')
  const edu = page.locator('input[placeholder^="예:"]').first()
  if (await edu.count()) {
    await edu.fill(DX)
    await page.waitForTimeout(500)
  }
  for (let i = 0; i < 10; i++) {
    const st = await state()
    if (st?.report) { say('  ✅ 리포트 도달'); break }
    const moved = (await click('다음', { timeout: 1500 }))
      || (await click('제출', { timeout: 1500 }))
      || (await click('완료', { timeout: 1500 }))
      || (await click('결과 보기', { timeout: 1500 }))
      || (await click('진단 제출하기', { timeout: 1500 }))
      || (await click('마치기', { timeout: 1500 }))
    if (!moved) { say(`  진행 버튼 없음에서 멈춤 (phase=${st?.phase})`); break }
    await page.waitForTimeout(4000)
    await shot(`edu_step${i}`)
  }

  // ── 8. 진단 모달이 뜨면 채운다 ────────────────────────────
  const dx = page.locator('input[placeholder="예: 공황장애"]').first()
  if (await dx.count()) {
    say('\n── 8. 진단 제출')
    await dx.fill(DX)
    await page.waitForTimeout(600)
    await click('다음', { timeout: 3000 })
    await page.waitForTimeout(2500)
    await shot('tests')
    const opts = page.locator('button')
    const n = Math.min(await opts.count(), 60)
    let picked = 0
    for (let i = 0; i < n && picked < 3; i++) {
      const tx = (await opts.nth(i).innerText().catch(() => '')) || ''
      if (/소변|초음파|CT|혈액/.test(tx) && tx.length < 30) {
        await opts.nth(i).click({ force: true }).catch(() => {})
        picked++
      }
    }
    say(`  검사 ${picked}개 선택`)
    for (const b of ['제출', '확인', '완료']) if (await click(b, { timeout: 2000 })) break
    await page.waitForTimeout(8000)
  }

  await page.waitForTimeout(4000)
  await shot('final')
  const fin = await state()
  say(`\n최종: phase=${fin?.phase} report=${fin?.report} gameOver=${fin?.gameOver}`)
  const body = await page.locator('body').innerText()
  say(`화면: ${body.replace(/\s+/g, ' ').slice(0, 240)}`)
} catch (e) {
  say(`\n💥 중단: ${e.message}`)
  await shot('crash')
}

say(`\n════ 오류 ${errors.length}건 ════`)
const uniq = [...new Set(errors)]
for (const e of uniq.slice(0, 40)) say('  ' + e)
if (uniq.length > 40) say(`  ... 외 ${uniq.length - 40}건`)

fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'))
await browser.close()
