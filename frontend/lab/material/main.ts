/**
 * clinic-lab / material 변형 — 부트스트랩
 *
 * 렌더러·톤매핑·후처리·조명은 **본 씬 ClinicScene.tsx <Canvas> 설정을 그대로** 옮겼다.
 * 바뀌는 것은 오직 MatLib(재질)뿐이다.
 *
 * URL 파라미터 / 키
 *   ?mode=base|mat   (1 / 2)   baseline(본 씬 재질) ↔ material(스펙 적용)
 *   ?cam=intake|exam (c)       문진 시점 ↔ 진찰 시점
 *   ?floor=planks|tiles074|tiles101|marble|wood043 (f)
 *   ?wear=0|1        (w)       마모 레이어
 *   ?post=0|1                  후처리(N8AO/Bloom/SMAA/Noise/Vignette)
 */
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, SMAAEffect, NoiseEffect, VignetteEffect, BlendFunction,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { manager, makeBaseLib, makeMatLib, FLOOR_IDS, FLOOR_LABEL, type FloorId } from './materials'
import { buildScene, buildLights, CAM_INTAKE, CAM_EXAM, CAM_EXAM_WIDE, CAM_WALL, CAM_CEIL } from './room'

type Mode = 'base' | 'mat'
type CamId = 'intake' | 'exam' | 'examwide' | 'wall' | 'ceil'
const CAMS: Record<CamId, { pos: readonly number[]; look: readonly number[]; fov: number }> = {
  intake: CAM_INTAKE, exam: CAM_EXAM, examwide: CAM_EXAM_WIDE, wall: CAM_WALL, ceil: CAM_CEIL,
}
const CAM_IDS = Object.keys(CAMS) as CamId[]

const qs = new URLSearchParams(location.search)
const state = {
  mode: (qs.get('mode') === 'base' ? 'base' : 'mat') as Mode,
  cam: (CAM_IDS.includes(qs.get('cam') as CamId) ? qs.get('cam') : 'intake') as CamId,
  floor: (FLOOR_IDS.includes(qs.get('floor') as FloorId) ? qs.get('floor') : 'planks') as FloorId,
  wear: qs.get('wear') !== '0',
  post: qs.get('post') !== '0',
  /** 대조군: 색 맵을 붙이되 타일링만 본 씬처럼 고정(2.4,1.3)으로 둔다 → 밀도 불일치가 보이는지 확인 */
  badTiling: qs.get('tile') === 'bad',
}

const app = document.getElementById('app')!
const hud = document.getElementById('hud')!

/* ── 렌더러 (본 씬 gl 설정) ── */
const renderer = new THREE.WebGLRenderer({
  antialias: true, alpha: false, powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)) // 본 씬 dpr=[1,1.75]
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.localClippingEnabled = true
// 후처리 composer는 한 프레임에 renderer.render()를 여러 번 부른다 →
// autoReset을 끄고 프레임 시작에서 직접 리셋해야 draw call 집계가 씬 기준이 된다.
renderer.info.autoReset = false
app.appendChild(renderer.domElement)

const GPU = (() => {
  try {
    const gl = renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  } catch { return 'unknown' }
})()

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100)

/* ── HDRI IBL (본 씬 SafeEnvironment intensity 0.64) ── */
let envReady = false
new RGBELoader(manager).load(
  '/hdri/hospital_room_2_2k.hdr',
  (hdr) => {
    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    scene.environment = pmrem.fromEquirectangular(hdr).texture
    scene.environmentIntensity = 0.64
    hdr.dispose(); pmrem.dispose()
    envReady = true
  },
  undefined,
  () => { envReady = true }, // 실패해도 진행 (본 씬 EnvBoundary와 같은 태도)
)

/* ── 씬 조립/재조립 ── */
let sceneRoot: THREE.Group | null = null
let lightRoot: THREE.Group | null = null

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh
    if (m.isMesh) {
      m.geometry?.dispose()
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      mats.forEach((mm) => mm?.dispose())
    }
  })
}

function rebuild() {
  if (sceneRoot) { scene.remove(sceneRoot); disposeTree(sceneRoot) }
  if (lightRoot) { scene.remove(lightRoot) }
  const examMode = state.cam === 'exam' || state.cam === 'examwide'
  const lib = state.mode === 'base'
    ? makeBaseLib(state.floor)
    : makeMatLib(state.floor, state.wear, state.badTiling)
  sceneRoot = buildScene(lib, examMode)
  lightRoot = buildLights(examMode)
  scene.add(sceneRoot, lightRoot)
  applyCam()
}

