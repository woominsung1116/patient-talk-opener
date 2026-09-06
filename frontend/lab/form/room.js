/**
 * clinic-lab / form — 방 빌더.
 *
 *   buildRoom('base')  = 본 씬(ClinicScene.tsx)의 형태를 그대로 옮긴 것 (대조군)
 *   buildRoom('form')  = **형태만** 손본 것 (실험군)
 *
 * 재질(M.*)과 조명은 두 모드가 완전히 같은 인스턴스를 공유한다.
 * form 모드에서 바꾸는 것은 오직 다음 넷이다:
 *   (a) boxGeometry → RoundedBoxGeometry (가구·기기 1.5~4mm, 큰 판은 그대로)
 *   (b) 한 덩어리 → 부품 분할 (2~3mm 틈 + 두께)
 *   (c) 벽 하단 걸레받이·몰딩 띠
 *   (d) 미세 비대칭 (1~3°, 수 mm)
 *  + 미사용 GLB(exam_bed / iv_drip / privacy_curtain / vitals_monitor) 연결
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  ROOM, DOOR_X, DOOR_W, DOOR_H, SEAT, EXAM,
  M, BOOK_COLORS, GLOVE_COLORS, anatomyTexture, vitalsTexture, propNode, fittedGLB,
} from './common.js'

/* 모서리 반경 배율 — "1.5~4mm면 충분한가?"를 실측하기 위한 진단용 스위치 */
let RADIUS_SCALE = 1
export function setRadiusScale(v) { RADIUS_SCALE = v }

/* ── 결정적 난수 (같은 모드는 항상 같은 결과) ── */
let _seed = 1
const rnd = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296 }
const srnd = () => rnd() * 2 - 1

/* ── 빌더 컨텍스트 ──
   세 모드로 기법을 분리 측정한다:
     base  : 본 씬 그대로 (각진 박스 + 통짜 덩어리)
     round : (a) 모서리 라운딩만. 부품 분할·걸레받이·비대칭은 base 그대로.
     form  : (a)+(b)+(c)+(d) 전부. */
function ctx(mode) {
  const round = mode !== 'base'
  const form = mode === 'form'   // 부품 분할 / 몰딩 / 비대칭 스위치
  /** box: r>0 이고 라운딩 모드면 RoundedBoxGeometry. */
  const box = (w, h, d, r = 0) => {
    if (round && r > 0) {
      const rad = Math.min(r * RADIUS_SCALE, Math.min(w, h, d) / 2 - 1e-5)
      if (rad > 1e-5) return new RoundedBoxGeometry(w, h, d, 2, rad)
    }
    return new THREE.BoxGeometry(w, h, d)
  }
  /** m: 메시 하나 */
  const m = (geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], opts = {}) => {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(...pos); mesh.rotation.set(...rot)
    mesh.castShadow = opts.cast !== false
    mesh.receiveShadow = opts.recv !== false
    return mesh
  }
  /** jit: form 모드에서만 흔들리는 미세 비대칭 값 */
  const jit = (amount) => (form ? srnd() * amount : 0)
  return { form, box, m, jit }
}

/* ══════════════════════════════════════════════════════════════════
   벽·바닥·천장·문·창
   ══════════════════════════════════════════════════════════════════ */
