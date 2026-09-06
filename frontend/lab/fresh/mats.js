/**
 * 재질 라이브러리 — 진료실에 실제로 존재하는 재질 범주만 만든다.
 *
 * 설계 원칙 (material-quality-spec §2):
 *  - 색이 아니라 **거칠기·금속성**이 재질을 구분한다. 범주를 먼저 정하고 색은 나중에 얹는다.
 *  - 인스턴스를 공유한다. 같은 범주는 같은 머티리얼 객체를 쓴다 → 프로그램 수·드로콜 절감.
 *  - `MeshPhysicalMaterial.anisotropy`는 **쓰지 않는다** (UV 없는 메시에서 탄젠트 NaN → 블랙아웃 전례).
 *    텍스처 필터링 anisotropy(`Texture.anisotropy`)는 별개이고 본 씬에서도 이미 쓰고 있어 그대로 쓴다.
 */
import * as THREE from 'three'

const TEX = new THREE.TextureLoader()
const cache = new Map()

/** color/normal/rough 세트를 로드하고 repeat까지 잡아 준다 (인스턴스 공유). */
export function pbr(base, repeat, { color = true, srgbColor = true, suffix = null } = {}) {
  const key = `${base}|${repeat.join(',')}|${color}`
  if (cache.has(key)) return cache.get(key)
  const s = suffix ?? { color: '_color.jpg', normal: '_normal.jpg', rough: '_rough.jpg' }
  const out = {}
  const setup = (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
    t.anisotropy = 8 // 텍스처 필터링. 머티리얼 anisotropy와 무관하다.
    return t
  }
  if (color) {
    out.map = setup(TEX.load(base + s.color))
    if (srgbColor) out.map.colorSpace = THREE.SRGBColorSpace
  }
  out.normalMap = setup(TEX.load(base + s.normal))
  out.roughnessMap = setup(TEX.load(base + s.rough))
  cache.set(key, out)
  return out
}

/* ──────────────────────────────────────────────────────────────
   절차적 텍스처 — 저장소에 없는 재질을 0바이트로 만든다.
   진료실 바닥(병원용 비닐 시트)은 리포의 어떤 텍스처와도 맞지 않아 직접 그린다.
   ────────────────────────────────────────────────────────────── */

/** 병원용 비닐 시트 바닥. 한 캔버스가 실제 3.6m×3.6m를 덮는다고 보고 repeat를 잡는다.
 *  구성: 베이스색 + 미세 반점(스페클) + 1.8m 간격 시트 이음매 + 통행 마모 얼룩(러프니스). */
export function vinylFloorTextures() {
  if (cache.has('vinylfloor')) return cache.get('vinylfloor')
  const S = 1024
  const PATCH_M = 3.6 // 캔버스 한 장이 덮는 실제 크기(m)

  // ① color
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  // 초록기가 세면 옆의 중성 회색 벽이 보색 대비로 **라벤더처럼 보인다**(1차 시도의 실패).
  // 병원 시트 바닥의 실제 색에 가깝게 아주 옅은 웜그레이로 잡는다.
  g.fillStyle = '#d2d1cc'
  g.fillRect(0, 0, S, S)
  // 스페클 — 진료실 바닥재의 특징. 크기가 다른 점을 두 층으로.
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * S, y = Math.random() * S
    const r = Math.random() < 0.82 ? 0.7 : 1.7
    const v = Math.random()
    g.fillStyle = v < 0.34 ? 'rgba(124,124,120,0.5)'
      : v < 0.68 ? 'rgba(236,235,229,0.55)'
      : 'rgba(172,170,162,0.4)'
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill()
  }
  // 넓은 색 얼룩 — 완전 균일한 면은 즉시 CG로 읽힌다
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 60 + Math.random() * 180
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    const a = 0.035 + Math.random() * 0.03
    grd.addColorStop(0, `rgba(${Math.random() < 0.5 ? '255,254,248' : '154,152,146'},${a})`)
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill()
  }
  // 시트 이음매 — 1.8m 폭 롤이므로 캔버스당 2줄. 아주 옅게.
  const seamPx = S * (1.8 / PATCH_M)
  g.strokeStyle = 'rgba(150,157,152,0.55)'
  g.lineWidth = 1.6
  for (let i = 0; i < PATCH_M / 1.8; i++) {
    g.beginPath(); g.moveTo(i * seamPx, 0); g.lineTo(i * seamPx, S); g.stroke()
  }

  // ② roughness — 통행 마모로 광택이 불균일해야 천장등 반사가 자연스럽게 끊긴다
  const r = document.createElement('canvas')
  r.width = r.height = 512
  const rg = r.getContext('2d')
  rg.fillStyle = '#4d4d4d' // 0.30 — 기본 광택
  rg.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, rad = 30 + Math.random() * 120
    const grd = rg.createRadialGradient(x, y, 0, x, y, rad)
    grd.addColorStop(0, `rgba(255,255,255,${0.05 + Math.random() * 0.14})`) // 마모 → 거칠어짐
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    rg.fillStyle = grd
    rg.beginPath(); rg.arc(x, y, rad, 0, 6.283); rg.fill()
  }

  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  const roughnessMap = new THREE.CanvasTexture(r)
  for (const t of [map, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
  }
  const out = { map, roughnessMap, patchMeters: PATCH_M }
  cache.set('vinylfloor', out)
  return out
}

/** 블라인드 고보(gobo) — 창 스포트라이트가 바닥·벽에 뿌리는 빛 띠.
 *  실제 블라인드 그림자를 쓰면 얇은 슬랫 22장이 섀도맵을 갉아먹는다. 투영 텍스처가 싸고 깨끗하다. */
