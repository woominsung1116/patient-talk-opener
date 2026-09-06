/* 진료실 형상 — lab/fresh/build.js 에서 이식. 변경 시 양쪽을 함께 고쳐라.
   좌표 규약(방 치수·카메라·진찰대 매트 0.68·좌면 0.54·DESK_TOP 0.835)은 ClinicScene.tsx와 공유한다. */
/**
 * 진료실 — 백지에서 다시 지은 형상.
 *
 * 물려받은 것은 **좌표뿐이다**: 방 치수·문/창 위치·책상/의자/진찰대 위치·카메라 두 곳.
 * 벽 만드는 방식, 부품 분할, 조명 배치, 재질 체계는 전부 새로 짰다.
 *
 * 관통하는 규칙 3개:
 *  ① 날카로운 90° 모서리를 만들지 않는다 — 모든 상자는 RoundedBoxGeometry.
 *  ② 덩어리를 부품으로 나눈다 — 몸통/서랍면/손잡이/걸레받이 사이에 2~3mm 틈.
 *  ③ 벽·바닥·천장에 **두께**를 준다 — 판때기 대신 개구부 리빌(reveal)이 있는 상자.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { M, pbr, vinylFloorTextures, blindGobo, paperTexture, tint } from './clinicMats'

/* ── 본 씬에서 그대로 가져온 좌표 (src/three/ClinicScene.tsx) ── */
export const ROOM = { w: 6.4, h: 3.0, backZ: -5.2, frontZ: 1.2 }
export const DOOR = { x: -1.4, w: 1.05, h: 2.15 }
export const WIN = { x: 3.2, y: 1.65, z: -0.9, w: 1.7, h: 1.1 }
export const SEAT_POS = [-0.9, 0, -0.1]      // 환자 의자 (SEAT.pos)
export const SEAT_TOP = 0.54                  // 좌면 높이 — 아바타 sitY=-0.41 전제. 바꾸면 환자가 뜬다.
export const SEAT_SIT_Y = -0.41               // SEAT.sitY — 아바타 루트 y 오프셋
export const SEAT_ROT_Y = -1.1                // SEAT.rotY — 환자가 의사를 바라보는 각
/* 누운 환자 (EXAM.patientPos / EXAM.patientYawY). 안쪽 group에 rotation.x=-90°가 한 겹 더 붙는다. */
export const EXAM_PATIENT = { pos: [2.65, 0.78, -3.5], yawY: Math.PI / 2 }
export const DESK_POS = [-2.05, 0, 0.42]     // 책상 (group[-2.05,0,0.5] + prop[0,0,-0.08])
export const BED = { x: 1.95, z: -3.5, len: 1.9, wide: 0.72, top: 0.68 } // EXAM 침대 — 매트 윗면 0.68

const HX = ROOM.w / 2
const CZ = (ROOM.frontZ + ROOM.backZ) / 2
const DEPTH = ROOM.frontZ - ROOM.backZ
const WT = 0.14 // 벽 두께 — 이게 있어야 문·창에 리빌이 생긴다

/* ══════════ 형상 헬퍼 ══════════ */

/** 모서리가 둥근 상자. 반지름은 크기에 비례하되 가구 스케일에서 1.5~4mm가 되도록 잡는다. */
export function rbox(w: number, h: number, d: number, r: number | null = null, seg = 2) {
  const mn = Math.min(w, h, d)
  const radius = Math.min(r ?? THREE.MathUtils.clamp(mn * 0.09, 0.0018, 0.0045), mn * 0.48)
  return new RoundedBoxGeometry(w, h, d, seg, radius)
}
export function box(w: number, h: number, d: number, mat: THREE.Material, pos?: number[] | null, rot?: number[] | null) {
  const m = new THREE.Mesh(rbox(w, h, d), mat)
  if (pos) m.position.set(pos[0], pos[1], pos[2])
  if (rot) m.rotation.set(rot[0], rot[1], rot[2])
  m.castShadow = true
  m.receiveShadow = true
  return m
}
/** 큰 판(벽·바닥·천장)은 모서리를 둥글릴 이유가 없다 — 폴리곤만 는다. */
export function slab(w: number, h: number, d: number, mat: THREE.Material, pos?: number[] | null, rot?: number[] | null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  if (pos) m.position.set(pos[0], pos[1], pos[2])
  if (rot) m.rotation.set(rot[0], rot[1], rot[2])
  m.receiveShadow = true
  return m
}
export function cyl(rt: number, rb: number, h: number, mat: THREE.Material, pos?: number[] | null, rot?: number[] | null, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)
  if (pos) m.position.set(pos[0], pos[1], pos[2])
  if (rot) m.rotation.set(rot[0], rot[1], rot[2])
  m.castShadow = true
  return m
}
/** 원통 끝단의 날카로움을 없애는 얇은 토러스 챔퍼 */
export function rim(radius: number, tube: number, mat: THREE.Material, pos?: number[] | null, rot?: number[] | null) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 20), mat)
  if (pos) m.position.set(pos[0], pos[1], pos[2])
  if (rot) m.rotation.set(rot[0], rot[1], rot[2])
  return m
}
const g = (...children: (THREE.Object3D | null | undefined)[]) => {
  const o = new THREE.Group(); children.forEach((c) => c && o.add(c)); return o
}

/** 캐비닛 문/서랍면 — 몸통보다 살짝 앞으로 나오고 사이에 GAP 틈이 생기게 배치한다.
 *  틈과 두께가 덩어리를 '부품'으로 만든다. */
const GAP = 0.003
export function drawerFace(w: number, h: number, mat: THREE.Material, pos: number[], handle = 'bar') {
  const grp = new THREE.Group()
  grp.position.set(pos[0], pos[1], pos[2])
  grp.add(box(w, h, 0.018, mat, [0, 0, 0]))
  if (handle === 'bar') {
    const hm = M.steel
    grp.add(box(w * 0.42, 0.012, 0.012, hm, [0, -h * 0.5 + 0.045, 0.031]))
    grp.add(box(0.012, 0.012, 0.026, hm, [-w * 0.21 + 0.006, -h * 0.5 + 0.045, 0.022]))
    grp.add(box(0.012, 0.012, 0.026, hm, [w * 0.21 - 0.006, -h * 0.5 + 0.045, 0.022]))
  } else if (handle === 'pull') {
    grp.add(box(0.012, h * 0.5, 0.012, M.steel, [w * 0.5 - 0.06, 0, 0.03]))
  }
  return grp
}

/** 주름이 있는 커튼 — 평면 카드가 아니라 사인파로 접힌 면. sheen 재질과 함께 써야 천으로 읽힌다. */
export function curtain(width: number, height: number, mat: THREE.Material,
  { amp = 0.055, wave = 0.20, segW = 96, segH = 12 }:
    { amp?: number; wave?: number; segW?: number; segH?: number } = {}) {
  const geo = new THREE.PlaneGeometry(width, height, segW, segH)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const down = (height / 2 - y) / height  // 0=레일, 1=밑단
    // 주름은 아래로 갈수록 벌어지고, 레일 근처는 헤딩테이프에 잡혀 있다
    const spread = 0.35 + 0.65 * down
    // 단일 사인파는 **버티컬 블라인드로 읽힌다**(1차 시도의 실패).
    // 주기가 다른 파를 겹치고 위상을 흔들어야 주름 간격이 불규칙해져 천으로 보인다.
    const base = Math.sin((x / wave) * Math.PI * 2)
    const jitter = Math.sin((x / (wave * 2.7)) * Math.PI * 2 + 1.1) * 0.45
      + Math.sin((x / (wave * 0.62)) * Math.PI * 2 + 2.3) * 0.18
    p.setZ(i, (base + jitter) * amp * spread)
    // 밑단이 살짝 안쪽으로 — 천은 아래에서 자기 무게로 모인다
    if (down > 0.94) p.setX(i, x * 0.995)
  }
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/* ══════════ 방 셸 ══════════ */

function wallMat() {
  const t = pbr('/textures/Plaster001', [1.6, 1.0])
  const n = pbr('/textures/painted_plaster_wall', [2.2, 1.2], {
    color: false, suffix: { normal: '_nor_gl_2k.webp', rough: '_rough_2k.webp' },
  })
  return new THREE.MeshStandardMaterial({
    map: t.map,
    /* 진료실 벽은 흰색이다. Plaster001은 중간 회색이라 그대로 쓰면 반사율 0.6짜리 '지하실 벽'이 된다.
       color를 1.0 이상으로 곱해 얼룩 무늬는 살리고 밝기만 흰 도장 수준(≈0.8)으로 끌어올린다. */
    color: new THREE.Color('#fdfbf6').multiplyScalar(1.42),
    normalMap: n.normalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.85,
    metalness: 0.0,
    /* 벽은 rectAreaLight의 직사광을 거의 못 받고(패널이 아래를 본다) 환경광 비중이 크다.
       병원 HDRI가 푸른 탓에 envMapIntensity가 조금만 높아도 흰 벽이 라벤더로 물든다.
       벽에서는 IBL을 거의 끊고 밝기는 hemisphere/바운스로 채운다. */
    envMapIntensity: 0.08,
  })
}

function floorMat() {
  const t = vinylFloorTextures()
  const rep = [ROOM.w / t.patchMeters, DEPTH / t.patchMeters]
  t.map.repeat.set(rep[0], rep[1])
  t.roughnessMap.repeat.set(rep[0] * 1.7, rep[1] * 1.7)
  return new THREE.MeshStandardMaterial({
    map: t.map,
    color: new THREE.Color('#bdbcb7'), // 바닥이 흰색에 가까우면 천장등 반사가 안 보인다 — 한 톤 낮춘다
    roughnessMap: t.roughnessMap,
    roughness: 0.85,     // roughnessMap(≈0.30)에 곱해져 0.25 근처 — 흐릿하게 늘어진 반사
    metalness: 0.0,
    envMapIntensity: 0.45,
  })
}

function ceilingMat() {
  // 600각 미네랄 텍스 천장재. 실제 타일 크기에 맞춰 repeat를 계산한다(이미지 1장 ≈ 3.6m).
  const t = pbr('/textures/OfficeCeiling001', [ROOM.w / 3.6, DEPTH / 3.6])
  return new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    color: new THREE.Color('#f4f6f3').multiplyScalar(1.22), roughness: 0.92, metalness: 0, envMapIntensity: 0.35,
  })
}