function shell(c) {
  const { form, box, m, jit } = c
  const { w, h, backZ, frontZ } = ROOM
  const hx = w / 2
  const depth = frontZ - backZ
  const cz = (frontZ + backZ) / 2
  const g = new THREE.Group()

  /* 바닥·천장 — 큰 판이므로 두 모드 동일 (모서리가 안 보인다) */
  g.add(m(new THREE.PlaneGeometry(w, depth), M.floor, [0, 0, cz], [-Math.PI / 2, 0, 0], { cast: false }))
  g.add(m(new THREE.PlaneGeometry(w, depth), M.ceiling, [0, h, cz], [Math.PI / 2, 0, 0], { cast: false }))

  /* (c) form: 천장 T바 그리드 — 천장이 "판때기"에서 "시스템 천장"으로 */
  if (form) {
    const parts = []
    const teeW = 0.026, teeH = 0.022, S = 0.8
    // 조명 트로퍼(1.32×0.72)가 놓인 자리는 티바를 비운다 — 실제 시스템 천장은 타일 대신 등기구가 들어간다
    const fixtures = [[-1.3, -1.8], [1.3, -1.8], [-1.3, -3.8], [1.3, -3.8]]
    const inFixture = (x, z) => fixtures.some(([fx, fz]) => Math.abs(x - fx) < 0.70 && Math.abs(z - fz) < 0.40)
    for (let x = -hx + S; x < hx - 0.05; x += S) {
      for (let z = backZ; z < frontZ - 0.01; z += S) {
        const zc = Math.min(z + S / 2, frontZ), len = Math.min(S, frontZ - z)
        if (inFixture(x, zc)) continue
        const gg = new THREE.BoxGeometry(teeW, teeH, len)
        gg.translate(x, h - teeH / 2 - 0.001, zc)
        parts.push(gg)
      }
    }
    for (let z = backZ + S; z < frontZ - 0.05; z += S) {
      for (let x = -hx; x < hx - 0.01; x += S) {
        const xc = Math.min(x + S / 2, hx), len = Math.min(S, hx - x)
        if (inFixture(xc, z)) continue
        const gg = new THREE.BoxGeometry(len, teeH, teeW)
        gg.translate(xc, h - teeH / 2 - 0.001, z)
        parts.push(gg)
      }
    }
    const merged = mergeGeometries(parts, false)
    g.add(m(merged, M.gridTee, [0, 0, 0], [0, 0, 0], { cast: false }))
  }

  /* 벽면 (평면 — 두 모드 동일) */
  const wallPlane = (pos, rot, size) => m(new THREE.PlaneGeometry(size[0], size[1]), M.wall, pos, rot, { cast: false })
  g.add(wallPlane([-hx, h / 2, cz], [0, Math.PI / 2, 0], [depth, h]))
  g.add(wallPlane([hx, h / 2, cz], [0, -Math.PI / 2, 0], [depth, h]))
  g.add(wallPlane([0, h / 2, frontZ], [0, Math.PI, 0], [w, h]))

  /* ── 웨인스코트 + 걸레받이 ── */
  const wainscotAndSkirt = (side) => {
    // side: 'left'|'right'|'back'
    const grp = new THREE.Group()
    if (side === 'left' || side === 'right') {
      const sgn = side === 'left' ? -1 : 1
      const rotY = sgn === -1 ? Math.PI / 2 : -Math.PI / 2
      if (!form) {
        // ── base: 벽에 붙은 납작한 평면 + 얇은 걸레받이 상자 (본 씬 그대로)
        grp.add(m(new THREE.PlaneGeometry(depth, 1.2), M.wainscot, [sgn * (hx - 0.01), 0.6, cz], [0, rotY, 0], { cast: false }))
        grp.add(m(box(0.06, 0.1, depth, 0.002), M.skirt, [sgn * (hx - 0.03), 0.05, cz]))
      } else {
        // ── form: 두께 있는 판 + 세로 살대(3mm 틈) + 챠레일 캡 + 3단 걸레받이
        grp.add(m(box(0.014, 1.14, depth), M.wainscot, [sgn * (hx - 0.007), 0.62, cz], [0, 0, 0], { cast: false }))
        // 세로 스타일(살대) — 0.9m 간격, 판보다 8mm 더 튀어나옴
        for (let z = backZ + 0.45; z < frontZ; z += 0.9) {
          grp.add(m(box(0.022, 1.1, 0.055, 0.0015), M.wainscot, [sgn * (hx - 0.024), 0.62 + jit(0.002), z]))
        }
        // 챠레일 캡 (상단 몰딩) — 아래로 그림자선을 떨군다
        grp.add(m(box(0.038, 0.026, depth, 0.003), M.skirt, [sgn * (hx - 0.019), 1.196, cz]))
        grp.add(m(box(0.028, 0.012, depth, 0.002), M.skirt, [sgn * (hx - 0.014), 1.168, cz]))
        // 걸레받이 3단 (몸통 + 캡비드 + 쿼터라운드)
        grp.add(m(box(0.018, 0.1, depth, 0.002), M.skirt, [sgn * (hx - 0.009), 0.05, cz]))
        grp.add(m(box(0.026, 0.014, depth, 0.003), M.skirt, [sgn * (hx - 0.013), 0.103, cz]))
        grp.add(m(new THREE.CylinderGeometry(0.014, 0.014, depth, 8, 1, false, 0, Math.PI / 2), M.skirt,
          [sgn * (hx - 0.014), 0.001, cz], [Math.PI / 2, 0, sgn === -1 ? Math.PI : Math.PI / 2]))
      }
    }
    return grp
  }
  g.add(wainscotAndSkirt('left'))
  g.add(wainscotAndSkirt('right'))

  /* ── 우측 벽 창문 ── */
  const win = new THREE.Group()
  win.position.set(hx - 0.06, 1.65, -0.9)
  win.add(m(new THREE.PlaneGeometry(1.7, 1.1), M.glass, [0, 0, 0], [0, -Math.PI / 2, 0], { cast: false, recv: false }))
  win.add(blinds(c, [0, 0.18, 0.03], [0, -Math.PI / 2, 0], 1.62, 0.74))
  if (!form) {
    // base: 얇은 상자 4개가 겹쳐진 창틀
    win.add(m(box(1.84, 0.06, 0.04, 0.0025), M.whitePaint, [0, 0, 0], [0, -Math.PI / 2, 0]))
    win.add(m(box(1.84, 0.06, 0.04, 0.0025), M.whitePaint, [0, 0.55, 0], [0, -Math.PI / 2, 0]))
    win.add(m(box(1.84, 0.06, 0.04, 0.0025), M.whitePaint, [0, -0.55, 0], [0, -Math.PI / 2, 0]))
    win.add(m(box(0.04, 1.16, 0.06, 0.0025), M.whitePaint, [0, 0, 0]))
  } else {
    // form: 케이싱 / 새시 / 문설주 / 창턱(코) — 각 부품 사이 2~3mm 틈
    const cas = (wid, hei, px, py, pz) => m(box(0.05, hei, wid, 0.0025), M.whitePaint, [px, py, pz])
    win.add(cas(1.9, 0.075, -0.012, 0.605, 0))        // 상부 케이싱
    win.add(m(box(0.05, 0.09, 1.9, 0.003), M.whitePaint, [-0.012, -0.60, 0]))  // 창턱 몸통
    win.add(m(box(0.085, 0.028, 2.0, 0.004), M.whitePaint, [-0.03, -0.652, 0])) // 창턱 코(nosing)
    win.add(m(box(0.05, 1.28, 0.075, 0.0025), M.whitePaint, [-0.012, 0, 0.905]))
    win.add(m(box(0.05, 1.28, 0.075, 0.0025), M.whitePaint, [-0.012, 0, -0.905]))
    // 새시(sash) 2장 — 사이 3mm 틈, 중간 문설주
    win.add(m(box(0.032, 0.05, 0.86, 0.002), M.whitePaint, [-0.004, 0.545, -0.44]))
    win.add(m(box(0.032, 0.05, 0.86, 0.002), M.whitePaint, [-0.004, 0.545, 0.44]))
    win.add(m(box(0.032, 1.14, 0.048, 0.002), M.whitePaint, [-0.004, 0, 0]))     // 중앙 문설주
    win.add(m(box(0.032, 0.05, 0.86, 0.002), M.whitePaint, [-0.004, -0.545, -0.44]))
    win.add(m(box(0.032, 0.05, 0.86, 0.002), M.whitePaint, [-0.004, -0.545, 0.44]))
    // 창턱 위 작은 소품 — 아주 살짝 삐뚤게
    win.add(m(box(0.09, 0.055, 0.09, 0.006), M.wood, [-0.03, -0.61, 0.63], [0, jit(0.25), 0]))
  }
  g.add(win)

  /* ── 뒷벽 (문 있는 벽) ── */
  const leftPanelW = DOOR_X - DOOR_W / 2 + hx
  const rightPanelW = hx - (DOOR_X + DOOR_W / 2)
  const back = new THREE.Group()
  back.add(wallPlane([-hx + leftPanelW / 2, h / 2, backZ], [0, 0, 0], [leftPanelW, h]))
  back.add(wallPlane([hx - rightPanelW / 2, h / 2, backZ], [0, 0, 0], [rightPanelW, h]))
  back.add(wallPlane([DOOR_X, DOOR_H + (h - DOOR_H) / 2, backZ], [0, 0, 0], [DOOR_W, h - DOOR_H]))

  if (!form) {
    // base: 웨인스코트는 평면 2장, 걸레받이는 **아예 없다**
    back.add(m(new THREE.PlaneGeometry(leftPanelW, 1.2), M.wainscot, [-hx + leftPanelW / 2, 0.6, backZ + 0.01], [0, 0, 0], { cast: false }))
    back.add(m(new THREE.PlaneGeometry(rightPanelW, 1.2), M.wainscot, [hx - rightPanelW / 2, 0.6, backZ + 0.01], [0, 0, 0], { cast: false }))
  } else {
    for (const [cxp, pw] of [[-hx + leftPanelW / 2, leftPanelW], [hx - rightPanelW / 2, rightPanelW]]) {
      back.add(m(box(pw, 1.14, 0.014), M.wainscot, [cxp, 0.62, backZ + 0.007], [0, 0, 0], { cast: false }))
      for (let x = cxp - pw / 2 + 0.4; x < cxp + pw / 2 - 0.1; x += 0.9) {
        back.add(m(box(0.055, 1.1, 0.022, 0.0015), M.wainscot, [x, 0.62 + jit(0.002), backZ + 0.024]))
      }
      back.add(m(box(pw, 0.026, 0.038, 0.003), M.skirt, [cxp, 1.196, backZ + 0.019]))
      back.add(m(box(pw, 0.012, 0.028, 0.002), M.skirt, [cxp, 1.168, backZ + 0.014]))
      back.add(m(box(pw, 0.1, 0.018, 0.002), M.skirt, [cxp, 0.05, backZ + 0.009]))
      back.add(m(box(pw, 0.014, 0.026, 0.003), M.skirt, [cxp, 0.103, backZ + 0.013]))
    }
  }

  /* 문틀 */
  if (!form) {
    back.add(m(box(0.08, DOOR_H + 0.1, 0.12, 0.002), M.whitePaint, [DOOR_X - DOOR_W / 2 - 0.04, DOOR_H / 2, backZ + 0.02]))
    back.add(m(box(0.08, DOOR_H + 0.1, 0.12, 0.002), M.whitePaint, [DOOR_X + DOOR_W / 2 + 0.04, DOOR_H / 2, backZ + 0.02]))
    back.add(m(box(DOOR_W + 0.16, 0.08, 0.12, 0.002), M.whitePaint, [DOOR_X, DOOR_H + 0.05, backZ + 0.02]))
  } else {
    // form: 문설주(jamb) + 문선(stop, 3mm 반턱) + 케이싱(architrave) 3부품
    for (const sgn of [-1, 1]) {
      const x = DOOR_X + sgn * (DOOR_W / 2 + 0.03)
      back.add(m(box(0.06, DOOR_H + 0.06, 0.13, 0.002), M.whitePaint, [x, DOOR_H / 2, backZ + 0.025]))
      back.add(m(box(0.016, DOOR_H + 0.02, 0.014, 0.0015), M.whitePaint, [x - sgn * 0.022, DOOR_H / 2, backZ + 0.076]))
      back.add(m(box(0.075, DOOR_H + 0.15, 0.014, 0.002), M.whitePaint, [x + sgn * 0.062, DOOR_H / 2 + 0.03, backZ + 0.096]))
    }
    back.add(m(box(DOOR_W + 0.12, 0.06, 0.13, 0.002), M.whitePaint, [DOOR_X, DOOR_H + 0.03, backZ + 0.025]))
    back.add(m(box(DOOR_W + 0.04, 0.016, 0.014, 0.0015), M.whitePaint, [DOOR_X, DOOR_H + 0.008, backZ + 0.076]))
    back.add(m(box(DOOR_W + 0.27, 0.075, 0.014, 0.002), M.whitePaint, [DOOR_X, DOOR_H + 0.098, backZ + 0.096]))
    // 문지방(threshold)
    back.add(m(box(DOOR_W + 0.06, 0.008, 0.14, 0.002), M.chrome, [DOOR_X, 0.004, backZ + 0.025]))
  }
  back.add(m(new THREE.PlaneGeometry(DOOR_W, DOOR_H), M.corridor, [DOOR_X, DOOR_H / 2, backZ - 0.5], [0, 0, 0], { cast: false }))

  /* 문짝 */
  const leaf = new THREE.Group()
  leaf.position.set(DOOR_X - DOOR_W / 2, 0, backZ)
  if (!form) {
    leaf.add(m(box(DOOR_W, DOOR_H, 0.05, 0.002), M.door, [DOOR_W / 2, DOOR_H / 2, 0.04]))
    leaf.add(m(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10), M.chrome, [DOOR_W - 0.12, 1.05, 0.09]))
  } else {
    const t = 0.042, z0 = 0.045
    const stile = 0.115, botRail = 0.2, topRail = 0.115, lockRail = 0.13
    // 프레임 (스타일 2 + 레일 3) — 각 부품 사이 이음선
    leaf.add(m(box(stile, DOOR_H, t, 0.002), M.door, [stile / 2, DOOR_H / 2, z0]))
    leaf.add(m(box(stile, DOOR_H, t, 0.002), M.door, [DOOR_W - stile / 2, DOOR_H / 2, z0]))
    const inner = DOOR_W - stile * 2
    leaf.add(m(box(inner, topRail, t, 0.002), M.door, [DOOR_W / 2, DOOR_H - topRail / 2, z0]))
    leaf.add(m(box(inner, botRail, t, 0.002), M.door, [DOOR_W / 2, botRail / 2, z0]))
    leaf.add(m(box(inner, lockRail, t, 0.002), M.door, [DOOR_W / 2, 1.02, z0]))
    // 함몰 패널 2장 — 프레임보다 9mm 뒤로, 사방 3mm 리빌
    const p1h = 1.02 - lockRail / 2 - botRail - 0.006
    const p2h = DOOR_H - topRail - (1.02 + lockRail / 2) - 0.006
    leaf.add(m(box(inner - 0.006, p1h, t - 0.018, 0.0015), M.door, [DOOR_W / 2, botRail + 0.003 + p1h / 2, z0 - 0.002]))
    leaf.add(m(box(inner - 0.006, p2h, t - 0.018, 0.0015), M.door, [DOOR_W / 2, 1.02 + lockRail / 2 + 0.003 + p2h / 2, z0 - 0.002]))
    // 레버 손잡이 + 로즈 + 실린더
    leaf.add(m(new THREE.CylinderGeometry(0.031, 0.031, 0.008, 20), M.chrome, [DOOR_W - 0.075, 1.05, z0 + t / 2 + 0.004], [Math.PI / 2, 0, 0]))
    leaf.add(m(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 12), M.chrome, [DOOR_W - 0.075, 1.05, z0 + t / 2 + 0.02], [Math.PI / 2, 0, 0]))
    leaf.add(m(box(0.105, 0.02, 0.02, 0.008), M.chrome, [DOOR_W - 0.128, 1.05, z0 + t / 2 + 0.035]))
    leaf.add(m(new THREE.CylinderGeometry(0.019, 0.019, 0.007, 16), M.chrome, [DOOR_W - 0.075, 0.93, z0 + t / 2 + 0.003], [Math.PI / 2, 0, 0]))
    // 경첩 3개
    for (const y of [0.28, 1.08, DOOR_H - 0.28]) {
      leaf.add(m(box(0.018, 0.09, 0.014, 0.002), M.chrome, [0.004, y, z0 - t / 2 - 0.002]))
    }
  }
  back.add(leaf)
  g.add(back)

  return g
}

