/* 오프라인 시연 검증 — 외부 도메인을 전부 차단하고 아바타가 뜨는지 본다. */
import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'
fs.mkdirSync('scratchpad/offline', { recursive: true })
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const p = await b.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 2 })
const blocked = []
// localhost 이외 전부 차단 = 인터넷 없는 시연장
await p.route('**/*', (route) => {
  const u = route.request().url()
  if (u.startsWith('http') && !u.includes('localhost')) { blocked.push(u); return route.abort() }
  return route.continue()
})
const errs = []
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
await p.goto('http://localhost:5173/?avatarLab=mh_f30&view=face&freeze=1', { waitUntil: 'load', timeout: 60000 })
await p.waitForTimeout(12000)
await p.screenshot({ path: 'scratchpad/offline/f30.png' })
console.log('차단한 외부요청:', [...new Set(blocked.map(u => new URL(u).host))].join(', ') || '(없음)')
console.log('콘솔 오류:', errs.length)
for (const e of [...new Set(errs)].slice(0, 6)) console.log('  ', e)
await b.close()