/** 벽 상자 하나 (내부 면이 정확히 경계에 오도록 바깥으로 두께를 준다) */
function wallSlab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material) {
  const m = slab(x1 - x0, y1 - y0, z1 - z0, mat, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
  m.castShadow = true
  return m
}

/** 걸레받이(코브 베이스) — 벽 하단 10cm 띠. 이거 하나로 벽이 벽이 된다. */
function coveBase(len: number, mat: THREE.Material = M.cove) {
  const grp = new THREE.Group()
  grp.add(box(len, 0.10, 0.016, mat, [0, 0.05, 0]))
  // 상단 캡 — 살짝 튀어나온 마감선. 여기서 엣지 하이라이트가 생긴다
  grp.add(box(len, 0.008, 0.020, mat, [0, 0.102, 0.001]))
  return grp
}

/** 크래시 레일 — 병원 벽에 반드시 있는 보호대. 벽에 수평선 하나가 생기면 스케일이 읽힌다. */
function crashRail(len: number) {
  const grp = new THREE.Group()
  grp.add(box(len, 0.135, 0.022, M.crashRail, [0, 0, 0]))
  grp.add(box(len, 0.012, 0.030, M.crashRail, [0, 0.070, 0.002]))
  grp.add(box(len, 0.012, 0.030, M.crashRail, [0, -0.070, 0.002]))
  return grp
}

export function buildShell() {
  const root = new THREE.Group()
  const wm = wallMat()

  /* 바닥 — 병원용 비닐 시트(절차적). 위 rectAreaLight가 흐릿하게 늘어져 비친다. */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, DEPTH), floorMat())
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, CZ)
  floor.receiveShadow = true
  root.add(floor)

  /* 천장 — 텍스처 면 + **실제 T바 그리드 지오메트리**.
     텍스처만으로는 평면이라 눈이 속지 않는다. 1cm 깊이의 그리드가 있어야 천장이 천장이 된다. */
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, DEPTH), ceilingMat())
  ceil.rotation.x = Math.PI / 2
  ceil.position.set(0, ROOM.h, CZ)
  ceil.receiveShadow = true
  root.add(ceil)

  const rails = []
  const NX = 10, NZ = 11
  const sx = ROOM.w / NX, sz = DEPTH / NZ
  for (let i = 0; i <= NX; i++) {
    const gm = new THREE.BoxGeometry(0.021, 0.011, DEPTH)
    gm.translate(-HX + i * sx, ROOM.h - 0.006, CZ)
    rails.push(gm)
  }
  for (let j = 0; j <= NZ; j++) {
    const gm = new THREE.BoxGeometry(ROOM.w, 0.011, 0.021)
    gm.translate(0, ROOM.h - 0.006, ROOM.backZ + j * sz)
    rails.push(gm)
  }
  const grid = new THREE.Mesh(mergeGeometries(rails), tint(M.paintedMetal, '#f3f5f1', { roughness: 0.5 }))
  grid.receiveShadow = true
  root.add(grid)

  /* ── 벽 ── */
  // 좌측 벽 (한 장)
  root.add(wallSlab(-HX - WT, -HX, 0, ROOM.h, ROOM.backZ - WT, ROOM.frontZ + WT, wm))
  // 앞쪽 벽 (의사 등 뒤)
  root.add(wallSlab(-HX - WT, HX + WT, 0, ROOM.h, ROOM.frontZ, ROOM.frontZ + WT, wm))

  // 뒷벽 — 문 개구부를 남긴 3장 + 리빌
  const dL = DOOR.x - DOOR.w / 2
  const dR = DOOR.x + DOOR.w / 2
  root.add(wallSlab(-HX, dL, 0, ROOM.h, ROOM.backZ - WT, ROOM.backZ, wm))
  root.add(wallSlab(dR, HX, 0, ROOM.h, ROOM.backZ - WT, ROOM.backZ, wm))
  root.add(wallSlab(dL, dR, DOOR.h, ROOM.h, ROOM.backZ - WT, ROOM.backZ, wm))

  // 우측 벽 — 창 개구부를 남긴 4장
  const wz0 = WIN.z - WIN.w / 2, wz1 = WIN.z + WIN.w / 2
  const wy0 = WIN.y - WIN.h / 2, wy1 = WIN.y + WIN.h / 2
  root.add(wallSlab(HX, HX + WT, 0, ROOM.h, ROOM.backZ - WT, wz0, wm))
  root.add(wallSlab(HX, HX + WT, 0, ROOM.h, wz1, ROOM.frontZ + WT, wm))
  root.add(wallSlab(HX, HX + WT, 0, wy0, wz0, wz1, wm))
  root.add(wallSlab(HX, HX + WT, wy1, ROOM.h, wz0, wz1, wm))

  /* ── 걸레받이 · 크래시 레일 ── */
  const cbL = coveBase(DEPTH); cbL.position.set(-HX + 0.008, 0, CZ); cbL.rotation.y = Math.PI / 2; root.add(cbL)
  const cbR = coveBase(DEPTH); cbR.position.set(HX - 0.008, 0, CZ); cbR.rotation.y = -Math.PI / 2; root.add(cbR)
  const cbF = coveBase(ROOM.w); cbF.position.set(0, 0, ROOM.frontZ - 0.008); cbF.rotation.y = Math.PI; root.add(cbF)
  const cbB1 = coveBase(dL + HX); cbB1.position.set((-HX + dL) / 2, 0, ROOM.backZ + 0.008); root.add(cbB1)
  const cbB2 = coveBase(HX - dR); cbB2.position.set((dR + HX) / 2, 0, ROOM.backZ + 0.008); root.add(cbB2)

  const crL = crashRail(DEPTH - 0.1); crL.position.set(-HX + 0.012, 0.87, CZ); crL.rotation.y = Math.PI / 2; root.add(crL)
  const crB = crashRail(HX - dR - 0.05); crB.position.set((dR + HX) / 2 + 0.02, 0.87, ROOM.backZ + 0.012); root.add(crB)
  // 우측 벽 — 창 아래를 지나는 레일. 이게 없으면 창 옆이 거대한 빈 회색 면으로 남는다.
  const crR1 = crashRail(3.0); crR1.position.set(HX - 0.012, 0.87, -3.5); crR1.rotation.y = -Math.PI / 2; root.add(crR1)
  const crR2 = crashRail(1.55); crR2.position.set(HX - 0.012, 0.87, 0.3); crR2.rotation.y = -Math.PI / 2; root.add(crR2)

  /* 코너 가드 — 병원 벽 모서리에 반드시 있다. 수직선 하나가 공간의 깊이를 만든다. */
  for (const [cx, cz2, ry] of [[-HX + 0.04, ROOM.backZ + 0.04, 0], [HX - 0.04, ROOM.backZ + 0.04, 0]]) {
    const guard = box(0.055, 1.7, 0.055, tint(M.plastic, '#dfe4e0', { roughness: 0.5 }), [cx, 0.95, cz2], [0, ry + Math.PI / 4, 0])
    root.add(guard)
  }

  root.add(buildDoor())
  root.add(buildWindow())
  return root
}

/* ══════════ 문 — 판때기가 아니라 문틀+문짝+레버+킥플레이트 ══════════ */
function buildDoor() {
  const grp = new THREE.Group()
  const dL = DOOR.x - DOOR.w / 2
  const paint = tint(M.paintedMetal, '#f0f2ef', { roughness: 0.42, metalness: 0.1 })

  // 개구부 리빌(안쪽 면) — 벽 두께가 보이는 부분
  grp.add(slab(0.02, DOOR.h, WT, paint, [dL + 0.01, DOOR.h / 2, ROOM.backZ - WT / 2]))
  grp.add(slab(0.02, DOOR.h, WT, paint, [dL + DOOR.w - 0.01, DOOR.h / 2, ROOM.backZ - WT / 2]))
  grp.add(slab(DOOR.w, 0.02, WT, paint, [DOOR.x, DOOR.h - 0.01, ROOM.backZ - WT / 2]))

  // 케이싱(문선) — 벽면에서 18mm 튀어나온 테두리. 여기 엣지 하이라이트가 생긴다
  const cw = 0.07
  grp.add(box(cw, DOOR.h + cw, 0.018, paint, [dL - cw / 2, (DOOR.h + cw) / 2 - cw / 2, ROOM.backZ + 0.009]))
  grp.add(box(cw, DOOR.h + cw, 0.018, paint, [dL + DOOR.w + cw / 2, (DOOR.h + cw) / 2 - cw / 2, ROOM.backZ + 0.009]))
  grp.add(box(DOOR.w + cw * 2, cw, 0.018, paint, [DOOR.x, DOOR.h + cw / 2, ROOM.backZ + 0.009]))

  /* 문짝 — 개구부 안쪽에 앉는다(리빌 중간). 두 장의 음각 패널.
     ⚠ 경첩 그룹을 **문 왼쪽 모서리**에 두고 그 안에 문짝을 offset 시킨다.
        문짝 중심을 회전시키면 문이 벽을 파고든다. RoomShell이 `doorHinge`를 찾아 rotation.y를 준다. */
  const hinge = new THREE.Group()
  hinge.name = 'doorHinge'
  hinge.position.set(DOOR.x - DOOR.w / 2, 0, ROOM.backZ - 0.055)
  grp.add(hinge)
  const leaf = new THREE.Group()
  leaf.position.set(DOOR.w / 2, 0, 0)
  hinge.add(leaf)
  const leafMat = tint(M.paintedMetal, '#e6e9e5', { roughness: 0.4, metalness: 0.12 })
  leaf.add(box(DOOR.w - 0.02, DOOR.h - 0.02, 0.042, leafMat, [0, DOOR.h / 2, 0]))
  for (const [py, ph] of [[1.52, 0.98], [0.52, 0.78]]) {
    // 음각 패널 = 살짝 들어간 면 + 몰딩 테두리
    leaf.add(box(DOOR.w - 0.22, ph, 0.006, leafMat, [0, py, 0.020]))
    leaf.add(box(DOOR.w - 0.19, ph + 0.03, 0.010, leafMat, [0, py, 0.016]))
  }
  // 레버 핸들 (노브가 아니라 레버 — 병원 표준)
  leaf.add(cyl(0.028, 0.028, 0.014, M.steel, [DOOR.w / 2 - 0.09, 1.03, 0.026], [Math.PI / 2, 0, 0], 16))
  leaf.add(box(0.105, 0.020, 0.020, M.steel, [DOOR.w / 2 - 0.145, 1.03, 0.040]))
  // 킥플레이트 (스테인리스) + 경첩 3개
  leaf.add(box(DOOR.w - 0.08, 0.24, 0.004, M.steelDull, [0, 0.16, 0.023]))
  for (const hy of [0.28, 1.08, 1.88]) {
    leaf.add(cyl(0.014, 0.014, 0.09, M.steelDull, [-DOOR.w / 2 + 0.012, hy, 0.0], [0, 0, 0], 10))
  }
  // 도어 클로저 — 병원 문에는 거의 항상 있다
  leaf.add(box(0.20, 0.06, 0.05, M.paintedMetalDark, [-0.18, DOOR.h - 0.12, 0.03]))
  leaf.add(box(0.22, 0.014, 0.014, M.steelDull, [0.02, DOOR.h - 0.10, 0.05], [0, 0, -0.25]))
  // 문 너머 복도 — 밝은 편이 자연스럽다(어두운 구멍은 호러 신호)
  const hall = new THREE.Mesh(
    new THREE.PlaneGeometry(DOOR.w + 0.4, DOOR.h + 0.3),
    new THREE.MeshBasicMaterial({ color: '#b9c2c4' }),
  )
  hall.position.set(DOOR.x, DOOR.h / 2, ROOM.backZ - 0.7)
  grp.add(hall)

  // 진료실 번호 사인 — 벽에 붙은 작은 사물 하나가 "쓰이는 방"을 만든다
  const signTex = paperTexture(256, 128, (c, W, H) => {
    c.fillStyle = '#eceef0'; c.fillRect(0, 0, W, H)
    c.fillStyle = '#2f4858'; c.fillRect(0, 0, W, 26)
    c.fillStyle = '#1d2b33'; c.font = 'bold 52px sans-serif'; c.textAlign = 'center'
    c.fillText('제 3 진료실', W / 2, 92)
  })
  const sign = box(0.24, 0.12, 0.008, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.4, metalness: 0.1 }),
    [DOOR.x + DOOR.w / 2 + 0.20, 1.62, ROOM.backZ + 0.006])
  grp.add(sign)

  return grp
}

