/**
 * 진료실 — 우리가 직접 만든 3D 진료실 지오메트리 (의사 1인칭 시점).
 * 병원 HDRI는 배경이 아니라 IBL(이미지 기반 조명)로만 사용한다. 창문 너머로만 살짝 보인다.
 * 입장 컷씬: 노크 → 뒷벽 문이 열림 → 환자가 문에서 의자까지 걸어와 책상 맞은편에 앉는다.
 */
import { Suspense, useEffect, useMemo, useRef, useState, useCallback, Component, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Html, useGLTF, useAnimations } from '@react-three/drei'
import { EffectComposer, Vignette, SMAA, Noise, N8AO, Bloom } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { motion, AnimatePresence } from 'framer-motion'
import * as THREE from 'three'
import { RenderPeoplePatient } from '../../../src/three/RenderPeoplePatient'
import { RealisticPatient, PATIENT_HEAD_WORLD, PATIENT_TORSO } from '../../../src/three/RealisticPatient'
import { usesBoneRig, pickAvatarVariant, type AvatarVariant, type MpfbVariant } from '../../../src/three/avatarVariant'
import { sfxDoor, sfxKnock, sfxStep } from '../../../src/audio/sfx'
import type { Emotion } from '../../../src/types'
import {
  useGame,
  TOOL_REGIONS,
  HOLD_SECONDS,
  examProgressKey,
  ABDOMEN_REGIONS,
  HEADNECK_REGIONS,
  CHEST_REGIONS,
  type ExamRegion,
  type ExamToolId,
} from '../../../src/store'

type EnterStage = 'knock' | 'open' | 'walk' | 'sit' | 'done'
/** 진찰 자세 — store.examPose와 같은 값 집합 (마주 앉기 / 눕기 / 무릎 세워 눕기 / 진찰대 걸터앉기) */
type ExamPose = 'sit' | 'lie' | 'lie_knees' | 'sit_edge'

/* ── 방 치수 (의사 책상 z=0.5 전경, 환자 의자 z=-0.55, 뒷벽 z=-5.2) ── */
const ROOM = {
  w: 6.4, // 좌우 폭 (x: -3.2 ~ 3.2)
  d: 6.6, // 깊이 (z: -5.4 앞쪽벽 뒤 ~ 1.2)
  h: 3.0, // 천장 높이
  backZ: -5.2, // 환자 뒤 벽 (문이 있는 벽)
  frontZ: 1.2, // 의사 등 뒤 벽
}
const DOOR_X = -1.4 // 뒷벽에서 문 중심 x (의자 정중앙을 피해 살짝 왼쪽)
const DOOR_W = 1.05
const DOOR_H = 2.15

/* ════════════════════════════════════════════════════════════════════════
   신체진찰(3D) 튜닝 상수 — 사용자가 스크린샷 보고 조정할 값들을 한곳에 모음.
   ExamBed는 Room에서 position={[1.95,0,-3.5]} rotation={[0,-Math.PI/2,0]} 로 놓임.
   침대는 월드 X축을 따라 길게 눕고(매트 윗면 y=0.68, 페이퍼롤 윗면 y=0.691),
   x는 1.0~2.9, z는 -3.86~-3.14를 차지한다. 머리쪽은 -X 끝이다.

   ── 환자 기준 좌우(중요, 직접 검증함) ──
   모델 기본 리그는 "발 y=0, 머리 +y, 정면 +z"다. 좌우는 RealisticPatient의 sit 포즈에서 확정:
     aim('lthigh', +0.1, …) / aim('rthigh', -0.1, …) → 왼다리가 +x, 오른다리가 -x로 벌어진다.
     즉 모델 로컬에서 환자의 오른쪽 = -x.
   눕히기 변환은 안쪽 group rotation.x=-90°(x축 성분 불변) → 바깥 group rotation.y=+90°이고,
   R_y(+90°)는 (-1,0,0)을 (0,0,+1)로 보낸다.
     ⇒ 앙와위 환자의 **오른쪽은 월드 +z, 왼쪽은 -z**. (머리가 -x인 것은 기존 주석대로 맞다)
   교차검증: 의사 카메라가 z=-2.72(=환자의 +z쪽)에 서는데, 이는 복부진찰의 정석인
   "의사는 환자의 오른쪽에 선다"와 정확히 일치한다.
   ⇒ 스펙 §6.1의 "환자의 오른쪽은 -z" 서술은 실제 모델 방향과 반대이며,
      기존 z 배치(ruq가 z=-3.4 = +z쪽)가 이미 환자 기준으로 옳다. 좌표는 그대로 두고
      region id만 명시적으로 붙인다.
   ════════════════════════════════════════════════════════════════════════ */
const EXAM = {
  // 침대를 우측으로 옮김 → 모든 x를 우측(양수)으로 미러링.
  // 누운 환자 컨테이너: parent group의 월드 위치(= 발 기준점).
  patientPos: [2.65, 0.78, -3.5] as [number, number, number], // 발 기준점(발이 +x). 머리는 -x(왼쪽)
  patientYawY: Math.PI / 2, // 머리가 -x(왼쪽)을 향하도록
  // 카메라(의사 시점): 의사가 침대 옆에서 '대각선'으로 내려다본다. 환자에 조금 더 가깝게(줌인).
  camPos: [1.9, 1.82, -2.72] as [number, number, number],
  camLook: [1.9, 0.95, -3.5] as [number, number, number],
  camLerp: 3.0, // 클로즈업 진입/이탈 보간 속도 (클수록 빠름)
  /* 복부 4분면 클릭 메시 — 머리가 -x이므로 상복부(명치)는 -x쪽, 하복부는 +x쪽. 배꼽 ≈ x1.75
     z는 위 "환자 기준 좌우"대로 +z(-3.4)가 환자의 오른쪽, -z(-3.62)가 환자의 왼쪽이다.
     ⚠ 이 좌표는 이제 **폴백 전용**이다. 실제 위치는 PATIENT_TORSO(몸통 본 프레임)에서 유도한다
     (buildExamAnchors 참고). 아바타마다 다리·몸통 길이가 달라 고정 좌표로는 맞출 수 없어서다.
     본을 못 찾은 경우에만 여기 값이 쓰인다. */
  quadrants: [
    { region: 'ruq', label: '우상복부', pos: [1.55, 0.93, -3.4] as [number, number, number] },
    { region: 'luq', label: '좌상복부', pos: [1.55, 0.93, -3.62] as [number, number, number] },
    { region: 'rlq', label: '우하복부', pos: [1.72, 0.93, -3.4] as [number, number, number] },
    { region: 'llq', label: '좌하복부', pos: [1.72, 0.93, -3.62] as [number, number, number] },
  ],
  quadrantR: 0.07, // 4분면 클릭 구 반지름 (호버 영역)
  // 양측 옆구리/등(CVA 압통) 클릭 메시 — 복부보다 약간 발쪽, 더 바깥(z).
  // 누운 자세용 폴백이다. 실제 CVA는 sitEdge(앉은 자세)에서 등 쪽을 두드린다.
  flanks: [
    { region: 'flank_r', label: '우측 옆구리', pos: [1.78, 0.88, -3.3] as [number, number, number] },
    { region: 'flank_l', label: '좌측 옆구리', pos: [1.78, 0.88, -3.72] as [number, number, number] },
  ],
  flankR: 0.1,
  /* ── 걸터앉은 자세(CVA 압통 §6.3) ──
     평가표는 "갈비척추각압통 ① 앉은 자세"를 요구한다. 환자를 침대 **먼 쪽(-z) 가장자리**에
     엉덩이만 걸치고 앉히고(다리는 -z로 내려뜨림), 몸을 -z로 돌려(yaw=π) 등이 의사(+z)를 향하게 한다.
     이렇게 하면 의사는 원래 서 있던 +z쪽에 그대로 서서 침대 너머로 등을 본다
     (반대로 배치하면 진찰 조명 spotLight[2.2,2.8,-2.6]이 환자 뒤에서 와 등이 역광으로 죽는다).

     y 오프셋 계산근거: 의자 진찰(SEAT)에서 스툴 좌면 y=0.54에 sitY=-0.41을 썼으므로
     모델 로컬 좌면 높이 h = 0.54 + 0.41 = 0.95. 침대 페이퍼롤 윗면이 0.691이므로
     0.691 - 0.95 = -0.259. 화면에서 뜨거나 파묻히면 이 값만 ±조정하면 된다.

     yaw=π이면 환자의 오른쪽은 +x, 왼쪽은 -x다((-1,0,0) → R_y(π) → (+1,0,0)).
     CVA 지점: 좌면에서 위로 ~0.44m(L1 높이), 정중선에서 좌우 0.13m, 등 표면 z≈-3.64. */
  sitEdge: {
    patientPos: [1.95, -0.259, -3.78] as [number, number, number],
    patientYawY: Math.PI, // 등이 +z(의사 쪽)를 향하도록
    camPos: [1.95, 1.52, -2.62] as [number, number, number],
    camLook: [1.95, 1.12, -3.66] as [number, number, number],
    /* 흉부 전면(심장 4판막 · 전면 폐야)은 등이 아니라 가슴을 봐야 한다.
       환자를 돌리지 않고 **의사가 환자 앞쪽으로 돌아간다**(chest 스펙 §4). 걸터앉은 환자의
       다리는 -z로 내려뜨려 있으므로 그 너머(z ≈ -4.7)에 서서 무릎 위로 가슴을 본다.
       진찰 스팟(2.2,2.8,-2.6)은 환자 뒤에서 오므로 이때는 앞쪽 필라이트가 함께 켜진다. */
    camPosFront: [1.95, 1.50, -4.72] as [number, number, number],
    camLookFront: [1.95, 1.18, -3.86] as [number, number, number],
    frontLightPos: [2.18, 1.86, -4.46] as [number, number, number],
    flanks: {
      flank_r: [2.08, 1.13, -3.64] as [number, number, number], // 환자의 오른쪽 = +x
      flank_l: [1.82, 1.13, -3.64] as [number, number, number], // 환자의 왼쪽 = -x
    },
  },
  // 침대 옆 벽걸이 손소독 디스펜서 (우측 벽, 클로즈업 프레임 안)
  sanitizerPos: [3.14, 1.2, -3.0] as [number, number, number],
  sanitizerRotY: -Math.PI / 2,
} as const

/* ── 문진·입장 단계 환자 좌석 튜닝 상수 — 1인칭 화면 기준 완전 왼쪽 대각선 ──
   examMode 때는 환자가 침대로 이동하므로 이 값과 완전히 무관하다.
   스크린샷 확인 후 pos/rotY/camLook/faceLightTarget/keyLightPos 를 조정해라.

   좌표 규칙: 카메라는 z+방향(뒤쪽) → 화면 왼쪽=세계 -x, 화면 오른쪽=세계 +x.
   pos.x 음수 → 화면 왼쪽. rotY 양수 ≈ 환자가 +x(화면 오른쪽, 의사 방향)를 향해 회전. */
const SEAT = {
  pos:             [-0.9, 0, -0.1] as [number, number, number],   // 살짝 뒤(깊은 쪽)로 — 의자가 환자 아래로 보이도록
  rotY:            -1.1,   // 의사(왼쪽 책상)를 확실히 바라보도록 더 돌림 (카메라 눈높이가 높아 더 큰 회전 필요)
  sitY:            -0.41,  // 아바타 앉기 y 오프셋
  camLook:         [-0.92, 1.06, 0.0] as [number, number, number], // 환자 눈높이
  faceLightTarget: [-0.92, 1.08, 0.0] as [number, number, number], // spotLight target (환자 얼굴 따라감)
  keyLightPos:     [-1.0, 2.4, 0.7] as [number, number, number],   // 환자 얼굴 스팟라이트 위치 (창문쪽)
} as const

/* ── 환자 입장 경로: 뒷벽 문 → 의자까지 '직선'으로 쭉 ── */
// 문에서 의자 바로 앞까지 일직선으로 걸어온다(곡선 없음).
// 도착 후 짧은 암전 페이드 동안 의자에 앉은 상태로 전환 → 관통 장면을 보여주지 않는다.
const _DOOR_OUT = new THREE.Vector3(DOOR_X, 0, ROOM.backZ + 0.35)        // 문 출구 (-1.4, -4.85)
const _SEAT_FRONT = new THREE.Vector3(SEAT.pos[0], 0, SEAT.pos[2] - 0.45) // 의자 바로 앞 도착점
const PATH = [
  _DOOR_OUT,
  _DOOR_OUT.clone().lerp(_SEAT_FRONT, 0.5),  // 직선 위 중간점 (탄젠트 안정용)
  _SEAT_FRONT,
]
const CURVE = new THREE.CatmullRomCurve3(PATH)
// 디버그용 워크 지속시간 오버라이드(스크린샷 캡처용). 미설정 시 5.2초.
const WALK_DURATION =
  (typeof window !== 'undefined' && Number((window as unknown as { __WALK_DUR__?: number }).__WALK_DUR__)) || 3.2

/* 병원 HDRI — Poly Haven CC0. background 없이 IBL 조명으로만. 창문으로만 살짝 보인다. */
const HDRI_FILE = '/hdri/hospital_room_2_2k.hdr'

/* HDRI 환경광 — 오프라인 등 로드 실패 시 조용히 생략 */
class EnvBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function SafeEnvironment({ intensity = 1.0 }: { intensity?: number }) {
  return (
    <EnvBoundary>
      <Suspense fallback={null}>
        {/* background 없음 → 우리 3D 방이 보인다. IBL만 담당. */}
        <Environment files={HDRI_FILE} environmentIntensity={intensity} />
      </Suspense>
    </EnvBoundary>
  )
}

/* CC0 실물 모델 배치 헬퍼 — 텍스처/로드 실패가 씬 전체를 죽이지 않게 개별 바운더리로 감싼다 */
function Prop(props: {
  asset: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}) {
  return (
    <EnvBoundary>
      <PropInner {...props} />
    </EnvBoundary>
  )
}

function PropInner({
  asset,
  position,
  rotation = [0, 0, 0],
  scale = 1,
}: {
  asset: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}) {
  const { scene } = useGLTF(`/models/${asset}/${asset}.gltf`)
  const obj = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return c
  }, [scene])
  return <primitive object={obj} position={position} rotation={rotation} scale={scale} />
}

const PROPS = ['metal_office_desk', 'desk_lamp_arm_01', 'GreenChair_01', 'drawer_cabinet', 'wall_clock', 'potted_plant_01', 'metal_trash_can', 'wooden_bookshelf_worn']
PROPS.forEach((p) => useGLTF.preload(`/models/${p}/${p}.gltf`))

/* ── 단일 .glb 로더 + 자동 크기맞춤(fit) + 중심정렬 ──
   스캔 모델은 단위/크기가 제각각이라 maxDim 기준으로 targetSize에 맞춘다.
   방향(rotation)·세부 위치는 호출부에서 조정. */
function FittedGLB({
  url,
  targetSize,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  removeNode,
}: {
  url: string
  targetSize: number
  position?: [number, number, number]
  rotation?: [number, number, number]
  removeNode?: string // 해당 이름의 노드(서브트리)를 제거 — 예: 청진기 튜브만 빼고 체스트피스만
}) {
  const { scene } = useGLTF(url)
  const { obj, s, center } = useMemo(() => {
    const c = scene.clone(true)
    if (removeNode) {
      // three GLTFLoader가 노드 이름의 '.'·공백·대괄호를 '_'로 치환하므로 치환 후 부분일치로 잡는다.
      // (그룹 노드뿐 아니라 그 하위 메시 노드 "..._BlackPlastic_0" 등도 직접 제거되도록 includes 사용)
      const norm = (s: string) => s.replace(/[.\s[\]]/g, '_')
      const target = norm(removeNode)
      const toRemove: THREE.Object3D[] = []
      c.traverse((o) => { if (o.name && norm(o.name).includes(target)) toRemove.push(o) })
      toRemove.forEach((n) => n.parent?.remove(n))
    }
    c.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true }
    })
    const box = new THREE.Box3().setFromObject(c)
    const size = new THREE.Vector3(); box.getSize(size)
    const ctr = new THREE.Vector3(); box.getCenter(ctr)
    const maxd = Math.max(size.x, size.y, size.z) || 1
    return { obj: c, s: targetSize / maxd, center: ctr }
  }, [scene, targetSize, removeNode])
  return (
    <group position={position} rotation={rotation}>
      <group scale={s}>
        <primitive object={obj} position={[-center.x, -center.y, -center.z]} />
      </group>
    </group>
  )
}
useGLTF.preload('/models/stethoscope_u2.glb')
// female_hand.glb 는 더 이상 쓰지 않는다 — 텍스처가 없어 백묵색이고 손목이 잘려 있었다.
// 촉진·타진·CVA는 청진과 같은 doctor_arm.glb(팔+가운 소매)를 쓴다 (PalpationRig).

/* ── PBR 텍스처 로더 (Poly Haven CC0, 2k) ──
   color/normal/rough(/ao) 맵을 한 번만 로드해 캐시하고, 타일링/컬러스페이스를 올바르게 잡는다.
   같은 슬러그를 여러 면이 쓰면 텍스처 인스턴스를 공유한다(메모리/드로콜 절약). */
const TEX = new THREE.TextureLoader()
type PBRSet = { color?: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture; ao?: THREE.Texture }
const pbrCache = new Map<string, PBRSet>()

function loadPBR(base: string, opts: { ao?: boolean; color?: boolean } = {}): PBRSet {
  const cached = pbrCache.get(base)
  if (cached) return cached
  const wantColor = opts.color !== false
  const color = wantColor ? TEX.load(`${base}_diff_2k.jpg`) : undefined
  if (color) color.colorSpace = THREE.SRGBColorSpace
  const normal = TEX.load(`${base}_nor_gl_2k.jpg`)
  const rough = TEX.load(`${base}_rough_2k.jpg`)
  const ao = opts.ao ? TEX.load(`${base}_ao_2k.jpg`) : undefined
  for (const t of [color, normal, rough, ao]) {
    if (!t) continue
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
  }
  const set: PBRSet = { color, normal, rough, ao }
  pbrCache.set(base, set)
  return set
}

/* 평면 1장에 PBR 세트를 적용한 메시 재질을 만든다.
   repeat은 면 크기(m)에 맞춰 호출부에서 정한다. 텍스처는 clone해서 면마다 repeat를 독립 적용. */
function makePBRMaterial(
  base: string,
  repeat: [number, number],
  extra: Partial<THREE.MeshStandardMaterialParameters> & { ao?: boolean } = {},
): THREE.MeshStandardMaterial {
  const { ao, ...matExtra } = extra
  const src = loadPBR(base, { ao })
  const c = src.color?.clone()
  const n = src.normal.clone()
  const r = src.rough.clone()
  const a = src.ao?.clone()
  for (const t of [c, n, r, a]) {
    if (!t) continue
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
    t.needsUpdate = true
  }
  if (c) c.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshStandardMaterial({
    map: c ?? null,
    normalMap: n,
    roughnessMap: r,
    aoMap: a ?? null,
    aoMapIntensity: a ? 1.0 : 0,
    normalScale: new THREE.Vector2(0.6, 0.6),
    ...matExtra,
  })
}

/* ── 재질 (따뜻한 외래 진료실 톤) ── */
// 바닥: Poly Haven brown_planks_05 (따뜻한 원목 마루) — 살짝 톤다운한 우드
const matFloor = () =>
  makePBRMaterial('/textures/brown_planks_05', [3.0, 3.1], {
    ao: true,
    color: '#c9a878',
    roughness: 0.6,
    metalness: 0.0,
  })
// 벽: painted_plaster_wall의 노멀/러프로 은은한 도장 요철을 주되,
// 따뜻한 오프화이트/베이지 솔리드 컬러로 깔아 포근하게 유지한다.
const matWall = () => {
  const src = loadPBR('/textures/painted_plaster_wall', { color: false })
  const n = src.normal.clone()
  const r = src.rough.clone()
  for (const t of [n, r]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(2.4, 1.3)
    t.needsUpdate = true
  }
  return new THREE.MeshStandardMaterial({
    color: '#efe6d6',
    normalMap: n,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughnessMap: r,
    roughness: 0.95,
    metalness: 0.0,
  })
}
// 웨인스코트/걸레받이: 따뜻한 우드 패널
const matWainscot = () => new THREE.MeshStandardMaterial({ color: '#b8946a', roughness: 0.7 })
const matSkirt = () => new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.6 })
// 천장: 따뜻한 매트 화이트
const matCeiling = () => new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.95 })
const matWhitePaint = () => new THREE.MeshStandardMaterial({ color: '#efe9dd', roughness: 0.55 })
const matDoor = () => new THREE.MeshStandardMaterial({ color: '#d8c4a4', roughness: 0.5 })

/* ── 천장 형광등 패널 ── */
function CeilingPanel({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, ROOM.h - 0.02, z]}>
      {/* 프레임 */}
      <mesh receiveShadow>
        <boxGeometry args={[1.3, 0.06, 0.7]} />
        <meshStandardMaterial color="#e8ece9" roughness={0.6} />
      </mesh>
      {/* 발광면 — 따뜻한 백색 */}
      <mesh position={[0, -0.035, 0]}>
        <boxGeometry args={[1.18, 0.02, 0.58]} />
        <meshStandardMaterial color="#fff6e8" emissive="#fff1dc" emissiveIntensity={2.0} />
      </mesh>
      {/* 패널 아래로 빛 — 방을 밝힘 (따뜻한 백색) */}
      <pointLight position={[0, -0.4, 0]} intensity={5} distance={5.5} decay={2} color="#ffe9cc" />
    </group>
  )
}

/* ── 해부도 포스터 (CanvasTexture로 그린 인체 차트) ──
   exam room의 전형적인 벽걸이 해부도. 메시 대신 캔버스 한 장에 그려 가볍고 선명하다. */
type AnatomyKind = 'organs' | 'skeleton' | 'spine'

