/**
 * 기준선 하니스 — 현재 본 씬(`src/three/ClinicScene.tsx`)의 방을 **환자 없이** 두 카메라로 찍는다.
 *
 * 왜 스냅샷을 쓰나: 지금 다른 웨이브가 ClinicScene.tsx를 편집 중이라 라이브로 import하면
 * 기준선이 실험 중 계속 바뀐다. `baseline/ClinicSceneSnapshot.tsx`는 실험 시작 시점의
 * 사본이다(원본 md5 c889656a760c7b052684d6be26e8633d, import 경로만 재작성).
 *
 * 조명·후처리·카메라 파라미터는 본 씬 `ClinicScene`의 <Canvas> 블록을 그대로 복제했다.
 * CeilingPanel은 export가 아니라 같은 코드를 옮겨 적었다.
 */
import { Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Vignette, SMAA, Noise, N8AO, Bloom } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import { Room, SafeEnvironment } from './baseline/ClinicSceneSnapshot'

const CAMS = {
  // 문진 시점 — CAM_BASE / LOOK_CENTER
  seat: { pos: [-1.85, 1.34, 0.95], look: [-0.55, 1.05, 0.1] },
  // 진찰 시점 — EXAM.camPos / EXAM.camLook
  exam: { pos: [1.9, 1.82, -2.72], look: [1.9, 0.95, -3.5] },
  // (추가) 방 전체를 보는 광각 — 두 시점만으로는 공간 판단이 안 돼서 넣었다. 본 씬에는 없는 카메라.
  wide: { pos: [-2.55, 1.95, 0.9], look: [0.6, 1.0, -3.4] },
} as const
type CamKey = keyof typeof CAMS
const camKey: CamKey = (new URLSearchParams(location.search).get('cam') as CamKey) || 'seat'
const CAM = CAMS[camKey]

function CameraFix() {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(CAM.pos[0], CAM.pos[1], CAM.pos[2])
    camera.lookAt(CAM.look[0], CAM.look[1], CAM.look[2])
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}

/* 본 씬 CeilingPanel 그대로 (ROOM.h = 3.0) */
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

/** draw call / 삼각형 / fps 를 HUD에 뿌린다 — 새 씬과 같은 측정 방식.
 *  후처리가 여러 패스를 돌리므로 gl.info.autoReset을 끄고 프레임당 합계를 직접 읽는다
 *  (autoReset이 켜져 있으면 마지막 풀스크린 패스 1콜만 남아 실제보다 훨씬 작게 나온다). */
function Stats() {
  const { gl, scene } = useThree()
  useEffect(() => { gl.info.autoReset = false }, [gl])
  let acc = 0
  let frames = 0
  let calls = 0
  let tris = 0
  useFrame(() => {
    calls = gl.info.render.calls
    tris = gl.info.render.triangles
    gl.info.reset()
  }, 2) // 렌더(priority 1) 뒤에 읽는다
  useFrame((_, dt) => {
    acc += dt
    frames++
    if (acc < 0.5) return
    const fps = frames / acc
    acc = 0
    frames = 0
    let meshes = 0
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++ })
    const el = document.getElementById('hud')
    if (el) {
      el.textContent =
        `BASELINE (현재 본 씬)  cam=${camKey}\n` +
        `fps ${fps.toFixed(1)}\n` +
        `draw calls ${calls}\n` +
        `triangles ${tris.toLocaleString()}\n` +
        `meshes ${meshes}\n` +
        `programs ${gl.info.programs?.length ?? 0}`
      ;(window as unknown as Record<string, unknown>).__labStats = { fps, calls, tris, meshes }
    }
  })
  return null
}

function App() {
  return (
    <Canvas
      shadows
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true
        gl.shadowMap.type = THREE.PCFShadowMap
        gl.outputColorSpace = THREE.SRGBColorSpace
      }}
      camera={{ position: [...CAM.pos] as [number, number, number], fov: 52, near: 0.1, far: 100 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
        preserveDrawingBuffer: true, // 캡처가 검은 프레임으로 나오는 것 방지 (랩 전용)
      }}
      dpr={[1, 1.75]}
      performance={{ min: 0.5 }}
    >
      <SafeEnvironment intensity={0.64} />
      <ambientLight intensity={0.12} color="#f7f8fb" />
      <hemisphereLight args={['#eef4ff', '#6a5544', 0.34]} />
      <directionalLight position={[4.5, 2.6, -0.9]} intensity={0.88} color="#fff2e4" />
      <directionalLight
        position={[1.2, 5, 1.0]}
        intensity={0.5}
        color="#f5f7ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-bias={-0.0004}
        shadow-normalBias={0.018}
      />
      <spotLight
        position={camKey === 'exam' ? [2.2, 2.8, -2.6] : [-1.0, 2.4, 0.7]}
        target-position={camKey === 'exam' ? [1.75, 1.0, -3.5] : [-0.92, 1.08, 0.0]}
        angle={0.58}
        penumbra={1}
        intensity={camKey === 'exam' ? 0.62 : 1.9}
        distance={5.5}
        decay={2}
        color="#fff0e4"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.012}
      />
      <pointLight
        position={camKey === 'exam' ? [1.8, 1.8, -2.6] : [-0.25, 1.45, 0.65]}
        intensity={camKey === 'exam' ? 0.08 : 0.26}
        distance={2.8}
        decay={2}
        color="#f5f7ff"
      />
      {camKey !== 'exam' && (
        <pointLight position={[-1.45, 1.85, -0.9]} intensity={0.42} distance={2.6} decay={2} color="#d8e7ff" />
      )}
      <Suspense fallback={null}>
        <CeilingPanel x={-1.3} z={-1.8} />
        <CeilingPanel x={1.3} z={-1.8} />
        <CeilingPanel x={-1.3} z={-3.8} />
        <CeilingPanel x={1.3} z={-3.8} />
        <Room doorOpenT={0} examMode={camKey === 'exam'} />
      </Suspense>
      <CameraFix />
      <Stats />
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={0.36} intensity={1.18} distanceFalloff={0.8} quality="medium" />
        <Bloom intensity={0.17} luminanceThreshold={1.02} luminanceSmoothing={0.35} mipmapBlur radius={0.45} />
        <SMAA />
        <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.02} />
        <Vignette eskil={false} offset={0.23} darkness={0.24} />
      </EffectComposer>
    </Canvas>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
