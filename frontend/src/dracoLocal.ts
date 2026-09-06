/**
 * Draco 디코더를 **로컬에서** 받게 한다.
 *
 * ⚠ drei 의 기본값은 `https://www.gstatic.com/draco/versioned/decoders/1.5.5/` 다.
 *   우리 아바타 GLB 17종은 전부 `KHR_draco_mesh_compression` 으로 압축돼 있어서,
 *   **시연장에 인터넷이 없거나 gstatic 이 막히면 환자가 한 명도 안 뜬다.**
 *   (2026-07-29 리허설에서 네트워크 로그로 확인 — 외부 의존은 이것 하나였다.)
 *
 * 이 모듈은 **부수효과 전용**이다. `main.tsx` 에서 App 보다 **먼저** import 해야 한다 —
 * ES 모듈은 import 가 본문보다 먼저 평가되므로, App 쪽 모듈 최상위의
 * `useGLTF.preload(...)` 가 실행되기 전에 경로가 박혀 있어야 한다.
 */
import { useGLTF } from '@react-three/drei'

useGLTF.setDecoderPath('/draco/')