/* ── 블라인드 ── */
function blinds(c, position, rotation, width, height) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  const slats = 16
  const gap = height / slats
  for (let i = 0; i < slats; i++) {
    if (!form) {
      g.add(m(box(width, gap * 0.82, 0.012, 0.001), M.slat, [0, height / 2 - gap * (i + 0.5), 0], [0.5, 0, 0]))
    } else {
      // form: 슬랫마다 각도를 ±1.5° 흐트러뜨리고 모서리를 둥글게 + 위아래 레일 분리
      g.add(m(box(width, gap * 0.8, 0.0025, 0.001), M.slat,
        [0, height / 2 - gap * (i + 0.5), jit(0.0015)], [0.5 + jit(0.03), 0, jit(0.004)]))
    }
  }
  if (!form) {
    g.add(m(new THREE.CylinderGeometry(0.004, 0.004, height, 6), M.slat, [width / 2 - 0.05, 0, 0.02]))
  } else {
    g.add(m(box(width + 0.02, 0.055, 0.05, 0.003), M.whitePaint, [0, height / 2 + 0.03, 0.006]))   // 헤드레일
    g.add(m(box(width, 0.016, 0.026, 0.002), M.slat, [0, -height / 2 - 0.012, 0]))                  // 바텀레일
    for (const x of [-width * 0.3, width * 0.3]) {
      g.add(m(new THREE.CylinderGeometry(0.0012, 0.0012, height + 0.05, 5), M.slat, [x, 0, 0.014]))
      g.add(m(new THREE.CylinderGeometry(0.0012, 0.0012, height + 0.05, 5), M.slat, [x, 0, -0.014]))
    }
    g.add(m(new THREE.CylinderGeometry(0.005, 0.005, 0.62, 6), M.slat, [width / 2 - 0.04, height / 2 - 0.32, 0.03]))
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   천장 형광등 패널
   ══════════════════════════════════════════════════════════════════ */
function ceilingPanel(c, x, z) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(x, ROOM.h - 0.02, z)
  if (!form) {
    g.add(m(box(1.3, 0.06, 0.7, 0.002), M.panelFrame, [0, 0, 0]))
    g.add(m(box(1.18, 0.02, 0.58, 0.0015), M.panelGlow, [0, -0.035, 0], [0, 0, 0], { cast: false }))
  } else {
    // form: 하우징(안쪽이 비어 보이게 4변 프레임) + 8mm 함몰된 디퓨저 + 3mm 리빌
    const fw = 1.32, fd = 0.72, ft = 0.075
    g.add(m(box(fw, ft, 0.045, 0.002), M.panelFrame, [0, -0.008, -fd / 2 + 0.022]))
    g.add(m(box(fw, ft, 0.045, 0.002), M.panelFrame, [0, -0.008, fd / 2 - 0.022]))
    g.add(m(box(0.045, ft, fd - 0.09, 0.002), M.panelFrame, [-fw / 2 + 0.022, -0.008, 0]))
    g.add(m(box(0.045, ft, fd - 0.09, 0.002), M.panelFrame, [fw / 2 - 0.022, -0.008, 0]))
    g.add(m(new THREE.PlaneGeometry(fw - 0.09, fd - 0.09), M.panelFrame, [0, 0.02, 0], [Math.PI / 2, 0, 0], { cast: false }))
    g.add(m(box(fw - 0.098, 0.016, fd - 0.098, 0.0015), M.panelGlow, [0, -0.026, 0], [0, 0, 0], { cast: false }))
    g.rotation.y = jit(0.006)  // 시공 오차 같은 미세 비틀림
  }
  const light = new THREE.PointLight(0xffe9cc, 5, 5.5, 2)
  light.position.set(0, -0.4, 0)
  g.add(light)
  return g
}

/* ══════════════════════════════════════════════════════════════════
   책상 위 물건들
   ══════════════════════════════════════════════════════════════════ */
