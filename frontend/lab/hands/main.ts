/**
 * clinic-lab / hands — 의사 손 에셋 + 접촉 압박(스펙 §3) 프로토타입.
 *
 * 본 씬(`ClinicScene.tsx`)을 건드리지 않고 손 5종과 압박 표현을 따로 검증한다.
 * 렌더러 설정은 본 씬 <Canvas> 를 그대로 옮겼다 — 여기서 괜찮던 게 본 씬에서 달라 보이면
 * 원인이 재질이 아니라 톤매핑/컬러스페이스라는 뜻이라 시간을 크게 아낀다.
 *
 * URL 파라미터 / 키
 *   ?pose=palm|grip_disc|fist|pinch|two_finger   (p)
 *   ?press=none|shallow|deep                     (s)   촉진 얕게/깊게
 *   ?fx=none|shadow|dent|both                    (f)   접촉 피드백 종류
 *   ?hold=0..1                                   (h)   홀드 진행률(0=닿기 직전, 1=최대 압박)
 *   ?cam=doctor|side|closeup                       (c)
 *   ?steth=0|1                                         체스트피스(씬의 절차 도형) 표시
 *   ?hand=0                                            손 숨김 — 눌린 자국만 확인
 *
 * ⚠ 이 디렉터리는 tsconfig.app.json 의 include(src) 밖이라 `tsc -b` 가 검사하지 않는다.
 *   검증은 실제 브라우저 실행(capture.mjs)으로 한다.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import {
  PRESS_DEPTH, PRESS_HALF, PRESS_SOFT, PRESS_SHADE_SOFT, PRESS_SHADE,
  applySkinPress, type PressId,
} from './skin'

type PoseId = 'palm' | 'grip_disc' | 'fist' | 'pinch' | 'two_finger'
type FxId = 'none' | 'shadow' | 'dent' | 'both'
type CamId = 'doctor' | 'side' | 'closeup'

const POSES: PoseId[] = ['palm', 'grip_disc', 'fist', 'pinch', 'two_finger']
const PRESSES: PressId[] = ['none', 'shallow', 'deep']
const FXS: FxId[] = ['none', 'shadow', 'dent', 'both']
const CAMS: CamId[] = ['doctor', 'side', 'closeup']

const qs = new URLSearchParams(location.search)
const pick = <T extends string>(k: string, all: T[], dflt: T): T =>
  (all.includes(qs.get(k) as T) ? qs.get(k) : dflt) as T
const state = {
  pose: pick<PoseId>('pose', POSES, 'palm'),
  press: pick<PressId>('press', PRESSES, 'deep'),
  fx: pick<FxId>('fx', FXS, 'both'),
  cam: pick<CamId>('cam', CAMS, 'doctor'),
  hold: Math.max(0, Math.min(1, Number(qs.get('hold') ?? '1'))),
  steth: qs.get('steth') === '1',
  /** 손을 숨긴다 — 눌린 자국(그림자·변형) 자체가 제대로 나오는지 볼 때. */
  hand: qs.get('hand') !== '0',
}

const app = document.getElementById('app')!
const hud = document.getElementById('hud')!

/* ── 렌더러 — 본 씬 gl 설정 ── */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b1016)
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.01, 20)

/* ── 조명 — **본 씬 ClinicScene.tsx 값을 그대로** 옮긴다 ──
   처음엔 내가 임의로 잡은 3점 조명(hemisphere ground = 0x2a2622 짙은 갈색, key 2.4)을 썼는데
   그게 **에셋을 모함했다**: 손끝이 진흙색으로 나와 텍스처 결함처럼 보였다.
   실제 원인은 손끝 법선이 키라이트 반대(−Y 손끝 방향)로 누우면서 N·L 이 죽고,
   남은 항이 짙은 갈색 ground 뿐이라 그 색이 그대로 칠해진 것이었다.
   본 씬은 ground 가 밝은 웜그레이(#c9c6bf)에 **HDRI 환경광**까지 있어 상황이 다르다.
   랩 조명이 본 씬과 다르면 캡처로 내리는 판정이 전부 무효다. */
scene.add(new THREE.AmbientLight(0xf7f8fb, 0.08))
scene.add(new THREE.HemisphereLight(0xf4f6f4, 0xc9c6bf, 0.26))
const winLight = new THREE.DirectionalLight(0xfff2e4, 0.32)
winLight.position.set(4.5, 2.6, -0.9)
scene.add(winLight)
const topLight = new THREE.DirectionalLight(0xf5f7ff, 0.5)
topLight.position.set(1.2, 5, 1.0)
scene.add(topLight)

/** HDRI 환경광 — 본 씬 `<Environment files={HDRI_FILE} />` 와 같은 파일.
 *  away-facing 면을 살리는 게 대부분 이 환경광이라 빼면 손끝이 다시 죽는다. */
