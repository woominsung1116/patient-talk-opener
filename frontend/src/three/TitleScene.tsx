/**
 * 타이틀 배경 — 밝은 낮의 진료실 복도를 천천히 전진하는 카메라.
 */
import { Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Vignette, SMAA, Noise, N8AO } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { Room, SafeEnvironment } from './ClinicScene'

/* 카메라는 **반드시 방 안에 있어야 한다.** `ROOM` 은 z ∈ [-5.2, +1.2] 이고
   z = frontZ(1.2) 자리에 정면 벽 슬래브가 서 있다(`clinicRoom.ts` 의 `wallSlab(..., ROOM.frontZ, ...)`).
   종전 값은 z = 2.4 ± 1.1 → **z ∈ [1.3, 3.5] 로 전 구간이 벽 바깥**이었고,
   -Z 를 보고 있으니 화면에 정면 벽 **바깥면**만 가득 찼다(회색 회벽 한 장).
   진료실을 다시 꾸미면서 방 치수가 바뀌었는데 이 카메라만 따라오지 않은 것이다.

   ⚠️ 값을 만질 때 침범하면 안 되는 것들:
     · 정면 벽  z = +1.2   → z 는 1.0 을 넘기지 마라
     · 책상     x = -2.05, z = 0.42
     · 진찰대   x = +1.95, z = -3.5
     · 문       x = -1.4  (뒷벽 z = -5.2)
   그래서 앞쪽 가운데에서 **뒷벽의 문 쪽**을 바라본다 — 방의 안길이와 진찰대가 같이 잡힌다. */
function DriftCamera() {
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const { camera } = state
    camera.position.x = -0.55 + Math.sin(t * 0.08) * 0.30
    camera.position.y = 1.50 + Math.sin(t * 0.06) * 0.05
    camera.position.z = 0.45 + Math.sin(t * 0.045) * 0.40  // z ∈ [0.05, 0.85] — 방 안
    /* **진찰 구역(침대·커튼·수납장·시계)** 쪽을 본다. 왼쪽 뒤(x=-2.9, z=-3.3)의 책장은
       프레임에서 뺀다 — 진료실 가구가 맞긴 하지만 타이틀에서 제일 크게 잡히면
       도서관처럼 읽힌다(사용자 지적 2026-07-26). 방을 고치지 말고 각도를 돌린다. */
    camera.lookAt(1.15 + Math.sin(t * 0.05) * 0.22, 1.15, -3.6)
  })
  return null
}

export function TitleScene() {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 1.5, 2.4], fov: 48 }}
      gl={{ antialias: true }}
      dpr={[1, 1.5]}
    >
      <color attach="background" args={['#c9d6d4']} />
      <fog attach="fog" args={['#c9d6d4', 16, 28]} />
      <hemisphereLight args={['#ffffff', '#9fae9f', 0.75]} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[-6, 4.5, -5]} intensity={1.1} color="#fff3dc" castShadow />
      <SafeEnvironment intensity={0.45} />
      <Suspense fallback={null}>
        <Room doorOpenT={0} />
      </Suspense>
      <DriftCamera />
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={0.45} intensity={1.6} distanceFalloff={0.7} quality="medium" />
        <SMAA />
        <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.2} />
        <Vignette eskil={false} offset={0.2} darkness={0.42} />
      </EffectComposer>
    </Canvas>
  )
}
