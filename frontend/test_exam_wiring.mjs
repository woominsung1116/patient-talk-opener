// 신체진찰 브라우저 배선 E2E — "발화 → 인텐트 → 시행 → 서버 기록"이 실제 브라우저에서 끝까지 도는지.
//
// API가 통과해도 브라우저에서 못 하면 학생은 그 진찰을 영원히 시행할 수 없다(검증 실패 #1).
// 그래서 여기서는 window.__game을 조작하지 않고, **사람이 하듯 텍스트로 말해서만** 진행한다.
//
// 사용: node test_exam_wiring.mjs [케이스키워드]
//       인자가 없으면 MVP 흉부·갑상샘·간 케이스를 차례로 돌린다.
import { chromium } from 'playwright'

// 개발 서버(HMR 풀 리로드로 window.__game이 날아간다) 대신 프로덕션 프리뷰를 권장한다.
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

/* 케이스별 시나리오 — 발화만으로 모든 exam_item을 시행할 수 있어야 한다 */
const PLANS = {
  현우: {
    caseKey: '어제 밤에 갑자기 숨이 막히고',
    // 이 케이스엔 복부 청진(auscultation)·촉진(palpation) 항목이 없다.
    // 예전엔 도구가 그대로 선택돼 3D 클릭이 없는 action_id를 서버에 보내 404가 났다.
    toolNegatives: ['청진하겠습니다', '촉진하겠습니다'],
    utterances: [
      ['손소독하겠습니다', 'hand_hygiene'],
      ['가려드릴게요, 상의를 살짝 올리겠습니다', 'drape'],
      ['숨을 크게 쉬어보세요', 'deep_breath'],
      ['심장 소리를 들어보겠습니다', 'heart_auscultation'],
      ['폐 소리를 들어볼게요', 'lung_auscultation'],
      ['양손을 앞으로 뻗어보세요', 'tremor_exam'],
    ],
  },
  수진갑상샘: {
    caseKey: '먹는 건 그대로인데 살이 빠져요',
    utterances: [
      ['손소독하겠습니다', 'hand_hygiene'],
      ['턱을 살짝 들어주세요', 'chin_up'],
      ['침을 한번 삼켜보세요', 'swallow'],
      ['갑상샘을 보겠습니다', 'thyroid_inspect'],
      ['갑상샘을 만져보겠습니다', 'thyroid_palpation'],
      ['양손을 앞으로 뻗어보세요', 'tremor_exam'],
      ['가려드릴게요, 상의를 살짝 올리겠습니다', 'drape'],
      ['심장 소리를 들어보겠습니다', 'heart_auscultation'],
    ],
  },
  수진보조제: {
    caseKey: '가슴이 미친 듯이 뛰고 손이 떨려서',
    utterances: [
      ['손소독하겠습니다', 'hand_hygiene'],
      ['턱을 살짝 들어주세요', 'chin_up'],
      ['침을 한번 삼켜보세요', 'swallow'],
      ['목 앞쪽을 좀 볼게요', 'thyroid_inspect'],   // 부사가 낀 시진 발화 (촉진으로 새면 안 된다)
      ['갑상샘을 만져보겠습니다', 'thyroid_palpation'],
      ['양손을 앞으로 뻗어보세요', 'tremor_exam'],
      ['가려드릴게요, 상의를 살짝 올리겠습니다', 'drape'],
      ['심장 소리를 들어보겠습니다', 'heart_auscultation'],
    ],
  },
  지은: {
    caseKey: '요즘 자꾸 피곤하고 어지러워요',
    // [의학리뷰 #6] 결막과 공막은 평가표상 별개 술기다. 빈혈 케이스에서 "공막" 발화가
    // 결막검사로 둔갑하면 학생은 하지 않은 술기를 했다고 배운다 → 아무것도 기록되면 안 된다.
    negatives: ['공막이 노란지 볼게요'],
    utterances: [
      ['손소독하겠습니다', 'hand_hygiene'],
      ['아— 하고 소리 내주세요', 'say_ah'],
      ['눈 좀 볼게요', 'conjunctiva'],   // 모호한 발화만 케이스가 가진 눈 항목으로 간다
      ['입을 벌려보세요', 'oral_exam'],
    ],
  },
  // 회귀 — 기존 3D 부위 클릭 경로(요로결석 만점 경로)가 그대로 도는지.
  // 도구 선택은 발화로 하고, 부위 '누르기'만 store.examRegion으로 대신한다
  // (포인터 홀드 연출은 ClinicScene 쪽이라 이 테스트의 검증 대상이 아니다).
  요로결석: {
    caseKey: '오른쪽 배가 갑자기 너무 아파서',
    utterances: [
      ['손소독하겠습니다', 'hand_hygiene'],
      ['가려드릴게요, 옷을 살짝 올리겠습니다', 'drape'],
      ['무릎을 세워주세요', 'knee_flex'],
    ],
    toolPlan: [
      { utt: '청진하겠습니다', tool: 'auscultation', clicks: ['ruq', 'luq', 'rlq', 'llq'] },
      { utt: '타진하겠습니다', tool: 'percussion', clicks: ['ruq', 'luq', 'rlq', 'llq'] },
      // 촉진은 얕게 4분면 → 깊게 4분면 (pass는 store가 진행 상태에서 유도한다)
      { utt: '촉진하겠습니다', tool: 'palpation',
        clicks: ['ruq', 'luq', 'rlq', 'llq', 'ruq', 'luq', 'rlq', 'llq'] },
      // 압통 부위(우측)는 반드시 마지막 — 순서를 어기면 채점에서 감점된다
      { utt: 'CVA 압통 확인하겠습니다', tool: 'cva_tenderness', clicks: ['flank_l', 'flank_r'] },
    ],
  },
  영호: {
    caseKey: '기운이 하나도 없어요',  // 성진씨(약인성 간염) 카드와 문구가 거의 같아 뒷부분으로 구분한다
    utterances: [
      ['손소독하겠습니다', 'hand_hygiene'],
      ['공막이 노란지 볼게요', 'sclera_exam'],
      ['양손을 앞으로 뻗어보세요', 'tremor_exam'],
      ['가려드릴게요, 옷을 살짝 올리겠습니다', 'drape'],
      ['무릎을 세워주세요', 'knee_flex'],
      ['숨을 크게 쉬어보세요', 'deep_breath'],
      ['간을 촉진하겠습니다', 'liver_palpation'],
    ],
  },
}

