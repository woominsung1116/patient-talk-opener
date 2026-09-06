/**
 * clinic-lab / FINAL — 상수 · 재질 · 조명 · 병합 유틸
 *
 * 세 축(form/light/material) 심사에서 **효과 있다고 판정된 기법만** 모은 최종본이다.
 * 기각된 것(라운딩·미세비대칭·색온도·바닥반사·미사용GLB)은 코드에도 넣지 않는다.
 *
 * 방 치수/좌석/진찰대/카메라 값은 전부 src/three/ClinicScene.tsx 에서 그대로 옮긴 것이다.
 * 여기를 고치면 본 씬과 같은 공간이 아니게 되어 이식 실험의 의미가 사라진다.
 */
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/* ══════════════════════════════════════════════════════════════════
   §0 공간 상수 (ClinicScene.tsx ROOM / SEAT / EXAM)
   ══════════════════════════════════════════════════════════════════ */
export const ROOM = { w: 6.4, d: 6.6, h: 3.0, backZ: -5.2, frontZ: 1.2 }
export const DOOR_X = -1.4
export const DOOR_W = 1.05
export const DOOR_H = 2.15

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

/** 천장 형광등 4장 (ClinicScene.tsx <CeilingPanel> 좌표) */
export const PANELS = [
  { x: -1.3, z: -1.8 }, { x: 1.3, z: -1.8 },
  { x: -1.3, z: -3.8 }, { x: 1.3, z: -3.8 },
]
export const PANEL = { fw: 1.32, fd: 0.72, y: ROOM.h - 0.06 }
/** 우측 벽 창 개구부 (RoomShell 의 창 그룹 [hx-0.06, 1.65, -0.9], 유리 1.7 x 1.1) */
export const WINDOW = { x: ROOM.w / 2 - 0.06, y: 1.65, z: -0.9, w: 1.7, h: 1.1 }

/* ══════════════════════════════════════════════════════════════════
   §1 텍스처 로더
   ⚠ anisotropy 금지 — UV 없는 메시에서 탄젠트 NaN → 화면 블랙아웃 전례(material 랩 주석).
   ══════════════════════════════════════════════════════════════════ */
const TEXLOADER = new THREE.TextureLoader()
const srcCache = new Map()