export function blindGobo() {
  if (cache.has('gobo')) return cache.get('gobo')
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#000'
  g.fillRect(0, 0, S, S)
  // 가장자리는 창틀이므로 어둡게 — 빛 띠가 창 모양으로 잘린다
  const band = S / 11
  for (let i = 0; i < 11; i++) {
    const y = i * band
    const grd = g.createLinearGradient(0, y, 0, y + band)
    grd.addColorStop(0, 'rgba(255,255,255,0)')
    grd.addColorStop(0.42, 'rgba(255,255,255,1)')
    grd.addColorStop(0.62, 'rgba(255,255,255,0.95)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(S * 0.06, y, S * 0.88, band)
  }
  // 창 개구부 밖은 완전 차단
  g.globalCompositeOperation = 'destination-in'
  const vg = g.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S * 0.62)
  vg.addColorStop(0, 'rgba(255,255,255,1)')
  vg.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = vg
  g.fillRect(0, 0, S, S)

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  cache.set('gobo', t)
  return t
}

/** 종이류(차트·포스터·안내문)를 캔버스로 그려 붙인다. draw(ctx, W, H)를 받는다. */
export function paperTexture(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/* ──────────────────────────────────────────────────────────────
   재질 범주 (spec §2 표 그대로)
   ────────────────────────────────────────────────────────────── */
const std = (p) => new THREE.MeshStandardMaterial(p)
const phys = (p) => new THREE.MeshPhysicalMaterial(p)

export const M = {
  /** 스테인리스 — 프레임·손잡이·싱크·기구 */
  steel: std({ color: '#b9bfc2', roughness: 0.28, metalness: 0.9, envMapIntensity: 1.5 }),
  steelDull: std({ color: '#9ea5a8', roughness: 0.42, metalness: 0.85, envMapIntensity: 1.2 }),
  /** 도장 금속 — 캐비닛 몸통·기기 하우징 */
  paintedMetal: std({ color: '#e9ebe8', roughness: 0.45, metalness: 0.35, envMapIntensity: 0.9 }),
  paintedMetalDark: std({ color: '#525a5e', roughness: 0.45, metalness: 0.35, envMapIntensity: 0.9 }),
  /** 의료 플라스틱 — 디스펜서·기기 케이스 */
  plastic: std({ color: '#eef0ed', roughness: 0.55, metalness: 0.0, envMapIntensity: 0.7 }),
  plasticDark: std({ color: '#2b3033', roughness: 0.55, metalness: 0.0, envMapIntensity: 0.6 }),
  /** 비닐 레자 — 진찰대 매트·스툴 시트 */
  vinylPad: std({ color: '#5b7a80', roughness: 0.5, metalness: 0.0, envMapIntensity: 0.85 }),
  /** 천 — 커튼. sheen이 있어야 천으로 보인다 */
  fabric: phys({
    color: '#a9c4bd', roughness: 0.92, metalness: 0.0,
    sheen: 0.55, sheenRoughness: 0.75, sheenColor: new THREE.Color('#dff0ea'),
    side: THREE.DoubleSide, envMapIntensity: 0.7,
  }),
  /** 페인트 벽 */
  wall: null, // room.js에서 텍스처와 함께 생성
  /** 비닐 바닥 */
  floor: null,
  /** 유리 — `transmission`은 쓰지 않는다.
   *  블라인드가 반쯤 내려와 있고 창밖이 과노출된 흰 면이라 굴절이 보일 여지가 없다.
   *  transmission은 별도 렌더 타깃 패스를 요구해 비용만 크다. 낮은 opacity로 충분하다. */
  glass: std({
    color: '#eef4f6', roughness: 0.06, metalness: 0.0,
    transparent: true, opacity: 0.16, envMapIntensity: 1.3, side: THREE.DoubleSide,
  }),
  /** 종이 — 흰색을 그대로 쓰면 형광등 아래에서 255로 클리핑돼 '흰 판때기'가 된다.
   *  실제 종이의 반사율은 0.75~0.85다. 낮춰야 접힌 자국과 주름이 보인다. */
  paper: std({ color: '#d9d5c9', roughness: 0.96, metalness: 0.0, envMapIntensity: 0.35 }),
  /** 라미네이트 상판 */
  laminate: std({ color: '#d8dad4', roughness: 0.38, metalness: 0.0, envMapIntensity: 0.8 }),
  /** 걸레받이/코브 베이스(비닐) */
  cove: std({ color: '#b6bcb7', roughness: 0.55, metalness: 0.0, envMapIntensity: 0.8 }),
  /** 크래시 레일(벽 보호대) */
  crashRail: std({ color: '#8ea3a4', roughness: 0.5, metalness: 0.0, envMapIntensity: 0.8 }),
  /** 발광 — 형광등 디퓨저 */
  diffuser: std({
    color: '#ffffff', emissive: new THREE.Color('#fbfcff'), emissiveIntensity: 1.35,
    roughness: 0.6, metalness: 0,
  }),
  /** 창밖 — 과노출된 바깥 */
  sky: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  /** 고무(청진기 튜브·캐스터) */
  rubber: std({ color: '#26292b', roughness: 0.72, metalness: 0.0, envMapIntensity: 0.4 }),
}

/** 색만 다른 변종이 필요할 때 — 범주 파라미터는 유지한 채 색만 바꾼다. */
export function tint(mat, color, extra = {}) {
  const m = mat.clone()
  m.color = new THREE.Color(color)
  Object.assign(m, extra)
  return m
}
