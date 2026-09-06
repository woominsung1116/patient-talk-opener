import { chromium } from 'playwright'
const b=await chromium.launch({args:['--use-angle=metal']})
const p=await b.newPage({viewport:{width:800,height:600}})
await p.goto(process.argv[2],{waitUntil:'load',timeout:60000})
await p.waitForTimeout(12000)
console.log(await p.evaluate(()=>{
  const c=document.querySelector('canvas')
  // R3F 내부 store 접근이 안 되면 __gl (ClinicScene DEV 훅) 사용
  const gl=window.__gl
  return JSON.stringify({ hasGl: !!gl, type: gl?.shadowMap?.type, enabled: gl?.shadowMap?.enabled, canvas: !!c })
}))
await b.close()