/* ══════════ 창 — 리빌 + 창틀 + 창대 + 블라인드 + 과노출된 바깥 ══════════ */
function buildWindow() {
  const grp = new THREE.Group()
  const wz0 = WIN.z - WIN.w / 2, wz1 = WIN.z + WIN.w / 2
  const wy0 = WIN.y - WIN.h / 2, wy1 = WIN.y + WIN.h / 2
  const paint = tint(M.paintedMetal, '#f2f4f1', { roughness: 0.4, metalness: 0.1 })

  // 리빌
  grp.add(slab(WT, 0.02, WIN.w, paint, [HX + WT / 2, wy1 - 0.01, WIN.z]))
  grp.add(slab(WT, WIN.h, 0.02, paint, [HX + WT / 2, WIN.y, wz0 + 0.01]))
  grp.add(slab(WT, WIN.h, 0.02, paint, [HX + WT / 2, WIN.y, wz1 - 0.01]))
  // 창대 — 방 안으로 5cm 튀어나오고 코가 둥글다
  grp.add(box(WT + 0.05, 0.028, WIN.w + 0.06, paint, [HX + WT / 2 - 0.025, wy0 + 0.014, WIN.z], null))

  // 창틀 + 중간 멀리언
  const fr = 0.045
  grp.add(box(0.05, fr, WIN.w, paint, [HX - 0.025, wy1 - fr / 2, WIN.z]))
  grp.add(box(0.05, fr, WIN.w, paint, [HX - 0.025, wy0 + fr / 2, WIN.z]))
  grp.add(box(0.05, WIN.h, fr, paint, [HX - 0.025, WIN.y, wz0 + fr / 2]))
  grp.add(box(0.05, WIN.h, fr, paint, [HX - 0.025, WIN.y, wz1 - fr / 2]))
  grp.add(box(0.05, WIN.h, 0.03, paint, [HX - 0.025, WIN.y, WIN.z]))

  // 유리 2장
  for (const zc of [(wz0 + WIN.z) / 2, (wz1 + WIN.z) / 2]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w / 2 - 0.08, WIN.h - 0.1), M.glass)
    pane.rotation.y = -Math.PI / 2
    pane.position.set(HX - 0.02, WIN.y, zc)
    grp.add(pane)
  }

  // 바깥 — 과노출된 흰 면. 실내 촬영에서 실제로 이렇게 보인다(§6.6c)
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w + 0.6, WIN.h + 0.6), M.sky)
  sky.rotation.y = -Math.PI / 2
  sky.position.set(HX + WT + 0.02, WIN.y, WIN.z)
  grp.add(sky)

  // 블라인드 — 절반쯤 내린 상태. 슬랫마다 실제 각도가 있다
  // (헤드레일은 창 길이축인 **Z**를 따라 놓인다. X로 놓으면 방 안으로 1.6m 막대가 튀어나온다)
  const slatMat = tint(M.plastic, '#e9ece9', { roughness: 0.6 })
  const head = box(0.05, 0.05, WIN.w - 0.12, paint, [HX - 0.075, wy1 - 0.045, WIN.z], [0, 0, 0])
  grp.add(head)
  const N = 17
  for (let i = 0; i < N; i++) {
    const y = wy1 - 0.10 - i * 0.048
    const s = new THREE.Mesh(rbox(0.052, 0.0022, WIN.w - 0.14, 0.0011, 1), slatMat)
    s.position.set(HX - 0.075, y, WIN.z)
    s.rotation.z = -0.62
    s.castShadow = false // 실제 그림자 대신 고보 투영을 쓴다 (얇은 슬랫 17장은 섀도맵을 갉아먹는다)
    s.receiveShadow = true
    grp.add(s)
  }
  // 조작 봉
  grp.add(cyl(0.005, 0.005, 0.5, slatMat, [HX - 0.075, wy1 - 0.32, wz0 + 0.09], null, 8))
  return grp
}

/* ══════════ 천장 조명 — 면광원(troffer) ══════════
   점광원은 그림자가 딱딱해 즉시 CG로 읽힌다. 실제 형광등은 넓적한 패널이다.
   rectAreaLight는 그림자를 못 만드는 대신 **바닥에 흐릿하게 늘어진 반사(스페큘러)**를 만든다 —
   이게 병원의 대표 시각 신호다. 그림자는 위쪽 directional 하나가 전담한다. */
export const TROFFERS = [
  [-1.3, -1.8], [1.3, -1.8],
  [-1.3, -3.8], [1.3, -3.8],
  [-1.3, 0.2], [1.3, 0.2],   // 책상 위가 어두워서 2개 추가 (본 씬은 4개뿐이다)
]
/** rectAreaLight 개수 — LTC 평가가 픽셀당 N회라 성능에 직결된다. 6개가 랩 실측 기준값. */
const TROFFER_LIGHTS = 6
/** 천장 형광등(troffer)만 만든다 — 하우징 + 발광 디퓨저 + rectAreaLight.
 *  본 씬은 자체 directional/hemisphere/얼굴 키 스팟을 이미 갖고 있어 그건 건드리지 않는다.
 *  ⚠ rectAreaLight를 쓰려면 호출 전에 `RectAreaLightUniformsLib.init()` 가 한 번 실행돼야 한다. */
export function buildTroffers(): THREE.Group {
  const grp = new THREE.Group()
  const PW = 1.24, PD = 0.60
  TROFFERS.forEach(([x, z], i) => {
    // 패널별 색온도 ±100K 편차 — 실제 진료실은 패널마다 미세하게 다르다. 깜빡임은 넣지 않는다.
    const k = [0.998, 1.006, 1.0, 0.994, 1.004, 0.997][i]
    const col = new THREE.Color(1.0 * (2 - k), 0.985, 0.955 * k)
    grp.add(slab(PW + 0.06, 0.10, PD + 0.06, tint(M.paintedMetal, '#e2e5e2'), [x, ROOM.h - 0.05, z]))
    const diff = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), M.diffuser.clone())
    diff.material.emissive = col
    diff.material.emissiveIntensity = 1.5
    diff.rotation.x = Math.PI / 2
    diff.position.set(x, ROOM.h - 0.018, z)
    grp.add(diff)
    grp.add(box(PW + 0.05, 0.012, 0.028, tint(M.paintedMetal, '#eceee9'), [x, ROOM.h - 0.014, z - PD / 2 - 0.014]))
    grp.add(box(PW + 0.05, 0.012, 0.028, tint(M.paintedMetal, '#eceee9'), [x, ROOM.h - 0.014, z + PD / 2 + 0.014]))
    grp.add(box(0.028, 0.012, PD, tint(M.paintedMetal, '#eceee9'), [x - PW / 2 - 0.014, ROOM.h - 0.014, z]))
    grp.add(box(0.028, 0.012, PD, tint(M.paintedMetal, '#eceee9'), [x + PW / 2 + 0.014, ROOM.h - 0.014, z]))
    if (i < TROFFER_LIGHTS) {
      const ra = new THREE.RectAreaLight(col, 6.6, PW, PD)
      ra.position.set(x, ROOM.h - 0.03, z)
      ra.rotation.x = -Math.PI / 2
      grp.add(ra)
    }
  })
  return grp
}

