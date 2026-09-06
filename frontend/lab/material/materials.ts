/**
 * clinic-lab / material 변형 — 재질 라이브러리
 *
 * 이 실험의 규칙: **형태·조명은 본 씬 그대로 두고 재질만 바꾼다.**
 * 그래서 재질 슬롯을 인터페이스(MatLib)로 뽑고, 같은 지오메트리 빌더가
 *   - baseLib : 본 씬 ClinicScene.tsx의 재질을 값까지 그대로 복사한 것 (before)
 *   - matLib  : 재질 스펙(§2~§4)을 적용한 것 (after)
 * 둘 중 하나를 받아 만들어진다. 지오메트리 코드는 한 벌뿐이라 형태 차이가 0이다.
 *
 * ⚠ anisotropy 금지 — UV 없는 메시에서 탄젠트 NaN → 화면 블랙아웃 전례. 어디에도 쓰지 않는다.
 */
import * as THREE from 'three'

/* ══════════════════════════════════════════════════════════════════════
   텍스처 로더 (본 씬 loadPBR과 같은 캐시 전략)
   ══════════════════════════════════════════════════════════════════════ */
export const manager = new THREE.LoadingManager()
const loader = new THREE.TextureLoader(manager)
const srcCache = new Map<string, THREE.Texture>()

