/**
 * clinic-lab / material 변형 — 지오메트리
 *
 * **형태는 본 씬 ClinicScene.tsx를 그대로 옮긴 것이다.** 치수·위치·회전 모두 동일.
 * 이 파일은 재질을 하나도 만들지 않는다 — 전부 MatLib에서 받아 쓴다.
 * 그래야 base/mat 두 모드가 픽셀 단위로 같은 형태를 갖는다.
 *
 * 대응표 (ClinicScene.tsx → 여기)
 *   ROOM · DOOR_X/W/H · EXAM · SEAT 상수 → 그대로
 *   RoomShell / CeilingPanel / Desk / Stool / ExamBed / PrivacyCurtain /
 *   WindowBlinds / IVPole / VitalsCart / BookRow / WallMedStation /
 *   AnatomyPoster / Certificate / XrayViewbox / Stethoscope
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MatLib } from './materials'
import { manager } from './materials'

/* ── 본 씬 상수 (ClinicScene.tsx L35~L140) ── */
export const ROOM = { w: 6.4, d: 6.6, h: 3.0, backZ: -5.2, frontZ: 1.2 }
export const DOOR_X = -1.4
export const DOOR_W = 1.05
export const DOOR_H = 2.15
export const SEAT = {
  pos: [-0.9, 0, -0.1] as const,
  camLook: [-0.92, 1.06, 0.0] as const,
  keyLightPos: [-1.0, 2.4, 0.7] as const,
  faceLightTarget: [-0.92, 1.08, 0.0] as const,
}
export const EXAM = {
  camPos: [1.9, 1.82, -2.72] as const,
  camLook: [1.9, 0.95, -3.5] as const,
}
export const CAM_INTAKE = { pos: [-1.85, 1.34, 0.95] as const, look: SEAT.camLook, fov: 52 }
export const CAM_EXAM = { pos: EXAM.camPos, look: EXAM.camLook, fov: 52 }
/** 진단용(캡처 요구사항 외) — 문 있는 뒷벽 정면. 벽 패널별 타일링 밀도 차이를 보려고. */
export const CAM_WALL = { pos: [-0.4, 1.55, -1.7] as const, look: [-1.4, 1.45, -5.2] as const, fov: 58 }
/** 진단용 — 천장/조명 패널을 올려다본다. */
export const CAM_CEIL = { pos: [0.2, 1.2, -2.2] as const, look: [-0.2, 3.0, -3.4] as const, fov: 62 }
/** 진찰 시점을 같은 각도로 뒤로 뺀 것(환자가 없어서 진찰 카메라가 종이롤로 꽉 차기 때문).
 *  방향·목표점은 EXAM과 동일하고 거리만 2.1배. */
export const CAM_EXAM_WIDE = (() => {
  const p = new THREE.Vector3(...(EXAM.camPos as unknown as [number, number, number]))
  const l = new THREE.Vector3(...(EXAM.camLook as unknown as [number, number, number]))
  const q = l.clone().add(p.clone().sub(l).multiplyScalar(2.1))
  return { pos: [q.x, q.y, q.z] as const, look: EXAM.camLook, fov: 52 }
})()