function applyCam() {
  const c = CAMS[state.cam]
  camera.fov = c.fov
  camera.position.set(c.pos[0], c.pos[1], c.pos[2])
  orbitTarget.set(c.look[0], c.look[1], c.look[2])
  camera.lookAt(orbitTarget)
  camera.updateProjectionMatrix()
  yaw = Math.atan2(camera.position.x - orbitTarget.x, camera.position.z - orbitTarget.z)
  pitch = Math.asin(THREE.MathUtils.clamp(
    (camera.position.y - orbitTarget.y) / camera.position.distanceTo(orbitTarget), -1, 1))
  dist = camera.position.distanceTo(orbitTarget)
}

/* ── 아주 단순한 오빗 (검증용 자유시점. 캡처는 항상 프리셋 각도) ── */
const orbitTarget = new THREE.Vector3()
let yaw = 0, pitch = 0, dist = 2
let dragging = false, lx = 0, ly = 0
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY })
window.addEventListener('pointerup', () => { dragging = false })
window.addEventListener('pointermove', (e) => {
  if (!dragging) return
  yaw -= (e.clientX - lx) * 0.005
  pitch = THREE.MathUtils.clamp(pitch + (e.clientY - ly) * 0.005, -1.2, 1.2)
  lx = e.clientX; ly = e.clientY
  updateOrbit()
})
renderer.domElement.addEventListener('wheel', (e) => {
  dist = THREE.MathUtils.clamp(dist * (1 + e.deltaY * 0.001), 0.4, 12)
  updateOrbit()
}, { passive: true })
function updateOrbit() {
  const cp = Math.cos(pitch)
  camera.position.set(
    orbitTarget.x + Math.sin(yaw) * cp * dist,
    orbitTarget.y + Math.sin(pitch) * dist,
    orbitTarget.z + Math.cos(yaw) * cp * dist,
  )
  camera.lookAt(orbitTarget)
}

/* ── 드로콜 집계 — RenderPass 직후 스냅샷을 떠서 "씬 기준" 수치를 얻는다.
      (composer 전체 수치는 후처리 풀스크린 패스가 섞여 씬 비교에 못 쓴다) ── */
let sceneCalls = 0, sceneTris = 0, sceneTotalCalls = 0
function snapScene() {
  sceneCalls = renderer.info.render.calls
  sceneTris = renderer.info.render.triangles
}

/* ── 후처리 (본 씬 EffectComposer와 동일 구성/파라미터) ── */
let composer: EffectComposer | null = null
function setupPost() {
  if (!state.post) { composer = null; return }
  try {
    composer = new EffectComposer(renderer, {
      multisampling: 0,
      frameBufferType: THREE.HalfFloatType,
    })
    const rp = new RenderPass(scene, camera)
    const origRender = rp.render.bind(rp)
    rp.render = ((...a: unknown[]) => {
      // @ts-expect-error - postprocessing RenderPass.render 시그니처 그대로 통과
      const r = origRender(...a)
      snapScene()
      return r
    }) as typeof rp.render
    composer.addPass(rp)
    const n8 = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight)
    n8.configuration.aoRadius = 0.36
    n8.configuration.intensity = 1.18
    n8.configuration.distanceFalloff = 0.8
    n8.setQualityMode('Medium')
    composer.addPass(n8)
    composer.addPass(new EffectPass(
      camera,
      new BloomEffect({ intensity: 0.17, luminanceThreshold: 1.02, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.45 }),
      new SMAAEffect(),
      new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SOFT_LIGHT }),
      new VignetteEffect({ eskil: false, offset: 0.23, darkness: 0.24 }),
    ))
    // Noise opacity 0.02 (본 씬)
    const pass = composer.passes[composer.passes.length - 1] as EffectPass & { effects?: { blendMode: { opacity: { value: number } } }[] }
    pass.effects?.forEach((ef) => {
      if (ef instanceof NoiseEffect) ef.blendMode.opacity.value = 0.02
    })
  } catch (err) {
    console.warn('[lab] postprocessing off:', err)
    composer = null
  }
}

/* ── 리사이즈 ── */
function onResize() {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  composer?.setSize(w, h)
}
window.addEventListener('resize', onResize)

