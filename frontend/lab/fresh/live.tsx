/**
 * 병합 작업용 라이브 하니스 — **본 씬(`src/three/ClinicScene.tsx`)을 그대로 import** 한다.
 * (기준선 하니스 `baseline.tsx`는 동결 스냅샷을 쓴다. 이건 살아 있는 파일을 본다.)
 *
 * 목적: 톤매핑 추가 후의 노출 재조정을 수치로 하기 위해.
 *  - 255 클리핑 픽셀 비율을 매 프레임 측정해 `window.__qa` 로 노출
 *  - `?exposure=` `?env=` 로 값을 흔들어 A/B
 * 조명·후처리·카메라는 본 씬 <Canvas> 블록을 그대로 복제했다.
 */
import { Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Vignette, SMAA, Noise, N8AO, Bloom, ToneMapping } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { Room, SafeEnvironment, FaceKeyLight } from '../../src/three/ClinicScene'
// @ts-expect-error — 검증 전용 JS 모듈 (타입 없음)
import { loadAvatar } from './avatar.js'

const qs = new URLSearchParams(location.search)
const CAMS = {
  seat: { pos: [-1.85, 1.34, 0.95], look: [-0.55, 1.05, 0.1] },
  exam: { pos: [1.9, 1.82, -2.72], look: [1.9, 0.95, -3.5] },
  wide: { pos: [-2.55, 1.95, 0.9], look: [0.6, 1.0, -3.4] },
} as const
type CamKey = keyof typeof CAMS
const camKey: CamKey = (CAMS[qs.get('cam') as CamKey] ? qs.get('cam') : 'seat') as CamKey
const CAM = CAMS[camKey]
const EXPOSURE = Number(qs.get('exposure') ?? 1.0)
const ENV = Number(qs.get('env') ?? 0.30)
const examMode = camKey === 'exam'
const TM = qs.get('tm') !== '0'
const NOPOST = qs.get('nopost') === '1'   // ?tm=0 → 톤매핑 제거 (수정 전 상태 재현)

/** 검증용 환자 — ?patient=f20_thin|f60_ob|m70. 본 씬 배치(SEAT.sitY/-rotY)를 그대로 쓴다. */
function Patient() {
  const { scene } = useThree()
  const key = qs.get('patient')
  useEffect(() => {
    if (!key) return
    const holder = new THREE.Group()
    holder.position.set(-0.9, -0.41, -0.1)
    holder.rotation.y = -1.1
    scene.add(holder)
    let alive = true
    loadAvatar(`/avatars/mh_${key}.glb`, 'sit').then((av: { root: THREE.Object3D; applyPose: () => void }) => {
      if (!alive) return
      holder.add(av.root)
      av.applyPose()
    })
    return () => { alive = false; scene.remove(holder) }
  }, [scene, key])
  return null
}

function CameraFix() {
  const { camera, gl } = useThree()
  useEffect(() => {
    camera.position.set(CAM.pos[0], CAM.pos[1], CAM.pos[2])
    camera.lookAt(CAM.look[0], CAM.look[1], CAM.look[2])
    camera.updateProjectionMatrix()
    gl.toneMappingExposure = EXPOSURE
  }, [camera, gl])
  return null
}

/* 본 씬 CeilingPanel 사본 (export가 아니라 옮겨 적었다) */
function CeilingPanel({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 3.0 - 0.02, z]}>
      <mesh receiveShadow>
        <boxGeometry args={[1.3, 0.06, 0.7]} />
        <meshStandardMaterial color="#e8ece9" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.035, 0]}>
        <boxGeometry args={[1.18, 0.02, 0.58]} />
        <meshStandardMaterial color="#fff6e8" emissive="#fff1dc" emissiveIntensity={2.0} />
      </mesh>
      <pointLight position={[0, -0.4, 0]} intensity={5} distance={5.5} decay={2} color="#ffe9cc" />
    </group>
  )
}