const gltfLoader = new GLTFLoader(manager)
const gltfCache = new Map<string, Promise<THREE.Group>>()
function loadProp(asset: string): Promise<THREE.Group> {
  let p = gltfCache.get(asset)
  if (!p) {
    p = new Promise((res, rej) =>
      gltfLoader.load(`/models/${asset}/${asset}.gltf`, (g) => res(g.scene), undefined, rej),
    )
    gltfCache.set(asset, p)
  }
  return p
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, pos?: readonly number[], rot?: readonly number[]) {
  const o = new THREE.Mesh(g, m)
  if (pos) o.position.set(pos[0], pos[1], pos[2])
  if (rot) o.rotation.set(rot[0], rot[1], rot[2])
  o.castShadow = true
  o.receiveShadow = true
  return o
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const cyl = (rt: number, rb: number, h: number, s: number) => new THREE.CylinderGeometry(rt, rb, h, s)
const plane = (w: number, h: number) => new THREE.PlaneGeometry(w, h)

/* ══════════════════════════════════════════════════════════════════════
   캔버스 그림 (해부도·시력표·바이탈 화면) — 두 모드가 공유한다
   ══════════════════════════════════════════════════════════════════════ */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

const _poster: Record<string, THREE.CanvasTexture> = {}
function posterTex(kind: 'organs' | 'skeleton'): THREE.CanvasTexture {
  if (_poster[kind]) return _poster[kind]
  const W = 384, H = 576
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#f6efe0'; ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#c9b88f'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, W - 16, H - 16)
  ctx.fillStyle = '#33524a'; ctx.fillRect(16, 16, W - 32, 52)
  ctx.fillStyle = '#f6efe0'; ctx.font = `bold 26px "Helvetica Neue", Arial`
  ctx.textAlign = 'center'
  ctx.fillText(kind === 'organs' ? 'HUMAN ANATOMY' : 'SKELETAL SYSTEM', W / 2, 52)
  // 몸통 실루엣
  ctx.fillStyle = kind === 'organs' ? '#e8cdb6' : '#dfe4e8'
  ctx.beginPath(); ctx.ellipse(W / 2, 150, 40, 46, 0, 0, Math.PI * 2); ctx.fill()
  roundRect(ctx, W / 2 - 62, 196, 124, 200, 26); ctx.fill()
  roundRect(ctx, W / 2 - 88, 200, 26, 160, 13); ctx.fill()
  roundRect(ctx, W / 2 + 62, 200, 26, 160, 13); ctx.fill()
  roundRect(ctx, W / 2 - 52, 392, 44, 150, 20); ctx.fill()
  roundRect(ctx, W / 2 + 8, 392, 44, 150, 20); ctx.fill()
  if (kind === 'organs') {
    ctx.fillStyle = '#b5443c'; ctx.beginPath(); ctx.ellipse(W / 2 - 10, 250, 22, 26, 0.3, 0, 7); ctx.fill()
    ctx.fillStyle = '#d98d8d'
    ctx.beginPath(); ctx.ellipse(W / 2 - 32, 252, 20, 34, 0, 0, 7); ctx.fill()
    ctx.beginPath(); ctx.ellipse(W / 2 + 32, 252, 20, 34, 0, 0, 7); ctx.fill()
    ctx.fillStyle = '#8a5f33'; ctx.beginPath(); ctx.ellipse(W / 2 - 26, 305, 34, 22, 0, 0, 7); ctx.fill()
    ctx.fillStyle = '#c9a25c'; ctx.beginPath(); ctx.ellipse(W / 2 + 8, 335, 40, 26, 0, 0, 7); ctx.fill()
  } else {
    ctx.strokeStyle = '#9aa6ae'; ctx.lineWidth = 5
    for (let i = 0; i < 8; i++) {
      const y = 214 + i * 20
      ctx.beginPath(); ctx.moveTo(W / 2 - 46, y); ctx.quadraticCurveTo(W / 2, y + 12, W / 2 + 46, y); ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(W / 2, 200); ctx.lineTo(W / 2, 396); ctx.stroke()
  }
  ctx.strokeStyle = '#6a7c86'; ctx.lineWidth = 1.5
  for (let i = 0; i < 5; i++) {
    const y = 240 + i * 42
    ctx.beginPath(); ctx.moveTo(W / 2 + 70, y); ctx.lineTo(W - 34, y); ctx.stroke()
    ctx.fillStyle = '#5b6a74'; ctx.font = '13px Arial'; ctx.textAlign = 'right'
    ctx.fillText(['CORTEX', 'PLEURA', 'HEPAR', 'RENES', 'PELVIS'][i], W - 36, y - 5)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  _poster[kind] = t
  return t
}

let _vitals: THREE.CanvasTexture | null = null
function vitalsTex(): THREE.CanvasTexture {
  if (_vitals) return _vitals
  const W = 512, H = 384
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#060f0a'; ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(40,100,65,0.35)'; ctx.lineWidth = 1
  for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
  ctx.font = '700 13px Arial'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'
  ctx.fillStyle = '#3dff7a'; ctx.fillText('ECG II', 10, 6)
  ctx.fillStyle = '#39d9ff'; ctx.fillText('SpO2', 10, 114)
  ctx.fillStyle = '#f5d45a'; ctx.fillText('RESP', 10, 218)
  ctx.strokeStyle = '#3dff7a'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath()
  const ecgY = 62
  ctx.moveTo(0, ecgY)
  for (let bx = 0; bx < W; bx += 96) {
    ctx.lineTo(bx, ecgY)
    ctx.lineTo(bx + 8, ecgY); ctx.lineTo(bx + 13, ecgY - 8); ctx.lineTo(bx + 18, ecgY + 5)
    ctx.lineTo(bx + 22, ecgY - 52); ctx.lineTo(bx + 27, ecgY + 22); ctx.lineTo(bx + 33, ecgY - 5); ctx.lineTo(bx + 40, ecgY)
  }
  ctx.stroke()
  ctx.strokeStyle = '#39d9ff'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 158)
  for (let xx = 0; xx <= W; xx += 3) ctx.lineTo(xx, 158 - Math.abs(Math.sin(xx * 0.055)) * 32)
  ctx.stroke()
  ctx.strokeStyle = '#f5d45a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(0, 258)
  for (let xx = 0; xx <= W; xx += 3) ctx.lineTo(xx, 258 - Math.sin(xx * 0.018) * 20)
  ctx.stroke()
  ctx.fillStyle = 'rgba(0,0,0,0.38)'; roundRect(ctx, W - 124, 4, 120, H - 8, 6); ctx.fill()
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#3dff7a'; ctx.font = 'bold 48px Arial'; ctx.fillText('88', W - 8, 60)
  ctx.font = '700 12px Arial'; ctx.fillText('HR bpm', W - 8, 78)
  ctx.fillStyle = '#39d9ff'; ctx.font = 'bold 42px Arial'; ctx.fillText('98', W - 8, 158)
  ctx.font = '700 12px Arial'; ctx.fillText('SpO2 %', W - 8, 175)
  ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 28px Arial'; ctx.fillText('120/80', W - 8, 245)
  ctx.font = '700 12px Arial'; ctx.fillText('NIBP mmHg', W - 8, 261)
  ctx.fillStyle = '#f5d45a'; ctx.font = 'bold 32px Arial'; ctx.fillText('16', W - 8, 328)
  ctx.font = '700 12px Arial'; ctx.fillText('RESP /min', W - 8, 344)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  _vitals = t
  return t
}

let _emr: THREE.CanvasTexture | null = null
function emrTex(): THREE.CanvasTexture {
  if (_emr) return _emr
  const W = 512, H = 320
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#e9efe6'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#2f5a55'; ctx.fillRect(0, 0, W, 34)
  ctx.fillStyle = '#eaf2ea'; ctx.font = 'bold 17px Arial'; ctx.fillText('EMR  |  외래 진료', 12, 24)
  ctx.fillStyle = '#ffffff'; roundRect(ctx, 10, 44, W - 20, H - 56, 6); ctx.fill()
  ctx.fillStyle = '#7d8a86'
  for (let i = 0; i < 11; i++) ctx.fillRect(24, 62 + i * 20, (i % 3 === 0 ? 300 : 420) - (i % 2) * 60, 7)
  ctx.fillStyle = '#c3d6cf'; ctx.fillRect(24, 62, 120, 7)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  _emr = t
  return t
}

/* ══════════════════════════════════════════════════════════════════════
   방 셸 (ClinicScene RoomShell)
   ══════════════════════════════════════════════════════════════════════ */
function buildRoomShell(L: MatLib): THREE.Group {
  const g = new THREE.Group()
  const { w, h, backZ, frontZ } = ROOM
  const hx = w / 2
  const depth = frontZ - backZ
  const cz = (frontZ + backZ) / 2

  // 바닥 / 천장
  g.add(mesh(plane(w, depth), L.floor(), [0, 0, cz], [-Math.PI / 2, 0, 0]))
  g.add(mesh(plane(w, depth), L.ceiling(), [0, h, cz], [Math.PI / 2, 0, 0]))

  // 좌측 벽
  g.add(mesh(plane(depth, h), L.wall(depth, h), [-hx, h / 2, cz], [0, Math.PI / 2, 0]))
  g.add(mesh(plane(depth, 1.2), L.wainscot(depth, 1.2), [-hx + 0.01, 0.6, cz], [0, Math.PI / 2, 0]))
  g.add(mesh(box(0.06, 0.1, depth), L.skirt(), [-hx + 0.03, 0.05, cz]))

  // 우측 벽 + 창
  g.add(mesh(plane(depth, h), L.wall(depth, h), [hx, h / 2, cz], [0, -Math.PI / 2, 0]))
  g.add(mesh(plane(depth, 1.2), L.wainscot(depth, 1.2), [hx - 0.01, 0.6, cz], [0, -Math.PI / 2, 0]))
  g.add(mesh(box(0.06, 0.1, depth), L.skirt(), [hx - 0.03, 0.05, cz]))
  const win = new THREE.Group(); win.position.set(hx - 0.06, 1.65, -0.9); g.add(win)
  win.add(mesh(plane(1.7, 1.1), L.windowGlass(), [0, 0, 0], [0, -Math.PI / 2, 0]))
  win.add(buildBlinds(L, [0, 0.18, 0.03], [0, -Math.PI / 2, 0], 1.62, 0.74))
  const wp = L.whitePaint()
  win.add(mesh(box(1.84, 0.06, 0.04), wp, [0, 0, 0], [0, -Math.PI / 2, 0]))
  win.add(mesh(box(1.84, 0.06, 0.04), wp, [0, 0.55, 0], [0, -Math.PI / 2, 0]))
  win.add(mesh(box(1.84, 0.06, 0.04), wp, [0, -0.55, 0], [0, -Math.PI / 2, 0]))
  win.add(mesh(box(0.04, 1.16, 0.06), wp, [0, 0, 0]))

  // 앞쪽 벽 (의사 등 뒤)
  g.add(mesh(plane(w, h), L.wall(w, h), [0, h / 2, frontZ], [0, Math.PI, 0]))

  // 뒷벽 (문 있는 벽)
  const leftPanelW = DOOR_X - DOOR_W / 2 + hx
  const rightPanelW = hx - (DOOR_X + DOOR_W / 2)
  g.add(mesh(plane(leftPanelW, h), L.wall(leftPanelW, h), [-hx + leftPanelW / 2, h / 2, backZ]))
  g.add(mesh(plane(rightPanelW, h), L.wall(rightPanelW, h), [hx - rightPanelW / 2, h / 2, backZ]))
  g.add(mesh(plane(DOOR_W, h - DOOR_H), L.wall(DOOR_W, h - DOOR_H, DOOR_H), [DOOR_X, DOOR_H + (h - DOOR_H) / 2, backZ]))
  g.add(mesh(plane(leftPanelW, 1.2), L.wainscot(leftPanelW, 1.2), [-hx + leftPanelW / 2, 0.6, backZ + 0.01]))
  g.add(mesh(plane(rightPanelW, 1.2), L.wainscot(rightPanelW, 1.2), [hx - rightPanelW / 2, 0.6, backZ + 0.01]))
  const wp2 = L.whitePaint()
  g.add(mesh(box(0.08, DOOR_H + 0.1, 0.12), wp2, [DOOR_X - DOOR_W / 2 - 0.04, DOOR_H / 2, backZ + 0.02]))
  g.add(mesh(box(0.08, DOOR_H + 0.1, 0.12), wp2, [DOOR_X + DOOR_W / 2 + 0.04, DOOR_H / 2, backZ + 0.02]))
  g.add(mesh(box(DOOR_W + 0.16, 0.08, 0.12), wp2, [DOOR_X, DOOR_H + 0.05, backZ + 0.02]))
  g.add(mesh(plane(DOOR_W, DOOR_H), L.corridor(), [DOOR_X, DOOR_H / 2, backZ - 0.5]))
  const door = new THREE.Group(); door.position.set(DOOR_X - DOOR_W / 2, 0, backZ); g.add(door)
  door.add(mesh(box(DOOR_W, DOOR_H, 0.05), L.door(), [DOOR_W / 2, DOOR_H / 2, 0.04]))
  door.add(mesh(cyl(0.02, 0.02, 0.12, 10), L.stainless('#9aa0a4'), [DOOR_W - 0.12, 1.05, 0.09]))
  return g
}

function buildBlinds(L: MatLib, pos: readonly number[], rot: readonly number[], width: number, height: number) {
  const g = new THREE.Group()
  g.position.set(pos[0], pos[1], pos[2]); g.rotation.set(rot[0], rot[1], rot[2])
  const slats = 16
  const gap = height / slats
  const slatMat = L.blindSlat()
  const slatGeo = box(width, gap * 0.82, 0.012)
  for (let i = 0; i < slats; i++) g.add(mesh(slatGeo, slatMat, [0, height / 2 - gap * (i + 0.5), 0], [0.5, 0, 0]))
  g.add(mesh(cyl(0.004, 0.004, height, 6), L.cord(), [width / 2 - 0.05, 0, 0.02]))
  return g
}

/* ── 천장 형광등 패널 ── */
function buildCeilingPanel(L: MatLib, x: number, z: number) {
  const g = new THREE.Group(); g.position.set(x, ROOM.h - 0.02, z)
  g.add(mesh(box(1.3, 0.06, 0.7), L.panelFrame()))
  g.add(mesh(box(1.18, 0.02, 0.58), L.panelGlow(), [0, -0.035, 0]))
  const pl = new THREE.PointLight(0xffe9cc, 5, 5.5, 2)
  pl.position.set(0, -0.4, 0)
  g.add(pl)
  return g
}

/* ══════════════════════════════════════════════════════════════════════
   책상 주변 (ClinicScene Desk)
   ══════════════════════════════════════════════════════════════════════ */
function buildDesk(L: MatLib): THREE.Group {
  const g = new THREE.Group(); g.position.set(-2.05, 0, 0.5)

  void loadProp('metal_office_desk').then((s) => {
    const c = s.clone(true)
    c.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
    L.tuneGLTF(c)
    c.position.set(0, 0, -0.08); c.scale.set(0.92, 1.06, 0.88)
    g.add(c)
  })

  // 차트 클립보드
  const cb = new THREE.Group(); cb.position.set(0.66, 0.84, 0.1); cb.rotation.set(-0.1, -0.3, 0); cb.scale.setScalar(0.72); g.add(cb)
  cb.add(mesh(box(0.24, 0.014, 0.32), L.plastic('#3a7d7b')))
  cb.add(mesh(box(0.2, 0.006, 0.26), L.paper('#f7f6f1'), [0, 0.012, 0.015]))
  const lineMat = L.paper('#c7d0d2')
  for (const z of [0.07, 0.04, 0.01, -0.02, -0.05]) cb.add(mesh(box(0.15, 0.001, 0.006), lineMat, [0, 0.016, z]))
  cb.add(mesh(box(0.1, 0.014, 0.03), L.stainless('#aeb4b8'), [0, 0.018, -0.14]))
  cb.add(mesh(box(0.06, 0.012, 0.012), L.stainless('#c2c8cc'), [0, 0.026, -0.137]))

  // EMR 모니터
  const mon = new THREE.Group(); mon.position.set(-0.35, 0.83, -0.28); mon.rotation.y = 0.45; g.add(mon)
  mon.add(mesh(box(0.66, 0.42, 0.04), L.paintedMetal('#23262a'), [0, 0.42, 0]))
  mon.add(mesh(plane(0.60, 0.36), L.screen(emrTex(), '#ffffff', '#ffffff', 0.85), [0, 0.42, 0.022]))
  mon.add(mesh(cyl(0.022, 0.03, 0.18, 10), L.paintedMetal('#2a2e31'), [0, 0.115, 0]))
  mon.add(mesh(box(0.30, 0.025, 0.18), L.paintedMetal('#2a2e31'), [0, 0.02, 0.02]))

  // 손소독 펌프 (HygieneRig 대체 — 단순 보틀. 형태 수준은 동일)
  const san = new THREE.Group(); san.position.set(0.16, 0.84, -0.34); g.add(san)
  san.add(mesh(box(0.075, 0.19, 0.055), L.glassy('#dfe9ee', 0.72), [0, 0.095, 0]))
  san.add(mesh(cyl(0.016, 0.016, 0.05, 12), L.plastic('#3f4a52'), [0, 0.212, 0]))
  san.add(mesh(box(0.06, 0.012, 0.03), L.plastic('#3f4a52'), [0.028, 0.228, 0]))

  // 키보드
  const kb = new THREE.Group(); kb.position.set(-0.3, 0.83, 0.02); kb.rotation.y = 0.45; g.add(kb)
  kb.add(mesh(box(0.44, 0.016, 0.15), L.plastic('#e4e7ea')))
  const keyMat = L.plastic('#34383c')
  for (const z of [-0.045, -0.022, 0.001, 0.024]) kb.add(mesh(box(0.4, 0.008, 0.017), keyMat, [0, 0.014, z - 0.012]))
  kb.add(mesh(box(0.2, 0.008, 0.016), keyMat, [0, 0.014, 0.05]))

  // 도구 컵 1 — 펜라이트·검이경·신경망치
  const cup = new THREE.Group(); cup.position.set(0.34, 0.84, -0.33); g.add(cup)
  cup.add(mesh(cyl(0.045, 0.04, 0.13, 24), L.stainless('#c2c7cc'), [0, 0.065, 0]))
  cup.add(mesh(new THREE.TorusGeometry(0.044, 0.0045, 8, 24), L.stainless('#aeb4b8'), [0, 0.13, 0], [Math.PI / 2, 0, 0]))
  cup.add(mesh(cyl(0.039, 0.039, 0.035, 20), L.plastic('#2a2e31'), [0, 0.115, 0]))
  const pen = new THREE.Group(); pen.position.set(-0.018, 0, 0.012); pen.rotation.set(0.08, 0, 0.05); cup.add(pen)
  pen.add(mesh(cyl(0.008, 0.008, 0.24, 10), L.paintedMetal('#1e2124'), [0, 0.18, 0]))
  pen.add(mesh(cyl(0.009, 0.009, 0.018, 10), L.screen(null, '#fffbe0', '#fff3b0', 0.7), [0, 0.305, 0]))
  const oto = new THREE.Group(); oto.position.set(0.008, 0, -0.016); oto.rotation.set(-0.05, 0, -0.02); cup.add(oto)
  oto.add(mesh(cyl(0.013, 0.013, 0.18, 14), L.paintedMetal('#2a2e31'), [0, 0.115, 0]))
  const otoHead = new THREE.Group(); otoHead.position.set(0, 0.21, 0); otoHead.rotation.x = 0.5; oto.add(otoHead)
  otoHead.add(mesh(cyl(0.016, 0.016, 0.05, 14), L.stainless('#cfd4d7')))
  otoHead.add(mesh(new THREE.ConeGeometry(0.012, 0.04, 16), L.plastic('#1a1e22'), [0, 0.045, 0]))
  const ham = new THREE.Group(); ham.position.set(0.022, 0, 0.014); ham.rotation.set(0.05, 0, 0.13); cup.add(ham)
  ham.add(mesh(cyl(0.005, 0.005, 0.26, 10), L.stainless('#b8bdc2'), [0, 0.15, 0]))
  const head = mesh(cyl(0.026, 0.026, 0.055, 3), L.rubber('#9b2f29'), [0, 0.29, 0], [0, 0, Math.PI / 2])
  head.scale.set(1, 1, 0.5); ham.add(head)

  // 도구 컵 2 — 압설자 + 면봉
  const cup2 = new THREE.Group(); cup2.position.set(0.52, 0.84, -0.33); g.add(cup2)
  cup2.add(mesh(cyl(0.05, 0.045, 0.11, 24), L.stainless('#d6dadd'), [0, 0.055, 0]))
  cup2.add(mesh(new THREE.TorusGeometry(0.049, 0.0045, 8, 24), L.stainless('#c2c7cc'), [0, 0.11, 0], [Math.PI / 2, 0, 0]))
  cup2.add(mesh(cyl(0.044, 0.044, 0.03, 20), L.plastic('#2a2e31'), [0, 0.097, 0]))
  const tdMat = L.wood('#d8b98c')
  for (const x of [-0.02, 0.0, 0.022]) {
    const t = new THREE.Group(); t.position.set(x, 0, -0.012); t.rotation.set(0.05, 0, x * 1.5); cup2.add(t)
    t.add(mesh(box(0.016, 0.17, 0.004), tdMat, [0, 0.16, 0]))
    const tip = mesh(cyl(0.008, 0.008, 0.016, 12), tdMat, [0, 0.245, 0]); tip.scale.set(1, 0.55, 0.28); t.add(tip)
  }
  const stickMat = L.paper('#eceae3'); const cotMat = L.paper('#fbfbf6')
  for (const x of [-0.02, 0.0, 0.02]) {
    const t = new THREE.Group(); t.position.set(x, 0, 0.02); t.rotation.set(-0.04, 0, x * 1.6); cup2.add(t)
    t.add(mesh(cyl(0.0022, 0.0022, 0.18, 6), stickMat, [0, 0.14, 0]))
    const cot = mesh(cyl(0.004, 0.004, 0.014, 8), cotMat, [0, 0.235, 0]); cot.scale.set(1, 1.5, 1); t.add(cot)
  }

  // 책상 청진기 (감긴 튜브 + 크롬 체스트피스)
  const st = new THREE.Group(); st.position.set(0.13, 0.835, -0.18); st.rotation.y = 0.4; st.scale.setScalar(0.72); g.add(st)
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    const a = t * Math.PI * 2.6
    const r = 0.16 - t * 0.05
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0.012 + Math.sin(t * Math.PI) * 0.014, Math.sin(a) * r * 0.62))
  }
  st.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.011, 8, false), L.rubber('#20262c')))
  st.add(mesh(cyl(0.042, 0.042, 0.016, 22), L.stainless('#cfd4d7'), [0.16, 0.02, 0]))
  st.add(mesh(new THREE.TorusGeometry(0.042, 0.005, 8, 24), L.stainless('#aeb4b8'), [0.16, 0.029, 0], [Math.PI / 2, 0, 0]))
  for (const s of [-1, 1]) st.add(mesh(cyl(0.007, 0.007, 0.07, 8), L.stainless('#c8ced3'), [-0.13, 0.03, s * 0.05], [Math.PI / 2.3, 0, 0]))

  // 책상 스탠드 불빛 (본 씬 pointLight)
  const dl = new THREE.PointLight(0xffc97d, 1.1, 2.2, 2)
  dl.position.set(-0.85, 1.15, -0.2)
  g.add(dl)
  return g
}