function srcTex(file, srgb) {
  const key = `${file}|${srgb ? 's' : 'l'}`
  let t = srcCache.get(key)
  if (!t) {
    t = TEXLOADER.load(`/textures/${file}`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    srcCache.set(key, t)
  }
  return t
}

/** 면마다 다른 repeat을 주려면 clone이 필요하다. source는 공유되므로 로딩 전에 clone해도 된다. */
export function tex(file, rx, ry, srgb = false) {
  const t = srcTex(file, srgb).clone()
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/* ══════════════════════════════════════════════════════════════════
   §2 [material·효과있음] 프리셋 범주표
   sheen 이 필요한 것(천)만 MeshPhysical 로 승격한다 — 전부 Physical 로 만들면 셰이더 손해.
   ══════════════════════════════════════════════════════════════════ */
const PRESET = {
  stainless:    { roughness: 0.28, metalness: 0.90, envMapIntensity: 1.75 },
  paintedMetal: { roughness: 0.45, metalness: 0.35, envMapIntensity: 1.15 },
  medPlastic:   { roughness: 0.55, metalness: 0.00, envMapIntensity: 1.00 },
  vinyl:        { roughness: 0.50, metalness: 0.00, envMapIntensity: 0.90 },
  fabric:       { roughness: 0.92, metalness: 0.00, envMapIntensity: 0.55,
                  sheen: 0.22, sheenRoughness: 0.80, sheenColor: new THREE.Color('#ffffff') },
  paintedWall:  { roughness: 0.85, metalness: 0.00, envMapIntensity: 0.80 },
  vinylFloor:   { roughness: 0.60, metalness: 0.00, envMapIntensity: 1.10 },
  glass:        { roughness: 0.10, metalness: 0.00, envMapIntensity: 1.50 },
  paper:        { roughness: 0.95, metalness: 0.00, envMapIntensity: 0.55 },
  rubber:       { roughness: 0.70, metalness: 0.00, envMapIntensity: 0.45 },
  wood:         { roughness: 0.55, metalness: 0.00, envMapIntensity: 0.85 },
}

export function fromPreset(name, extra = {}) {
  const p = PRESET[name]
  const physical = p.sheen != null || extra.sheen != null || extra.transmission != null
  const params = { ...p, ...extra }
  return physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params)
}

/* ══════════════════════════════════════════════════════════════════
   §3 [material·효과있음] 벽 마모맵 + roughness 변조
   새 텍스처 파일 0바이트. 캔버스로만 만든다.
   띠 위치는 v 0.40~0.56 (= 월드 y 1.2~1.7m). 그 아래는 웨인스코트가 완전히 가린다.
   ══════════════════════════════════════════════════════════════════ */
function noiseBlobs(ctx, W, H, n, seed, alpha) {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H
    const r = (0.02 + rnd() * 0.10) * Math.min(W, H)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const a = alpha * (0.4 + rnd() * 0.6)
    g.addColorStop(0, `rgba(0,0,0,${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

let _wallWear = null
export function wallWearMap() {
  if (_wallWear) return _wallWear
  const W = 512, H = 256
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  const yBot = (1 - 0.40) * H
  const yTop = (1 - 0.56) * H
  const g = ctx.createLinearGradient(0, yBot, 0, yTop)
  g.addColorStop(0, 'rgba(0,0,0,0.46)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, yTop, W, yBot - yTop)
  ctx.save(); ctx.beginPath(); ctx.rect(0, (1 - 0.58) * H, W, 0.16 * H); ctx.clip()
  noiseBlobs(ctx, W, H, 30, 9137, 0.22); ctx.restore()
  noiseBlobs(ctx, W, H, 40, 4211, 0.085)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.colorSpace = THREE.NoColorSpace
  t.channel = 0
  _wallWear = t
  return t
}

/** wear(흰=깨끗)로 roughnessFactor 와 알베도를 민다. 셰이더 프로그램 1개만 추가된다. */
function modulateRoughness(mat, wear, rep, scale, offset) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWear = { value: wear }
    shader.uniforms.uRep = { value: rep }
    shader.uniforms.uWScale = { value: scale }
    shader.uniforms.uWOffset = { value: offset }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform sampler2D uWear;\nuniform vec2 uRep;\nuniform vec2 uWScale;\nuniform vec2 uWOffset;')
      .replace('#include <map_fragment>',
        `#include <map_fragment>
         {
           vec2 wuv = clamp( ( vMapUv / uRep ) * uWScale + uWOffset, 0.0, 1.0 );
           float w = texture2D( uWear, wuv ).r;
           diffuseColor.rgb *= mix( 0.860, 1.0, w );
         }`)
      .replace('#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         {
           vec2 wuv = clamp( ( vMapUv / uRep ) * uWScale + uWOffset, 0.0, 1.0 );
           float w = texture2D( uWear, wuv ).r;
           roughnessFactor = clamp( roughnessFactor * mix(1.420, 1.000, w), 0.035, 1.0 );
         }`)
  }
  mat.customProgramCacheKey = () => 'wear-scuff'
  mat.needsUpdate = true
}

/* ══════════════════════════════════════════════════════════════════
   §4 재질 라이브러리
     M       — 공통 소품 재질 (base/final 이 **같은 인스턴스**를 공유한다)
     M.wall(w,h,y0) / M.ceiling — 모드별로 다르다 (material 축의 승자)
   ══════════════════════════════════════════════════════════════════ */
export const M = {}
const wallCache = new Map()

/**
 * @param {object} opts
 *   upgraded  : 벽/천장 텍스처 업그레이드 (material 축 승자) 적용 여부
 *   wear      : 벽 마모 roughness 변조
 *   floor     : 'planks' | 'marble'  (바닥은 심사에서 **미해결**로 남았다 — 기본 planks)
 */