export function buildLights(scene: THREE.Scene) {
  const grp = new THREE.Group()
  const lights: THREE.RectAreaLight[] = []
  const PW = 1.24, PD = 0.60
  TROFFERS.forEach(([x, z], i) => {
    // 패널별 색온도 ±100K 편차 — 실제 진료실은 패널마다 미세하게 다르다. 깜빡임은 넣지 않는다.
    // 기준은 4500K 근처의 **중성 백색**. 여기가 푸르면 방 전체가 라벤더로 돌아 버린다(1차 시도의 실패).
    const k = [0.998, 1.006, 1.0, 0.994, 1.004, 0.997][i]
    const col = new THREE.Color(1.0 * (2 - k), 0.985, 0.955 * k)

    // 하우징(천장에 파묻힌 형태) + 디퓨저
    grp.add(slab(PW + 0.06, 0.10, PD + 0.06, tint(M.paintedMetal, '#e2e5e2'), [x, ROOM.h - 0.05, z]))
    const diff = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), M.diffuser.clone())
    diff.material.emissive = col
    diff.material.emissiveIntensity = 1.5
    diff.rotation.x = Math.PI / 2
    diff.position.set(x, ROOM.h - 0.018, z)
    grp.add(diff)
    // 디퓨저 테두리(도장 금속) — 발광면과 천장 사이의 얇은 프레임
    grp.add(box(PW + 0.05, 0.012, 0.028, tint(M.paintedMetal, '#eceee9'), [x, ROOM.h - 0.014, z - PD / 2 - 0.014]))
    grp.add(box(PW + 0.05, 0.012, 0.028, tint(M.paintedMetal, '#eceee9'), [x, ROOM.h - 0.014, z + PD / 2 + 0.014]))
    grp.add(box(0.028, 0.012, PD, tint(M.paintedMetal, '#eceee9'), [x - PW / 2 - 0.014, ROOM.h - 0.014, z]))
    grp.add(box(0.028, 0.012, PD, tint(M.paintedMetal, '#eceee9'), [x + PW / 2 + 0.014, ROOM.h - 0.014, z]))

    if (i < TROFFER_LIGHTS) {
      const ra = new THREE.RectAreaLight(col, 6.6, PW, PD)
      ra.position.set(x, ROOM.h - 0.03, z)
      ra.rotation.x = -Math.PI / 2
      grp.add(ra)
      lights.push(ra)
    }
  })

  // 그림자 전담 — 넓고 부드럽게. 위에서 살짝 앞으로.
  const key = new THREE.DirectionalLight('#fbfaf6', 0.5)
  key.position.set(0.8, 6.2, 0.6)
  key.target.position.set(0.4, 0, -2.6)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -4.2
  key.shadow.camera.right = 4.2
  key.shadow.camera.top = 4.6
  key.shadow.camera.bottom = -4.6
  key.shadow.camera.far = 12
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.02
  grp.add(key, key.target)

  // 창 빛 — 고보 투영으로 바닥·벽에 블라인드 띠를 만든다. 아주 약하게.
  const win = new THREE.SpotLight('#eaf3ff', 9.0, 12, 0.66, 0.42, 1.25)
  win.position.set(HX + 0.5, WIN.y + 0.30, WIN.z)
  win.target.position.set(-1.2, 0, WIN.z - 1.9)
  win.map = blindGobo()
  win.castShadow = true
  win.shadow.mapSize.set(1024, 1024)
  win.shadow.bias = -0.0008
  win.shadow.camera.near = 0.4
  grp.add(win, win.target)

  /* 환자 얼굴 키라이트 — **재작성 때 빠뜨린 조명이다.**
     천장 면광원만으로는 위를 향한 가슴은 밝고 수직면인 얼굴은 어두워진다(실측: 얼굴 95.6 vs 가슴 103.2).
     본 씬은 이걸 `SEAT.keyLightPos` 스팟으로 해결하고 있었다. 값은 본 씬 그대로다.
     ?facekey=0 으로 끌 수 있다(A/B 진단용). */
  {
    const faceKey = new THREE.SpotLight('#fff0e4', 1.9, 5.5, 0.58, 1, 2)
    faceKey.position.set(-1.0, 2.4, 0.7)
    faceKey.target.position.set(-0.92, 1.08, 0.0)
    faceKey.castShadow = true
    faceKey.shadow.mapSize.set(1024, 1024)
    faceKey.shadow.bias = -0.0002
    faceKey.shadow.normalBias = 0.012
    grp.add(faceKey, faceKey.target)
  }

  // 균일 채움 — 천장/바닥 색이 다른 자연스러운 반구광. 여기에 의존하면 납작해지므로 낮게.
  const hemi = new THREE.HemisphereLight('#fbfaf6', '#cfcdc6', 0.40)
  grp.add(hemi)

  scene.add(grp)
  return { group: grp, lights, key, win }
}

/* ══════════ 진찰대 — 이 씬의 주인공 (진찰 카메라가 정면으로 본다) ══════════
   상자 하나가 아니라: 걸레받이 / 몸통 / 서랍면 3장 / 손잡이 / 상판 / 스테인리스 프레임 /
   비닐 매트 2분할 / 종이 커버 / 발판. 사이의 틈이 부품을 부품으로 만든다. */
export function buildExamTable() {
  const grp = new THREE.Group()
  grp.position.set(BED.x, 0, BED.z)
  const L = BED.len, W = BED.wide
  const bodyMat = tint(M.paintedMetal, '#eaece8', { roughness: 0.44 })
  const faceMat = tint(M.paintedMetal, '#e2e5e1', { roughness: 0.42 })

  // 걸레받이(토킥) — 안쪽으로 들어가 있어야 가구가 바닥에 떠 보이지 않는다
  grp.add(box(L - 0.18, 0.085, W - 0.14, M.paintedMetalDark, [0, 0.0425, 0]))
  // 몸통
  grp.add(box(L - 0.10, 0.47, W - 0.06, bodyMat, [0, 0.085 + 0.235, 0]))
  // 의사 쪽(+z) 면: 서랍 2 + 문 1. 몸통보다 앞으로 나오고 사이에 3mm 틈.
  const fz = (W - 0.06) / 2 + 0.010
  grp.add(drawerFace(0.52, 0.135, faceMat, [-0.52, 0.475, fz]))
  grp.add(drawerFace(0.52, 0.135, faceMat, [-0.52, 0.475 - 0.135 - GAP * 2, fz]))
  grp.add(drawerFace(0.52, 0.28, faceMat, [-0.52, 0.20, fz], 'bar'))
  grp.add(drawerFace(0.60, 0.135, faceMat, [0.16, 0.475, fz]))
  grp.add(drawerFace(0.60, 0.415, faceMat, [0.16, 0.25, fz], 'pull'))

  // 상판 캡 + 스테인리스 사이드 레일 (매트를 받치는 프레임이 보여야 한다)
  grp.add(box(L - 0.06, 0.028, W - 0.02, tint(M.paintedMetal, '#dcdfdb'), [0, 0.585, 0]))
  grp.add(box(L - 0.02, 0.022, 0.022, M.steel, [0, 0.605, W / 2 - 0.03]))
  grp.add(box(L - 0.02, 0.022, 0.022, M.steel, [0, 0.605, -W / 2 + 0.03]))

  // 비닐 매트 — 2분할(등받이 / 좌면), 4mm 이음매. 모서리 반지름을 크게(쿠션이니까).
  const matH = 0.095
  const matY = BED.top - matH / 2
  const headL = 0.78, seatL = L - headL - 0.008
  const mkPad = (len: number, cx: number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(len, matH, W - 0.02, 3, 0.028), M.vinylPad)
    m.position.set(cx, matY, 0)
    m.castShadow = true; m.receiveShadow = true
    return m
  }
  grp.add(mkPad(headL, -L / 2 + headL / 2 + 0.01))
  grp.add(mkPad(seatL, L / 2 - seatL / 2 - 0.01))

  // 종이 커버 — 롤에서 뽑아 깐 **띠**다. 매트를 전부 덮으면 흰 식탁보로 보인다(1차 시도의 실패).
  // 폭을 좁혀 양옆으로 비닐 매트가 보이게 해야 두 재질이 대비된다.
  const pg = new THREE.PlaneGeometry(L - 0.20, 0.44, 40, 8)
  const pp = pg.attributes.position
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i)
    pp.setZ(i, Math.sin(x * 7.3) * 0.0016 + Math.sin(y * 11.0 + x * 2.0) * 0.0012)
  }
  pg.computeVertexNormals()
  const paper = new THREE.Mesh(pg, M.paper)
  paper.rotation.x = -Math.PI / 2
  paper.rotation.z = 0.004 // 1° 미만의 비뚤어짐
  paper.position.set(-0.02, BED.top + 0.003, 0)
  paper.receiveShadow = true
  grp.add(paper)

  // 페이퍼 롤 디스펜서 — 머리쪽(-x) 끝
  const roll = cyl(0.062, 0.062, W - 0.14, M.paper, [-L / 2 - 0.055, BED.top - 0.02, 0], [Math.PI / 2, 0, 0], 20)
  grp.add(roll)
  grp.add(box(0.03, 0.16, 0.03, M.steelDull, [-L / 2 - 0.055, BED.top - 0.10, W / 2 - 0.08]))
  grp.add(box(0.03, 0.16, 0.03, M.steelDull, [-L / 2 - 0.055, BED.top - 0.10, -W / 2 + 0.08]))

  // 발 디딤대 (발쪽 +x, 아래로 빼둔 상태)
  grp.add(box(0.42, 0.035, W - 0.16, M.steelDull, [L / 2 - 0.12, 0.235, 0]))
  grp.add(box(0.03, 0.20, 0.03, M.steelDull, [L / 2 - 0.28, 0.13, 0]))

  /* 접힌 시트 더미는 **의도적으로 넣지 않는다** (사용자 지시 2026-07-25:
     "침대에도 이상한 문서같은 거 놔두지마"). 얇은 층 3장을 쌓아 '접힌 천'을 흉내냈는데
     화면에서는 연한 청록 판이 겹쳐 보여 **서류 뭉치로 읽혔다.**
     게다가 놓였던 자리(-x, 머리쪽)가 **환자 머리가 오는 곳**이라, 키 큰 아바타
     (mh_m70, 1.71m)의 머리가 그 위에 얹혔다.

     판단 기준: **진찰대의 구조적 부속인가, 올려놓은 물건인가.**
     페이퍼 롤·발 디딤대·사이드 레일은 부속이라 남기고, 접힌 시트는 물건이라 뺀다.
     같은 원칙이 책상에도 적용된다 — 본 씬 Desk()의 품목 외에 얹지 마라. */

  grp.rotation.y = 0 // 침대 장축이 이미 월드 X — 본 씬의 rotY=-π/2와 동일한 결과
  return grp
}