function monitor(c) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(-0.35, 0.83, -0.28)
  g.rotation.y = 0.45 + jit(0.03)
  if (!form) {
    g.add(m(box(0.66, 0.42, 0.04, 0.004), M.monitorBody, [0, 0.42, 0]))
    g.add(m(new THREE.PlaneGeometry(0.6, 0.36), M.monitorScreen, [0, 0.42, 0.022], [0, 0, 0], { cast: false }))
    g.add(m(new THREE.CylinderGeometry(0.022, 0.03, 0.18, 10), M.monitorStand, [0, 0.115, 0]))
    g.add(m(box(0.30, 0.025, 0.18, 0.004), M.monitorStand, [0, 0.02, 0.02]))
  } else {
    // 뒷쉘(살짝 두툼) + 베젤 프레임 + 함몰 패널 + 턱(chin) + 목 + 받침
    g.add(m(box(0.648, 0.408, 0.028, 0.004), M.monitorBody, [0, 0.42, -0.008]))
    g.add(m(box(0.66, 0.42, 0.012, 0.0025), M.monitorBody, [0, 0.42, 0.008]))
    g.add(m(box(0.612, 0.352, 0.006, 0.0015), M.monitorScreen, [0, 0.432, 0.013], [0, 0, 0], { cast: false }))
    g.add(m(box(0.66, 0.03, 0.014, 0.002), M.monitorStand, [0, 0.221, 0.009]))     // 턱
    g.add(m(new THREE.CylinderGeometry(0.004, 0.004, 0.006, 8), M.chrome, [0, 0.228, 0.017], [Math.PI / 2, 0, 0]))
    g.add(m(box(0.055, 0.2, 0.03, 0.006), M.monitorStand, [0, 0.13, -0.03], [0.06, 0, 0]))
    g.add(m(box(0.30, 0.016, 0.19, 0.005), M.monitorStand, [0, 0.014, 0.01]))
    for (const [x, z] of [[-0.12, -0.06], [0.12, -0.06], [0, 0.075]]) {
      g.add(m(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 10), M.blackRubber, [x, 0.004, z + 0.01]))
    }
    // 뒤로 늘어지는 케이블
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.22, -0.04), new THREE.Vector3(0, 0.1, -0.12),
      new THREE.Vector3(0.03, 0.012, -0.2), new THREE.Vector3(0.12, 0.008, -0.28),
    ])
    g.add(m(new THREE.TubeGeometry(curve, 20, 0.0045, 6, false), M.darkPlastic, [0, 0, 0]))
  }
  return g
}

function keyboard(c) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(-0.3, 0.83, 0.02)
  g.rotation.y = 0.45 + jit(0.045)
  if (!form) {
    g.add(m(box(0.44, 0.016, 0.15, 0.0025), M.keyBase, [0, 0, 0]))
    for (const [i, z] of [-0.045, -0.022, 0.001, 0.024].entries()) {
      g.add(m(box(0.4, 0.008, 0.017, 0.0015), M.keyCap, [0, 0.014, z - 0.012]))
    }
    g.add(m(box(0.2, 0.008, 0.016, 0.0015), M.keyCap, [0, 0.014, 0.05]))
  } else {
    // 섀시(둥근 모서리, 살짝 기울임) + 함몰된 키 트레이 + 개별 키캡
    g.add(m(box(0.44, 0.013, 0.15, 0.0025), M.keyBase, [0, 0.001, 0], [-0.025, 0, 0]))
    g.add(m(box(0.415, 0.006, 0.125, 0.0015), M.darkPlastic, [0, 0.008, -0.002], [-0.025, 0, 0], { cast: false }))
    const rows = [-0.045, -0.022, 0.001, 0.024]
    const keyGeo = box(0.0155, 0.0055, 0.0135, 0.0009)
    for (const z of rows) {
      for (let i = 0; i < 22; i++) {
        const x = -0.2 + i * 0.0182
        g.add(m(keyGeo, M.keyCap, [x, 0.0135 + (z + 0.045) * 0.03, z - 0.012], [-0.025, 0, 0], { recv: false }))
      }
    }
    g.add(m(box(0.2, 0.0055, 0.0125, 0.0009), M.keyCap, [0, 0.0165, 0.05], [-0.025, 0, 0], { recv: false }))
    g.add(m(box(0.42, 0.005, 0.008, 0.001), M.keyBase, [0, -0.004, -0.072]))  // 뒷굽
  }
  return g
}

function clipboard(c) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(-2.05 + 0.66, 0.84, 0.5 + 0.1)
  g.rotation.set(-0.1, -0.3 + jit(0.06), 0)
  g.scale.setScalar(0.72)
  g.add(m(box(0.24, 0.014, 0.32, 0.0035), M.clipTeal, [0, 0, 0]))
  if (!form) {
    g.add(m(box(0.2, 0.006, 0.26, 0.0008), M.formSheet, [0, 0.012, 0.015]))
  } else {
    // 종이 3장이 조금씩 어긋나 겹침
    for (let i = 0; i < 3; i++) {
      g.add(m(box(0.2, 0.0022, 0.26, 0.0004), M.formSheet,
        [srnd() * 0.004, 0.0095 + i * 0.0024, 0.015 + srnd() * 0.005], [0, srnd() * 0.02, 0], { cast: i === 2 }))
    }
  }
  for (const z of [0.07, 0.04, 0.01, -0.02, -0.05]) {
    g.add(m(new THREE.BoxGeometry(0.15, 0.001, 0.006), M.clipMetal, [0, 0.0175, z], [0, 0, 0], { cast: false }))
  }
  g.add(m(box(0.1, 0.014, 0.03, 0.002), M.clipMetal, [0, 0.019, -0.14]))
  g.add(m(box(0.06, 0.012, 0.012, 0.002), M.clipMetal, [0, 0.027, -0.137]))
  return g
}

function toolCup(c, position, variant) {
  const { form, box, m } = c
  const g = new THREE.Group()
  g.position.set(...position)
  const r0 = variant === 0 ? 0.045 : 0.05
  const r1 = variant === 0 ? 0.04 : 0.045
  const hgt = variant === 0 ? 0.13 : 0.11
  const mat = variant === 0 ? M.cupMetal : M.cupMetal2
  g.add(m(new THREE.CylinderGeometry(r0, r1, hgt, 24), mat, [0, hgt / 2, 0]))
  g.add(m(new THREE.TorusGeometry(r0 - 0.001, 0.0045, 8, 24), variant === 0 ? M.clipMetal : M.cupMetal, [0, hgt, 0], [Math.PI / 2, 0, 0]))
  g.add(m(new THREE.CylinderGeometry(r0 - 0.006, r0 - 0.006, 0.035, 20), M.cupInner, [0, hgt - 0.015, 0], [0, 0, 0], { cast: false }))
  if (form) {
    // 컵 바닥의 미세 챔퍼 — 바닥과 만나는 선을 부드럽게
    g.add(m(new THREE.TorusGeometry(r1 - 0.002, 0.0025, 6, 20), mat, [0, 0.0025, 0], [Math.PI / 2, 0, 0]))
  }
  const stick = (color, x, z, rot, len, rad, tipMat, tipLen) => {
    const s = new THREE.Group()
    s.position.set(x, 0, z); s.rotation.set(rot[0], 0, rot[1])
    s.add(m(new THREE.CylinderGeometry(rad, rad, len, 10), color, [0, len / 2 + 0.04, 0]))
    if (tipMat) s.add(m(new THREE.CylinderGeometry(rad * 1.1, rad * 1.1, tipLen, 10), tipMat, [0, len + 0.04 + tipLen / 2, 0]))
    g.add(s)
  }
  if (variant === 0) {
    stick(M.darkPlastic, -0.018, 0.012, [0.08, 0.05], 0.24, 0.008,
      new THREE.MeshStandardMaterial({ color: '#fffbe0', emissive: '#fff3b0', emissiveIntensity: 0.7 }), 0.018)
    stick(M.monitorStand, 0.008, -0.016, [-0.05, -0.02], 0.18, 0.013, null, 0)
    g.add(m(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 14), M.stainless, [0.008, 0.245, -0.016], [-0.05, 0, -0.02]))
    stick(M.clipMetal, 0.022, 0.014, [0.05, 0.13], 0.26, 0.005, null, 0)
    g.add(m(new THREE.CylinderGeometry(0.026, 0.026, 0.055, 3), new THREE.MeshStandardMaterial({ color: '#9b2f29', roughness: 0.6 }),
      [0.022, 0.31, 0.014], [0, 0, Math.PI / 2]))
  } else {
    for (const x of [-0.02, 0.0, 0.022]) {
      const s = new THREE.Group(); s.position.set(x, 0, -0.012); s.rotation.set(0.05, 0, x * 1.5)
      s.add(m(box(0.016, 0.17, 0.004, 0.0016), M.wood, [0, 0.16, 0]))
      s.add(m(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 12), M.wood, [0, 0.245, 0], [0, 0, 0]))
      g.add(s)
    }
    for (const x of [-0.02, 0.0, 0.02]) {
      const s = new THREE.Group(); s.position.set(x, 0, 0.02); s.rotation.set(-0.04, 0, x * 1.6)
      s.add(m(new THREE.CylinderGeometry(0.0022, 0.0022, 0.18, 6), M.paperRoll, [0, 0.14, 0]))
      s.add(m(new THREE.CylinderGeometry(0.004, 0.004, 0.021, 8), M.paperRoll, [0, 0.235, 0]))
      g.add(s)
    }
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   롤링 스툴
   ══════════════════════════════════════════════════════════════════ */