function src(file: string, srgb: boolean): THREE.Texture {
  const key = `${file}|${srgb ? 's' : 'l'}`
  let t = srcCache.get(key)
  if (!t) {
    t = loader.load(`/textures/${file}`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    srcCache.set(key, t)
  }
  return t
}

/** 타일링(repeat)을 면마다 독립 적용하려고 clone. three의 Texture.source는 clone 시 공유되므로
 *  로드 완료 전에 clone해도 이미지가 나중에 도착한다(본 씬 makePBRMaterial과 동일한 전제). */
export function tex(file: string, rx: number, ry: number, srgb = false, rot = 0): THREE.Texture {
  const t = src(file, srgb).clone()
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  if (rot) { t.center.set(0.5, 0.5); t.rotation = rot }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/* ══════════════════════════════════════════════════════════════════════
   §2 재질 범주표 (MATERIAL_PRESET)
   spec 2026-07-25-material-quality-spec.md §2 그대로.
   ══════════════════════════════════════════════════════════════════════ */
export type PresetName =
  | 'stainless' | 'paintedMetal' | 'medPlastic' | 'vinyl' | 'fabric'
  | 'paintedWall' | 'vinylFloor' | 'glass' | 'paper' | 'rubber' | 'wood'

export const PRESET: Record<PresetName, THREE.MeshPhysicalMaterialParameters> = {
  /* 스테인리스 — IV대·트레이·손잡이. envMapIntensity를 올려 HDRI 반사를 살린다. */
  stainless:    { roughness: 0.28, metalness: 0.90, envMapIntensity: 1.75 },
  /* 도장 금속 — 캐비닛·모니터 하우징 */
  paintedMetal: { roughness: 0.45, metalness: 0.35, envMapIntensity: 1.15 },
  /* 의료 플라스틱 — 디스펜서·기기 케이스·스툴. 완전 무광 금지 */
  medPlastic:   { roughness: 0.55, metalness: 0.00, envMapIntensity: 1.00 },
  /* 비닐 레자 — 진찰대 매트·스툴 시트 */
  vinyl:        { roughness: 0.50, metalness: 0.00, envMapIntensity: 0.90 },
  /* 천 — 커튼·드레이프. sheen이 없으면 천으로 안 보인다 (§2) */
  fabric:       { roughness: 0.92, metalness: 0.00, envMapIntensity: 0.55,
                  sheen: 0.22, sheenRoughness: 0.80, sheenColor: new THREE.Color('#ffffff') },
  /* 페인트 벽 */
  paintedWall:  { roughness: 0.85, metalness: 0.00, envMapIntensity: 0.80 },
  /* 비닐 바닥 — 살짝 광택 */
  vinylFloor:   { roughness: 0.60, metalness: 0.00, envMapIntensity: 1.10 },
  /* 유리 */
  glass:        { roughness: 0.10, metalness: 0.00, envMapIntensity: 1.50 },
  /* 종이 */
  paper:        { roughness: 0.95, metalness: 0.00, envMapIntensity: 0.55 },
  /* 고무(청진기 튜브·캐스터) */
  rubber:       { roughness: 0.70, metalness: 0.00, envMapIntensity: 0.45 },
  /* 목재(웨인스코트·책장) — 표에는 없지만 이 방에 실제로 있는 범주 */
  wood:         { roughness: 0.55, metalness: 0.00, envMapIntensity: 0.85 },
}

/** 프리셋 + 색/맵으로 재질 하나 만들기. sheen이 있는 프리셋만 Physical로 승격한다
 *  (Physical은 Standard보다 셰이더가 무거워서 전부 Physical로 만들면 손해다). */
export function fromPreset(
  name: PresetName,
  extra: THREE.MeshPhysicalMaterialParameters = {},
): THREE.MeshStandardMaterial {
  const p = PRESET[name]
  const needsPhysical = p.sheen != null || extra.sheen != null || extra.transmission != null
  const params = { ...p, ...extra }
  return needsPhysical
    ? new THREE.MeshPhysicalMaterial(params)
    : new THREE.MeshStandardMaterial(params as THREE.MeshStandardMaterialParameters)
}

/* ══════════════════════════════════════════════════════════════════════
   마모(wear) 레이어 — 새 텍스처 파일을 만들지 않고 런타임 캔버스로만.
   다운로드 용량 증가분 0바이트.
     · aoMap  → 벽 하단 스커프 / 바닥 동선 얼룩
     · roughness 변조 → onBeforeCompile로 roughnessFactor에 곱한다
   ══════════════════════════════════════════════════════════════════════ */
function noiseBlobs(ctx: CanvasRenderingContext2D, W: number, H: number, n: number, seed: number, alpha: number) {
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

let _wallWear: THREE.CanvasTexture | null = null
/**
 * 벽 마모 맵. 흰색=깨끗, 검정=때/스커프.
 *
 * ⚠ 첫 시도는 v=0(바닥 높이)에 스커프 띠를 뒀는데 **웨인스코트(0~1.2m)가 완전히 가려서
 *   아무것도 안 보였다.** 벽 plane은 h=3.0이라 웨인스코트 윗변이 v=0.40이다.
 *   그래서 띠를 v 0.40~0.56(=y 1.2~1.7m, 카트·의자 등받이·손이 닿는 높이)로 올렸다.
 * 캔버스 y = (1 - v) * H.
 */
export function wallWearMap(): THREE.CanvasTexture {
  if (_wallWear) return _wallWear
  const W = 512, H = 256
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  // 웨인스코트 바로 위(v=0.40)에서 위로 흐려지는 스커프 띠
  const yBot = (1 - 0.40) * H   // 0.60H
  const yTop = (1 - 0.56) * H   // 0.44H
  const g = ctx.createLinearGradient(0, yBot, 0, yTop)
  g.addColorStop(0, 'rgba(0,0,0,0.46)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, yTop, W, yBot - yTop)
  // 손 닿는 높이(v 0.42~0.58)의 손때 얼룩
  ctx.save(); ctx.beginPath(); ctx.rect(0, (1 - 0.58) * H, W, 0.16 * H); ctx.clip()
  noiseBlobs(ctx, W, H, 30, 9137, 0.22); ctx.restore()
  // 전면 옅은 얼룩 (균일함을 깬다)
  noiseBlobs(ctx, W, H, 40, 4211, 0.085)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.colorSpace = THREE.NoColorSpace
  ;(t as THREE.Texture & { channel: number }).channel = 0 // aoMap이 uv1이 아니라 uv0을 쓰게
  _wallWear = t
  return t
}

let _floorWear: THREE.CanvasTexture | null = null
/** 바닥 마모 맵. 문(뒷벽 -z, 화면 안쪽) ↔ 책상/침대 동선을 따라 닳은 자국. */
export function floorWearMap(): THREE.CanvasTexture {
  if (_floorWear) return _floorWear
  const S = 512
  const c = document.createElement('canvas'); c.width = S; c.height = S
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S)
  /* 동선 3가닥. uv→월드 대응을 실제로 계산해서 좌표를 잡았다:
       바닥 plane(6.4 x 6.6)을 rotation.x=-90°로 눕히면
         u = (x + 3.2) / 6.4 ,  v = (-2.0 - z + 3.3) / 6.6 ,  캔버스y = (1-v)*S
       문(-1.4, -4.85)→(u .28, y .07) / 스툴(-0.9, -0.1)→(.36, .79)
       침대(1.95, -3.5)→(.80, .27) / 책상(-2.05, 0.5)→(.18, .88) */
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const paths: [number, number, number, number][] = [
    [0.28, 0.07, 0.36, 0.79], // 문 → 환자 의자
    [0.28, 0.07, 0.80, 0.27], // 문 → 진찰대
    [0.18, 0.88, 0.80, 0.27], // 의사 책상 → 진찰대
  ]
  for (const [x0, y0, x1, y1] of paths) {
    for (let k = 3; k >= 1; k--) {
      ctx.strokeStyle = `rgba(0,0,0,${0.05 * k})`
      ctx.lineWidth = S * 0.09 * k
      ctx.beginPath(); ctx.moveTo(x0 * S, y0 * S); ctx.lineTo(x1 * S, y1 * S); ctx.stroke()
    }
  }
  // 벽 가장자리 먼지선
  const eg = ctx.createLinearGradient(0, 0, 0, S * 0.06)
  eg.addColorStop(0, 'rgba(0,0,0,0.22)'); eg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = eg; ctx.fillRect(0, 0, S, S * 0.06)
  noiseBlobs(ctx, S, S, 40, 771, 0.08)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.colorSpace = THREE.NoColorSpace
  ;(t as THREE.Texture & { channel: number }).channel = 0
  _floorWear = t
  return t
}

/**
 * roughness 변조. wear맵(흰=깨끗)을 읽어 roughnessFactor에 곱한다.
 *  - kind 'scuff'  : 때 낀 곳이 **더 거칠어짐** (벽)
 *  - kind 'polish' : 밟혀서 닳은 곳이 **더 매끈해짐** (바닥) → 형광등 반사가 길게 늘어난다
 * vMapUv는 map의 repeat이 곱해진 값이므로 uRep으로 나눠 원래 uv(0~1)를 복원한다.
 */
export function modulateRoughness(
  mat: THREE.MeshStandardMaterial,
  wear: THREE.Texture,
  rep: THREE.Vector2,
  kind: 'scuff' | 'polish',
  /** wear uv 재매핑: uv_wear = uv_face * scale + offset. 벽 패널마다 높이/바닥높이가 달라서
   *  그냥 0~1로 쓰면 스커프 띠가 **패널마다 다른 실제 높이**에 생긴다(문 위 패널에 띠가 뜨는 버그). */
  scale = new THREE.Vector2(1, 1),
  offset = new THREE.Vector2(0, 0),
) {
  const lo = kind === 'scuff' ? 1.0 : 1.06 // wear=1(깨끗)
  const hi = kind === 'scuff' ? 1.42 : 0.62 // wear=0(닳음/때)
  // 얼룩(diffuse 감쇠). aoMap은 간접광만 건드려서 직사광 아래서는 거의 안 보였다 — 그래서 알베도도 함께 민다.
  const dirt = kind === 'scuff' ? 0.86 : 0.93
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWear = { value: wear }
    shader.uniforms.uRep = { value: rep }
    shader.uniforms.uWScale = { value: scale }
    shader.uniforms.uWOffset = { value: offset }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform sampler2D uWear;\nuniform vec2 uRep;\nuniform vec2 uWScale;\nuniform vec2 uWOffset;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         {
           vec2 wuv = clamp( ( vMapUv / uRep ) * uWScale + uWOffset, 0.0, 1.0 );
           float w = texture2D( uWear, wuv ).r;
           diffuseColor.rgb *= mix( ${dirt.toFixed(3)}, 1.0, w );
         }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         {
           vec2 wuv = clamp( ( vMapUv / uRep ) * uWScale + uWOffset, 0.0, 1.0 );
           float w = texture2D( uWear, wuv ).r;
           roughnessFactor = clamp( roughnessFactor * mix(${hi.toFixed(3)}, ${lo.toFixed(3)}, w), 0.035, 1.0 );
         }`,
      )
  }
  mat.customProgramCacheKey = () => `wear-${kind}`
  mat.needsUpdate = true
}

/* ══════════════════════════════════════════════════════════════════════
   바닥 후보 — "진료실 바닥이 나무여도 되는가" 판단용 (§3)
   ══════════════════════════════════════════════════════════════════════ */
export type FloorId = 'planks' | 'tiles074' | 'tiles101' | 'marble' | 'wood043'
export const FLOOR_IDS: FloorId[] = ['planks', 'tiles074', 'tiles101', 'marble', 'wood043']
export const FLOOR_LABEL: Record<FloorId, string> = {
  planks:   'brown_planks_05 (본 씬 현재 · 회색 판자에 베이지 틴트)',
  tiles074: 'Tiles074 (흑/베이지 체커 대리석)',
  tiles101: 'Tiles101 (청화 아줄레주 타일)',
  marble:   'marble_01 (베이지 석재 블록)',
  wood043:  'WoodFloor043 (따뜻한 원목 마루 = 우드룩 비닐)',
}

const ROOM_W = 6.4
const ROOM_D = 6.6

/** 실물 크기 기준 타일링. tileM = 텍스처 1장이 덮는 실제 미터. */
function floorRepeat(tileM: number): [number, number] {
  return [ROOM_W / tileM, ROOM_D / tileM]
}

export function makeFloor(id: FloorId, upgraded: boolean, wear: boolean): THREE.MeshStandardMaterial {
  if (!upgraded) {
    /* ── baseline: 본 씬 matFloor() 값 그대로 ── */
    const rep: [number, number] = [3.0, 3.1]
    const m = new THREE.MeshStandardMaterial({
      map: tex('brown_planks_05_diff_2k.jpg', rep[0], rep[1], true),
      normalMap: tex('brown_planks_05_nor_gl_2k.jpg', rep[0], rep[1]),
      roughnessMap: tex('brown_planks_05_rough_2k.jpg', rep[0], rep[1]),
      aoMap: tex('brown_planks_05_ao_2k.jpg', rep[0], rep[1]),
      aoMapIntensity: 1.0,
      normalScale: new THREE.Vector2(0.6, 0.6),
      color: '#c9a878',
      roughness: 0.6,
      metalness: 0.0,
    })
    ;(m.aoMap as THREE.Texture & { channel: number }).channel = 0
    return m
  }

  /* ── upgraded: 후보별 실물 크기 타일링 + 비닐바닥 프리셋 ── */
  let m: THREE.MeshStandardMaterial
  let rep: [number, number]
  switch (id) {
    case 'tiles074': {
      // 체커 1칸 = 300mm, 텍스처는 6x6칸 ⇒ 1.8m
      rep = floorRepeat(1.8)
      m = fromPreset('vinylFloor', {
        map: tex('Tiles074_color.jpg', rep[0], rep[1], true),
        normalMap: tex('Tiles074_normal.jpg', rep[0], rep[1]),
        roughnessMap: tex('Tiles074_rough.jpg', rep[0], rep[1]),
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.42, metalness: 0.0,
      })
      break
    }
    case 'tiles101': {
      // 아줄레주 1칸 = 300mm, 텍스처 4x4칸 ⇒ 1.2m
      rep = floorRepeat(1.2)
      m = fromPreset('vinylFloor', {
        map: tex('Tiles101_color.jpg', rep[0], rep[1], true),
        normalMap: tex('Tiles101_normal.jpg', rep[0], rep[1]),
        roughnessMap: tex('Tiles101_rough.jpg', rep[0], rep[1]),
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.38, metalness: 0.0,
      })
      break
    }
    case 'marble': {
      // 석재 블록 1장 ≈ 400x400mm, 텍스처 4행 ⇒ 1.6m
      rep = floorRepeat(1.6)
      m = fromPreset('vinylFloor', {
        map: tex('marble_01_diff_2k.jpg', rep[0], rep[1], true),
        normalMap: tex('marble_01_nor_gl_2k.jpg', rep[0], rep[1]),
        roughnessMap: tex('marble_01_rough_2k.jpg', rep[0], rep[1]),
        aoMap: tex('marble_01_ao_2k.jpg', rep[0], rep[1]),
        aoMapIntensity: 0.7,
        normalScale: new THREE.Vector2(0.45, 0.45),
        color: '#e3dccc',
        roughness: 0.45, metalness: 0.0,
      })
      ;(m.aoMap as THREE.Texture & { channel: number }).channel = 0
      break
    }
    case 'wood043': {
      // 마루널 1장 폭 ≈ 190mm, 텍스처 6행 ⇒ 1.14m. 널이 방 깊이 방향으로 흐르게 90° 회전.
      rep = floorRepeat(1.15)
      m = fromPreset('vinylFloor', {
        map: tex('WoodFloor043_color.jpg', rep[0], rep[1], true, Math.PI / 2),
        normalMap: tex('WoodFloor043_normal.jpg', rep[0], rep[1], false, Math.PI / 2),
        roughnessMap: tex('WoodFloor043_rough.jpg', rep[0], rep[1], false, Math.PI / 2),
        normalScale: new THREE.Vector2(0.45, 0.45),
        color: '#d6c3a6',
        roughness: 0.55, metalness: 0.0,
      })
      break
    }
    default: {
      // planks: 판자 폭 ≈ 150mm, 텍스처 8행 ⇒ 1.2m (본 씬은 2.13m라 판자가 27cm짜리로 과대)
      rep = floorRepeat(1.2)
      m = fromPreset('vinylFloor', {
        map: tex('brown_planks_05_diff_2k.jpg', rep[0], rep[1], true),
        normalMap: tex('brown_planks_05_nor_gl_2k.jpg', rep[0], rep[1]),
        roughnessMap: tex('brown_planks_05_rough_2k.jpg', rep[0], rep[1]),
        aoMap: tex('brown_planks_05_ao_2k.jpg', rep[0], rep[1]),
        aoMapIntensity: 0.8,
        normalScale: new THREE.Vector2(0.55, 0.55),
        color: '#c9a878',
        roughness: 0.6, metalness: 0.0,
      })
      ;(m.aoMap as THREE.Texture & { channel: number }).channel = 0
      break
    }
  }
  if (wear) {
    // aoMap 슬롯이 비어 있으면 마모맵을 AO로, 차 있으면 roughness 변조만.
    if (!m.aoMap) { m.aoMap = floorWearMap(); m.aoMapIntensity = 0.85 }
    modulateRoughness(m, floorWearMap(), new THREE.Vector2(rep[0], rep[1]), 'polish')
  }
  return m
}

/* ══════════════════════════════════════════════════════════════════════
   MatLib — 지오메트리 빌더가 쓰는 재질 슬롯 전체
   ══════════════════════════════════════════════════════════════════════ */
export interface MatLib {
  id: 'base' | 'mat'
  /* 방 셸 */
  floor(): THREE.Material
  ceiling(): THREE.Material
  /** w,h = 그 면의 실제 크기(m), y0 = 면 아랫변의 월드 높이.
   *  baseline은 셋 다 무시하고 고정 repeat(2.4,1.3)을 쓴다 — 본 씬 그대로다. */
  wall(w: number, h: number, y0?: number): THREE.Material
  wainscot(w: number, h: number): THREE.Material
  skirt(): THREE.Material
  whitePaint(): THREE.Material
  door(): THREE.Material
  windowGlass(): THREE.Material
  blindSlat(): THREE.Material
  cord(): THREE.Material
  corridor(): THREE.Material
  /* 조명 패널 */
  panelFrame(): THREE.Material
  panelGlow(): THREE.Material
  /* 범주 */
  stainless(color?: string): THREE.Material
  paintedMetal(color: string): THREE.Material
  plastic(color: string): THREE.Material
  vinyl(color: string): THREE.Material
  fabric(color: string): THREE.Material
  paper(color: string): THREE.Material
  rubber(color: string): THREE.Material
  wood(color: string): THREE.Material
  glassy(color: string, opacity: number): THREE.Material
  screen(map: THREE.Texture | null, color: string, emissive: string, intensity: number): THREE.Material
  /* GLTF 프롭 후처리 */
  tuneGLTF(root: THREE.Object3D): void
}

/* ── baseline: 본 씬 값 그대로 (before) ─────────────────────────────── */
export function makeBaseLib(floorId: FloorId): MatLib {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p)
  return {
    id: 'base',
    floor: () => makeFloor(floorId, false, false),
    // 본 씬 matCeiling(): 단색
    ceiling: () => std({ color: '#f4efe6', roughness: 0.95 }),
    // 본 씬 matWall(): color 맵 없음, 면 크기와 무관하게 repeat 고정 (2.4, 1.3)
    wall: () => std({
      color: '#efe6d6',
      normalMap: tex('painted_plaster_wall_nor_gl_2k.jpg', 2.4, 1.3),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: tex('painted_plaster_wall_rough_2k.jpg', 2.4, 1.3),
      roughness: 0.95, metalness: 0.0,
    }),
    wainscot: () => std({ color: '#b8946a', roughness: 0.7 }),
    skirt: () => std({ color: '#8a6a48', roughness: 0.6 }),
    whitePaint: () => std({ color: '#efe9dd', roughness: 0.55 }),
    door: () => std({ color: '#d8c4a4', roughness: 0.5 }),
    windowGlass: () => std({ color: '#fff2dc', emissive: '#ffe6bc', emissiveIntensity: 1.1, roughness: 0.15, metalness: 0 }),
    blindSlat: () => std({ color: '#e8dcc4', roughness: 0.7 }),
    cord: () => std({ color: '#cabfa6', roughness: 0.8 }),
    corridor: () => std({ color: '#1a2026', roughness: 1 }),
    panelFrame: () => std({ color: '#e8ece9', roughness: 0.6 }),
    panelGlow: () => std({ color: '#fff6e8', emissive: '#fff1dc', emissiveIntensity: 2.0 }),
    stainless: (c = '#c2c7cc') => std({ color: c, roughness: 0.3, metalness: 0.7 }),
    paintedMetal: (c) => std({ color: c, roughness: 0.45 }),
    plastic: (c) => std({ color: c, roughness: 0.5 }),
    vinyl: (c) => std({ color: c, roughness: 0.6 }),
    fabric: (c) => std({ color: c, roughness: 0.9 }), // ← sheen 없음. 이게 본 씬 상태다
    paper: (c) => std({ color: c, roughness: 0.95 }),
    rubber: (c) => std({ color: c, roughness: 0.6 }),
    wood: (c) => std({ color: c, roughness: 0.7 }),
    glassy: (c, o) => std({ color: c, transparent: true, opacity: o, roughness: 0.2 }),
    screen: (map, c, e, i) => std({
      map: map ?? null, color: c, emissive: e, emissiveMap: map ?? null,
      emissiveIntensity: i, toneMapped: false,
    }),
    tuneGLTF: () => { /* 본 씬은 GLTF 재질을 손대지 않는다 */ },
  }
}

/* ── upgraded: §2 범주표 + §3 텍스처 연결 + 실물 타일링 + 마모 (after) ── */
export function makeMatLib(floorId: FloorId, wear: boolean, badTiling = false): MatLib {
  /* 벽 — Plaster001 color를 붙이고(본 씬은 color가 아예 없다),
     타일링을 면 크기/2.0m로 잡아 **모든 벽면의 텍셀 밀도를 통일**한다.
     본 씬은 6.6m 벽과 1.28m 문옆 패널이 같은 repeat(2.4)을 써서 밀도가 5배 차이 났다. */
  const WALL_TILE_M = 2.0
  const ROOM_H = 3.0
  const wall = (w: number, h: number, y0 = 0) => {
    // badTiling: 본 씬처럼 면 크기와 무관하게 repeat을 고정 → 텍셀 밀도가 면마다 달라진다.
    const rx = badTiling ? 2.4 : Math.max(0.35, w / WALL_TILE_M)
    const ry = badTiling ? 1.3 : Math.max(0.35, h / WALL_TILE_M)
    const m = fromPreset('paintedWall', {
      map: tex('Plaster001_color.jpg', rx, ry, true),
      normalMap: tex('painted_plaster_wall_nor_gl_2k.jpg', rx, ry),
      roughnessMap: tex('Plaster001_rough.jpg', rx, ry),
      normalScale: new THREE.Vector2(0.32, 0.32),
      color: '#f0e7d8', // 베이스의 따뜻한 오프화이트 유지 (색 연출은 바꾸지 않는다)
      roughness: 0.85, metalness: 0.0,
    })
    if (wear) {
      /* 마모맵은 **월드 높이 0~3m**에 고정한다. 패널 로컬 uv 0~1을 그대로 쓰면
         문 위 0.85m 패널에도 자기 높이의 40%에 스커프 띠가 생겨서 공중에 띠가 뜬다(실제로 났다). */
      const sc = new THREE.Vector2(1, h / ROOM_H)
      const off = new THREE.Vector2(0, y0 / ROOM_H)
      const ao = wallWearMap().clone()
      ao.wrapS = ao.wrapT = THREE.ClampToEdgeWrapping
      ao.repeat.copy(sc); ao.offset.copy(off)
      ;(ao as THREE.Texture & { channel: number }).channel = 0
      ao.needsUpdate = true
      m.aoMap = ao
      m.aoMapIntensity = 1.0
      modulateRoughness(m, wallWearMap(), new THREE.Vector2(rx, ry), 'scuff', sc, off)
    }
    return m
  }

  /* 천장 — OfficeCeiling001. 600mm 각 텍스처 6x6칸 ⇒ 3.6m/장 */
  const ceiling = () => {
    const rx = 6.4 / 3.6, ry = 6.6 / 3.6
    return fromPreset('paintedWall', {
      map: tex('OfficeCeiling001_color.jpg', rx, ry, true),
      normalMap: tex('OfficeCeiling001_normal.jpg', rx, ry),
      roughnessMap: tex('OfficeCeiling001_rough.jpg', rx, ry),
      normalScale: new THREE.Vector2(0.55, 0.55),
      color: '#efece4',
      roughness: 0.92, envMapIntensity: 0.6,
    })
  }

  /* 웨인스코트 — **색 맵을 붙이지 않는다.**
     WoodFloor043 color를 붙여보니(variantA 캡처) 원본 목재가 어두워서 방 팔레트가
     통째로 어두워졌다. 이 실험은 '재질' 축만 보는 것이므로 아트디렉션(값/색)은 베이스와
     같게 두고 **노멀/러프(미세 표면)와 PBR 파라미터만** 바꾼다. */
  const wainscot = (w: number, h: number) => fromPreset('wood', {
    normalMap: tex('WoodFloor043_normal.jpg', w / 1.15, Math.max(0.6, h / 1.15)),
    roughnessMap: tex('WoodFloor043_rough.jpg', w / 1.15, Math.max(0.6, h / 1.15)),
    normalScale: new THREE.Vector2(0.45, 0.45),
    color: '#b8946a', // 베이스와 동일
    roughness: 0.5,
  })

  return {
    id: 'mat',
    floor: () => makeFloor(floorId, true, wear),
    ceiling,
    wall,
    wainscot,
    skirt: () => fromPreset('wood', { color: '#8a6a48', roughness: 0.48, envMapIntensity: 0.9 }),
    whitePaint: () => fromPreset('paintedMetal', { color: '#efe9dd', roughness: 0.5, metalness: 0.06, envMapIntensity: 1.0 }),
    // 문 — 라미네이트 목재. 결이 세로로 서도록 90° 회전. (색은 베이스와 동일하게 유지)
    door: () => fromPreset('wood', {
      normalMap: tex('WoodFloor043_normal.jpg', 1.0, 2.0, false, Math.PI / 2),
      roughnessMap: tex('WoodFloor043_rough.jpg', 1.0, 2.0, false, Math.PI / 2),
      normalScale: new THREE.Vector2(0.3, 0.3),
      color: '#d8c4a4', roughness: 0.42, envMapIntensity: 1.0,
    }),
    windowGlass: () => fromPreset('glass', {
      color: '#fff2dc', emissive: '#ffe6bc', emissiveIntensity: 1.1, roughness: 0.08, metalness: 0,
    }),
    blindSlat: () => fromPreset('medPlastic', { color: '#e8dcc4', roughness: 0.48, envMapIntensity: 1.1 }),
    cord: () => fromPreset('fabric', { color: '#cabfa6' }),
    corridor: () => new THREE.MeshStandardMaterial({ color: '#1a2026', roughness: 1 }),
    panelFrame: () => fromPreset('paintedMetal', { color: '#e8ece9', roughness: 0.5, metalness: 0.2 }),
    panelGlow: () => new THREE.MeshStandardMaterial({
      color: '#fff6e8', emissive: '#fff1dc', emissiveIntensity: 2.0, roughness: 0.35,
    }),
    stainless: (c = '#c2c7cc') => fromPreset('stainless', { color: c }),
    paintedMetal: (c) => fromPreset('paintedMetal', { color: c }),
    plastic: (c) => fromPreset('medPlastic', { color: c }),
    vinyl: (c) => fromPreset('vinyl', { color: c }),
    fabric: (c) => fromPreset('fabric', { color: c }),
    paper: (c) => fromPreset('paper', { color: c }),
    rubber: (c) => fromPreset('rubber', { color: c }),
    wood: (c) => fromPreset('wood', { color: c }),
    glassy: (c, o) => fromPreset('glass', { color: c, transparent: true, opacity: o }),
    screen: (map, c, e, i) => new THREE.MeshStandardMaterial({
      map: map ?? null, color: c, emissive: e, emissiveMap: map ?? null,
      emissiveIntensity: i, roughness: 0.12, metalness: 0.0, envMapIntensity: 1.2, toneMapped: false,
    }),
    /* GLTF 프롭(책상·책장·화분·시계) — 메시/재질 이름으로 범주를 추정해 파라미터만 덮어쓴다.
       맵은 그대로 두고 roughness/metalness/envMapIntensity만 손댄다. */
    tuneGLTF: (root) => {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mm of mats) {
          const m = mm as THREE.MeshStandardMaterial
          if (!m || !('roughness' in m)) continue
          const key = `${o.name} ${m.name}`.toLowerCase()
          if (/metal|steel|chrome|alu|frame|leg|handle/.test(key)) {
            m.roughness = 0.34; m.metalness = 0.82; m.envMapIntensity = 1.5
          } else if (/plastic|vinyl|seat|pad/.test(key)) {
            m.roughness = PRESET.medPlastic.roughness!; m.metalness = 0; m.envMapIntensity = 1.0
          } else if (/wood|oak|shelf|book/.test(key)) {
            m.roughness = PRESET.wood.roughness!; m.metalness = 0; m.envMapIntensity = 0.85
          } else if (/leaf|plant|soil|dirt/.test(key)) {
            m.roughness = 0.72; m.metalness = 0; m.envMapIntensity = 0.7
          } else {
            // 이름으로 못 고르면: 맵이 있는 재질의 metalness가 1로 남아 새까매지는 것만 막고
            // envMapIntensity만 올려 IBL 반사를 살린다.
            if (m.metalness > 0.6 && !m.metalnessMap) m.metalness = 0.35
            m.envMapIntensity = 1.05
          }
          m.needsUpdate = true
        }
      })
    },
  }
}
