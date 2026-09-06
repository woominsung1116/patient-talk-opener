/* ══════════════════════════════════════════════════════════════════════
   clinic-lab / light — 부트스트랩
   URL: ?rig=light|baseline  &cam=talk|exam  &post=1|0
   키:  L(리그 토글) C(카메라 토글) P(포스트 토글)
   ══════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildRoom, CAMERAS } from './room.js'
import { buildBaseline, buildLight } from './rigs.js'

let hudDirty = true
const qs = new URLSearchParams(location.search)
let rigName = qs.get('rig') === 'baseline' ? 'baseline' : 'light'
let camName = qs.get('cam') === 'exam' ? 'exam' : 'talk'
let postOn = qs.get('post') !== '0'
/* ⚠ 본 게임은 Canvas에 ACESFilmic을 지정하지만, @react-three/postprocessing의 EffectComposer가
   renderer.toneMapping을 NoToneMapping으로 덮어쓴다(실행 중인 게임에서 gl.toneMapping === 0 확인).
   즉 지금 게임은 **톤매핑이 없다**. 비교를 공정하게 하려면 랩도 같은 파이프라인이어야 한다.
   ?tm=aces 로 켜서 "톤매핑만" 얹었을 때의 차이도 따로 잰다. */
const toneMode = qs.get('tm') === 'aces' ? 'aces' : 'none'
/* ⚠⚠ 더 큰 발견: 실행 중인 게임의 최종 캔버스는 **sRGB 인코딩도 안 된다**.
   게임 캡처와 랩 캡처의 같은 지점 8곳을 맞춰본 결과
     game ≈ 0.87 × linear(lab_sRGB)   (일치도 cv=0.14)
     game ≈ srgb(0.42 × linear(lab))  (일치도 cv=0.36)  ← 기각
   즉 게임은 선형값을 그대로 화면에 쓴다(0.87은 게임의 Vignette).
   그래서 지금 게임은 중간톤이 눌리고 하이라이트가 그냥 잘린다 —
   이걸 보정하려고 조명을 계속 올린 흔적이 본 씬 조명값(env 0.64 + 라이트 총합)이다.
   비교를 공정하게 하려면 랩도 같은 출력으로 둔다. ?out=srgb 로 올바른 파이프라인도 잰다. */
const outMode = qs.get('out') === 'srgb' ? 'srgb' : 'linear'
const expOverride = qs.get('exp') ? Number(qs.get('exp')) : null

const canvas = document.getElementById('c')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = toneMode === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping
renderer.toneMappingExposure = 1.0
renderer.outputColorSpace = outMode === 'srgb' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace

const scene = new THREE.Scene()
scene.background = new THREE.Color('#10141a')

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

