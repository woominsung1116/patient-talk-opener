/**
 * 포토리얼 환자 — RenderPeople 스캔 모델 (88본 클린 리그, 페이셜 본 포함).
 * 텍스처는 GLB에 임베드되어 있어 별도 jpg 로드 불필요.
 * 본 제어로 앉기/걷기 자세, 눈썹 감정, 턱 립싱크, 눈꺼풀 깜빡임을 구현한다.
 *
 * RenderPeople 본 이름(클린): upperleg_l/r, lowerleg_l/r, foot_l/r,
 * upperarm_l/r, lowerarm_l/r, hand_l/r, shoulder_l/r, spine_01..03,
 * neck, head, jaw, eyelid_l/r, eyebrow_l/r, mouth_l/r.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import type { Emotion } from '../types'
import { getMouthLevel } from '../audio/tts'
import { updatePatientTorso } from './RealisticPatient'
import { useGame } from '../store'

export type RPVariant = 'carla' | 'eric' | 'claudia'

type Bones = Record<string, THREE.Bone>
type InitQuats = Record<string, THREE.Quaternion>

interface FaceCfg {
  browInner: number // +위로(놀람) / -아래로(찡그림)
  browSlant: number // +안쪽이 위(걱정) / -안쪽이 아래(화남)
  mouthCorner: number // +미소 / -울상
  jawIdle: number // 평상시 턱 벌림
  lidDown: number // 0~1 눈 감김
  headTilt: number
  headTurn: number
  headDown: number
}

const FACES: Record<Emotion, FaceCfg> = {
  neutral:           { browInner: 0,    browSlant: 0,    mouthCorner: 0,     jawIdle: 0,    lidDown: 0,    headTilt: 0,     headTurn: 0,    headDown: 0 },
  anxious:           { browInner: 0.5,  browSlant: 0.7,  mouthCorner: -0.25, jawIdle: 0.12, lidDown: 0,    headTilt: -0.03, headTurn: 0,    headDown: 0.06 },
  defensive:         { browInner: -0.2, browSlant: 0.4,  mouthCorner: -0.3,  jawIdle: 0,    lidDown: 0.35, headTilt: -0.05, headTurn: 0.3,  headDown: 0.1 },
  calm:              { browInner: 0.15, browSlant: 0,    mouthCorner: 0.4,   jawIdle: 0,    lidDown: 0,    headTilt: 0,     headTurn: 0,    headDown: 0 },
  warm:              { browInner: 0.3,  browSlant: 0,    mouthCorner: 0.82,  jawIdle: 0.08, lidDown: 0.18, headTilt: 0.05,  headTurn: 0,    headDown: 0 },
  relieved:          { browInner: 0.3,  browSlant: 0.15, mouthCorner: 0.65,  jawIdle: 0,    lidDown: 0.25, headTilt: 0.04,  headTurn: 0,    headDown: 0 },
  hesitant_relieved: { browInner: 0.4,  browSlant: 0.6,  mouthCorner: 0.36,  jawIdle: 0,    lidDown: 0.15, headTilt: -0.05, headTurn: 0,    headDown: 0.1 },
  guarded:           { browInner: 0.2,  browSlant: 0.55, mouthCorner: -0.35, jawIdle: 0,    lidDown: 0.3,  headTilt: -0.07, headTurn: 0.35, headDown: 0.12 },
  hurt:              { browInner: 0.6,  browSlant: 0.8,  mouthCorner: -0.55, jawIdle: 0.08, lidDown: 0.2,  headTilt: -0.06, headTurn: 0,    headDown: 0.1 },
  shocked:           { browInner: 0.9,  browSlant: 0,    mouthCorner: -0.18, jawIdle: 0.35, lidDown: -0.3, headTilt: 0.02,  headTurn: 0,    headDown: -0.05 },
  annoyed:           { browInner: -0.6, browSlant: -0.5, mouthCorner: -0.4,  jawIdle: 0,    lidDown: 0.45, headTilt: 0,     headTurn: -0.12, headDown: 0 },
  thinking:          { browInner: 0.2,  browSlant: 0.2,  mouthCorner: 0,     jawIdle: 0,    lidDown: 0.1,  headTilt: 0.06,  headTurn: 0.25, headDown: -0.03 },
  speaking:          { browInner: 0.1,  browSlant: 0,    mouthCorner: 0.08,  jawIdle: 0.15, lidDown: 0,    headTilt: 0,     headTurn: 0,    headDown: 0 },
}

/* ── 누운 무릎세움(lie_knees) 다리 포즈 튜닝값 (모델 공간: +y머리, -y발, +z배/천장, -z등/침대) ──
   스크린샷 보고 무릎 각도가 어색하면 여기 수치만 조정하면 된다. */