export function initMaterials(opts = {}) {
  const upgraded = opts.upgraded !== false
  const wear = opts.wear !== false
  const floorId = opts.floor || 'planks'

  /* ── 바닥 ──────────────────────────────────────────────────────────
     심사 결론: 세 축 모두 바닥을 못 고쳤다. marble 만이 '진료실'로 읽히지만
     방 무드를 통째로 바꾸고 Bloom 블랙홀 리스크를 정면으로 건드린다 → 별도 의사결정.
     그래서 **기본은 본 씬 그대로**(brown_planks, repeat 3.0/3.1)를 유지한다.
     실물 크기 타일링(1.2m/장 = repeat 5.33)은 벽·천장에만 적용한다.
     바닥에 적용하면 반복 무늬가 오히려 늘어난다 — 그게 문진 뷰 최대 잔여 CG 티다. */
  if (floorId === 'marble') {
    const rx = ROOM.w / 1.6, ry = ROOM.d / 1.6
    M.floor = fromPreset('vinylFloor', {
      map: tex('marble_01_diff_2k.jpg', rx, ry, true),
      normalMap: tex('marble_01_nor_gl_2k.jpg', rx, ry),
      roughnessMap: tex('marble_01_rough_2k.jpg', rx, ry),
      aoMap: tex('marble_01_ao_2k.jpg', rx, ry),
      aoMapIntensity: 0.7,
      normalScale: new THREE.Vector2(0.45, 0.45),
      color: '#e3dccc', roughness: 0.45, metalness: 0.0,
    })
    M.floor.aoMap.channel = 0
  } else {
    const rx = 3.0, ry = 3.1
    M.floor = new THREE.MeshStandardMaterial({
      map: tex('brown_planks_05_diff_2k.jpg', rx, ry, true),
      normalMap: tex('brown_planks_05_nor_gl_2k.jpg', rx, ry),
      roughnessMap: tex('brown_planks_05_rough_2k.jpg', rx, ry),
      aoMap: tex('brown_planks_05_ao_2k.jpg', rx, ry),
      aoMapIntensity: 1.0,
      normalScale: new THREE.Vector2(0.6, 0.6),
      color: '#c9a878', roughness: 0.6, metalness: 0.0,
    })
    M.floor.aoMap.channel = 0
  }

  /* ── 천장 ──────────────────────────────────────────────────────────
     [material·최고 가성비] OfficeCeiling001 음향타일. draw call +0, tri +0, 텍스처 +3.
     600mm 각 타일 6x6칸 ⇒ 텍스처 1장 = 3.6m */
  if (upgraded) {
    const rx = ROOM.w / 3.6, ry = ROOM.d / 3.6
    M.ceiling = fromPreset('paintedWall', {
      map: tex('OfficeCeiling001_color.jpg', rx, ry, true),
      normalMap: tex('OfficeCeiling001_normal.jpg', rx, ry),
      roughnessMap: tex('OfficeCeiling001_rough.jpg', rx, ry),
      /* ⚠ material 랩은 normalScale 0.55 / envMapIntensity 0.6 을 썼는데,
         그건 **천장을 정면으로 올려다보는 전용 카메라**에서 맞춘 값이다.
         게임 진찰 카메라처럼 천장을 비스듬히 스치듯 보면 그 설정은
         천장 밝기를 [216,201,174] → [176,140,98] 로 떨어뜨린다(실측).
         패널 점광(0xffe9cc)만 남아 주황으로 물든다 → env 를 되돌리고 요철을 낮춘다. */
      normalScale: new THREE.Vector2(0.38, 0.38),
      color: '#f2efe8', roughness: 0.92, envMapIntensity: 1.0,
    })
  } else {
    M.ceiling = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.95 })
  }

  /* ── 벽 ────────────────────────────────────────────────────────────
     [material·효과있음] Plaster001 color(+normal/rough) + 실물 크기 타일링.
     본 씬은 color 맵이 아예 없고 repeat이 (2.4,1.3) 고정이라
     6.6m 벽과 1.28m 문옆 패널의 텍셀 밀도가 5배 차이났다.
     면마다 재질을 새로 만들되 (w,h,y0) 키로 캐시해 프로그램/텍스처 낭비를 막는다. */
  const WALL_TILE_M = 2.0
  M.wall = (w, h, y0 = 0) => {
    const key = `${upgraded ? 'u' : 'b'}|${w.toFixed(3)}|${h.toFixed(3)}|${y0.toFixed(3)}`
    const hit = wallCache.get(key)
    if (hit) return hit
    let m
    if (!upgraded) {
      m = new THREE.MeshStandardMaterial({
        color: '#efe6d6',
        normalMap: tex('painted_plaster_wall_nor_gl_2k.jpg', 2.4, 1.3),
        normalScale: new THREE.Vector2(0.3, 0.3),
        roughnessMap: tex('painted_plaster_wall_rough_2k.jpg', 2.4, 1.3),
        roughness: 0.95, metalness: 0.0,
      })
    } else {
      const rx = Math.max(0.35, w / WALL_TILE_M)
      const ry = Math.max(0.35, h / WALL_TILE_M)
      m = fromPreset('paintedWall', {
        map: tex('Plaster001_color.jpg', rx, ry, true),
        normalMap: tex('painted_plaster_wall_nor_gl_2k.jpg', rx, ry),
        roughnessMap: tex('Plaster001_rough.jpg', rx, ry),
        normalScale: new THREE.Vector2(0.32, 0.32),
        color: '#f0e7d8', roughness: 0.85, metalness: 0.0,
      })
      if (wear) {
        /* 마모맵은 **월드 높이 0~3m**에 고정한다. 패널 로컬 uv를 그대로 쓰면
           문 위 0.85m 패널에도 자기 높이의 40% 지점에 띠가 생겨 공중에 뜬다. */
        const sc = new THREE.Vector2(1, h / ROOM.h)
        const off = new THREE.Vector2(0, y0 / ROOM.h)
        const ao = wallWearMap().clone()
        ao.wrapS = ao.wrapT = THREE.ClampToEdgeWrapping
        ao.repeat.copy(sc); ao.offset.copy(off); ao.channel = 0; ao.needsUpdate = true
        m.aoMap = ao
        m.aoMapIntensity = 1.0
        modulateRoughness(m, wallWearMap(), new THREE.Vector2(rx, ry), sc, off)
      }
    }
    wallCache.set(key, m)
    return m
  }

  /* ── 목공 ── (색은 본 씬 그대로. 아트디렉션은 바꾸지 않는다)
     ⚠ 웨인스코트/문에는 **텍스처를 붙이지 않는다.**
     material 랩은 평면 한 장에 WoodFloor043 노멀을 걸었지만, final 의 웨인스코트는
     판 + 세로살대 + 챠레일 = 박스 수십 개다. 박스 UV 는 면마다 0~1 이라
     repeat 을 걸면 22mm 살대에 널 6장이 들어가고 4.5m 판에는 널이 1.4m 로 늘어난다.
     실측: 진찰 뷰 뒷벽이 폭 1.4m짜리 가짜 널무늬 띠로 보였다.
     심사의 material 효과있음 목록에도 웨인스코트 텍스처는 없다 — 뺀다.
     이 축의 개선은 F4 지오메트리(살대·챠레일)가 가져간다. */
  M.wainscot = upgraded
    ? fromPreset('wood', { color: '#b8946a', roughness: 0.55 })
    : new THREE.MeshStandardMaterial({ color: '#b8946a', roughness: 0.7 })
  M.skirt = upgraded
    ? fromPreset('wood', { color: '#8a6a48', roughness: 0.48, envMapIntensity: 0.9 })
    : new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.6 })
  M.whitePaint = upgraded
    ? fromPreset('paintedMetal', { color: '#efe9dd', roughness: 0.5, metalness: 0.06, envMapIntensity: 1.0 })
    : new THREE.MeshStandardMaterial({ color: '#efe9dd', roughness: 0.55 })
  // 문도 같은 이유(부품이 박스 20여 개)로 텍스처 없이 파라미터만 쓴다
  M.door = upgraded
    ? fromPreset('wood', { color: '#d8c4a4', roughness: 0.42, envMapIntensity: 1.0 })
    : new THREE.MeshStandardMaterial({ color: '#d8c4a4', roughness: 0.5 })

  const P = (name, extra) => (upgraded ? fromPreset(name, extra) : new THREE.MeshStandardMaterial(extra))

  M.chrome     = P('stainless',    { color: '#c2c7cc', roughness: 0.3, metalness: 0.7 })
  M.steel      = P('paintedMetal', { color: '#9aa0a4', roughness: 0.4, metalness: 0.5 })
  M.stainless  = P('stainless',    { color: '#cfd6da', roughness: 0.35, metalness: 0.55 })
  M.clipMetal  = P('stainless',    { color: '#aeb4b8', roughness: 0.35, metalness: 0.7 })
  M.cupMetal   = P('stainless',    { color: '#c2c7cc', roughness: 0.22, metalness: 0.7 })
  M.cupMetal2  = P('stainless',    { color: '#d6dadd', roughness: 0.32, metalness: 0.5 })
  M.rail       = P('stainless',    { color: '#b8bec2', roughness: 0.4, metalness: 0.6 })
  M.darkPlastic = P('medPlastic',  { color: '#2a2e31', roughness: 0.5 })
  M.blackRubber = P('rubber',      { color: '#1c1f22', roughness: 0.6 })
  M.stoolSeat  = P('vinyl',        { color: '#2f3437', roughness: 0.5 })
  M.stoolLeg   = P('medPlastic',   { color: '#3a3f42', roughness: 0.5 })
  M.matVinyl   = P('vinyl',        { color: '#c9b48f', roughness: 0.6 })
  M.bedWood    = P('wood',         { color: '#d8c4a0', roughness: 0.65 })
  M.paper      = P('paper',        { color: '#e9e1d0', roughness: 0.97 })
  M.paperRoll  = P('paper',        { color: '#fbfbf6', roughness: 0.95 })
  M.formSheet  = P('paper',        { color: '#f7f6f1', roughness: 0.92 })
  M.cupInner   = P('medPlastic',   { color: '#2a2e31', roughness: 0.7 })
  M.wood       = P('wood',         { color: '#d8b98c', roughness: 0.8 })
  M.monitorBody = P('paintedMetal', { color: '#23262a', roughness: 0.4 })
  M.monitorStand = P('paintedMetal', { color: '#2a2e31', roughness: 0.45, metalness: 0.3 })
  M.keyBase    = P('medPlastic',   { color: '#e4e7ea', roughness: 0.45, metalness: 0.05 })
  M.keyCap     = P('medPlastic',   { color: '#34383c', roughness: 0.6 })
  M.clipTeal   = P('medPlastic',   { color: '#3a7d7b', roughness: 0.5 })
  M.sharps     = P('medPlastic',   { color: '#e4b521', roughness: 0.55 })
  M.sharpsLid  = P('medPlastic',   { color: '#c2962f', roughness: 0.6 })
  M.gloveWhite = P('paper',        { color: '#f4f4ef', roughness: 0.9 })
  M.cartWhite  = P('paintedMetal', { color: '#eef1f3', roughness: 0.45 })
  M.probe      = P('medPlastic',   { color: '#e9edf0', roughness: 0.4 })
  M.panelFrame = P('paintedMetal', { color: '#e8ece9', roughness: 0.5, metalness: 0.2 })
  M.slat       = P('medPlastic',   { color: '#e8dcc4', roughness: upgraded ? 0.48 : 0.7 })
  M.frameGold  = P('paintedMetal', { color: '#9c7b46', roughness: 0.45, metalness: 0.25 })
  M.frameBlue  = P('paintedMetal', { color: '#46566a', roughness: 0.45, metalness: 0.25 })

  /* [material·효과있음] 천 = sheen. 커튼은 이 방의 히어로 오브젝트다.
     ⚠ DoubleSide 필수 — 주름 천은 한 장짜리 plane이라 뒷면이 뚫린다. */
  M.curtainA = upgraded
    ? fromPreset('fabric', { color: '#cdd8c4', side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: '#cdd8c4', roughness: 0.9, side: THREE.DoubleSide })
  M.curtainB = upgraded
    ? fromPreset('fabric', { color: '#d8e0cf', side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: '#d8e0cf', roughness: 0.9, side: THREE.DoubleSide })

  M.glass = upgraded
    ? fromPreset('glass', { color: '#fff2dc', emissive: '#ffe6bc', emissiveIntensity: 1.1, roughness: 0.08, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: '#fff2dc', emissive: '#ffe6bc', emissiveIntensity: 1.1, roughness: 0.15, metalness: 0 })
  M.panelGlow = new THREE.MeshStandardMaterial({ color: '#fff6e8', emissive: '#fff1dc', emissiveIntensity: 2.0, roughness: 0.35 })
  M.monitorScreen = new THREE.MeshStandardMaterial({ color: '#eaf2ea', emissive: '#dfe9d8', emissiveIntensity: 0.6 })
  M.corridor = new THREE.MeshStandardMaterial({ color: '#1a2026', roughness: 1 })
  M.ivBag = new THREE.MeshStandardMaterial({ color: '#dff0ff', transparent: true, opacity: 0.55, roughness: 0.2 })
  M.ivDrip = new THREE.MeshStandardMaterial({ color: '#eaf4ff', transparent: true, opacity: 0.7 })

  /* 책 — 색마다 재질을 **캐시**한다. 본 씬은 책 36권이 각자 재질을 만들어
     36 draw call 이 되는데, 색을 공유하면 병합 패스가 8개로 줄인다. */
  M.book = BOOK_COLORS.map((c) => P('paper', { color: c, roughness: 0.78 }))

  M.upgraded = upgraded
  return M
}

