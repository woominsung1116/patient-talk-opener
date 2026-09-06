import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import fs from 'fs'

const OUT = 'scratchpad/clinical-signs-qa'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const dashboard = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
dashboard.on('pageerror', (error) => console.log('[dashboard pageerror]', String(error).slice(0, 400)))

await dashboard.goto('http://127.0.0.1:5173', { waitUntil: 'load', timeout: 40000 })
await dashboard.waitForTimeout(2500)
await dashboard.getByRole('button', { name: /교수자 환자 연출/ }).click()
await dashboard.getByText('환자 연출 스튜디오', { exact: true }).waitFor({ timeout: 20000 })
await dashboard.waitForTimeout(6000)

await dashboard.getByText('손가락 관절염', { exact: true }).click()
await dashboard.waitForTimeout(4500)
await dashboard.screenshot({ path: `${OUT}/01-dashboard-finger-swelling.png` })
await dashboard.getByRole('button', { name: '되돌리기' }).click()
await dashboard.waitForTimeout(1200)

await dashboard.getByText('일측 하지부종', { exact: true }).click()
await dashboard.waitForTimeout(4500)
await dashboard.screenshot({ path: `${OUT}/02-dashboard-unilateral-leg-edema.png` })
await dashboard.getByRole('button', { name: '되돌리기' }).click()
await dashboard.waitForTimeout(1200)

await dashboard.getByText('발진·반상출혈', { exact: true }).click()
await dashboard.waitForTimeout(4500)
await dashboard.screenshot({ path: `${OUT}/03-dashboard-rash-bruise.png` })

// 같은 소견을 교수자 화면이 아니라 학생이 쓰는 실제 진료실 UI에서도 확인한다.
const clinic = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
clinic.on('pageerror', (error) => console.log('[clinic pageerror]', String(error).slice(0, 400)))
await clinic.addInitScript(() => { try { localStorage.setItem('ptg-onboarding-seen-v1', '1') } catch {} })
await clinic.goto('http://127.0.0.1:5173/?camera=patient', { waitUntil: 'load', timeout: 40000 })
await clinic.waitForTimeout(2500)
await clinic.getByRole('button', { name: /증례 선택/ }).click()
const card = clinic.locator('div').filter({ hasText: '박초아' })
  .filter({ has: clinic.getByText('이 환자 진료하기', { exact: true }) }).last()
await card.getByText('이 환자 진료하기', { exact: true }).click()
await clinic.getByText('진료실 들어가기', { exact: true }).waitFor({ timeout: 20000 })
await clinic.getByText('진료실 들어가기', { exact: true }).click()
await clinic.waitForFunction(() => window.__game?.getState?.().phase === 'playing', null, { timeout: 30000 })
await clinic.waitForTimeout(2500)
await clinic.evaluate(() => window.__game.getState().startExam())
await clinic.waitForFunction(() => window.__game.getState().phase === 'exam', null, { timeout: 10000 })

const setAppearance = async (patch, statePatch) => clinic.evaluate(({ patch, statePatch }) => {
  const state = window.__game.getState()
  const session = {
    ...state.session,
    patient: {
      ...state.session.patient,
      appearance: { ...state.session.patient.appearance, ...patch },
    },
  }
  window.__game.setState({ session, ...statePatch })
}, { patch, statePatch })

await setAppearance(
  {
    finger_swelling_left: 0.9, finger_swelling_right: 0.78,
    leg_edema_left: 0, leg_edema_right: 0, rash_level: 0, bruise_level: 0,
  },
  { examPose: 'sit_edge', examGesture: 'hands_out', examTool: 'tremor_exam' },
)
await clinic.waitForTimeout(5500)
await clinic.screenshot({ path: `${OUT}/04-clinic-finger-swelling.png` })

await setAppearance(
  {
    finger_swelling_left: 0, finger_swelling_right: 0,
    leg_edema_left: 0.95, leg_edema_right: 0.05, rash_level: 0, bruise_level: 0,
  },
  {
    examPose: 'sit_edge', examGesture: null, examTool: null,
    clinicalGarments: { upper: 'worn', lower: 'rolled', socks: 'removed', shoes: 'removed', privacyDrape: false },
  },
)
await clinic.waitForTimeout(5500)
await clinic.screenshot({ path: `${OUT}/05-clinic-unilateral-leg-edema.png` })

await setAppearance(
  {
    finger_swelling_left: 0, finger_swelling_right: 0, leg_edema_left: 0, leg_edema_right: 0,
    rash_level: 0.86, rash_region: 'torso', bruise_level: 0.78, bruise_region: 'right_arm',
  },
  {
    examPose: 'sit_edge', examGesture: null, examTool: null,
    clinicalGarments: { upper: 'raised', lower: 'worn', socks: 'worn', shoes: 'worn', privacyDrape: false },
  },
)
await clinic.waitForTimeout(5500)
await clinic.screenshot({ path: `${OUT}/06-clinic-rash-bruise.png` })

console.log('[done]', OUT)
await browser.close()
