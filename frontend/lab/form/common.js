/**
 * clinic-lab / form 변형 — 공통 상수·재질·조명.
 *
 * 이 파일의 값은 전부 src/three/ClinicScene.tsx 에서 그대로 옮겨온 것이다.
 * 이 실험은 "형태(form)만" 바꿔 효과를 재는 것이므로
 * 조명·재질·톤매핑·포스트프로세싱은 본 씬과 동일하게 둔다. 여기를 고치면 비교가 무의미해진다.
 */
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/* ── 방 치수 (ClinicScene.tsx ROOM) ── */
export const ROOM = { w: 6.4, d: 6.6, h: 3.0, backZ: -5.2, frontZ: 1.2 }
export const DOOR_X = -1.4
export const DOOR_W = 1.05
export const DOOR_H = 2.15

/* ── 좌석 / 진찰대 (ClinicScene.tsx SEAT, EXAM) ── */
export const SEAT = {
  pos: [-0.9, 0, -0.1],
  camLook: [-0.92, 1.06, 0.0],
  faceLightTarget: [-0.92, 1.08, 0.0],
  keyLightPos: [-1.0, 2.4, 0.7],
}
export const EXAM = {
  bedPos: [1.95, 0, -3.5],
  bedRotY: -Math.PI / 2,
  camPos: [1.9, 1.82, -2.72],
  camLook: [1.9, 0.95, -3.5],
}
export const CAM_INTAKE = { pos: [-1.85, 1.34, 0.95], look: SEAT.camLook, fov: 52 }
export const CAM_EXAM = { pos: EXAM.camPos, look: EXAM.camLook, fov: 52 }

/* ── PBR 로더 (ClinicScene.tsx loadPBR / makePBRMaterial 그대로) ── */
const TEX = new THREE.TextureLoader()
const pbrCache = new Map()

export function loadPBR(base, opts = {}) {
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
  const set = { color, normal, rough, ao }
  pbrCache.set(base, set)
  return set
}