/* ══════════ 카운터 + 싱크 (뒷벽 오른쪽) ══════════ */
export function buildCounter() {
  const grp = new THREE.Group()
  const x0 = 0.30, x1 = 2.95
  const W = x1 - x0, D = 0.58, H = 0.88
  const cx = (x0 + x1) / 2, cz = ROOM.backZ + D / 2
  grp.position.set(cx, 0, cz)
  const bodyMat = tint(M.paintedMetal, '#edefeb', { roughness: 0.44 })
  const faceMat = tint(M.paintedMetal, '#e4e7e3', { roughness: 0.42 })

  grp.add(box(W - 0.14, 0.09, D - 0.10, M.paintedMetalDark, [0, 0.045, 0.03]))
  grp.add(box(W, H - 0.09, D, bodyMat, [0, 0.09 + (H - 0.09) / 2, 0]))
  // 상판 — 앞으로 2cm 오버행 + 둥근 코. 오버행이 있어야 상판이 상판으로 보인다
  grp.add(box(W + 0.02, 0.036, D + 0.04, M.laminate, [0, H + 0.018, 0.02]))
  // 백스플래시
  grp.add(box(W + 0.02, 0.09, 0.018, M.laminate, [0, H + 0.081, -D / 2 + 0.009]))

  // 문/서랍 4칸 — 3mm 틈
  const fz = D / 2 + 0.010
  const cellW = (W - 0.05) / 4
  for (let i = 0; i < 4; i++) {
    const px = -W / 2 + 0.025 + cellW * (i + 0.5)
    if (i === 1) continue // 싱크 아래는 문 하나(아래 참조)
    grp.add(drawerFace(cellW - GAP * 2, 0.155, faceMat, [px, H - 0.11, fz]))
    grp.add(drawerFace(cellW - GAP * 2, H - 0.32, faceMat, [px, (H - 0.32) / 2 + 0.11, fz], 'pull'))
  }
  const px1 = -W / 2 + 0.025 + cellW * 1.5
  grp.add(drawerFace(cellW - GAP * 2, H - 0.16, faceMat, [px1, (H - 0.16) / 2 + 0.10, fz], 'pull'))

  // 싱크 — 스테인리스 볼 + 림 + 구스넥 수전
  const sx = -W / 2 + 0.025 + cellW * 1.5
  const bowl = new THREE.Mesh(new RoundedBoxGeometry(0.40, 0.17, 0.31, 3, 0.03), M.steelDull)
  bowl.position.set(sx, H - 0.06, 0.02)
  bowl.receiveShadow = true
  grp.add(bowl)
  const inner = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.16, 0.27, 3, 0.025), M.steel)
  inner.position.set(sx, H - 0.035, 0.02)
  inner.material = tint(M.steelDull, '#8f9698', { roughness: 0.35 })
  grp.add(inner)
  grp.add(rim(0.012, 0.004, M.steel, [sx, H + 0.036, 0.02], [Math.PI / 2, 0, 0]))
  // 수전
  grp.add(cyl(0.017, 0.021, 0.11, M.steel, [sx, H + 0.09, -0.19], null, 14))
  const neck = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 8, 20, Math.PI * 0.85), M.steel)
  neck.position.set(sx, H + 0.145, -0.19)
  neck.rotation.set(Math.PI / 2, 0, Math.PI * 0.06)
  grp.add(neck)
  grp.add(box(0.14, 0.018, 0.018, M.steel, [sx + 0.10, H + 0.135, -0.19], [0, 0, 0.35])) // 팔꿈치 레버(병원용)

  // 카운터 위 — 생활 흔적. 진찰 시야가 아니라 배경이므로 여기는 채워도 된다.
  grp.add(box(0.13, 0.20, 0.13, tint(M.plastic, '#f2c53d', { roughness: 0.5 }), [W / 2 - 0.28, H + 0.135, 0.06])) // 샤프스 컨테이너
  grp.add(box(0.13, 0.02, 0.13, tint(M.plastic, '#e2e6e0'), [W / 2 - 0.28, H + 0.245, 0.06]))
  grp.add(box(0.11, 0.19, 0.11, tint(M.plastic, '#f4f6f2'), [-W / 2 + 0.22, H + 0.13, 0.05]))      // 소독제 통
  grp.add(cyl(0.016, 0.016, 0.07, M.plastic, [-W / 2 + 0.22, H + 0.26, 0.05], null, 10))
  return grp
}

/* ══════════ 벽 부착물 ══════════ */
export function buildWallFixtures() {
  const grp = new THREE.Group()

  // 장갑 박스 3개 (뒷벽 카운터 위) — 실제 진료실에서 가장 눈에 띄는 색 요소
  const gloveColors = ['#dfe6e8', '#e8ded0', '#dce8dd']
  gloveColors.forEach((c, i) => {
    const gx = 0.62 + i * 0.30
    const b = box(0.26, 0.13, 0.09, tint(M.plastic, c, { roughness: 0.6 }), [gx, 1.42, ROOM.backZ + 0.055])
    b.rotation.y = (i - 1) * 0.02
    grp.add(b)
    grp.add(box(0.28, 0.15, 0.02, M.steelDull, [gx, 1.42, ROOM.backZ + 0.012]))
    // 삐져나온 장갑 한 짝
    grp.add(box(0.07, 0.035, 0.02, tint(M.plastic, '#cfe4ea', { roughness: 0.75 }), [gx + 0.04, 1.487, ROOM.backZ + 0.085], [0.3, 0, 0.2]))
  })

  // 손소독 디스펜서 (문 옆 — 손 닿는 자리)
  const disp = g(
    box(0.11, 0.24, 0.10, tint(M.plastic, '#f4f6f3'), [0, 0, 0]),
    box(0.09, 0.05, 0.06, tint(M.plastic, '#dfe6e4'), [0, -0.145, 0.02]),
    box(0.07, 0.14, 0.02, tint(M.plastic, '#cfe0dd', { roughness: 0.3 }), [0, 0.02, 0.052]),
  )
  disp.position.set(-0.62, 1.35, ROOM.backZ + 0.05)
  grp.add(disp)

  // 페이퍼타월 디스펜서 (싱크 위)
  grp.add(box(0.28, 0.34, 0.13, tint(M.plastic, '#eceee9'), [1.05, 1.42, ROOM.backZ + 0.065]))
  grp.add(box(0.24, 0.02, 0.10, M.paper, [1.05, 1.24, ROOM.backZ + 0.06]))

  // 전등 스위치 + 콘센트 — 작지만 스케일을 읽게 해준다
  grp.add(box(0.085, 0.125, 0.012, tint(M.plastic, '#f2f4f1'), [-0.60, 1.22, ROOM.backZ + 0.006]))
  grp.add(box(0.075, 0.055, 0.014, tint(M.plastic, '#f7f8f5'), [3.19, 0.32, -2.3], [0, -Math.PI / 2, 0]))
  grp.add(box(0.075, 0.055, 0.014, tint(M.plastic, '#f7f8f5'), [-3.19, 0.32, -1.2], [0, Math.PI / 2, 0]))

  // 해부도 포스터 (뒷벽) — 캔버스로 그린다
  const posterTex = paperTexture(420, 620, (c, W, H) => {
    c.fillStyle = '#f7f5ee'; c.fillRect(0, 0, W, H)
    c.fillStyle = '#2d4a58'; c.fillRect(0, 0, W, 54)
    c.fillStyle = '#fff'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center'
    c.fillText('소 화 기 계', W / 2, 36)
    // 몸통 실루엣
    c.fillStyle = '#e8d3c4'
    c.beginPath(); c.ellipse(W / 2, 330, 118, 205, 0, 0, 6.283); c.fill()
    const organ = (x: number, y: number, rx: number, ry: number, col: string) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 6.283); c.fill() }
    organ(W / 2 - 52, 232, 54, 42, '#a8544a')  // 간
    organ(W / 2 + 46, 246, 34, 26, '#8e5f6d')  // 위
    organ(W / 2, 356, 78, 66, '#c98a72')       // 장
    organ(W / 2 + 62, 214, 20, 14, '#6f7f5a')  // 담낭
    c.strokeStyle = '#2d4a58'; c.lineWidth = 1.6
    for (let i = 0; i < 5; i++) {
      const y = 200 + i * 48
      c.beginPath(); c.moveTo(W - 96, y); c.lineTo(W - 34, y); c.stroke()
      c.fillStyle = '#33454e'; c.font = '13px sans-serif'; c.textAlign = 'left'
      c.fillText(['간', '위', '담낭', '소장', '대장'][i], W - 30, y + 4)
    }
    c.strokeStyle = '#cdc6b3'; c.lineWidth = 3; c.strokeRect(9, 9, W - 18, H - 18)
  })
  const poster = box(0.50, 0.74, 0.014, new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.9, metalness: 0 }),
    [2.30, 1.86, ROOM.backZ + 0.008])
  poster.rotation.z = 0.008 // 액자 수평을 0.5° 흐트러뜨린다
  grp.add(poster)
  grp.add(box(0.54, 0.78, 0.010, M.steelDull, [2.30, 1.86, ROOM.backZ + 0.003], [0, 0, 0.008]))

  grp.add(buildCorkBoard())

  // 화이트보드 (좌측 벽)
  const wb = g(
    box(0.03, 0.62, 0.92, tint(M.paintedMetal, '#fbfcfa', { roughness: 0.18, metalness: 0.05 }), [0, 0, 0]),
    box(0.045, 0.66, 0.96, M.steelDull, [-0.006, 0, 0]),
    box(0.05, 0.02, 0.30, M.steelDull, [0.012, -0.34, 0]),
  )
  wb.position.set(-HX + 0.03, 1.55, -2.6)
  grp.add(wb)

  return grp
}

/* ══════════ 코르크 게시판 — "사람이 쓰는 공간"의 가장 싼 신호 ══════════
   빈 벽 하나를 종이 여러 장 + 포스트잇으로 채우면, 폴리곤 몇 백 개로
   방이 "정리된 쇼룸"에서 "쓰이고 있는 방"으로 넘어간다. */
export function buildCorkBoard() {
  const grp = new THREE.Group()
  grp.position.set(-0.15, 1.72, ROOM.backZ + 0.006)
  const W = 0.88, H = 0.62

  // 코르크 면 — 절차적 반점
  const corkTex = paperTexture(512, 360, (c, w, h) => {
    c.fillStyle = '#c39a63'; c.fillRect(0, 0, w, h)
    for (let i = 0; i < 14000; i++) {
      const v = Math.random()
      c.fillStyle = v < 0.4 ? 'rgba(150,112,66,0.5)' : v < 0.75 ? 'rgba(216,182,133,0.45)' : 'rgba(110,80,46,0.35)'
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, Math.random() < 0.8 ? 1.2 : 2.6, 0, 6.283); c.fill()
    }
  })
  grp.add(box(W, H, 0.014, new THREE.MeshStandardMaterial({
    map: corkTex, roughness: 0.94, metalness: 0, envMapIntensity: 0.3,
  }), [0, 0, 0]))
  // 알루미늄 프레임 4변
  const fr = tint(M.steelDull, '#b6bcbe')
  grp.add(box(W + 0.03, 0.022, 0.022, fr, [0, H / 2 + 0.008, 0.004]))
  grp.add(box(W + 0.03, 0.022, 0.022, fr, [0, -H / 2 - 0.008, 0.004]))
  grp.add(box(0.022, H + 0.03, 0.022, fr, [-W / 2 - 0.008, 0, 0.004]))
  grp.add(box(0.022, H + 0.03, 0.022, fr, [W / 2 + 0.008, 0, 0.004]))

  // 붙어 있는 종이들 — 각도·크기·색을 전부 다르게. 줄 맞추면 즉시 CG로 읽힌다.
  const noteTex = (lines: number, bg: string) => paperTexture(200, 260, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h)
    c.fillStyle = '#4a5a62'; c.fillRect(16, 18, 108, 9)
    c.fillStyle = '#9aa8ac'
    for (let i = 0; i < lines; i++) c.fillRect(16, 40 + i * 16, 160 - (i % 3) * 42, 5)
  })
  const sheets: [number, number, number, number, number, string][] = [
    [-0.26, 0.13, 0.055, 0.155, 0.21, '#f4f2e8'],
    [-0.02, 0.16, -0.038, 0.135, 0.185, '#eef1f2'],
    [0.24, 0.11, 0.072, 0.145, 0.20, '#f2efe4'],
    [-0.28, -0.14, -0.055, 0.135, 0.175, '#eef0ea'],
    [0.02, -0.16, 0.028, 0.16, 0.20, '#f5f3ea'],
  ]
  sheets.forEach(([x, y, rz, sw, sh, bg], i) => {
    grp.add(box(sw, sh, 0.0018, new THREE.MeshStandardMaterial({
      map: noteTex(6 + (i % 3), bg), roughness: 0.95, metalness: 0,
    }), [x, y, 0.009], [0, 0, rz]))
    // 압정
    grp.add(cyl(0.0055, 0.0055, 0.007, tint(M.plastic, ['#c0453c', '#3d6ea8', '#4b8a5c', '#d2a33a', '#b0554f'][i]),
      [x + Math.sin(rz) * sh * 0.42, y + sh * 0.42, 0.014], [Math.PI / 2, 0, 0], 8))
  })
  // 포스트잇 3장 — 목표 이미지의 인상은 사실상 이것에서 온다
  const stickies: [number, number, number, string][] = [[0.30, -0.13, -0.09, '#f2df6a'], [0.13, -0.06, 0.11, '#f0a9c0'], [-0.13, -0.02, -0.05, '#a8dca0']]
  stickies.forEach(([x, y, rz, col]) => {
    grp.add(box(0.072, 0.072, 0.0016, tint(M.paper, col, { roughness: 0.93 }), [x, y, 0.011], [0, 0, rz]))
  })
  return grp
}

