import { chromium } from '/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/node_modules/playwright/index.mjs'
import fs from 'fs'
const OUT=process.argv[2]||'scratchpad/faceshot'
const JOBS=process.argv.slice(3)
fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true})
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=metal']})
const p=await b.newPage({viewport:{width:800,height:900},deviceScaleFactor:3})
for(const j of JOBS){
  const i=j.indexOf('='); const label=j.slice(0,i), q=j.slice(i+1)
  await p.goto(`http://localhost:5173/?${q}`,{waitUntil:'load',timeout:40000})
  await p.waitForTimeout(9000)
  await p.screenshot({path:`${OUT}/${label}.png`}); console.log(label,'ok')
}
await b.close()