export const BOOK_COLORS = ['#2f4a5e', '#3a5247', '#6e3a3a', '#d8d2c4', '#445566', '#7a6a4a', '#2e3e4a', '#e6e0d2']
export const GLOVE_COLORS = ['#3a6ea5', '#4a4f54', '#5aa06e']
const gloveMats = new Map()
export function gloveMat(color) {
  let m = gloveMats.get(color)
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 }); gloveMats.set(color, m) }
  return m
}

/* ══════════════════════════════════════════════════════════════════
   §5 [form·필수] 정적 병합 패스
   form 랩의 최대 비용은 draw call +118% 였다. 같은 재질 조각은 반드시 합친다.
   form 이 천장 T바 156조각을 1 call 로 합친 방식을 **범용화**한 것이다.

   scope 단위로만 합친다(방 전체를 하나로 합치면 프러스텀 컬링이 죽는다).
   ══════════════════════════════════════════════════════════════════ */
export function mergeScope(root) {
  root.updateMatrixWorld(true)
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const meshes = []
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noMerge) return
    // 투명 재질은 렌더 순서가 바뀌면 깨질 수 있으므로 제외
    if (o.material?.transparent) return
    const g = o.geometry
    if (!g || !g.attributes.position) return
    const attrs = Object.keys(g.attributes).sort().join(',')
    if (attrs !== 'normal,position,uv') return   // 표준 프리미티브만
    meshes.push(o)
  })

  const buckets = new Map()
  for (const mesh of meshes) {
    const idx = mesh.geometry.index ? 1 : 0
    const key = `${mesh.material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}|${idx}`
    let b = buckets.get(key)
    if (!b) { b = { mat: mesh.material, cast: mesh.castShadow, recv: mesh.receiveShadow, list: [] }; buckets.set(key, b) }
    b.list.push(mesh)
  }

  let saved = 0
  const tmp = new THREE.Matrix4()
  for (const b of buckets.values()) {
    if (b.list.length < 2) continue
    const geos = []
    for (const mesh of b.list) {
      const g = mesh.geometry.clone()
      g.applyMatrix4(tmp.multiplyMatrices(invRoot, mesh.matrixWorld))
      geos.push(g)
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    if (!merged) continue
    for (const mesh of b.list) mesh.parent?.remove(mesh)
    const out = new THREE.Mesh(merged, b.mat)
    out.castShadow = b.cast
    out.receiveShadow = b.recv
    /* [port risk·클릭판정] 장식 메시는 레이캐스트에서 빠진다.
       진찰 클릭은 (a) 히트 구체의 onPointerDown 과 (b) probeSurface 의 patientRoot 레이캐스트
       두 계통인데, 새 방 지오메트리가 (a)의 커서/호버를 가로채지 않도록 명시적으로 끈다. */
    out.raycast = () => null
    out.userData.merged = b.list.length
    root.add(out)
    saved += b.list.length - 1
  }
  return saved
}

