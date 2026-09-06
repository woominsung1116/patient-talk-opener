/**
 * clinic-lab / FINAL — 부트스트랩
 *
 * URL 파라미터
 *   ?mode=base|final     base = 본 씬 그대로 / final = 심사 통과 기법만 적용
 *   ?view=intake|exam    문진 카메라 / 진찰 카메라
 *   ?post=0              포스트프로세싱 끄기 (Bloom 블랙홀 진단용)
 *   ?merge=0|1           정적 병합 패스 (기본: final=1, base=0)
 *   ?wear=0              벽 마모 roughness 변조 끄기
 *   ?floor=marble        바닥 후보 교체 (심사 미해결 항목 — Bloom 하이라이트 확인용)
 *   ?orbit=1             마우스 궤도 (디버그)
 *
 * 키보드: B/F = 모드, 1/2 = 카메라, P = 포스트 토글
 */
import * as THREE from 'three'
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, BloomEffect, VignetteEffect, NoiseEffect, BlendFunction } from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CAM_INTAKE, CAM_EXAM, initMaterials, buildLights, loadEnvironment } from './common.js'
import { buildRoom, addProps, optimize } from './room.js'

const qs = new URLSearchParams(location.search)
const mode = qs.get('mode') === 'base' ? 'base' : 'final'
let view = qs.get('view') === 'exam' ? 'exam' : 'intake'
let usePost = qs.get('post') !== '0'
const doMerge = qs.get('merge') != null ? qs.get('merge') === '1' : mode === 'final'

const app = document.getElementById('app')
const hud = document.getElementById('hud')
const tag = document.getElementById('tag')

/* ── 렌더러 — 본 씬 <Canvas> 설정 그대로 ──
   ⚠ 톤매핑: 본 씬은 ACESFilmic 을 지정하지만 postprocessing 의 EffectComposer 가
   무력화한다(셰이더 70개 중 ACES 함수 0개). 여기도 **똑같이 재현**한다.
   이 랩에서 톤매핑을 고치면 본 씬과 비교가 안 된다 — 심사 결론대로 조명 전면
   재그레이딩과 한 묶음으로만 진행할 항목이다. */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = true
renderer.localClippingEnabled = true
renderer.info.autoReset = false
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100)

initMaterials({
  upgraded: mode === 'final',
  wear: qs.get('wear') !== '0',
  floor: qs.get('floor') || 'planks',
})
const lights = buildLights(scene, mode)
/* [light·효과있음] PCFShadowMap → PCFSoftShadowMap.
   한 줄이고 비용이 거의 없는데 접지 그림자의 계단이 사라진다. */
renderer.shadowMap.type = lights.shadowType

const built = buildRoom(mode)
scene.add(built.root)
window.__scene = scene
window.__camera = camera
window.__renderer = renderer

/* ?bloom=0 / ?ao=0 — 스페큘러 하이라이트 아티팩트가 어느 패스에서 나오는지 가르는 스위치 */
const useBloom = qs.get('bloom') !== '0'
const useAO = qs.get('ao') !== '0'
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
composer.addPass(new RenderPass(scene, camera))
if (useAO) {
  const n8 = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight)
  n8.configuration.aoRadius = 0.36
  n8.configuration.intensity = 1.18
  n8.configuration.distanceFalloff = 0.8
  n8.setQualityMode('Medium')
  composer.addPass(n8)
}
const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: true })
noise.blendMode.opacity.value = 0.02
/* ?fx=none  이펙트를 전부 빼고 HalfFloat 타깃 + 화면 복사만 남긴다.
   ?fx=smaa  SMAA 하나만. → 아티팩트가 '값' 문제인지 '이펙트' 문제인지 가른다. */
const fx = qs.get('fx') || 'all'
if (fx !== 'none') {
  const effects = []
  if (fx === 'all') {
    if (useBloom) effects.push(new BloomEffect({ intensity: 0.17, luminanceThreshold: 1.02, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.45 }))
    effects.push(new SMAAEffect())
    if (qs.get('noise') !== '0') effects.push(noise)
    if (qs.get('vig') !== '0') effects.push(new VignetteEffect({ eskil: false, offset: 0.23, darkness: 0.24 }))
  } else if (fx === 'smaa') {
    effects.push(new SMAAEffect())
  }
  composer.addPass(new EffectPass(camera, ...effects))
}

