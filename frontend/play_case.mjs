// 요로결석 케이스 자동 플레이 → 리포트 스크린샷
// node play_case.mjs <시나리오이름> <질문1;질문2;...> [검사들(,구분)]
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const [, , name, questionsArg, testsArg] = process.argv
const QUESTIONS = questionsArg.split(';').filter(Boolean)
const TESTS = (testsArg || '소변검사,임신반응검사,혈액검사,비조영 복부CT').split(',')
const DIR = '/Users/woominseong/Desktop/최상위/patient-talk-opener/피드백_테스트'
const OUT = `${DIR}/${name}`

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => { try { localStorage.setItem('ptg-onboarding-seen-v1', '1') } catch {} })
page.setDefaultTimeout(25000)
const shot = (tag) => page.screenshot({ path: `${OUT}_${tag}.png` }).catch(() => {})

const clickBtn = (label) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes(t))
  if (b) { b.click(); return true }
  return false
}, label)

try {
  await page.goto('http://localhost:5173')
  await page.waitForTimeout(1500)
  for (let i = 0; i < 10; i++) {
    if (await clickBtn('증례 선택')) break
    await page.waitForTimeout(800)
  }
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('이 환자 진료하기')),
    { timeout: 20000 },
  )

  // 요로결석(박초아) 카드의 진료 버튼을 JS로 탐색·클릭
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('이 환자 진료하기'))
    for (const b of btns) {
      let n = b.parentElement
      for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
        if (n.textContent?.includes('박초아') && !n.textContent.includes('영호')) { b.click(); return true }
      }
    }
    return false
  })
  if (!clicked) throw new Error('요로결석 카드 못 찾음')

  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('진료실 들어가기')),
    { timeout: 25000 },
  )
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('진료실 들어가기'))
    b?.click()
  })
  await page.waitForTimeout(2500)

  // 텍스트 입력 모드 열기 — 입력창이 생길 때까지 폴링 클릭
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

  // busy==='thinking' 동안 Enter가 조용히 무시되므로(submitDraft 가드),
  // 질문마다 dialogue가 실제로 2개(내 말+환자 답) 늘어난 것을 확인하고 다음으로 넘어간다.
  // 일시적 네트워크 오류("응답을 받지 못했어요")에 대비해 질문당 1회 재시도.
  const askOnce = async (q) => {
    await page.waitForFunction(
      () => window.__game && window.__game.getState().busy !== 'thinking',
      { timeout: 90000 },
    ).catch(() => {})
    const before = await page.evaluate(() => window.__game.getState().dialogue.length)
    await input.fill(q)
    await input.press('Enter')
    return page.waitForFunction(
      (n) => window.__game.getState().dialogue.length >= n,
      before + 2,
      { timeout: 90000 },
    ).then(() => true).catch(() => false)
  }
  for (const q of QUESTIONS) {
    let ok = await askOnce(q)
    if (!ok) {
      console.log('  [재시도] 응답 누락:', q)
      await page.waitForTimeout(3000)
      ok = await askOnce(q)
      if (!ok) console.log('  [경고] 재시도도 실패:', q)
    }
    await page.waitForTimeout(400)
  }

  // CPX: 신체진찰 시작 → (액션 생략) → 진찰 마치기 → 환자교육 → 최종 제출
  await clickBtn('신체진찰 시작')
  await page.waitForTimeout(3000)
  // EXAM 환경변수: 수행할 진찰 액션 (예: "drape,knee_flex,auscultation,percussion,palpation,cva_tenderness")
  const examActions = (process.env.EXAM ?? '').split(',').filter(Boolean)
  for (const act of examActions) {
    await page.evaluate(async (id) => {
      const g = window.__game
      if (g) await g.getState().doExamAction(id)
    }, act)
    await page.waitForTimeout(2500)
  }
  await clickBtn('진찰 마치고 설명하기')
  await page.waitForSelector('text=진단명', { timeout: 20000 })
  await page.getByPlaceholder('예: 요로결석').fill('요로결석')
  // 교육 토글: EDU 환경변수(;구분)로 지정된 라벨만 켠다 (기본: 핵심 세트)
  const eduItems = (process.env.EDU ?? '갑작스런 측복통;갈비척추각 압통 양성;소변검사;X-ray 및 CT;진통제 우선;자연배출').split(';')
  for (const t of eduItems) {
    await page.evaluate((txt) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes(txt))
      b?.click()
    }, t)
  }
  await clickBtn('진료 마치고 결과 보기')

  await page.waitForTimeout(4000)
  await page.waitForFunction(
    () => /총평|피드백|등급|점수/.test(document.body.innerText),
    { timeout: 150000 },
  ).catch(() => {})
  await page.waitForTimeout(3000)
  // 접힌 섹션(PPI 세부, 학습 포인트, 채점표 등) 모두 펼치기
  await page.evaluate(() => {
    const togglers = [...document.querySelectorAll('button, summary, [role="button"], div')].filter((el) => {
      const t = el.textContent ?? ''
      return (t.includes('PPI') && t.includes('세부')) || t.includes('학습 포인트') || t.includes('펼쳐보기')
    })
    // 가장 안쪽(자식에 같은 토글이 없는) 엘리먼트만 클릭
    for (const el of togglers) {
      const inner = [...el.querySelectorAll('*')].some((c) => togglers.includes(c))
      if (!inner) el.click?.()
    }
  }).catch(() => {})
  await page.waitForTimeout(800)
  // 리포트는 내부 스크롤 컨테이너 — 구간별로 스크롤하며 여러 장 캡처
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 80)
    els.sort((a, b) => b.scrollHeight - a.scrollHeight)
    const el = els[0]
    if (el) { el.setAttribute('data-shot-scroll', '1'); return { h: el.scrollHeight, c: el.clientHeight } }
    return { h: document.body.scrollHeight, c: window.innerHeight }
  })
  const step = Math.max(200, Math.floor(info.c * 0.85))
  let part = 1
  for (let y = 0; y < info.h - 60 && part <= 8; y += step, part++) {
    await page.evaluate((yy) => {
      const el = document.querySelector('[data-shot-scroll]')
      if (el) el.scrollTo(0, yy)
      else window.scrollTo(0, yy)
    }, y)
    await page.waitForTimeout(450)
    await page.screenshot({ path: `${OUT}_${part}.png` })
  }
  // 통짜 캡처 — 스크롤 컨테이너의 높이 제한을 풀어 피드백 화면 전체를 한 장으로 (HTML 리포트용)
  await page.evaluate(() => {
    let el = document.querySelector('[data-shot-scroll]')
    while (el && el !== document.documentElement) {
      el.style.maxHeight = 'none'
      el.style.height = 'auto'
      el.style.overflow = 'visible'
      el = el.parentElement
    }
    document.documentElement.style.height = 'auto'
    document.body.style.height = 'auto'
  }).catch(() => {})
  await page.waitForTimeout(500)
  await page.locator('[data-shot-scroll]').screenshot({ path: `${OUT}_full.png`, timeout: 20000 }).catch((e) => console.log('  [경고] 통짜 캡처 실패:', String(e).slice(0, 80)))

  // 리포트 전체를 JSON으로 덤프 — HTML 요약 리포트 생성용 (스크린샷 잘림 보완)
  const reportData = await page.evaluate(() => window.__game?.getState()?.report ?? null)
  const meta = process.env.META ? JSON.parse(process.env.META) : {}
  writeFileSync(`${OUT}_report.json`, JSON.stringify({ name, meta, questions: QUESTIONS, exam_done: examActions, report: reportData }, null, 1))
  console.log('DONE', name, 'parts:', part - 1)
} catch (e) {
  await shot('실패시점')
  console.log('FAIL', name, String(e).slice(0, 200))
} finally {
  await browser.close()
}