/* ══════════════════════════════════════════════════════════════════
   §6 조명 리그
     base  : ClinicScene.tsx 그대로 (PCFShadowMap)
     final : + PCFSoftShadowMap
             + 창 개구부 마스크 + 강한 창빛 spot (문진 전용)
             + 진찰 전용 좁은 그림자 directional
   ══════════════════════════════════════════════════════════════════ */
export function buildLights(scene, mode) {
  const final = mode === 'final'
  const g = new THREE.Group()
  g.name = `rig-${mode}`
  const add = (l) => { g.add(l); if (l.target) g.add(l.target); return l }

  add(new THREE.AmbientLight(0xf7f8fb, 0.12))
  add(new THREE.HemisphereLight(0xeef4ff, 0x6a5544, 0.34))

  const dirWindow = new THREE.DirectionalLight(0xfff2e4, 0.88)
  dirWindow.position.set(4.5, 2.6, -0.9)
  add(dirWindow)

  /* 본 씬 d2. 좌측 컬링선을 반드시 유지한다:
     position.x=1.2, shadow.camera.left=-4 ⇒ x < -2.8 은 그림자 패스에서 잘린다.
     여기에 책장+화분 약 3.5만 tri 가 들어 있다. 넓히면 삼각형이 3배. */
  const dirTop = new THREE.DirectionalLight(0xf5f7ff, 0.5)
  dirTop.position.set(1.2, 5, 1.0)
  dirTop.castShadow = true
  dirTop.shadow.mapSize.set(2048, 2048)
  Object.assign(dirTop.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 })
  dirTop.shadow.bias = -0.0004
  dirTop.shadow.normalBias = 0.018
  add(dirTop)

  const key = new THREE.SpotLight(0xfff0e4, 1.9, 5.5, 0.58, 1, 2)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.bias = -0.0002
  key.shadow.normalBias = 0.012
  add(key)

  const fill = new THREE.PointLight(0xf5f7ff, 0.26, 2.8, 2)
  const rim = new THREE.PointLight(0xd8e7ff, 0.42, 2.6, 2)
  rim.position.set(-1.45, 1.85, -0.9)
  const deskLamp = new THREE.PointLight(0xffc97d, 1.1, 2.2, 2)
  deskLamp.position.set(-2.9, 1.15, 0.3)
  add(fill); add(rim); add(deskLamp)

  for (const p of PANELS) {
    const pl = new THREE.PointLight(0xffe9cc, 5, 5.5, 2)
    pl.position.set(p.x, ROOM.h - 0.02 - 0.4, p.z)
    add(pl)
  }

  /* ── [light·효과있음] 창 개구부 마스크 + 강한 창빛 ──
     오른쪽 벽에는 castShadow 가 없어 빛이 벽을 통과한다(본 씬도 같다).
     벽 바깥 x=3.26 에 보이지 않는 그림자 캐스터를 세워 **창 모양으로만** 통과시킨다.
     비용 거의 0. 단 진찰 모드에서는 끈다 — 이 띠는 바닥 (0.6,-1.4) 에 떨어지고
     진찰 프레임에는 안 들어오는데 그림자 패스만 씬을 한 번 더 그린다. */
  let sun = null, mask = null, examShadow = null
  if (final) {
    sun = new THREE.SpotLight(new THREE.Color('#fff4e2'), 11.0, 0, 0.34, 0.42, 0.0)
    sun.position.set(6.2, 4.6, 1.2)
    sun.target.position.set(0.6, 0, -1.4)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 3.0
    sun.shadow.camera.far = 8.6
    sun.shadow.bias = -0.0009
    sun.shadow.normalBias = 0.006
    add(sun)

    const maskMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
    mask = new THREE.Group()
    mask.position.set(3.26, 0, 0)
    const apZ0 = WINDOW.z - WINDOW.w / 2, apZ1 = WINDOW.z + WINDOW.w / 2
    const apY0 = WINDOW.y - WINDOW.h / 2, apY1 = WINDOW.y + WINDOW.h / 2
    const cz = (ROOM.backZ + ROOM.frontZ) / 2
    const dz = ROOM.frontZ - ROOM.backZ
    const part = (yc, hgt, zc, dep) => {
      const mm = new THREE.Mesh(new THREE.BoxGeometry(0.04, hgt, dep), maskMat)
      mm.position.set(0, yc, zc)
      mm.castShadow = true
      mm.receiveShadow = false
      mm.raycast = () => null
      mask.add(mm)
    }
    part(apY0 / 2, apY0, cz, dz)
    part((apY1 + ROOM.h) / 2, ROOM.h - apY1, cz, dz)
    part((apY0 + apY1) / 2, WINDOW.h, (ROOM.backZ + apZ0) / 2, apZ0 - ROOM.backZ)
    part((apY0 + apY1) / 2, WINDOW.h, (apZ1 + ROOM.frontZ) / 2, ROOM.frontZ - apZ1)
    g.add(mask)

    /* 진찰 전용 접지 그림자 — 그림자 카메라를 침대 주변으로만 좁힌다.
       (light 랩은 이걸 안 해서 진찰 tri 41k→434k 가 났다) */
    examShadow = new THREE.DirectionalLight(0xf3f6ff, 0.34)
    examShadow.position.set(2.6, 4.0, -2.4)
    examShadow.target.position.set(1.95, 0.6, -3.5)
    examShadow.castShadow = true
    examShadow.shadow.mapSize.set(1024, 1024)
    Object.assign(examShadow.shadow.camera, { left: -1.35, right: 1.35, top: 1.5, bottom: -1.5, near: 0.6, far: 6.5 })
    examShadow.shadow.bias = -0.0005
    examShadow.shadow.normalBias = 0.02
    examShadow.visible = false
    add(examShadow)
  }

  scene.add(g)

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
    if (sun) { sun.visible = !examMode; sun.castShadow = !examMode }
    if (mask) mask.visible = !examMode
    if (examShadow) examShadow.visible = examMode
    key.target.updateMatrixWorld()
    dirTop.target.updateMatrixWorld()
    if (sun) sun.target.updateMatrixWorld()
    if (examShadow) examShadow.target.updateMatrixWorld()
  }
  setMode(false)
  return { group: g, setMode, shadowType: final ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap }
}