function drawAnatomy(ctx: CanvasingContext2D, kind: AnatomyKind, W: number, H: number) {
  // 양피지 배경 + 테두리
  ctx.fillStyle = '#f6efe0'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#c9b88f'
  ctx.lineWidth = 6
  ctx.strokeRect(8, 8, W - 16, H - 16)

  // 제목 바
  ctx.fillStyle = '#33524a'
  ctx.fillRect(16, 16, W - 32, 70)
  ctx.fillStyle = '#f6efe0'
  ctx.font = `bold ${Math.round(W * 0.072)}px "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const title = kind === 'spine' ? '척추 · SPINE' : kind === 'skeleton' ? '인체 골격 · SKELETON' : '인체 해부도 · ANATOMY'
  ctx.fillText(title, W / 2, 52)

  const cx = W / 2
  const top = 110

  const label = (x: number, y: number, text: string, align: CanvasTextAlign = 'left') => {
    ctx.strokeStyle = '#7a6a4a'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(align === 'left' ? x + 26 : x - 26, y)
    ctx.stroke()
    ctx.fillStyle = '#5a4a30'
    ctx.font = `${Math.round(W * 0.034)}px "Helvetica Neue", Arial, sans-serif`
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.fillText(text, align === 'left' ? x + 30 : x - 30, y)
  }

  if (kind === 'spine') {
    // 측면 척추 — 경추/흉추/요추/천골의 자연 만곡
    const segs = 24
    const baseX = cx
    const yTop = top + 20
    const yBot = H - 70
    ctx.fillStyle = '#e9ddc4'
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1)
      const y = yTop + (yBot - yTop) * t
      // S자 만곡
      const curve = Math.sin(t * Math.PI * 2) * 38
      const x = baseX + curve
      const vw = 30 + 18 * t
      const vh = (yBot - yTop) / segs - 4
      ctx.fillStyle = i % 2 === 0 ? '#efe6cf' : '#e3d6b6'
      ctx.strokeStyle = '#a8916a'
      ctx.lineWidth = 2
      roundRect(ctx, x - vw / 2, y - vh / 2, vw, vh, 6)
      ctx.fill()
      ctx.stroke()
      // 디스크
      ctx.fillStyle = '#cdd8c4'
      ctx.fillRect(x - vw / 2 + 3, y + vh / 2 - 2, vw - 6, 4)
    }
    label(baseX + 50, yTop + 30, '경추 C1–C7')
    label(baseX + 50, yTop + (yBot - yTop) * 0.42, '흉추 T1–T12')
    label(baseX + 50, yTop + (yBot - yTop) * 0.72, '요추 L1–L5')
    label(baseX + 50, yBot - 20, '천골 · 미골')
    return
  }

  // ── 전신 인체 (organs / skeleton 공통 실루엣) ──
  const headR = W * 0.085
  const headY = top + headR + 6
  const shoulderY = headY + headR + 30
  const hipY = H * 0.6
  const footY = H - 50
  const torsoHalf = W * 0.14

  // 살색 실루엣
  ctx.fillStyle = '#e9c6a8'
  ctx.strokeStyle = '#c79a78'
  ctx.lineWidth = 3
  // 머리
  ctx.beginPath()
  ctx.ellipse(cx, headY, headR * 0.82, headR, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // 목
  ctx.fillRect(cx - W * 0.03, headY + headR - 6, W * 0.06, 22)
  // 몸통
  ctx.beginPath()
  ctx.moveTo(cx - torsoHalf, shoulderY)
  ctx.lineTo(cx + torsoHalf, shoulderY)
  ctx.lineTo(cx + torsoHalf * 0.7, hipY)
  ctx.lineTo(cx - torsoHalf * 0.7, hipY)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // 팔
  const armW = W * 0.05
  ctx.fillRect(cx - torsoHalf - armW, shoulderY + 4, armW, hipY - shoulderY - 10)
  ctx.fillRect(cx + torsoHalf, shoulderY + 4, armW, hipY - shoulderY - 10)
  ctx.strokeRect(cx - torsoHalf - armW, shoulderY + 4, armW, hipY - shoulderY - 10)
  ctx.strokeRect(cx + torsoHalf, shoulderY + 4, armW, hipY - shoulderY - 10)
  // 다리
  const legW = W * 0.085
  ctx.fillRect(cx - legW - 4, hipY, legW, footY - hipY)
  ctx.fillRect(cx + 4, hipY, legW, footY - hipY)
  ctx.strokeRect(cx - legW - 4, hipY, legW, footY - hipY)
  ctx.strokeRect(cx + 4, hipY, legW, footY - hipY)

  if (kind === 'skeleton') {
    ctx.strokeStyle = '#fbf7ec'
    ctx.fillStyle = '#fbf7ec'
    ctx.lineWidth = 4
    // 두개골
    ctx.beginPath()
    ctx.ellipse(cx, headY, headR * 0.6, headR * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()
    // 척추
    ctx.beginPath()
    ctx.moveTo(cx, shoulderY)
    ctx.lineTo(cx, hipY)
    ctx.stroke()
    // 갈비뼈
    const ribTop = shoulderY + 20
    for (let i = 0; i < 7; i++) {
      const y = ribTop + i * 22
      const wgt = torsoHalf * (0.85 - i * 0.06)
      ctx.beginPath()
      ctx.moveTo(cx, y)
      ctx.quadraticCurveTo(cx - wgt, y + 6, cx - wgt * 0.6, y + 26)
      ctx.moveTo(cx, y)
      ctx.quadraticCurveTo(cx + wgt, y + 6, cx + wgt * 0.6, y + 26)
      ctx.stroke()
    }
    // 골반
    ctx.beginPath()
    ctx.ellipse(cx, hipY + 6, torsoHalf * 0.7, 30, 0, 0, Math.PI)
    ctx.stroke()
    // 팔/다리 뼈
    ctx.beginPath()
    ctx.moveTo(cx - torsoHalf - armW / 2, shoulderY + 8); ctx.lineTo(cx - torsoHalf - armW / 2, hipY - 8)
    ctx.moveTo(cx + torsoHalf + armW / 2, shoulderY + 8); ctx.lineTo(cx + torsoHalf + armW / 2, hipY - 8)
    ctx.moveTo(cx - legW / 2 - 4, hipY + 10); ctx.lineTo(cx - legW / 2 - 4, footY - 4)
    ctx.moveTo(cx + legW / 2 + 4, hipY + 10); ctx.lineTo(cx + legW / 2 + 4, footY - 4)
    ctx.stroke()
    label(cx, headY, '두개골', 'left')
    label(cx + torsoHalf, ribTop + 30, '늑골(갈비뼈)')
    label(cx, hipY + 6, '골반', 'left')
    label(cx + legW + 8, (hipY + footY) / 2, '대퇴골')
    return
  }

  // ── organs ── 장기 오버레이
  const lungTop = shoulderY + 18
  // 폐 (좌우)
  ctx.fillStyle = '#e79aa6'
  ctx.strokeStyle = '#b56b78'
  ctx.lineWidth = 2
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(cx + s * torsoHalf * 0.42, lungTop + 48, torsoHalf * 0.32, 62, s * 0.18, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  // 심장
  ctx.fillStyle = '#c8413f'
  ctx.beginPath()
  const hy = lungTop + 46
  ctx.moveTo(cx - 4, hy)
  ctx.bezierCurveTo(cx - 30, hy - 22, cx - 40, hy + 14, cx - 4, hy + 40)
  ctx.bezierCurveTo(cx + 36, hy + 14, cx + 22, hy - 24, cx - 4, hy)
  ctx.fill()
  // 간
  ctx.fillStyle = '#9c5a3c'
  ctx.beginPath()
  ctx.moveTo(cx - torsoHalf * 0.7, hipY - 120)
  ctx.lineTo(cx + torsoHalf * 0.3, hipY - 120)
  ctx.lineTo(cx + torsoHalf * 0.1, hipY - 84)
  ctx.lineTo(cx - torsoHalf * 0.7, hipY - 92)
  ctx.closePath()
  ctx.fill()
  // 위
  ctx.fillStyle = '#d98a52'
  ctx.beginPath()
  ctx.ellipse(cx + torsoHalf * 0.28, hipY - 96, 34, 24, 0.5, 0, Math.PI * 2)
  ctx.fill()
  // 소장/대장 (코일)
  ctx.strokeStyle = '#d6a06a'
  ctx.lineWidth = 12
  ctx.lineCap = 'round'
  ctx.beginPath()
  let coilY = hipY - 70
  for (let i = 0; i < 4; i++) {
    ctx.moveTo(cx - torsoHalf * 0.5, coilY)
    ctx.bezierCurveTo(cx - torsoHalf * 0.7, coilY + 14, cx + torsoHalf * 0.7, coilY + 14, cx + torsoHalf * 0.5, coilY)
    coilY += 18
  }
  ctx.stroke()
  ctx.lineCap = 'butt'

  label(cx - torsoHalf * 0.42, lungTop + 30, '폐', 'right')
  label(cx + 4, hy + 20, '심장', 'left')
  label(cx - torsoHalf * 0.6, hipY - 104, '간', 'right')
  label(cx + torsoHalf * 0.5, hipY - 96, '위')
  label(cx + torsoHalf * 0.5, hipY - 30, '장')
}

// 둥근 사각형 path 헬퍼 (구형 캔버스 호환)
function roundRect(ctx: CanvasingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

type CanvasingContext2D = CanvasRenderingContext2D

function AnatomyPoster({
  position,
  rotation = [0, 0, 0],
  size = [0.62, 0.92],
  kind = 'organs',
  frame = '#5a4326',
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  size?: [number, number]
  kind?: AnatomyKind
  frame?: string
}) {
  const texture = useMemo(() => {
    const W = 512
    const H = Math.round(W * (size[1] / size[0]))
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    drawAnatomy(ctx, kind, W, H)
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    t.needsUpdate = true
    return t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, size[0], size[1]])

  return (
    <group position={position} rotation={rotation}>
      {/* 프레임 */}
      <mesh castShadow>
        <boxGeometry args={[size[0] + 0.05, size[1] + 0.05, 0.03]} />
        <meshStandardMaterial color={frame} roughness={0.5} metalness={0.1} />
      </mesh>
      {/* 차트 면 */}
      <mesh position={[0, 0, 0.018]}>
        <planeGeometry args={size} />
        <meshStandardMaterial map={texture} roughness={0.82} />
      </mesh>
      {/* 유리 반사 살짝 */}
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={size} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.05} roughness={0.1} metalness={0.2} />
      </mesh>
    </group>
  )
}

/* ── X-ray 뷰박스 (백라이트 + 흉부 X선) ── */
function XrayViewbox({ position, rotation = [0, 0, 0], size = [0.7, 0.86] }: { position: [number, number, number]; rotation?: [number, number, number]; size?: [number, number] }) {
  const texture = useMemo(() => {
    const W = 384, H = Math.round(W * (size[1] / size[0]))
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    // 어두운 필름 배경
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 30, W / 2, H * 0.5, W * 0.7)
    g.addColorStop(0, '#2a3340'); g.addColorStop(1, '#0a0f15')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const cx = W / 2
    ctx.lineCap = 'round'
    // 척추
    ctx.strokeStyle = 'rgba(210,222,235,0.55)'; ctx.lineWidth = 16
    ctx.beginPath(); ctx.moveTo(cx, H * 0.1); ctx.lineTo(cx, H * 0.78); ctx.stroke()
    // 흉곽 (갈비뼈)
    ctx.strokeStyle = 'rgba(200,214,230,0.5)'; ctx.lineWidth = 7
    for (let i = 0; i < 9; i++) {
      const y = H * 0.16 + i * H * 0.052
      const w = W * (0.34 - i * 0.012)
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(cx + s * 14, y)
        ctx.quadraticCurveTo(cx + s * w, y + H * 0.02, cx + s * w * 0.7, y + H * 0.07)
        ctx.stroke()
      }
    }
    // 쇄골
    ctx.lineWidth = 9
    ctx.beginPath(); ctx.moveTo(cx - 12, H * 0.14); ctx.quadraticCurveTo(cx - W * 0.2, H * 0.1, cx - W * 0.32, H * 0.15); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx + 12, H * 0.14); ctx.quadraticCurveTo(cx + W * 0.2, H * 0.1, cx + W * 0.32, H * 0.15); ctx.stroke()
    // 폐 음영 (어둡게 비침)
    ctx.fillStyle = 'rgba(20,28,38,0.45)'
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * W * 0.18, H * 0.36, W * 0.15, H * 0.22, 0, 0, Math.PI * 2); ctx.fill() }
    // 골반/장골 흐릿하게
    ctx.strokeStyle = 'rgba(200,214,230,0.4)'; ctx.lineWidth = 12
    ctx.beginPath(); ctx.arc(cx, H * 0.86, W * 0.22, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke()
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true
    return t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size[0], size[1]])
  return (
    <group position={position} rotation={rotation}>
      {/* 케이스 */}
      <mesh castShadow>
        <boxGeometry args={[size[0] + 0.07, size[1] + 0.07, 0.05]} />
        <meshStandardMaterial color="#e6ebee" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* 백라이트 필름 — 발광 */}
      <mesh position={[0, 0, 0.028]}>
        <planeGeometry args={size} />
        <meshStandardMaterial map={texture} emissive="#cfe3ff" emissiveMap={texture} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      {/* 박스 앞 약한 글로우 라이트 */}
      <pointLight position={[0, 0, 0.4]} intensity={0.5} distance={1.6} decay={2} color="#cfe3ff" />
    </group>
  )
}

/* ── 손소독 1인칭 모션 — 오른손이 펌프를 누르고 왼 손바닥이 노즐 아래서 젤을 받는다 ── */
export function _HygieneHands({ active }: { active: boolean }) {
  const root = useRef<THREE.Group>(null)
  const rightH = useRef<THREE.Group>(null)
  const start = useRef(0)
  useFrame(({ clock }) => {
    const g = root.current
    if (!g) return
    if (!active) { g.visible = false; start.current = 0; return }
    if (!start.current) start.current = clock.elapsedTime
    g.visible = true
    const t = clock.elapsedTime - start.current
    const enter = Math.min(1, t / 0.3)
    const ease = 1 - Math.pow(1 - enter, 3)
    const exit = t > 1.15 ? Math.min(1, (t - 1.15) / 0.4) : 0
    g.position.set(0, 0, (1 - ease + exit * exit) * 0.45)
    // 펌프 누름 (0.3~0.75초): 오른손 하강 + 젤 방울 등장
    const press = t > 0.3 && t < 0.75 ? Math.sin(((t - 0.3) / 0.45) * Math.PI) : 0
    if (rightH.current) rightH.current.position.y = 0.315 - press * 0.028
  })
  return (
    <group ref={root} visible={false}>
      {/* 플레이어 왼손 — 펌프 헤드를 누름 (오른팔 에셋 X미러 = 왼팔) */}
      <group ref={rightH} position={[-0.015, 0.30, 0.02]}>
        <Suspense fallback={null}>
          <DoctorArm position={[0, 0.02, 0.12]} rotation={[0.85, 0.12, 0]} scale={[-1, 1, 1]} />
        </Suspense>
      </group>
      {/* 플레이어 오른손 — 노즐 아래에서 손바닥이 하늘을 보게 젤 받기 */}
      <group position={[0.075, 0.175, 0.01]}>
        <Suspense fallback={null}>
          <DoctorArm position={[0, 0, 0.10]} rotation={[-0.08, -0.25, Math.PI]} scale={1.0} />
        </Suspense>
      </group>
    </group>
  )
}

/* ── 손소독 디스펜서 헤드 (펌프 보틀) — 진찰 단계에서 클릭하면 손위생 기록 ── */
export function _SanitizerHead({ position, rotation = [0, 0, 0], clickable = false }: { position: [number, number, number]; rotation?: [number, number, number]; clickable?: boolean }) {
  const doExamAction = useGame((s) => s.doExamAction)
  const setExamHint = useGame((s) => s.setExamHint)
  const washed = useGame((s) => s.examLog.some((e) => e.action_id === 'hand_hygiene'))
  const [hover, setHover] = useState(false)
  const onClick = clickable
    ? (e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        if (washed) return
        setExamHint('손위생 완료 — 손소독제를 발랐습니다.')
        void doExamAction('hand_hygiene')
      }
    : undefined
  const bottle = washed ? '#cde8d6' : hover && clickable ? '#ffffff' : '#f0f4f6'
  return (
    <group
      position={position}
      rotation={rotation}
      onClick={onClick}
      onPointerOver={clickable ? (e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' } : undefined}
      onPointerOut={clickable ? () => { setHover(false); document.body.style.cursor = 'auto' } : undefined}
    >
      <mesh castShadow>
        <boxGeometry args={[0.12, 0.2, 0.08]} />
        <meshStandardMaterial color={bottle} roughness={0.4} emissive={hover && clickable && !washed ? '#5aa06e' : '#000000'} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, -0.12, 0.02]} castShadow>
        <boxGeometry args={[0.06, 0.04, 0.05]} />
        <meshStandardMaterial color="#7a8a92" roughness={0.5} />
      </mesh>
      {washed && (
        <mesh position={[0, 0.02, 0.05]}>
          <planeGeometry args={[0.07, 0.07]} />
          <meshStandardMaterial color="#4f9468" transparent opacity={0.0} />
        </mesh>
      )}
    </group>
  )
}

/* ── 벽걸이 의료 디스펜서 스테이션 (장갑 박스 3종 + 손소독 + 샤프스 통) ── */
function WallMedStation({ position, rotation = [0, 0, 0], examMode: _examMode = false }: { position: [number, number, number]; rotation?: [number, number, number]; examMode?: boolean }) {
  const gloveColors = ['#3a6ea5', '#4a4f54', '#5aa06e']
  return (
    <group position={position} rotation={rotation}>
      {/* 백 패널 (스테인리스) */}
      <mesh castShadow>
        <boxGeometry args={[0.78, 0.5, 0.03]} />
        <meshStandardMaterial color="#cfd6da" roughness={0.35} metalness={0.55} />
      </mesh>
      {/* 장갑 박스 3종 (벽 거치) */}
      {gloveColors.map((col, i) => (
        <group key={i} position={[-0.26 + i * 0.26, 0.06, 0.06]}>
          <mesh castShadow>
            <boxGeometry args={[0.2, 0.26, 0.09]} />
            <meshStandardMaterial color={col} roughness={0.6} />
          </mesh>
          {/* 뽑는 구멍의 흰 장갑 */}
          <mesh position={[0, 0.05, 0.05]}>
            <boxGeometry args={[0.1, 0.05, 0.02]} />
            <meshStandardMaterial color="#f4f4ef" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* (벽걸이 손소독 제거 — 책상 펌프 보틀로 일원화) */}
      {/* 샤프스 통 (노란 의료폐기물) */}
      <group position={[-0.28, -0.12, 0.07]}>
        <mesh castShadow>
          <boxGeometry args={[0.16, 0.2, 0.12]} />
          <meshStandardMaterial color="#e4b521" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.11, 0]}>
          <boxGeometry args={[0.16, 0.03, 0.12]} />
          <meshStandardMaterial color="#c2962f" roughness={0.6} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 5발 캐스터 베이스 (모니터/IV 폴 공용) ── */
function CasterBase({ r = 0.26, color = '#9aa0a4' }: { r?: number; color?: string }) {
  return (
    <group>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return (
          <group key={i} position={[Math.cos(a) * r, 0.03, Math.sin(a) * r]}>
            <mesh rotation={[0, -a, 0]} castShadow>
              <boxGeometry args={[r, 0.035, 0.04]} />
              <meshStandardMaterial color={color} roughness={0.4} metalness={0.5} />
            </mesh>
            <mesh position={[Math.cos(a) * r * 0.5, -0.015, Math.sin(a) * r * 0.5]} castShadow>
              <cylinderGeometry args={[0.025, 0.025, 0.03, 10]} />
              <meshStandardMaterial color="#2a2e31" roughness={0.6} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/* ── IV 수액 폴 ── */
function IVPole({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <CasterBase r={0.22} />
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 1.9, 12]} />
        <meshStandardMaterial color="#c2c7cc" roughness={0.3} metalness={0.7} />
      </mesh>
      {/* 상단 후크 */}
      <mesh position={[0, 1.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <torusGeometry args={[0.05, 0.008, 8, 16, Math.PI]} />
        <meshStandardMaterial color="#c2c7cc" roughness={0.3} metalness={0.7} />
      </mesh>
      {/* 수액 백 (반투명) */}
      <mesh position={[0.08, 1.62, 0]} castShadow>
        <boxGeometry args={[0.13, 0.24, 0.04]} />
        <meshStandardMaterial color="#dff0ff" transparent opacity={0.55} roughness={0.2} />
      </mesh>
      {/* 점적통 + 튜브 */}
      <mesh position={[0.08, 1.44, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.06, 8]} />
        <meshStandardMaterial color="#eaf4ff" transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

/* ── 청진기 (벽 후크에 걸린) ── */
function Stethoscope({ position, rotation = [0, 0, 0] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  const pts = useMemo(() => {
    const arr: THREE.Vector3[] = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      const a = Math.PI * (0.15 + t * 1.7)
      arr.push(new THREE.Vector3(Math.cos(a) * 0.12, -t * 0.34, Math.sin(a) * 0.02))
    }
    return arr
  }, [])
  const tube = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 8, false), [pts])
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={tube} castShadow>
        <meshStandardMaterial color="#2f3a44" roughness={0.4} />
      </mesh>
      {/* 흉부 헤드 (체스트피스) */}
      <mesh position={[pts[pts.length - 1].x, pts[pts.length - 1].y - 0.02, 0.01]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.02, 18]} />
        <meshStandardMaterial color="#b8bdc2" roughness={0.3} metalness={0.7} />
      </mesh>
    </group>
  )
}

/* ── 책상 위 청진기 (사실적: 감긴 코드 루프 + Y분기 + 크롬 바이노럴) ── */
function DeskStethoscope({ position, rotation = [0, 0, 0], scale = 1 }: { position: [number, number, number]; rotation?: [number, number, number]; scale?: number }) {
  // 검은 라텍스 코드 — 체스트피스(우)에서 시작해 한 바퀴 감기며 교차한 뒤 Y분기(좌)로
  const cord = useMemo(() => {
    const p: [number, number, number][] = [
      [0.135, 0.011, -0.03],  // 체스트피스 쪽 시작
      [0.082, 0.011, -0.088],
      [0.0, 0.011, -0.104],   // 아래
      [-0.085, 0.011, -0.072],
      [-0.11, 0.011, 0.0],    // 좌
      [-0.078, 0.011, 0.074],
      [0.0, 0.011, 0.10],     // 위
      [0.085, 0.011, 0.072],
      [0.108, 0.011, 0.0],    // 우
      [0.072, 0.026, -0.052], // 교차(시작 위로 감김) — y 높여 겹침
      [-0.012, 0.026, -0.074],
      [-0.088, 0.019, -0.046],
      [-0.135, 0.013, -0.012],
      [-0.158, 0.011, 0.0],   // Y분기 베이스
    ]
    const curve = new THREE.CatmullRomCurve3(p.map((q) => new THREE.Vector3(...q)))
    return new THREE.TubeGeometry(curve, 90, 0.011, 12, false)
  }, [])
  // 크롬 바이노럴 — Y에서 갈라져 U자로 휘어 양 끝 이어팁으로
  const bin = useMemo(() => {
    const p: [number, number, number][] = [
      [-0.246, 0.011, 0.019],  // 이어팁 1 (위)
      [-0.226, 0.011, 0.046],
      [-0.184, 0.011, 0.046],
      [-0.162, 0.011, 0.013],
      [-0.156, 0.011, 0.0],    // U 바닥(Y 위치)
      [-0.162, 0.011, -0.013],
      [-0.184, 0.011, -0.046],
      [-0.226, 0.011, -0.046],
      [-0.246, 0.011, -0.019], // 이어팁 2 (아래)
    ]
    const curve = new THREE.CatmullRomCurve3(p.map((q) => new THREE.Vector3(...q)))
    return new THREE.TubeGeometry(curve, 60, 0.006, 10, false)
  }, [])
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* 코드(검은 튜브) */}
      <mesh geometry={cord} castShadow>
        <meshStandardMaterial color="#10151a" roughness={0.42} metalness={0.05} />
      </mesh>
      {/* 크롬 바이노럴 */}
      <mesh geometry={bin} castShadow>
        <meshStandardMaterial color="#d4d9dc" metalness={0.94} roughness={0.1} />
      </mesh>
      {/* Y분기 블록 (검은 플라스틱) — 코드와 바이노럴이 만나는 지점 */}
      <mesh position={[-0.156, 0.013, 0]} castShadow>
        <sphereGeometry args={[0.016, 16, 12]} />
        <meshStandardMaterial color="#15191c" roughness={0.5} />
      </mesh>
      {/* 이어팁 (검은 올리브) */}
      <mesh position={[-0.252, 0.011, 0.019]} rotation={[Math.PI / 2, 0, -0.5]} castShadow>
        <coneGeometry args={[0.012, 0.024, 14]} />
        <meshStandardMaterial color="#0c1014" roughness={0.5} />
      </mesh>
      <mesh position={[-0.252, 0.011, -0.019]} rotation={[-Math.PI / 2, 0, 0.5]} castShadow>
        <coneGeometry args={[0.012, 0.024, 14]} />
        <meshStandardMaterial color="#0c1014" roughness={0.5} />
      </mesh>
      {/* 체스트피스(헤드) — 묵직한 크롬 드럼 + 림 + 다이어프램, 책상에 납작 */}
      <group position={[0.16, 0.0, -0.018]}>
        {/* 스템 (코드→헤드) */}
        <mesh position={[-0.03, 0.011, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.0085, 0.0085, 0.045, 14]} />
          <meshStandardMaterial color="#c6cbd0" metalness={0.92} roughness={0.14} />
        </mesh>
        {/* 헤드 드럼 */}
        <mesh position={[0, 0.013, 0]} castShadow>
          <cylinderGeometry args={[0.044, 0.047, 0.024, 40]} />
          <meshStandardMaterial color="#d0d5d9" metalness={0.94} roughness={0.1} />
        </mesh>
        {/* 림 링 */}
        <mesh position={[0, 0.026, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.044, 0.004, 12, 40]} />
          <meshStandardMaterial color="#a9afb4" metalness={0.9} roughness={0.22} />
        </mesh>
        {/* 다이어프램 막 */}
        <mesh position={[0, 0.027, 0]}>
          <cylinderGeometry args={[0.041, 0.041, 0.003, 40]} />
          <meshStandardMaterial color="#0c1014" roughness={0.55} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 검진 침대 (페이퍼 롤 포함) ── */
function ExamBed({ position, rotation = [0, 0, 0] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* 매트 상판 (포근한 베이지 쿠션) */}
      <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.12, 1.9]} />
        <meshStandardMaterial color="#c9b48f" roughness={0.6} />
      </mesh>
      {/* 페이퍼 롤 시트 (상판 위 흰 종이) — 너무 희지 않게(과노출/블룸 방지) */}
      <mesh position={[0, 0.685, 0.1]}>
        <boxGeometry args={[0.66, 0.012, 1.5]} />
        <meshStandardMaterial color="#e9e1d0" roughness={0.97} />
      </mesh>
      {/* 베이스 캐비닛 (우드톤) */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.66, 0.56, 1.7]} />
        <meshStandardMaterial color="#d8c4a0" roughness={0.65} />
      </mesh>
      {/* 페이퍼 롤 디스펜서 (머리쪽 끝) */}
      <mesh position={[0, 0.7, 0.97]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.6, 16]} />
        <meshStandardMaterial color="#fbfbf6" roughness={0.95} />
      </mesh>
    </group>
  )
}

/* ── 책장 위/검진 침대 옆 책·바인더 줄 (따뜻한 색) ── */
function BookRow({
  position,
  rotation = [0, 0, 0],
  count = 8,
  width = 0.9,
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  count?: number
  width?: number
}) {
  // 의학 서적/바인더 톤 — 차분한 네이비/그린/버건디/회백 (오피스 알록달록함 배제)
  const colors = ['#2f4a5e', '#3a5247', '#6e3a3a', '#d8d2c4', '#445566', '#7a6a4a', '#2e3e4a', '#e6e0d2']
  const bw = width / count
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: count }).map((_, i) => {
        const h = 0.2 + ((i * 37) % 9) * 0.012
        return (
          <mesh key={i} position={[-width / 2 + bw * (i + 0.5), h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[bw * 0.86, h, 0.16]} />
            <meshStandardMaterial color={colors[i % colors.length]} roughness={0.78} />
          </mesh>
        )
      })}
    </group>
  )
}

/* ── 액자 졸업장/면허증 (따뜻한 양피지 + 가는 금/우드 프레임) ── */
function Certificate({
  position,
  rotation = [0, 0, 0],
  size = [0.42, 0.56],
  frame = '#9c7b46',
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  size?: [number, number]
  frame?: string
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[size[0] + 0.04, size[1] + 0.04, 0.025]} />
        <meshStandardMaterial color={frame} roughness={0.45} metalness={0.25} />
      </mesh>
      {/* 매트 */}
      <mesh position={[0, 0, 0.014]}>
        <planeGeometry args={[size[0] - 0.02, size[1] - 0.02]} />
        <meshStandardMaterial color="#f7f0df" roughness={0.85} />
      </mesh>
      {/* 양피지 본문 */}
      <mesh position={[0, 0.02, 0.016]}>
        <planeGeometry args={[size[0] - 0.1, size[1] - 0.14]} />
        <meshStandardMaterial color="#efe2c2" roughness={0.9} />
      </mesh>
      {/* 텍스트 라인 흉내 */}
      {[0.12, 0.06, 0.0, -0.06, -0.12].map((y, i) => (
        <mesh key={i} position={[0, y + 0.02, 0.017]}>
          <planeGeometry args={[(size[0] - 0.18) * (i === 0 ? 0.55 : 0.85), 0.012]} />
          <meshStandardMaterial color="#8a7a55" roughness={0.9} />
        </mesh>
      ))}
      {/* 인장(씰) */}
      <mesh position={[size[0] * 0.22, -size[1] * 0.28, 0.018]}>
        <circleGeometry args={[0.035, 16]} />
        <meshStandardMaterial color="#a6402f" roughness={0.7} />
      </mesh>
    </group>
  )
}

/* ── 프라이버시 커튼 (레일 + 천 패널 몇 장) ── */
function PrivacyCurtain({ position, rotation = [0, 0, 0], length = 2.0 }: { position: [number, number, number]; rotation?: [number, number, number]; length?: number }) {
  const railH = 2.0
  const panels = 7
  return (
    <group position={position} rotation={rotation}>
      {/* 레일 */}
      <mesh position={[0, railH, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, length, 10]} />
        <meshStandardMaterial color="#b8bec2" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* 천 주름 패널 */}
      {Array.from({ length: panels }).map((_, i) => {
        const x = -length / 2 + (length / panels) * (i + 0.5)
        const depth = (i % 2 === 0 ? 0.05 : -0.05)
        return (
          <mesh key={i} position={[x, railH / 2 - 0.05, depth]} castShadow receiveShadow>
            <boxGeometry args={[length / panels - 0.01, railH - 0.1, 0.03]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#cdd8c4' : '#d8e0cf'} roughness={0.9} />
          </mesh>
        )
      })}
    </group>
  )
}

/* ── 창문 블라인드 (수평 슬랫) ── */
function WindowBlinds({ position, rotation = [0, 0, 0], width = 1.6, height = 1.0 }: { position: [number, number, number]; rotation?: [number, number, number]; width?: number; height?: number }) {
  const slats = 16
  const gap = height / slats
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: slats }).map((_, i) => (
        <mesh key={i} position={[0, height / 2 - gap * (i + 0.5), 0]} rotation={[0.5, 0, 0]} castShadow>
          <boxGeometry args={[width, gap * 0.82, 0.012]} />
          <meshStandardMaterial color="#e8dcc4" roughness={0.7} />
        </mesh>
      ))}
      {/* 당김줄 */}
      <mesh position={[width / 2 - 0.05, 0, 0.02]}>
        <cylinderGeometry args={[0.004, 0.004, height, 6]} />
        <meshStandardMaterial color="#cabfa6" roughness={0.8} />
      </mesh>
    </group>
  )
}

/* ── 롤링 스툴 ── */
function Stool({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.21, 0.21, 0.08, 20]} />
        <meshStandardMaterial color="#2f3437" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.36, 10]} />
        <meshStandardMaterial color="#9aa0a4" roughness={0.3} metalness={0.7} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 0.18, 0.06, Math.sin(a) * 0.18]} rotation={[0, -a, 0]} castShadow>
            <boxGeometry args={[0.22, 0.04, 0.04]} />
            <meshStandardMaterial color="#3a3f42" roughness={0.5} />
          </mesh>
        )
      })}
    </group>
  )
}

/* ── 벽시계 (실물 모델) ── */
function WallClock({ position }: { position: [number, number, number] }) {
  return (
    <Suspense fallback={null}>
      <Prop asset="wall_clock" position={position} scale={1.0} />
    </Suspense>
  )
}

/* ── 이동식 바이탈 모니터 카트 (ECG/SpO₂/호흡 파형 + 수치 화면) — 정교한 의료기기 ── */
function VitalsCart({ position, rotation = [0, 0, 0] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  const texture = useMemo(() => {
    const W = 512, H = 384
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#060f0a'; ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(40,100,65,0.35)'; ctx.lineWidth = 1
    for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    ctx.font = '700 13px "Helvetica Neue",Arial'; ctx.textBaseline = 'top'
    ctx.fillStyle = '#3dff7a'; ctx.textAlign = 'left'; ctx.fillText('ECG II', 10, 6)
    ctx.fillStyle = '#39d9ff'; ctx.fillText('SpO₂', 10, 114)
    ctx.fillStyle = '#f5d45a'; ctx.fillText('RESP', 10, 218)
    // ECG
    ctx.strokeStyle = '#3dff7a'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath()
    const ecgY = 62
    const beat = (bx: number) => {
      ctx.lineTo(bx + 8, ecgY); ctx.lineTo(bx + 13, ecgY - 8); ctx.lineTo(bx + 18, ecgY + 5)
      ctx.lineTo(bx + 22, ecgY - 52); ctx.lineTo(bx + 27, ecgY + 22); ctx.lineTo(bx + 33, ecgY - 5); ctx.lineTo(bx + 40, ecgY)
    }
    ctx.moveTo(0, ecgY); for (let bx = 0; bx < W; bx += 96) { ctx.lineTo(bx, ecgY); beat(bx) }
    ctx.stroke()
    // SpO2
    ctx.strokeStyle = '#39d9ff'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 158)
    for (let xx = 0; xx <= W; xx += 3) ctx.lineTo(xx, 158 - Math.abs(Math.sin(xx * 0.055)) * 32)
    ctx.stroke()
    // RESP
    ctx.strokeStyle = '#f5d45a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(0, 258)
    for (let xx = 0; xx <= W; xx += 3) ctx.lineTo(xx, 258 - Math.sin(xx * 0.018) * 20)
    ctx.stroke()
    // 수치 패널
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; roundRect(ctx, W - 124, 4, 120, H - 8, 6); ctx.fill()
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#3dff7a'; ctx.font = 'bold 48px "Helvetica Neue",Arial'; ctx.fillText('88', W - 8, 60)
    ctx.font = '700 12px Arial'; ctx.fillText('HR bpm', W - 8, 78)
    ctx.fillStyle = '#39d9ff'; ctx.font = 'bold 42px "Helvetica Neue",Arial'; ctx.fillText('98', W - 8, 158)
    ctx.font = '700 12px Arial'; ctx.fillText('SpO₂ %', W - 8, 175)
    ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 28px "Helvetica Neue",Arial'; ctx.fillText('120/80', W - 8, 245)
    ctx.font = '700 12px Arial'; ctx.fillText('NIBP mmHg', W - 8, 261)
    ctx.fillStyle = '#f5d45a'; ctx.font = 'bold 32px "Helvetica Neue",Arial'; ctx.fillText('16', W - 8, 328)
    ctx.font = '700 12px Arial'; ctx.fillText('RESP /min', W - 8, 344)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true
    return t
  }, [])
  const white = '#eef1f3'
  const dark = '#2a2e31'
  return (
    <group position={position} rotation={rotation}>
      {/* ── 대형 캐스터 바퀴 4개 ── */}
      {[[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]].map(([x, z], i) => (
        <group key={i} position={[x, 0.09, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.09, 0.09, 0.06, 18]} />
            <meshStandardMaterial color="#1c1f22" roughness={0.6} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.04, 0.04, 0.07, 12]} />
            <meshStandardMaterial color="#9aa0a4" roughness={0.4} metalness={0.6} />
          </mesh>
        </group>
      ))}
      {/* 바퀴 프레임 */}
      <mesh position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.5, 0.06, 0.62]} />
        <meshStandardMaterial color={dark} roughness={0.5} />
      </mesh>

      {/* ── 본체 캐비닛 (흰색) ── */}
      <mesh position={[0, 0.52, -0.02]} castShadow>
        <boxGeometry args={[0.46, 0.64, 0.46]} />
        <meshStandardMaterial color={white} roughness={0.45} />
      </mesh>
      {/* 하단 짙은 띠 */}
      <mesh position={[0, 0.24, -0.02]} castShadow>
        <boxGeometry args={[0.47, 0.12, 0.47]} />
        <meshStandardMaterial color={dark} roughness={0.5} />
      </mesh>
      {/* 프로브 홀더 4개 (앞면) + 프로브 */}
      {[-0.15, -0.05, 0.05, 0.15].map((x, i) => (
        <group key={i} position={[x, 0.6, 0.235]}>
          <mesh castShadow>
            <boxGeometry args={[0.07, 0.14, 0.04]} />
            <meshStandardMaterial color="#cfd6da" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.02, 0.03]} castShadow>
            <capsuleGeometry args={[0.022, 0.08, 4, 8]} />
            <meshStandardMaterial color="#e9edf0" roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* ── 제어 콘솔 (캐비닛 위, 앞으로 튀어나온 제어 데크) ── */}
      <group position={[0, 0.88, 0.16]} rotation={[0.16, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.44, 0.07, 0.34]} />
          <meshStandardMaterial color="#d7dde1" roughness={0.5} />
        </mesh>
        {/* 콘솔 터치스크린 (시안 발광) — 뒤쪽 절반, 위를 향함 */}
        <mesh position={[0, 0.04, -0.08]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.32, 0.14]} />
          <meshStandardMaterial color="#0a2230" emissive="#37b6d6" emissiveIntensity={0.6} toneMapped={false} />
        </mesh>
        {/* 트랙볼 (앞쪽) */}
        <mesh position={[0, 0.045, 0.08]} castShadow>
          <sphereGeometry args={[0.028, 16, 12]} />
          <meshStandardMaterial color="#3a8fd0" roughness={0.3} />
        </mesh>
        {/* 버튼 줄 (앞쪽) */}
        {[-0.12, -0.06, 0.06, 0.12].map((x, i) => (
          <mesh key={i} position={[x, 0.04, 0.13]} castShadow>
            <boxGeometry args={[0.03, 0.012, 0.02]} />
            <meshStandardMaterial color="#aeb4b8" roughness={0.5} />
          </mesh>
        ))}
      </group>

      {/* ── 모니터 지지 암 ── */}
      <mesh position={[0, 1.15, -0.1]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.5, 12]} />
        <meshStandardMaterial color="#b8bdc2" roughness={0.3} metalness={0.7} />
      </mesh>

      {/* ── 상단 모니터 (초음파/바이탈 화면) ── */}
      <group position={[0, 1.5, -0.02]} rotation={[0.05, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.64, 0.42, 0.05]} />
          <meshStandardMaterial color={dark} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.01, 0.027]}>
          <planeGeometry args={[0.58, 0.34]} />
          <meshStandardMaterial map={texture} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 진료실 방 (바닥/벽/천장/문) ── */
export function RoomShell({ doorOpenT }: { doorOpenT: number }) {
  const { w, h, backZ, frontZ } = ROOM
  const hx = w / 2
  const depth = frontZ - backZ
  const cz = (frontZ + backZ) / 2
  // 문짝 회전 (안쪽으로 열림)
  const doorAngle = doorOpenT * (Math.PI * 0.62)

  // 뒷벽: 문 구멍을 좌/우/상 패널로 만든다
  const leftPanelW = DOOR_X - DOOR_W / 2 - -hx // 문 왼쪽 벽 폭
  const rightPanelW = hx - (DOOR_X + DOOR_W / 2)

  return (
    <group>
      {/* 바닥 */}
      <mesh position={[0, 0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, depth]} />
        <primitive object={matFloor()} attach="material" />
      </mesh>
      {/* 천장 */}
      <mesh position={[0, h, cz]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, depth]} />
        <primitive object={matCeiling()} attach="material" />
      </mesh>

      {/* 좌측 벽 */}
      <group>
        <mesh position={[-hx, h / 2, cz]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[depth, h]} />
          <primitive object={matWall()} attach="material" />
        </mesh>
        {/* 웨인스코트 (하단 패널) */}
        <mesh position={[-hx + 0.01, 0.6, cz]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[depth, 1.2]} />
          <primitive object={matWainscot()} attach="material" />
        </mesh>
        {/* 걸레받이 */}
        <mesh position={[-hx + 0.03, 0.05, cz]} castShadow>
          <boxGeometry args={[0.06, 0.1, depth]} />
          <primitive object={matSkirt()} attach="material" />
        </mesh>
      </group>

      {/* 우측 벽 (창문 있음) */}
      <group>
        <mesh position={[hx, h / 2, cz]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[depth, h]} />
          <primitive object={matWall()} attach="material" />
        </mesh>
        <mesh position={[hx - 0.01, 0.6, cz]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[depth, 1.2]} />
          <primitive object={matWainscot()} attach="material" />
        </mesh>
        <mesh position={[hx - 0.03, 0.05, cz]} castShadow>
          <boxGeometry args={[0.06, 0.1, depth]} />
          <primitive object={matSkirt()} attach="material" />
        </mesh>
        {/* 창문 — 따뜻한 일광이 들어오는 발광 유리 패널 + 프레임 + 블라인드 */}
        <group position={[hx - 0.06, 1.65, -0.9]}>
          <mesh rotation={[0, -Math.PI / 2, 0]}>
            <planeGeometry args={[1.7, 1.1]} />
            <meshStandardMaterial color="#fff2dc" emissive="#ffe6bc" emissiveIntensity={1.1} roughness={0.15} metalness={0.0} />
          </mesh>
          {/* 수평 블라인드 — 절반쯤 내려 따뜻한 빛이 슬랫 사이로 */}
          <WindowBlinds position={[0, 0.18, 0.03]} rotation={[0, -Math.PI / 2, 0]} width={1.62} height={0.74} />
          {/* 창틀 */}
          <mesh position={[0, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <boxGeometry args={[1.84, 0.06, 0.04]} />
            <primitive object={matWhitePaint()} attach="material" />
          </mesh>
          <mesh position={[0, 0.55, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <boxGeometry args={[1.84, 0.06, 0.04]} />
            <primitive object={matWhitePaint()} attach="material" />
          </mesh>
          <mesh position={[0, -0.55, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <boxGeometry args={[1.84, 0.06, 0.04]} />
            <primitive object={matWhitePaint()} attach="material" />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.04, 1.16, 0.06]} />
            <primitive object={matWhitePaint()} attach="material" />
          </mesh>
        </group>
      </group>

      {/* 앞쪽 벽 (의사 등 뒤) */}
      <mesh position={[0, h / 2, frontZ]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <primitive object={matWall()} attach="material" />
      </mesh>

      {/* 뒷벽 (문 있는 벽) — 좌/우/상 패널 */}
      <group>
        {/* 좌 패널 */}
        <mesh position={[-hx + leftPanelW / 2, h / 2, backZ]} receiveShadow>
          <planeGeometry args={[leftPanelW, h]} />
          <primitive object={matWall()} attach="material" />
        </mesh>
        {/* 우 패널 */}
        <mesh position={[hx - rightPanelW / 2, h / 2, backZ]} receiveShadow>
          <planeGeometry args={[rightPanelW, h]} />
          <primitive object={matWall()} attach="material" />
        </mesh>
        {/* 상 패널 (문 위) */}
        <mesh position={[DOOR_X, DOOR_H + (h - DOOR_H) / 2, backZ]} receiveShadow>
          <planeGeometry args={[DOOR_W, h - DOOR_H]} />
          <primitive object={matWall()} attach="material" />
        </mesh>
        {/* 좌 웨인스코트 */}
        <mesh position={[-hx + leftPanelW / 2, 0.6, backZ + 0.01]} receiveShadow>
          <planeGeometry args={[leftPanelW, 1.2]} />
          <primitive object={matWainscot()} attach="material" />
        </mesh>
        <mesh position={[hx - rightPanelW / 2, 0.6, backZ + 0.01]} receiveShadow>
          <planeGeometry args={[rightPanelW, 1.2]} />
          <primitive object={matWainscot()} attach="material" />
        </mesh>
        {/* 문틀 */}
        <mesh position={[DOOR_X - DOOR_W / 2 - 0.04, DOOR_H / 2, backZ + 0.02]} castShadow>
          <boxGeometry args={[0.08, DOOR_H + 0.1, 0.12]} />
          <primitive object={matWhitePaint()} attach="material" />
        </mesh>
        <mesh position={[DOOR_X + DOOR_W / 2 + 0.04, DOOR_H / 2, backZ + 0.02]} castShadow>
          <boxGeometry args={[0.08, DOOR_H + 0.1, 0.12]} />
          <primitive object={matWhitePaint()} attach="material" />
        </mesh>
        <mesh position={[DOOR_X, DOOR_H + 0.05, backZ + 0.02]} castShadow>
          <boxGeometry args={[DOOR_W + 0.16, 0.08, 0.12]} />
          <primitive object={matWhitePaint()} attach="material" />
        </mesh>
        {/* 문 너머 복도 — 어두운 면 (문 열리면 보임) */}
        <mesh position={[DOOR_X, DOOR_H / 2, backZ - 0.5]}>
          <planeGeometry args={[DOOR_W, DOOR_H]} />
          <meshStandardMaterial color="#1a2026" roughness={1} />
        </mesh>
        {/* 문짝 (경첩: 문 왼쪽 모서리에서 안쪽으로 열림) */}
        <group position={[DOOR_X - DOOR_W / 2, 0, backZ]} rotation={[0, doorAngle, 0]}>
          <mesh position={[DOOR_W / 2, DOOR_H / 2, 0.04]} castShadow receiveShadow>
            <boxGeometry args={[DOOR_W, DOOR_H, 0.05]} />
            <primitive object={matDoor()} attach="material" />
          </mesh>
          {/* 손잡이 */}
          <mesh position={[DOOR_W - 0.12, 1.05, 0.09]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.12, 10]} />
            <meshStandardMaterial color="#9aa0a4" roughness={0.3} metalness={0.7} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/* ── 의사 책상 (실물 사무책상, 1인칭 전경) ── */
function Desk() {
  const setFocusedPanel = useGame((s) => s.setFocusedPanel)
  const setCameraHold = useGame((s) => s.setCameraHold)
  const doExamAction = useGame((s) => s.doExamAction)
  // 이 케이스에 손위생 진찰 항목이 있으면(=신체진찰 케이스) 책상 손소독제 클릭도 실제로 기록한다.
  const recordsHygiene = useGame((s) => s.examItems.some((it) => it.id === 'hand_hygiene'))
  const alreadyWashed = useGame((s) => s.examLog.some((e) => e.action_id === 'hand_hygiene'))
  const [sanitizerHit, setSanitizerHit] = useState(false)
  // 발화("손소독하겠습니다")로도 모션 재생
  const hygienePulse = useGame((s) => s.hygienePulse)
  useEffect(() => {
    if (!hygienePulse) return
    setSanitizerHit(true)
    const t = setTimeout(() => setSanitizerHit(false), 1600)
    return () => clearTimeout(t)
  }, [hygienePulse])
  const washHands = () => {
    setSanitizerHit(true)
    setTimeout(() => setSanitizerHit(false), 1600)
    // 진료 전 손위생을 실제 exam_log에 기록 → 채점의 '손위생 선행' 반영.
    // (진찰 단계 침대 옆 디스펜서와 동일하게. 미기록 시 채점에서 '손소독 안 함' 페널티가 잘못 발생하던 버그 수정)
    if (recordsHygiene && !alreadyWashed) void doExamAction('hand_hygiene')
  }
  return (
    <group position={[-2.05, 0, 0.5]}>
      <Suspense fallback={null}>
        <Prop asset="metal_office_desk" position={[0, 0, -0.08]} scale={[0.92, 1.06, 0.88]} />
        {/* (데스크 스탠드 제거) */}
      </Suspense>
      {/* 차트 클립보드 (메디컬, 틸색) — 클릭 → 환자 차트 오버레이 */}
      <group
        position={[0.66, 0.84, 0.1]}
        rotation={[-0.1, -0.3, 0]}
        scale={0.72}
        onClick={(e) => { e.stopPropagation(); setFocusedPanel('chart') }}
        onPointerOver={(e) => { e.stopPropagation(); setCameraHold(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setCameraHold(false); document.body.style.cursor = 'auto' }}
      >
        {/* 플라스틱 백보드 (틸) */}
        <mesh castShadow>
          <boxGeometry args={[0.24, 0.014, 0.32]} />
          <meshStandardMaterial color="#3a7d7b" roughness={0.5} />
        </mesh>
        {/* 흰 양식지 + 인쇄 라인 흉내 */}
        <mesh position={[0, 0.012, 0.015]}>
          <boxGeometry args={[0.2, 0.006, 0.26]} />
          <meshStandardMaterial color="#f7f6f1" roughness={0.92} />
        </mesh>
        {[0.07, 0.04, 0.01, -0.02, -0.05].map((z, i) => (
          <mesh key={i} position={[0, 0.016, z]}>
            <boxGeometry args={[0.15, 0.001, 0.006]} />
            <meshStandardMaterial color="#c7d0d2" roughness={0.9} />
          </mesh>
        ))}
        {/* 상단 금속 클립 */}
        <mesh position={[0, 0.018, -0.14]} castShadow>
          <boxGeometry args={[0.1, 0.014, 0.03]} />
          <meshStandardMaterial color="#aeb4b8" roughness={0.35} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0.026, -0.137]} castShadow>
          <boxGeometry args={[0.06, 0.012, 0.012]} />
          <meshStandardMaterial color="#c2c8cc" roughness={0.3} metalness={0.8} />
        </mesh>
      </group>
      {/* 모니터(EMR) — 클릭 → 환자 상태 패널. 의사 쪽(+z)을 바라보도록 각짐 */}
      <group
        position={[-0.35, 0.83, -0.28]} rotation={[0, 0.45, 0]}
        onClick={(e) => { e.stopPropagation(); setFocusedPanel('status') }}
        onPointerOver={(e) => { e.stopPropagation(); setCameraHold(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setCameraHold(false); document.body.style.cursor = 'auto' }}
      >
        {/* 화면 본체 (제대로 된 데스크탑 모니터 크기) */}
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[0.66, 0.42, 0.04]} />
          <meshStandardMaterial color="#23262a" roughness={0.4} />
        </mesh>
        {/* 화면 (발광) */}
        <mesh position={[0, 0.42, 0.022]}>
          <planeGeometry args={[0.60, 0.36]} />
          <meshStandardMaterial color="#eaf2ea" emissive="#dfe9d8" emissiveIntensity={0.6} />
        </mesh>
        {/* 목(스탠드) — 화면 본체 아래까지만 (관통 방지) */}
        <mesh position={[0, 0.115, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.03, 0.18, 10]} />
          <meshStandardMaterial color="#2a2e31" roughness={0.4} metalness={0.3} />
        </mesh>
        {/* 받침대 */}
        <mesh position={[0, 0.02, 0.02]} castShadow>
          <boxGeometry args={[0.30, 0.025, 0.18]} />
          <meshStandardMaterial color="#2a2e31" roughness={0.45} metalness={0.3} />
        </mesh>
      </group>
      {/* (명패 제거 — 책상 위 갈색 정리) */}
      {/* (티슈 박스 제거 — 참고 사진 준비물에 없음) */}
      {/* 손소독제 펌프 — 책상 환자 쪽(앞) 코너. 클릭 → 펌프 위에 안내가 띠링 */}
      <group
        position={[0.16, 0.84, -0.34]}
        onClick={(e) => { e.stopPropagation(); washHands() }}
        onPointerOver={(e) => { e.stopPropagation(); setCameraHold(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setCameraHold(false); document.body.style.cursor = 'auto' }}
      >
        {/* 손소독 리그 (보틀+양팔 애니메이션 일체형) + 클릭 히트박스 */}
        <Suspense fallback={null}>
          <group rotation={[0, -0.7, 0]}>
            <HygieneRig active={sanitizerHit} />
          </group>
        </Suspense>
        <mesh position={[0, 0.13, 0]} visible={false}>
          <cylinderGeometry args={[0.06, 0.06, 0.3, 8]} />
          <meshBasicMaterial />
        </mesh>
        {/* 클릭 시 펌프 위로 떠오르는 인-월드 안내 */}
        {sanitizerHit && (
          <Html position={[0, 0.42, 0]} center distanceFactor={3} zIndexRange={[20, 0]}>
            <div className="sanitizer-pop" style={{
              whiteSpace: 'nowrap', background: 'rgba(20,24,28,0.92)', color: '#fff',
              fontSize: 13, fontWeight: 700, padding: '5px 11px', borderRadius: 9999,
              boxShadow: '0 4px 14px rgba(0,0,0,0.3)', pointerEvents: 'none',
            }}>
              손을 소독했습니다 🧼
            </div>
          </Html>
        )}
      </group>
      {/* 키보드 + 서류 더미 + 전화기 */}
      {/* 키보드 — 모니터 바로 앞, 평행 (베이스 + 키 줄 + 스페이스바) */}
      <group position={[-0.3, 0.83, 0.02]} rotation={[0, 0.45, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.44, 0.016, 0.15]} />
          <meshStandardMaterial color="#e4e7ea" roughness={0.45} metalness={0.05} />
        </mesh>
        {[-0.045, -0.022, 0.001, 0.024].map((z, i) => (
          <mesh key={i} position={[0, 0.014, z - 0.012]} castShadow>
            <boxGeometry args={[0.4, 0.008, 0.017]} />
            <meshStandardMaterial color="#34383c" roughness={0.6} />
          </mesh>
        ))}
        {/* 스페이스바 */}
        <mesh position={[0, 0.014, 0.05]} castShadow>
          <boxGeometry args={[0.2, 0.008, 0.016]} />
          <meshStandardMaterial color="#34383c" roughness={0.6} />
        </mesh>
      </group>
      {/* (서류 더미 제거 — 정리) */}

      {/* 도구 컵 1 (메탈) — 펜라이트·검이경·신경망치 (참고 사진) */}
      <group position={[0.34, 0.84, -0.33]}>
        <mesh position={[0, 0.065, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.04, 0.13, 24]} />
          <meshStandardMaterial color="#c2c7cc" metalness={0.7} roughness={0.22} />
        </mesh>
        {/* 림(테두리) */}
        <mesh position={[0, 0.13, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.044, 0.0045, 8, 24]} />
          <meshStandardMaterial color="#aeb4b8" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* 안쪽 음각 (속이 빈 느낌) */}
        <mesh position={[0, 0.115, 0]}>
          <cylinderGeometry args={[0.039, 0.039, 0.035, 20]} />
          <meshStandardMaterial color="#2a2e31" roughness={0.7} />
        </mesh>
        {/* 펜라이트 (검정 + 끝 발광) */}
        <group position={[-0.018, 0, 0.012]} rotation={[0.08, 0, 0.05]}>
          <mesh position={[0, 0.18, 0]} castShadow>
            <cylinderGeometry args={[0.008, 0.008, 0.24, 10]} />
            <meshStandardMaterial color="#1e2124" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.305, 0]}>
            <cylinderGeometry args={[0.009, 0.009, 0.018, 10]} />
            <meshStandardMaterial color="#fffbe0" emissive="#fff3b0" emissiveIntensity={0.7} />
          </mesh>
        </group>
        {/* 검이경(오토스코프) — 손잡이 + 원뿔 헤드 */}
        <group position={[0.008, 0, -0.016]} rotation={[-0.05, 0, -0.02]}>
          {/* 손잡이(배터리) */}
          <mesh position={[0, 0.115, 0]} castShadow>
            <cylinderGeometry args={[0.013, 0.013, 0.18, 14]} />
            <meshStandardMaterial color="#2a2e31" metalness={0.3} roughness={0.45} />
          </mesh>
          {/* 헤드(크롬) — 앞으로 기울어짐 + 검은 스페큘럼 */}
          <group position={[0, 0.21, 0]} rotation={[0.5, 0, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.016, 0.016, 0.05, 14]} />
              <meshStandardMaterial color="#cfd4d7" metalness={0.7} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.045, 0]} castShadow>
              <coneGeometry args={[0.012, 0.04, 16]} />
              <meshStandardMaterial color="#1a1e22" roughness={0.5} />
            </mesh>
          </group>
        </group>
        {/* 신경망치 — 가는 금속 손잡이 + 삼각 고무 헤드(토마호크) */}
        <group position={[0.022, 0, 0.014]} rotation={[0.05, 0, 0.13]}>
          <mesh position={[0, 0.15, 0]} castShadow>
            <cylinderGeometry args={[0.005, 0.005, 0.26, 10]} />
            <meshStandardMaterial color="#b8bdc2" metalness={0.65} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.29, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.5]} castShadow>
            <cylinderGeometry args={[0.026, 0.026, 0.055, 3]} />
            <meshStandardMaterial color="#9b2f29" roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* 도구 컵 2 (별도 통) — 면봉 + 압설자(혀누르개) */}
      <group position={[0.52, 0.84, -0.33]}>
        <mesh position={[0, 0.055, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.045, 0.11, 24]} />
          <meshStandardMaterial color="#d6dadd" metalness={0.5} roughness={0.32} />
        </mesh>
        {/* 림(테두리) */}
        <mesh position={[0, 0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.049, 0.0045, 8, 24]} />
          <meshStandardMaterial color="#c2c7cc" metalness={0.6} roughness={0.35} />
        </mesh>
        {/* 안쪽 음각 */}
        <mesh position={[0, 0.097, 0]}>
          <cylinderGeometry args={[0.044, 0.044, 0.03, 20]} />
          <meshStandardMaterial color="#2a2e31" roughness={0.7} />
        </mesh>
        {/* 압설자 (납작한 나무 막대, 끝이 둥글게) */}
        {[-0.02, 0.0, 0.022].map((x, i) => (
          <group key={`td${i}`} position={[x, 0, -0.012]} rotation={[0.05, 0, x * 1.5]}>
            <mesh position={[0, 0.16, 0]} castShadow>
              <boxGeometry args={[0.016, 0.17, 0.004]} />
              <meshStandardMaterial color="#d8b98c" roughness={0.8} />
            </mesh>
            {/* 둥근 끝 */}
            <mesh position={[0, 0.245, 0]} scale={[1, 0.55, 0.28]} castShadow>
              <cylinderGeometry args={[0.008, 0.008, 0.016, 12]} />
              <meshStandardMaterial color="#d8b98c" roughness={0.8} />
            </mesh>
          </group>
        ))}
        {/* 면봉 (가는 막대 + 작은 솜끝) */}
        {[-0.02, 0.0, 0.02].map((x, i) => (
          <group key={`sw${i}`} position={[x, 0, 0.02]} rotation={[-0.04, 0, x * 1.6]}>
            <mesh position={[0, 0.14, 0]} castShadow>
              <cylinderGeometry args={[0.0022, 0.0022, 0.18, 6]} />
              <meshStandardMaterial color="#eceae3" roughness={0.7} />
            </mesh>
            {/* 솜끝 (작은 원기둥) */}
            <mesh position={[0, 0.235, 0]} scale={[1, 1.5, 1]}>
              <cylinderGeometry args={[0.004, 0.004, 0.014, 8]} />
              <meshStandardMaterial color="#fbfbf6" roughness={0.95} />
            </mesh>
          </group>
        ))}
      </group>

      {/* 청진기 — 책상 위에 똬리(코일+다이어프램+헤드셋), 의사에서 멀리 */}
      <DeskStethoscope position={[0.13, 0.835, -0.18]} rotation={[0, 0.4, 0]} scale={0.72} />
      {/* (전화기 제거) */}
      {/* 책상 스탠드 불빛 */}
      <pointLight position={[-0.85, 1.15, -0.2]} intensity={1.1} distance={2.2} decay={2} color="#ffc97d" />
    </group>
  )
}

/* ── 방 전체 구성: 셸 + 책상 + 의자 + 의료 소품 ── */
export function Room({ doorOpenT, examMode = false }: { doorOpenT: number; examMode?: boolean }) {
  const { backZ } = ROOM
  return (
    <group>
      <RoomShell doorOpenT={doorOpenT} />
      <Desk />
      {/* (ㄱ자 날개 제거 — 단순 직사각형 책상) */}
      {/* 환자 의자 — 롤링 스툴 1개 (화면 왼쪽 대각선) */}
      <Stool position={SEAT.pos} />

      {/* ── 외래 진료실 드레싱: 환자 뒤/옆에 배치 (카메라 프레임에 보이도록) ── */}

      {/* 검진 침대 — 좌측 뒤 코너, 프라이버시 커튼으로 가림 (지배적이지 않게) */}
      <ExamBed position={[1.95, 0, -3.5]} rotation={[0, -Math.PI / 2, 0]} />
      {/* 커튼 레일 — 침대를 코너에서 분리 (L자) */}
      {/* ㄱ자로 연결된 프라이버시 커튼 — 코너(x1.4, z-2.3)에서 두 레일이 만남 */}
      {/* 앞쪽 커튼은 카메라와 침대 사이를 가린다 → 진찰(클로즈업) 때는 숨겨 시야 확보 */}
      {!examMode && <PrivacyCurtain position={[2.4, 0, -2.3]} rotation={[0, 0, 0]} length={2.0} />}
      <PrivacyCurtain position={[0.9, 0, -3.15]} rotation={[0, Math.PI / 2, 0]} length={1.7} />

      {/* 책장 (실물 모델) — 우측 벽 따라, 따뜻한 우드 + 책/바인더 */}
      <Suspense fallback={null}>
        <Prop asset="wooden_bookshelf_worn" position={[-2.9, 0, -3.3]} rotation={[0, Math.PI / 2, 0]} scale={1.5} />
      </Suspense>
      {/* 책장 선반마다 책·바인더 줄 (색감/충실도 보강) */}
      <BookRow position={[-2.78, 1.42, -3.3]} rotation={[0, Math.PI / 2, 0]} count={7} width={0.9} />
      <BookRow position={[-2.78, 1.02, -3.3]} rotation={[0, Math.PI / 2, 0]} count={8} width={0.92} />
      <BookRow position={[-2.78, 0.62, -3.3]} rotation={[0, Math.PI / 2, 0]} count={6} width={0.88} />
      <BookRow position={[-2.78, 1.42, -3.95]} rotation={[0, Math.PI / 2, 0]} count={7} width={0.86} />
      <BookRow position={[-2.78, 1.02, -3.95]} rotation={[0, Math.PI / 2, 0]} count={8} width={0.9} />

      {/* (수납 캐비닛 제거 — 사용자 요청) */}

      {/* (롤링 스툴 제거 — 환자 의자 1개만 둔다) */}

      {/* 화분 — 뒷벽 좌측 코너 (따뜻함) */}
      <Suspense fallback={null}>
        <Prop asset="potted_plant_01" position={[-2.85, 0, backZ + 0.5]} scale={1.2} />
      </Suspense>

      {/* ── 벽 아이템 (의학적 진료실 느낌) ── */}
      {/* 뒷벽 — 인체 해부도(문에서 떨어진 환자 우측) + 면허증 + 장갑 스테이션 + 시계 */}
      <AnatomyPoster position={[0.62, 1.55, backZ + 0.05]} size={[0.6, 0.9]} kind="organs" />
      <Certificate position={[0.05, 2.22, backZ + 0.05]} size={[0.3, 0.4]} />
      <WallMedStation position={[1.6, 1.6, backZ + 0.05]} examMode={examMode} />
      <WallClock position={[2.45, 2.45, backZ + 0.08]} />

      {/* (침대 옆 벽걸이 손소독 제거 — 손위생은 책상 펌프 보틀에서) */}

      {/* 좌측 벽 — 의료 차트류 (시력표 제거): 청진기·X-ray·골격도 */}
      <Stethoscope position={[-3.12, 2.05, -0.7]} rotation={[0, Math.PI / 2, 0]} />
      <XrayViewbox position={[-3.13, 1.6, -1.4]} rotation={[0, Math.PI / 2, 0]} size={[0.6, 0.76]} />
      <AnatomyPoster position={[-3.14, 1.55, -2.2]} rotation={[0, Math.PI / 2, 0]} size={[0.42, 0.66]} kind="skeleton" frame="#46566a" />

      {/* ── 의료 기구 — 우측 벽쪽 (바이탈 모니터는 제거: 컴퓨터 EMR이 상태 패널 역할) ── */}
      <IVPole position={[2.62, 0, -2.7]} />
      {/* 이동식 바이탈 모니터 카트 — 침대(오른쪽) 앞, 커튼과 안 겹치게 */}
      <VitalsCart position={[2.05, 0, -1.5]} rotation={[0, -0.63, 0]} />
    </group>
  )
}

function Patient({
  stage,
  emotion,
  speaking,
  variant,
  gesture,
  patientAge,
  patientIdentity,
}: {
  stage: EnterStage
  emotion: Emotion
  speaking: boolean
  variant: AvatarVariant
  gesture: 'none' | 'reach'
  patientAge?: number
  patientIdentity?: string
}) {
  const group = useRef<THREE.Group>(null)
  const walkT = useRef(0)
  const [walkSpeed, setWalkSpeed] = useState(0)
  const rocketbox = usesBoneRig(variant)

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    if (stage === 'walk') {
      walkT.current = Math.min(1, walkT.current + delta / WALK_DURATION)
      const t = THREE.MathUtils.smoothstep(walkT.current, 0, 1)
      const pos = CURVE.getPoint(t)
      g.position.set(pos.x, 0, pos.z)
      // 진행 방향을 바라보되, 도착 무렵엔 의사(+z)를 향하도록 보간
      const ahead = CURVE.getPoint(Math.min(1, t + 0.03))
      const lookTarget = new THREE.Vector3().lerpVectors(
        new THREE.Vector3(ahead.x, 0, ahead.z),
        new THREE.Vector3(-1.95, 0, 0.65),  // 도착 무렵 의사(왼쪽 책상) 쪽을 바라봄 → 앉을 때 회전 일치
        THREE.MathUtils.smoothstep(t, 0.7, 1),
      )
      g.lookAt(lookTarget.x, 0, lookTarget.z)
      if (walkSpeed !== 1) setWalkSpeed(1)
    } else {
      // sit/done → 의자로 빠르게 스냅(암전 중 가려짐) 후 정착
      g.position.x = THREE.MathUtils.damp(g.position.x, SEAT.pos[0], 16, delta)
      g.position.y = THREE.MathUtils.damp(g.position.y, SEAT.sitY, 16, delta)
      g.position.z = THREE.MathUtils.damp(g.position.z, SEAT.pos[2], 16, delta)
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, SEAT.rotY, 16, delta)
      if (walkSpeed !== 0) setWalkSpeed(0)
    }
  })

  // 노크/오픈 동안 화면에서는 숨기되 선택된 한 명만 뒤에서 로드한다.
  // 컴포넌트를 통째로 제거하면 걷기 시작과 동시에 GLB 파싱이 시작되어 첫 프레임이 끊긴다.
  const patientVisible = stage !== 'knock' && stage !== 'open'
  const pose: 'walk' | 'sit' = stage === 'walk' ? 'walk' : 'sit'
  const startPos: [number, number, number] =
    stage === 'walk' ? [PATH[0].x, 0, PATH[0].z] : [SEAT.pos[0], SEAT.sitY, SEAT.pos[2]]

  return (
    <group ref={group} position={startPos} visible={patientVisible}>
      <Suspense fallback={null}>
        {rocketbox ? (
          <RealisticPatient
            emotion={emotion}
            speaking={speaking}
            variant={variant}
            pose={pose}
            walkSpeed={walkSpeed}
            gesture={gesture}
            chronologicalAge={patientAge}
            identityKey={patientIdentity}
          />
        ) : (
          <RenderPeoplePatient
            emotion={emotion}
            speaking={speaking}
            variant={variant}
            pose={pose}
            walkSpeed={walkSpeed}
            gesture={gesture}
          />
        )}
      </Suspense>
    </group>
  )
}

/* ── 진찰대에 누운 환자 ──
   환자 모델은 서 있는 리그(발 y=0, 머리 +y, 정면 +z)다. 두 겹의 group 회전으로 눕힌다:
     1) 안쪽 group rotation.x=-90° → 서있는 몸을 등이 바닥(-y)을 향하게 눕힘(정면이 +y 천장).
     2) 가운데 group rotation.y(=EXAM.patientYawY) → 몸 길이축을 침대(월드 X)에 정렬.
   pose='lie'|'lie_knees'는 모델 공간 기준으로만 다리를 포즈한다(aim이 월드 회전 반영). */
function ExamPatient({
  emotion,
  speaking,
  variant,
  pose,
  patientAge,
  patientIdentity,
  groupRef,
}: {
  emotion: Emotion
  speaking: boolean
  variant: AvatarVariant
  pose: 'sit' | 'lie' | 'lie_knees' | 'sit_edge'
  patientAge?: number
  patientIdentity?: string
  /* 진찰 부위를 체표에 안착시키는 레이캐스트의 대상 — 환자 서브트리만 쏘려고 루트를 넘겨받는다.
     (씬 전체에 쏘면 침대·페이퍼롤에 먼저 맞는다) */
  groupRef?: RefObject<THREE.Group | null>
}) {
  const rocketbox = usesBoneRig(variant)
  // 진찰대 가장자리에 걸터앉기(CVA 압통) — 포즈 자체는 의자에 앉는 것과 같아서 pose="sit"을 재사용하고
  // 위치/방향만 EXAM.sitEdge로 바꾼다. 등이 의사 쪽을 향하므로 갈비척추각을 바로 두드릴 수 있다.
  if (pose === 'sit_edge') {
    return (
      <group ref={groupRef} position={EXAM.sitEdge.patientPos} rotation={[0, EXAM.sitEdge.patientYawY, 0]}>
        <Suspense fallback={null}>
          {rocketbox ? (
            <RealisticPatient
              emotion={emotion}
              speaking={speaking}
              variant={variant}
              pose="sit"
              chronologicalAge={patientAge}
              identityKey={patientIdentity}
            />
          ) : (
            <RenderPeoplePatient emotion={emotion} speaking={speaking} variant={variant} pose="sit" />
          )}
        </Suspense>
      </group>
    )
  }
  // 앉은 진찰(두경부 — 결막·갑상샘·구강): 문진 때와 같은 의자 위치에 그대로 앉아서 받는다.
  if (pose === 'sit') {
    return (
      <group ref={groupRef} position={[SEAT.pos[0], SEAT.sitY, SEAT.pos[2]]} rotation={[0, SEAT.rotY, 0]}>
        <Suspense fallback={null}>
          {rocketbox ? (
            <RealisticPatient
              emotion={emotion}
              speaking={speaking}
              variant={variant}
              pose="sit"
              chronologicalAge={patientAge}
              identityKey={patientIdentity}
            />
          ) : (
            <RenderPeoplePatient emotion={emotion} speaking={speaking} variant={variant} pose="sit" />
          )}
        </Suspense>
      </group>
    )
  }
  return (
    <group ref={groupRef} position={EXAM.patientPos}>
      <group rotation={[0, EXAM.patientYawY, 0]}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <Suspense fallback={null}>
            {rocketbox ? (
              <RealisticPatient
                emotion={emotion}
                speaking={speaking}
                variant={variant}
                pose={pose}
                chronologicalAge={patientAge}
                identityKey={patientIdentity}
              />
            ) : (
              <RenderPeoplePatient emotion={emotion} speaking={speaking} variant={variant} pose={pose} />
            )}
          </Suspense>
        </group>
      </group>
    </group>
  )
}

/* ── 진찰 영역 — 복부 4분면 + 옆구리(CVA) + 두경부 + 흉부. 도구 활성 시 꾹 눌러(press-hold) 진찰 ──
   ⚠ 도구별 유지 시간(HOLD_SECONDS)은 store.ts가 단일 진실이다. 예전엔 여기에도 같은 표가 있어
   두경부·흉부 도구가 추가됐을 때 한쪽만 늘어나 타입이 깨졌다 — 다시 만들지 말고 import 해서 써라. */
/* 체스트피스 배치 — 부위 그룹의 로컬 원점은 "체표에서 법선으로 ANATOMY.surfaceLift(1.2cm) 띄운 점"이다.
   따라서 드럼 바닥이 실제 피부에 닿으려면 그만큼 **내려야** 한다(예전 +0.006은 1.4cm 떠 있었다).
   드럼 높이 0.02 × 스케일 → 반쪽이 0.01×스케일. lift = -surfaceLift + 반쪽 + 1mm 여유. */
const CHESTPIECE_SCALE = 0.5
// SURFACE_LIFT(=ANATOMY.surfaceLift)는 아래에서 선언되므로 TDZ를 피해 숫자를 직접 쓴다(0.012).
const CHESTPIECE_LIFT = -0.012 + 0.01 * CHESTPIECE_SCALE + 0.001
/* 드럼 윗면(스템이 붙는 높이) — 체스트피스를 쥔 손을 여기에 얹는다. */
const CHESTPIECE_TOP = CHESTPIECE_LIFT + 0.018 * CHESTPIECE_SCALE

/* ── 청진기 체스트피스 (몸에 대는 부분) — 다이어프램 헤드: 크롬 드럼 + 밝은 진동막 + 검은 씰 링,
   옆으로 꺾여 올라가는 크롬 스템 + 검은 튜브 목. 위에서 봐도 '청진기 머리'로 읽히게. ── */
/* ── 손소독 리그 (Blender 합성: 보틀+양팔+press 애니메이션) — 클릭 시 팔이 나타나 펌핑 ── */
function HygieneRig({ active }: { active: boolean }) {
  const { scene, animations } = useGLTF('/models/hygiene_rig.glb')
  const inst = useMemo(() => scene.clone(true), [scene])
  const group = useRef<THREE.Group>(null)
  const { actions } = useAnimations(animations, group)
  useEffect(() => {
    const arms: THREE.Object3D[] = []
    inst.traverse((o) => {
      if (o.name === 'R_ARM' || o.name === 'L_ARM') arms.push(o)
    })
    for (const a of arms) a.visible = active
    if (!active) return
    let mixer: THREE.AnimationMixer | null = null
    for (const key of Object.keys(actions)) {
      const act = actions[key]
      if (!act) continue
      mixer = act.getMixer()
      act.reset()
      act.setLoop(THREE.LoopOnce, 1)
      act.clampWhenFinished = true
      act.play()
    }
    // 클립이 끝나면 팔을 즉시 숨김 (퇴장 포즈로 얼어붙는 것 방지)
    const onDone = () => { for (const a of arms) a.visible = false }
    const m = mixer as THREE.AnimationMixer | null
    m?.addEventListener('finished', onDone)
    return () => m?.removeEventListener('finished', onDone)
  }, [active, inst, actions])
  return <group ref={group}><primitive object={inst} /></group>
}
useGLTF.preload('/models/hygiene_rig.glb')

/* ── 의사 팔 에셋 (MakeHuman CC0 절단 + 가운 소매 일체형) ──
   Blender 실측(2026-07-25, doctor_arm.glb 3면 렌더):
     · 원점 = 손목. 손끝 = 로컬 −Y, 손바닥 법선 = 로컬 −Z, 엄지 = 로컬 −X → **오른손**이다.
       (교차검산: 오른손은 palm × finger = thumb. (0,0,−1)×(0,−1,0) = (−1,0,0) ✓)
     · 손(손목~손끝) 로컬 bbox = (−0.0958,−0.1696,−0.0369) ~ (0.0277, 0.02, 0.057)
     · 소매 실린더 = y 0.070~0.370, 지름 ≈ 0.19 m  ← **에셋 원본은 사람 팔의 3배**다.
       그래서 scale 1.0으로 쓰면 폭 19cm짜리 회색 원뿔이 환자 배를 통째로 덮는다.
       손 길이(0.17)를 실제 손(≈15cm)에 맞추면 0.85인데, 그러면 소매가 16cm짜리 통이 된다.
       → 팔은 0.85로 키우고 **소매만 반경을 0.62배로 줄여** 가운 소매(지름 ≈11cm)로 만든다. */
const DOCTOR_ARM_SCALE = 0.85
const DOCTOR_SLEEVE_SLIM = 0.62
const ARM_HAND_MIN = new THREE.Vector3(-0.0958, -0.1696, -0.0369)
const ARM_HAND_MAX = new THREE.Vector3(0.0277, 0.02, 0.057)
const ARM_CORNER = new THREE.Vector3()
/** 회전·스케일을 적용한 '손' 부분의 최저점(local y). 이 값으로 손을 체표에 정확히 앉힌다.
 *  고정 오프셋(예전 +0.03)은 방향이 바뀌면 곧바로 파묻히거나 뜨기 때문에 계산으로 대체한다. */
function armLowestY(q: THREE.Quaternion, scale: number): number {
  let lowest = Infinity
  for (let i = 0; i < 8; i++) {
    ARM_CORNER.set(
      i & 1 ? ARM_HAND_MAX.x : ARM_HAND_MIN.x,
      i & 2 ? ARM_HAND_MAX.y : ARM_HAND_MIN.y,
      i & 4 ? ARM_HAND_MAX.z : ARM_HAND_MIN.z,
    ).multiplyScalar(scale).applyQuaternion(q)
    if (ARM_CORNER.y < lowest) lowest = ARM_CORNER.y
  }
  return lowest
}
/** 손끝 방향 + 손바닥 법선으로 팔 자세를 만든다.
 *  에셋 실측(정점 좌표): 손끝 = −Y. 손가락은 z가 커지는 쪽으로 굽는다
 *  (평균 z: 손목 0.001 → 손바닥 0.003 → 너클 0.006 → 손끝 0.021) → **손바닥 법선 = +Z**.
 *  엄지가 −X이므로 이 팔은 의사의 **왼팔**이다(오른손이면 palm×finger=thumb 여야 하는데 반대로 나온다).
 *  armQuat(축 하나 + roll)은 손바닥이 어디를 보는지 통제가 안 돼 촉진·청진에는 쓸 수 없다. */
function handQuat(finger: [number, number, number], palm: [number, number, number]): THREE.Quaternion {
  const f = new THREE.Vector3(...finger).normalize()
  const p = new THREE.Vector3(...palm)
  p.addScaledVector(f, -p.dot(f)) // 손끝 축에 직교화 (그람-슈미트)
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(f, -f.z)
  p.normalize()
  // −Y→f, +Z→p 이므로 X의 상 = −(f×p) (에셋 공간에서 (−Y)×(+Z) = −X)
  const xImage = new THREE.Vector3().crossVectors(f, p).negate()
  const m = new THREE.Matrix4().makeBasis(xImage, f.clone().negate(), p)
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

function DoctorArm({
  position,
  rotation,
  scale = 1,
  sleeveLength = 1,
}: {
  position: [number, number, number]
  rotation: [number, number, number]
  scale?: number | [number, number, number]
  sleeveLength?: number // 소매를 화면 밖까지 늘리는 배수 (팔뚝 절단면이 화면 한가운데 뜨는 걸 막는다)
}) {
  const { scene } = useGLTF('/models/doctor_arm.glb')
  const inst = useMemo(() => {
    const clone = scene.clone(true)
    // 소매(Cylinder/Torus)만 반경을 줄인다 — 원본은 팔뚝 대비 3배로 부풀려 있어 원뿔로 읽힌다.
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (!materials.some((m) => m?.name === 'sleeve')) return
      // 소매 원통(y 0.07~0.37)만 길이를 늘린다. 손목 커프(Torus)는 그대로 둔다.
      const stretch = mesh.name.toLowerCase().includes('cylinder') ? sleeveLength : 1
      mesh.scale.set(DOCTOR_SLEEVE_SLIM, stretch, DOCTOR_SLEEVE_SLIM)
      if (stretch !== 1) mesh.position.y += 0.07 * (1 - stretch) // 소매 시작(손목쪽)을 제자리에 고정
    })
    return clone
  }, [scene, sleeveLength])
  return <primitive object={inst} position={position} rotation={rotation} scale={scale} />
}
useGLTF.preload('/models/doctor_arm.glb')

/* ── 갑상샘 촉진 리그 — 앉은 환자의 목 앞으로 의사의 양손이 뻗어 들어온다.
   AuscultationRig처럼 yaw만 카메라를 향해 돌려 항상 내 쪽에서 팔이 들어오게.
   팔 방향은 오일러 대신 쿼터니언으로 계산: 에셋 기준 손끝=-Z, 손바닥=-Y. ── */
function armQuat(fingerDir: [number, number, number], roll: number): THREE.Quaternion {
  // 항등 렌더 실측: 에셋의 손끝은 -Y(아래), 소매 축은 +Y (glTF 임포트 후 three.js 기준)
  const d = new THREE.Vector3(...fingerDir).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d)
  const qr = new THREE.Quaternion().setFromAxisAngle(d, roll)
  return qr.multiply(q)
}

/* ── 구강검사 리그 — 설압자(나무 스틱)+펜라이트를 쥔 오른손이 입으로 뻗어 들어온다 ── */
function OralExamRig() {
  const aim = useRef<THREE.Group>(null)
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  const wp = useMemo(() => new THREE.Vector3(), [])
  // 손끝이 위-안쪽(입)을 향하도록 — 스틱은 손 로컬 -Y(손끝 방향)로 뻗는다
  const q = useMemo(() => armQuat([-0.22, 0.62, -0.75], 0), [])
  useFrame(({ camera, clock }) => {
    const g = aim.current
    if (!g) return
    // 앵커 = 입 (혀 앵커가 있으면 그 자리, 없으면 머리 본 아래 5.5cm)
    const tongue = ANCHOR_POOL.oral_tongue
    if (tongue.radius > 0) g.position.copy(tongue.pos)
    else g.position.set(PATIENT_HEAD_WORLD.x, PATIENT_HEAD_WORLD.y - 0.055, PATIENT_HEAD_WORLD.z)
    g.getWorldPosition(wp)
    g.rotation.y = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z)
    const r = reach.current
    if (r) {
      if (t0.current === null) t0.current = clock.elapsedTime
      const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.5)
      const ease = 1 - Math.pow(1 - k, 3)
      // 인두를 볼 때는 설압자를 1.5cm 더 깊이 넣어 혀뿌리를 눌러 내린다(평가표 "상하좌우 관찰").
      const deep = HOVER_CONTACT.region === 'oral_pharynx' ? -0.015 : 0
      r.position.set(0, (1 - ease) * 0.25, (1 - ease) * 0.7 + deep)
    }
  })
  return (
    <group ref={aim}>
      <group ref={reach}>
        <Suspense fallback={null}>
          <group position={[0.05, -0.105, 0.15]} quaternion={q}>
            <DoctorArm position={[0, 0, 0]} rotation={[0, 0, 0]} scale={0.62} />
            {/* 설압자 — 손끝(-Y)에서 입 쪽으로 뻗는 나무 스틱 */}
            <group position={[0, -0.145, 0.008]}>
              <mesh rotation={[0, 0, 0]}>
                <boxGeometry args={[0.017, 0.115, 0.0022]} />
                <meshStandardMaterial color="#d8b98a" roughness={0.85} />
              </mesh>
              {/* 둥근 끝 */}
              <mesh position={[0, -0.058, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.0085, 0.0085, 0.0022, 20]} />
                <meshStandardMaterial color="#d8b98a" roughness={0.85} />
              </mesh>
            </group>
            {/* 펜라이트 조명 — 막대는 손에 가려진 설정, 입안을 비추는 빛만 표현 */}
            <pointLight position={[0.01, -0.16, 0.01]} intensity={0.55} distance={0.35} decay={2} color="#ffe9b8" />
          </group>
        </Suspense>
      </group>
    </group>
  )
}

/* ── 결막·공막 검사 리그 — 아랫눈꺼풀을 검지로 살짝 내리는 손.
   호버한 눈(HOVER_CONTACT)의 앵커 위로 붙는다. 눈은 부위가 작아 접촉물이 없으면
   "무엇을 하고 있는지" 화면에서 읽히지 않는다. ── */
function ConjunctivaReach() {
  const aim = useRef<THREE.Group>(null)
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  const wp = useMemo(() => new THREE.Vector3(), [])
  // 손끝이 위(눈꺼풀)를 향하고 아래에서 올라와 받친다.
  const q = useMemo(() => armQuat([-0.18, 0.66, -0.73], 0), [])
  useFrame(({ camera, clock }) => {
    const g = aim.current
    if (!g) return
    const region = HOVER_CONTACT.region
    const eye = region === 'eye_r' || region === 'eye_l' ? ANCHOR_POOL[region] : null
    g.visible = !!eye && eye.radius > 0
    if (!eye || !g.visible) { t0.current = null; return }
    // 아랫눈꺼풀은 안구 중심보다 ~1.6cm 아래다. 눈 자체를 가리지 않게 살짝 내려 붙인다.
    g.position.copy(eye.pos).addScaledVector(PATIENT_TORSO.up, -0.016)
    g.getWorldPosition(wp)
    g.rotation.y = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z)
    const r = reach.current
    if (r) {
      if (t0.current === null) t0.current = clock.elapsedTime
      const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.45)
      const ease = 1 - Math.pow(1 - k, 3)
      // 정착 후 눈꺼풀을 아주 조금씩 더 내리는 미세 움직임
      const press = k >= 1 ? (Math.sin((clock.elapsedTime - t0.current - 0.45) * 3.0) - 1) * 0.0016 : 0
      r.position.set(0, (1 - ease) * 0.22 + press, (1 - ease) * 0.55)
    }
  })
  return (
    <group ref={aim}>
      <group ref={reach}>
        <Suspense fallback={null}>
          <group position={[0.055, -0.085, 0.075]} quaternion={q}>
            <DoctorArm position={[0, 0, 0]} rotation={[0, 0, 0]} scale={0.52} sleeveLength={1.15} />
          </group>
        </Suspense>
      </group>
    </group>
  )
}

function ThyroidReach() {
  const aim = useRef<THREE.Group>(null)
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  const wp = useMemo(() => new THREE.Vector3(), [])
  // 손목 위치에서 목 중앙 살짝 위를 향해 손끝을 뻗는다 (아래에서 받쳐 만지는 자세).
  // 주의: 에셋 축 특성상 y는 의도와 반대로 지정해야 렌더에서 위를 향한다 (경험적).
  const rQuat = useMemo(() => armQuat([-0.5, 0.66, -0.55], 0), [])
  const lQuat = useMemo(() => armQuat([0.5, 0.66, -0.55], 0), [])
  useFrame(({ camera, clock }) => {
    const g = aim.current
    if (!g) return
    /* 앵커 = 갑상샘 좌·우엽 앵커의 중점. 앵커가 아직 없으면(도구 미선택 등) 예전처럼
       머리 본 아래 13cm로 근사한다 — 아바타 키와 무관하게 목에 붙는다. */
    const rl = ANCHOR_POOL.thyroid_r
    const ll = ANCHOR_POOL.thyroid_l
    if (rl.radius > 0 && ll.radius > 0) {
      g.position.copy(rl.pos).add(ll.pos).multiplyScalar(0.5)
      // 호버 중인 엽 쪽으로 손을 옮긴다 — 평가표는 "반대편을 밀고 이쪽 엽을 촉진"을 요구한다.
      const hovered = HOVER_CONTACT.region
      if (hovered === 'thyroid_r' || hovered === 'thyroid_l') {
        const target = ANCHOR_POOL[hovered].pos
        g.position.lerp(target, 0.55)
      }
    } else {
      g.position.set(PATIENT_HEAD_WORLD.x, PATIENT_HEAD_WORLD.y - 0.13, PATIENT_HEAD_WORLD.z)
    }
    g.getWorldPosition(wp)
    g.rotation.y = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z)
    const r = reach.current
    if (r) {
      if (t0.current === null) t0.current = clock.elapsedTime
      const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.5)
      const ease = 1 - Math.pow(1 - k, 3)
      // 촉진 중 미세한 상하 움직임 (만져보는 느낌)
      const knead = k >= 1 ? Math.sin((clock.elapsedTime - t0.current) * 4.2) * 0.006 : 0
      r.position.set(0, (1 - ease) * 0.3 + knead, (1 - ease) * 0.8)
    }
  })
  return (
    <group ref={aim}>
      <group ref={reach}>
        <Suspense fallback={null}>
          <group position={[0.085, -0.11, 0.09]} quaternion={rQuat}>
            <DoctorArm position={[0, 0, 0]} rotation={[0, 0, 0]} scale={0.62} />
          </group>
          <group position={[-0.085, -0.11, 0.09]} quaternion={lQuat}>
            <DoctorArm position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[-0.62, 0.62, 0.62]} />
          </group>
        </Suspense>
      </group>
    </group>
  )
}

/* ── 1인칭 청진 리그 — 의사(나)의 손이 체스트피스를 쥐고 화면 쪽에서 팔이 뻗어 들어온다.
   부모(RegionMesh의 부위 그룹)가 이미 "로컬 +Y = 체표 법선, 로컬 +Z = 카메라 쪽"으로 정렬돼
   있으므로 여기서 다시 yaw를 걸지 않는다. 예전엔 부모가 축정렬이라 월드 x/z로 yaw를 계산했는데,
   부모가 회전한 지금 그 식을 그대로 두면 이중 회전이 되어 팔이 엉뚱한 데서 들어온다. ── */
/* 팔이 들어오는 방향 — 부위 그룹은 "로컬 +Y=체표 법선, +Z=카메라의 접평면 투영"으로 서 있으므로
   시선 방향은 항상 로컬 (0, sinφ, cosφ)다(진찰 카메라 실측 φ≈51°).
   소매를 그대로 +Z(카메라 쪽)로 뻗으면 **시선과 나란해져 소매 통을 정면에서 들여다보게 된다**
   — 그게 "폭 30cm 회색 원뿔"의 정체다. 그래서 방위각을 +Z에서 옆(+X=화면 오른쪽)으로 55~60°
   틀어 팔이 화면 오른쪽에서 비스듬히 들어오게 한다(시선과 약 50~60° 차이 → 팔을 옆에서 본다). */
const STETHO_FINGER: [number, number, number] = [-0.807, -0.407, -0.429]
const STETHO_PALM: [number, number, number] = [0, -1, 0]
function AuscultationRig() {
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  useFrame(({ clock }) => {
    // 뻗어 들어오는 애니메이션: 카메라 쪽(로컬 +z)·체표 바깥(로컬 +y)에서 0.45초에 걸쳐 내려앉음.
    // 리그가 더 이상 0.4배 축소 그룹 안에 있지 않으므로 이동량도 실제 미터로 준다.
    const r = reach.current
    if (r) {
      if (t0.current === null) t0.current = clock.elapsedTime
      const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.45)
      const ease = 1 - Math.pow(1 - k, 3)
      const settle = k >= 1 ? Math.sin((clock.elapsedTime - t0.current - 0.45) * 6) * 0.0016 : 0
      r.position.set(0, (1 - ease) * 0.22 + settle, (1 - ease) * 0.46)
    }
  })
  // 체스트피스를 쥔 손 — 손의 최저점이 드럼 윗면에 얹히도록 높이를 계산한다.
  const grip = useMemo(() => {
    const q = handQuat(STETHO_FINGER, STETHO_PALM)
    // 체스트피스 윗면보다 살짝 아래까지 손을 내려 '쥐고 있다'로 읽히게 한다.
    return { q, y: CHESTPIECE_TOP - 0.008 - armLowestY(q, DOCTOR_ARM_SCALE) }
  }, [])
  const tubeGeo = useMemo(() => {
    // 스템(체스트피스 로컬 (0.05,0.016,0)에서 −0.55rad 기울어진 크롬 대) 끝에서 손목 옆으로 빠져 화면 쪽으로.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.038, CHESTPIECE_LIFT + 0.028, 0.004),
      new THREE.Vector3(0.055, CHESTPIECE_LIFT + 0.085, 0.10),
      new THREE.Vector3(0.05, CHESTPIECE_LIFT + 0.175, 0.27),
    ])
    return new THREE.TubeGeometry(curve, 24, 0.0055, 10, false)
  }, [])
  return (
    <group ref={reach}>
      <group position={[0, CHESTPIECE_LIFT, 0]} scale={CHESTPIECE_SCALE}>
        <Chestpiece />
      </group>
      {/* 체스트피스를 쥔 팔 — MakeHuman 절단 팔 + 가운 소매 일체형 (이음새 없음) */}
      <Suspense fallback={null}>
        <group position={[0.055, grip.y, 0.03]} quaternion={grip.q}>
          <DoctorArm position={[0, 0, 0]} rotation={[0, 0, 0]} scale={DOCTOR_ARM_SCALE} sleeveLength={1.15} />
        </group>
      </Suspense>
      {/* 청진기 튜브 — 스템에서 손목 옆으로 빠져 화면 쪽으로 */}
      <mesh geometry={tubeGeo}>
        <meshStandardMaterial color="#1d1f24" roughness={0.5} />
      </mesh>
    </group>
  )
}

/* ── 1인칭 촉진/타진 리그 — 손만 잘려 떠 있던 female_hand.glb 대신 청진과 같은 팔 에셋을 쓴다.
   (텍스처 없는 백묵색 손 + 손목 절단면 + 고정 오프셋으로 인한 파묻힘이 전부 그 에셋 때문이었다)
   손바닥이 체표를 향하고, 손의 최저점이 정확히 피부 높이에 오도록 계산해 앉힌다. ── */
const PALP_FINGER: [number, number, number] = [-0.840, -0.309, -0.446]
const PALP_PALM: [number, number, number] = [0, -1, 0]
function PalpationRig({ deep }: { deep: boolean }) {
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  const grip = useMemo(() => {
    const q = handQuat(PALP_FINGER, PALP_PALM)
    return { q, low: armLowestY(q, DOCTOR_ARM_SCALE) }
  }, [])
  // 부위 그룹의 로컬 원점은 피부에서 1.2cm 떠 있다 → 피부는 y=-0.012.
  // 깊은 촉진(deep)은 1.2cm 더 눌러 넣어 '깊게 누른다'가 보이게 한다.
  const contactY = (deep ? -0.024 : -0.011) - grip.low
  useFrame(({ clock }) => {
    const r = reach.current
    if (!r) return
    if (t0.current === null) t0.current = clock.elapsedTime
    const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.4)
    const ease = 1 - Math.pow(1 - k, 3)
    // 정착 후엔 눌렀다 떼는 미세 움직임 (촉진하는 느낌)
    const knead = k >= 1 ? (Math.sin((clock.elapsedTime - t0.current - 0.4) * 3.4) - 1) * 0.0035 : 0
    r.position.set(0, (1 - ease) * 0.2 + knead, (1 - ease) * 0.4)
  })
  return (
    <group ref={reach}>
      <Suspense fallback={null}>
        <group position={[0.07, contactY, 0.038]} quaternion={grip.q}>
          <DoctorArm position={[0, 0, 0]} rotation={[0, 0, 0]} scale={DOCTOR_ARM_SCALE} sleeveLength={1.15} />
        </group>
      </Suspense>
    </group>
  )
}

function Chestpiece() {
  const chrome = <meshStandardMaterial color="#c9ced3" metalness={0.92} roughness={0.16} />
  return (
    <group renderOrder={14}>
      {/* 크롬 본체 드럼 (아래로 살짝 넓어지는 원통) */}
      <mesh castShadow>
        <cylinderGeometry args={[0.043, 0.047, 0.02, 44]} />
        {chrome}
      </mesh>
      {/* 상단 크롬 테두리 링 (다이어프램을 감싸는 림) */}
      <mesh position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.041, 0.006, 16, 48]} />
        {chrome}
      </mesh>
      {/* 얇은 검은 씰 링 (림과 진동막 사이) */}
      <mesh position={[0, 0.014, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.037, 0.003, 12, 48]} />
        <meshStandardMaterial color="#14181c" roughness={0.5} />
      </mesh>
      {/* 다이어프램 진동막 (밝은 반투명 원판) — 이게 '청진기 머리'로 읽히게 */}
      <mesh position={[0, 0.0155, 0]}>
        <cylinderGeometry args={[0.036, 0.036, 0.0035, 44]} />
        <meshStandardMaterial color="#eef1f3" metalness={0.08} roughness={0.32} />
      </mesh>
      {/* 옆으로 꺾여 올라가는 크롬 스템 + 검은 튜브 목 (청진기 티) */}
      <group position={[0.05, 0.016, 0]} rotation={[0, 0, -0.55]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.0095, 0.0095, 0.055, 18]} />
          {chrome}
        </mesh>
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.0095, 0.035, 18]} />
          <meshStandardMaterial color="#0d1116" roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 청진기 바이노럴(귀꽂이) — 의사(카메라)에 붙어 화면 하단에 크게. 내가 끼고 있는 느낌. 줄 없음.
   U(∪): 아래 굴곡=검은 고무, 위 팔=크롬, 끝에 검은 이어피스. ── */
function WornEarpiece() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    if (!ref.current) return
    const off = new THREE.Vector3(0, -0.165, -0.45).applyQuaternion(camera.quaternion)
    ref.current.position.copy(camera.position).add(off)
    ref.current.quaternion.copy(camera.quaternion)
  })
  const R = 0.04 // 작게
  const t = 0.005 // 크롬 팔 두께
  // 크롬 팔 — 수직에서 위쪽이 안쪽으로 '부드럽게' 휘는 곡선(TubeGeometry)
  const arms = useMemo(() =>
    [-1, 1].map((s) => {
      const pts = [
        new THREE.Vector3(s * R, 0.02, 0),
        new THREE.Vector3(s * R, 0.075, 0),
        new THREE.Vector3(s * R * 0.5, 0.112, 0),
        new THREE.Vector3(s * 0.015, 0.122, 0),
      ]
      return {
        geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, t, 8, false),
        tip: [s * 0.015, 0.124, 0] as [number, number, number],
      }
    }), [R, t])
  const chrome = <meshStandardMaterial color="#d2d7da" metalness={0.9} roughness={0.15} />
  const rubber = <meshStandardMaterial color="#0d1116" roughness={0.5} />
  return (
    <group ref={ref}>
      {/* 검은 고무 ∪ 굴곡 (아래, 위로 열림) — 두툼한 튜브 */}
      <mesh position={[0, 0.02, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[R, 0.008, 14, 48, Math.PI]} />
        {rubber}
      </mesh>
      {/* 고무→크롬 연결 마디 */}
      {[-R, R].map((x, i) => (
        <mesh key={`j${i}`} position={[x, 0.022, 0]}>
          <sphereGeometry args={[0.007, 10, 10]} />
          {chrome}
        </mesh>
      ))}
      {/* 부드럽게 휘는 크롬 팔 + 검은 이어팁 */}
      {arms.map((a, i) => (
        <group key={i}>
          <mesh geometry={a.geo}>
            <meshStandardMaterial color="#d2d7da" metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={a.tip}>
            <sphereGeometry args={[0.0085, 12, 12]} />
            <meshStandardMaterial color="#0d1116" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
/* ── 착용 청진기(GLB) — 실제 stethoscope.glb를 카메라에 붙여 화면 하단에 띄운다.
   손으로 만든 지오메트리 대신 스캔 모델의 U(헤드셋)+튜브 조금만 화면 위로 보이게 하고,
   나머지(긴 튜브·체스트피스)는 화면 아래 프레임 밖으로 밀어 자연스럽게 "잘려" 보이게 한다.
   ── 아래 STETHO 상수만 만지면 위치/크기/방향을 조정할 수 있다. ── */
const STETHO = {
  targetSize: 0.4,           // 화면상 청진기(U) 크기 (크게↑/작게↓)
  offX: -0.03,               // 좌우 위치 (+오른쪽 / -왼쪽)
  offY: -0.245,              // 상하 위치 (음수로 내림) — U와 연결된 줄(스템) 끝이 화면 바닥에 딱 닿게
  offZ: -0.6,                // 카메라 앞 거리 (작을수록 가까워 큼)
  rotX: 0,                   // 앞뒤 눕히기
  rotY: 0,                   // 좌우 회전
  rotZ: 0,                   // 화면 평면 회전 — U가 거꾸로면 Math.PI
} as const

void WornEarpiece // 이전 수제 지오메트리 버전 — 폴백 참고용 보존 (GLB가 안 뜨면 되돌리기)

function WornStethoGLB() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    if (!ref.current) return
    const off = new THREE.Vector3(STETHO.offX, STETHO.offY, STETHO.offZ).applyQuaternion(camera.quaternion)
    ref.current.position.copy(camera.position).add(off)
    ref.current.quaternion.copy(camera.quaternion)
  })
  return (
    <group ref={ref}>
      <Suspense fallback={null}>
        <FittedGLB
          url="/models/stethoscope_u2.glb" // 체스트피스를 GLB 파일에서 영구 제거한 버전 (U+튜브만)
          targetSize={STETHO.targetSize}
          rotation={[STETHO.rotX, STETHO.rotY, STETHO.rotZ]}
        />
      </Suspense>
    </group>
  )
}

/* 진행 디스크 색 — 매 프레임 문자열 파싱을 피하려고 미리 만들어 둔다.
   진행 중(초록) / 이미 찍은 부위(옅은 회색). */
const DISK_ACTIVE = new THREE.Color('#6fd0a0')
const DISK_DONE = new THREE.Color('#b9c0c4')

/* 체스트피스를 대는 도구 — 복부·심장·폐 청진. 타진·촉진은 손이다. */
const AUSCULTATION_TOOLS: readonly ExamToolId[] = ['auscultation', 'heart_auscultation', 'lung_auscultation']
const HEADNECK_SET = new Set<string>(HEADNECK_REGIONS)

/* 두경부 접촉 리그는 머리 프레임(PATIENT_HEAD_WORLD)에 붙어 씬 루트에서 렌더되므로,
   RegionMesh(부위 그룹) 안에 넣을 수 없다. 어느 부위를 향할지만 여기로 전달한다.
   화면의 진찰 환자는 항상 한 명이고 호버도 한 번에 하나라 모듈 스코프 하나로 충분하다. */
const HOVER_CONTACT: { region: ExamRegion | null } = { region: null }

/* ══════════════════════════════════════════════════════════════════════════
   진찰 부위 앵커 — 본(bone) 기준 해부학적 유도 + 체표 레이캐스트
   ──────────────────────────────────────────────────────────────────────────
   EXAM.patientPos는 '발 기준점'이라, 같은 자리에 눕혀도 배의 실제 높이·위치는
   아바타의 다리 길이/몸통 길이/체형에 따라 달라진다. 아바타 풀이 MPFB 12종 +
   비만·마름 변형 + VALID 6종 + Rocketbox 3종 + RenderPeople 3종이라 고정 좌표로는
   맞출 방법이 없다(사용자 지적: "미묘하게 안 맞는다").
   → 환자 컴포넌트가 매 프레임 갱신하는 PATIENT_TORSO(골반·가슴·좌우 넓적다리 본에서
     만든 몸통 프레임)에서 해부학적 비율로 중심을 잡고, 레이캐스트로 실제 피부에 올린다.
   ══════════════════════════════════════════════════════════════════════════ */

/* 해부학 비율 — 공식 평가표의 "칼돌기부터 두덩결합까지", "배꼽 중심 4구역" 서술을 수치화한 것.
   화면에서 4분면이 너무 몰리거나 벌어지면 여기 비율만 조정하면 된다.

   ⚠ 기준선은 진짜 칼돌기·두덩결합이 아니라 **본 위치**(pelvis 본 ↔ spine_03 본)다.
   MPFB 실측(mh_f60_ob, 앙와위): pelvis (1.808, 0.809), spine_03 (1.579, 0.787) → torsoLen 0.230 m.
   실제 두덩결합~칼돌기는 이보다 1.4배쯤 길다(본이 랜드마크까지 닿지 않는다). 그래서
   간격 비율은 스펙 초안값(0.16/0.55)을 그대로 쓰지 않고 이 짧은 기준선에 맞춰 다시 잡았다.
   검산: 갈비활 x≈1.596 / 배꼽 x≈1.72 / 두덩결합 x≈1.844(키 1.55 m 기준 표준 인체비율)일 때
   상복부 중심 1.653(이상값 1.658), 하복부 중심 1.772(이상값 1.782)로 떨어진다. */
const ANATOMY = {
  umbilicusRatio: 0.42,    // 배꼽 높이 = 두덩결합에서 몸통 길이의 42% (아래쪽 4할)
  /* 상/하복부 중심의 세로 간격(몸통 길이 대비). 해부학적으로는 0.26쯤이 맞지만, 진찰 중 노출되는
     복부 창(걷어올린 상의 밑단 ~ 내린 바지 허리선)이 마른 체형에서 18cm 남짓이라 그 폭을 넘긴다.
     0.21 + liftToSkin의 '맨살 찾아 미끄러지기'로 네 마커를 모두 드러난 배 위에 앉힌다. */
  axialGapRatio: 0.21,
  lateralGapRatio: 0.62,   // 좌/우 중심의 가로 간격 (몸통 반폭 대비)
  /* 갈비척추각(CVA)은 12번 갈비뼈가 척추와 만나는 곳(T12~L1)이다.
     실측(mh_f60_ob): pelvis 본 = 발바닥에서 0.842 m = 0.53·H(엉덩관절), spine_03 = 1.071 m = 0.674·H.
     표준 인체비율로 엉덩뼈능선이 0.60·H(≈L4), 거기서 T12까지 약 4마디(≈0.14 m)이므로
     T12 ≈ 0.688·H → spine_03 바로 아래위다. 즉 CVA는 몸통 길이의 거의 끝(0.95)에 온다.
     스펙 초안의 0.55로 두면 걸터앉은 자세에서 마커가 셔츠 밑단(엉치)까지 내려간다. */
  /* 갈비척추각 높이. 위 실측대로 T12 ≈ 0.688·H, spine_03 = 0.674·H 이므로 기준선의 **끝을 조금 넘는다**.
     0.95로 두면 마커가 엉덩뼈능선(셔츠 밑단)까지 내려가 '엉치를 두드리는' 그림이 된다. */
  cvaHeightRatio: 1.05,
  cvaLateralRatio: 0.58,   // 척추에서 좌우로 (몸통 반폭 대비) — 좌우 마커가 서로 겹치지 않을 만큼
  cvaDepthRatio: 0.45,     // 등 쪽으로 파고드는 깊이 (몸통 반폭 대비)
  supineFlankRatio: 0.8,   // 누운 자세 폴백: 옆구리는 몸통 옆면 (등은 침대에 눌려 못 만진다)
  /* 누운 자세 옆구리 높이. CVA와 같은 0.95를 쓰면 마커가 갈비/겨드랑이까지 올라가
     상의 위나 팔 위에 얹힌다. 옆구리 중간(갈비활 아래~엉덩뼈능선 위)으로 내린다. */
  supineFlankHeightRatio: 0.62,
  surfaceLift: 0.012,      // 피부에서 살짝 띄우기 — 파묻힘/z-fighting 방지
  probeDist: 0.45,         // 레이 시작점(몸 밖) 거리
  probeRange: 0.9,         // 레이 사거리
  fallbackDepth: 0.85,     // 레이가 빗나갔을 때 중심에서 halfWidth의 몇 배만큼 밀어낼지

  /* ── 두경부 (headneck 스펙 §4) — 기준은 몸통 프레임이 아니라 머리/목 본이다 ──
     아바타마다 머리 크기·목 길이가 달라 고정 좌표는 못 쓴다. 눈 본이 있으면 그것을 쓰고,
     없으면 머리 본에서 아래 비율로 근사한다. */
  eyeUpFromHead: 0.055,    // 눈 본이 없을 때: 머리 본에서 위로 (m) — 머리 본 원점은 목 위다
  eyeHalfGap: 0.032,       // 눈 본이 없을 때: 좌우 반간격 (m)
  eyeFrontLift: 0.014,     // 안구 중심에서 각막 표면까지 (m). 눈은 레이캐스트하지 않는다 —
                           // 앞머리·속눈썹·눈썹에 먼저 맞아 마커가 이마로 튄다.
  eyeRadius: 0.024,        // 클릭 구 반지름. 좌우 간격(≈64mm)의 절반보다 작아야 두 눈이 안 겹친다
  thyroidHeightRatio: 0.42, // 목 본 → 머리 본 사이에서 반지연골 아래(갑상샘)의 높이 비율
  thyroidHalfGap: 0.020,   // 좌·우엽 중심의 반간격 (m, 몸통 크기에 비례 보정)
  thyroidRadius: 0.017,    // 좌우엽이 겹치지 않도록 반간격보다 작게
  mouthDownFromHead: 0.055, // 머리 본에서 입까지 아래로 (OralExamRig가 쓰는 값과 같다)
  oralTongueFront: 0.018,  // 입 중심에서 앞(혀 앞부분)
  oralPharynxBack: 0.030,  // 혀에서 더 안쪽(인두)
  oralRadius: 0.019,

  /* ── 흉부 (chest 스펙 §3) ──
     복장뼈 위끝(suprasternal)은 본이 없다. 목 본의 몸통축 높이에서 조금 내려 잡는다
     (목 본은 C7 근처라 실제 목아래패임보다 살짝 위·뒤에 있다). */
  suprasternalDrop: 0.10,  // 목 본 높이에서 아래로 (몸통 길이 대비)
  ics2Ratio: 0.22,         // 복장뼈 위끝(0)~칼돌기(1) 사이에서 2번째 갈비사이
  ics5Ratio: 0.68,         // 〃 5번째 갈비사이
  aorticLateral: 0.30,     // 몸통 반폭 대비 (환자 오른쪽 복장뼈옆)
  pulmonicLateral: 0.30,   // 〃 (환자 왼쪽 복장뼈옆)
  tricuspidLateral: 0.18,  // 왼쪽 복장뼈 하연
  mitralLateral: 0.62,     // 심첨 — 더 바깥
  valveRadius: 0.030,      // 4판막이 서로 겹치지 않을 만큼 (ics2↔ics5 간격의 절반 이하)
  lungUpRatio: 0.18,       // 폐야 상 (복장뼈 위끝~칼돌기 비율)
  lungMidRatio: 0.45,      // 폐야 중
  lungLowRatio: 0.75,      // 폐야 하
  lungLateral: 0.55,       // 몸통 반폭 대비 좌우
  lungBackDepth: 0.9,      // 후면 폐야: 몸통 반폭 대비 등 쪽 깊이
  lungRadius: 0.040,
} as const

type ExamAnchor = {
  region: ExamRegion
  pos: THREE.Vector3      // 체표 위 월드 좌표
  normal: THREE.Vector3   // 체표 바깥 방향 — 청진기·손·진행 디스크를 이 축으로 세운다
  radius: number          // 클릭 구 반지름 (체형 비례). 0 = 아직 계산 전 → 클릭 불가
  skin: boolean           // 맨살에 앉았는가 (false = 옷 위 / 폴백). 시각 회귀 진단용
}

/* 부위 앵커 풀 — 화면에 있는 진찰 환자는 항상 한 명이라 부위별 객체 하나를 재사용하고
   제자리에서 갱신한다. 매 프레임 새 객체를 만들면 RegionMesh가 리렌더돼 호버/홀드가 끊긴다.
   ⚠ store의 ExamRegion 전수를 반드시 채워야 한다(Record 강제). 부위를 추가하면 여기도 자동으로 는다. */
const ALL_REGIONS: readonly ExamRegion[] = [...ABDOMEN_REGIONS, ...HEADNECK_REGIONS, ...CHEST_REGIONS]
const ANCHOR_POOL = Object.fromEntries(ALL_REGIONS.map((region) => [region, {
  region,
  pos: new THREE.Vector3(),
  normal: new THREE.Vector3(0, 1, 0),
  radius: 0,
  skin: false,
} satisfies ExamAnchor])) as Record<ExamRegion, ExamAnchor>

const ANT_LUNG: readonly ExamRegion[] = [
  'lung_ant_r_up', 'lung_ant_r_mid', 'lung_ant_r_low',
  'lung_ant_l_up', 'lung_ant_l_mid', 'lung_ant_l_low',
]
const POST_LUNG: readonly ExamRegion[] = [
  'lung_post_r_up', 'lung_post_r_mid', 'lung_post_r_low',
  'lung_post_l_up', 'lung_post_l_mid', 'lung_post_l_low',
]
/* 자세별 기본 부위 — **도구가 선택되면 TOOL_REGIONS가 우선한다**(그쪽이 store와 같은 단일 진실).
   자세만으로 고르면 걸터앉은 자세에서 옆구리 2 + 흉부 16이 한꺼번에 떠 클릭이 서로를 가로챈다. */
const REGIONS_BY_POSE: Record<ExamPose, readonly ExamRegion[]> = {
  sit: HEADNECK_REGIONS,
  lie: ['ruq', 'luq', 'rlq', 'llq', 'flank_r', 'flank_l'],
  lie_knees: ['ruq', 'luq', 'rlq', 'llq', 'flank_r', 'flank_l'],
  sit_edge: ['flank_r', 'flank_l'],
}

/* 레이캐스트 재사용 객체 — 진찰 중 동시에 도는 앵커 계산은 하나뿐이라 모듈 스코프로 둔다. */
const SURFACE_RAY = new THREE.Raycaster()
const RAY_ORIGIN = new THREE.Vector3()
const RAY_DIR = new THREE.Vector3()
/* 체표로 인정하지 않을 메시 — 프라이버시 드레이프(이불)에 맞으면 부위가 천 위로 뜬다. */
const NON_SKIN_MESH = /drape|sheet|blanket/i
/* 체표로 인정하지 않을 **본** — 몸통 옆으로 쏜 레이는 몸통보다 '몸 옆에 놓인 팔'을 먼저 맞는다.
   메시 이름으로는 거를 수 없다(팔도 셔츠 소매도 같은 스킨 메시/의복 메시의 일부다).
   그래서 맞은 삼각형의 지배 본 이름으로 판정한다. 이게 없으면 옆구리 마커가 맨 팔뚝에 찍히고
   lie→lie_knees에서 팔이 조금만 움직여도 마커가 14cm씩 튄다. */
const NON_TORSO_BONE = /(arm|hand|finger|thumb|wrist|elbow|clavicle|shoulder|metacarp|palm)/i

/** 레이가 맞은 삼각형에서 스킨 가중치가 가장 큰 본의 이름. 스킨드 메시가 아니면 null. */
function dominantBoneName(hit: THREE.Intersection): string | null {
  const mesh = hit.object as THREE.SkinnedMesh
  if (!mesh.isSkinnedMesh || !hit.face || !mesh.skeleton) return null
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  if (!skinIndex || !skinWeight) return null
  let bestWeight = -1
  let bestBone = -1
  for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) {
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(vertex, k)
      if (w > bestWeight) {
        bestWeight = w
        bestBone = skinIndex.getComponent(vertex, k)
      }
    }
  }
  return mesh.skeleton.bones[bestBone]?.name ?? null
}

const ANCHOR_CENTER = new THREE.Vector3()
const ANCHOR_PROBE = new THREE.Vector3()

/** 몸 속 중심점(ANCHOR_CENTER)을 실제 체표(스킨 메시)로 끌어올려 anchor에 쓴다.
 *  three의 SkinnedMesh.raycast는 본 변형을 반영하므로 눕히고 무릎 세운 실제 자세에 맞는다. */
/* 한 번의 레이 결과 — 맨살에 맞았는지, 옷에 맞았는지. */
type SurfaceProbe = { skin: boolean; point: THREE.Vector3 } | null
const PROBE_POINT = new THREE.Vector3()
const FIRST_POINT = new THREE.Vector3()

/** 이 지점의 옷 표면이 화면에 실제로 보이는가.
 *  진찰 중 걷어올린 옷은 '메시 숨김'이 아니라 **클리핑 평면**으로 잘려 있어서 레이캐스트에는
 *  그대로 맞는다. 렌더러와 같은 판정식(clipIntersection 포함)을 그대로 써서 "잘려 나가 안 보이는
 *  옷"과 "실제로 살을 가리고 있는 옷"을 구분한다. */
function garmentVisibleAt(mesh: THREE.Object3D, point: THREE.Vector3): boolean {
  const materials = Array.isArray((mesh as THREE.Mesh).material)
    ? (mesh as THREE.Mesh).material as THREE.Material[]
    : [(mesh as THREE.Mesh).material as THREE.Material]
  for (const material of materials) {
    const planes = material?.clippingPlanes
    if (!planes || planes.length === 0) return true
    if (material.clipIntersection) {
      // 모든 평면이 잘라낼 때만 제거된다 → 하나라도 살리는 평면이 있으면 보인다
      let allClip = true
      for (const plane of planes) {
        if (plane.distanceToPoint(point) >= 0) { allClip = false; break }
      }
      if (!allClip) return true
    } else {
      let clipped = false
      for (const plane of planes) {
        if (plane.distanceToPoint(point) < 0) { clipped = true; break }
      }
      if (!clipped) return true
    }
  }
  return false
}

function probeSurface(center: THREE.Vector3, normal: THREE.Vector3, root: THREE.Object3D): SurfaceProbe {
  RAY_ORIGIN.copy(center).addScaledVector(normal, ANATOMY.probeDist)
  RAY_DIR.copy(normal).negate()
  SURFACE_RAY.set(RAY_ORIGIN, RAY_DIR)
  SURFACE_RAY.near = 0
  SURFACE_RAY.far = ANATOMY.probeRange
  const hits = SURFACE_RAY.intersectObject(root, true)
  for (const hit of hits) {
    if (NON_SKIN_MESH.test(hit.object.name)) continue
    // three r150+ 의 Raycaster는 visible=false를 걸러 주지 않는다.
    // 벗겨 놓은(숨긴) 옷 메시가 그대로 맞아 부위가 공중에 뜨는 걸 막으려면 직접 확인해야 한다.
    let node: THREE.Object3D | null = hit.object
    let hidden = false
    while (node && node !== root) {
      if (!node.visible) { hidden = true; break }
      node = node.parent
    }
    if (hidden) continue
    // 몸통이 아니라 몸 옆에 놓인 팔(또는 그 위의 소매)에 맞았으면 체표가 아니다 — 계속 파고든다.
    const bone = dominantBoneName(hit)
    if (bone && NON_TORSO_BONE.test(bone)) continue
    if (hit.object.userData.patientGarment) {
      // 잘려 나가 안 보이는 옷은 없는 셈 치고 계속 파고든다.
      if (!garmentVisibleAt(hit.object, hit.point)) continue
      // 보이는 옷이면 **여기가 체표**다. 예전처럼 옷을 뚫고 그 밑의 살을 잡으면
      // 청진기·손이 옷 속에 파묻히고(손가락만 삐져나온다), 마커도 천 밑에 박힌다.
      return { skin: false, point: PROBE_POINT.copy(hit.point) }
    }
    return { skin: true, point: PROBE_POINT.copy(hit.point) }
  }
  return null
}

/** 몸 속 중심점(ANCHOR_CENTER)을 실제 체표(스킨 메시)로 끌어올려 anchor에 쓴다.
 *  three의 SkinnedMesh.raycast는 본 변형을 반영하므로 눕히고 무릎 세운 실제 자세에 맞는다.
 *
 *  slide/slideMax를 주면, 첫 레이가 **옷**에만 맞았을 때 그 방향으로 조금씩 옮겨 가며
 *  드러난 맨살을 찾는다. 복부 4분면이 걷어올린 상의 자락이나 바지 허리선 위에 얹히는 걸 막는 장치다
 *  (해부학 비율만으로 잡으면 마른 체형에서 하복부 2분면이 통째로 청바지 위에 올라간다). */
function liftToSkin(
  anchor: ExamAnchor,
  normal: THREE.Vector3,
  root: THREE.Object3D | null,
  slide?: THREE.Vector3,
  slideMax = 0,
): boolean {
  anchor.normal.copy(normal)
  anchor.skin = false
  if (root) {
    const probed = probeSurface(ANCHOR_CENTER, normal, root)
    if (probed?.skin) {
      anchor.pos.copy(probed.point).addScaledVector(normal, ANATOMY.surfaceLift)
      anchor.skin = true
      return true
    }
    // PROBE_POINT는 아래 슬라이드 탐색이 덮어쓰므로 옷 히트는 따로 보관한다.
    const hadGarment = !!probed
    if (hadGarment) FIRST_POINT.copy(probed.point)
    if (slide && slideMax > 0) {
      const steps = 6
      for (let i = 1; i <= steps; i++) {
        ANCHOR_PROBE.copy(ANCHOR_CENTER).addScaledVector(slide, (slideMax * i) / steps)
        const shifted = probeSurface(ANCHOR_PROBE, normal, root)
        if (shifted?.skin) {
          ANCHOR_CENTER.copy(ANCHOR_PROBE)
          anchor.pos.copy(shifted.point).addScaledVector(normal, ANATOMY.surfaceLift)
          return true
        }
      }
    }
    // 피부를 못 찾았으면(완전히 옷에 덮인 부위) 옷 표면이라도 쓴다 — 그 위에 대는 게 자연스럽다.
    if (hadGarment) {
      anchor.pos.copy(FIRST_POINT).addScaledVector(normal, ANATOMY.surfaceLift)
      return true
    }
  }
  // 레이가 빗나감(모델 미준비 등) — 본 중심에서 몸통 반폭만큼 밀어내 대충 체표 근처에 둔다.
  anchor.pos.copy(ANCHOR_CENTER).addScaledVector(normal, PATIENT_TORSO.halfWidth * ANATOMY.fallbackDepth)
  return false
}

const ANCHOR_NORMAL = new THREE.Vector3()
const ANCHOR_SLIDE = new THREE.Vector3()

/* ── 머리·목 본 찾기 (두경부/흉부 앵커용) ──
   RealisticPatient는 머리 본만 export한다(PATIENT_HEAD_WORLD). 눈·목 본은 여기서 직접 찾는다.
   본 이름 체계가 셋(MPFB `eye_l`/`neck_01`, Mixamo `LeftEye`/`Neck`, Rocketbox `Bip01 Neck`)이라
   정규화 후 패턴으로 잡는다. 스켈레톤 스캔은 아바타가 바뀔 때 한 번만 한다(매 프레임 traverse 금지). */
const NORM_BONE = (n: string) => n.toLowerCase().replace(/[_.\s:|]/g, '')
const EYE_BONE_RE = /^(?:bip01)?(?:eye[lr]|[lr]eye|lefteye|righteye)$/
const NECK_BONE_RE = /^(?:bip01)?neck0?1?$/
const HEAD_BONE_RE = /^(?:bip01)?head$/
type HeadBones = { eyes: THREE.Object3D[]; neck: THREE.Object3D | null; head: THREE.Object3D | null }
const HEAD_BONE_CACHE: { root: THREE.Object3D | null; found: HeadBones } =
  { root: null, found: { eyes: [], neck: null, head: null } }

function findHeadBones(root: THREE.Object3D): HeadBones {
  /* ⚠ 머리 본을 찾기 전까지는 캐시를 신뢰하지 않는다.
     진찰 진입 첫 프레임의 루트 그룹은 아직 비어 있어서(GLB 파싱 전) 한 번 캐시하면
     영영 "본이 없다"로 굳는다 — 그러면 두경부·흉부 앵커가 통째로 폴백으로 떨어진다. */
  if (HEAD_BONE_CACHE.root === root && HEAD_BONE_CACHE.found.head) return HEAD_BONE_CACHE.found
  const eyes: THREE.Object3D[] = []
  let neck: THREE.Object3D | null = null
  let head: THREE.Object3D | null = null
  root.traverse((o) => {
    if (!o.name) return
    const n = NORM_BONE(o.name)
    if (eyes.length < 2 && EYE_BONE_RE.test(n)) eyes.push(o)
    else if (!neck && NECK_BONE_RE.test(n)) neck = o
    else if (!head && HEAD_BONE_RE.test(n)) head = o
  })
  HEAD_BONE_CACHE.root = root
  HEAD_BONE_CACHE.found = { eyes, neck, head }
  return HEAD_BONE_CACHE.found
}

const EYE_A = new THREE.Vector3()
const EYE_B = new THREE.Vector3()
const NECK_POS = new THREE.Vector3()
const SUPRA = new THREE.Vector3()
const HEAD_TO_NECK = new THREE.Vector3()

/* 머리 본의 **실측** 월드좌표. RealisticPatient가 export하는 PATIENT_HEAD_WORLD는
   `embedded`(= MPFB/VALID = 현재 아바타 풀의 대부분) 아바타에서 갱신되지 않고 초기 상수에 머문다.
   그 상수가 의자 좌석 위치와 우연히 맞아 문진·두경부에선 티가 안 났지만, 진찰대(x≈1.95)로 옮기면
   2.9 m 어긋난다 — 흉부 앵커가 통째로 빈 의자 위에 생긴다.
   RealisticPatient는 우리 소유가 아니므로 여기서 머리 본을 직접 찾아 매 프레임 갱신하고,
   못 찾은 리그에서만 기존 값으로 폴백한다. */
const HEAD_WORLD = new THREE.Vector3().copy(PATIENT_HEAD_WORLD)

function updateHeadWorld(root: THREE.Object3D | null): void {
  const bone = root ? findHeadBones(root).head : null
  if (bone) bone.getWorldPosition(HEAD_WORLD)
  else HEAD_WORLD.copy(PATIENT_HEAD_WORLD)
}

/** 목 본의 월드좌표. 못 찾으면 머리 본에서 몸통축을 따라 근사한다. */
function neckWorld(root: THREE.Object3D | null, out: THREE.Vector3): THREE.Vector3 {
  const bone = root ? findHeadBones(root).neck : null
  if (bone) return bone.getWorldPosition(out)
  return out.copy(HEAD_WORLD).addScaledVector(PATIENT_TORSO.up, -0.095)
}

/* ── 두경부 앵커 (headneck 스펙 §4) — 기준은 PATIENT_HEAD_WORLD와 눈·목 본 ── */
function buildHeadNeckAnchors(root: THREE.Object3D | null, regions: readonly ExamRegion[]): boolean {
  const { up, right, front, halfWidth } = PATIENT_TORSO
  const head = HEAD_WORLD
  // 아바타 크기 보정 — 기준 몸통 반폭 0.16 m(성인 표준)에 대한 비율. 소아·비만도 눈 간격이 따라간다.
  const scale = THREE.MathUtils.clamp(halfWidth / 0.16, 0.8, 1.25)
  let ok = false

  const wantEye = regions.includes('eye_r') || regions.includes('eye_l')
  if (wantEye) {
    const eyes = root ? findHeadBones(root).eyes : []
    if (eyes.length === 2) {
      eyes[0].getWorldPosition(EYE_A)
      eyes[1].getWorldPosition(EYE_B)
    } else {
      // 눈 본이 없는 리그 — 머리 본에서 비율로 근사한다(스펙 §4의 폴백식).
      EYE_A.copy(head).addScaledVector(up, ANATOMY.eyeUpFromHead * scale)
        .addScaledVector(right, ANATOMY.eyeHalfGap * scale)
      EYE_B.copy(head).addScaledVector(up, ANATOMY.eyeUpFromHead * scale)
        .addScaledVector(right, -ANATOMY.eyeHalfGap * scale)
    }
    /* ⚠ 좌우는 본 **이름**이 아니라 PATIENT_TORSO.right(넓적다리 본에서 유도한 환자 오른쪽)로 정한다.
       리그마다 eye_l/eye_r 표기가 뒤집히는 사례가 있어서, 복부·CVA와 같은 하나의 기준으로 통일한다. */
    const midDot = (EYE_A.dot(right) + EYE_B.dot(right)) * 0.5
    const rightEye = EYE_A.dot(right) > midDot ? EYE_A : EYE_B
    const leftEye = rightEye === EYE_A ? EYE_B : EYE_A
    for (const [region, src] of [['eye_r', rightEye], ['eye_l', leftEye]] as const) {
      const anchor = ANCHOR_POOL[region]
      // 눈은 레이캐스트하지 않는다 — 앞머리·눈썹에 먼저 맞아 마커가 이마로 튄다.
      // 안구 중심에서 각막 표면까지(≈1.4cm) 얼굴 바깥으로 밀어내는 것이 해부학적으로 정확하다.
      anchor.pos.copy(src).addScaledVector(front, ANATOMY.eyeFrontLift * scale)
      anchor.normal.copy(front)
      anchor.radius = ANATOMY.eyeRadius * scale
      anchor.skin = true
    }
    ok = true
  }

  if (regions.includes('thyroid_r') || regions.includes('thyroid_l')) {
    neckWorld(root, NECK_POS)
    // 갑상샘은 반지연골 아래 — 목 본(C7 근처)과 머리 본 사이의 아래쪽 4할 높이다.
    const neckToHead = Math.max(0.05, HEAD_TO_NECK.subVectors(HEAD_WORLD, NECK_POS).dot(up))
    for (const region of ['thyroid_r', 'thyroid_l'] as const) {
      const side = region === 'thyroid_r' ? 1 : -1
      ANCHOR_CENTER.copy(NECK_POS)
        .addScaledVector(up, neckToHead * ANATOMY.thyroidHeightRatio)
        .addScaledVector(right, side * ANATOMY.thyroidHalfGap * scale)
      const anchor = ANCHOR_POOL[region]
      anchor.radius = ANATOMY.thyroidRadius * scale
      // 목 앞면으로 끌어올린다. 옷깃에 맞으면 그 위가 체표다(그 위에서 만지는 그림이 맞다).
      if (liftToSkin(anchor, front, root)) ok = true
    }
  }

  if (regions.includes('oral_tongue') || regions.includes('oral_pharynx')) {
    // 입은 체표가 아니라 '구멍'이라 레이캐스트하지 않는다 — 쏘면 입술/턱 피부에 맞아 밖으로 나온다.
    ANCHOR_CENTER.copy(head).addScaledVector(up, -ANATOMY.mouthDownFromHead * scale)
    const tongue = ANCHOR_POOL.oral_tongue
    tongue.pos.copy(ANCHOR_CENTER).addScaledVector(front, ANATOMY.oralTongueFront * scale)
    tongue.normal.copy(front)
    tongue.radius = ANATOMY.oralRadius * scale
    tongue.skin = true
    const pharynx = ANCHOR_POOL.oral_pharynx
    pharynx.pos.copy(tongue.pos).addScaledVector(front, -ANATOMY.oralPharynxBack * scale)
    pharynx.normal.copy(front)
    pharynx.radius = ANATOMY.oralRadius * scale
    pharynx.skin = true
    ok = true
  }
  return ok
}

/* ── 흉부 앵커 (chest 스펙 §3) — 복장뼈 위끝~칼돌기 사이를 갈비사이 비율로 나눈다 ── */
function buildChestAnchors(root: THREE.Object3D | null, regions: readonly ExamRegion[]): boolean {
  const { xiphoid, up, right, front, halfWidth } = PATIENT_TORSO
  neckWorld(root, NECK_POS)
  // 복장뼈 위끝(목아래패임) — 목 본은 C7 근처(뒤·위)라 몸통축을 따라 조금 내려 잡는다.
  const torsoLen = PATIENT_TORSO.pubis.distanceTo(xiphoid)
  SUPRA.copy(NECK_POS).addScaledVector(up, -torsoLen * ANATOMY.suprasternalDrop)
  const chestLen = SUPRA.clone().sub(xiphoid).dot(up)
  if (chestLen < 0.05) return false // 목 본을 못 찾았거나 아직 바인드포즈 — 다음 프레임 재시도
  let ok = false

  // 심장 4판막 — 오른쪽 2번째 갈비사이(대동맥판) / 왼쪽 2번째(폐동맥판) / 왼쪽 5번째(삼첨판) / 심첨(승모판)
  const valves: [ExamRegion, number, number][] = [
    ['aortic', ANATOMY.ics2Ratio, ANATOMY.aorticLateral],
    ['pulmonic', ANATOMY.ics2Ratio, -ANATOMY.pulmonicLateral],
    ['tricuspid', ANATOMY.ics5Ratio, -ANATOMY.tricuspidLateral],
    ['mitral', ANATOMY.ics5Ratio, -ANATOMY.mitralLateral],
  ]
  for (const [region, axial, lateral] of valves) {
    if (!regions.includes(region)) continue
    ANCHOR_CENTER.copy(SUPRA)
      .addScaledVector(up, -chestLen * axial)
      .addScaledVector(right, halfWidth * lateral)
    const anchor = ANCHOR_POOL[region]
    anchor.radius = ANATOMY.valveRadius
    if (liftToSkin(anchor, front, root)) ok = true
  }

  // 폐야 — 좌우 각각 상/중/하. 전면은 배 쪽(front), 후면은 등 쪽(-front)에서 쏜다.
  const levels: Record<string, number> = {
    up: ANATOMY.lungUpRatio, mid: ANATOMY.lungMidRatio, low: ANATOMY.lungLowRatio,
  }
  for (const region of [...ANT_LUNG, ...POST_LUNG]) {
    if (!regions.includes(region)) continue
    const [, face, side, level] = region.split('_') as [string, 'ant' | 'post', 'r' | 'l', string]
    const back = face === 'post'
    const sign = side === 'r' ? 1 : -1
    ANCHOR_CENTER.copy(SUPRA)
      .addScaledVector(up, -chestLen * (levels[level] ?? 0.45))
      .addScaledVector(right, sign * halfWidth * ANATOMY.lungLateral)
    if (back) ANCHOR_CENTER.addScaledVector(front, -halfWidth * ANATOMY.lungBackDepth)
    ANCHOR_NORMAL.copy(front)
    if (back) ANCHOR_NORMAL.negate()
    const anchor = ANCHOR_POOL[region]
    anchor.radius = ANATOMY.lungRadius
    if (liftToSkin(anchor, ANCHOR_NORMAL, root)) ok = true
  }
  return ok
}

/** PATIENT_TORSO(본 프레임)에서 이번 자세의 진찰 부위를 계산해 ANCHOR_POOL에 쓴다.
 *  반환값은 "본도 있고 체표 레이캐스트도 맞았다"는 뜻 — 즉 이 프레임 결과를 확정해도 되는가다.
 *  false면 아직 모델이 준비 중이니 호출측이 다음 프레임에 다시 부른다. */
function buildExamAnchors(
  pose: ExamPose,
  root: THREE.Object3D | null,
  regions: readonly ExamRegion[],
): boolean {
  if (!PATIENT_TORSO.valid) return false
  const { pubis, xiphoid, up, right, front, halfWidth } = PATIENT_TORSO
  const torsoLen = pubis.distanceTo(xiphoid)
  if (torsoLen < 0.05) return false // 아직 바인드포즈에 겹쳐 있는 상태 — 다음 프레임에 재시도
  // 반경도 체형 비례. 비만 아바타에서 4분면·좌우 CVA가 서로 겹치지 않도록 상한을 둔다
  // (겹치면 클릭이 엉뚱한 부위로 들어가 좌우 소견이 뒤바뀐다).
  const quadrantR = THREE.MathUtils.clamp(halfWidth * 0.42, 0.055, 0.105)
  const flankR = THREE.MathUtils.clamp(halfWidth * 0.5, 0.06, 0.11)
  let anySkinHit = false
  updateHeadWorld(root) // 두경부·흉부 기준점. 복부는 안 쓰지만 덤프 비교용으로 항상 갱신한다.

  if (regions.some((r) => (HEADNECK_REGIONS as readonly string[]).includes(r))) {
    if (buildHeadNeckAnchors(root, regions)) anySkinHit = true
  }
  if (regions.some((r) => (CHEST_REGIONS as readonly string[]).includes(r))) {
    if (buildChestAnchors(root, regions)) anySkinHit = true
  }

  const wantFlank = regions.includes('flank_r') || regions.includes('flank_l')
  if (pose === 'sit_edge') {
    if (wantFlank) {
      // 갈비척추각은 등 쪽, 12번 갈비뼈 아래, 척추 양옆. 걸터앉은 환자는 등이 의사를 향한다.
      // 바깥 법선이 배(front)의 반대라 레이도 등 뒤에서 쏴야 한다. front로 쏘면 배 피부에 먼저 맞는다.
      ANCHOR_NORMAL.copy(front).negate()
      for (const region of ['flank_r', 'flank_l'] as const) {
        const side = region === 'flank_r' ? 1 : -1
        ANCHOR_CENTER.copy(pubis)
          .addScaledVector(up, torsoLen * ANATOMY.cvaHeightRatio)
          .addScaledVector(right, side * halfWidth * ANATOMY.cvaLateralRatio)
          .addScaledVector(front, -halfWidth * ANATOMY.cvaDepthRatio)
        const anchor = ANCHOR_POOL[region]
        anchor.radius = flankR
        if (liftToSkin(anchor, ANCHOR_NORMAL, root)) anySkinHit = true
      }
    }
    return anySkinHit
  }
  if (pose === 'sit') return anySkinHit

  const axialGap = torsoLen * ANATOMY.axialGapRatio
  const lateralGap = halfWidth * ANATOMY.lateralGapRatio
  // ruq=상+오른쪽, luq=상+왼쪽, rlq=하+오른쪽, llq=하+왼쪽.
  // 좌우는 PATIENT_TORSO.right(넓적다리 본에서 유도)라 라벨과 자동으로 일치한다 — 손으로 뒤집지 말 것.
  const quads: [ExamRegion, number, number][] = [
    ['ruq', 1, 1], ['luq', 1, -1], ['rlq', -1, 1], ['llq', -1, -1],
  ]
  /* 옷에 가렸으면 배꼽 쪽으로 미끄러뜨려 드러난 맨살을 찾는다(상복부는 아래로, 하복부는 위로).
     상한은 축간격의 0.9배 — 그 이상 옮기면 상/하 마커가 서로 겹쳐 클릭이 엉뚱한 부위로 들어간다.
     ⚠ 노출 창(걷어올린 상의 밑단 ~ 접어 내린 바지 허리선)은 마른 체형에서 15cm 남짓인데
     본 기준 몸통 길이(pelvis↔spine_03)는 22cm라, 비율만으로는 하복부가 바지 위에 얹힌다. */
  const slideMax = axialGap * 0.9
  for (const [region, axial, lateral] of quads) {
    if (!regions.includes(region)) continue
    ANCHOR_CENTER.copy(pubis)
      .addScaledVector(up, torsoLen * ANATOMY.umbilicusRatio + axial * axialGap) // 배꼽 기준 상/하
      .addScaledVector(right, lateral * lateralGap)
    ANCHOR_SLIDE.copy(up).multiplyScalar(-axial) // 배꼽을 향하는 방향
    const anchor = ANCHOR_POOL[region]
    anchor.radius = quadrantR
    if (liftToSkin(anchor, front, root, ANCHOR_SLIDE, slideMax)) anySkinHit = true
  }
  // 누운 자세의 옆구리는 폴백이다(실제 CVA는 sit_edge에서 등을 두드린다).
  // 등은 침대에 눌려 손이 못 들어가므로 몸통 '옆면'을 잡고, 바깥 법선도 좌우축(±right)으로 둔다.
  // 높이는 CVA(0.95=갈비뼈)가 아니라 옆구리 중간이다 — 0.95로 두면 마커가 겨드랑이/갈비까지 올라간다.
  if (wantFlank) {
    for (const region of ['flank_r', 'flank_l'] as const) {
      const side = region === 'flank_r' ? 1 : -1
      ANCHOR_NORMAL.copy(right).multiplyScalar(side)
      ANCHOR_CENTER.copy(pubis)
        .addScaledVector(up, torsoLen * ANATOMY.supineFlankHeightRatio)
        .addScaledVector(right, side * halfWidth * ANATOMY.supineFlankRatio)
      const anchor = ANCHOR_POOL[region]
      anchor.radius = flankR
      if (liftToSkin(anchor, ANCHOR_NORMAL, root)) anySkinHit = true
    }
  }
  return anySkinHit
}

/** 본을 못 찾았을 때만 쓰는 고정 좌표 폴백 — 기존 EXAM 상수 그대로 풀에 채운다.
 *  두경부·흉부는 고정 좌표 폴백이 없다(머리 크기·목 길이가 아바타마다 달라 의미가 없다).
 *  대신 반지름 0으로 두어 계산 전에는 클릭되지 않게 한다. */
function resetAnchorPool(pose: ExamPose) {
  for (const region of [...HEADNECK_REGIONS, ...CHEST_REGIONS]) {
    ANCHOR_POOL[region].radius = 0
    ANCHOR_POOL[region].skin = false
  }
  if (pose === 'sit') return
  if (pose === 'sit_edge') {
    for (const region of ['flank_r', 'flank_l'] as const) {
      const anchor = ANCHOR_POOL[region]
      anchor.pos.fromArray(EXAM.sitEdge.flanks[region])
      anchor.normal.set(0, 0, 1) // 등이 의사(+z)를 향한다
      anchor.radius = EXAM.flankR
    }
    return
  }
  for (const q of EXAM.quadrants) {
    const anchor = ANCHOR_POOL[q.region as ExamRegion]
    anchor.pos.fromArray(q.pos)
    anchor.normal.set(0, 1, 0) // 앙와위 배는 천장을 본다
    anchor.radius = EXAM.quadrantR
  }
  for (const f of EXAM.flanks) {
    const anchor = ANCHOR_POOL[f.region as ExamRegion]
    anchor.pos.fromArray(f.pos)
    // z=-3.3이 환자의 오른쪽(+z), -3.72가 왼쪽(-z)
    anchor.normal.set(0, 0, f.region === 'flank_r' ? 1 : -1)
    anchor.radius = EXAM.flankR
  }
}

/* 자동 시각 회귀용.
   - DEV면 항상 부위 좌표를 window.__examAnchors 로 내보낸다(좌우 검산 + 스크립트가 호버할 좌표).
   - 여기에 더해 ?examdebug=1 이면 평소 투명한 클릭 구를 부위별 색으로 칠해 눈에 보이게 한다. */
const EXAM_ANCHOR_DUMP = import.meta.env.DEV
const EXAM_DEBUG = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('examdebug') === '1'
const DEBUG_REGION_COLOR: Record<string, string> = {
  ruq: '#ff5a5a', luq: '#5aa0ff', rlq: '#ffb45a', llq: '#5affa0',
  flank_r: '#ff5aff', flank_l: '#ffff5a',
  // 두경부 — 환자 오른쪽은 따뜻한 색, 왼쪽은 찬 색으로 통일해 좌우 검산을 눈으로 하기 쉽게.
  eye_r: '#ff5a5a', eye_l: '#5aa0ff',
  thyroid_r: '#ff9a3c', thyroid_l: '#3cc8ff',
  oral_tongue: '#ff5aff', oral_pharynx: '#ffff5a',
  // 흉부 — 심장 4판막
  aortic: '#ff5a5a', pulmonic: '#5aa0ff', tricuspid: '#5affa0', mitral: '#ff5aff',
  // 폐야 — 오른쪽 계열 붉은색 / 왼쪽 계열 푸른색, 상→하로 밝기 감소
  lung_ant_r_up: '#ff8a8a', lung_ant_r_mid: '#ff5a5a', lung_ant_r_low: '#c03030',
  lung_ant_l_up: '#8ac0ff', lung_ant_l_mid: '#5aa0ff', lung_ant_l_low: '#3060c0',
  lung_post_r_up: '#ffc08a', lung_post_r_mid: '#ff9a3c', lung_post_r_low: '#c06a10',
  lung_post_l_up: '#8affd0', lung_post_l_mid: '#3cffb0', lung_post_l_low: '#10a070',
}

/* 부위 그룹 정렬용 임시값 — 매 프레임 새로 만들지 않는다. */
const ORIENT_X = new THREE.Vector3()
const ORIENT_Z = new THREE.Vector3()
const ORIENT_M = new THREE.Matrix4()
const ORIENT_UP = new THREE.Vector3(0, 1, 0)

/** 부위 그룹을 "로컬 +Y = 체표 법선, 로컬 +Z = 카메라(의사) 쪽"으로 세운다.
 *  이렇게 해야 청진기 다이어프램과 손바닥이 자세와 무관하게 피부에 수직으로 닿고,
 *  팔은 항상 의사 쪽에서 뻗어 들어온다. 누운 자세(법선=+y)에선 예전 축정렬과 거의 같다. */
function orientToSurface(
  group: THREE.Object3D,
  worldPos: THREE.Vector3,
  normal: THREE.Vector3,
  cameraPos: THREE.Vector3,
) {
  ORIENT_Z.subVectors(cameraPos, worldPos)
  ORIENT_Z.addScaledVector(normal, -ORIENT_Z.dot(normal)) // 접평면으로 투영
  if (ORIENT_Z.lengthSq() < 1e-8) ORIENT_Z.copy(ORIENT_UP).addScaledVector(normal, -ORIENT_UP.dot(normal))
  ORIENT_Z.normalize()
  ORIENT_X.crossVectors(normal, ORIENT_Z) // x = y × z (오른손 좌표계)
  ORIENT_M.makeBasis(ORIENT_X, normal, ORIENT_Z)
  group.quaternion.setFromRotationMatrix(ORIENT_M)
}

function RegionMesh({ anchor }: { anchor: ExamAnchor }) {
  const region = anchor.region
  const examTool = useGame((s) => s.examTool)
  const examPass = useGame((s) => s.examPass)
  const examRegion = useGame((s) => s.examRegion)
  // 이 도구로 이 부위를 찍을 수 있는가 (§1.2). 도구↔부위 매칭은 store의 TOOL_REGIONS가 단일 진실.
  const active = !!examTool && TOOL_REGIONS[examTool].includes(region)
  // 이번 항목에서 이미 찍은 (pass, region)인가. 셀렉터 안에서 키를 만들어 boolean만 반환해야
  // 매 렌더 새 객체를 돌려주지 않아 zustand가 불필요한 리렌더를 일으키지 않는다.
  // 진행 키 형식은 store의 examProgressKey 하나만 쓴다(서버 exam_progress와 같은 형식).
  const done = useGame((s) => {
    const t = s.examTool
    if (!t) return false
    const prog = s.examProgress[t]
    if (!prog) return false
    return prog.done.includes(examProgressKey(s.examPass, region))
  })
  const [hover, setHover] = useState(false)
  const [holding, setHolding] = useState(false)
  const holdingRef = useRef(false)
  const progRef = useRef(0)
  const fillRef = useRef<THREE.Mesh>(null)
  const rootRef = useRef<THREE.Group>(null)
  const hitRef = useRef<THREE.Mesh>(null)
  // 도구별 유지 시간 (§1.3). 도구가 없으면 active=false라 실제로 쓰이지 않는다.
  const holdSec = examTool ? HOLD_SECONDS[examTool] : 1

  useFrame(({ camera }, delta) => {
    /* 위치·자세·크기는 앵커 객체(ExamInteractables가 제자리에서 갱신)를 매 프레임 읽어 반영한다.
       React state로 돌리면 앵커가 갱신될 때마다 리렌더가 나서 호버/홀드 상태가 흔들린다. */
    const root = rootRef.current
    if (root) {
      root.position.copy(anchor.pos)
      orientToSurface(root, anchor.pos, anchor.normal, camera.position)
    }
    // 지오메트리는 반지름 1로 만들고 스케일로 체형 비례 반경을 준다(재생성 비용 회피).
    if (hitRef.current) hitRef.current.scale.setScalar(anchor.radius)
    const fill = fillRef.current
    if (!fill) return
    // 진행 디스크는 체표 바로 위(법선 방향 1.2cm)에 눕힌다. 예전엔 구 중심이 몸 속이라 반지름만큼
    // 띄워야 했지만, 이제 중심 자체가 피부 위라 그대로 띄우면 배 위로 6cm 떠 버린다.
    fill.position.y = 0.012
    const m = fill.material as THREE.MeshBasicMaterial
    const diskR = anchor.radius * 1.5
    if (holdingRef.current && active) {
      progRef.current = Math.min(1, progRef.current + delta / holdSec)
      const s = progRef.current
      fill.scale.set(diskR * s, diskR * s, 1)
      m.color.copy(DISK_ACTIVE)
      m.opacity = 0.35 + s * 0.45
      if (s >= 1) {
        holdingRef.current = false
        progRef.current = 0
        setHolding(false)
        examRegion(region) // 이 부위 시행 (도구↔부위 검증 + 부분 진행 기록은 store가 담당)
      }
      return
    }
    // 이미 시행한 부위는 옅은 회색 디스크로 채워 남겨 둔다 — 어디를 남겼는지 한눈에 보이게.
    if (done) {
      fill.scale.set(diskR, diskR, 1)
      m.color.copy(DISK_DONE)
      m.opacity = 0.32
    } else {
      fill.scale.set(0, 0, 1)
    }
  })

  const cancel = () => {
    holdingRef.current = false
    progRef.current = 0
    setHolding(false)
  }
  const onDown = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    // 도구 미선택/부위 불일치/이미 시행 — 전부 store가 안내 문구를 결정한다(§5.3).
    if (!active || done) { examRegion(region); return }
    progRef.current = 0
    holdingRef.current = true
    setHolding(true)
  }

  const showContact = active && (hover || holding)
  // 두경부 접촉 리그(씬 루트에 있는 설압자·양손·손가락)가 어느 쪽을 향할지 알려 준다.
  useEffect(() => {
    if (!HEADNECK_SET.has(region)) return
    if (showContact) HOVER_CONTACT.region = region
    else if (HOVER_CONTACT.region === region) HOVER_CONTACT.region = null
  }, [showContact, region])
  // 깊은 촉진(deep pass): 손을 조금 더 아래로 눌러 넣고 살짝 키워 '깊게 누른다'는 걸 구분해 보여준다.
  const deep = examTool === 'palpation' && examPass === 'deep'
  return (
    <group ref={rootRef}>
      {/* 히트 영역 (반투명 하이라이트) — 반지름 1로 만들고 스케일로 체형 비례 반경을 준다 */}
      <mesh
        ref={hitRef}
        onPointerDown={onDown}
        onPointerUp={cancel}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = active && !done ? 'pointer' : 'default' }}
        onPointerOut={() => { setHover(false); cancel(); document.body.style.cursor = 'auto' }}
        renderOrder={10}
      >
        <sphereGeometry args={[1, 16, 16]} />
        {/* 파란 원 제거 — 보이지 않게(클릭/호버만). 호버 시 체스트피스/손이 나타남.
            ?examdebug=1(DEV)일 때만 부위별 색으로 보이게 해서 스크린샷 검증에 쓴다. */}
        <meshBasicMaterial
          transparent
          opacity={EXAM_DEBUG ? 0.42 : 0}
          color={EXAM_DEBUG ? DEBUG_REGION_COLOR[region] ?? '#ffffff' : '#ffffff'}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      {/* 꾹 누르는 동안 차오르는 진행 디스크 (체표 법선 방향 = 로컬 +y).
          완료 후엔 회색으로 채워진 채 남는다. 반지름 1 원판을 스케일로 키운다. */}
      <mesh ref={fillRef} rotation={[-Math.PI / 2, 0, 0]} scale={[0, 0, 1]} renderOrder={12}>
        <circleGeometry args={[1, 28]} />
        <meshBasicMaterial color="#6fd0a0" transparent opacity={0.5} depthTest={false} depthWrite={false} />
      </mesh>

      {/* 접촉 지점 표시 — 청진(복부·심장·폐): 체스트피스(디스크) / 타진·촉진: 손 GLB (줄 없음).
          부모가 체표 법선으로 서 있으므로 오프셋 +y는 곧 "피부에서 바깥으로"다.
          두경부는 부위가 작고 접촉물(설압자·펜라이트·양손)이 머리 프레임에 붙어야 해서
          여기가 아니라 씬 루트의 전용 리그(OralExamRig/ThyroidReach/ConjunctivaReach)가 담당한다. */}
      {showContact && !HEADNECK_SET.has(region) && (
        examTool && AUSCULTATION_TOOLS.includes(examTool)
          ? <AuscultationRig />
          : <PalpationRig deep={deep} />
      )}
    </group>
  )
}

function ExamInteractables({
  pose,
  variant,
  patientRef,
}: {
  pose: ExamPose
  variant: AvatarVariant
  patientRef: RefObject<THREE.Group | null>
}) {
  const tool = useGame((s) => s.examTool)
  /* 도구가 있으면 그 도구의 부위만 띄운다(store의 TOOL_REGIONS가 단일 진실).
     자세만으로 고르면 걸터앉은 자세에서 옆구리 2 + 흉부 16이 겹쳐 떠 클릭이 서로를 가로챈다. */
  const regions = useMemo<readonly ExamRegion[]>(
    () => (tool && TOOL_REGIONS[tool].length > 0 ? TOOL_REGIONS[tool] : REGIONS_BY_POSE[pose]),
    [tool, pose],
  )
  /* 레이캐스트는 비싸서 매 프레임 돌리지 않는다. 다만 진찰 진입/자세 전환 직후엔 본이
     목표 자세로 감쇠(damp)해 가는 중이라 한 프레임만 재면 '아직 서 있는 몸'을 재게 된다.
     그래서 트리거 후 1.6초 동안만 매 프레임 다시 재고, 자세가 굳으면 얼린다. */
  const probeKey = `${pose}:${variant}:${tool ?? ''}`
  const probe = useRef({ key: '', firstHit: -1, done: false })
  const debugProject = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock, camera }) => {
    const p = probe.current
    // 재계산 트리거: 진찰 진입(마운트) / 자세 전환 / 아바타 교체 / 도구 변경(부위 집합이 달라진다).
    // useEffect가 아니라 여기서 비교하는 건, 이펙트가 한 박자 늦게 돌아 그 프레임 동안 옛 좌표가
    // 그대로 쓰이는 걸 막기 위해서다.
    if (p.key !== probeKey) {
      p.key = probeKey
      p.firstHit = -1
      p.done = false
      resetAnchorPool(pose) // 본이 준비될 때까지는 고정 좌표 폴백을 보여 준다
    }
    if (!p.done) {
      /* 프레임 수가 아니라 '첫 성공 측정' 기준으로 1.6초를 센다.
         스펙은 60프레임 상한을 뒀지만, 빠른 기기에선 GLB를 받는 1초 동안 60프레임이 그냥 지나가
         영영 고정 좌표 폴백에 갇힌다(느린 기기에서만 우연히 통과한다). 본이 없으면 buildExamAnchors가
         즉시 false로 빠져 비용이 없으니, 상한 없이 될 때까지 재시도하는 편이 안전하다. */
      if (buildExamAnchors(pose, patientRef.current, regions)) {
        if (p.firstHit < 0) p.firstHit = clock.elapsedTime
        // 자세 감쇠가 끝난 뒤 얼린다. 그 전에는 매 프레임 최신 자세로 다시 잰다.
        if (clock.elapsedTime - p.firstHit > 1.6) p.done = true
      }
    }
    if (EXAM_ANCHOR_DUMP) {
      const root = patientRef.current
      const bones = root ? findHeadBones(root) : { eyes: [], neck: null }
      ;(window as unknown as { __examAnchors?: unknown }).__examAnchors = {
        pose,
        tool,
        torsoValid: PATIENT_TORSO.valid,
        halfWidth: Math.round(PATIENT_TORSO.halfWidth * 1000) / 1000,
        right: PATIENT_TORSO.right.toArray().map((v) => Math.round(v * 100) / 100),
        up: PATIENT_TORSO.up.toArray().map((v) => Math.round(v * 100) / 100),
        front: PATIENT_TORSO.front.toArray().map((v) => Math.round(v * 100) / 100),
        pubis: PATIENT_TORSO.pubis.toArray().map((v) => Math.round(v * 1000) / 1000),
        xiphoid: PATIENT_TORSO.xiphoid.toArray().map((v) => Math.round(v * 1000) / 1000),
        head: HEAD_WORLD.toArray().map((v) => Math.round(v * 1000) / 1000),
        headExported: PATIENT_HEAD_WORLD.toArray().map((v) => Math.round(v * 1000) / 1000),
        neck: NECK_POS.toArray().map((v) => Math.round(v * 1000) / 1000),
        headBone: (bones.head as THREE.Object3D | null)?.name ?? null,
        neckBone: (bones.neck as THREE.Object3D | null)?.name ?? null,
        eyeBones: bones.eyes.map((b) => b.name),
        regions: regions.map((r) => {
          // 스크린 NDC도 같이 내보낸다 — 시각 회귀 스크립트가 이 좌표로 마우스를 올려 검증한다.
          debugProject.copy(ANCHOR_POOL[r].pos).project(camera)
          return {
            region: r,
            pos: ANCHOR_POOL[r].pos.toArray().map((v) => Math.round(v * 1000) / 1000),
            normal: ANCHOR_POOL[r].normal.toArray().map((v) => Math.round(v * 100) / 100),
            r: Math.round(ANCHOR_POOL[r].radius * 1000) / 1000,
            skin: ANCHOR_POOL[r].skin,
            ndc: [Math.round(debugProject.x * 1000) / 1000, Math.round(debugProject.y * 1000) / 1000],
          }
        }),
      }
    }
  })
  return (
    <group>
      {regions.map((r) => (
        <RegionMesh key={r} anchor={ANCHOR_POOL[r]} />
      ))}
      {/* 청진 도구 활성 시: 실제 청진기 GLB(U+튜브)를 화면 하단에 표시 — 끼고 있는 느낌 */}
      {tool && AUSCULTATION_TOOLS.includes(tool) && pose !== 'sit_edge' && <WornStethoGLB />}
    </group>
  )
}

/* 카메라 패럴랙스 — 마우스 따라 살짝 시선 이동. examMode면 침대 클로즈업으로 보간.
 * 패럴랙스 세기 튜닝(클수록 마우스에 더 흔들림). 진찰은 클릭 정밀도를 위해 거의 고정.
 * 화면이 너무 흔들리거나 클릭이 어긋나면 아래 PARALLAX 값을 더 낮춰라. */
// 문진 카메라(의사 시점) 기준 위치 — 왼쪽 책상 자리. 여기서 오른쪽 대각선(환자)을 본다.
const CAM_BASE = [-1.85, 1.34, 0.95] as const
// 문진 기본 시선 — 환자(오른쪽 대각선)를 향함. 좌로 보면 책상, 우로 보면 침대.
const LOOK_CENTER = [-0.55, 1.05, 0.1] as const

const PARALLAX = {
  playX: 0.28,    // 문진 시 카메라 좌우 이동(미세 패럴랙스)
  playY: 0.12,    // 문진 시 상하
  lookPanX: 2.8,  // 시선 좌우 패닝 — 클수록 고개를 더 많이 돌려 좌(모니터)/우(환자)를 봄
  lookPanY: 0.45, // 시선 상하 패닝
  examX: 0.04,    // 진찰 시 좌우 (거의 고정 — 손소독제/4분면 클릭 정밀)
  examY: 0.025,   // 진찰 시 상하
  damp: 6,        // 따라오는 속도(클수록 빠릿) — 이전(4)과 빠름(8)의 중간
} as const

// 자동 시각 회귀 테스트는 DOM/UI 호버 상태와 무관하게 환자를 정면에 고정한다.
// DEV 빌드에서 ?camera=patient를 명시한 경우에만 활성화된다.
const FORCE_PATIENT_CAMERA = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('camera') === 'patient'

/** 걸터앉은 자세에서 의사가 환자 **앞쪽**에 서야 하는가 (chest 스펙 §4).
 *  · 심장 청진 — 4판막이 전부 앞가슴이라 항상 앞
 *  · 폐 청진/흉부 타진 — 전면 6곳을 다 찍기 전까지 앞, 다 찍으면 뒤로 돌아간다
 *  · 그 밖(CVA 압통) — 기존대로 등 뒤 */
function chestFacesFront(s: ReturnType<typeof useGame.getState>): boolean {
  const tool = s.examTool
  if (tool === 'heart_auscultation') return true
  if (tool === 'lung_auscultation' || tool === 'chest_percussion') {
    const done = s.examProgress[tool]?.done ?? []
    return !ANT_LUNG.every((r) => done.includes(examProgressKey(s.examPass, r)))
  }
  return false
}

/** 흉부 전면 진찰용 앞쪽 필라이트 — 진찰 스팟은 환자 뒤(+z)에 있어 가슴이 역광으로 죽는다.
 *  카메라가 앞으로 돌아갔을 때만 켠다(그 밖에는 등을 비추는 기존 조명 그대로).
 *  spotLight의 target은 씬 그래프에 없으면 방향이 안 잡히므로 target이 필요 없는 pointLight를 쓴다. */
function ChestFrontLight() {
  const light = useRef<THREE.PointLight>(null)
  useFrame((_, delta) => {
    const l = light.current
    if (!l) return
    const s = useGame.getState()
    const want = s.examPose === 'sit_edge' && chestFacesFront(s) ? 2.2 : 0
    l.intensity = THREE.MathUtils.damp(l.intensity, want, 3.2, delta)
  })
  return (
    <pointLight
      ref={light}
      position={EXAM.sitEdge.frontLightPos}
      intensity={0}
      distance={3.0}
      decay={2}
      color="#fff2e6"
    />
  )
}

function CameraRig({ examMode = false }: { examMode?: boolean }) {
  const look = useRef(new THREE.Vector3(LOOK_CENTER[0], LOOK_CENTER[1], LOOK_CENTER[2]))
  useFrame((state, delta) => {
    const { camera, pointer } = state
    if (import.meta.env.DEV) {
      ;(window as unknown as { __cam?: unknown }).__cam = {
        p: camera.position.toArray().map((v) => Math.round(v * 100) / 100),
        examMode,
        pose: useGame.getState().examPose,
        gesture: useGame.getState().examGesture,
      }
    }
    if (examMode) {
      const gs = useGame.getState()
      if (gs.examPose === 'sit') {
        // 앉은 진찰: 실제 머리 본 위치 기준 상대 오프셋 — 아바타 키 차이 자동 흡수.
        // 결막·구강은 얼굴, 갑상샘은 목으로 줌인. 제스처 없으면 상반신 프레임.
        const gesture = gs.examGesture
        const head = PATIENT_HEAD_WORLD
        const isNeck = gesture === 'swallow'
        // PATIENT_HEAD_WORLD는 머리 '본 원점'(목 위)이라 얼굴 중심은 그보다 ~6cm 위
        const off = gesture
          ? (isNeck ? [-0.34, 0.02, 0.36] : [-0.28, 0.13, 0.30])
          : [-0.52, 0.2, 0.55]
        const lookOff = gesture ? (isNeck ? -0.13 : 0.055) : 0.0
        const L = EXAM.camLerp
        camera.position.x = THREE.MathUtils.damp(camera.position.x, head.x + off[0] + pointer.x * PARALLAX.examX, L, delta)
        camera.position.y = THREE.MathUtils.damp(camera.position.y, head.y + off[1] + pointer.y * PARALLAX.examY, L, delta)
        camera.position.z = THREE.MathUtils.damp(camera.position.z, head.z + off[2], L, delta)
        look.current.x = THREE.MathUtils.damp(look.current.x, head.x, L, delta)
        look.current.y = THREE.MathUtils.damp(look.current.y, head.y + lookOff, L, delta)
        look.current.z = THREE.MathUtils.damp(look.current.z, head.z, L, delta)
        camera.lookAt(look.current)
        return
      }
      if (gs.examPose === 'sit_edge') {
        /* CVA 압통 · 후면 폐야: 걸터앉은 환자의 등 뒤에서 내려다본다.
           카메라는 원래 서 있던 +z쪽에 그대로 두고 침대 너머로 등을 보는 앵글이라
           진찰 조명(spotLight)이 그대로 등을 비춘다. 클릭 정밀도를 위해 패럴랙스는 최소.
           흉부 전면(심장·전면 폐야)일 때만 환자 앞쪽(-z)으로 돌아간다 — chest 스펙 §4. */
        const L = EXAM.camLerp
        const S = EXAM.sitEdge
        const front = chestFacesFront(gs)
        const pos = front ? S.camPosFront : S.camPos
        const aim = front ? S.camLookFront : S.camLook
        // 앞↔뒤 전환은 벽을 뚫고 지나가지 않도록 damp 속도를 낮춰 부드럽게 돈다(멀미 방지).
        const lerp = camera.position.z < -4.2 !== front ? L * 0.55 : L
        camera.position.x = THREE.MathUtils.damp(camera.position.x, pos[0] + pointer.x * PARALLAX.examX, lerp, delta)
        camera.position.y = THREE.MathUtils.damp(camera.position.y, pos[1] + pointer.y * PARALLAX.examY, lerp, delta)
        camera.position.z = THREE.MathUtils.damp(camera.position.z, pos[2], lerp, delta)
        look.current.x = THREE.MathUtils.damp(look.current.x, aim[0], lerp, delta)
        look.current.y = THREE.MathUtils.damp(look.current.y, aim[1], lerp, delta)
        look.current.z = THREE.MathUtils.damp(look.current.z, aim[2], lerp, delta)
        camera.lookAt(look.current)
        return
      }
      // 진찰: 침대 클로즈업으로 부드럽게 이동. 클릭 타깃이 흔들리지 않게 패럴랙스 최소화.
      const L = EXAM.camLerp
      camera.position.x = THREE.MathUtils.damp(camera.position.x, EXAM.camPos[0] + pointer.x * PARALLAX.examX, L, delta)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, EXAM.camPos[1] + pointer.y * PARALLAX.examY, L, delta)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, EXAM.camPos[2], L, delta)
      camera.lookAt(EXAM.camLook[0], EXAM.camLook[1], EXAM.camLook[2])
      return
    }
    if (FORCE_PATIENT_CAMERA) {
      camera.position.set(CAM_BASE[0], CAM_BASE[1], CAM_BASE[2])
      look.current.set(SEAT.camLook[0], SEAT.camLook[1], SEAT.camLook[2])
      camera.lookAt(look.current)
      return
    }
    // 클릭 가능한 오브젝트 호버 중(cameraHold) 또는 포인터가 2D UI 위(uiHold)엔
    // 카메라를 멈춰 클릭을 쉽게 한다 (위치·시선 모두 고정)
    const gs = useGame.getState()
    if (gs.cameraHold || gs.uiHold) {
      camera.lookAt(look.current)
      return
    }
    const targetX = CAM_BASE[0] + pointer.x * PARALLAX.playX
    const targetY = CAM_BASE[1] + pointer.y * PARALLAX.playY
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, PARALLAX.damp, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, PARALLAX.damp, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, CAM_BASE[2], PARALLAX.damp, delta)
    // 기본 시선은 정면 중앙 — 마우스 좌우로 고개를 돌려 환자(왼쪽)/컴퓨터(오른쪽)를 본다
    look.current.x = THREE.MathUtils.damp(look.current.x, LOOK_CENTER[0] + pointer.x * PARALLAX.lookPanX, PARALLAX.damp, delta)
    look.current.y = THREE.MathUtils.damp(look.current.y, LOOK_CENTER[1] + pointer.y * PARALLAX.lookPanY, PARALLAX.damp, delta)
    look.current.z = LOOK_CENTER[2]
    camera.lookAt(look.current)
  })
  return null
}

export function ClinicScene({
  entering,
  onEnterComplete,
  emotion,
  speaking,
  variant,
  showPatient = true,
  gesture = 'none',
  examMode = false,
  examPose = 'lie',
  patientAge,
  patientIdentity,
}: {
  entering: boolean
  onEnterComplete: () => void
  emotion: Emotion
  speaking: boolean
  variant: AvatarVariant
  showPatient?: boolean
  gesture?: 'none' | 'reach'
  examMode?: boolean
  examPose?: 'sit' | 'lie' | 'lie_knees' | 'sit_edge'
  patientAge?: number
  patientIdentity?: string
}) {
  const examGestureLive = useGame((s) => s.examGesture)
  // 아이+보호자 동반 진료 — 보호자가 아이 옆에 함께 앉는다. 화자 전환 시 보호자가 말하는 모션.
  const guardianInfo = useGame((s) => s.session?.guardian)
  const lastSpeaker = useGame((s) => s.lastSpeaker)
  const [stage, setStage] = useState<EnterStage>(entering ? 'knock' : 'done')
  const [fade, setFade] = useState(false) // 착석 전환을 가리는 암전
  const [examFade, setExamFade] = useState(false) // 진찰 진입 시 환자 위치 전환을 가리는 짧은 암전
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const doneRef = useRef(!entering)
  // 진찰 부위를 실제 피부 위로 올리는 레이캐스트의 대상(환자 서브트리 루트)
  const examPatientRef = useRef<THREE.Group>(null)

  // 진찰 단계 진입(의자→침대 순간이동) 순간을 짧은 암전으로 가린다
  useEffect(() => {
    if (!examMode) return
    setExamFade(true)
    const t = setTimeout(() => setExamFade(false), 560)
    return () => clearTimeout(t)
  }, [examMode])

  const complete = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    timers.current.forEach(clearTimeout)
    setStage('done')
    onEnterComplete()
  }, [onEnterComplete])

  useEffect(() => {
    if (!entering) return
    doneRef.current = false
    const localTimers = timers.current
    const at = (ms: number, fn: () => void) => localTimers.push(setTimeout(fn, ms))
    sfxKnock()
    at(900, () => {
      sfxDoor()
      setStage('open')
    })
    at(1500, () => setStage('walk'))
    for (let i = 0; i < 9; i++) at(1800 + i * 560, () => sfxStep(i))
    const walkEnd = 1500 + WALK_DURATION * 1000
    // 걷기 종료 → 암전 → (가려진 채) 의자에 착석 → 페이드 업
    at(walkEnd, () => setFade(true))
    at(walkEnd + 480, () => { sfxDoor(); setStage('sit') }) // 암전 중 좌석으로 스냅
    at(walkEnd + 1050, () => { setFade(false); complete() }) // 앉은 모습으로 밝아짐
    return () => localTimers.forEach(clearTimeout)
  }, [entering, complete])

  // 문은 오픈 단계에 열려서 walk 동안 열린 채 유지, sit에 닫힌다
  const doorOpenT = stage === 'open' || stage === 'walk' ? 1 : 0

  return (
    <div className="absolute inset-0" onClick={entering ? complete : undefined}>
      <Canvas
        shadows
        onCreated={({ gl, scene, camera }) => {
          if (import.meta.env.DEV) {
            const w = window as unknown as { __scene?: unknown; __camera?: unknown; __gl?: unknown }
            w.__scene = scene
            w.__camera = camera
            w.__gl = gl
          }
          gl.localClippingEnabled = true
          gl.shadowMap.type = THREE.PCFShadowMap
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
        camera={{ position: [-1.85, 1.34, 0.95], fov: 52, near: 0.1, far: 100 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        dpr={[1, 1.75]}
        performance={{ min: 0.5 }}
      >
        {/* HDRI는 IBL(조명/반사)만 담당 — 배경은 우리 3D 방 */}
        <SafeEnvironment intensity={0.64} />
        {/* 균일한 노란 앰비언트를 줄이고, 천장/바닥 색이 다른 자연스러운 채움광으로 분리 */}
        <ambientLight intensity={0.12} color="#f7f8fb" />
        <hemisphereLight args={['#eef4ff', '#6a5544', 0.34]} />
        {/* 창문(우측 벽) 쪽의 넓은 중성 주광 */}
        <directionalLight position={[4.5, 2.6, -0.9]} intensity={0.88} color="#fff2e4" />
        {/* 위에서 부드러운 디렉셔널 (접지 그림자) */}
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
        {/* 환자 얼굴의 넓고 부드러운 키 — 피부 형태와 눈 밑 음영을 살린다 */}
        <spotLight
          position={examMode ? [2.2, 2.8, -2.6] : SEAT.keyLightPos}
          target-position={examMode ? [1.75, 1.0, -3.5] : SEAT.faceLightTarget}
          angle={0.58}
          penumbra={1}
          intensity={examMode ? 0.62 : 1.9}
          distance={5.5}
          decay={2}
          color="#fff0e4"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0002}
          shadow-normalBias={0.012}
        />
        {/* 카메라 쪽 약한 필과 뒤쪽 쿨 림 — 눈의 캐치라이트와 머리 윤곽만 살린다 */}
        <pointLight
          position={examMode ? [1.8, 1.8, -2.6] : [-0.25, 1.45, 0.65]}
          intensity={examMode ? 0.08 : 0.26}
          distance={2.8}
          decay={2}
          color="#f5f7ff"
        />
        {!examMode && (
          <pointLight
            position={[-1.45, 1.85, -0.9]}
            intensity={0.42}
            distance={2.6}
            decay={2}
            color="#d8e7ff"
          />
        )}
        <Suspense fallback={null}>
          {/* 천장 형광등 패널 (방 조명) */}
          <CeilingPanel x={-1.3} z={-1.8} />
          <CeilingPanel x={1.3} z={-1.8} />
          <CeilingPanel x={-1.3} z={-3.8} />
          <CeilingPanel x={1.3} z={-3.8} />
          <Room doorOpenT={doorOpenT} examMode={examMode} />
          {/* 환자 로드 실패(텍스처 디코드 등)가 캔버스 전체를 검게 만들지 않도록 바운더리로 격리 */}
          <EnvBoundary>
            {showPatient && (examMode
              ? <ExamPatient
                  emotion={emotion}
                  speaking={speaking && lastSpeaker !== 'guardian'}
                  variant={variant}
                  pose={examPose}
                  patientAge={patientAge}
                  patientIdentity={patientIdentity}
                  groupRef={examPatientRef}
                />
              : <Patient
                  stage={stage}
                  emotion={emotion}
                  speaking={speaking && lastSpeaker !== 'guardian'}
                  variant={variant}
                  gesture={gesture}
                  patientAge={patientAge}
                  patientIdentity={patientIdentity}
                />)}
          </EnvBoundary>
          {/* 보호자(엄마 등) — 아이 환자 옆 보조 의자에 동석. 진찰 단계에선 침대 옆이 아닌 자리 유지 */}
          {showPatient && guardianInfo && !examMode && (
            <EnvBoundary>
              <Suspense fallback={null}>
                <group position={[-0.44, SEAT.sitY, -0.95]} rotation={[0, -0.92, 0]}>
                  <RealisticPatient
                    emotion={lastSpeaker === 'guardian' && speaking ? 'neutral' : 'anxious'}
                    speaking={speaking && lastSpeaker === 'guardian'}
                    variant={pickAvatarVariant(guardianInfo.name, guardianInfo.gender, guardianInfo.age) as MpfbVariant}
                    pose="sit"
                    chronologicalAge={guardianInfo.age}
                    identityKey={`guardian-${guardianInfo.name}`}
                  />
                </group>
                <Stool position={[-0.44, 0, -0.95]} />
              </Suspense>
            </EnvBoundary>
          )}
          {/* 진찰: 환자 몸 위 클릭 영역.
              복부 4분면·옆구리(눕기/걸터앉기) + 두경부 6부위(마주 앉기) + 흉부 16부위(걸터앉기).
              두경부도 이제 발화가 아니라 **부위를 찍어야** 시행되므로 sit 자세에서도 띄운다.
              부위 좌표는 환자 본에서 유도하므로 아바타(variant)와 환자 루트를 함께 넘긴다. */}
          {examMode && (
            <ExamInteractables pose={examPose} variant={variant} patientRef={examPatientRef} />
          )}
          {/* 흉부 전면을 볼 때만 켜지는 앞쪽 필라이트 */}
          {examMode && <ChestFrontLight />}
          {/* 갑상샘 촉진 — 앉은 환자 목으로 양손이 뻗어 들어옴 */}
          {examMode && examPose === 'sit' && examGestureLive === 'swallow' && (
            <ThyroidReach />
          )}
          {/* 구강검사 — 설압자+펜라이트를 쥔 손이 입으로 */}
          {examMode && examPose === 'sit' && examGestureLive === 'mouth_open' && (
            <OralExamRig />
          )}
          {/* 결막·공막 검사 — 아랫눈꺼풀을 내리는 손가락 */}
          {examMode && examPose === 'sit' && examGestureLive === 'eyes_up' && (
            <ConjunctivaReach />
          )}
          {/* 환자 발밑 그림자 캐처 (진찰 단계에선 침대 위라 비활성) */}
          {!examMode && <ContactShadows position={[SEAT.pos[0], 0.01, SEAT.pos[2]]} opacity={0.5} scale={5} blur={2.4} far={1.8} resolution={1024} />}
        </Suspense>
        <CameraRig examMode={examMode} />
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={0.36} intensity={1.18} distanceFalloff={0.8} quality="medium" />
          {/* 발광 천장 패널/창문에만 은은한 블룸 */}
          <Bloom intensity={0.17} luminanceThreshold={1.02} luminanceSmoothing={0.35} mipmapBlur radius={0.45} />
          <SMAA />
          <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.02} />
          <Vignette eskil={false} offset={0.23} darkness={0.24} />
        </EffectComposer>
      </Canvas>

      {/* 착석 전환을 가리는 암전 (걷기 종료 → 앉은 모습) */}
      <div
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-500"
        style={{ opacity: fade ? 1 : 0 }}
      />

      {/* 진찰 진입 암전 (의자 → 침대 전환을 가림) */}
      <div
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-500"
        style={{ opacity: examFade ? 1 : 0 }}
      />

      {/* 노크 연출 (HTML 오버레이) — 뒷벽 문 위치 */}
      <AnimatePresence>
        {stage === 'knock' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: [1, 1.12, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="font-display absolute top-[34%] left-[38%] -translate-x-1/2 text-3xl text-white/85 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
          >
            똑똑 ...
          </motion.div>
        )}
      </AnimatePresence>

      {entering && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-4 py-1.5 text-[12px] text-white/80 backdrop-blur">
          클릭해서 건너뛰기
        </div>
      )}
    </div>
  )
}
