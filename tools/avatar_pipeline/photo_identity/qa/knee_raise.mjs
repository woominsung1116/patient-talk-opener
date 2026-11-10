import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'
const OUT='knee'; fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT)
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=metal']})
const p=await b.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1})
p.on('pageerror',e=>console.log('PAGEERR',String(e).slice(0,200)))
const click=async(t,ms=3000)=>{const l=p.locator(`text=${t}`).first(); try{await l.waitFor({state:'visible',timeout:ms}); await l.click({force:true}); return true}catch{return false}}
await p.goto('http://localhost:5173/?av=mh_m60&kneeSeconds=16',{waitUntil:'load',timeout:60000}); await p.waitForTimeout(5000)
await click('증례 선택'); await p.waitForTimeout(2500)
await p.locator('div').filter({hasText:'초아'}).filter({has:p.locator('button:has-text("이 환자 진료하기")')}).last().locator('button:has-text("이 환자 진료하기")').first().click({force:true})
await p.waitForTimeout(5000); await click('진료실 들어가기',8000); await p.waitForTimeout(4000)
for(let i=0;i<6;i++){const a=await click('건너뛰기',1000),c=await click('다음',1000); if(!a&&!c)break; await p.waitForTimeout(800)}
await p.waitForSelector('text=환자가 자리에 앉았습니다',{timeout:60000}).catch(()=>console.log('no card'))
await p.waitForTimeout(8000)
console.log(await p.evaluate(()=>{const g=window.__game.getState(); g.startExam(); const s=window.__game.getState(); return JSON.stringify({phase:s.phase,pose:s.examPose,garments:s.clinicalGarments})}))
await p.waitForTimeout(9000); await p.screenshot({path:`${OUT}/00_lying.png`})
await p.evaluate(()=>window.__game.setState({examPose:'lie_knees'}))
await p.screenshot({path:`${OUT}/_warm.png`})
await p.evaluate(()=>{window.__t0=performance.now()})
for(let i=1;i<=12;i++){await p.waitForTimeout(1500); const ms=await p.evaluate(()=>Math.round(performance.now()-window.__t0)); await p.screenshot({path:`${OUT}/f${String(i).padStart(2,'0')}_${ms}.png`})}
await p.waitForTimeout(16000); await p.screenshot({path:`${OUT}/20_up.png`})
await p.evaluate(()=>{const s=window.__game.getState(); window.__game.setState({clinicalGarments:{...s.clinicalGarments,upper:'removed',lower:'lowered',socks:'removed'}})})
await p.waitForTimeout(3500); await p.screenshot({path:`${OUT}/21_undressed.png`})
await b.close()
