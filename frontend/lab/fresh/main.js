/**
 * 진료실 재설계 프로토타입 — 엔트리.
 * URL: /clinic-lab-fresh.html?cam=seat|exam|wide
 *
 * 본 씬과 비교 가능해야 하므로 렌더러·톤매핑·후처리 스택·FOV는 본 씬과 동일하게 맞췄다.
 * 다른 것은 방의 형상과 조명 설계뿐이다.
 */
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import {
  EffectComposer, RenderPass, EffectPass, SMAAEffect, BloomEffect,
  VignetteEffect, NoiseEffect, BlendFunction,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { M, tint } from './mats.js'
import {
  ROOM, BED, SEAT_POS, DESK_POS,
  buildShell, buildLights, buildExamTable, buildCounter, buildWallFixtures,
  buildCurtains, buildDeskSet, buildPatientChair, buildLifeTraces, loadModel, box, cyl,
  attachDeskProps, DESK_TOP, SEAT_SIT_Y, SEAT_ROT_Y, EXAM_PATIENT,
} from './build.js'
import { loadAvatar } from './avatar.js'

RectAreaLightUniformsLib.init()

/* ── 카메라: 본 씬에서 그대로 (src/three/ClinicScene.tsx) ── */
const CAMS = {
  seat: { pos: [-1.85, 1.34, 0.95], look: [-0.55, 1.05, 0.1] },   // CAM_BASE / LOOK_CENTER
  exam: { pos: [1.9, 1.82, -2.72], look: [1.9, 0.95, -3.5] },     // EXAM.camPos / EXAM.camLook
  wide: { pos: [-2.55, 1.95, 0.9], look: [0.6, 1.0, -3.4] },      // (비교용 광각 — 본 씬에 없음)
}
const qs = new URLSearchParams(location.search)
const camKey = CAMS[qs.get('cam')] ? qs.get('cam') : 'seat'
const CAM = { ...CAMS[camKey] }
// 디버그용 수동 카메라: ?p=x,y,z&l=x,y,z
const nums = (s) => s.split(',').map(Number)
if (qs.get('p')) CAM.pos = nums(qs.get('p'))
if (qs.get('l')) CAM.look = nums(qs.get('l'))

/* ── 렌더러 ── */
// preserveDrawingBuffer: Playwright 스크린샷이 렌더 프레임 밖에서 캡처되면 검은 프레임이 나온다.
// 캡처가 산출물이므로 랩에서는 켠다(본 게임에는 필요 없다).
const renderer = new THREE.WebGLRenderer({
  antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true,
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
/* 톤매핑은 **렌더러에서** 한다 (본 씬과 동일 — 비교 가능성을 위해서도 맞추는 게 맞다). */
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.info.autoReset = false
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#0b0d0e')

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(...CAM.pos)
camera.lookAt(...CAM.look)

/* ── IBL — 병원 HDRI를 조명·반사로만 (배경 아님) ── */
new RGBELoader().load('/hdri/hospital_room_2_2k.hdr', (hdr) => {
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromEquirectangular(hdr).texture
  // 이 HDRI는 전체적으로 푸르다. 높게 잡으면 흰 벽이 라벤더로 물든다(1차 시도의 실패).
  // 반사에만 기여할 정도로 낮게 유지하고, 밝기는 rectAreaLight가 담당한다.
  scene.environmentIntensity = 0.3
  hdr.dispose()
  pmrem.dispose()
})

/* ── 조립 ── (?hide=a,b 로 그룹을 끄고 이분탐색할 수 있다) */
const HIDE = new Set((qs.get('hide') || '').split(',').filter(Boolean))
function put(name, obj) { obj.name = name; obj.visible = !HIDE.has(name); scene.add(obj); return obj }
put('shell', buildShell())
const lit = buildLights(scene)
lit.group.name = 'lights'
lit.group.visible = !HIDE.has('lights')
put('examTable', buildExamTable())
put('counter', buildCounter())
put('fixtures', buildWallFixtures())
put('curtains', buildCurtains())
const deskGroup = put('desk', buildDeskSet())
put('chair', buildPatientChair())
put('traces', buildLifeTraces())

/* ── 기성 모델 ──
   ⚠ 이 dev 서버에서 GLTF의 상대경로 텍스처를 **동시에** 요청하면 일부가 ERR_ABORTED로 죽는다
   (기준선 하니스에서도 같은 증상 — 본 씬의 책장·화분이 무텍스처로 보이는 원인이다).
   먼저 fetch로 순차 프리페치해 브라우저 캐시에 올려 두면 GLTFLoader가 캐시에서 받아 성공한다. */
const PROP_TEXTURES = [
  'metal_office_desk', 'potted_plant_01', 'metal_trash_can', 'wall_clock', 'drawer_cabinet',
]
async function prefetchPropTextures() {
  for (const name of PROP_TEXTURES) {
    for (const suf of ['diff_1k', 'nor_gl_1k', 'arm_1k']) {
      await fetch(`/models/${name}/textures/${name}_${suf}.jpg`).catch(() => {})
    }
  }
  // 세부 텍스처 이름이 다른 자산들
  for (const u of [
    '/models/potted_plant_01/textures/potted_plant_01_pot_diff_1k.jpg',
    '/models/potted_plant_01/textures/potted_plant_01_leaves_diff_1k.jpg',
    '/models/potted_plant_01/textures/potted_plant_01_leaves_nor_gl_1k.jpg',
    '/models/potted_plant_01/textures/potted_plant_01_leaves_rough_1k.jpg',
    '/models/potted_plant_01/textures/potted_plant_01_leaves_alpha_1k.png',
    '/models/potted_plant_01/textures/potted_plant_01_pot_nor_gl_1k.jpg',
    '/models/metal_trash_can/textures/metal_trash_can_rust_diff_1k.jpg',
    '/models/metal_trash_can/textures/metal_trash_can_rust_nor_gl_1k.jpg',
    '/models/metal_trash_can/textures/metal_trash_can_rust_arm_1k.jpg',
    '/models/wall_clock/textures/wall_clock_glass_arm_1k.jpg',
  ]) await fetch(u).catch(() => {})
}

const pendingModels = []
function add(name, p) {
  pendingModels.push(p.then((o) => {
    o.name = name
    o.visible = !HIDE.has('models') && !HIDE.has(name)
    scene.add(o)
    return o
  }))
}

if (HIDE.has('models')) { /* 프리페치도 건너뛴다 */ } else
prefetchPropTextures().then(() => {
  // 책상 (본 씬과 같은 자산·같은 자리)
  add('deskModel', loadModel('/models/metal_office_desk/metal_office_desk.gltf', {
    pos: [DESK_POS[0], 0, DESK_POS[2]], scale: 1.0, rotY: 0,
  }).then((o) => { o.scale.set(0.92, 1.06, 0.88); return o }))

  // 화분 · 휴지통 · 벽시계 (텍스처 있는 기성 자산)
  add('plant', loadModel('/models/potted_plant_01/potted_plant_01.gltf', { pos: [-2.80, 0, -4.70], scale: 1.05, rotY: 0.6 }))
  // ⚠ 이 GLB에는 깨끗한 통과 녹슨 통 **두 개**가 들어 있다. 녹슨 쪽은 진료실에 어울리지 않아 숨긴다.
  add('trash', loadModel('/models/metal_trash_can/metal_trash_can.gltf', {
    pos: [-2.90, 0, 0.62], scale: 0.85, rotY: -0.4,
    onMesh: (m) => { if (/rust/i.test(m.material?.name || '')) m.visible = false },
  }))
  add('clock', loadModel('/models/wall_clock/wall_clock.gltf', { pos: [-0.30, 2.44, ROOM.backZ + 0.06], scale: 1.0 }))
  // 책상 위 GLB 소품 (설압자·펜라이트) — 데스크 그룹의 로컬 좌표로 들어간다
  pendingModels.push(attachDeskProps(deskGroup))
  // (drawer_cabinet 제외 — 어두운 목재 책장처럼 읽혀 진료실 톤을 깬다. 수납은 직접 지은 카운터가 맡는다)

  // 진찰대 옆 IV 폴 — 재질이 없는 GLB라 범주 재질을 입힌다 (spec §4.1)
  add('iv', loadModel('/models/iv_drip.glb', {
    // 진찰 카메라 프레임을 가로지르지 않게 침대 머리쪽 뒤로 뺀다 (§6.6d "진찰 시야는 비워라")
    fitHeight: 1.85, pos: [0.66, 0, -4.55], rotY: 0.5,
    onMesh: (m) => { m.material = M.steelDull },
  }))

  // 바이탈 모니터 — 도장 금속 하우징 + 화면 emissive. 우측 벽 브래킷에 건다(공중부양 금지).
  add('vitals', loadModel('/models/vitals_monitor.glb', {
    fitHeight: 0.30, pos: [3.02, 1.52, -3.95], rotY: -Math.PI / 2 + 0.12,
    onMesh: (m) => {
      const c = m.material?.color
      if (!c) return
      const lum = c.r + c.g + c.b
      if (lum < 0.35) m.material = M.paintedMetalDark            // 하우징
      else if (c.g > 0.5 && c.b > 0.5 && c.r < 0.4) m.material = // 화면
        new THREE.MeshStandardMaterial({ color: '#1b2a30', emissive: new THREE.Color('#39c7b8'), emissiveIntensity: 0.9, roughness: 0.3 })
      else m.material = tint(M.plastic, '#' + c.getHexString())
    },
  }))
})

/* ── 검증용 환자 ── ?patient=f20_thin|f60_ob|m70 (기본: 없음)
   배치는 본 씬 그대로다. 앉기: group(SEAT.pos.x, SEAT.sitY, SEAT.pos.z) rotY=SEAT.rotY
   눕기: group(EXAM.patientPos) > rotY=π/2 > rotX=-90°  (ClinicScene.tsx ExamPatient와 동일 계층) */
const patientKey = qs.get('patient')
window.__patientInfo = null
if (patientKey) {
  const lie = camKey === 'exam'
  const holder = new THREE.Group()
  if (lie) {
    holder.position.set(...EXAM_PATIENT.pos)
    const yaw = new THREE.Group(); yaw.rotation.y = EXAM_PATIENT.yawY
    const lay = new THREE.Group(); lay.rotation.x = -Math.PI / 2
    yaw.add(lay); holder.add(yaw); holder.userData.mount = lay
  } else {
    holder.position.set(SEAT_POS[0], SEAT_SIT_Y, SEAT_POS[2])
    holder.rotation.y = SEAT_ROT_Y
    holder.userData.mount = holder
  }
  holder.name = 'patient'
  scene.add(holder)
  pendingModels.push(
    loadAvatar(`/avatars/mh_${patientKey}.glb`, lie ? 'lie' : 'sit').then((av) => {
      holder.userData.mount.add(av.root)
      av.applyPose()
      const head = new THREE.Vector3()
      av.headBone?.getWorldPosition(head)
      const pelvis = new THREE.Vector3()
      ;(av.bones.pelvis ?? av.bones.spine)?.getWorldPosition(pelvis)
      // 화면 좌표로도 뽑는다 — 소품과 겹치는지 픽셀로 판단하기 위해
      const toScreen = (v) => {
        const p = v.clone().project(camera)
        return [Math.round((p.x * 0.5 + 0.5) * window.innerWidth), Math.round((-p.y * 0.5 + 0.5) * window.innerHeight)]
      }
      let tris = 0
      av.root.traverse((m) => {
        if (m.isMesh) tris += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3
      })
      const bb = new THREE.Box3().setFromObject(av.root)
      window.__patientInfo = {
        key: patientKey, pose: lie ? 'lie' : 'sit',
        headWorld: head.toArray().map((v) => +v.toFixed(3)),
        headScreen: toScreen(head),
        pelvisY: +pelvis.y.toFixed(3),
        // 앉기: 골반이 좌면(0.54)보다 낮으면 의자에 파묻힌 것. 눕기: 등이 매트 윗면(0.68)에 닿아야 한다.
        seatGap: lie ? null : +(pelvis.y - 0.54).toFixed(3),
        bboxMin: bb.min.toArray().map((v) => +v.toFixed(3)),
        bboxMax: bb.max.toArray().map((v) => +v.toFixed(3)),
        tris: Math.round(tris), missingBones: av.missing,
        rawH: av.rawH, targetH: +av.targetH.toFixed(3), fitScale: +av.scale.toFixed(4),
      }
      console.log('[patient]', JSON.stringify(window.__patientInfo))
    }).catch((e) => console.warn('[patient] load failed', e)),
  )
}

// 모니터를 받치는 벽 브래킷 (모델이 붙을 자리를 먼저 만든다)
const bracket = new THREE.Group()
bracket.add(box(0.16, 0.22, 0.03, M.paintedMetal, [3.185, 1.52, -3.95], [0, Math.PI / 2, 0]))
bracket.add(box(0.03, 0.03, 0.20, M.steelDull, [3.09, 1.52, -3.95]))
bracket.add(box(0.20, 0.02, 0.16, M.steelDull, [3.02, 1.40, -3.95]))
scene.add(bracket)

/* ── 후처리 — 본 씬과 같은 스택 (N8AO + Bloom + SMAA + Noise + Vignette) ──
   차이는 마지막에 ACES 톤매핑을 후처리에서 한다는 것뿐(HDR 파이프라인에서 밴딩이 덜하다). */
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
composer.addPass(new RenderPass(scene, camera))
if (!qs.has('noao')) {
  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight)
  ao.configuration.aoRadius = 0.42
  ao.configuration.distanceFalloff = 0.8
  ao.configuration.intensity = 1.6
  ao.configuration.color = new THREE.Color(0, 0, 0)
  ao.configuration.halfRes = !qs.has('fullao')
  ao.setQualityMode('Medium')
  composer.addPass(ao)
}
const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: true })
noise.blendMode.opacity.value = 0.02
const fx = [
  ...(qs.has('nobloom') ? [] : [new BloomEffect({
    intensity: 0.20, luminanceThreshold: 0.95, luminanceSmoothing: 0.32, mipmapBlur: true, radius: 0.5,
  })]),
  new SMAAEffect(),
  noise,
  new VignetteEffect({ eskil: false, offset: 0.26, darkness: 0.20 }),
]
composer.addPass(new EffectPass(camera, ...fx))