/* ══════════ 커튼 — 천장 트랙 + 주름진 천 ══════════ */
export function buildCurtains() {
  const grp = new THREE.Group()
  const railY = 2.42
  const railMat = M.steelDull

  // ㄱ자 트랙 (침대를 코너에서 분리)
  const trackA = box(2.35, 0.035, 0.035, railMat, [2.02, railY, -2.30])
  const trackB = box(0.035, 0.035, 1.85, railMat, [0.90, railY, -3.20])
  grp.add(trackA, trackB)
  // 천장까지 매다는 행어
  for (const [hx2, hz] of [[1.1, -2.3], [2.9, -2.3], [0.9, -2.4], [0.9, -4.0]]) {
    grp.add(cyl(0.008, 0.008, ROOM.h - railY, railMat, [hx2, (ROOM.h + railY) / 2, hz], null, 8))
  }

  // 커튼 A는 **반쯤 열어** 오른쪽으로 몰아둔다. 다 닫으면 방이 둘로 잘려 공간감이 죽고,
  // 열어 두면 진찰대가 보여 "이 방이 무엇을 하는 방인지"가 한 컷에 읽힌다.
  // 주름은 넓고 얕게 — 좁고 깊으면 버티컬 블라인드로 읽힌다(1차 시도의 실패).
  const cA = curtain(1.15, 1.92, M.fabric, { amp: 0.085, wave: 0.30 })
  cA.position.set(2.56, 0.45 + 1.92 / 2, -2.30)
  grp.add(cA)
  const cB = curtain(1.70, 1.92, M.fabric, { amp: 0.075, wave: 0.28 })
  cB.rotation.y = Math.PI / 2
  cB.position.set(0.90, 0.45 + 1.92 / 2, -3.22)
  grp.add(cB)

  // 커튼 고리 — 천이 무엇에 매달려 있는지 보이면 천으로 읽힌다. 열린 쪽엔 고리만 남는다.
  for (let i = 0; i < 12; i++) {
    grp.add(rim(0.014, 0.0035, railMat, [2.02 + i * 0.095, railY - 0.03, -2.30], [0, Math.PI / 2, 0]))
    if (i < 9) grp.add(rim(0.014, 0.0035, railMat, [0.90, railY - 0.03, -2.42 - i * 0.19], [0, 0, 0]))
  }
  return grp
}

/* ══════════ 책상 위 — 문진 카메라의 화면 하단 전경 ══════════
   ⚠ 상판 높이는 **0.835**다. metal_office_desk(scale [0.92,1.06,0.88])의 실측 bbox가
     y 0…0.835 이고, 본 씬 `Desk()`도 소품을 y=0.83~0.84에 놓는다.
     이전 값 0.735는 10cm 낮아 소품이 전부 상판 **속에 파묻혀** 있었다(펜통 림만 보였다).

   로컬 좌표계: 원점 = DESK_POS(-2.05, 0, 0.42). 상판은 x ±0.92, z ±0.417.
     +z = 의사 쪽(가까운 모서리), -z = 먼 모서리
     +x = 환자 쪽 끝  ← **문진 카메라 프레임에 들어오는 것은 대략 x ≳ 0.45 구간뿐이다**
   따라서 진찰 도구는 +x(프레임 안), 모니터·키보드는 -x(의사 정면, 팬해야 보임)에 둔다.
   실제 진료실에서도 환자에게 쓰는 도구는 환자 쪽 끝에 모아 둔다 — 배치가 기능과 일치한다. */
export const DESK_TOP = 0.835

/** 상판에 놓이는 자잘한 물건용 — 2cm짜리에 세그먼트 2는 낭비다(폴리곤 3배). 챔퍼만 남긴다. */
const sbox = (w: number, h: number, d: number, mat: THREE.Material, pos?: number[] | null, rot?: number[] | null) => {
  const m = new THREE.Mesh(rbox(w, h, d, null, 1), mat)
  if (pos) m.position.set(pos[0], pos[1], pos[2])
  if (rot) m.rotation.set(rot[0], rot[1], rot[2])
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/* ── 캔버스 UI 텍스처 ── */
function emrScreenTexture() {
  return paperTexture(768, 460, (c, W, H) => {
    c.fillStyle = '#eef2f1'; c.fillRect(0, 0, W, H)
    // 타이틀 바
    c.fillStyle = '#2c4a5a'; c.fillRect(0, 0, W, 44)
    c.fillStyle = '#ffffff'; c.font = 'bold 21px sans-serif'
    c.fillText('전자의무기록  ·  외래 진료', 16, 30)
    c.fillStyle = '#8fb4c4'; c.font = '15px sans-serif'
    c.fillText('제3진료실', W - 96, 29)
    // 좌측 환자 목록
    c.fillStyle = '#dfe7e6'; c.fillRect(0, 44, 186, H - 44)
    c.fillStyle = '#33505c'; c.font = 'bold 14px sans-serif'
    c.fillText('대기 환자', 14, 70)
    for (let i = 0; i < 6; i++) {
      const y = 84 + i * 34
      if (i === 1) { c.fillStyle = '#b8d4d0'; c.fillRect(6, y, 174, 30) }
      c.fillStyle = i === 1 ? '#1e3742' : '#7d9199'; c.font = i === 1 ? 'bold 14px sans-serif' : '14px sans-serif'
      c.fillText(['김○○  M/52', '박○○  F/38', '이○○  M/71', '최○○  F/29', '정○○  M/45', '한○○  F/63'][i], 16, y + 20)
    }
    // 우측 본문 — 환자 정보 칸
    const bx = 200
    c.fillStyle = '#ffffff'; c.fillRect(bx, 58, W - bx - 14, 92)
    c.strokeStyle = '#c3d0d4'; c.lineWidth = 1; c.strokeRect(bx, 58, W - bx - 14, 92)
    c.fillStyle = '#5a7078'; c.font = '13px sans-serif'
    const fields = [['성명', '박 ○ ○'], ['성별/나이', 'F / 38'], ['등록번호', '2026-04817'], ['내원사유', '복통']]
    fields.forEach(([k, v], i) => {
      const fx = bx + 14 + (i % 2) * 270, fy = 82 + Math.floor(i / 2) * 38
      c.fillStyle = '#8fa2a8'; c.fillText(k, fx, fy)
      c.fillStyle = '#22383f'; c.font = 'bold 15px sans-serif'; c.fillText(v, fx + 84, fy)
      c.font = '13px sans-serif'
    })
    // 표
    c.fillStyle = '#2c4a5a'; c.font = 'bold 14px sans-serif'
    c.fillText('활력징후', bx, 182)
    const cols = ['시각', 'BP', 'HR', 'BT', 'RR']
    c.fillStyle = '#c9d6d9'; c.fillRect(bx, 192, W - bx - 14, 26)
    c.fillStyle = '#3a5560'; c.font = 'bold 13px sans-serif'
    cols.forEach((t, i) => c.fillText(t, bx + 12 + i * 106, 210))
    const rows = [
      ['09:12', '128/78', '84', '36.8', '18'],
      ['09:40', '132/80', '88', '36.9', '18'],
      ['10:05', '126/76', '80', '36.7', '16'],
    ]
    rows.forEach((r, ri) => {
      c.fillStyle = ri % 2 ? '#f4f7f6' : '#ffffff'
      c.fillRect(bx, 218 + ri * 26, W - bx - 14, 26)
      c.fillStyle = '#405c66'; c.font = '13px sans-serif'
      r.forEach((t, i) => c.fillText(t, bx + 12 + i * 106, 236 + ri * 26))
    })
    // 메모 라인
    c.fillStyle = '#2c4a5a'; c.font = 'bold 14px sans-serif'
    c.fillText('경과기록', bx, 320)
    c.fillStyle = '#aebdc2'
    for (let i = 0; i < 5; i++) c.fillRect(bx, 334 + i * 18, (W - bx - 40) - (i % 3) * 90, 7)
    // 하단 버튼
    c.fillStyle = '#4f8a78'; c.fillRect(bx, 426, 104, 24)
    c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.fillText('저장', bx + 38, 443)
    c.fillStyle = '#96a8ae'; c.fillRect(bx + 116, 426, 104, 24)
    c.fillStyle = '#fff'; c.fillText('처방', bx + 154, 443)
  })
}

/** 키보드 상판 — 키를 개별 메시로 만들면 100개가 넘는다. 텍스처 한 장이면 충분하다. */
function keyboardTexture() {
  return paperTexture(512, 180, (c, W, H) => {
    c.fillStyle = '#e6e9e5'; c.fillRect(0, 0, W, H)
    const drawKey = (x: number, y: number, w: number, h: number) => {
      c.fillStyle = '#cfd4d0'; c.fillRect(x, y, w, h)              // 키 사이 음영
      c.fillStyle = '#f7f8f6'; c.fillRect(x + 1.5, y + 1.5, w - 3, h - 4)
      c.fillStyle = '#dfe3df'; c.fillRect(x + 1.5, y + h - 4, w - 3, 2) // 아래 모서리 그림자
    }
    const pad = 10, kh = 28
    // 기능키 줄 (작게)
    for (let i = 0; i < 14; i++) drawKey(pad + i * 35, 8, 31, 18)
    // 본 줄 4개
    const rows = [14, 13, 12, 9]
    rows.forEach((n, r) => {
      const y = 32 + r * 32
      let x = pad + (r === 1 ? 8 : r === 2 ? 14 : r === 3 ? 22 : 0)
      for (let i = 0; i < n; i++) { const w = (i === n - 1 ? 46 : 31); drawKey(x, y, w, kh); x += w + 4 }
    })
    // 스페이스바
    drawKey(pad + 120, 160, 190, 16)
  })
}

/* ── 절차적 진료 도구 (외부 에셋 불필요) ── */

/** 타진기(reflex hammer) — 가는 금속 손잡이 + 삼각 고무 헤드. 상판에 눕혀 놓는다. */
function reflexHammer(): THREE.Group {
  const grp = new THREE.Group()
  const steel = M.steel
  const rubber = tint(M.rubber, '#9b3630', { roughness: 0.62 })
  // 손잡이 (길이축 X)
  grp.add(cyl(0.0048, 0.0048, 0.19, steel, [0, 0, 0], [0, 0, Math.PI / 2], 10))
  grp.add(cyl(0.008, 0.006, 0.018, steel, [-0.098, 0, 0], [0, 0, Math.PI / 2], 10)) // 끝 마감
  // 토마호크 헤드 — 삼각 단면 원기둥을 눕힌다
  // 축을 +Y로 세우면 위에서 내려다볼 때 토마호크 특유의 삼각 단면이 보인다.
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.021, 3), rubber)
  head.scale.set(1, 1, 0.62)
  head.position.set(0.107, 0.008, 0)
  head.rotation.set(0, -0.5, 0)
  head.castShadow = true
  grp.add(head)
  grp.add(cyl(0.007, 0.007, 0.016, steel, [0.088, 0, 0], [0, 0, Math.PI / 2], 8)) // 목
  return grp
}

