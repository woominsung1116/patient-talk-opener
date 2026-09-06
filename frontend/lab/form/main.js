/**
 * clinic-lab / form — 부트스트랩.
 *
 * URL 파라미터
 *   ?mode=base|form      대조군 / 실험군
 *   ?view=intake|exam    문진 카메라 / 진찰 카메라
 *   ?post=0              포스트프로세싱 끄기 (기본은 본 씬과 동일하게 켬)
 *   ?orbit=1             마우스로 궤도 회전 (디버그)
 *
 * 키보드: B/F = 모드, 1/2 = 카메라, P = 포스트 토글
 */
import * as THREE from 'three'
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, BloomEffect, VignetteEffect, NoiseEffect, BlendFunction } from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CAM_INTAKE, CAM_EXAM, initMaterials, buildLights, loadEnvironment } from './common.js'
import { buildRoom, addProps, setRadiusScale } from './room.js'

const qs = new URLSearchParams(location.search)
const MODES = ['base', 'round', 'form']
let mode = MODES.includes(qs.get('mode')) ? qs.get('mode') : 'form'
let view = qs.get('view') === 'exam' ? 'exam' : 'intake'
let usePost = qs.get('post') !== '0'

const app = document.getElementById('app')
const hud = document.getElementById('hud')
const tag = document.getElementById('tag')

/* ── 렌더러 (본 씬 <Canvas> 설정 그대로) ── */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.localClippingEnabled = true
renderer.info.autoReset = false   // 컴포저가 pass 마다 render() 하므로 수동 집계
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100)

initMaterials()
const lights = buildLights(scene)

setRadiusScale(qs.get('rscale') ? Number(qs.get('rscale')) : 1)

/* 진단 전용(?probe=1): 작고 밝은 광원을 하나 추가한다.
   "모서리 라운딩이 안 보이는 게 지오메트리 탓인가 조명 탓인가"를 가르는 대조군.
   이 스위치는 리포트의 form 변형 결과에는 쓰지 않는다. */
if (qs.get('probe') === '1') {
  const p = new THREE.PointLight(0xffffff, 6, 6, 2)
  p.position.set(-0.6, 1.7, -3.2)
  scene.add(p)
}

/* ── 세 모드를 동시에 만들어 두고 visible 로만 전환 → 재질/조명이 100% 동일 ── */
const rooms = { base: buildRoom('base'), round: buildRoom('round'), form: buildRoom('form') }
scene.add(rooms.base.root, rooms.round.root, rooms.form.root)

/* ── 포스트프로세싱 (ClinicScene.tsx 와 동일 파라미터) ── */
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
composer.addPass(new RenderPass(scene, camera))
const n8 = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight)
n8.configuration.aoRadius = 0.36
n8.configuration.intensity = 1.18
n8.configuration.distanceFalloff = 0.8
n8.setQualityMode('Medium')
composer.addPass(n8)
const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: true })
noise.blendMode.opacity.value = 0.02
composer.addPass(new EffectPass(
  camera,
  new BloomEffect({ intensity: 0.17, luminanceThreshold: 1.02, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.45 }),
  new SMAAEffect(),
  noise,
  new VignetteEffect({ eskil: false, offset: 0.23, darkness: 0.24 }),
))

let controls = null
if (qs.get('orbit') === '1') {
  controls = new OrbitControls(camera, renderer.domElement)
}

function applyMode() {
  for (const key of MODES) {
    rooms[key].root.visible = key === mode
    // 숨긴 쪽의 광원은 씬 전체를 밝히므로 반드시 함께 끈다
    rooms[key].root.traverse((o) => { if (o.isLight) o.visible = key === mode })
  }
}
const num3 = (s) => (s ? s.split(',').map(Number) : null)
const customCam = num3(qs.get('cam'))
const customLook = num3(qs.get('look'))
const customFov = qs.get('fov') ? Number(qs.get('fov')) : null

function applyView() {
  const preset = view === 'exam' ? CAM_EXAM : CAM_INTAKE
  const pos = customCam ?? preset.pos
  const look = customLook ?? preset.look
  camera.position.set(...pos)
  camera.lookAt(...look)
  camera.fov = customFov ?? preset.fov
  camera.updateProjectionMatrix()
  lights.setMode(view === 'exam')
  if (controls) { controls.target.set(...look); controls.update() }
}
applyMode(); applyView()
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
const allStats = { base: sceneStats(rooms.base.root), round: sceneStats(rooms.round.root), form: sceneStats(rooms.form.root) }

