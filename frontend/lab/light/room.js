/* ══════════════════════════════════════════════════════════════════════
   clinic-lab / light 변형 — 방 지오메트리 (본 씬 src/three/ClinicScene.tsx 복제)

   ⚠ 이 실험의 규칙: **형태와 재질은 본 씬 수준 그대로.** 여기서 바꾸는 것은 없다.
   조명 축(rigs.js)만 갈아끼워 비교한다.
   치수·좌표는 ClinicScene.tsx의 ROOM/DOOR/SEAT/EXAM 상수를 그대로 가져왔다.
   ══════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const ROOM = { w: 6.4, d: 6.6, h: 3.0, backZ: -5.2, frontZ: 1.2 }
export const DOOR = { x: -1.4, w: 1.05, h: 2.15 }
/* 천장 형광등 패널 4개 (본 씬 CeilingPanel x/z) */
export const PANELS = [
  { x: -1.3, z: -1.8 }, { x: 1.3, z: -1.8 },
  { x: -1.3, z: -3.8 }, { x: 1.3, z: -3.8 },
]
export const PANEL = { fw: 1.18, fd: 0.58, y: ROOM.h - 0.02 - 0.035 } // 발광면 크기/높이
/* 창문 (우측 벽) — 본 씬 group position [hx-0.06, 1.65, -0.9] */
export const WINDOW = { x: 3.14, y: 1.65, z: -0.9, w: 1.7, h: 1.1 }
/* 블라인드 — 창 group 안 [0, 0.18, 0.03] · width 1.62 · height 0.74 */
export const BLIND = { x: 3.11, y: 1.83, z: -0.9, w: 1.62, h: 0.74 }

export const CAMERAS = {
  talk: { pos: [-1.85, 1.34, 0.95], look: [-0.92, 1.06, 0.0], fov: 52 },
  exam: { pos: [1.9, 1.82, -2.72], look: [1.9, 0.95, -3.5], fov: 52 },
}

const TEX = new THREE.TextureLoader()
const pbrCache = new Map()

function loadPBR(base, opts = {}) {
  const key = base + JSON.stringify(opts)
  if (pbrCache.has(key)) return pbrCache.get(key)
  const wantColor = opts.color !== false
  const color = wantColor ? TEX.load(`${base}_diff_2k.jpg`) : undefined
  if (color) color.colorSpace = THREE.SRGBColorSpace
  const normal = TEX.load(`${base}_nor_gl_2k.jpg`)
  const rough = TEX.load(`${base}_rough_2k.jpg`)
  for (const t of [color, normal, rough]) {
    if (!t) continue
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
  }
  const set = { color, normal, rough }
  pbrCache.set(key, set)
  return set
}

function pbrMaterial(base, repeat, extra = {}) {
  const src = loadPBR(base, { color: extra.map !== false })
  const c = src.color?.clone()
  const n = src.normal.clone()
  const r = src.rough.clone()
  for (const t of [c, n, r]) {
    if (!t) continue
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
    t.needsUpdate = true
  }
  if (c) c.colorSpace = THREE.SRGBColorSpace
  const { map: _m, ...rest } = extra
  return new THREE.MeshStandardMaterial({
    map: c ?? null, normalMap: n, roughnessMap: r,
    normalScale: new THREE.Vector2(0.6, 0.6),
    ...rest,
  })
}

/* 본 씬과 동일한 재질 팩토리 */
export function makeMaterials() {
  const floor = pbrMaterial('/textures/brown_planks_05', [3.0, 3.1], {
    color: '#c9a878', roughness: 0.6, metalness: 0.0,
  })
  const wallSrc = loadPBR('/textures/painted_plaster_wall', { color: false })
  const n = wallSrc.normal.clone(), r = wallSrc.rough.clone()
  for (const t of [n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.4, 1.3); t.needsUpdate = true }
  const wall = new THREE.MeshStandardMaterial({
    color: '#efe6d6', normalMap: n, normalScale: new THREE.Vector2(0.3, 0.3),
    roughnessMap: r, roughness: 0.95, metalness: 0.0,
  })
  return {
    floor, wall,
    wainscot: new THREE.MeshStandardMaterial({ color: '#b8946a', roughness: 0.7 }),
    skirt: new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.6 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.95 }),
    whitePaint: new THREE.MeshStandardMaterial({ color: '#efe9dd', roughness: 0.55 }),
    door: new THREE.MeshStandardMaterial({ color: '#d8c4a4', roughness: 0.5 }),
  }
}