/* ══════════════════════════════════════════════════════════════════════
   나머지 소품
   ══════════════════════════════════════════════════════════════════════ */
function buildStool(L: MatLib, pos: readonly number[]) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2])
  g.add(mesh(cyl(0.21, 0.21, 0.08, 20), L.vinyl('#2f3437'), [0, 0.5, 0]))
  g.add(mesh(cyl(0.03, 0.03, 0.36, 10), L.stainless('#9aa0a4'), [0, 0.32, 0]))
  const legMat = L.plastic('#3a3f42')
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    g.add(mesh(box(0.22, 0.04, 0.04), legMat, [Math.cos(a) * 0.18, 0.06, Math.sin(a) * 0.18], [0, -a, 0]))
  }
  return g
}

function buildExamBed(L: MatLib, pos: readonly number[], rotY: number) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.y = rotY
  // 매트: baseline은 '포근한 베이지 쿠션'(단순 색), mat은 같은 색을 비닐 레자 파라미터로
  g.add(mesh(box(0.72, 0.12, 1.9), L.vinyl('#c9b48f'), [0, 0.62, 0]))
  g.add(mesh(box(0.66, 0.012, 1.5), L.paper('#e9e1d0'), [0, 0.685, 0.1]))
  g.add(mesh(box(0.66, 0.56, 1.7), L.paintedMetal('#d8c4a0'), [0, 0.28, 0]))
  g.add(mesh(cyl(0.06, 0.06, 0.6, 16), L.paper('#fbfbf6'), [0, 0.7, 0.97], [0, 0, Math.PI / 2]))
  return g
}