export function makePBRMaterial(base, repeat, extra = {}) {
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

/* ── 재질 (ClinicScene.tsx 와 동일 값) ──
   두 모드(base/form)가 **같은 인스턴스**를 공유한다 → 재질 차이가 섞일 여지가 없다. */
export const M = {}
export function initMaterials() {
  M.floor = makePBRMaterial('/textures/brown_planks_05', [3.0, 3.1], {
    ao: true, color: '#c9a878', roughness: 0.6, metalness: 0.0,
  })
  const src = loadPBR('/textures/painted_plaster_wall', { color: false })
  const n = src.normal.clone(); const r = src.rough.clone()
  for (const t of [n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.4, 1.3); t.needsUpdate = true }
  M.wall = new THREE.MeshStandardMaterial({
    color: '#efe6d6', normalMap: n, normalScale: new THREE.Vector2(0.3, 0.3),
    roughnessMap: r, roughness: 0.95, metalness: 0.0,
  })
  M.wainscot = new THREE.MeshStandardMaterial({ color: '#b8946a', roughness: 0.7 })
  M.skirt = new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.6 })
  M.ceiling = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.95 })
  M.whitePaint = new THREE.MeshStandardMaterial({ color: '#efe9dd', roughness: 0.55 })
  M.door = new THREE.MeshStandardMaterial({ color: '#d8c4a4', roughness: 0.5 })

  // 소품 재질 — 본 씬에서 인라인으로 쓰던 값들을 그대로 이름만 붙였다.
  M.chrome = new THREE.MeshStandardMaterial({ color: '#c2c7cc', roughness: 0.3, metalness: 0.7 })
  M.steel = new THREE.MeshStandardMaterial({ color: '#9aa0a4', roughness: 0.4, metalness: 0.5 })
  M.darkPlastic = new THREE.MeshStandardMaterial({ color: '#2a2e31', roughness: 0.5 })
  M.blackRubber = new THREE.MeshStandardMaterial({ color: '#1c1f22', roughness: 0.6 })
  M.stoolSeat = new THREE.MeshStandardMaterial({ color: '#2f3437', roughness: 0.5 })
  M.stoolLeg = new THREE.MeshStandardMaterial({ color: '#3a3f42', roughness: 0.5 })
  M.matVinyl = new THREE.MeshStandardMaterial({ color: '#c9b48f', roughness: 0.6 })
  M.bedWood = new THREE.MeshStandardMaterial({ color: '#d8c4a0', roughness: 0.65 })
  M.paper = new THREE.MeshStandardMaterial({ color: '#e9e1d0', roughness: 0.97 })
  M.paperRoll = new THREE.MeshStandardMaterial({ color: '#fbfbf6', roughness: 0.95 })
  M.curtainA = new THREE.MeshStandardMaterial({ color: '#cdd8c4', roughness: 0.9, side: THREE.DoubleSide })
  M.curtainB = new THREE.MeshStandardMaterial({ color: '#d8e0cf', roughness: 0.9, side: THREE.DoubleSide })
  M.rail = new THREE.MeshStandardMaterial({ color: '#b8bec2', roughness: 0.4, metalness: 0.6 })
  M.slat = new THREE.MeshStandardMaterial({ color: '#e8dcc4', roughness: 0.7 })
  M.glass = new THREE.MeshStandardMaterial({
    color: '#fff2dc', emissive: '#ffe6bc', emissiveIntensity: 1.1, roughness: 0.15, metalness: 0.0,
  })
  M.monitorBody = new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.4 })
  M.monitorScreen = new THREE.MeshStandardMaterial({ color: '#eaf2ea', emissive: '#dfe9d8', emissiveIntensity: 0.6 })
  M.monitorStand = new THREE.MeshStandardMaterial({ color: '#2a2e31', roughness: 0.45, metalness: 0.3 })
  M.keyBase = new THREE.MeshStandardMaterial({ color: '#e4e7ea', roughness: 0.45, metalness: 0.05 })
  M.keyCap = new THREE.MeshStandardMaterial({ color: '#34383c', roughness: 0.6 })
  M.clipTeal = new THREE.MeshStandardMaterial({ color: '#3a7d7b', roughness: 0.5 })
  M.formSheet = new THREE.MeshStandardMaterial({ color: '#f7f6f1', roughness: 0.92 })
  M.clipMetal = new THREE.MeshStandardMaterial({ color: '#aeb4b8', roughness: 0.35, metalness: 0.7 })
  M.cupMetal = new THREE.MeshStandardMaterial({ color: '#c2c7cc', roughness: 0.22, metalness: 0.7 })
  M.cupMetal2 = new THREE.MeshStandardMaterial({ color: '#d6dadd', roughness: 0.32, metalness: 0.5 })
  M.cupInner = new THREE.MeshStandardMaterial({ color: '#2a2e31', roughness: 0.7 })
  M.wood = new THREE.MeshStandardMaterial({ color: '#d8b98c', roughness: 0.8 })
  M.panelFrame = new THREE.MeshStandardMaterial({ color: '#e8ece9', roughness: 0.6 })
  M.panelGlow = new THREE.MeshStandardMaterial({ color: '#fff6e8', emissive: '#fff1dc', emissiveIntensity: 2.0 })
  M.stainless = new THREE.MeshStandardMaterial({ color: '#cfd6da', roughness: 0.35, metalness: 0.55 })
  M.sharps = new THREE.MeshStandardMaterial({ color: '#e4b521', roughness: 0.55 })
  M.sharpsLid = new THREE.MeshStandardMaterial({ color: '#c2962f', roughness: 0.6 })
  M.gloveWhite = new THREE.MeshStandardMaterial({ color: '#f4f4ef', roughness: 0.9 })
  M.corridor = new THREE.MeshStandardMaterial({ color: '#1a2026', roughness: 1 })
  M.ivBag = new THREE.MeshStandardMaterial({ color: '#dff0ff', transparent: true, opacity: 0.55, roughness: 0.2 })
  M.ivDrip = new THREE.MeshStandardMaterial({ color: '#eaf4ff', transparent: true, opacity: 0.7 })
  M.cartWhite = new THREE.MeshStandardMaterial({ color: '#eef1f3', roughness: 0.45 })
  M.probe = new THREE.MeshStandardMaterial({ color: '#e9edf0', roughness: 0.4 })
  M.frameGold = new THREE.MeshStandardMaterial({ color: '#9c7b46', roughness: 0.45, metalness: 0.25 })
  M.frameBlue = new THREE.MeshStandardMaterial({ color: '#46566a', roughness: 0.45, metalness: 0.25 })
  M.gridTee = new THREE.MeshStandardMaterial({ color: '#e2e5df', roughness: 0.55, metalness: 0.1 })
  return M
}

/* 책 색 (BookRow) */
export const BOOK_COLORS = ['#2f4a5e', '#3a5247', '#6e3a3a', '#d8d2c4', '#445566', '#7a6a4a', '#2e3e4a', '#e6e0d2']
export const GLOVE_COLORS = ['#3a6ea5', '#4a4f54', '#5aa06e']

