// 두경부 진찰(결막·갑상샘·구강) E2E 비주얼 테스트
// node test_headneck.mjs <케이스키워드> <출력접두어> "<발화1>;<발화2>;..."
// 각 발화 후 제스처가 연출된 시점의 스크린샷을 찍는다.
import { chromium } from 'playwright'

const [, , caseKey, outPrefix, uttArg] = process.argv
const UTTS = uttArg.split(';').filter(Boolean)
const DIR = '/Users/woominseong/Desktop/최상위/patient-talk-opener/피드백_테스트'

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('response', async (res) => {
  if (res.url().includes('/turn')) {
    const j = await res.json().catch(() => null)
    if (j) console.log('  [turn]', j.intent_analysis?.intent)
  }
})
await page.addInitScript(() => { try { localStorage.setItem('ptg-onboarding-seen-v1', '1') } catch {} })
page.setDefaultTimeout(25000)

try {
  await page.goto('http://localhost:5173')
  // vite dev 의존성 최적화로 초기에 한 번 풀 리로드가 올 수 있다 — 안정될 때까지 대기
  await page.waitForTimeout(4500)
  for (let i = 0; i < 10; i++) {
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('증례 선택'))
      b?.click()
      return !!b
    }).catch(() => false)
    if (ok) break
    await page.waitForTimeout(800)
  }
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('이 환자 진료하기')),
    { timeout: 20000 },
  )
  const clicked = await page.evaluate((key) => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('이 환자 진료하기'))
    for (const b of btns) {
      let n = b.parentElement
      for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
        // 조상이 진료 버튼을 2개 이상 품으면 카드 범위를 벗어난 것 — 다음 버튼으로
        const cnt = [...n.querySelectorAll('button')].filter((x) => x.textContent?.includes('이 환자 진료하기')).length
        if (cnt > 1) break
        if (n.textContent?.includes(key)) { b.click(); return true }
      }
    }
    return false
  }, caseKey)
  if (!clicked) throw new Error(`케이스 카드 못 찾음: ${caseKey}`)

  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('진료실 들어가기')),
    { timeout: 25000 },
  )
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('진료실 들어가기'))
    b?.click()
  })
  await page.waitForTimeout(2500)

  let opened = false
  for (let i = 0; i < 25 && !opened; i++) {
    opened = await page.evaluate(() => {
      if (document.querySelector('input[placeholder="환자에게 할 말을 입력하세요..."]')) return true
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('키보드로'))
      b?.click()
      return false
    })
    if (!opened) await page.waitForTimeout(1000)
  }
  if (!opened) throw new Error('텍스트 입력 모드 실패')
  const input = page.getByPlaceholder('환자에게 할 말을 입력하세요...')

  const say = async (q) => {
    // 단계 전환(문진→진찰)으로 입력창이 사라졌으면 '키보드로 입력할래요'를 다시 연다
    for (let k = 0; k < 15; k++) {
      const ok = await page.evaluate(() => {
        if (document.querySelector('input[placeholder="환자에게 할 말을 입력하세요..."]')) return true
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('키보드로'))
        b?.click()
        return false
      })
      if (ok) break
      await page.waitForTimeout(700)
    }
    await page.waitForFunction(
      () => window.__game && window.__game.getState().busy !== 'thinking',
      { timeout: 90000 },
    ).catch(() => {})
    const before = await page.evaluate(() => window.__game.getState().dialogue.length)
    await input.fill(q)
    await input.press('Enter')
    await page.waitForFunction(
      (n) => window.__game.getState().dialogue.length >= n,
      before + 2,
      { timeout: 90000 },
    ).catch(() => console.log('  [경고] 응답 누락:', q))
  }

  // 1) 문진 한 마디 → 진찰 전환
  await say('안녕하세요, 어디가 불편해서 오셨어요?')
  await say('그럼 이제 진찰을 시작하겠습니다. 괜찮으시죠?')
  // request_exam → 2.6초 뒤 startExam
  await page.waitForFunction(
    () => window.__game.getState().phase === 'exam',
    { timeout: 30000 },
  )
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${DIR}/${outPrefix}_0진찰시작.png` })
  console.log('EXAM PHASE:', await page.evaluate(() => {
    const s = window.__game.getState()
    return JSON.stringify({ pose: s.examPose, items: s.examItems.map((i) => i.id), case: s.session?.patient?.name })
  }))

  // 2) 각 발화 → 제스처 캡처
  let i = 1
  for (const utt of UTTS) {
    await say(utt)
    // 제스처가 걸릴 시간 + 카메라 줌 반영
    await page.waitForTimeout(2600)
    const st = await page.evaluate(() => {
      const s = window.__game.getState()
      return { gesture: s.examGesture, log: s.examLog.map((e) => e.action_id), finding: s.lastFinding }
    })
    console.log(`[${i}] "${utt}" gesture=${st.gesture} log=${st.log} finding=${st.finding}`)
    await page.screenshot({ path: `${DIR}/${outPrefix}_${i}.png` })
    await page.waitForTimeout(4500) // 제스처 해제 대기
    i++
  }
  console.log('DONE', outPrefix)
} catch (e) {
  await page.screenshot({ path: `${DIR}/${outPrefix}_실패.png` }).catch(() => {})
  console.log('FAIL', String(e).slice(0, 300))
} finally {
  await browser.close()
}