function buildCurtain(L: MatLib, pos: readonly number[], rotY: number, length: number) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.y = rotY
  const railH = 2.0
  const panels = 7
  g.add(mesh(cyl(0.018, 0.018, length, 10), L.stainless('#b8bec2'), [0, railH, 0], [0, 0, Math.PI / 2]))
  const a = L.fabric('#cdd8c4'); const b = L.fabric('#d8e0cf')
  const geo = box(length / panels - 0.01, railH - 0.1, 0.03)
  for (let i = 0; i < panels; i++) {
    const x = -length / 2 + (length / panels) * (i + 0.5)
    g.add(mesh(geo, i % 2 === 0 ? a : b, [x, railH / 2 - 0.05, i % 2 === 0 ? 0.05 : -0.05]))
  }
  return g
}

function buildCasterBase(L: MatLib, r: number) {
  const g = new THREE.Group()
  const armMat = L.stainless('#9aa0a4'); const whMat = L.rubber('#2a2e31')
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const sub = new THREE.Group(); sub.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r); g.add(sub)
    sub.add(mesh(box(r, 0.035, 0.04), armMat, [0, 0, 0], [0, -a, 0]))
    sub.add(mesh(cyl(0.025, 0.025, 0.03, 10), whMat, [Math.cos(a) * r * 0.5, -0.015, Math.sin(a) * r * 0.5]))
  }
  return g
}

