/* 실제 진료실 씬 캡처 — EffectComposer/포스트프로세싱을 그대로 통과시킨다.
   AvatarLab 은 자체 antialias 캔버스라 헤어 경계가 다르게 보인다. */
import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'
const OUT='scratchpad/clinic'; fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true})
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=metal']})
const p=await b.newPage({viewport:{width:1280,height:800},deviceScaleFactor:2})
p.on('console',m=>{if(m.type()==='error')console.log('  [err]',m.text().slice(0,140))})
for(const av of (process.env.AVS||'mh_f30,mh_f30_thin').split(',')){
  await p.goto(`http://localhost:5173/?av=${av}${process.env.EXTRA||""}`,{waitUntil:'load',timeout:40000})
  await p.waitForTimeout(4000)
  // 타이틀 화면 통과
  for(const label of ['시작','진료 시작','케이스','진료실 들어가기']){
    const el=await p.$(`text=${label}`)
    if(el){ await el.click().catch(()=>{}); await p.waitForTimeout(3000) }
  }
  // 튜토리얼 카드: '건너뛰기'가 span 이라 text= 로는 안 잡힐 때가 있어 좌표로 누른다
  for(let i=0;i<5;i++){
    const skip=await p.$('text=건너뛰기')
    if(skip){ await skip.click({force:true}).catch(()=>{}) }
    const next=await p.$('text=다음')
    if(next){ await next.click({force:true}).catch(()=>{}) } else break
    await p.waitForTimeout(1200)
  }
  await p.waitForTimeout(9000)
  await p.screenshot({path:`${OUT}/${av}.png`})
  console.log(av,'ok')
}
await b.close()