/* ── HUD ── */
let frames = 0, fpsAcc = 0, fps = 0, last = performance.now()
const fpsHist: number[] = []
function updateHUD() {
  sceneTotalCalls = renderer.info.render.calls
  const mem = renderer.info.memory
  hud.innerHTML =
    `<b>mode</b>  ${state.mode === 'mat' ? 'MATERIAL (스펙 적용)' : 'BASELINE (본 씬 재질)'}\n` +
    `<b>cam</b>   ${state.cam}\n` +
    `<b>floor</b> ${FLOOR_LABEL[state.floor]}\n` +
    `<b>wear</b>  ${state.mode === 'mat' ? (state.wear ? 'on' : 'off') : 'n/a'}   ` +
    `<b>post</b> ${composer ? 'on' : 'off'}\n` +
    `<b>fps</b>   ${fps.toFixed(1)}   (median ${median(fpsHist).toFixed(1)})\n` +
    `<b>calls</b> ${sceneCalls} scene / ${sceneTotalCalls} total   tris ${(sceneTris / 1000).toFixed(1)}k\n` +
    `<b>geo</b>   ${mem.geometries}   tex ${mem.textures}   prog ${renderer.info.programs?.length ?? 0}\n` +
    `<b>gpu</b>   ${GPU.slice(0, 46)}`
}
function median(a: number[]) {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/* ── 입력 ── */
window.addEventListener('keydown', (e) => {
  if (e.key === '1') setMode('base')
  else if (e.key === '2') setMode('mat')
  else if (e.key === 'c') setCam(CAM_IDS[(CAM_IDS.indexOf(state.cam) + 1) % CAM_IDS.length])
  else if (e.key === 'f') setFloor(FLOOR_IDS[(FLOOR_IDS.indexOf(state.floor) + 1) % FLOOR_IDS.length])
  else if (e.key === 'w') { state.wear = !state.wear; rebuild(); resetFps() }
})

function resetFps() { fpsHist.length = 0; frames = 0; fpsAcc = 0 }
function setMode(m: Mode) { if (state.mode === m) return; state.mode = m; rebuild(); resetFps() }
function setCam(c: CamId) { if (state.cam === c) return; state.cam = c; rebuild(); resetFps() }
function setFloor(f: FloorId) { if (state.floor === f) return; state.floor = f; rebuild(); resetFps() }

/* ── 루프 ── */
function tick() {
  requestAnimationFrame(tick)
  const now = performance.now()
  const dt = now - last
  last = now
  frames++; fpsAcc += dt
  if (fpsAcc >= 400) {
    fps = (frames * 1000) / fpsAcc
    if (fpsHist.length < 400) fpsHist.push(fps)
    frames = 0; fpsAcc = 0
  }
  renderer.info.reset()
  if (composer) composer.render()
  else { renderer.render(scene, camera); snapScene() }
  updateHUD()
}

/* ── 부팅 ── */
let loaded = false
manager.onLoad = () => { loaded = true }
rebuild()
setupPost()
tick()

/* Playwright 훅 */
const labApi = {
  setMode, setCam, setFloor,
  setWear(v: boolean) { state.wear = v; rebuild(); resetFps() },
  state: () => ({ ...state }),
  ready: () => loaded && envReady,
  stats: () => ({
    fps: +median(fpsHist).toFixed(1),
    fpsMin: fpsHist.length ? +Math.min(...fpsHist).toFixed(1) : 0,
    fpsSamples: fpsHist.length,
    sceneCalls,
    totalCalls: sceneTotalCalls,
    triangles: sceneTris,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    gpu: GPU,
  }),
  resetFps,
  /** vsync(120Hz)에 막혀 fps로는 재질 비용이 안 보인다.
   *  rAF 밖에서 n프레임을 연속 렌더해 실제 프레임 시간(ms)을 잰다. */
  bench(n = 240) {
    // 워밍업 (셰이더 컴파일/텍스처 업로드 제외)
    for (let i = 0; i < 30; i++) { renderer.info.reset(); if (composer) composer.render(); else renderer.render(scene, camera) }
    const gl = renderer.getContext()
    gl.finish()
    const t0 = performance.now()
    for (let i = 0; i < n; i++) { renderer.info.reset(); if (composer) composer.render(); else renderer.render(scene, camera) }
    gl.finish()
    const ms = (performance.now() - t0) / n
    return { frames: n, msPerFrame: +ms.toFixed(3), impliedFps: +(1000 / ms).toFixed(1) }
  },
}
;(window as unknown as { __lab: typeof labApi }).__lab = labApi
