/* Draco 디코더 경로 설정(`./dracoLocal`)은 **여기 있으면 안 된다.**
   그 모듈이 `@react-three/drei` 를 정적으로 import 하기 때문에, 엔트리에서
   부르면 three.js + drei 전체가 **첫 청크로 끌려 들어온다** — GameScreen 을
   lazy 로 잘라 놔도 소용이 없었다(엔트리 2.2MB).
   대신 실제로 GLB 를 쓰는 모듈(ClinicScene / RealisticPatient)의 **첫 import**
   로 옮겼다. ES 모듈은 import 를 본문보다 먼저, 선언 순서대로 평가하므로
   모듈 최상위 `useGLTF.preload` 보다 앞선다는 보장은 그대로 유지된다. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