const LIE = {
  thighX: 0.12,  thighY: -0.4,  thighZ: 0.88,  // 허벅지: 무릎 세움
  calfX:  0.05,  calfY:  -0.25, calfZ:  -1.0,   // 종아리: 무릎 아래로 내려 발이 침대 면까지
  footX:  0.04,  footY:  -0.65, footZ:  -0.65,  // 발: 하이힐 특성상 발끝 내림(toe-down) → 신발이 침대에 자연스럽게 닿음
} as const

export function RenderPeoplePatient({
  emotion,
  speaking,
  variant,
  pose,
  walkSpeed = 0,
  gesture = 'none',
}: {
  emotion: Emotion
  speaking: boolean
  variant: RPVariant
  pose: 'walk' | 'sit' | 'lie' | 'lie_knees'
  walkSpeed?: number
  gesture?: 'none' | 'reach'
}) {
  const url = `/avatars/${variant}.glb`
  const { scene } = useGLTF(url)
  const face = FACES[emotion] ?? FACES.neutral
  const group = useRef<THREE.Group>(null)
  const [blink, setBlink] = useState(false)
  const blinkAmount = useRef(0)
  const speechEnergy = useRef(0)
  const gazeMotion = useRef({ x: 0, y: 0, targetX: 0, targetY: 0, nextMove: 0 })
  const motionPhase = useMemo(() => {
    let hash = 0
    for (const char of variant) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return (hash % 628) / 100
  }, [variant])
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())
  // 진찰 단계에서만 몸통 프레임을 공유한다(문진 중엔 보호자 아바타와 서로 덮어쓴다).
  const examActive = useGame((state) => state.phase === 'exam')

  // 모델 복제 (변형 안전) + 스캔 GLB의 원본 KHR specular/PBR 정보를 보존한다.
  // 과거에는 모든 표면을 새 MeshStandardMaterial로 덮어써 스캔 재질의 반사 특성이 소실됐다.
  const model = useMemo(() => {
    const m = skeletonClone(scene) as THREE.Group
    m.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      const tune = (source: THREE.Material) => {
        const cloned = source.clone()
        cloned.userData.patientMaterialOwned = true
        const mat = cloned as THREE.MeshStandardMaterial
        if (!mat.isMeshStandardMaterial) return cloned
        mat.metalness = 0
        mat.roughness = THREE.MathUtils.clamp(mat.roughness, 0.64, 0.82)
        mat.envMapIntensity = 0.34
        mat.dithering = true
        for (const texture of [mat.map, mat.normalMap, mat.roughnessMap]) {
          if (texture) texture.anisotropy = Math.min(12, maxAnisotropy)
        }
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace
        const physical = mat as THREE.MeshPhysicalMaterial
        if (physical.isMeshPhysicalMaterial) {
          physical.ior = 1.4
          physical.specularIntensity = 0.32
          physical.specularColor.set('#fff2eb')
          physical.clearcoat = 0.035
          physical.clearcoatRoughness = 0.82
        }
        const compile = mat.onBeforeCompile
        mat.onBeforeCompile = (shader, renderer) => {
          compile.call(mat, shader, renderer)
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            #ifdef USE_MAP
              float patientScanMicro = sin(vMapUv.x * 311.0 + vMapUv.y * 173.0)
                * sin(vMapUv.x * 137.0 - vMapUv.y * 383.0);
              roughnessFactor = clamp(roughnessFactor + patientScanMicro * 0.01, 0.52, 0.94);
            #endif`,
          )
        }
        mat.customProgramCacheKey = () => 'patient-scan-pbr-v3'
        mat.needsUpdate = true
        return mat
      }
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(tune)
        : tune(mesh.material)
    })
    return m
  }, [scene, maxAnisotropy])

  // 본 맵 + 초기 쿼터니언 저장 (RenderPeople 본 이름은 클린, 정규화 불필요)
  const { bones, init } = useMemo(() => {
    const bones: Bones = {}
    const init: InitQuats = {}
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const k = o.name.toLowerCase()
        if (!bones[k]) {
          bones[k] = o as THREE.Bone
          init[k] = o.quaternion.clone()
        }
      }
    })
    return { bones, init }
  }, [model])

  // 신장 정규화 (Blender에서 1.7m 맞췄지만 안전하게 재확인)
  const fit = useMemo(() => {
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const h = box.max.y - box.min.y
    const s = h > 0 ? 1.7 / h : 1
    return { scale: s, yOff: -box.min.y * s }
  }, [model])

  useEffect(() => {
    let alive = true
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        fn()
      }, ms)
      timers.add(timer)
    }
    const loop = () => {
      later(() => {
        if (!alive) return
        setBlink(true)
        later(() => alive && setBlink(false), 105 + Math.random() * 35)
        if (Math.random() < 0.17) {
          later(() => alive && setBlink(true), 225)
          later(() => alive && setBlink(false), 320)
        }
        loop()
      }, 2300 + Math.random() * 3300)
    }
    loop()
    return () => {
      alive = false
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // 환자 교대 시 GPU 메모리 해제
  useEffect(() => {
    return () => {
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of materials) {
            if (material.userData.patientMaterialOwned) material.dispose()
          }
        }
      })
    }
  }, [model])

  /* 본에 오일러 오프셋 적용 (바인드 포즈 기준 — 리그 바인드 방향에 견고) */
  const E = useMemo(() => new THREE.Euler(), [])
  const Q = useMemo(() => new THREE.Quaternion(), [])
  const TARGET_Q = useMemo(() => new THREE.Quaternion(), [])
  const apply = (key: string, x: number, y: number, z: number, damp = 0) => {
    const b = bones[key]
    const q0 = init[key]
    if (!b || !q0) return
    E.set(x, y, z)
    Q.setFromEuler(E)
    TARGET_Q.copy(q0).multiply(Q)
    if (damp > 0) b.quaternion.slerp(TARGET_Q, damp)
    else b.quaternion.copy(TARGET_Q)
  }

  /* ── 조준(aim) 기반 포즈 (RealisticPatient와 동일 원리) ──
   * 바인드(A포즈)에서 본→자식 방향을 측정해 두고, 임의 골격 축에서도
   * 본을 모델 공간의 원하는 방향(+z 앞, +y 위)으로 정확히 향하게 한다.
   * A포즈 보정(팔 내리기)에 견고하다. */
  const aimData = useMemo(() => {
    model.updateMatrixWorld(true)
    const data: Record<string, { localDir: THREE.Vector3 }> = {}
    const pairs: [string, string][] = [
      ['upperleg_l', 'lowerleg_l'], ['upperleg_r', 'lowerleg_r'],
      ['lowerleg_l', 'foot_l'], ['lowerleg_r', 'foot_r'],
      ['foot_l', 'ball_l'], ['foot_r', 'ball_r'],
      ['upperarm_l', 'lowerarm_l'], ['upperarm_r', 'lowerarm_r'],
      ['lowerarm_l', 'hand_l'], ['lowerarm_r', 'hand_r'],
      ['eye_l', 'eye_end_l'], ['eye_r', 'eye_end_r'],
    ]
    for (const [parent, child] of pairs) {
      const p = bones[parent]
      const c = bones[child]
      if (!p || !c) continue
      data[parent] = { localDir: c.position.clone().normalize() }
    }
    return data
  }, [model, bones])

  const AIM_V = useMemo(() => new THREE.Vector3(), [])
  const AIM_Q = useMemo(() => new THREE.Quaternion(), [])
  const AIM_TARGET_Q = useMemo(() => new THREE.Quaternion(), [])
  const PARENT_Q = useMemo(() => new THREE.Quaternion(), [])
  const ROOT_Q = useMemo(() => new THREE.Quaternion(), [])
  const CAMERA_LOCAL = useMemo(() => new THREE.Vector3(), [])
  const HEAD_LOCAL = useMemo(() => new THREE.Vector3(), [])
  const CAMERA_DIRECTION = useMemo(() => new THREE.Vector3(), [])
  const aim = (key: string, dx: number, dy: number, dz: number, damp: number) => {
    const d = aimData[key]
    const b = bones[key]
    const q0 = init[key]
    if (!d || !b || !q0 || !b.parent || !group.current) return
    group.current.getWorldQuaternion(ROOT_Q)
    AIM_V.set(dx, dy, dz).normalize().applyQuaternion(ROOT_Q)
    b.parent.getWorldQuaternion(PARENT_Q).multiply(q0)
    AIM_V.applyQuaternion(PARENT_Q.invert())
    AIM_Q.setFromUnitVectors(d.localDir, AIM_V)
    AIM_TARGET_Q.copy(q0).multiply(AIM_Q)
    b.quaternion.slerp(AIM_TARGET_Q, damp)
  }

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const dampF = Math.min(1, delta * 7)
    const breath = Math.sin(t * 1.22 + motionPhase) * 0.72
      + Math.sin(t * 0.61 + motionPhase * 1.7) * 0.28
    const rawMouthLevel = speaking ? getMouthLevel() : 0
    const mouthDrive = speaking
      ? rawMouthLevel > 0.02
        ? rawMouthLevel
        : 0.12 + Math.abs(Math.sin(t * 6.4 + motionPhase)) * 0.16
      : 0
    speechEnergy.current = THREE.MathUtils.damp(
      speechEnergy.current,
      mouthDrive,
      speaking ? 10 : 6,
      delta,
    )
    blinkAmount.current = THREE.MathUtils.damp(
      blinkAmount.current,
      blink ? 1 : 0,
      blink ? 34 : 20,
      delta,
    )
    const voice = speechEnergy.current

    let cameraYaw = 0
    let cameraPitch = 0
    if (group.current && bones.head) {
      state.camera.getWorldPosition(CAMERA_LOCAL)
      group.current.worldToLocal(CAMERA_LOCAL)
      bones.head.getWorldPosition(HEAD_LOCAL)
      group.current.worldToLocal(HEAD_LOCAL)
      CAMERA_DIRECTION.subVectors(CAMERA_LOCAL, HEAD_LOCAL).normalize()
      cameraYaw = Math.atan2(CAMERA_DIRECTION.x, CAMERA_DIRECTION.z)
      cameraPitch = Math.atan2(
        CAMERA_DIRECTION.y,
        Math.hypot(CAMERA_DIRECTION.x, CAMERA_DIRECTION.z),
      )
    }
    const gaze = gazeMotion.current
    if (t >= gaze.nextMove) {
      const guarded = emotion === 'defensive'
        || emotion === 'guarded'
        || emotion === 'annoyed'
        || emotion === 'thinking'
      const away = Math.random() < (guarded ? 0.34 : 0.1)
      gaze.targetX = (Math.random() * 2 - 1) * (away ? 0.12 : 0.024)
      gaze.targetY = (Math.random() * 2 - 1) * (away ? 0.05 : 0.017)
      gaze.nextMove = t + (away ? 0.55 + Math.random() * 0.85 : 1.4 + Math.random() * 2.7)
    }
    const attention = emotion === 'defensive' || emotion === 'guarded' || emotion === 'annoyed'
      ? 0.42
      : 1
    gaze.x = THREE.MathUtils.damp(
      gaze.x,
      THREE.MathUtils.clamp(cameraYaw * attention + gaze.targetX, -0.16, 0.16),
      18,
      delta,
    )
    gaze.y = THREE.MathUtils.damp(
      gaze.y,
      THREE.MathUtils.clamp(cameraPitch * attention + gaze.targetY, -0.095, 0.095),
      18,
      delta,
    )
    const postureDrift = Math.sin(t * 0.37 + motionPhase) * 0.008

    // ── 자세 (aim: 모델 공간 방향 +z 앞, +y 위. A포즈 보정에 견고) ──
    // 위엄있고 자연스러운 걸음: 적당한 보폭, 무릎 굽힘, 반대 팔 스윙.
    const w = Math.sin(t * 5.0) * walkSpeed
    const wAbs = Math.abs(w)
    const stepCounter = Math.sin(t * 10.0 + motionPhase)
    if (pose === 'walk') apply('hip', stepCounter * 0.008, w * 0.018, w * 0.024, dampF)
    else apply('hip', 0, postureDrift * 0.12, postureDrift * 0.18, dampF)
    apply('shoulder_l', 0, 0, breath * 0.0022, dampF)
    apply('shoulder_r', 0, 0, -breath * 0.0022, dampF)
    if (pose === 'walk') {
      // 다리: 앞으로 디딜 때 +z, 뒤로 보낼 때 -z + 무릎 굽힘. 보폭 절제.
      aim('upperleg_l', 0.03, -1, w * 0.32, dampF)
      aim('upperleg_r', -0.03, -1, -w * 0.32, dampF)
      // 종아리: 디딤발은 곧게, 뒷발 들어올릴 때만 굽힌다(자연스러운 굴곡)
      aim('lowerleg_l', 0.03, -1, 0.06 + Math.max(0, -w) * 0.85, dampF)
      aim('lowerleg_r', -0.03, -1, 0.06 + Math.max(0, w) * 0.85, dampF)
      aim('foot_l', 0.03, -0.35, 1, dampF)
      aim('foot_r', -0.03, -0.35, 1, dampF)
      // 팔: 다리 반대 스윙(작게), 위팔 몸 옆으로 내림
      aim('upperarm_l', 0.14, -1, -w * 0.22, dampF)
      aim('upperarm_r', -0.14, -1, w * 0.22, dampF)
      // 팔뚝 살짝 굽힘 — 걸을 때 팔 흔들림에 따라
      aim('lowerarm_l', 0.08, -1, -w * 0.18 + 0.3, dampF)
      aim('lowerarm_r', -0.08, -1, w * 0.18 + 0.3, dampF)
      // 상체 미세한 좌우/상하 흔들림으로 생동감
      apply('spine_01', 0.02 + wAbs * 0.015, 0, w * 0.04, dampF)
    } else if (pose === 'sit') {
      // ── 앉기 ── 허벅지 수평 앞으로(+z), 종아리 수직 아래(-y), 팔 옆으로 내려 손은 무릎 위
      aim('upperleg_l', 0.1, -0.12, 1, dampF)
      aim('upperleg_r', -0.1, -0.12, 1, dampF)
      aim('lowerleg_l', 0.04, -1, 0.12, dampF)
      aim('lowerleg_r', -0.04, -1, 0.12, dampF)
      aim('foot_l', 0.04, -0.2, 1, dampF)
      aim('foot_r', -0.04, -0.2, 1, dampF)
      // 팔: 위팔 몸 옆으로 내림(-y, 살짝 앞 +z), 팔뚝 앞으로 굽혀 손을 무릎 위로
      aim('upperarm_l', 0.16, -0.95, 0.18 + postureDrift, dampF)
      aim('lowerarm_l', 0.05, -0.55, 0.85 + postureDrift * 0.6, dampF)
      if (gesture === 'reach') {
        // 의사에게 손을 내미는 동작 — 오른팔을 앞으로 쭉 (+z 전방, 거의 수평)
        aim('upperarm_r', -0.12, -0.3, 0.95, dampF)
        aim('lowerarm_r', -0.04, 0.02, 1, dampF)
        aim('hand_r', -0.04, 0.05, 1, dampF)
      } else {
        aim('upperarm_r', -0.16, -0.95, 0.18 - postureDrift, dampF)
        aim('lowerarm_r', -0.05, -0.55, 0.85 - postureDrift * 0.6, dampF)
      }
      // 살짝 앞으로 숙인 자세
      apply('spine_01', 0.06 + breath * 0.01, 0, 0, dampF)
    } else {
      // ── 누움(진찰대) ── 환자 group이 parent에서 X축 -90°로 눕혀진다.
      //   여기서는 '모델 공간'(+y=머리쪽, -y=발쪽, +z=배(천장), -z=등(침대)) 기준으로만 포즈한다.
      //   aim()이 group의 월드 회전을 반영하므로 누운 상태에서도 방향이 올바르게 적용된다.
      // 팔: 몸통 옆에 가지런히 (발쪽 -y, 바깥쪽 살짝)
      aim('upperarm_l', 0.22, -1, 0.05, dampF)
      aim('upperarm_r', -0.22, -1, 0.05, dampF)
      aim('lowerarm_l', 0.12, -1, 0.06, dampF)
      aim('lowerarm_r', -0.12, -1, 0.06, dampF)
      if (pose === 'lie_knees') {
        // 무릎 세움: 허벅지를 배쪽(+z=천장)으로 들고, 종아리를 머리쪽(+y)·침대쪽(-z)으로 접어 발바닥을 침대에.
        aim('upperleg_l', LIE.thighX, LIE.thighY, LIE.thighZ, dampF)
        aim('upperleg_r', -LIE.thighX, LIE.thighY, LIE.thighZ, dampF)
        aim('lowerleg_l', LIE.calfX, LIE.calfY, LIE.calfZ, dampF)
        aim('lowerleg_r', -LIE.calfX, LIE.calfY, LIE.calfZ, dampF)
        aim('foot_l', LIE.footX, LIE.footY, LIE.footZ, dampF)
        aim('foot_r', -LIE.footX, LIE.footY, LIE.footZ, dampF)
      } else {
        // 다리 곧게 폄 — 발쪽(-y)으로, 살짝 벌림
        aim('upperleg_l', 0.05, -1, 0.02, dampF)
        aim('upperleg_r', -0.05, -1, 0.02, dampF)
        aim('lowerleg_l', 0.02, -1, 0.05, dampF)
        aim('lowerleg_r', -0.02, -1, 0.05, dampF)
        aim('foot_l', 0.02, -0.4, 1, dampF)
        aim('foot_r', -0.02, -0.4, 1, dampF)
      }
      // 척추는 평평하게 유지 (호흡만 미세하게)
      apply('spine_01', breath * 0.01, 0, 0, dampF)
    }

    // ── 머리/호흡/눈맞춤 ── 서로 다른 주기를 섞어 반복 기계 동작을 줄인다.
    const speechNod = Math.sin(t * 4.1 + motionPhase) * voice * 0.026
    const microNod = Math.sin(t * 0.73 + motionPhase) * 0.004
      + Math.sin(t * 0.21 + motionPhase * 1.8) * 0.002
    const headPitch = face.headDown + breath * 0.006 + microNod + speechNod
      + cameraPitch * 0.05 * attention
    const headTurn = face.headTurn
      + THREE.MathUtils.clamp(cameraYaw, -0.12, 0.12) * 0.16 * attention
      + Math.sin(t * 0.24 + motionPhase) * 0.012
    const headRoll = face.headTilt + Math.sin(t * 0.31 + motionPhase * 0.7) * 0.007
    apply('head', headPitch, headTurn, headRoll, dampF)
    apply('neck', headPitch * 0.17, headTurn * 0.12, -headRoll * 0.1, dampF)
    if (pose !== 'sit') apply('spine_02', breath * 0.007 + voice * 0.004, 0, postureDrift * 0.15, dampF)
    else apply('spine_02', 0.04 + breath * 0.007 + voice * 0.004, 0, postureDrift * 0.15, dampF)
    const eyeX = Math.tan(gaze.x)
    const eyeY = Math.tan(gaze.y)
    aim('eye_l', eyeX, eyeY, 1, Math.min(1, delta * 18))
    aim('eye_r', eyeX, eyeY, 1, Math.min(1, delta * 18))

    // ── 눈썹 (감정) ──
    const browUp = face.browInner
    apply('eyebrow_l', -browUp * 0.18 - face.browSlant * 0.08, 0, 0, dampF)
    apply('eyebrow_r', -browUp * 0.18 - face.browSlant * 0.08, 0, 0, dampF)
    apply('mouth_l', face.mouthCorner * -0.085, 0, 0, dampF)
    apply('mouth_r', face.mouthCorner * -0.085, 0, 0, dampF)

    // ── 턱 (립싱크) ──
    // 립싱크: 실제 음성 진폭 기반 (없으면 약한 폴백). RenderPeople 턱은 X축, 영향이 약해 진폭을 키움
    const jaw = speaking
      ? rawMouthLevel > 0.02
        ? 0.05 + rawMouthLevel * 0.68
        : 0.05 + voice * 0.62
      : face.jawIdle * 0.2
    apply('jaw', jaw, 0, 0, dampF * 2.4)

    // ── 눈꺼풀 (깜빡임 + 감정) ──
    const lid = Math.max(blinkAmount.current * 0.4, Math.max(0, face.lidDown) * 0.25)
    apply('eyelid_l', lid, 0, 0, 1)
    apply('eyelid_r', lid, 0, 0, 1)

    /* 복부·옆구리 진찰 앵커 — RealisticPatient와 같은 PATIENT_TORSO 객체를 채운다(객체를 두 개 두지 않는다).
       RenderPeople 리그는 골반이 'hip', 가슴이 'spine_03', 넓적다리가 'upperleg_l/r'이다.
       포즈를 다 적용한 뒤 마지막에 계산해야 그 프레임의 실제 자세가 반영된다. */
    if (examActive) {
      updatePatientTorso(
        bones.hip,
        bones.spine_03 ?? bones.spine_02,
        bones.upperleg_l,
        bones.upperleg_r,
        pose === 'lie' || pose === 'lie_knees',
      )
    }
  })

  return (
    <group ref={group} scale={fit.scale} position={[0, fit.yOff, 0]}>
      <primitive object={model} />
    </group>
  )
}