function buildIVPole(L: MatLib, pos: readonly number[]) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2])
  g.add(buildCasterBase(L, 0.22))
  g.add(mesh(cyl(0.018, 0.018, 1.9, 12), L.stainless('#c2c7cc'), [0, 0.95, 0]))
  g.add(mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 16, Math.PI), L.stainless('#c2c7cc'), [0, 1.9, 0], [0, 0, Math.PI / 2]))
  g.add(mesh(box(0.13, 0.24, 0.04), L.glassy('#dff0ff', 0.55), [0.08, 1.62, 0]))
  g.add(mesh(cyl(0.012, 0.012, 0.06, 8), L.glassy('#eaf4ff', 0.7), [0.08, 1.44, 0]))
  return g
}

function buildVitalsCart(L: MatLib, pos: readonly number[], rotY: number) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.y = rotY
  const white = '#eef1f3', dark = '#2a2e31'
  const tire = L.rubber('#1c1f22'); const hub = L.stainless('#9aa0a4')
  for (const [x, z] of [[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]]) {
    const s = new THREE.Group(); s.position.set(x, 0.09, z); g.add(s)
    s.add(mesh(cyl(0.09, 0.09, 0.06, 18), tire, [0, 0, 0], [0, 0, Math.PI / 2]))
    s.add(mesh(cyl(0.04, 0.04, 0.07, 12), hub))
  }
  g.add(mesh(box(0.5, 0.06, 0.62), L.paintedMetal(dark), [0, 0.18, 0]))
  g.add(mesh(box(0.46, 0.64, 0.46), L.paintedMetal(white), [0, 0.52, -0.02]))
  g.add(mesh(box(0.47, 0.12, 0.47), L.paintedMetal(dark), [0, 0.24, -0.02]))
  const holder = L.plastic('#cfd6da'); const probe = L.plastic('#e9edf0')
  for (const x of [-0.15, -0.05, 0.05, 0.15]) {
    const s = new THREE.Group(); s.position.set(x, 0.6, 0.235); g.add(s)
    s.add(mesh(box(0.07, 0.14, 0.04), holder))
    s.add(mesh(new THREE.CapsuleGeometry(0.022, 0.08, 4, 8), probe, [0, 0.02, 0.03]))
  }
  const cons = new THREE.Group(); cons.position.set(0, 0.88, 0.16); cons.rotation.x = 0.16; g.add(cons)
  cons.add(mesh(box(0.44, 0.07, 0.34), L.plastic('#d7dde1')))
  cons.add(mesh(plane(0.32, 0.14), L.screen(null, '#0a2230', '#37b6d6', 0.6), [0, 0.04, -0.08], [-Math.PI / 2, 0, 0]))
  cons.add(mesh(new THREE.SphereGeometry(0.028, 16, 12), L.plastic('#3a8fd0'), [0, 0.045, 0.08]))
  const btn = L.plastic('#aeb4b8')
  for (const x of [-0.12, -0.06, 0.06, 0.12]) cons.add(mesh(box(0.03, 0.012, 0.02), btn, [x, 0.04, 0.13]))
  g.add(mesh(cyl(0.028, 0.028, 0.5, 12), L.stainless('#b8bdc2'), [0, 1.15, -0.1]))
  const mon = new THREE.Group(); mon.position.set(0, 1.5, -0.02); mon.rotation.x = 0.05; g.add(mon)
  mon.add(mesh(box(0.64, 0.42, 0.05), L.paintedMetal(dark)))
  mon.add(mesh(plane(0.58, 0.34), L.screen(vitalsTex(), '#ffffff', '#ffffff', 1.4), [0, 0.01, 0.027]))
  return g
}