function stool(c, position, yaw = 0) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(...position)
  g.rotation.y = yaw + jit(0.09)   // (d) 의자 각도 미세 비대칭
  if (!form) {
    g.add(m(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 20), M.stoolSeat, [0, 0.5, 0]))
    g.add(m(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 10), M.chrome, [0, 0.32, 0]))
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      g.add(m(box(0.22, 0.04, 0.04, 0.006), M.stoolLeg, [Math.cos(a) * 0.18, 0.06, Math.sin(a) * 0.18], [0, -a, 0]))
    }
  } else {
    // 좌면 = 쿠션 + 테두리 토러스 + (3mm 틈) + 좌판, 가스실린더 2단, 5발 + 캐스터
    g.add(m(new THREE.CylinderGeometry(0.208, 0.196, 0.062, 28), M.stoolSeat, [0, 0.523, 0]))
    g.add(m(new THREE.TorusGeometry(0.199, 0.016, 8, 28), M.stoolSeat, [0, 0.5, 0], [Math.PI / 2, 0, 0]))
    g.add(m(new THREE.CylinderGeometry(0.19, 0.185, 0.018, 24), M.darkPlastic, [0, 0.478, 0]))     // 좌판 (3mm 틈)
    g.add(m(new THREE.CylinderGeometry(0.055, 0.055, 0.028, 16), M.stoolLeg, [0, 0.458, 0]))       // 좌면 브라켓
    g.add(m(new THREE.CylinderGeometry(0.026, 0.026, 0.18, 14), M.chrome, [0, 0.36, 0]))           // 상단 봉
    g.add(m(new THREE.TorusGeometry(0.03, 0.006, 8, 16), M.stoolLeg, [0, 0.272, 0], [Math.PI / 2, 0, 0]))
    g.add(m(new THREE.CylinderGeometry(0.036, 0.04, 0.2, 14), M.chrome, [0, 0.17, 0]))             // 하단 봉
    g.add(m(box(0.11, 0.014, 0.026, 0.006), M.stoolLeg, [0.085, 0.3, 0.02], [0, 0.3, -0.08]))      // 높이조절 레버
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + jit(0.02)
      const leg = new THREE.Group()
      leg.rotation.y = -a
      leg.add(m(box(0.235, 0.034, 0.05, 0.008), M.stoolLeg, [0.145, 0.062, 0], [0, 0, -0.06]))
      leg.add(m(box(0.07, 0.05, 0.062, 0.01), M.stoolLeg, [0.045, 0.078, 0]))
      // 캐스터 (포크 + 바퀴 2개)
      leg.add(m(box(0.03, 0.035, 0.05, 0.006), M.darkPlastic, [0.245, 0.045, 0]))
      leg.add(m(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 14), M.blackRubber, [0.245, 0.026, 0.024], [Math.PI / 2, 0, 0]))
      leg.add(m(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 14), M.blackRubber, [0.245, 0.026, -0.024], [Math.PI / 2, 0, 0]))
      g.add(leg)
    }
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   진찰대
   로컬 좌표: +z = 머리쪽, +x = 의사(카메라)쪽. 배치는 [1.95,0,-3.5] rotY=-90°.
   ══════════════════════════════════════════════════════════════════ */
function examBed(c) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(...EXAM.bedPos)
  g.rotation.y = EXAM.bedRotY

  if (!form) {
    g.add(m(box(0.72, 0.12, 1.9, 0.014), M.matVinyl, [0, 0.62, 0]))
    g.add(m(box(0.66, 0.012, 1.5, 0.001), M.paper, [0, 0.685, 0.1]))
    g.add(m(box(0.66, 0.56, 1.7, 0.008), M.bedWood, [0, 0.28, 0]))
    g.add(m(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 16), M.paperRoll, [0, 0.7, 0.97], [0, 0, Math.PI / 2]))
    return g
  }

  /* ── form ── */
  // 1) 매트를 3구간으로 분할 (헤드 섹션은 2° 들림) — 사이 4mm 틈
  const sections = [
    { len: 0.60, cz: -0.65, tilt: 0 },
    { len: 0.64, cz: -0.026, tilt: 0 },
    { len: 0.652, cz: 0.624, tilt: -0.035 },
  ]
  for (const s of sections) {
    const sec = new THREE.Group()
    sec.position.set(0, 0.62, s.cz)
    sec.rotation.x = s.tilt
    sec.add(m(box(0.72, 0.115, s.len, 0.022), M.matVinyl, [0, 0, 0]))
    // 비닐 봉제선 — 매트 옆면을 따라 도는 가는 홈
    sec.add(m(box(0.726, 0.008, s.len - 0.03, 0.002), M.bedWood, [0, -0.012, 0], [0, 0, 0], { cast: false }))
    g.add(sec)
  }
  // 2) 종이 커버 — 머리쪽 롤에서 나와 매트 위를 덮고 발쪽 모서리에서 살짝 꺾여 내려간다
  g.add(m(box(0.66, 0.004, 1.5, 0.0012), M.paper, [jit(0.006), 0.6805, 0.11], [0, jit(0.008), 0], { cast: false }))
  g.add(m(box(0.658, 0.0035, 0.1, 0.0012), M.paper, [0, 0.667, -0.685], [-0.5, 0, 0], { cast: false }))
  g.add(m(box(0.656, 0.0035, 0.075, 0.0012), M.paper, [0, 0.634, -0.735], [-1.05, 0.01, 0], { cast: false }))
  // 3) 매트와 캐비닛 사이 스틸 프레임 밴드 (2mm 안쪽으로 들어가 그림자선이 생긴다)
  g.add(m(box(0.686, 0.042, 1.72, 0.004), M.darkPlastic, [0, 0.541, 0]))
  g.add(m(box(0.7, 0.012, 1.74, 0.003), M.chrome, [0, 0.516, 0]))
  // 4) 베이스 캐비닛 = 몸통 + 서랍면 3장(2mm 틈) + 손잡이 + 걸레받이(toe kick)
  g.add(m(box(0.6, 0.085, 1.6, 0.004), M.darkPlastic, [0, 0.0425, 0]))          // toe kick (안쪽으로 30mm)
  g.add(m(box(0.66, 0.4, 1.7, 0.005), M.bedWood, [0, 0.29, 0]))                  // 몸통
  const dW = 0.535, dH = 0.115
  for (let i = 0; i < 3; i++) {
    const z = -0.56 + i * 0.56
    g.add(m(box(0.018, 0.345, dW, 0.0022), M.bedWood, [0.333, 0.29, z]))         // 서랍면 (사이 25mm 틈)
    g.add(m(box(0.014, 0.018, 0.16, 0.005), M.chrome, [0.348, 0.29 + 0.1, z]))   // 손잡이 바
    g.add(m(box(0.012, 0.028, 0.016, 0.004), M.chrome, [0.343, 0.29 + 0.1, z - 0.075]))
    g.add(m(box(0.012, 0.028, 0.016, 0.004), M.chrome, [0.343, 0.29 + 0.1, z + 0.075]))
    void dH
  }
  // 뒤쪽(벽쪽) 면에도 얕은 패널선
  g.add(m(box(0.012, 0.34, 1.6, 0.002), M.bedWood, [-0.333, 0.29, 0]))
  // 5) 페이퍼 롤 디스펜서 = 브라켓 2개 + 축 + 롤
  g.add(m(new THREE.CylinderGeometry(0.058, 0.058, 0.56, 20), M.paperRoll, [0, 0.7, 0.965], [0, 0, Math.PI / 2]))
  g.add(m(new THREE.CylinderGeometry(0.014, 0.014, 0.63, 10), M.chrome, [0, 0.7, 0.965], [0, 0, Math.PI / 2]))
  for (const x of [-0.31, 0.31]) {
    g.add(m(box(0.016, 0.13, 0.05, 0.004), M.chrome, [x, 0.655, 0.965]))
  }
  // 6) 계단 발판 (진찰대에 늘 붙어 있는 물건) — 형태 단서 추가
  const step = new THREE.Group()
  step.position.set(0.52, 0, -0.35)
  step.rotation.y = jit(0.06)
  step.add(m(box(0.36, 0.028, 0.28, 0.004), M.darkPlastic, [0, 0.2, 0]))
  step.add(m(box(0.34, 0.026, 0.26, 0.004), M.blackRubber, [0, 0.216, 0], [0, 0, 0], { cast: false }))
  for (const [x, z] of [[-0.15, -0.11], [0.15, -0.11], [-0.15, 0.11], [0.15, 0.11]]) {
    step.add(m(new THREE.CylinderGeometry(0.012, 0.014, 0.19, 10), M.chrome, [x, 0.095, z]))
  }
  g.add(step)
  return g
}