let envReady = false
new RGBELoader().load('/hdri/hospital_room_2_2k.hdr', (tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping
  scene.environment = tex
  envReady = true
})

/* ── 피부 — 복부를 흉내낸 곡면. 정점 변위를 쓰므로 촘촘해야 한다.
      평면으로 하면 눌림이 안 보인다(원래 평평해서 실루엣 변화가 없다). ── */
const SKIN_R = 0.19
const skinGeo = new THREE.SphereGeometry(SKIN_R, 192, 128, 0, Math.PI * 2, 0, Math.PI * 0.42)
const skinMat = new THREE.MeshStandardMaterial({
  color: 0xd3a58c, roughness: 0.74, metalness: 0.0,
  // ⚠ anisotropy·normalMap 금지 (UV 없는/조건수 나쁜 메시에서 탄젠트 NaN → 블랙아웃 전례)
})
const pressU = applySkinPress(skinMat)
const skin = new THREE.Mesh(skinGeo, skinMat)
skin.position.set(0, -SKIN_R * 0.02, 0)
scene.add(skin)

/** 접촉점 — 배꼽 약간 위(돔 꼭대기에서 살짝 앞). 손이 여기를 누른다. */
const CONTACT_DIR = new THREE.Vector3(0.06, 1, 0.18).normalize()
const contactBase = CONTACT_DIR.clone().multiplyScalar(SKIN_R).add(skin.position)

/* ── 손 ── */
const loader = new GLTFLoader()
const handCache = new Map<PoseId, THREE.Object3D>()
const handRoot = new THREE.Group()
scene.add(handRoot)
let loaded = 0

/**
 * 씬 규약과 같은 자세 계산 (`ClinicScene.tsx` handQuat 의 이식본).
 * 에셋 규약: 손끝 = 로컬 −Y, 손바닥 법선 = 로컬 +Z.
 * 여기서 finger/palm 은 **월드에서 손끝이 갈 방향 / 손바닥이 볼 방향**이다.
 */
function handQuat(finger: THREE.Vector3, palm: THREE.Vector3): THREE.Quaternion {
  const f = finger.clone().normalize()
  const p = palm.clone()
  p.addScaledVector(f, -p.dot(f))
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(f, -f.z)
  p.normalize()
  const xImage = new THREE.Vector3().crossVectors(f, p).negate()
  const m = new THREE.Matrix4().makeBasis(xImage, f.clone().negate(), p)
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

async function loadPose(pose: PoseId): Promise<THREE.Object3D> {
  const hit = handCache.get(pose)
  if (hit) return hit
  const gltf = await loader.loadAsync(`/models/hand_${pose}.glb`)
  const obj = gltf.scene
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mat = m.material as THREE.MeshStandardMaterial
    if (mat && 'roughness' in mat) mat.envMapIntensity = 0.7
  })
  handCache.set(pose, obj)
  loaded++
  return obj
}

/** 앵커 사이드카 — 도구를 손가락 사이에 놓을 좌표. */
type Anchors = {
  wrist: number[]; index_tip: number[]; middle_tip: number[]; thumb_tip: number[]
  grip_two_finger: number[]; pinch: number[]; finger_gap_cm: number; pinch_gap_cm: number
  hand_bbox_min: number[]; hand_bbox_max: number[]
}
const anchorCache = new Map<PoseId, Anchors>()
async function loadAnchors(pose: PoseId): Promise<Anchors> {
  const hit = anchorCache.get(pose)
  if (hit) return hit
  const a = await (await fetch(`/models/hand_${pose}.anchors.json`)).json() as Anchors
  anchorCache.set(pose, a)
  return a
}

/** 살(피부) 두께 — 앵커는 **본** 좌표라 손가락 배는 그보다 이만큼 바깥이다. */
const FLESH = 0.009

/**
 * 술기별로 **피부에 닿는 손의 지점**(손 로컬 좌표). 손을 여기에 맞춰 앉힌다.
 *
 * bbox 최저점으로 앉히면 안 된다 — 최저점이 손목이나 아래팔 그루터기일 수 있어
 * 손바닥이 체표에서 떠 버린다(실제로 떴다: hands_qa/lab7/hand_deep.png).
 * 술기마다 닿는 곳이 다르다는 것도 bbox 로는 표현이 안 된다.
 */