/** 이경(otoscope) — 배터리 손잡이 + 크롬 헤드 + 검은 스페큘럼. 충전 거치대에 세워 둔다. */
function otoscope(): THREE.Group {
  const grp = new THREE.Group()
  grp.add(cyl(0.014, 0.014, 0.115, tint(M.plasticDark, '#2b3135'), [0, 0.075, 0], null, 14))
  grp.add(rim(0.014, 0.0022, M.steelDull, [0, 0.133, 0], [Math.PI / 2, 0, 0]))
  const head = new THREE.Group()
  head.position.set(0, 0.152, 0)
  head.rotation.x = 0.42
  head.add(cyl(0.017, 0.017, 0.048, tint(M.steel, '#ced3d6'), [0, 0, 0], null, 14))
  head.add(new THREE.Mesh(new THREE.ConeGeometry(0.0115, 0.038, 14), tint(M.plasticDark, '#1a1e22')))
  head.children[head.children.length - 1].position.set(0, 0.042, 0)
  grp.add(head)
  // 충전 거치대
  grp.add(cyl(0.032, 0.036, 0.022, tint(M.plastic, '#dfe4e1'), [0, 0.011, 0], null, 16))
  return grp
}

/** 설압자 통 — 뚜껑 없는 유리/폴리 통. 안에 설압자가 꽂힌다(설압자는 GLB로 따로 넣는다). */
function depressorJar(): THREE.Group {
  const grp = new THREE.Group()
  const glass = tint(M.glass, '#dfeae9', { opacity: 0.46, roughness: 0.10 })
  grp.add(cyl(0.045, 0.041, 0.115, glass, [0, 0.058, 0], null, 20))
  grp.add(cyl(0.040, 0.040, 0.006, tint(M.plastic, '#e4e8e4'), [0, 0.004, 0], null, 16)) // 바닥
  grp.add(rim(0.0445, 0.0035, tint(M.plastic, '#dfe4e1'), [0, 0.115, 0], [Math.PI / 2, 0, 0]))
  return grp
}

export function buildDeskSet() {
  const grp = new THREE.Group()
  grp.position.set(DESK_POS[0], 0, DESK_POS[2])
  const T = DESK_TOP

  /* ── 의사 작업 영역 (-x) — 모니터·키보드·마우스 ── */
  const mon = new THREE.Group()
  mon.position.set(0.45, T, -0.412)
  mon.rotation.y = -0.25 // 의사(카메라) 쪽을 정면으로
  const screenTex = emrScreenTexture()
  mon.add(box(0.54, 0.335, 0.020, M.paintedMetalDark, [0, 0.215, 0]))          // 베젤 (24" 실치수)
  mon.add(box(0.502, 0.299, 0.004, new THREE.MeshStandardMaterial({
    map: screenTex, emissiveMap: screenTex, emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.62, roughness: 0.30, metalness: 0,
  }), [0, 0.219, 0.012]))
  mon.add(box(0.054, 0.100, 0.040, M.paintedMetalDark, [0, 0.050, -0.015]))    // 목
  mon.add(box(0.24, 0.018, 0.155, M.paintedMetalDark, [0, 0.009, 0.005]))      // 받침
  grp.add(mon)

  const kb = new THREE.Group()
  kb.position.set(0.37, T + 0.009, -0.16)
  kb.rotation.y = -0.25 + 0.04 // 2° 흐트러뜨림
  kb.add(box(0.43, 0.016, 0.152, tint(M.plastic, '#dfe3df'), [0, 0, 0]))
  kb.add(sbox(0.405, 0.003, 0.132, new THREE.MeshStandardMaterial({
    map: keyboardTexture(), roughness: 0.62, metalness: 0,
  }), [0, 0.0095, 0]))
  grp.add(kb)

  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), tint(M.plastic, '#dfe3df'))
  mouse.scale.set(1, 0.55, 1.35)
  mouse.position.set(0.60, T + 0.020, -0.20)
  mouse.rotation.y = -0.2
  mouse.castShadow = true
  grp.add(mouse)

  // 티슈갑 (모니터 옆, 먼 쪽)
  grp.add(box(0.115, 0.058, 0.115, tint(M.plastic, '#dfe7ea'), [-0.66, T + 0.029, -0.24]))
  grp.add(sbox(0.048, 0.020, 0.048, M.paper, [-0.66, T + 0.064, -0.24], [0.22, 0.4, 0.12]))

  /* ── 환자 응대 영역 (+x) — 프레임에 실제로 들어오는 구간 ── */

  // 설압자 통 (GLB 설압자는 attachDeskProps에서 꽂는다)
  const jar = depressorJar(); jar.position.set(0.60, T, -0.385); grp.add(jar)

  // 펜꽂이 + 펜 3자루
  const cup = g(
    cyl(0.043, 0.038, 0.115, tint(M.paintedMetal, '#cdd3d2', { roughness: 0.38, metalness: 0.30 }), [0, 0.058, 0], null, 20),
    rim(0.042, 0.004, tint(M.steel, '#c8ced0'), [0, 0.116, 0], [Math.PI / 2, 0, 0]),
    cyl(0.037, 0.037, 0.016, tint(M.plastic, '#6f7a80', { roughness: 0.8 }), [0, 0.052, 0], null, 14), // 바닥(입구를 막지 않게 낮게)
  )
  cup.position.set(0.895, T, 0.055)
  grp.add(cup)
  const pens: [number, number, number, string][] = [[-0.012, 0.008, 0.06, '#243036'], [0.010, -0.008, -0.05, '#2e4a5a'], [0.002, 0.014, 0.09, '#7a3a3a']]
  for (const [ox, oz, tilt, col] of pens) {
    grp.add(cyl(0.0045, 0.0045, 0.15, tint(M.plastic, col), [0.895 + ox, T + 0.135, 0.055 + oz], [tilt, 0, tilt * 1.4], 8))
  }

  // 이경 + 거치대
  const oto = otoscope(); oto.position.set(0.775, T, -0.415); grp.add(oto)

  // 타진기 — 눕혀서 살짝 비스듬히. 굴러다니는 물건은 각을 맞추면 안 된다.
  const ham = reflexHammer()
  ham.position.set(0.775, T + 0.024, -0.075)
  ham.rotation.set(0, -0.42, 0)
  grp.add(ham)

  // 머그 — 가장자리에 (사용자 지시: "머그는 가장자리에")
  const mug = g(
    cyl(0.042, 0.037, 0.096, tint(M.plastic, '#d8dcd6', { roughness: 0.30 }), [0, 0.048, 0], null, 20),
    cyl(0.036, 0.036, 0.010, tint(M.plasticDark, '#4a3a2c'), [0, 0.082, 0], null, 14), // 남은 커피
    rim(0.029, 0.0055, tint(M.plastic, '#d8dcd6', { roughness: 0.30 }), [0.046, 0.052, 0], [0, Math.PI / 2, 0]),
  )
  mug.position.set(0.845, T, 0.235)
  mug.rotation.y = -2.1
  grp.add(mug)

  // 차트 서류 — 낱장 3장을 비뚤게 겹친다. 줄 맞추면 즉시 CG로 읽힌다.
  const chartTex = paperTexture(300, 400, (c, W, H) => {
    c.fillStyle = '#f6f4ec'; c.fillRect(0, 0, W, H)
    c.fillStyle = '#39505c'; c.fillRect(24, 26, 150, 12)
    c.fillStyle = '#c8d0d2'; c.fillRect(24, 48, 252, 2)
    c.fillStyle = '#a8b4b8'
    for (let i = 0; i < 13; i++) c.fillRect(24, 66 + i * 22, 240 - (i % 4) * 55, 6)
    c.strokeStyle = '#c7ccc4'; c.lineWidth = 2; c.strokeRect(18, 18, W - 36, H - 36)
  })
  const paperMat = new THREE.MeshStandardMaterial({ map: chartTex, roughness: 0.95, metalness: 0 })
  for (const [px, pz, ry, dy] of [[0.855, 0.155, 0.17, 0], [0.878, 0.180, 0.04, 0.0016], [0.838, 0.140, -0.11, 0.0032]]) {
    grp.add(sbox(0.21, 0.0014, 0.29, paperMat, [px, T + 0.0016 + dy, pz], [0, ry, 0]))
  }
  // 클립보드 — 서류 더미 위에 비스듬히
  const cb = g(
    sbox(0.235, 0.009, 0.32, tint(M.plastic, '#3d7a78', { roughness: 0.5 }), [0, 0, 0]),
    sbox(0.20, 0.004, 0.27, paperMat, [0, 0.0065, 0.012]),
    sbox(0.10, 0.011, 0.030, M.steel, [0, 0.009, -0.135]),
  )
  cb.position.set(0.66, T + 0.0055, 0.155)
  cb.rotation.y = -0.34
  grp.add(cb)

  // 손소독 펌프
  const san = g(
    box(0.062, 0.145, 0.062, tint(M.plastic, '#f3f6f2', { roughness: 0.35 }), [0, 0.072, 0]),
    cyl(0.016, 0.016, 0.045, tint(M.plasticDark, '#4a5257'), [0, 0.166, 0], null, 12),
    sbox(0.055, 0.012, 0.030, tint(M.plasticDark, '#4a5257'), [0.02, 0.186, 0]),
    sbox(0.05, 0.075, 0.004, tint(M.paper, '#e8eef0'), [0, 0.075, 0.033]),
  )
  san.position.set(0.30, T, -0.40)
  grp.add(san)

  // 명패 — 비스듬한 판 + 받침
  const plateTex = paperTexture(384, 96, (c, W, H) => {
    c.fillStyle = '#22313a'; c.fillRect(0, 0, W, H)
    c.fillStyle = '#dfe6e4'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'
    c.fillText('내과   김 도 윤', W / 2, 62)
  })
  const plate = g(
    sbox(0.20, 0.052, 0.006, new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.35, metalness: 0.4 }), [0, 0.030, 0], [-0.30, 0, 0]),
    sbox(0.21, 0.012, 0.045, M.steelDull, [0, 0.006, 0.008]),
  )
  plate.position.set(0.12, T, -0.40)
  plate.rotation.y = Math.PI + 0.06 // 환자 쪽을 향한다
  grp.add(plate)

  // 전선 한 가닥 — 모니터에서 책상 뒤로 (생활 흔적)
  const cord = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.45, T + 0.01, -0.425),
      new THREE.Vector3(0.40, T + 0.004, -0.43),
      new THREE.Vector3(0.22, T + 0.003, -0.44),
      new THREE.Vector3(0.04, T - 0.02, -0.45),
    ]), 20, 0.0045, 5, false),
    tint(M.rubber, '#3a4045'),
  )
  grp.add(cord)

  return grp
}