function buildBookRow(L: MatLib, pos: readonly number[], rotY: number, count: number, width: number) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.y = rotY
  const colors = ['#2f4a5e', '#3a5247', '#6e3a3a', '#d8d2c4', '#445566', '#7a6a4a', '#2e3e4a', '#e6e0d2']
  const bw = width / count
  for (let i = 0; i < count; i++) {
    const h = 0.2 + ((i * 37) % 9) * 0.012
    g.add(mesh(box(bw * 0.86, h, 0.16), L.paper(colors[i % colors.length]), [-width / 2 + bw * (i + 0.5), h / 2, 0]))
  }
  return g
}

function buildPoster(L: MatLib, pos: readonly number[], rotY: number, size: readonly number[], kind: 'organs' | 'skeleton', frame: string) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.y = rotY
  g.add(mesh(box(size[0] + 0.04, size[1] + 0.04, 0.02), L.wood(frame)))
  const m = L.paper('#ffffff') as THREE.MeshStandardMaterial
  m.map = posterTex(kind)
  g.add(mesh(plane(size[0], size[1]), m, [0, 0, 0.013]))
  return g
}

function buildCertificate(L: MatLib, pos: readonly number[], size: readonly number[]) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2])
  g.add(mesh(box(size[0] + 0.04, size[1] + 0.04, 0.025), L.paintedMetal('#9c7b46')))
  g.add(mesh(plane(size[0] - 0.02, size[1] - 0.02), L.paper('#f7f0df'), [0, 0, 0.014]))
  g.add(mesh(plane(size[0] - 0.1, size[1] - 0.14), L.paper('#efe2c2'), [0, 0.02, 0.016]))
  const tl = L.paper('#8a7a55')
  ;[0.12, 0.06, 0.0, -0.06, -0.12].forEach((y, i) =>
    g.add(mesh(plane((size[0] - 0.18) * (i === 0 ? 0.55 : 0.85), 0.012), tl, [0, y + 0.02, 0.017])))
  g.add(mesh(new THREE.CircleGeometry(0.035, 16), L.paper('#a6402f'), [size[0] * 0.22, -size[1] * 0.28, 0.018]))
  return g
}