function contactLocal(pose: PoseId, a: Anchors): THREE.Vector3 {
  const wrist = new THREE.Vector3().fromArray(a.wrist)
  const tips = new THREE.Vector3().fromArray(a.grip_two_finger)
  const palmZ = new THREE.Vector3(0, 0, 1)           // 에셋 규약: 손바닥 법선 = +Z
  switch (pose) {
    case 'palm':        // 촉진 — 손바닥 한가운데(수지 기저부)가 눌린다
      return wrist.clone().lerp(tips, 0.62).addScaledVector(palmZ, FLESH + 0.004)
    case 'grip_disc':   // 청진 — 체스트피스 **밑면**이 닿는다 (드럼 높이 0.02 × 스케일)
      return tips.clone().addScaledVector(palmZ, FLESH + 0.02 * CHEST_SCALE)
    case 'two_finger':  // 갑상샘 — 2·3지 지문
    case 'pinch':
      return tips.clone().addScaledVector(palmZ, FLESH)
    case 'fist':        // CVA — 주먹 척측(새끼손가락 쪽)으로 두드린다
      return tips.clone().addScaledVector(palmZ, FLESH + 0.006)
  }
}

/* ── 체스트피스 — 씬 Chestpiece() 의 절차 도형을 그대로 옮긴 것(에셋 아님, 라이선스 무관) ── */
const CHEST_SCALE = 0.5
function buildChestpiece(): THREE.Group {
  const g = new THREE.Group()
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 0.92, roughness: 0.16 })
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.047, 0.02, 44), chrome)
  g.add(drum)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.006, 16, 48), chrome)
  rim.position.y = 0.012; rim.rotation.x = Math.PI / 2
  g.add(rim)
  const seal = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.003, 12, 48),
    new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.5 }))
  seal.position.y = 0.014; seal.rotation.x = Math.PI / 2
  g.add(seal)
  const memb = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.0035, 44),
    new THREE.MeshStandardMaterial({ color: 0xeef1f3, metalness: 0.08, roughness: 0.32 }))
  memb.position.y = 0.0155
  g.add(memb)
  const stemG = new THREE.Group()
  stemG.position.set(0.05, 0.016, 0); stemG.rotation.z = -0.55
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.055, 18), chrome)
  stemG.add(stem)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.0095, 0.035, 18),
    new THREE.MeshStandardMaterial({ color: 0x0d1116, roughness: 0.5 }))
  neck.position.y = 0.05
  stemG.add(neck)
  g.add(stemG)
  g.scale.setScalar(CHEST_SCALE)
  return g
}
const chestpiece = buildChestpiece()
// 씬이 아니라 손에 붙는다(layout 에서 attach) — 여기서는 만들어만 둔다

/* ── 배치 ── */
const contact = new THREE.Vector3()
async function layout(): Promise<void> {
  const [hand, anch] = await Promise.all([loadPose(state.pose), loadAnchors(state.pose)])
  handRoot.clear()
  handRoot.add(hand)

  const depth = PRESS_DEPTH[state.press] * state.hold
  const half = PRESS_HALF[state.press]
  const soft = PRESS_SOFT[state.press]
  const softShade = PRESS_SHADE_SOFT[state.press]
  const shade = PRESS_SHADE[state.press] * state.hold

  // 접촉점은 눌린 만큼 안으로 들어간다 — 그림자·손이 같이 내려가야 따로 놀지 않는다
  contact.copy(contactBase).addScaledVector(CONTACT_DIR, -depth)

  // 손바닥이 피부를 향하고(=−법선), 손끝은 **환자 몸을 가로질러** 뻗는다.
  // 의사는 환자 오른쪽에 서므로 팔이 화면 오른쪽에서 들어오고 손끝이 −X 로 간다.
  // (손끝을 카메라 반대쪽으로 두면 소매가 접촉점을 가려 아무것도 검증할 수 없다)
  const palmDir = CONTACT_DIR.clone().negate()
  const fingerDir = new THREE.Vector3(-1, 0, -0.22)
  const q = handQuat(fingerDir, palmDir)
  handRoot.quaternion.copy(q)
  handRoot.visible = state.hand
  // 술기별 접촉 지점이 정확히 접촉점에 오도록 앉힌다(고정 오프셋은 방향이 바뀌면 곧바로 파묻힌다)
  handRoot.position.copy(contact).sub(contactLocal(state.pose, anch).applyQuaternion(q))

  const useShade = state.fx === 'shadow' || state.fx === 'both'
  const useDent = state.fx === 'dent' || state.fx === 'both'
  pressU.uContact.value.copy(contactBase)
  // 자국의 장축 = 손끝이 향하는 방향. 손을 돌리면 자국도 같이 돌아야 한다.
  pressU.uAxis.value.copy(fingerDir).normalize()
  pressU.uDepth.value = useDent ? depth : 0
  pressU.uHalf.value.set(half[0], half[1])
  pressU.uSoft.value = soft
  pressU.uSoftShade.value = softShade
  pressU.uShade.value = useShade ? shade : 0

  // 체스트피스는 **손에 붙인다** — 손이 움직이면 같이 움직여야 '쥐고 있다'로 읽힌다.
  // 손 로컬에서: 디스크 중심 = 손끝중점 + 손바닥(+Z)*(살두께 + 드럼 반높이),
  //             체스트피스 '위'(+Y, 스템 쪽) = 손 쪽(−Z), 스템이 나가는 +X = 손목 쪽(+Y).
  chestpiece.visible = state.steth
  handRoot.remove(chestpiece)
  if (state.steth) {
    handRoot.add(chestpiece)
    const tips = new THREE.Vector3().fromArray(anch.grip_two_finger)
    chestpiece.position.copy(tips).add(new THREE.Vector3(0, 0, FLESH + 0.010 * CHEST_SCALE))
    // ⚠ 세 축을 눈대중으로 고르면 **왼손 좌표계**가 되어 메시가 거울로 뒤집힌다.
    //   (처음에 +Z 를 (1,0,0) 으로 뒀다가 체스트피스가 뒤집혀 어두운 밑면만 보였다)
    //   반드시 z = x × y 로 계산할 것. det = +1 인지 확인하는 셈이다.
    const cx = new THREE.Vector3(0, 1, 0)    // 체스트피스 +X(스템이 나가는 쪽) → 손목 쪽
    const cy = new THREE.Vector3(0, 0, -1)   // 체스트피스 +Y(위) → 손등 쪽(피부 반대)
    const cz = new THREE.Vector3().crossVectors(cx, cy)
    chestpiece.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(cx, cy, cz))
  }
  syncCam()
  hud.innerHTML =
    `<b>pose</b> ${state.pose}   <b>press</b> ${state.press}   <b>fx</b> ${state.fx}   <b>hold</b> ${state.hold.toFixed(2)}\n` +
    `침강 ${(depth * 1000).toFixed(1)}mm   발자국 ${(half[0]*2000).toFixed(0)}×${(half[1]*2000).toFixed(0)}mm 번짐 변형${(soft*1000).toFixed(0)}/그림자${(softShade*1000).toFixed(0)}mm   그림자 ${shade.toFixed(2)}\n` +
    `손끝간격 검지↔중지 ${anch.finger_gap_cm}cm / 엄지↔검지 ${anch.pinch_gap_cm}cm   cam ${state.cam}`
}