let frames = 0, fpsAcc = 0, fps = 0, last = performance.now()
let ready = false
const clock = new THREE.Clock()

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
    `mode  ${mode}${usePost ? '' : '  (post off)'}\n` +
    `view  ${view}\n` +
    `fps   ${fps.toFixed(1)}\n` +
    `calls ${info.calls}\n` +
    `tris  ${info.triangles.toLocaleString()} (drawn)\n` +
    `──────────────────────────\n` +
    MODES.map((k) => `${k.padEnd(6)}${String(allStats[k].meshes).padStart(4)} mesh  ${allStats[k].tris.toLocaleString().padStart(9)} tri`).join('\n')

  window.__labStats = {
    mode, view, fps: +fps.toFixed(1), calls: info.calls, drawnTris: info.triangles, scene: allStats,
  }
  if (!ready && window.__assetsDone) {
    if (++window.__warm > 45) { ready = true; window.__labReady = true }
  }
}
window.__warm = 0
loop()

/* ── 미사용 GLB 감정용 진열대 (?glbtest=1) ──
   exam_bed / iv_drip / privacy_curtain / vitals_monitor 를 1m 격자 위에 실제 크기로 세워
   "형태가 쓸 만한가"를 눈으로 본다. 방은 그대로 두고 진찰대 앞 빈 바닥에 놓는다. */
async function glbShowcase() {
  const { fittedGLB } = await import('./common.js')
  const shelf = new THREE.Group()
  shelf.position.set(-0.6, 0, -2.4)
  const specs = [
    ['/models/exam_bed.glb', 1.9, -1.0],
    ['/models/privacy_curtain.glb', 1.9, 0.6],
    ['/models/vitals_monitor.glb', 0.5, 1.7],
    ['/models/iv_drip.glb', 0.9, 2.3],
  ]
  for (const [url, size, x] of specs) {
    const n = await fittedGLB(url, size, [x, size / 2, 0], [0, 0, 0])
    if (n) shelf.add(n)
    const ref = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 1.0, 0.05),
      new THREE.MeshStandardMaterial({ color: '#ff4444', roughness: 0.6 }),
    )
    ref.position.set(x - 0.75, 0.5, 0)   // 1m 높이 기준봉 (빨강)
    shelf.add(ref)
  }
  scene.add(shelf)
}

/* ── 비동기 자원 ── */
;(async () => {
  await loadEnvironment(renderer, scene)
  await Promise.all(MODES.map((k) => addProps(rooms[k], k)))
  if (qs.get('glbtest') === '1') await glbShowcase()
  // GLB가 추가된 뒤 통계 갱신
  for (const k of MODES) Object.assign(allStats[k], sceneStats(rooms[k].root))
  applyMode()
  window.__assetsDone = true
})()

/* ── 입력 ── */
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (k === 'b') mode = 'base'
  else if (k === 'r') mode = 'round'
  else if (k === 'f') mode = 'form'
  else if (k === '1') view = 'intake'
  else if (k === '2') view = 'exam'
  else if (k === 'p') usePost = !usePost
  else return
  applyMode(); applyView()
  tag.textContent = `${mode.toUpperCase()} / ${view}`
})
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})

/** vsync(120Hz)에 막혀 fps로는 비용 차이가 안 보인다 → N프레임을 강제로 돌려 프레임당 ms를 잰다. */
window.__bench = (n = 240) => {
  const out = {}
  for (const k of MODES) {
    mode = k; applyMode()
    for (let i = 0; i < 20; i++) { if (usePost) composer.render(0.016); else renderer.render(scene, camera) }  // 워밍업
    renderer.info.reset()
    const t0 = performance.now()
    for (let i = 0; i < n; i++) { if (usePost) composer.render(0.016); else renderer.render(scene, camera) }
    const gl = renderer.getContext(); gl.finish()
    const ms = (performance.now() - t0) / n
    out[k] = { msPerFrame: +ms.toFixed(3), fpsEquiv: +(1000 / ms).toFixed(0), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }
  }
  applyMode()
  return out
}

window.__lab = {
  setMode: (v) => { mode = v; applyMode(); tag.textContent = `${mode.toUpperCase()} / ${view}` },
  setView: (v) => { view = v; applyView(); tag.textContent = `${mode.toUpperCase()} / ${view}` },
  setPost: (v) => { usePost = v },
  hideHud: () => { hud.style.display = 'none'; tag.style.display = 'none' },
  showHud: () => { hud.style.display = ''; tag.style.display = '' },
}