/* ══════════════════════════════════════════════════════════════════
   프라이버시 커튼
   ══════════════════════════════════════════════════════════════════ */
function privacyCurtain(c, position, rotation, length) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  const railH = 2.0

  if (!form) {
    g.add(m(new THREE.CylinderGeometry(0.018, 0.018, length, 10), M.rail, [0, railH, 0], [0, 0, Math.PI / 2]))
    const panels = 7
    for (let i = 0; i < panels; i++) {
      const x = -length / 2 + (length / panels) * (i + 0.5)
      const depth = i % 2 === 0 ? 0.05 : -0.05
      g.add(m(box(length / panels - 0.01, railH - 0.1, 0.03, 0.004),
        i % 2 === 0 ? M.curtainA : M.curtainB, [x, railH / 2 - 0.05, depth]))
    }
    return g
  }

  /* form: 판때기 7장 → 실제 주름진 천 한 장 (사인파 변위) */
  g.add(m(new THREE.CylinderGeometry(0.016, 0.016, length + 0.06, 12), M.rail, [0, railH, 0], [0, 0, Math.PI / 2]))
  for (let i = 0; i < 3; i++) {   // 레일 브라켓
    const x = -length / 2 + (length / 2) * i
    g.add(m(box(0.03, 0.05, 0.03, 0.004), M.rail, [x, railH + 0.035, 0]))
  }
  const H = railH - 0.14
  const geo = new THREE.PlaneGeometry(length, H, 72, 8)
  const pos = geo.attributes.position
  const folds = Math.max(4, Math.round(length / 0.24))
  const phase = jit(1.4)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i)
    const t = (x + length / 2) / length
    const sag = 0.55 + 0.45 * ((H / 2 - y) / H)       // 아래로 갈수록 주름이 깊어진다
    const z = Math.sin(t * folds * Math.PI * 2 + phase) * 0.052 * sag
      + Math.sin(t * folds * Math.PI * 4.3 + 1.1) * 0.012 * sag
    pos.setZ(i, z)
    // 아랫단이 살짝 흔들림
    pos.setY(i, y + (y < -H / 2 + 0.05 ? Math.sin(t * folds * Math.PI * 2) * 0.008 : 0))
  }
  geo.computeVertexNormals()
  g.add(m(geo, M.curtainA, [0, railH - 0.07 - H / 2 + 0.02, 0], [0, 0, 0], { cast: true, recv: true }))
  // 상단 메시(통풍) 띠 + 하단 헴
  g.add(m(box(length, 0.03, 0.012, 0.002), M.curtainB, [0, railH - 0.055, 0], [0, 0, 0], { cast: false }))
  // 링
  const rings = Math.round(length / 0.16)
  for (let i = 0; i < rings; i++) {
    const x = -length / 2 + (length / rings) * (i + 0.5)
    g.add(m(new THREE.TorusGeometry(0.019, 0.0035, 6, 12), M.rail, [x, railH - 0.008, 0], [0, Math.PI / 2, 0]))
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   IV 폴 / 바이탈 카트 / 벽 스테이션
   ══════════════════════════════════════════════════════════════════ */
function casterBase(c, r = 0.26) {
  const { form, box, m } = c
  const g = new THREE.Group()
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const leg = new THREE.Group()
    leg.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r)
    if (!form) {
      leg.add(m(box(r, 0.035, 0.04, 0.006), M.steel, [0, 0, 0], [0, -a, 0]))
      leg.add(m(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 10), M.darkPlastic,
        [Math.cos(a) * r * 0.5, -0.015, Math.sin(a) * r * 0.5]))
    } else {
      const arm = new THREE.Group(); arm.rotation.y = -a
      arm.add(m(box(r * 1.05, 0.03, 0.044, 0.008), M.steel, [0.02, 0.004, 0], [0, 0, -0.05]))
      arm.add(m(box(0.05, 0.04, 0.055, 0.01), M.darkPlastic, [r * 0.5, -0.004, 0]))
      arm.add(m(new THREE.CylinderGeometry(0.024, 0.024, 0.011, 12), M.blackRubber, [r * 0.5, -0.018, 0.02], [Math.PI / 2, 0, 0]))
      arm.add(m(new THREE.CylinderGeometry(0.024, 0.024, 0.011, 12), M.blackRubber, [r * 0.5, -0.018, -0.02], [Math.PI / 2, 0, 0]))
      leg.add(arm)
    }
    g.add(leg)
  }
  if (form) g.add(m(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 14), M.steel, [0, 0.045, 0]))
  return g
}

function ivPole(c, position) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(...position)
  g.rotation.y = jit(0.15)
  g.add(casterBase(c, 0.22))
  if (!form) {
    g.add(m(new THREE.CylinderGeometry(0.018, 0.018, 1.9, 12), M.chrome, [0, 0.95, 0]))
    g.add(m(new THREE.TorusGeometry(0.05, 0.008, 8, 16, Math.PI), M.chrome, [0, 1.9, 0], [0, 0, Math.PI / 2]))
    g.add(m(box(0.13, 0.24, 0.04, 0.006), M.ivBag, [0.08, 1.62, 0]))
    g.add(m(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), M.ivDrip, [0.08, 1.44, 0], [0, 0, 0], { cast: false }))
  } else {
    // 2단 텔레스코픽 + 조임 칼라 + 십자 후크
    g.add(m(new THREE.CylinderGeometry(0.024, 0.024, 1.0, 16), M.chrome, [0, 0.55, 0]))
    g.add(m(new THREE.CylinderGeometry(0.031, 0.031, 0.05, 16), M.darkPlastic, [0, 1.05, 0]))
    g.add(m(box(0.05, 0.02, 0.022, 0.006), M.darkPlastic, [0.036, 1.05, 0]))
    g.add(m(new THREE.CylinderGeometry(0.016, 0.016, 0.98, 14), M.chrome, [0, 1.5, 0]))
    for (const a of [0, Math.PI / 2]) {
      g.add(m(new THREE.TorusGeometry(0.055, 0.006, 6, 14, Math.PI), M.chrome, [0, 1.965, 0], [0, a, Math.PI / 2]))
    }
    g.add(m(new THREE.CylinderGeometry(0.021, 0.021, 0.03, 14), M.chrome, [0, 1.98, 0]))
  }
  return g
}