/* ══════════════════════════════════════════════════════════════════
   §7 HDRI / GLB
   ══════════════════════════════════════════════════════════════════ */
export function loadEnvironment(renderer, scene) {
  return new Promise((resolve) => {
    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    new RGBELoader().load('/hdri/hospital_room_2_2k.hdr', (hdr) => {
      scene.environment = pmrem.fromEquirectangular(hdr).texture
      scene.environmentIntensity = 0.64
      hdr.dispose(); pmrem.dispose()
      resolve(true)
    }, undefined, () => resolve(false))
  })
}

const gltfLoader = new GLTFLoader()
const modelCache = new Map()
function loadModel(url) {
  if (modelCache.has(url)) return modelCache.get(url)
  const p = new Promise((resolve) => {
    gltfLoader.load(url, (gl) => {
      gl.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      resolve(gl.scene)
    }, undefined, () => resolve(null))
  })
  modelCache.set(url, p)
  return p
}

/* ══════════════════════════════════════════════════════════════════
   【이 실험의 최대 발견 — 심사의 'Bloom 블랙홀' 진단은 틀렸다】

   material 랩 값(roughness .34 / metalness .82 / env 1.5)을 GLTF 책상 상판에 걸면
   스페큘러 하이라이트 한가운데에 [0,0,255](순파랑) / [135,0,0](검붉음) 픽셀이 뜬다.
   post=0 이면 사라져서 지금까지 'Bloom 블랙홀'로 불려 왔다. 실측 결과 범인은 Bloom 이 아니다:

     설정                                   아티팩트 픽셀
     ─────────────────────────────────────────────────
     full post                                   120
     bloom 만 제거                                105   ← Bloom 은 무죄
     N8AO 만 제거                                 125   ← N8AO 도 무죄
     Vignette 만 제거                             118
     **NoiseEffect 만 제거**                        0   ← 범인
     이펙트 전부 제거(HalfFloat 타깃은 유지)          0
     base 모드(=tuneGLTF 안 씀) + full post          0

   원인: `NoiseEffect({ blendFunction: SOFT_LIGHT, premultiply: true })` 는
   소프트라이트 합성을 쓰는데, 이 공식은 LDR [0,1] 전용이다.
   base > 1 인 HDR 스페큘러에서는 2차항 (1-2b)·a² 가 크게 음수로 폭주하고,
   노이즈가 채널마다 독립이라 채널별로 다르게 0 으로 잘려 순파랑/검붉음이 된다.
   → 이 프로젝트의 'Bloom/N8AO가 화면을 검게 만든다'(RealisticPatient.tsx:2032) 전승도
     같은 원인일 가능성이 크다. 재검토 대상.

   근본 수정(본 씬 1줄): 노이즈를 톤매핑 뒤로 보내거나 blendFunction 을 LDR 안전한
   것(OVERLAY 대신 ADD/SCREEN, 또는 그냥 NORMAL+낮은 opacity)으로 바꾼다.
   여기서는 **파이프라인을 본 씬과 동일하게 유지**해야 비교가 성립하므로 건드리지 않고,
   대신 금속 파라미터를 실측 안전 구간으로 잡는다.

   roughness 스윕(다른 값 고정, metalness .82 / env 1.0):
     0.34 → 120 px   0.45 → 101   0.50 → 52   0.55 → 5   **0.60 → 0**   0.70 → 0
   envMapIntensity 는 1.5→0.6 으로 낮춰도 120→118 로 거의 무관하다
   (즉 IBL 반사가 아니라 **점광원 직접 스페큘러 로브**가 원인).
   ?tunemetal=r,m,e 로 다시 스윕할 수 있다.
   ══════════════════════════════════════════════════════════════════ */