let controls = null
if (qs.get('orbit') === '1') controls = new OrbitControls(camera, renderer.domElement)

const num3 = (s) => (s ? s.split(',').map(Number) : null)
const customCam = num3(qs.get('cam'))
const customLook = num3(qs.get('look'))

function applyView() {
  const preset = view === 'exam' ? CAM_EXAM : CAM_INTAKE
  const pos = customCam ?? preset.pos
  const look = customLook ?? preset.look
  camera.position.set(...pos)
  camera.lookAt(...look)
  camera.fov = qs.get('fov') ? Number(qs.get('fov')) : preset.fov
  camera.updateProjectionMatrix()
  lights.setMode(view === 'exam')
  if (controls) { controls.target.set(...look); controls.update() }
}
applyView()
tag.textContent = `${mode.toUpperCase()} / ${view}`

/* ── 통계 ── */
function sceneStats(root) {
  let tris = 0, meshes = 0
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    meshes++
    const g = o.geometry
    tris += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
  })
  return { tris: Math.round(tris), meshes }
}
let stats = sceneStats(built.root)
let mergeSaved = 0

let frames = 0, fpsAcc = 0, fps = 0, last = performance.now()
let ready = false
const clock = new THREE.Clock()
window.__warm = 0

function loop() {
  requestAnimationFrame(loop)
  const now = performance.now()
  const dt = now - last
  last = now
  fpsAcc += dt; frames++
  if (fpsAcc >= 400) { fps = (frames * 1000) / fpsAcc; frames = 0; fpsAcc = 0 }

  if (controls) controls.update()
  renderer.info.reset()
  if (usePost) composer.render(clock.getDelta())
  else renderer.render(scene, camera)

  const info = renderer.info.render
  hud.textContent =
    `mode   ${mode}${usePost ? '' : '  (post off)'}${doMerge ? '  +merge' : ''}\n` +
    `view   ${view}\n` +
    `fps    ${fps.toFixed(1)}\n` +
    `calls  ${info.calls}\n` +
    `tris   ${info.triangles.toLocaleString()} (drawn)\n` +
    `──────────────────────\n` +
    `scene  ${stats.meshes} mesh  ${stats.tris.toLocaleString()} tri\n` +
    `merged −${mergeSaved} calls\n` +
    `tex    ${renderer.info.memory.textures}  prog ${renderer.info.programs?.length ?? 0}`

  window.__labStats = {
    mode, view, merge: doMerge, post: usePost,
    fps: +fps.toFixed(1), calls: info.calls, drawnTris: info.triangles,
    meshes: stats.meshes, sceneTris: stats.tris, mergeSaved,
    textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0,
  }
  if (!ready && window.__assetsDone && ++window.__warm > 45) { ready = true; window.__labReady = true }
}
loop()

;(async () => {
  await loadEnvironment(renderer, scene)
  await addProps(built, mode)
  if (doMerge) mergeSaved = optimize(built)
  stats = sceneStats(built.root)
  window.__assetsDone = true
})()

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (k === '1') view = 'intake'
  else if (k === '2') view = 'exam'
  else if (k === 'p') usePost = !usePost
  else if (k === 'b' || k === 'f') { location.search = `?mode=${k === 'b' ? 'base' : 'final'}&view=${view}` ; return }
  else return
  applyView()
  tag.textContent = `${mode.toUpperCase()} / ${view}`
})
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})

/** vsync(120Hz)에 막혀 fps로는 비용이 안 보인다 → N프레임을 강제로 돌려 ms/frame 을 잰다. */
window.__bench = (n = 240) => {
  for (let i = 0; i < 25; i++) { if (usePost) composer.render(0.016); else renderer.render(scene, camera) }
  renderer.info.reset()
  const t0 = performance.now()
  for (let i = 0; i < n; i++) { if (usePost) composer.render(0.016); else renderer.render(scene, camera) }
  renderer.getContext().finish()
  const ms = (performance.now() - t0) / n
  return {
    mode, view, msPerFrame: +ms.toFixed(3), fpsEquiv: +(1000 / ms).toFixed(0),
    calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
  }
}

window.__lab = {
  setView: (v) => { view = v; applyView(); tag.textContent = `${mode.toUpperCase()} / ${view}` },
  setPost: (v) => { usePost = v },
  hideHud: () => { hud.style.display = 'none'; tag.style.display = 'none' },
  showHud: () => { hud.style.display = ''; tag.style.display = '' },
}
