import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
const OUT=process.env.OUT||'n1'; import fs from 'fs'; fs.mkdirSync(OUT,{recursive:true})
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=metal']})
const p=await b.newPage({viewport:{width:1280,height:800},deviceScaleFactor:3})
const click=async(t,ms=3000)=>{const l=p.locator(`text=${t}`).first(); try{await l.waitFor({state:'visible',timeout:ms}); await l.click({force:true}); return true}catch{return false}}
await p.goto('http://localhost:5173/?av=mh_m60',{waitUntil:'load',timeout:60000}); await p.waitForTimeout(5000)
await click('증례 선택'); await p.waitForTimeout(2500)
await p.locator('div').filter({hasText:'대학생 (졸업반'}).filter({has:p.locator('button:has-text("이 환자 진료하기")')}).last().locator('button:has-text("이 환자 진료하기")').first().click({force:true})
await p.waitForTimeout(5000); await click('진료실 들어가기',8000); await p.waitForTimeout(4000)
for(let i=0;i<6;i++){const a=await click('건너뛰기',1000),c=await click('다음',1000); if(!a&&!c)break; await p.waitForTimeout(800)}
await p.waitForSelector('text=환자가 자리에 앉았습니다',{timeout:60000}).catch(()=>console.log('no card'))
await p.waitForTimeout(15000)
console.log(await p.evaluate(()=>{const s=window.__game.getState(); return JSON.stringify({name:s.session?.patient?.name,pain:s.session?.patient?.appearance?.pain_level})}))
for(let i=0;i<4;i++){await p.screenshot({path:`${OUT}/f${i}.png`,clip:{x:270,y:230,width:300,height:300}}); await p.waitForTimeout(900)}
await p.screenshot({path:`${OUT}/full.png`})
await b.close()
