import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import type { Emotion } from '../types'
import { usesBoneRig, type AvatarVariant } from './avatarVariant'
import { RealisticPatient, patientTargetHeight, stableUnit } from './RealisticPatient'
import { RenderPeoplePatient } from './RenderPeoplePatient'
import { useGame, type ClinicalGarments } from '../store'

const EMOTIONS: ReadonlySet<string> = new Set([
  'neutral', 'anxious', 'defensive', 'calm', 'warm', 'relieved',
  'hesitant_relieved', 'guarded', 'hurt', 'shocked', 'annoyed',
  'thinking', 'speaking',
])

/** Development-only isolated renderer for deterministic avatar regression QA. */
export function AvatarLab({ variant }: { variant: AvatarVariant }) {
  const query = new URLSearchParams(window.location.search)
  const requestedEmotion = query.get('emotion') ?? 'neutral'
  const emotion = (EMOTIONS.has(requestedEmotion) ? requestedEmotion : 'neutral') as Emotion
  const speaking = query.get('speaking') === '1'
  const freezePose = query.get('freeze') === '1'
  const requestedAsset = query.get('asset')
  const debugAssetUrl = requestedAsset?.startsWith('/avatars/') ? requestedAsset : undefined
  const requestedSkinDebug = query.get('skinDebug')
  const skinDebug = requestedSkinDebug === 'normalOff'
    || requestedSkinDebug === 'albedoOff'
    || requestedSkinDebug === 'mapsOff'
    || requestedSkinDebug === 'recomputeNormals'
    || requestedSkinDebug === 'recomputeFlat'
    ? requestedSkinDebug
    : undefined
  /* 자세 전환 애니메이션 QA 용 런타임 스위치.
     `window.__labPose('lie_knees')` 로 **재로딩 없이** 자세를 바꿔야 전환
     곡선을 연속 촬영할 수 있다. 예전에는 pose 가 view 에 하드코딩돼 있어
     "무릎이 확 올라온다"는 문제를 재현할 방법 자체가 없었다. */
  const [labPoseOverride, setLabPoseOverride] = useState<string | null>(null)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __labPose?: (p: string) => void }).__labPose = setLabPoseOverride
  }, [])

  const requestedGesture = query.get('gesture')
  const gesture = requestedGesture === 'mouth_open' || requestedGesture === 'eyes_up'
    ? requestedGesture
    : null
  const requestedView = query.get('view') ?? 'face'
  const faceView = requestedView === 'face'
  const examView = requestedView === 'exam'
  const exposure = query.get('exposure')
  useEffect(() => {
    const presets: Record<string, ClinicalGarments> = {
      abdomen: { upper: 'raised', lower: 'worn', socks: 'worn', shoes: 'worn', privacyDrape: true },
      upperRemoved: { upper: 'removed', lower: 'worn', socks: 'worn', shoes: 'worn', privacyDrape: true },
      legs: { upper: 'worn', lower: 'rolled', socks: 'worn', shoes: 'worn', privacyDrape: false },
      lowerRemoved: { upper: 'worn', lower: 'removed', socks: 'worn', shoes: 'worn', privacyDrape: true },
      feet: { upper: 'worn', lower: 'worn', socks: 'removed', shoes: 'removed', privacyDrape: false },
    }
    const garments = exposure ? presets[exposure] : undefined
    if (garments) useGame.setState({ phase: 'exam', clinicalGarments: garments })
  }, [exposure])

  /* `?gesture=mouth_open` — 구강 내부를 QA 로 찍을 수 있는 유일한 경로다.
     표정(emotion)으로는 턱이 조금밖에 안 벌어져서 입 안이 거의 안 보인다. */
  useEffect(() => {
    if (!gesture) return
    useGame.setState({ phase: 'exam', examGesture: gesture })
    return () => {
      useGame.setState({ examGesture: null })
    }
  }, [gesture])
  /* 얼굴 컷은 아바타 키를 따라간다. 예전에는 위치·타깃이 1.48/1.43 로 고정이라
     성인 여성(1.62m)에만 맞았다 — 키 큰 남성(mh_m30 = 1.73m)은 턱과 셔츠만,
     아이(mh_boy)는 정수리가 화면 아래에 걸렸다. 17종 얼굴을 훑는 QA에서
     절반이 못 쓰는 컷이었다.

     ⚠ 카메라는 **위치와 타깃을 같이** 올려야 한다. 위치만 올리면 원점을 향한
     내려보기 각도가 더 커져서 피사체가 오히려 프레임 아래로 밀린다 —
     실제로 그렇게 한 번 틀렸다.

     기준값은 추정이 아니라 잘 나오던 f30(1.62m) 컷의 1.43 이고, 키 비율로만
     스케일한다. `?camY=` 로 덮어쓸 수 있다. */
  const FACE_CAM_REFERENCE_HEIGHT = 1.62
  const FACE_CAM_REFERENCE_TARGET = 1.43
  const camYOverride = Number(query.get('camY'))
  const faceTargetY = Number.isFinite(camYOverride) && camYOverride > 0
    ? camYOverride
    : FACE_CAM_REFERENCE_TARGET
      * (patientTargetHeight(variant, undefined, stableUnit(variant))
        / FACE_CAM_REFERENCE_HEIGHT)
  const labPose = (labPoseOverride ?? (examView ? 'lie' : 'walk')) as 'lie' | 'lie_knees' | 'sit' | 'walk'
  const cameraPosition: [number, number, number] = faceView
    ? [0, faceTargetY + 0.05, 0.72]
    : examView
      ? [2.25, 3.15, 2.35]
      : [0, 1.16, 2.45]

  return (
    <div className="h-full bg-[#171a1e]">
      <Canvas
        shadows
        camera={{ position: cameraPosition, fov: faceView ? 32 : 38, near: 0.05, far: 20 }}
        /* ⚠ 톤매퍼는 프로덕션(ClinicScene)과 **같아야** 한다. 예전에는 여기만
           ACESFilmic 이었는데, ACES 는 따뜻하고 채도 높은 색을 주황으로 밀어
           올린다 — 즉 피부색을 판정하려고 찍은 QA 컷이 실제 게임 화면보다
           붉게 나오고 있었다. 노년 아바타가 유독 벌겋게 보였던 원인이 아바타가
           아니라 **QA 도구** 였다. ClinicScene 은 AgX(+노출 1.0)가 기본이다. */
        gl={{
          antialias: true,
          toneMapping: THREE.AgXToneMapping,
          toneMappingExposure: 1.0,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={1}
        onCreated={({ camera, gl }) => {
          camera.lookAt(0, faceView ? faceTargetY : examView ? 0.72 : 0.95, examView ? -0.2 : 0)
          gl.localClippingEnabled = true
          gl.shadowMap.type = THREE.PCFShadowMap
        }}
      >
        <color attach="background" args={['#23282f']} />
        <hemisphereLight args={['#eef5ff', '#403a35', 0.72]} />
        <directionalLight
          position={[2.2, 3.1, 3.2]}
          intensity={2.05}
          color="#fff1e7"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.00035}
          shadow-normalBias={0.018}
        />
        <directionalLight position={[-2.4, 1.8, 1.4]} intensity={0.82} color="#d9e7ff" />
        <pointLight position={[0, 1.55, 1.3]} intensity={0.36} distance={2.4} color="#ffffff" />
        <Suspense fallback={null}>
          <group
            position={examView ? [0, 0.76, 0.68] : [0, 0, 0]}
            rotation={examView ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
          >
            {usesBoneRig(variant) ? (
              <RealisticPatient
                emotion={emotion}
                speaking={speaking}
                variant={variant}
                pose={labPose}
                walkSpeed={0}
                debugSkinSurface={skinDebug}
                debugFreezePose={freezePose}
                debugAssetUrl={debugAssetUrl}
              />
            ) : (
              <RenderPeoplePatient
                emotion={emotion}
                speaking={speaking}
                variant={variant}
                pose={labPose}
                walkSpeed={0}
              />
            )}
          </group>
        </Suspense>
        {examView && (
          <group position={[0, 0.61, -0.18]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[1.15, 0.18, 2.35]} />
              <meshStandardMaterial color="#d9e0dd" roughness={0.86} />
            </mesh>
            <mesh position={[0, 0.105, 0]} receiveShadow>
              <boxGeometry args={[1.08, 0.055, 2.25]} />
              <meshStandardMaterial color="#8ca5a6" roughness={0.78} />
            </mesh>
          </group>
        )}
        {!faceView && !examView && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[8, 8]} />
            <meshStandardMaterial color="#2e343b" roughness={0.92} />
          </mesh>
        )}
      </Canvas>
      <div className="pointer-events-none absolute left-4 top-4 rounded bg-black/55 px-3 py-2 font-mono text-xs text-white/80">
        {variant} · {emotion}{speaking ? ' · speaking' : ''}{examView ? ' · exam' : ''}{exposure ? ` · ${exposure}` : ''}
      </div>
    </div>
  )
}