/* ── 포스트프로세싱: 본 씬과 같은 계열 (양쪽 리그에 동일 적용 — 비교 공정성) ── */
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
  window.innerWidth, window.innerHeight,
  { type: THREE.HalfFloatType, samples: 4 },
))
composer.addPass(new RenderPass(scene, camera))
let aoPass = null
try {
  const { N8AOPass } = await import('n8ao')
  aoPass = new N8AOPass(scene, camera, window.innerWidth, window.innerHeight)
  aoPass.configuration.aoRadius = 0.36
  aoPass.configuration.distanceFalloff = 0.8
  aoPass.configuration.intensity = 1.18
  aoPass.setQualityMode('Medium')
  composer.addPass(aoPass)
} catch (e) { console.warn('N8AO 없음 — AO 없이 진행', e) }
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.17, 0.45, 1.0)
composer.addPass(bloom)
composer.addPass(new OutputPass())
/* 게임의 Vignette(offset 0.23, darkness 0.24) 재현 — 리그 공통이라 비교에 영향 없음 */
const vignettePass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, offset: { value: 0.23 }, darkness: { value: 0.24 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float offset; uniform float darkness; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= smoothstep(0.8, offset * 0.799, d * (darkness + offset));
      gl_FragColor = c;
    }`,
}), 'tDiffuse')
composer.addPass(vignettePass)
composer.addPass(new SMAAPass(window.innerWidth, window.innerHeight))

/* ── HDRI (IBL만) ── */
const pmrem = new THREE.PMREMGenerator(renderer)
await new Promise((res) => {
  new RGBELoader().load('/hdri/hospital_room_2_2k.hdr', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(tex).texture
    tex.dispose()
    res()
  }, undefined, () => res())
})

/* ── 방 ── */
const ctx = await buildRoom(scene)

/* ── 리그 ── */
const rigs = {
  baseline: buildBaseline(scene, ctx),
  light: buildLight(scene, ctx),
}

function applyRig(name) {
  rigName = name
  for (const k of Object.keys(rigs)) rigs[k].group.visible = k === name
  const r = rigs[name]
  if (renderer.shadowMap.type !== r.shadowType) {
    renderer.shadowMap.type = r.shadowType
    scene.traverse((o) => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true }) })
  }
  scene.environmentIntensity = r.envIntensity
  renderer.toneMappingExposure = expOverride ?? r.exposure
  r.applyMaterials()
  r.applyCam(camName)
  renderer.shadowMap.needsUpdate = true
  hudDirty = true
}

function applyCam(name) {
  camName = name
  const c = CAMERAS[name]
  camera.position.set(...c.pos)
  camera.fov = c.fov
  camera.updateProjectionMatrix()
  controls.target.set(...c.look)
  controls.update()
  camera.lookAt(...c.look)
  rigs[rigName].applyCam(name)
  hudDirty = true
}

applyRig(rigName)
applyCam(camName)

/* ── HUD ── */
const hud = document.getElementById('hud')
let frames = 0, fpsAcc = 0, last = performance.now(), fps = 0
const fpsHist = []

function updateHUD() {
  const info = { calls: lastCalls, triangles: lastTris }
  hud.innerHTML =
    `<b>rig</b> <span class="v ${rigName}">${rigName}</span>` +
    ` &nbsp; <b>cam</b> <span class="v">${camName}</span>` +
    ` &nbsp; <b>post</b> <span class="v">${postOn ? 'on' : 'off'}</span>` +
    ` &nbsp; <b>tone</b> <span class="v">${toneMode}</span>` +
    ` &nbsp; <b>out</b> <span class="v">${outMode}</span><br>` +
    `<b>fps</b> <span class="v big">${fps.toFixed(0)}</span>` +
    ` &nbsp; <b>draw calls</b> <span class="v big">${info.calls}</span>` +
    ` &nbsp; <b>tris</b> <span class="v">${(info.triangles / 1000).toFixed(1)}k</span>` +
    ` &nbsp; <b>lights</b> <span class="v">${rigs[rigName].lightCount}</span><br>` +
    `<span class="dim">L=rig  C=camera  P=post</span>`
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (k === 'l') applyRig(rigName === 'light' ? 'baseline' : 'light')
  if (k === 'c') applyCam(camName === 'talk' ? 'exam' : 'talk')
  if (k === 'p') { postOn = !postOn; hudDirty = true }
})

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setSize(w, h)
  composer.setSize(w, h)
  aoPass?.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
})

/* renderer.info는 render() 호출마다 리셋된다 → 포스트패스까지 합산하려면 수동 리셋 */
renderer.info.autoReset = false
let lastCalls = 0, lastTris = 0

function loop() {
  requestAnimationFrame(loop)
  controls.update()
  renderer.info.reset()
  if (postOn) composer.render()
  else renderer.render(scene, camera)
  lastCalls = renderer.info.render.calls
  lastTris = renderer.info.render.triangles

  frames++
  const now = performance.now()
  const dt = now - last
  if (dt >= 400) {
    fps = (frames * 1000) / dt
    fpsHist.push(fps); if (fpsHist.length > 20) fpsHist.shift()
    frames = 0; last = now
    hudDirty = true
  }
  if (hudDirty) { updateHUD(); hudDirty = false }
}
loop()

/* ── Playwright용 API ── */
window.__lab = {
  setRig: applyRig,
  setCam: applyCam,
  setPost: (v) => { postOn = !!v },
  stats: () => ({
    rig: rigName, cam: camName, post: postOn,
    fps: fpsHist.length ? fpsHist.reduce((a, b) => a + b, 0) / fpsHist.length : fps,
    fpsMin: fpsHist.length ? Math.min(...fpsHist) : fps,
    calls: lastCalls,
    triangles: lastTris,
    lights: rigs[rigName].lightCount,
    programs: renderer.info.programs?.length ?? -1,
  }),
  resetFps: () => { fpsHist.length = 0 },
  /* 진단용 — 노출 원인 분리 */
  setEnv: (v) => { scene.environmentIntensity = v; hudDirty = true },
  setRigVisible: (v) => { rigs[rigName].group.visible = v },
  setExposure: (v) => { renderer.toneMappingExposure = v },
  setBloom: (v) => { bloom.enabled = v },
  setAO: (v) => { if (aoPass) aoPass.enabled = v },
  scene, renderer, camera,
  /* 기법별 기여도 분리용 */
  setPart: (k, v) => { const p = rigs.light.parts?.[k]; if (p) { if (p.visible !== undefined) p.visible = v; } },
}
window.__labReady = true
console.log('[clinic-lab/light] ready')