function buildXray(L: MatLib, pos: readonly number[], rotY: number, size: readonly number[]) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.y = rotY
  g.add(mesh(box(size[0] + 0.05, size[1] + 0.05, 0.05), L.paintedMetal('#3a4149')))
  g.add(mesh(plane(size[0], size[1]), L.screen(null, '#dfe9f2', '#cfe0ee', 0.55), [0, 0, 0.027]))
  return g
}

function buildMedStation(L: MatLib, pos: readonly number[]) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2])
  g.add(mesh(box(0.78, 0.5, 0.03), L.stainless('#cfd6da')))
  const glove = L.paper('#f4f4ef')
  ;['#3a6ea5', '#4a4f54', '#5aa06e'].forEach((c, i) => {
    const s = new THREE.Group(); s.position.set(-0.26 + i * 0.26, 0.06, 0.06); g.add(s)
    s.add(mesh(box(0.2, 0.26, 0.09), L.paper(c)))
    s.add(mesh(box(0.1, 0.05, 0.02), glove, [0, 0.05, 0.05]))
  })
  const sh = new THREE.Group(); sh.position.set(-0.28, -0.12, 0.07); g.add(sh)
  sh.add(mesh(box(0.16, 0.2, 0.12), L.plastic('#e4b521')))
  sh.add(mesh(box(0.16, 0.03, 0.12), L.plastic('#c2962f'), [0, 0.11, 0]))
  return g
}

function buildWallSteth(L: MatLib, pos: readonly number[], rotY: number) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.y = rotY
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const a = Math.PI * (0.15 + t * 1.7)
    pts.push(new THREE.Vector3(Math.cos(a) * 0.12, -t * 0.34, Math.sin(a) * 0.02))
  }
  g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 8, false), L.rubber('#2f3a44')))
  const last = pts[pts.length - 1]
  g.add(mesh(cyl(0.04, 0.04, 0.02, 18), L.stainless('#b8bdc2'), [last.x, last.y - 0.02, 0.01]))
  return g
}