const _tm = new URLSearchParams(location.search).get('tunemetal')?.split(',').map(Number)
export const TUNE = { r: _tm?.[0] ?? 0.60, m: _tm?.[1] ?? 0.82, e: _tm?.[2] ?? 1.5 }

/** [material·효과있음] GLTF 프롭 파라미터 튜닝. 맵은 그대로, roughness/metalness/env 만 손댄다. */
export function tuneGLTF(root) {
  root.traverse((o) => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!m || !('roughness' in m)) continue
      const k = `${o.name} ${m.name}`.toLowerCase()
      if (/metal|steel|chrome|alu|frame|leg|handle/.test(k)) { m.roughness = TUNE.r; m.metalness = TUNE.m; m.envMapIntensity = TUNE.e }
      else if (/plastic|vinyl|seat|pad/.test(k)) { m.roughness = 0.55; m.metalness = 0; m.envMapIntensity = 1.0 }
      else if (/wood|oak|shelf|book/.test(k)) { m.roughness = 0.55; m.metalness = 0; m.envMapIntensity = 0.85 }
      else if (/leaf|plant|soil|dirt/.test(k)) { m.roughness = 0.72; m.metalness = 0; m.envMapIntensity = 0.7 }
      else {
        if (m.metalness > 0.6 && !m.metalnessMap) m.metalness = 0.35
        m.envMapIntensity = 1.05
      }
      m.needsUpdate = true
    }
  })
}

export async function propNode(asset, position, rotation = [0, 0, 0], scale = 1, tune = false) {
  const src = await loadModel(`/models/${asset}/${asset}.gltf`)
  if (!src) return null
  const c = src.clone(true)
  if (tune) tuneGLTF(c)
  const g = new THREE.Group()
  g.add(c)
  g.position.set(...position)
  g.rotation.set(...rotation)
  if (Array.isArray(scale)) g.scale.set(...scale); else g.scale.setScalar(scale)
  g.userData.noMerge = true
  c.traverse((o) => { o.userData.noMerge = true })
  return g
}

/* ══════════════════════════════════════════════════════════════════
   §8 캔버스 텍스처 (해부도 / 바이탈)
   ══════════════════════════════════════════════════════════════════ */
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
  t.colorSpace = THREE.SRGBColorSpace
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
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