/* ── 해부도 포스터 캔버스 (재질 축이므로 base/form 동일) ── */
export function anatomyTexture(kind = 'organs') {
  const W = 384, H = 560
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#f6efe0'; ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#c9b88f'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, W - 16, H - 16)
  ctx.fillStyle = '#33524a'; ctx.fillRect(16, 16, W - 32, 54)
  ctx.fillStyle = '#f6efe0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = 'bold 24px Helvetica, Arial, sans-serif'
  ctx.fillText(kind === 'skeleton' ? 'SKELETON' : 'ANATOMY', W / 2, 43)
  const cx = W / 2
  ctx.strokeStyle = '#8a6a4a'; ctx.lineWidth = 3
  if (kind === 'skeleton') {
    ctx.beginPath(); ctx.arc(cx, 130, 34, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, 168); ctx.lineTo(cx, 380); ctx.stroke()
    for (let i = 0; i < 9; i++) {
      const y = 205 + i * 18, w = 70 - Math.abs(i - 4) * 6
      ctx.beginPath(); ctx.moveTo(cx - w, y); ctx.quadraticCurveTo(cx, y - 12, cx + w, y); ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(cx - 60, 385); ctx.lineTo(cx - 40, 500); ctx.moveTo(cx + 60, 385); ctx.lineTo(cx + 40, 500); ctx.stroke()
  } else {
    ctx.fillStyle = '#e2c2ac'
    ctx.beginPath(); ctx.ellipse(cx, 300, 105, 175, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#a8443a'; ctx.beginPath(); ctx.ellipse(cx - 6, 210, 34, 40, 0.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#c76a5a'; ctx.beginPath(); ctx.ellipse(cx - 52, 220, 40, 55, -0.2, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx + 52, 220, 40, 55, 0.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#8b5b3a'; ctx.beginPath(); ctx.ellipse(cx - 38, 305, 55, 38, 0.1, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#c99a6a'; ctx.beginPath(); ctx.ellipse(cx + 10, 380, 62, 45, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.strokeStyle = '#7a6a4a'; ctx.lineWidth = 1.2; ctx.fillStyle = '#5a4a30'
  ctx.font = '13px Helvetica, Arial'; ctx.textAlign = 'left'
  for (let i = 0; i < 5; i++) {
    const y = 200 + i * 52
    ctx.beginPath(); ctx.moveTo(W - 118, y); ctx.lineTo(W - 88, y); ctx.stroke()
    ctx.fillText(['Cor', 'Pulmo', 'Hepar', 'Ren', 'Vesica'][i], W - 84, y + 4)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  return t
}

export function vitalsTexture() {
  const W = 512, H = 384
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#060f0a'; ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(40,100,65,0.35)'; ctx.lineWidth = 1
  for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
  const wave = (yBase, color, fn) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.beginPath()
    for (let x = 0; x < W - 130; x++) ctx[x === 0 ? 'moveTo' : 'lineTo'](x, yBase - fn(x))
    ctx.stroke()
  }
  wave(80, '#3dff7a', (x) => { const p = x % 90; return p < 6 ? p * 5 : p < 12 ? (12 - p) * 5 : p < 18 ? -(p - 12) * 3 : 0 })
  wave(180, '#39d9ff', (x) => Math.max(0, Math.sin((x % 70) / 70 * Math.PI) * 34))
  wave(300, '#f5d45a', (x) => Math.sin(x / 26) * 18)
  ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(W - 124, 4, 120, H - 8)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#3dff7a'; ctx.font = 'bold 48px Helvetica, Arial'; ctx.fillText('88', W - 8, 60)
  ctx.font = '700 12px Arial'; ctx.fillText('HR bpm', W - 8, 78)
  ctx.fillStyle = '#39d9ff'; ctx.font = 'bold 42px Helvetica, Arial'; ctx.fillText('98', W - 8, 158)
  ctx.font = '700 12px Arial'; ctx.fillText('SpO2 %', W - 8, 175)
  ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 28px Helvetica, Arial'; ctx.fillText('120/80', W - 8, 245)
  ctx.fillStyle = '#f5d45a'; ctx.font = 'bold 32px Helvetica, Arial'; ctx.fillText('16', W - 8, 328)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  return t
}

/* ── 조명 리그 (ClinicScene.tsx <Canvas> 안의 라이트 그대로) ── */
export function buildLights(scene) {
  const g = new THREE.Group()

  const amb = new THREE.AmbientLight(0xf7f8fb, 0.12)
  const hemi = new THREE.HemisphereLight(0xeef4ff, 0x6a5544, 0.34)
  const dirWindow = new THREE.DirectionalLight(0xfff2e4, 0.88)
  dirWindow.position.set(4.5, 2.6, -0.9)
  const dirTop = new THREE.DirectionalLight(0xf5f7ff, 0.5)
  dirTop.position.set(1.2, 5, 1.0)
  dirTop.castShadow = true
  dirTop.shadow.mapSize.set(2048, 2048)
  dirTop.shadow.camera.left = -4; dirTop.shadow.camera.right = 4
  dirTop.shadow.camera.top = 4; dirTop.shadow.camera.bottom = -4
  dirTop.shadow.bias = -0.0004; dirTop.shadow.normalBias = 0.018

  const key = new THREE.SpotLight(0xfff0e4, 1.9, 5.5, 0.58, 1, 2)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.bias = -0.0002; key.shadow.normalBias = 0.012

  const fill = new THREE.PointLight(0xf5f7ff, 0.26, 2.8, 2)
  const rim = new THREE.PointLight(0xd8e7ff, 0.42, 2.6, 2)
  rim.position.set(-1.45, 1.85, -0.9)
  const deskLamp = new THREE.PointLight(0xffc97d, 1.1, 2.2, 2)
  deskLamp.position.set(-2.05 - 0.85, 1.15, 0.5 - 0.2)

  g.add(amb, hemi, dirWindow, dirTop, dirTop.target, key, key.target, fill, rim, deskLamp)
  scene.add(g)

  /** examMode 여부에 따라 본 씬과 똑같이 라이트를 재배치한다. */
  function setMode(examMode) {
    if (examMode) {
      key.position.set(2.2, 2.8, -2.6); key.target.position.set(1.75, 1.0, -3.5); key.intensity = 0.62
      fill.position.set(1.8, 1.8, -2.6); fill.intensity = 0.08
      rim.visible = false
    } else {
      key.position.set(...SEAT.keyLightPos); key.target.position.set(...SEAT.faceLightTarget); key.intensity = 1.9
      fill.position.set(-0.25, 1.45, 0.65); fill.intensity = 0.26
      rim.visible = true
    }
    key.target.updateMatrixWorld()
    dirTop.target.updateMatrixWorld()
  }
  setMode(false)
  return { group: g, setMode }
}

/* ── HDRI IBL (Environment intensity 0.64) ── */
export function loadEnvironment(renderer, scene) {
  return new Promise((resolve) => {
    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    new RGBELoader().load(
      '/hdri/hospital_room_2_2k.hdr',
      (hdr) => {
        const env = pmrem.fromEquirectangular(hdr).texture
        scene.environment = env
        scene.environmentIntensity = 0.64
        hdr.dispose(); pmrem.dispose()
        resolve(true)
      },
      undefined,
      () => resolve(false),
    )
  })
}

/* ── GLB/GLTF 로더 ── */
const gltfLoader = new GLTFLoader()
const modelCache = new Map()
export function loadModel(url) {
  if (modelCache.has(url)) return modelCache.get(url)
  const p = new Promise((resolve) => {
    gltfLoader.load(url, (g) => {
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      resolve(g.scene)
    }, undefined, () => resolve(null))
  })
  modelCache.set(url, p)
  return p
}

/** ClinicScene.tsx 의 <Prop> — /models/<name>/<name>.gltf 를 원본 스케일로 배치 */
export async function propNode(asset, position, rotation = [0, 0, 0], scale = 1) {
  const src = await loadModel(`/models/${asset}/${asset}.gltf`)
  if (!src) return null
  const c = src.clone(true)
  const g = new THREE.Group()
  g.add(c)
  g.position.set(...position)
  g.rotation.set(...rotation)
  if (Array.isArray(scale)) g.scale.set(...scale); else g.scale.setScalar(scale)
  return g
}

/** ClinicScene.tsx 의 <FittedGLB> — maxDim 기준 targetSize 로 맞추고 중심정렬 */
export async function fittedGLB(url, targetSize, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const src = await loadModel(url)
  if (!src) return null
  const c = src.clone(true)
  const box = new THREE.Box3().setFromObject(c)
  const size = new THREE.Vector3(); box.getSize(size)
  const ctr = new THREE.Vector3(); box.getCenter(ctr)
  const maxd = Math.max(size.x, size.y, size.z) || 1
  const s = targetSize / maxd
  const inner = new THREE.Group()
  inner.scale.setScalar(s)
  c.position.set(-ctr.x, -ctr.y, -ctr.z)
  inner.add(c)
  const g = new THREE.Group()
  g.add(inner)
  g.position.set(...position)
  g.rotation.set(...rotation)
  return g
}
