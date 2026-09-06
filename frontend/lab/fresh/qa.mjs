// 캡처 + QA 수치. node lab/fresh/qa.mjs <url> <out.png> [wait]
import { chromium } from 'playwright'
const OUT='/private/tmp/claude-501/-Users-woominseong-Desktop----/6719fbd2-d125-4e36-b744-ea010e7e8d6f/scratchpad/merge_qa'
const [,,url,out,waitArg]=process.argv
const b=await chromium.launch({args:['--use-angle=metal']})
const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1})
const errs=[]
p.on('pageerror',e=>errs.push('[pageerror] '+e.message))
p.on('console',m=>{if(m.type()==='error')errs.push('[console] '+m.text().slice(0,160))})
try{
  await p.goto(url,{waitUntil:'load',timeout:60000})
  await p.waitForFunction(()=>window.__qa,{timeout:60000}).catch(()=>{})
  await p.waitForTimeout(Number(waitArg||9000))
  const qa=await p.evaluate(()=>window.__qa||null)
  if(out) await p.screenshot({path: out.startsWith('/')?out:`${OUT}/${out}`})
  console.log(JSON.stringify(qa))
  if(errs.length) console.log('ERR '+errs.slice(0,4).join(' | '))
} finally { await b.close() }
