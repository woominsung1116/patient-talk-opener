import { chromium } from 'playwright'
const b = await chromium.launch({ args:['--use-angle=metal'] })
const p = await b.newPage({ viewport:{width:1200,height:800} })
p.on('pageerror', e => console.log('PAGEERROR:', e.message))
await p.goto(process.argv[2], { waitUntil:'load', timeout:60000 })
await p.waitForFunction(() => (document.getElementById('out').textContent||'').includes('[skin done]'), { timeout: 180000 }).catch(()=>console.log('(timeout)'))
console.log(await p.evaluate(() => document.getElementById('out').textContent))
await b.close()