/** 시점 — 접촉점을 **소매에 가리지 않고** 보는 각도여야 검증이 된다.
 *  doctor  = 의사 눈높이 비스듬히 위(팔이 오른쪽에서 들어온다)
 *  side    = 눌린 깊이를 실루엣으로 보는 옆
 *  closeup = 접촉점만 크게 — 그림자 농도·변형 반경 판단용 */
/** 접촉점 기준 **상대** 위치로 잡는다 — 절대 좌표로 두면 접촉점을 옮길 때마다 다시 맞춰야 한다. */
const CAM_OFF: Record<CamId, [number, number, number]> = {
  doctor: [-0.05, 0.26, 0.30],
  side: [-0.34, 0.06, 0.14],
  closeup: [-0.09, 0.17, 0.20],
}
const CAM_FOV: Record<CamId, number> = { doctor: 40, side: 34, closeup: 34 }
function syncCam(): void {
  camera.position.copy(contactBase).add(new THREE.Vector3().fromArray(CAM_OFF[state.cam]))
  camera.fov = CAM_FOV[state.cam]
  camera.updateProjectionMatrix()
  camera.lookAt(contactBase)
}

addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})
addEventListener('keydown', (e) => {
  const cyc = <T,>(arr: T[], cur: T): T => arr[(arr.indexOf(cur) + 1) % arr.length]
  if (e.key === 'p') state.pose = cyc(POSES, state.pose)
  else if (e.key === 's') state.press = cyc(PRESSES, state.press)
  else if (e.key === 'f') state.fx = cyc(FXS, state.fx)
  else if (e.key === 'c') state.cam = cyc(CAMS, state.cam)
  else if (e.key === 'h') state.hold = state.hold > 0.5 ? 0 : 1
  else return
  void layout()
})

let frames = 0
let t0 = performance.now()
let fps = 0
renderer.setAnimationLoop(() => {
  frames++
  const now = performance.now()
  if (now - t0 > 500) { fps = (frames * 1000) / (now - t0); frames = 0; t0 = now }
  renderer.render(scene, camera)
})

const api = {
  // HDRI 가 붙기 전에 찍으면 조명이 본 씬과 달라 판정이 무효다 — 환경광까지 기다린다
  ready: () => loaded > 0 && envReady,
  stats: () => ({ fps: Math.round(fps), pose: state.pose, press: state.press, fx: state.fx, hold: state.hold }),
  set: async (patch: Partial<typeof state>) => { Object.assign(state, patch); await layout() },
}
;(window as unknown as { __lab: typeof api }).__lab = api

void layout()