function vitalsCart(c, position, rotation) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(...position)
  g.rotation.set(rotation[0], rotation[1] + jit(0.05), rotation[2])
  const scr = vitalsTexture()
  const screenMat = new THREE.MeshStandardMaterial({ map: scr, emissiveMap: scr, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.3 })

  for (const [x, z] of [[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]]) {
    const wg = new THREE.Group(); wg.position.set(x, 0.09, z)
    wg.add(m(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 18), M.blackRubber, [0, 0, 0], [0, 0, Math.PI / 2]))
    wg.add(m(new THREE.CylinderGeometry(0.04, 0.04, 0.07, 12), M.steel, [0, 0, 0]))
    g.add(wg)
  }
  g.add(m(c.box(0.5, 0.06, 0.62, form ? 0.006 : 0), M.darkPlastic, [0, 0.18, 0]))
  if (!form) {
    g.add(m(box(0.46, 0.64, 0.46, 0.006), M.cartWhite, [0, 0.52, -0.02]))
    g.add(m(box(0.47, 0.12, 0.47, 0.005), M.darkPlastic, [0, 0.24, -0.02]))
    for (const x of [-0.15, -0.05, 0.05, 0.15]) {
      g.add(m(box(0.07, 0.14, 0.04, 0.004), M.stainless, [x, 0.6, 0.215]))
      g.add(m(new THREE.CapsuleGeometry(0.022, 0.08, 4, 8), M.probe, [x, 0.62, 0.245]))
    }
    g.add(m(box(0.44, 0.34, 0.1, 0.006), M.darkPlastic, [0, 1.06, -0.02]))
    g.add(m(new THREE.PlaneGeometry(0.4, 0.3), screenMat, [0, 1.06, 0.032], [0, 0, 0], { cast: false }))
    g.add(m(new THREE.CylinderGeometry(0.028, 0.028, 0.36, 10), M.steel, [0, 0.9, -0.02]))
  } else {
    // 서랍 2단 + 2mm 틈 + 손잡이 + 토킥, 밀대 손잡이, 모니터 헤드는 GLB(main.js에서 부착)
    g.add(m(box(0.46, 0.6, 0.46, 0.006), M.cartWhite, [0, 0.54, -0.02]))
    g.add(m(box(0.47, 0.1, 0.47, 0.005), M.darkPlastic, [0, 0.245, -0.02]))
    for (let i = 0; i < 2; i++) {
      const y = 0.42 + i * 0.24
      g.add(m(box(0.42, 0.215, 0.018, 0.0025), M.cartWhite, [0, y, 0.222]))
      g.add(m(box(0.19, 0.016, 0.016, 0.005), M.chrome, [0, y + 0.075, 0.238]))
    }
    for (const x of [-0.15, -0.05, 0.05, 0.15]) {
      g.add(m(box(0.07, 0.14, 0.04, 0.004), M.stainless, [x, 0.86, 0.215]))
      g.add(m(new THREE.CapsuleGeometry(0.022, 0.08, 4, 8), M.probe, [x, 0.88, 0.245]))
    }
    g.add(m(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 12), M.steel, [0, 0.98, -0.02]))
    // 밀대 손잡이
    g.add(m(new THREE.CylinderGeometry(0.014, 0.014, 0.38, 10), M.chrome, [0, 1.0, -0.25], [0, 0, Math.PI / 2]))
    for (const x of [-0.17, 0.17]) g.add(m(box(0.026, 0.02, 0.2, 0.006), M.darkPlastic, [x, 1.0, -0.16]))
    // GLB 모니터 헤드(텍스처 0장)에 실제 화면이 없어 계기가 안 읽힌다 → 발광 화면판을 덧댄다
    const scrPlane = m(new THREE.PlaneGeometry(0.3, 0.225), screenMat, [0, 1.155, 0.115], [0, 0, 0], { cast: false })
    scrPlane.name = 'glb-screen'
    g.add(scrPlane)
  }
  return { group: g, screenMat }
}

function wallMedStation(c, position) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(...position)
  if (!form) {
    g.add(m(box(0.78, 0.5, 0.03, 0.003), M.stainless, [0, 0, 0]))
    GLOVE_COLORS.forEach((col, i) => {
      const bg = new THREE.Group(); bg.position.set(-0.26 + i * 0.26, 0.06, 0.06)
      bg.add(m(box(0.2, 0.26, 0.09, 0.004), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })))
      bg.add(m(box(0.1, 0.05, 0.02, 0.004), M.gloveWhite, [0, 0.05, 0.05]))
      g.add(bg)
    })
    const sh = new THREE.Group(); sh.position.set(-0.28, -0.12, 0.07)
    sh.add(m(box(0.16, 0.2, 0.12, 0.004), M.sharps))
    sh.add(m(box(0.16, 0.03, 0.12, 0.004), M.sharpsLid, [0, 0.11, 0]))
    g.add(sh)
  } else {
    // 백패널 + 개별 브라켓(틈 3mm) + 장갑박스 + 샤프스통(뚜껑 분리 + 투입구)
    g.add(m(box(0.78, 0.5, 0.012, 0.002), M.stainless, [0, 0, 0]))
    GLOVE_COLORS.forEach((col, i) => {
      const bg = new THREE.Group()
      bg.position.set(-0.26 + i * 0.26, 0.06, 0.062)
      bg.rotation.z = jit(0.02)
      // 벽 브라켓 (틀만)
      bg.add(m(box(0.216, 0.02, 0.1, 0.003), M.stainless, [0, -0.135, 0.004]))
      for (const sx of [-0.104, 0.104]) bg.add(m(box(0.012, 0.26, 0.1, 0.002), M.stainless, [sx, 0, 0.004]))
      bg.add(m(box(0.2, 0.26, 0.086, 0.004), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }), [0, 0, 0]))
      bg.add(m(box(0.115, 0.045, 0.01, 0.004), M.darkPlastic, [0, 0.05, 0.044], [0, 0, 0], { cast: false }))
      bg.add(m(box(0.1, 0.05, 0.028, 0.012), M.gloveWhite, [0.006, 0.058, 0.052], [0.2, 0, jit(0.15)]))
      g.add(bg)
    })
    const sh = new THREE.Group(); sh.position.set(-0.28, -0.12, 0.075)
    sh.add(m(box(0.16, 0.19, 0.12, 0.004), M.sharps, [0, -0.005, 0]))
    sh.add(m(box(0.168, 0.032, 0.128, 0.005), M.sharpsLid, [0, 0.107, 0]))   // 뚜껑 (3mm 틈으로 분리)
    sh.add(m(box(0.07, 0.012, 0.05, 0.003), M.darkPlastic, [0, 0.122, 0], [0, 0, 0], { cast: false }))
    sh.add(m(box(0.176, 0.024, 0.132, 0.004), M.stainless, [0, -0.098, 0]))  // 벽 브라켓
    g.add(sh)
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   벽 아이템
   ══════════════════════════════════════════════════════════════════ */
function poster(c, position, rotation, size, kind, frameMat) {
  const { form, box, m, jit } = c
  const g = new THREE.Group()
  g.position.set(...position)
  g.rotation.set(rotation[0], rotation[1], rotation[2] + (form ? srnd() * 0.018 : 0))  // (d) 액자 수평 흐트림
  const tex = anatomyTexture(kind)
  if (!form) {
    g.add(m(box(size[0] + 0.04, size[1] + 0.04, 0.02, 0.003), frameMat, [0, 0, 0]))
    g.add(m(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
      [0, 0, 0.012], [0, 0, 0], { cast: false }))
  } else {
    // 액자 = 4변 몰딩 + 매트지 + 유리(살짝 앞) + 함몰된 인쇄면
    const [w, h] = size
    const fw = 0.028, ft = 0.026
    g.add(m(box(w + fw * 2, ft, ft, 0.003), frameMat, [0, h / 2 + fw / 2, 0]))
    g.add(m(box(w + fw * 2, ft, ft, 0.003), frameMat, [0, -h / 2 - fw / 2, 0]))
    g.add(m(box(fw, h, ft, 0.003), frameMat, [-w / 2 - fw / 2, 0, 0]))
    g.add(m(box(fw, h, ft, 0.003), frameMat, [w / 2 + fw / 2, 0, 0]))
    g.add(m(new THREE.PlaneGeometry(w + 0.01, h + 0.01), M.formSheet, [0, 0, -0.004], [0, 0, 0], { cast: false }))
    g.add(m(new THREE.PlaneGeometry(w * 0.92, h * 0.92), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
      [0, 0, 0.001], [0, 0, 0], { cast: false }))
    g.add(m(new THREE.PlaneGeometry(w + 0.012, h + 0.012),
      new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.06, roughness: 0.08, metalness: 0.0 }),
      [0, 0, 0.011], [0, 0, 0], { cast: false }))
    void jit
  }
  return g
}

function certificate(c, position, rotation, size) {
  const { form, box, m } = c
  const g = new THREE.Group()
  g.position.set(...position)
  g.rotation.set(rotation[0], rotation[1], rotation[2] + (form ? srnd() * 0.022 : 0))
  g.add(m(box(size[0] + 0.04, size[1] + 0.04, 0.025, 0.003), M.frameGold, [0, 0, 0]))
  g.add(m(new THREE.PlaneGeometry(size[0] - 0.02, size[1] - 0.02), M.formSheet, [0, 0, 0.014], [0, 0, 0], { cast: false }))
  g.add(m(new THREE.PlaneGeometry(size[0] - 0.1, size[1] - 0.14),
    new THREE.MeshStandardMaterial({ color: '#efe2c2', roughness: 0.9 }), [0, 0.02, 0.016], [0, 0, 0], { cast: false }))
  for (const [i, y] of [0.12, 0.06, 0.0, -0.06, -0.12].entries()) {
    g.add(m(new THREE.PlaneGeometry((size[0] - 0.18) * (i === 0 ? 0.55 : 0.85), 0.012),
      new THREE.MeshStandardMaterial({ color: '#8a7a55', roughness: 0.9 }), [0, y + 0.02, 0.017], [0, 0, 0], { cast: false }))
  }
  return g
}