/* ══════════════════════════════════════════════════════════════════════
   조립
   ══════════════════════════════════════════════════════════════════════ */
export function buildScene(L: MatLib, examMode: boolean): THREE.Group {
  const root = new THREE.Group()
  root.add(buildRoomShell(L))
  for (const [x, z] of [[-1.3, -1.8], [1.3, -1.8], [-1.3, -3.8], [1.3, -3.8]]) {
    root.add(buildCeilingPanel(L, x, z))
  }
  root.add(buildDesk(L))
  root.add(buildStool(L, SEAT.pos))
  root.add(buildExamBed(L, [1.95, 0, -3.5], -Math.PI / 2))
  if (!examMode) root.add(buildCurtain(L, [2.4, 0, -2.3], 0, 2.0))
  root.add(buildCurtain(L, [0.9, 0, -3.15], Math.PI / 2, 1.7))

  void loadProp('wooden_bookshelf_worn').then((s) => {
    const c = s.clone(true)
    c.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
    L.tuneGLTF(c)
    c.position.set(-2.9, 0, -3.3); c.rotation.y = Math.PI / 2; c.scale.setScalar(1.5)
    root.add(c)
  })
  void loadProp('potted_plant_01').then((s) => {
    const c = s.clone(true)
    c.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
    L.tuneGLTF(c)
    c.position.set(-2.85, 0, ROOM.backZ + 0.5); c.scale.setScalar(1.2)
    root.add(c)
  })
  void loadProp('wall_clock').then((s) => {
    const c = s.clone(true)
    c.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
    L.tuneGLTF(c)
    c.position.set(2.45, 2.45, ROOM.backZ + 0.08)
    root.add(c)
  })

  root.add(buildBookRow(L, [-2.78, 1.42, -3.3], Math.PI / 2, 7, 0.9))
  root.add(buildBookRow(L, [-2.78, 1.02, -3.3], Math.PI / 2, 8, 0.92))
  root.add(buildBookRow(L, [-2.78, 0.62, -3.3], Math.PI / 2, 6, 0.88))
  root.add(buildBookRow(L, [-2.78, 1.42, -3.95], Math.PI / 2, 7, 0.86))
  root.add(buildBookRow(L, [-2.78, 1.02, -3.95], Math.PI / 2, 8, 0.9))

  root.add(buildPoster(L, [0.62, 1.55, ROOM.backZ + 0.05], 0, [0.6, 0.9], 'organs', '#8a6a48'))
  root.add(buildCertificate(L, [0.05, 2.22, ROOM.backZ + 0.05], [0.3, 0.4]))
  root.add(buildMedStation(L, [1.6, 1.6, ROOM.backZ + 0.05]))
  root.add(buildWallSteth(L, [-3.12, 2.05, -0.7], Math.PI / 2))
  root.add(buildXray(L, [-3.13, 1.6, -1.4], Math.PI / 2, [0.6, 0.76]))
  root.add(buildPoster(L, [-3.14, 1.55, -2.2], Math.PI / 2, [0.42, 0.66], 'skeleton', '#46566a'))

  root.add(buildIVPole(L, [2.62, 0, -2.7]))
  root.add(buildVitalsCart(L, [2.05, 0, -1.5], -0.63))
  return root
}

/** 본 씬 Canvas의 조명 세트를 그대로. examMode에 따라 스팟/필이 바뀐다. */
export function buildLights(examMode: boolean): THREE.Group {
  const g = new THREE.Group()
  g.add(new THREE.AmbientLight(0xf7f8fb, 0.12))
  g.add(new THREE.HemisphereLight(0xeef4ff, 0x6a5544, 0.34))

  const d1 = new THREE.DirectionalLight(0xfff2e4, 0.88)
  d1.position.set(4.5, 2.6, -0.9)
  g.add(d1)

  const d2 = new THREE.DirectionalLight(0xf5f7ff, 0.5)
  d2.position.set(1.2, 5, 1.0)
  d2.castShadow = true
  d2.shadow.mapSize.set(2048, 2048)
  d2.shadow.camera.left = -4; d2.shadow.camera.right = 4
  d2.shadow.camera.top = 4; d2.shadow.camera.bottom = -4
  d2.shadow.bias = -0.0004; d2.shadow.normalBias = 0.018
  g.add(d2)

  const sp = new THREE.SpotLight(0xfff0e4, examMode ? 0.62 : 1.9, 5.5, 0.58, 1, 2)
  if (examMode) { sp.position.set(2.2, 2.8, -2.6); sp.target.position.set(1.75, 1.0, -3.5) }
  else { sp.position.set(...(SEAT.keyLightPos as unknown as [number, number, number])); sp.target.position.set(...(SEAT.faceLightTarget as unknown as [number, number, number])) }
  sp.castShadow = true
  sp.shadow.mapSize.set(1024, 1024)
  sp.shadow.bias = -0.0002; sp.shadow.normalBias = 0.012
  g.add(sp); g.add(sp.target)

  const p1 = new THREE.PointLight(0xf5f7ff, examMode ? 0.08 : 0.26, 2.8, 2)
  p1.position.set(...(examMode ? [1.8, 1.8, -2.6] : [-0.25, 1.45, 0.65]) as [number, number, number])
  g.add(p1)

  if (!examMode) {
    const p2 = new THREE.PointLight(0xd8e7ff, 0.42, 2.6, 2)
    p2.position.set(-1.45, 1.85, -0.9)
    g.add(p2)
  }
  return g
}