/** 책상 위 GLB 소품 — 형상이 진짜 복잡한 것만. 전부 리포에 이미 있는 자산이다.
 *  (설압자·펜라이트는 자체 제작 CC0 상당, 청진기는 CREDITS.md 기재 자산) */
export function attachDeskProps(group: THREE.Object3D) {
  const T = DESK_TOP
  const jobs = []
  // 설압자 3자루 — 통에 꽂힌다. 길이축이 glTF +Y라 그대로 세우면 된다.
  const jarPos = [0.60, 0, -0.385]
  ;([[-0.013, 0.008, 0.05, -0.03], [0.011, -0.010, -0.04, 0.05], [0.001, 0.015, 0.07, 0.02]] as [number, number, number, number][]).forEach(([ox, oz, rx, rz], i) => {
    jobs.push(loadModel('/models/tongue_depressor.glb', {
      align: 'center', scale: 1,
      pos: [jarPos[0] + ox, T + 0.086, jarPos[2] + oz],
      rot: [rx, i * 1.1, rz],
    }).then((o) => group.add(o)))
  })
  // 펜라이트 — 눕혀 놓는다. 길이축 +Y → Z축으로 90° 눕혀 X 방향으로.
  jobs.push(loadModel('/models/penlight.glb', {
    align: 'center', scale: 1,
    pos: [0.635, T + 0.0075, 0.02], rot: [0, 0, Math.PI / 2 + 0.06],
    onMesh: (m) => {
      const n = m.name.toLowerCase()
      if (n.includes('lens')) m.material = new THREE.MeshStandardMaterial({
        color: '#fffbe4', emissive: new THREE.Color('#ffeeb0'), emissiveIntensity: 0.25, roughness: 0.25,
      })
      else if (n.includes('clip') || n.includes('reflector')) m.material = M.steel
      else m.material = tint(M.plasticDark, '#232a2e')
    },
  }).then((o) => group.add(o)))
  return Promise.all(jobs)
}

/* ══════════ 환자 의자 — 좌면 y=0.54 고정 (아바타 sitY 전제) ══════════ */
export function buildPatientChair(position: number[] = SEAT_POS, rotY = SEAT_ROT_Y + 0.04) {
  const grp = new THREE.Group()
  grp.position.set(position[0], 0, position[2])
  grp.rotation.y = rotY // 의사 쪽. 완벽 정렬을 피해 2° 흐트러뜨림

  // 5스타 베이스 + 캐스터
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3
    const arm = box(0.24, 0.028, 0.045, M.paintedMetalDark, [Math.cos(a) * 0.13, 0.062, Math.sin(a) * 0.13], [0, -a, 0])
    grp.add(arm)
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.012, 6, 14), M.rubber)
    c.position.set(Math.cos(a) * 0.235, 0.028, Math.sin(a) * 0.235)
    c.rotation.set(0, -a, Math.PI / 2)
    grp.add(c)
  }
  grp.add(cyl(0.035, 0.035, 0.30, M.steelDull, [0, 0.23, 0], null, 16))
  grp.add(cyl(0.046, 0.046, 0.10, M.paintedMetalDark, [0, 0.16, 0], null, 16))

  // 좌면 — 비닐 쿠션. 윗면이 정확히 0.54.
  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.085, 0.40, 3, 0.028), M.vinylPad)
  seat.position.set(0, SEAT_TOP - 0.0425, 0)
  seat.castShadow = true; seat.receiveShadow = true
  grp.add(seat)
  grp.add(box(0.38, 0.022, 0.36, M.paintedMetalDark, [0, SEAT_TOP - 0.095, 0]))

  // 등받이 — 프레임 + 쿠션 분리
  const backTilt = -0.16
  const back = new THREE.Group()
  back.position.set(0, SEAT_TOP + 0.20, -0.18)
  back.rotation.x = backTilt
  const bp = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.34, 0.065, 3, 0.022), M.vinylPad)
  bp.castShadow = true
  back.add(bp)
  back.add(box(0.30, 0.022, 0.022, M.steelDull, [0, -0.20, 0.01]))
  grp.add(back)
  grp.add(box(0.028, 0.22, 0.028, M.steelDull, [0, SEAT_TOP + 0.02, -0.175]))

  return grp
}

/* ══════════ GLB/GLTF 로더 — 크기 자동 맞춤 ══════════ */
const gltfLoader = new GLTFLoader()
type LoadOpts = {
  fitHeight?: number | null; fitMax?: number | null; pos?: number[]; rotY?: number
  rot?: number[] | null; scale?: number | null
  onMesh?: ((m: THREE.Mesh) => void) | null; align?: 'base' | 'center'
}
export function loadModel(url: string, {
  fitHeight = null, fitMax = null, pos = [0, 0, 0], rotY = 0, rot = null,
  scale = null, onMesh = null, align = 'base',
}: LoadOpts = {}): Promise<THREE.Group> {
  return new Promise<THREE.Group>((resolve) => {
    gltfLoader.load(url, (gltf) => {
      const o = gltf.scene
      const bb = new THREE.Box3().setFromObject(o)
      const size = new THREE.Vector3(); bb.getSize(size)
      const s = scale ?? (fitHeight ? fitHeight / size.y
        : fitMax ? fitMax / Math.max(size.x, size.y, size.z) : 1)
      o.scale.setScalar(s)
      const bb2 = new THREE.Box3().setFromObject(o)
      const c = new THREE.Vector3(); bb2.getCenter(c)
      /* ⚠ 순서가 중요하다. 모델을 **로컬 원점으로 먼저 정렬**한 뒤 래퍼를 회전·이동해야 한다.
         (오프셋된 자식을 담은 래퍼를 회전시키면 물체가 월드 원점을 축으로 돌아
          지정한 좌표에서 멀리 날아간다 — 화분이 벽 밖으로 나가 안 보이던 원인.) */
      // align='base' → 밑면이 y=0 (바닥에 놓이는 것). 'center' → 기하 중심이 원점
      // (눕히거나 기울일 물건은 중심 기준이라야 회전축이 물건 안에 있다).
      o.position.set(-c.x, align === 'center' ? -c.y : -bb2.min.y, -c.z)
      const wrap = new THREE.Group()
      wrap.add(o)
      if (rot) wrap.rotation.set(rot[0], rot[1], rot[2])
      else wrap.rotation.y = rotY
      wrap.position.set(pos[0], pos[1], pos[2])
      wrap.traverse((obj) => {
        const n = obj as THREE.Mesh
        if (!n.isMesh) return
        n.castShadow = true
        n.receiveShadow = true
        /* ⚠⚠ 반드시 재질 교체 **전에** 노멀을 보장해야 한다.
           `iv_drip.glb`는 POSITION/TEXCOORD_0만 있고 **NORMAL이 없다**.
           GLTFLoader는 그런 메시에 자동으로 flatShading 재질을 물려 넘어가지만,
           우리가 범주 재질(MeshStandardMaterial, flatShading=false)로 갈아끼우면
           셰이더가 없는 노멀을 normalize(0,0,0) → NaN 으로 계산한다.
           그 NaN 픽셀이 Bloom의 mipmapBlur를 타고 전 화면으로 번져 **화면이 통째로 검게 죽는다**.
           (실측: iv_drip 하나만 숨기면 즉시 정상 — 스펙 §2의 "UV 없는 메시 탄젠트 NaN"과 같은 계열) */
        if (!n.geometry.attributes.normal) n.geometry.computeVertexNormals()
        if (onMesh) onMesh(n)
      })
      resolve(wrap)
    }, undefined, () => resolve(new THREE.Group()))
  })
}

/* ══════════ 생활 흔적 — 전선·휴지통 내용물 등 (진찰 시야 밖에만) ══════════ */
export function buildLifeTraces() {
  const grp = new THREE.Group()
  // 벽을 타고 내려오는 전선 (모니터 카트 → 콘센트)
  const pts = [
    new THREE.Vector3(3.16, 0.30, -2.30),
    new THREE.Vector3(3.05, 0.10, -2.35),
    new THREE.Vector3(2.80, 0.035, -2.28),
    new THREE.Vector3(2.55, 0.030, -2.40),
    new THREE.Vector3(2.42, 0.22, -2.52),
  ]
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.007, 6, false),
    tint(M.rubber, '#3a4045'),
  )
  cable.castShadow = true
  grp.add(cable)
  return grp
}