function xrayViewbox(c, position, rotation, size) {
  const { form, box, m } = c
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  g.add(m(box(size[0] + 0.06, size[1] + 0.06, 0.05, 0.004), M.stainless, [0, 0, 0]))
  g.add(m(new THREE.PlaneGeometry(size[0], size[1]),
    new THREE.MeshStandardMaterial({ color: '#dfe9f2', emissive: '#cfe0f0', emissiveIntensity: 0.75 }),
    [0, 0, 0.027], [0, 0, 0], { cast: false }))
  if (form) {
    g.add(m(box(size[0] + 0.02, 0.016, 0.03, 0.003), M.stainless, [0, size[1] / 2 + 0.006, 0.018]))  // 필름 클립바
    for (const x of [-size[0] * 0.3, size[0] * 0.3]) {
      g.add(m(box(0.05, 0.022, 0.014, 0.003), M.chrome, [x, size[1] / 2 + 0.006, 0.032]))
    }
  }
  return g
}

function bookRow(c, position, rotation, count, width) {
  const { form, box, m } = c
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  const bw = width / count
  for (let i = 0; i < count; i++) {
    const h = 0.2 + ((i * 37) % 9) * 0.012
    const mat = new THREE.MeshStandardMaterial({ color: BOOK_COLORS[i % BOOK_COLORS.length], roughness: 0.78 })
    if (!form) {
      g.add(m(box(bw * 0.86, h, 0.16, 0.0018), mat, [-width / 2 + bw * (i + 0.5), h / 2, 0]))
    } else {
      // 두께·깊이 제각각 + 마지막 한 권은 기울어짐 + 책등 홈
      const d = 0.15 + ((i * 53) % 5) * 0.008
      const lean = i === count - 2 ? 0.12 : srnd() * 0.012
      const bx = -width / 2 + bw * (i + 0.5)
      g.add(m(box(bw * (0.8 + ((i * 17) % 3) * 0.04), h, d, 0.0018), mat, [bx, h / 2, srnd() * 0.006], [0, 0, lean]))
      g.add(m(box(bw * 0.5, 0.012, 0.004, 0.0012),
        new THREE.MeshStandardMaterial({ color: '#e8e2d2', roughness: 0.85 }),
        [bx, h * 0.72, d / 2 + srnd() * 0.006], [0, 0, lean], { cast: false }))
    }
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   전체 조립
   ══════════════════════════════════════════════════════════════════ */
export function buildRoom(mode) {
  _seed = 20260725
  const c = ctx(mode)
  const { form, m, box, jit } = c
  const root = new THREE.Group()
  root.name = `room-${mode}`

  root.add(shell(c))
  for (const [x, z] of [[-1.3, -1.8], [1.3, -1.8], [-1.3, -3.8], [1.3, -3.8]]) root.add(ceilingPanel(c, x, z))

  /* 책상 그룹 (GLB 본체는 addProps에서 붙는다) */
  const desk = new THREE.Group()
  desk.position.set(-2.05, 0, 0.5)
  desk.name = 'desk'
  desk.add(monitor(c))
  desk.add(keyboard(c))
  desk.add(toolCup(c, [0.34, 0.84, -0.33], 0))
  desk.add(toolCup(c, [0.52, 0.84, -0.33], 1))
  if (form) {
    // 책상 위 잡동사니 — 형태만으로 "쓰이는 책상"을 만든다 (재질은 기존 것 재사용)
    const stack = new THREE.Group()
    stack.position.set(0.44, 0.84, 0.16)
    for (let i = 0; i < 5; i++) {
      stack.add(m(box(0.21, 0.0035, 0.297, 0.0012), M.formSheet,
        [srnd() * 0.004, i * 0.0038, srnd() * 0.005], [0, srnd() * 0.035, 0], { cast: i === 4 }))
    }
    desk.add(stack)
    const mug = new THREE.Group(); mug.position.set(-0.62, 0.84, 0.12)
    mug.add(m(new THREE.CylinderGeometry(0.041, 0.036, 0.095, 20), M.formSheet, [0, 0.0475, 0]))
    mug.add(m(new THREE.TorusGeometry(0.026, 0.006, 6, 14), M.formSheet, [0.045, 0.052, 0], [0, Math.PI / 2, 0]))
    mug.add(m(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 16), new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 0.35 }), [0, 0.084, 0], [0, 0, 0], { cast: false }))
    mug.rotation.y = jit(0.4)
    desk.add(mug)
  }
  root.add(clipboard(c))   // clipboard()는 이미 월드좌표로 배치된다
  root.add(desk)

  /* 의자 */
  root.add(stool(c, SEAT.pos, 0))

  /* 진찰대 + 커튼 */
  root.add(examBed(c))
  root.add(privacyCurtain(c, [2.4, 0, -2.3], [0, 0, 0], 2.0))
  root.add(privacyCurtain(c, [0.9, 0, -3.15], [0, Math.PI / 2, 0], 1.7))

  /* 책 */
  for (const [y, z, n, w] of [[1.42, -3.3, 7, 0.9], [1.02, -3.3, 8, 0.92], [0.62, -3.3, 6, 0.88], [1.42, -3.95, 7, 0.86], [1.02, -3.95, 8, 0.9]]) {
    root.add(bookRow(c, [-2.78, y, z], [0, Math.PI / 2, 0], n, w))
  }

  /* 벽 아이템 */
  root.add(poster(c, [0.62, 1.55, ROOM.backZ + 0.05], [0, 0, 0], [0.6, 0.9], 'organs', M.frameGold))
  root.add(poster(c, [-3.14, 1.55, -2.2], [0, Math.PI / 2, 0], [0.42, 0.66], 'skeleton', M.frameBlue))
  root.add(certificate(c, [0.05, 2.22, ROOM.backZ + 0.05], [0, 0, 0], [0.3, 0.4]))
  root.add(xrayViewbox(c, [-3.13, 1.6, -1.4], [0, Math.PI / 2, 0], [0.6, 0.76]))
  root.add(wallMedStation(c, [1.6, 1.6, ROOM.backZ + 0.05]))

  /* 의료 기구 */
  const pole = ivPole(c, [2.62, 0, -2.7])
  pole.name = 'ivpole'
  root.add(pole)
  const vc = vitalsCart(c, [2.05, 0, -1.5], [0, -0.63, 0])
  root.add(vc.group)

  return { root, deskGroup: desk, cart: vc.group }
}

/* GLB 프롭 부착 — 두 모드 공통(desk/bookshelf/plant/clock)과 form 전용(vitals_monitor 등) */
export async function addProps(built, mode) {
  const c = ctx(mode)
  const { form, box, m } = c   // form = 부품분할/GLB 교체 스위치
  const { root, deskGroup, cart } = built

  const jobs = [
    propNode('metal_office_desk', [0, 0, -0.08], [0, 0, 0], [0.92, 1.06, 0.88]).then((n) => n && deskGroup.add(n)),
    propNode('wooden_bookshelf_worn', [-2.9, 0, -3.3], [0, Math.PI / 2, 0], 1.5).then((n) => n && root.add(n)),
    propNode('potted_plant_01', [-2.85, 0, ROOM.backZ + 0.5], [0, 0, 0], 1.2).then((n) => n && root.add(n)),
    propNode('wall_clock', [2.45, 2.45, ROOM.backZ + 0.08], [0, 0, 0], 1.0).then((n) => {
      if (!n) return
      if (form) n.rotation.z = -0.014      // (d) 시계도 아주 살짝 삐뚤게
      root.add(n)
    }),
    propNode('metal_trash_can', [-2.85, 0, -0.55], [0, form ? 0.4 : 0, 0], 1.0).then((n) => n && root.add(n)),
  ]

  if (form) {
    // ── 미사용 GLB 연결 ──
    jobs.push(fittedGLB('/models/vitals_monitor.glb', 0.48, [0, 1.16, -0.02], [0, Math.PI, 0]).then((n) => {
      if (n) { n.name = 'glb-vitals'; cart.add(n) }
    }))
    jobs.push(fittedGLB('/models/iv_drip.glb', 0.46, [0.055, 1.73, 0], [0, 0.5, 0]).then((n) => {
      if (!n) return
      n.name = 'glb-ivdrip'
      const pole = root.children.find((o) => o.name === 'ivpole')
      ;(pole || root).add(n)
      if (!pole) { n.position.set(2.62 + 0.055, 1.73, -2.7) }
    }))
  }
  void box; void m
  await Promise.all(jobs)
}