const only = process.argv[2]
const plans = only ? { [only]: PLANS[only] } : PLANS
let failures = []

const browser = await chromium.launch({ args: ['--use-angle=metal'] })

for (const [name, plan] of Object.entries(plans)) {
  if (!plan) { failures.push(`알 수 없는 시나리오: ${name}`); continue }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(() => { try { localStorage.setItem('ptg-onboarding-seen-v1', '1') } catch {} })
  page.setDefaultTimeout(30000)
  const intents = []
  const examErrors = []   // /exam 이 4xx/5xx를 낸 기록 (없는 action_id → 404)
  page.on('response', async (res) => {
    if (res.url().includes('/turn')) {
      const j = await res.json().catch(() => null)
      if (j?.intent_analysis) intents.push(j.intent_analysis.intent)
    }
    if (res.url().includes('/exam') && !res.ok()) examErrors.push(`${res.status()} ${res.url()}`)
  })
  try {
    console.log(`\n=== ${name} (${plan.caseKey}) ===`)
    await page.goto(APP_URL)
    await page.waitForTimeout(4500)
    for (let i = 0; i < 12; i++) {
      const ok = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('증례 선택'))
        b?.click(); return !!b
      }).catch(() => false)
      if (ok) break
      await page.waitForTimeout(800)
    }
    await page.waitForFunction(
      () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('이 환자 진료하기')),
      undefined, { timeout: 25000 })
    const clicked = await page.evaluate((key) => {
      const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('이 환자 진료하기'))
      for (const b of btns) {
        let n = b.parentElement
        for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
          const cnt = [...n.querySelectorAll('button')].filter((x) => x.textContent?.includes('이 환자 진료하기')).length
          if (cnt > 1) break
          if (n.textContent?.includes(key)) { b.click(); return true }
        }
      }
      return false
    }, plan.caseKey)
    if (!clicked) throw new Error(`케이스 카드 못 찾음: ${plan.caseKey}`)

    await page.waitForFunction(
      () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('진료실 들어가기')),
      undefined, { timeout: 30000 })
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('진료실 들어가기'))
      b?.click()
    })
    await page.waitForTimeout(2500)

    // 환자가 진료실로 들어오는 연출(entering)이 끝나야 마이크/입력 UI가 뜬다.
    await page.waitForFunction(
      () => window.__game && window.__game.getState().phase === 'playing',
      undefined, { timeout: 90000 },
    ).catch(async () => {
      const ph = await page.evaluate(() => window.__game?.getState().phase)
      console.log('  [경고] playing 진입 대기 실패, 현재 phase =', ph)
    })

    const openInput = async () => {
      for (let k = 0; k < 20; k++) {
        const ok = await page.evaluate(() => {
          if (document.querySelector('input[placeholder="환자에게 할 말을 입력하세요..."]')) return true
          const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('키보드로'))
          b?.click(); return false
        })
        if (ok) return true
        await page.waitForTimeout(800)
      }
      return false
    }
    if (!await openInput()) throw new Error('텍스트 입력 모드 실패')

    const say = async (q) => {
      await openInput()
      await page.waitForFunction(
        () => window.__game && window.__game.getState().busy !== 'thinking',
        undefined, { timeout: 180000 },
      ).catch(() => {})
      const input = page.getByPlaceholder('환자에게 할 말을 입력하세요...')
      const before = await page.evaluate(() => window.__game.getState().dialogue.length)
      // ⚠ React 제어 입력이라 fill 직후 Enter를 누르면 onKeyDown 클로저의 draft가 아직 ''이라
      //   전송이 조용히 무시된다. 상태 반영을 기다렸다가 누르고, 그래도 안 가면 재시도한다.
      // force: 3D 캔버스/애니메이션 오버레이가 입력창을 덮으면 actionability 검사에서 멈춘다
      for (let a = 0; a < 3; a++) {
        await input.fill(q, { force: true })
        await page.waitForTimeout(450)
        await input.press('Enter', { force: true })
        const sent = await page.waitForFunction(
          (n) => window.__game.getState().dialogue.length >= n, before + 1, { timeout: 8000 },
        ).then(() => true).catch(() => false)
        if (sent) break
        if (a === 2) console.log('  [경고] 전송 실패:', q)
      }
      await page.waitForFunction(
        (n) => window.__game.getState().dialogue.length >= n, before + 2, { timeout: 180000 },
      ).catch(() => console.log('  [경고] 응답 누락:', q))
    }

    await say('안녕하세요, 어디가 불편해서 오셨어요?')
    await say('이제 진찰을 시작하겠습니다. 괜찮으시죠?')
    await page.waitForFunction(
      () => window.__game.getState().phase === 'exam', undefined, { timeout: 60000 },
    )
    await page.waitForTimeout(1500)

    // 케이스에 없는 도구를 말했을 때 — 도구가 선택되면 안 되고 /exam 404도 나면 안 된다
    for (const utt of plan.toolNegatives ?? []) {
      const before = examErrors.length
      await say(utt)
      await page.waitForTimeout(2000)
      const st = await page.evaluate(() => {
        const s = window.__game.getState()
        return { tool: s.examTool, hint: s.examHint, err: s.error }
      })
      const ok = st.tool === null && examErrors.length === before
      console.log(`  ${ok ? '✅' : '❌'} "${utt}" → 도구 미선택·404 없음 (examTool=${st.tool}, 안내: ${st.hint ?? '없음'})`)
      if (!ok) failures.push(`${name}: "${utt}" 가 없는 도구를 선택했거나 404 발생 (${examErrors.slice(before).join(',')})`)
    }

    // 시행되면 안 되는 발화 — 케이스에 없는 술기가 다른 항목으로 둔갑하지 않는지
    for (const utt of plan.negatives ?? []) {
      const before = await page.evaluate(() => window.__game.getState().examLog.length)
      await say(utt)
      await page.waitForTimeout(2500)
      const st = await page.evaluate(() => {
        const s = window.__game.getState()
        return { n: s.examLog.length, log: s.examLog.map((e) => e.action_id), hint: s.examHint }
      })
      const ok = st.n === before
      console.log(`  ${ok ? '✅' : '❌'} "${utt}" → 기록 없음 (안내: ${st.hint ?? '없음'})${ok ? '' : ` log=${st.log}`}`)
      if (!ok) failures.push(`${name}: "${utt}" 가 다른 술기로 기록됨 (${st.log})`)
    }

    for (const [utt, expectId] of plan.utterances) {
      await say(utt)
      // 진찰 기록은 turn 응답 뒤 별도 /exam 호출이라 조금 기다린다
      await page.waitForFunction(
        (id) => window.__game.getState().examLog.some((e) => e.action_id === id),
        expectId, { timeout: 15000 },
      ).catch(() => {})
      const st = await page.evaluate(() => {
        const s = window.__game.getState()
        return { log: s.examLog.map((e) => e.action_id), hint: s.examHint, finding: s.lastFinding }
      })
      const ok = st.log.includes(expectId)
      console.log(`  ${ok ? '✅' : '❌'} "${utt}" → ${expectId}${ok ? '' : `  (log=${st.log} hint=${st.hint})`}`)
      if (!ok) failures.push(`${name}: "${utt}" → ${expectId} 미기록`)
    }

    // 도구 선택(발화) → 부위 클릭 경로
    for (const step of plan.toolPlan ?? []) {
      await say(step.utt)
      await page.waitForFunction(
        (t) => window.__game.getState().examTool === t, step.tool, { timeout: 15000 },
      ).catch(() => {})
      const tool = await page.evaluate(() => window.__game.getState().examTool)
      if (tool !== step.tool) {
        console.log(`  ❌ "${step.utt}" → 도구 ${step.tool} 미선택 (examTool=${tool})`)
        failures.push(`${name}: "${step.utt}" → 도구 ${step.tool} 미선택`)
        continue
      }
      for (const reg of step.clicks) {
        await page.evaluate((r) => window.__game.getState().examRegion(r), reg)
        await page.waitForFunction(() => !window.__game.getState().examBusy,
          undefined, { timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(120)
      }
      const done = await page.evaluate(
        (t) => window.__game.getState().examLog.some((e) => e.action_id === t), step.tool)
      console.log(`  ${done ? '✅' : '❌'} "${step.utt}" + 부위 ${step.clicks.length}회 → ${step.tool}`)
      if (!done) failures.push(`${name}: ${step.tool} 부위 클릭 완료 실패`)
    }

    const final = await page.evaluate(() => {
      const s = window.__game.getState()
      return {
        log: s.examLog.map((e) => e.action_id),
        items: s.examItems.map((i) => i.id),
        violations: s.examSummary?.order_violations ?? [],
      }
    })
    const missing = final.items.filter((i) => !final.log.includes(i))
    console.log(`  시행 ${final.log.length}/${final.items.length}` +
      (missing.length ? ` — 미시행: ${missing}` : ' — 전 항목 시행'))
    if (missing.length) failures.push(`${name}: 미시행 항목 ${missing}`)
    if (final.violations.length) {
      console.log('  순서 위반:', JSON.stringify(final.violations))
      failures.push(`${name}: 순서 위반 ${JSON.stringify(final.violations)}`)
    }
    if (examErrors.length) {
      console.log('  ❌ /exam 오류:', examErrors.join(', '))
      failures.push(`${name}: /exam 오류 ${examErrors.join(', ')}`)
    }
    console.log('  분류된 intent:', intents.join(' → '))
  } catch (e) {
    console.log('  FAIL', String(e).slice(0, 300))
    failures.push(`${name}: ${String(e).slice(0, 160)}`)
  } finally {
    await page.close()
  }
}
await browser.close()
console.log(`\n총 실패 ${failures.length}건`)
failures.forEach((f) => console.log('  ✗', f))
process.exit(failures.length ? 1 : 0)