/** 255 클리핑 비율 + fps/드로콜 측정 */
function QA() {
  const { gl, scene } = useThree()
  useEffect(() => { gl.info.autoReset = false }, [gl])
  let acc = 0, frames = 0, calls = 0, tris = 0
  useFrame(() => { calls = gl.info.render.calls; tris = gl.info.render.triangles; gl.info.reset() }, 2)
  useFrame((_, dt) => {
    acc += dt; frames++
    if (acc < 1.0) return
    const fps = frames / acc; acc = 0; frames = 0
    const c = gl.domElement
    const w = 480, h = Math.round(w * c.height / c.width)
    const off = document.createElement('canvas')
    off.width = w; off.height = h
    const g = off.getContext('2d')!
    g.drawImage(c, 0, 0, w, h)
    const d = g.getImageData(0, 0, w, h).data
    let clip = 0, near = 0, sum = 0
    const n = w * h
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      sum += L
      if (d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254) clip++
      else if (L >= 246) near++
    }
    let meshes = 0
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++ })
    const stat = {
      cam: camKey, exposure: EXPOSURE, env: ENV,
      shadowType: gl.shadowMap.type,   // 2 == PCFSoftShadowMap
      spotTargetsInScene: (() => { let ok = 0, tot = 0
        scene.traverse((o) => { const l = o as THREE.SpotLight
          if (l.isSpotLight) { tot++; if (l.target.parent) ok++ } })
        return `${ok}/${tot}` })(),
      clipPct: +(clip / n * 100).toFixed(2),
      nearClipPct: +(near / n * 100).toFixed(2),
      meanLuma: +(sum / n).toFixed(1),
      fps: +fps.toFixed(1), calls, tris, meshes,
    }
    ;(window as unknown as Record<string, unknown>).__qa = stat
    const el = document.getElementById('hud')
    if (el) {
      el.textContent = `LIVE  cam=${camKey}  exposure=${EXPOSURE}  env=${ENV}  tonemap=${TM}\n`
        + `255 클리핑  ${stat.clipPct}%\n준클리핑(≥246) ${stat.nearClipPct}%\n평균 휘도  ${stat.meanLuma}\n`
        + `fps ${stat.fps}\ndraw calls ${calls}\ntriangles ${tris.toLocaleString()}`
    }
  })
  return null
}

function App() {
  return (
    <Canvas
      shadows="soft"
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true
        gl.outputColorSpace = THREE.SRGBColorSpace
      }}
      camera={{ position: [...CAM.pos] as [number, number, number], fov: 52, near: 0.1, far: 100 }}
      gl={{
        antialias: true, alpha: false, powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: EXPOSURE,
        preserveDrawingBuffer: true,
      }}
      dpr={[1, 1.75]}
      performance={{ min: 0.5 }}
    >
      <SafeEnvironment intensity={ENV} />
      <ambientLight intensity={0.08} color="#f7f8fb" />
      <hemisphereLight args={['#f4f6f4', '#c9c6bf', 0.26]} />
      <directionalLight position={[4.5, 2.6, -0.9]} intensity={0.32} color="#fff2e4" />
      <directionalLight
        position={[1.2, 5, 1.0]} intensity={0.5} color="#f5f7ff" castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4} shadow-camera-right={4}
        shadow-camera-top={4} shadow-camera-bottom={-4}
        shadow-bias={-0.0004} shadow-normalBias={0.018}
      />
      <FaceKeyLight examMode={examMode} />
      <pointLight
        position={examMode ? [1.8, 1.8, -2.6] : [-0.25, 1.45, 0.65]}
        intensity={examMode ? 0.08 : 0.26} distance={2.8} decay={2} color="#f5f7ff"
      />
      {!examMode && (
        <pointLight position={[-1.45, 1.85, -0.9]} intensity={0.42} distance={2.6} decay={2} color="#d8e7ff" />
      )}
      <Suspense fallback={null}>
        <CeilingPanel x={-1.3} z={-1.8} />
        <CeilingPanel x={1.3} z={-1.8} />
        <CeilingPanel x={-1.3} z={-3.8} />
        <CeilingPanel x={1.3} z={-3.8} />
        <Room doorOpenT={0} examMode={examMode} />
      </Suspense>
      <CameraFix />
      <Patient />
      <QA />
      {NOPOST ? null : (
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={0.36} intensity={1.18} distanceFalloff={0.8} quality="medium" />
        <Bloom intensity={0.17} luminanceThreshold={1.02} luminanceSmoothing={0.35} mipmapBlur radius={0.45} />
        {TM ? <ToneMapping mode={ToneMappingMode.ACES_FILMIC} /> : <></>}
        <SMAA />
        <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.02} />
        <Vignette eskil={false} offset={0.23} darkness={0.24} />
      </EffectComposer>
      )}
    </Canvas>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