const std = (o) => new THREE.MeshStandardMaterial(o)
function box(w, h, d, mat, pos, rot) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  if (pos) m.position.set(...pos)
  if (rot) m.rotation.set(...rot)
  m.castShadow = true; m.receiveShadow = true
  return m
}
function plane(w, h, mat, pos, rot) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  if (pos) m.position.set(...pos)
  if (rot) m.rotation.set(...rot)
  m.receiveShadow = true
  return m
}
function cyl(rt, rb, h, seg, mat, pos, rot) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)
  if (pos) m.position.set(...pos)
  if (rot) m.rotation.set(...rot)
  m.castShadow = true
  return m
}

const gltfLoader = new GLTFLoader()
function loadGLTF(url) {
  return new Promise((res) => {
    gltfLoader.load(url, (g) => {
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      res(g.scene)
    }, undefined, () => res(null))
  })
}

/* ══ 방 전체 ══ */
export async function buildRoom(scene) {
  const M = makeMaterials()
  const { w, h, backZ, frontZ } = ROOM
  const hx = w / 2
  const depth = frontZ - backZ
  const cz = (frontZ + backZ) / 2
  const root = new THREE.Group()
  scene.add(root)

  /* 바닥 / 천장 */
  const floor = plane(w, depth, M.floor, [0, 0, cz], [-Math.PI / 2, 0, 0])
  root.add(floor)
  root.add(plane(w, depth, M.ceiling, [0, h, cz], [Math.PI / 2, 0, 0]))

  /* 좌측 벽 */
  root.add(plane(depth, h, M.wall, [-hx, h / 2, cz], [0, Math.PI / 2, 0]))
  root.add(plane(depth, 1.2, M.wainscot, [-hx + 0.01, 0.6, cz], [0, Math.PI / 2, 0]))
  root.add(box(0.06, 0.1, depth, M.skirt, [-hx + 0.03, 0.05, cz]))

  /* 우측 벽 (창문) */
  root.add(plane(depth, h, M.wall, [hx, h / 2, cz], [0, -Math.PI / 2, 0]))
  root.add(plane(depth, 1.2, M.wainscot, [hx - 0.01, 0.6, cz], [0, -Math.PI / 2, 0]))
  root.add(box(0.06, 0.1, depth, M.skirt, [hx - 0.03, 0.05, cz]))

  const win = new THREE.Group()
  win.position.set(WINDOW.x, WINDOW.y, WINDOW.z)
  root.add(win)
  // 유리(발광면) — rig가 색/세기를 바꿔가며 실험한다
  const glassMat = std({ color: '#fff2dc', emissive: '#ffe6bc', emissiveIntensity: 1.1, roughness: 0.15, metalness: 0 })
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW.w, WINDOW.h), glassMat)
  glass.rotation.set(0, -Math.PI / 2, 0)
  win.add(glass)
  // 블라인드 (16 슬랫)
  const blinds = new THREE.Group()
  blinds.position.set(0, 0.18, 0.03)
  blinds.rotation.set(0, -Math.PI / 2, 0)
  const slats = 16, gap = 0.74 / slats
  const slatMat = std({ color: '#e8dcc4', roughness: 0.7 })
  const blindMeshes = []
  for (let i = 0; i < slats; i++) {
    const s = box(1.62, gap * 0.82, 0.012, slatMat, [0, 0.74 / 2 - gap * (i + 0.5), 0], [0.5, 0, 0])
    s.receiveShadow = true
    blinds.add(s); blindMeshes.push(s)
  }
  const cord = cyl(0.004, 0.004, 0.74, 6, std({ color: '#cabfa6', roughness: 0.8 }), [1.62 / 2 - 0.05, 0, 0.02])
  blinds.add(cord)
  win.add(blinds)
  // 창틀
  for (const y of [0, 0.55, -0.55]) win.add(box(1.84, 0.06, 0.04, M.whitePaint, [0, y, 0], [0, -Math.PI / 2, 0]))
  win.add(box(0.04, 1.16, 0.06, M.whitePaint, [0, 0, 0]))

  /* 앞쪽 벽 (의사 등 뒤) */
  root.add(plane(w, h, M.wall, [0, h / 2, frontZ], [0, Math.PI, 0]))

  /* 뒷벽 + 문 */
  const leftPanelW = DOOR.x - DOOR.w / 2 + hx
  const rightPanelW = hx - (DOOR.x + DOOR.w / 2)
  root.add(plane(leftPanelW, h, M.wall, [-hx + leftPanelW / 2, h / 2, backZ]))
  root.add(plane(rightPanelW, h, M.wall, [hx - rightPanelW / 2, h / 2, backZ]))
  root.add(plane(DOOR.w, h - DOOR.h, M.wall, [DOOR.x, DOOR.h + (h - DOOR.h) / 2, backZ]))
  root.add(plane(leftPanelW, 1.2, M.wainscot, [-hx + leftPanelW / 2, 0.6, backZ + 0.01]))
  root.add(plane(rightPanelW, 1.2, M.wainscot, [hx - rightPanelW / 2, 0.6, backZ + 0.01]))
  root.add(box(0.08, DOOR.h + 0.1, 0.12, M.whitePaint, [DOOR.x - DOOR.w / 2 - 0.04, DOOR.h / 2, backZ + 0.02]))
  root.add(box(0.08, DOOR.h + 0.1, 0.12, M.whitePaint, [DOOR.x + DOOR.w / 2 + 0.04, DOOR.h / 2, backZ + 0.02]))
  root.add(box(DOOR.w + 0.16, 0.08, 0.12, M.whitePaint, [DOOR.x, DOOR.h + 0.05, backZ + 0.02]))
  root.add(plane(DOOR.w, DOOR.h, std({ color: '#1a2026', roughness: 1 }), [DOOR.x, DOOR.h / 2, backZ - 0.5]))
  root.add(box(DOOR.w, DOOR.h, 0.05, M.door, [DOOR.x, DOOR.h / 2, backZ + 0.04]))
  root.add(cyl(0.02, 0.02, 0.12, 10, std({ color: '#9aa0a4', roughness: 0.3, metalness: 0.7 }),
    [DOOR.x + DOOR.w / 2 - 0.12, 1.05, backZ + 0.09]))

  /* ══ 천장 형광등 패널 4개 (프레임 + 발광면) ══ */
  const panelMats = []
  const panelGroups = []
  for (const p of PANELS) {
    const g = new THREE.Group()
    g.position.set(p.x, ROOM.h - 0.02, p.z)
    const frame = box(1.3, 0.06, 0.7, std({ color: '#e8ece9', roughness: 0.6 }))
    frame.castShadow = false
    g.add(frame)
    const mat = std({ color: '#fff6e8', emissive: '#fff1dc', emissiveIntensity: 2.0 })
    const face = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.02, 0.58), mat)
    face.position.set(0, -0.035, 0)
    g.add(face)
    panelMats.push(mat); panelGroups.push(g)
    root.add(g)
  }

  /* ══ 소품 ══ */
  const [deskGLB, shelfGLB, plantGLB, clockGLB] = await Promise.all([
    loadGLTF('/models/metal_office_desk/metal_office_desk.gltf'),
    loadGLTF('/models/wooden_bookshelf_worn/wooden_bookshelf_worn.gltf'),
    loadGLTF('/models/potted_plant_01/potted_plant_01.gltf'),
    loadGLTF('/models/wall_clock/wall_clock.gltf'),
  ])

  /* 의사 책상 */
  const desk = new THREE.Group()
  desk.position.set(-2.05, 0, 0.5)
  root.add(desk)
  if (deskGLB) { deskGLB.position.set(0, 0, -0.08); deskGLB.scale.set(0.92, 1.06, 0.88); desk.add(deskGLB) }
  // 차트 클립보드
  const clip = new THREE.Group()
  clip.position.set(0.66, 0.84, 0.1); clip.rotation.set(-0.1, -0.3, 0); clip.scale.setScalar(0.72)
  clip.add(box(0.24, 0.014, 0.32, std({ color: '#3a7d7b', roughness: 0.5 })))
  clip.add(box(0.2, 0.006, 0.26, std({ color: '#f7f6f1', roughness: 0.92 }), [0, 0.012, 0.015]))
  clip.add(box(0.1, 0.014, 0.03, std({ color: '#aeb4b8', roughness: 0.35, metalness: 0.7 }), [0, 0.018, -0.14]))
  desk.add(clip)
  // EMR 모니터
  const mon = new THREE.Group()
  mon.position.set(-0.35, 0.83, -0.28); mon.rotation.set(0, 0.45, 0)
  mon.add(box(0.66, 0.42, 0.04, std({ color: '#23262a', roughness: 0.4 }), [0, 0.42, 0]))
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.36),
    std({ color: '#eaf2ea', emissive: '#dfe9d8', emissiveIntensity: 0.6 }))
  screen.position.set(0, 0.42, 0.022); mon.add(screen)
  mon.add(cyl(0.022, 0.03, 0.18, 10, std({ color: '#2a2e31', roughness: 0.4, metalness: 0.3 }), [0, 0.115, 0]))
  mon.add(box(0.30, 0.025, 0.18, std({ color: '#2a2e31', roughness: 0.45, metalness: 0.3 }), [0, 0.02, 0.02]))
  desk.add(mon)
  // 키보드
  const kb = new THREE.Group(); kb.position.set(-0.3, 0.83, 0.02); kb.rotation.set(0, 0.45, 0)
  kb.add(box(0.44, 0.016, 0.15, std({ color: '#e4e7ea', roughness: 0.45, metalness: 0.05 })))
  for (const z of [-0.045, -0.022, 0.001, 0.024]) kb.add(box(0.4, 0.008, 0.017, std({ color: '#34383c', roughness: 0.6 }), [0, 0.014, z - 0.012]))
  desk.add(kb)
  // 도구 컵 2개 + 손소독제
  const cupMat = std({ color: '#c2c7cc', metalness: 0.7, roughness: 0.22 })
  const cup1 = cyl(0.045, 0.04, 0.13, 24, cupMat, [0.34, 0.905, -0.33]); desk.add(cup1)
  const cup2 = cyl(0.05, 0.045, 0.11, 24, std({ color: '#d6dadd', metalness: 0.5, roughness: 0.32 }), [0.52, 0.895, -0.33]); desk.add(cup2)
  for (const [x, c, hgt] of [[0.322, '#1e2124', 0.24], [0.352, '#b8bdc2', 0.26]])
    desk.add(cyl(0.008, 0.008, hgt, 10, std({ color: c, roughness: 0.4, metalness: c === '#b8bdc2' ? 0.6 : 0 }), [x, 0.84 + hgt / 2 + 0.04, -0.33]))
  for (const dx of [-0.02, 0, 0.022])
    desk.add(box(0.016, 0.17, 0.004, std({ color: '#d8b98c', roughness: 0.8 }), [0.52 + dx, 1.0, -0.342]))
  const bottle = new THREE.Group(); bottle.position.set(0.16, 0.84, -0.34)
  bottle.add(box(0.075, 0.19, 0.055, std({ color: '#e9f1f4', roughness: 0.35 }), [0, 0.095, 0]))
  bottle.add(box(0.05, 0.05, 0.04, std({ color: '#3f4a52', roughness: 0.5 }), [0, 0.21, 0]))
  desk.add(bottle)

  /* 환자 스툴 */
  const stool = new THREE.Group(); stool.position.set(-0.9, 0, -0.1); root.add(stool)
  stool.add(cyl(0.21, 0.21, 0.08, 20, std({ color: '#2f3437', roughness: 0.5 }), [0, 0.5, 0]))
  stool.add(cyl(0.03, 0.03, 0.36, 10, std({ color: '#9aa0a4', roughness: 0.3, metalness: 0.7 }), [0, 0.32, 0]))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    stool.add(box(0.22, 0.04, 0.04, std({ color: '#3a3f42', roughness: 0.5 }), [Math.cos(a) * 0.18, 0.06, Math.sin(a) * 0.18], [0, -a, 0]))
  }

  /* 진찰대 */
  const bed = new THREE.Group(); bed.position.set(1.95, 0, -3.5); bed.rotation.set(0, -Math.PI / 2, 0); root.add(bed)
  bed.add(box(0.72, 0.12, 1.9, std({ color: '#c9b48f', roughness: 0.6 }), [0, 0.62, 0]))
  bed.add(box(0.66, 0.012, 1.5, std({ color: '#e9e1d0', roughness: 0.97 }), [0, 0.685, 0.1]))
  bed.add(box(0.66, 0.56, 1.7, std({ color: '#d8c4a0', roughness: 0.65 }), [0, 0.28, 0]))
  bed.add(cyl(0.06, 0.06, 0.6, 16, std({ color: '#fbfbf6', roughness: 0.95 }), [0, 0.7, 0.97], [0, 0, Math.PI / 2]))

  /* 프라이버시 커튼 2장 */
  const curtain = (px, pz, ry, length) => {
    const g = new THREE.Group(); g.position.set(px, 0, pz); g.rotation.set(0, ry, 0); root.add(g)
    g.add(cyl(0.018, 0.018, length, 10, std({ color: '#b8bec2', roughness: 0.4, metalness: 0.6 }), [0, 2.0, 0], [0, 0, Math.PI / 2]))
    for (let i = 0; i < 7; i++) {
      const x = -length / 2 + (length / 7) * (i + 0.5)
      g.add(box(length / 7 - 0.01, 1.9, 0.03, std({ color: i % 2 === 0 ? '#cdd8c4' : '#d8e0cf', roughness: 0.9 }), [x, 0.95, i % 2 === 0 ? 0.05 : -0.05]))
    }
  }
  curtain(2.4, -2.3, 0, 2.0)
  curtain(0.9, -3.15, Math.PI / 2, 1.7)

  /* 책장 + 책줄 */
  if (shelfGLB) { shelfGLB.position.set(-2.9, 0, -3.3); shelfGLB.rotation.set(0, Math.PI / 2, 0); shelfGLB.scale.setScalar(1.5); root.add(shelfGLB) }
  const bookCols = ['#3b4a5a', '#4a5c46', '#6b3a3a', '#7a6a52', '#43506b', '#5c4a3a', '#8a8272']
  const bookRow = (px, py, pz, count, width) => {
    const g = new THREE.Group(); g.position.set(px, py, pz); g.rotation.set(0, Math.PI / 2, 0); root.add(g)
    for (let i = 0; i < count; i++) {
      const bw = width / count * 0.88
      const bh = 0.26 + ((i * 37) % 7) * 0.012
      g.add(box(bw, bh, 0.16, std({ color: bookCols[i % bookCols.length], roughness: 0.85 }),
        [-width / 2 + (width / count) * (i + 0.5), bh / 2 - 0.13, 0], [0, 0, ((i * 17) % 5 === 0 ? 0.08 : 0)]))
    }
  }
  bookRow(-2.78, 1.42, -3.3, 7, 0.9); bookRow(-2.78, 1.02, -3.3, 8, 0.92); bookRow(-2.78, 0.62, -3.3, 6, 0.88)
  bookRow(-2.78, 1.42, -3.95, 7, 0.86); bookRow(-2.78, 1.02, -3.95, 8, 0.9)

  /* 화분 / 시계 */
  if (plantGLB) { plantGLB.position.set(-2.85, 0, backZ + 0.5); plantGLB.scale.setScalar(1.2); root.add(plantGLB) }
  if (clockGLB) { clockGLB.position.set(2.45, 2.45, backZ + 0.08); root.add(clockGLB) }

  /* 벽 아이템 — 액자/포스터 (본 씬은 캔버스 텍스처, 여기선 단색 판. 빛 반응만 보면 된다) */
  const framed = (px, py, pz, ry, sw, sh, col, frameCol) => {
    const g = new THREE.Group(); g.position.set(px, py, pz); g.rotation.set(0, ry, 0); root.add(g)
    g.add(box(sw + 0.05, sh + 0.05, 0.025, std({ color: frameCol, roughness: 0.5 })))
    const f = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), std({ color: col, roughness: 0.85 }))
    f.position.set(0, 0, 0.016); f.receiveShadow = true; g.add(f)
  }
  framed(0.62, 1.55, backZ + 0.05, 0, 0.6, 0.9, '#f6efe0', '#6a5a44')
  framed(0.05, 2.22, backZ + 0.05, 0, 0.3, 0.4, '#faf6ea', '#8a7550')
  framed(-3.14, 1.55, -2.2, Math.PI / 2, 0.42, 0.66, '#f6efe0', '#46566a')
  // X-ray 뷰박스 (발광 — 방 안의 또 다른 광원)
  const xg = new THREE.Group(); xg.position.set(-3.13, 1.6, -1.4); xg.rotation.set(0, Math.PI / 2, 0); root.add(xg)
  xg.add(box(0.66, 0.82, 0.06, std({ color: '#2b3138', roughness: 0.5 })))
  const xf = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.76),
    std({ color: '#cfe0ea', emissive: '#bcd6e6', emissiveIntensity: 0.9 }))
  xf.position.set(0, 0, 0.033); xg.add(xf)
  // 벽걸이 메디컬 스테이션 (장갑박스 3개)
  const ws = new THREE.Group(); ws.position.set(1.6, 1.6, backZ + 0.05); root.add(ws)
  for (let i = 0; i < 3; i++)
    ws.add(box(0.2, 0.26, 0.11, std({ color: ['#4a6b8a', '#6b8a4a', '#8a6b4a'][i], roughness: 0.7 }), [(i - 1) * 0.23, 0, 0.06]))
  // 벽 청진기
  const st = new THREE.Group(); st.position.set(-3.12, 2.05, -0.7); st.rotation.set(0, Math.PI / 2, 0); root.add(st)
  const pts = []
  for (let i = 0; i <= 24; i++) { const t = i / 24, a = Math.PI * (0.15 + t * 1.7); pts.push(new THREE.Vector3(Math.cos(a) * 0.12, -t * 0.34, Math.sin(a) * 0.02)) }
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 8, false), std({ color: '#2f3a44', roughness: 0.4 }))
  tube.castShadow = true; st.add(tube)
  st.add(cyl(0.04, 0.04, 0.02, 18, std({ color: '#b8bdc2', roughness: 0.3, metalness: 0.7 }), [pts[24].x, pts[24].y - 0.02, 0.01]))

  /* IV 폴대 */
  const iv = new THREE.Group(); iv.position.set(2.62, 0, -2.7); root.add(iv)
  const metal = std({ color: '#c2c7cc', roughness: 0.3, metalness: 0.7 })
  iv.add(cyl(0.018, 0.018, 1.9, 12, metal, [0, 0.95, 0]))
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    iv.add(box(0.22, 0.03, 0.03, std({ color: '#3a3f42', roughness: 0.5 }), [Math.cos(a) * 0.11, 0.03, Math.sin(a) * 0.11], [0, -a, 0]))
  }
  iv.add(box(0.13, 0.24, 0.04, std({ color: '#dff0ff', transparent: true, opacity: 0.55, roughness: 0.2 }), [0.08, 1.62, 0]))

  /* 바이탈 카트 */
  const cart = new THREE.Group(); cart.position.set(2.05, 0, -1.5); cart.rotation.set(0, -0.63, 0); root.add(cart)
  const dark = '#2c3238', white = '#eceff1'
  for (const [x, z] of [[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]])
    cart.add(cyl(0.09, 0.09, 0.06, 18, std({ color: '#1c1f22', roughness: 0.6 }), [x, 0.09, z], [0, 0, Math.PI / 2]))
  cart.add(box(0.5, 0.06, 0.62, std({ color: dark, roughness: 0.5 }), [0, 0.18, 0]))
  cart.add(box(0.46, 0.64, 0.46, std({ color: white, roughness: 0.45 }), [0, 0.52, -0.02]))
  cart.add(box(0.47, 0.12, 0.47, std({ color: dark, roughness: 0.5 }), [0, 0.24, -0.02]))
  cart.add(cyl(0.028, 0.028, 0.5, 12, metal, [0, 1.15, -0.1]))
  const mg = new THREE.Group(); mg.position.set(0, 1.5, -0.02); mg.rotation.set(0.05, 0, 0); cart.add(mg)
  mg.add(box(0.64, 0.42, 0.05, std({ color: dark, roughness: 0.45 })))
  const vs = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34),
    std({ color: '#0d1f16', emissive: '#4fe08a', emissiveIntensity: 0.55, toneMapped: false }))
  vs.position.set(0, 0.01, 0.027); mg.add(vs)

  return { root, floor, floorMat: M.floor, materials: M, panelMats, panelGroups, glassMat, blindMeshes, window: win }
}