/* ── HUD ── */
const hud = document.getElementById('hud')
let acc = 0, frames = 0, calls = 0, tris = 0
const clock = new THREE.Clock()

const RAW = qs.has('nopp')   // 후처리 없이 직접 렌더 — NaN 픽셀 격리용
function tick() {
  requestAnimationFrame(tick)
  const dt = clock.getDelta()
  if (RAW) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.render(scene, camera) }
  else composer.render(dt)
  calls = renderer.info.render.calls
  tris = renderer.info.render.triangles
  renderer.info.reset()

  acc += dt; frames++
  if (acc >= 0.5) {
    const fps = frames / acc
    acc = 0; frames = 0
    let meshes = 0
    scene.traverse((o) => { if (o.isMesh) meshes++ })
    hud.textContent =
      `FRESH (재설계)  cam=${camKey}\n` +
      `fps ${fps.toFixed(1)}\n` +
      `draw calls ${calls}\n` +
      `triangles ${tris.toLocaleString()}\n` +
      `meshes ${meshes}\n` +
      `programs ${renderer.info.programs?.length ?? 0}`
    window.__labStats = { fps, calls, tris, meshes }
  }
}

Promise.all(pendingModels).then(() => { window.__labReady = true })
tick()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})

// 디버그 — 콘솔에서 카메라 옮겨 보기
window.__lab = { scene, camera, renderer, lit, THREE }
