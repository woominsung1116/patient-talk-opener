/**
 * clinic-lab / FINAL — 방 빌더
 *
 *   buildRoom('base')   본 씬(ClinicScene.tsx)의 형태 그대로 (대조군)
 *   buildRoom('final')  심사에서 **효과 있다고 판정된 기법만** 적용한 것
 *
 * final 이 base 와 다른 형태(form)는 딱 6가지다. 이 여섯 개만 심사를 통과했다:
 *   F1  커튼 판자 7장 → 레일·후크 달린 주름 천 1장          ← 단일 기법 최대 효과
 *   F2  천장 T바 그리드 (156조각 → 병합 1 call)
 *   F3  진찰대 통짜 상자 → 매트 3분할 + 서랍 + 손잡이 + 토킥 + 스틸밴드
 *   F4  웨인스코트 두께 14mm + 세로살대 + 챠레일 캡 + 3단 걸레받이 (4면 전부)
 *   F5  창 케이싱 + 창턱 코 + 새시 분할
 *   F6  문 스타일/레일/함몰패널/레버 부품화
 *
 * 넣지 않은 것 (심사에서 기각 — 넣으면 비용만 는다):
 *   · RoundedBoxGeometry 라운딩 (2/8/20mm 전부 육안 식별 불가, tri +17.7%)
 *   · 미세 비대칭 1~3° (2m 거리에서 약 2px)
 *   · exam_bed.glb / iv_drip.glb / vitals_monitor.glb / privacy_curtain.glb
 *   · 책상·모니터·키보드·스툴·카트의 부품 분할
 *     (게임 문진 카메라는 책상을 등지고, 진찰 카메라는 환자 몸이 프레임을 덮는다)
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  ROOM, DOOR_X, DOOR_W, DOOR_H, SEAT, EXAM, PANELS, PANEL,
  M, BOOK_COLORS, GLOVE_COLORS, gloveMat, anatomyTexture, vitalsTexture,
  propNode, mergeScope,
} from './common.js'

const hx = ROOM.w / 2
const depth = ROOM.frontZ - ROOM.backZ
const cz = (ROOM.frontZ + ROOM.backZ) / 2

/** 메시 하나. 기본적으로 그림자를 주고받는다. 방 지오메트리는 전부 레이캐스트에서 뺀다. */
function m(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], opts = {}) {
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(...pos)
  mesh.rotation.set(...rot)
  mesh.castShadow = opts.cast !== false
  mesh.receiveShadow = opts.recv !== false
  mesh.raycast = () => null
  return mesh
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
const plane = (w, h) => new THREE.PlaneGeometry(w, h)

/* ══════════════════════════════════════════════════════════════════
   벽 · 바닥 · 천장
   ══════════════════════════════════════════════════════════════════ */
function shell(final) {
  const g = new THREE.Group()
  g.name = 'shell'

  g.add(m(plane(ROOM.w, depth), M.floor, [0, 0, cz], [-Math.PI / 2, 0, 0], { cast: false }))
  g.add(m(plane(ROOM.w, depth), M.ceiling, [0, ROOM.h, cz], [Math.PI / 2, 0, 0], { cast: false }))

  /* ── F2 천장 T바 그리드 ──
     빈 흰 판이 즉시 '병원 천장'이 된다. 조각 156개를 mergeGeometries 로 1 call 에 합친다.
     (조명 트로퍼가 놓인 자리는 비운다 — 실제 시스템 천장은 타일 대신 등기구가 들어간다) */
  if (final) {
    const parts = []
    const teeW = 0.026, teeH = 0.022, S = 0.8
    const inFixture = (x, z) => PANELS.some((p) => Math.abs(x - p.x) < 0.70 && Math.abs(z - p.z) < 0.40)
    for (let x = -hx + S; x < hx - 0.05; x += S) {
      for (let z = ROOM.backZ; z < ROOM.frontZ - 0.01; z += S) {
        const zc = Math.min(z + S / 2, ROOM.frontZ), len = Math.min(S, ROOM.frontZ - z)
        if (inFixture(x, zc)) continue
        const gg = box(teeW, teeH, len); gg.translate(x, ROOM.h - teeH / 2 - 0.001, zc); parts.push(gg)
      }
    }
    for (let z = ROOM.backZ + S; z < ROOM.frontZ - 0.05; z += S) {
      for (let x = -hx; x < hx - 0.01; x += S) {
        const xc = Math.min(x + S / 2, hx), len = Math.min(S, hx - x)
        if (inFixture(xc, z)) continue
        const gg = box(len, teeH, teeW); gg.translate(xc, ROOM.h - teeH / 2 - 0.001, z); parts.push(gg)
      }
    }
    const tee = m(mergeGeometries(parts, false), M.panelFrame, [0, 0, 0], [0, 0, 0], { cast: false })
    tee.userData.noMerge = true
    g.add(tee)
  }

  /* 벽면. final 은 면 크기·바닥높이를 재질에 넘겨 텍셀 밀도를 통일한다. */
  const wallPlane = (pos, rot, w, h, y0) =>
    m(plane(w, h), M.wall(w, h, y0), pos, rot, { cast: false })
  g.add(wallPlane([-hx, ROOM.h / 2, cz], [0, Math.PI / 2, 0], depth, ROOM.h, 0))
  g.add(wallPlane([hx, ROOM.h / 2, cz], [0, -Math.PI / 2, 0], depth, ROOM.h, 0))
  g.add(wallPlane([0, ROOM.h / 2, ROOM.frontZ], [0, Math.PI, 0], ROOM.w, ROOM.h, 0))

  /* 뒷벽 = 문 구멍 좌/우/상 패널 */
  const leftPanelW = DOOR_X - DOOR_W / 2 + hx
  const rightPanelW = hx - (DOOR_X + DOOR_W / 2)
  g.add(wallPlane([-hx + leftPanelW / 2, ROOM.h / 2, ROOM.backZ], [0, 0, 0], leftPanelW, ROOM.h, 0))
  g.add(wallPlane([hx - rightPanelW / 2, ROOM.h / 2, ROOM.backZ], [0, 0, 0], rightPanelW, ROOM.h, 0))
  g.add(wallPlane([DOOR_X, DOOR_H + (ROOM.h - DOOR_H) / 2, ROOM.backZ], [0, 0, 0], DOOR_W, ROOM.h - DOOR_H, DOOR_H))
  g.add(m(plane(DOOR_W, DOOR_H), M.corridor, [DOOR_X, DOOR_H / 2, ROOM.backZ - 0.5], [0, 0, 0], { cast: false }))

  return g
}

/* ── F4 웨인스코트 + 걸레받이 ──
   base: 벽에 붙은 납작한 평면 + 얇은 걸레받이 상자 (그나마 좌/우 벽에만 있다)
   final: 두께 14mm 판 + 세로 살대 + 챠레일 캡 + 3단 걸레받이, **4면 전부**
   색 경계선이 실제 몰딩 그림자선이 된다.
   ⚠ z-fighting: 벽 plane 과 싸우지 않도록 7~24mm 씩 띄운다. */
function wainscot(final) {
  const g = new THREE.Group()
  g.name = 'wainscot'

  /**
   * 벽 한 면.
   *   axis      : 벽의 법선축 ('x' = 좌/우 벽, 'z' = 앞/뒷벽)
   *   sgn       : 벽이 방 바깥으로 향하는 부호 (좌벽 -1, 우벽 +1, 뒷벽 -1, 앞벽 +1)
   *   wallCoord : 그 축에서의 벽면 좌표
   *   spanCenter/spanLen : 벽을 따라가는 축에서의 중심/길이
   */
  const side = (axis, sgn, wallCoord, spanCenter, spanLen) => {
    /** off = 벽면에서 방 안쪽으로 떨어진 거리 (z-fighting 방지용 7~24mm) */
    const mk = (mat, t, h, l, off, y, along = spanCenter, cast = true) => {
      const geo = axis === 'x' ? box(t, h, l) : box(l, h, t)
      const p = axis === 'x' ? [wallCoord - sgn * off, y, along] : [along, y, wallCoord - sgn * off]
      return m(geo, mat, p, [0, 0, 0], { cast, recv: true })
    }

    if (!final) {
      /* base = ClinicScene.tsx RoomShell 그대로:
         · 좌/우 벽 : 평면 웨인스코트 + 얇은 걸레받이 상자
         · 뒷벽     : 평면 웨인스코트만 (걸레받이 **없음**)
         · 앞벽     : 아무것도 없음 */
      if (axis === 'x') {
        g.add(m(plane(spanLen, 1.2), M.wainscot,
          [wallCoord - sgn * 0.01, 0.6, spanCenter], [0, sgn > 0 ? -Math.PI / 2 : Math.PI / 2, 0], { cast: false }))
        g.add(mk(M.skirt, 0.06, 0.1, spanLen, 0.03, 0.05))
      } else if (sgn < 0) {
        g.add(m(plane(spanLen, 1.2), M.wainscot,
          [spanCenter, 0.6, wallCoord + 0.01], [0, 0, 0], { cast: false }))
      }
      return
    }

    // final
    g.add(mk(M.wainscot, 0.014, 1.14, spanLen, 0.007, 0.62, spanCenter, false))
    const step = 0.9
    for (let t = -spanLen / 2 + 0.45; t < spanLen / 2; t += step) {
      const along = spanCenter + t
      g.add(mk(M.wainscot, 0.055, 1.1, 0.022, 0.024, 0.62, along))
    }
    // 챠레일 캡 (상단 몰딩) — 아래로 그림자선을 떨군다
    g.add(mk(M.skirt, 0.038, 0.026, spanLen, 0.019, 1.196))
    g.add(mk(M.skirt, 0.028, 0.012, spanLen, 0.014, 1.168))
    // 걸레받이 2단
    g.add(mk(M.skirt, 0.018, 0.1, spanLen, 0.009, 0.05))
    g.add(mk(M.skirt, 0.026, 0.014, spanLen, 0.013, 0.103))
  }

  // 좌/우 벽
  side('x', -1, -hx, cz, depth)
  side('x', 1, hx, cz, depth)
  /* 【누락 확인】 본 씬 뒷벽에는 웨인스코트 평면만 있고 **걸레받이가 없다**.
     final 은 뒷벽도 좌/우와 같은 3단 처리를 한다.
     앞벽(z=+1.2)은 두 카메라 모두 등 뒤라 한 번도 안 보인다 → 일부러 넣지 않는다. */
  const leftPanelW = DOOR_X - DOOR_W / 2 + hx
  const rightPanelW = hx - (DOOR_X + DOOR_W / 2)
  side('z', -1, ROOM.backZ, -hx + leftPanelW / 2, leftPanelW)
  side('z', -1, ROOM.backZ, hx - rightPanelW / 2, rightPanelW)
  return g
}

/* ══════════════════════════════════════════════════════════════════
   F5 창 (케이싱 · 창턱 · 새시) + 블라인드
   ══════════════════════════════════════════════════════════════════ */
function windowGroup(final) {
  const g = new THREE.Group()
  g.name = 'window'
  g.position.set(hx - 0.06, 1.65, -0.9)
  g.add(m(plane(1.7, 1.1), M.glass, [0, 0, 0], [0, -Math.PI / 2, 0], { cast: false, recv: false }))
  g.add(blinds(final, [0, 0.18, 0.03], [0, -Math.PI / 2, 0], 1.62, 0.74))

  if (!final) {
    g.add(m(box(1.84, 0.06, 0.04), M.whitePaint, [0, 0, 0], [0, -Math.PI / 2, 0]))
    g.add(m(box(1.84, 0.06, 0.04), M.whitePaint, [0, 0.55, 0], [0, -Math.PI / 2, 0]))
    g.add(m(box(1.84, 0.06, 0.04), M.whitePaint, [0, -0.55, 0], [0, -Math.PI / 2, 0]))
    g.add(m(box(0.04, 1.16, 0.06), M.whitePaint, [0, 0, 0]))
    return g
  }

  g.add(m(box(0.05, 0.075, 1.9), M.whitePaint, [-0.012, 0.605, 0]))       // 상부 케이싱
  g.add(m(box(0.05, 0.09, 1.9), M.whitePaint, [-0.012, -0.60, 0]))        // 창턱 몸통
  g.add(m(box(0.085, 0.028, 2.0), M.whitePaint, [-0.03, -0.652, 0]))      // 창턱 코(nosing)
  g.add(m(box(0.05, 1.28, 0.075), M.whitePaint, [-0.012, 0, 0.905]))
  g.add(m(box(0.05, 1.28, 0.075), M.whitePaint, [-0.012, 0, -0.905]))
  // 새시 2장 + 중앙 문설주
  g.add(m(box(0.032, 0.05, 0.86), M.whitePaint, [-0.004, 0.545, -0.44]))
  g.add(m(box(0.032, 0.05, 0.86), M.whitePaint, [-0.004, 0.545, 0.44]))
  g.add(m(box(0.032, 1.14, 0.048), M.whitePaint, [-0.004, 0, 0]))
  g.add(m(box(0.032, 0.05, 0.86), M.whitePaint, [-0.004, -0.545, -0.44]))
  g.add(m(box(0.032, 0.05, 0.86), M.whitePaint, [-0.004, -0.545, 0.44]))
  return g
}

function blinds(final, position, rotation, width, height) {
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  const slats = 16
  const gap = height / slats
  for (let i = 0; i < slats; i++) {
    const h = final ? gap * 0.8 : gap * 0.82
    const t = final ? 0.0025 : 0.012
    g.add(m(box(width, h, t), M.slat, [0, height / 2 - gap * (i + 0.5), 0], [0.5, 0, 0]))
  }
  if (!final) {
    g.add(m(new THREE.CylinderGeometry(0.004, 0.004, height, 6), M.slat, [width / 2 - 0.05, 0, 0.02]))
  } else {
    g.add(m(box(width + 0.02, 0.055, 0.05), M.whitePaint, [0, height / 2 + 0.03, 0.006]))  // 헤드레일
    g.add(m(box(width, 0.016, 0.026), M.slat, [0, -height / 2 - 0.012, 0]))                // 바텀레일
    g.add(m(new THREE.CylinderGeometry(0.005, 0.005, 0.62, 6), M.slat, [width / 2 - 0.04, height / 2 - 0.32, 0.03]))
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   F6 문 · 문틀
   ══════════════════════════════════════════════════════════════════ */
function doorway(final) {
  const g = new THREE.Group()
  g.name = 'doorway'

  if (!final) {
    g.add(m(box(0.08, DOOR_H + 0.1, 0.12), M.whitePaint, [DOOR_X - DOOR_W / 2 - 0.04, DOOR_H / 2, ROOM.backZ + 0.02]))
    g.add(m(box(0.08, DOOR_H + 0.1, 0.12), M.whitePaint, [DOOR_X + DOOR_W / 2 + 0.04, DOOR_H / 2, ROOM.backZ + 0.02]))
    g.add(m(box(DOOR_W + 0.16, 0.08, 0.12), M.whitePaint, [DOOR_X, DOOR_H + 0.05, ROOM.backZ + 0.02]))
    g.add(m(box(DOOR_W, DOOR_H, 0.05), M.door, [DOOR_X, DOOR_H / 2, ROOM.backZ + 0.04]))
    g.add(m(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10), M.chrome, [DOOR_X + DOOR_W / 2 - 0.12, 1.05, ROOM.backZ + 0.09]))
    return g
  }

  // 문설주(jamb) + 문선(stop) + 케이싱(architrave)
  for (const sgn of [-1, 1]) {
    const x = DOOR_X + sgn * (DOOR_W / 2 + 0.03)
    g.add(m(box(0.06, DOOR_H + 0.06, 0.13), M.whitePaint, [x, DOOR_H / 2, ROOM.backZ + 0.025]))
    g.add(m(box(0.016, DOOR_H + 0.02, 0.014), M.whitePaint, [x - sgn * 0.022, DOOR_H / 2, ROOM.backZ + 0.076]))
    g.add(m(box(0.075, DOOR_H + 0.15, 0.014), M.whitePaint, [x + sgn * 0.062, DOOR_H / 2 + 0.03, ROOM.backZ + 0.096]))
  }
  g.add(m(box(DOOR_W + 0.12, 0.06, 0.13), M.whitePaint, [DOOR_X, DOOR_H + 0.03, ROOM.backZ + 0.025]))
  g.add(m(box(DOOR_W + 0.04, 0.016, 0.014), M.whitePaint, [DOOR_X, DOOR_H + 0.008, ROOM.backZ + 0.076]))
  g.add(m(box(DOOR_W + 0.27, 0.075, 0.014), M.whitePaint, [DOOR_X, DOOR_H + 0.098, ROOM.backZ + 0.096]))
  g.add(m(box(DOOR_W + 0.06, 0.008, 0.14), M.chrome, [DOOR_X, 0.004, ROOM.backZ + 0.025]))   // 문지방

  /* 문짝 — 본 씬은 doorOpenT 로 힌지 회전하므로 별도 그룹으로 둔다.
     원점은 힌지(문 왼쪽 모서리). */
  const leaf = new THREE.Group()
  leaf.name = 'doorLeaf'
  leaf.position.set(DOOR_X - DOOR_W / 2, 0, ROOM.backZ)
  const t = 0.042, z0 = 0.045
  const stile = 0.115, botRail = 0.2, topRail = 0.115, lockRail = 0.13
  leaf.add(m(box(stile, DOOR_H, t), M.door, [stile / 2, DOOR_H / 2, z0]))
  leaf.add(m(box(stile, DOOR_H, t), M.door, [DOOR_W - stile / 2, DOOR_H / 2, z0]))
  const inner = DOOR_W - stile * 2
  leaf.add(m(box(inner, topRail, t), M.door, [DOOR_W / 2, DOOR_H - topRail / 2, z0]))
  leaf.add(m(box(inner, botRail, t), M.door, [DOOR_W / 2, botRail / 2, z0]))
  leaf.add(m(box(inner, lockRail, t), M.door, [DOOR_W / 2, 1.02, z0]))
  // 함몰 패널 2장 — 프레임보다 9mm 뒤로, 사방 3mm 리빌
  const p1h = 1.02 - lockRail / 2 - botRail - 0.006
  const p2h = DOOR_H - topRail - (1.02 + lockRail / 2) - 0.006
  leaf.add(m(box(inner - 0.006, p1h, t - 0.018), M.door, [DOOR_W / 2, botRail + 0.003 + p1h / 2, z0 - 0.002]))
  leaf.add(m(box(inner - 0.006, p2h, t - 0.018), M.door, [DOOR_W / 2, 1.02 + lockRail / 2 + 0.003 + p2h / 2, z0 - 0.002]))
  // 레버 손잡이 + 로즈 + 실린더 + 경첩
  leaf.add(m(new THREE.CylinderGeometry(0.031, 0.031, 0.008, 20), M.chrome, [DOOR_W - 0.075, 1.05, z0 + t / 2 + 0.004], [Math.PI / 2, 0, 0]))
  leaf.add(m(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 12), M.chrome, [DOOR_W - 0.075, 1.05, z0 + t / 2 + 0.02], [Math.PI / 2, 0, 0]))
  leaf.add(m(box(0.105, 0.02, 0.02), M.chrome, [DOOR_W - 0.128, 1.05, z0 + t / 2 + 0.035]))
  leaf.add(m(new THREE.CylinderGeometry(0.019, 0.019, 0.007, 16), M.chrome, [DOOR_W - 0.075, 0.93, z0 + t / 2 + 0.003], [Math.PI / 2, 0, 0]))
  for (const y of [0.28, 1.08, DOOR_H - 0.28]) {
    leaf.add(m(box(0.018, 0.09, 0.014), M.chrome, [0.004, y, z0 - t / 2 - 0.002]))
  }
  g.add(leaf)
  return g
}

/* ══════════════════════════════════════════════════════════════════
   천장 형광등 패널 (형태는 두 모드 동일 — 재질만 다르다)
   ══════════════════════════════════════════════════════════════════ */
function ceilingPanel(final, x, z) {
  const g = new THREE.Group()
  g.position.set(x, ROOM.h - 0.02, z)
  if (!final) {
    g.add(m(box(1.3, 0.06, 0.7), M.panelFrame, [0, 0, 0], [0, 0, 0], { cast: false }))
    g.add(m(box(1.18, 0.02, 0.58), M.panelGlow, [0, -0.035, 0], [0, 0, 0], { cast: false }))
  } else {
    // 하우징(4변 프레임) + 8mm 함몰 디퓨저 — T바 그리드와 높이를 맞춘다
    const fw = PANEL.fw, fd = PANEL.fd, ft = 0.075
    g.add(m(box(fw, ft, 0.045), M.panelFrame, [0, -0.008, -fd / 2 + 0.022], [0, 0, 0], { cast: false }))
    g.add(m(box(fw, ft, 0.045), M.panelFrame, [0, -0.008, fd / 2 - 0.022], [0, 0, 0], { cast: false }))
    g.add(m(box(0.045, ft, fd - 0.09), M.panelFrame, [-fw / 2 + 0.022, -0.008, 0], [0, 0, 0], { cast: false }))
    g.add(m(box(0.045, ft, fd - 0.09), M.panelFrame, [fw / 2 - 0.022, -0.008, 0], [0, 0, 0], { cast: false }))
    g.add(m(box(fw - 0.098, 0.016, fd - 0.098), M.panelGlow, [0, -0.026, 0], [0, 0, 0], { cast: false }))
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   책상 · 의자 (형태는 base 그대로 — 게임 카메라가 안 본다)
   ══════════════════════════════════════════════════════════════════ */
function deskItems() {
  const g = new THREE.Group()
  g.name = 'deskItems'

  const mon = new THREE.Group()
  mon.position.set(-0.35, 0.83, -0.28); mon.rotation.y = 0.45
  mon.add(m(box(0.66, 0.42, 0.04), M.monitorBody, [0, 0.42, 0]))
  mon.add(m(plane(0.6, 0.36), M.monitorScreen, [0, 0.42, 0.022], [0, 0, 0], { cast: false }))
  mon.add(m(new THREE.CylinderGeometry(0.022, 0.03, 0.18, 10), M.monitorStand, [0, 0.115, 0]))
  mon.add(m(box(0.30, 0.025, 0.18), M.monitorStand, [0, 0.02, 0.02]))
  g.add(mon)

  const kb = new THREE.Group()
  kb.position.set(-0.3, 0.83, 0.02); kb.rotation.y = 0.45
  kb.add(m(box(0.44, 0.016, 0.15), M.keyBase, [0, 0, 0]))
  for (const z of [-0.045, -0.022, 0.001, 0.024]) {
    kb.add(m(box(0.4, 0.008, 0.017), M.keyCap, [0, 0.014, z - 0.012]))
  }
  kb.add(m(box(0.2, 0.008, 0.016), M.keyCap, [0, 0.014, 0.05]))
  g.add(kb)

  for (const [pos, variant] of [[[0.34, 0.84, -0.33], 0], [[0.52, 0.84, -0.33], 1]]) {
    g.add(toolCup(pos, variant))
  }
  return g
}

function toolCup(position, variant) {
  const g = new THREE.Group()
  g.position.set(...position)
  const r0 = variant === 0 ? 0.045 : 0.05
  const r1 = variant === 0 ? 0.04 : 0.045
  const hgt = variant === 0 ? 0.13 : 0.11
  const mat = variant === 0 ? M.cupMetal : M.cupMetal2
  g.add(m(new THREE.CylinderGeometry(r0, r1, hgt, 24), mat, [0, hgt / 2, 0]))
  g.add(m(new THREE.TorusGeometry(r0 - 0.001, 0.0045, 8, 24), variant === 0 ? M.clipMetal : M.cupMetal, [0, hgt, 0], [Math.PI / 2, 0, 0]))
  g.add(m(new THREE.CylinderGeometry(r0 - 0.006, r0 - 0.006, 0.035, 20), M.cupInner, [0, hgt - 0.015, 0], [0, 0, 0], { cast: false }))
  if (variant === 0) {
    g.add(m(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 10), M.darkPlastic, [-0.018, 0.16, 0.012], [0.08, 0, 0.05]))
    g.add(m(new THREE.CylinderGeometry(0.013, 0.013, 0.18, 10), M.monitorStand, [0.008, 0.13, -0.016], [-0.05, 0, -0.02]))
    g.add(m(new THREE.CylinderGeometry(0.005, 0.005, 0.26, 10), M.clipMetal, [0.022, 0.17, 0.014], [0.05, 0, 0.13]))
  } else {
    for (const x of [-0.02, 0.0, 0.022]) {
      g.add(m(box(0.016, 0.17, 0.004), M.wood, [x, 0.16, -0.012], [0.05, 0, x * 1.5]))
    }
    for (const x of [-0.02, 0.0, 0.02]) {
      g.add(m(new THREE.CylinderGeometry(0.0022, 0.0022, 0.18, 6), M.paperRoll, [x, 0.14, 0.02], [-0.04, 0, x * 1.6]))
    }
  }
  return g
}

function clipboard() {
  const g = new THREE.Group()
  g.name = 'clipboard'
  g.position.set(-2.05 + 0.66, 0.84, 0.5 + 0.1)
  g.rotation.set(-0.1, -0.3, 0)
  g.scale.setScalar(0.72)
  g.add(m(box(0.24, 0.014, 0.32), M.clipTeal, [0, 0, 0]))
  g.add(m(box(0.2, 0.006, 0.26), M.formSheet, [0, 0.012, 0.015]))
  for (const z of [0.07, 0.04, 0.01, -0.02, -0.05]) {
    g.add(m(box(0.15, 0.001, 0.006), M.clipMetal, [0, 0.0175, z], [0, 0, 0], { cast: false }))
  }
  g.add(m(box(0.1, 0.014, 0.03), M.clipMetal, [0, 0.019, -0.14]))
  g.add(m(box(0.06, 0.012, 0.012), M.clipMetal, [0, 0.027, -0.137]))
  return g
}

function stool(position) {
  const g = new THREE.Group()
  g.name = 'stool'
  g.position.set(...position)
  g.add(m(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 20), M.stoolSeat, [0, 0.5, 0]))
  g.add(m(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 10), M.chrome, [0, 0.32, 0]))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    g.add(m(box(0.22, 0.04, 0.04), M.stoolLeg, [Math.cos(a) * 0.18, 0.06, Math.sin(a) * 0.18], [0, -a, 0]))
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   F3 진찰대
   로컬 좌표: rotY=-90° 라 **로컬 +z = 머리(월드 -x)**, 서랍은 로컬 +x 면.
   ⚠ 매트 상면 y 를 base 와 mm 단위로 맞춘다:
       base  매트 중심 y=0.62, 두께 0.12 → 상면 y = 0.680, 종이 상면 y = 0.691
       final 매트 중심 y=0.62, 두께 0.115 → 상면 y = 0.6775, 종이 상면 y = 0.6825
     본 씬은 환자를 EXAM.patientPos y=0.78 고정으로 놓으므로 상면이 밀리면 뜨거나 잠긴다.
   ⚠ form 랩은 헤드 섹션을 2° 들어 올렸다 — 환자 등에 파고들어서 **여기서는 뺐다**(평평).
   ══════════════════════════════════════════════════════════════════ */
function examBed(final) {
  const g = new THREE.Group()
  g.name = 'examBed'
  g.position.set(...EXAM.bedPos)
  g.rotation.y = EXAM.bedRotY

  if (!final) {
    g.add(m(box(0.72, 0.12, 1.9), M.matVinyl, [0, 0.62, 0]))
    g.add(m(box(0.66, 0.012, 1.5), M.paper, [0, 0.685, 0.1]))
    g.add(m(box(0.66, 0.56, 1.7), M.bedWood, [0, 0.28, 0]))
    g.add(m(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 16), M.paperRoll, [0, 0.7, 0.97], [0, 0, Math.PI / 2]))
    return g
  }

  // 1) 매트 3분할 (전부 평평 — 기울임 없음). 사이 4mm 틈이 봉제선처럼 읽힌다.
  for (const s of [{ len: 0.60, cz: -0.65 }, { len: 0.64, cz: -0.026 }, { len: 0.652, cz: 0.624 }]) {
    g.add(m(box(0.72, 0.115, s.len), M.matVinyl, [0, 0.6225, s.cz]))
    g.add(m(box(0.726, 0.008, s.len - 0.03), M.bedWood, [0, 0.6105, s.cz], [0, 0, 0], { cast: false }))
  }
  // 2) 종이 커버 — 매트 상면(0.680)에서 2.5mm 띄운다 (z-fighting 방지)
  g.add(m(box(0.66, 0.004, 1.5), M.paper, [0, 0.6825, 0.11], [0, 0, 0], { cast: false }))
  g.add(m(box(0.658, 0.0035, 0.1), M.paper, [0, 0.669, -0.685], [-0.5, 0, 0], { cast: false }))
  g.add(m(box(0.656, 0.0035, 0.075), M.paper, [0, 0.636, -0.735], [-1.05, 0, 0], { cast: false }))
  // 3) 스틸 프레임 밴드 — 2mm 안쪽으로 들어가 그림자선이 생긴다
  g.add(m(box(0.686, 0.042, 1.72), M.darkPlastic, [0, 0.541, 0]))
  g.add(m(box(0.7, 0.012, 1.74), M.chrome, [0, 0.516, 0]))
  // 4) 베이스 캐비닛 = 토킥 + 몸통 + 서랍면 3장 + 손잡이
  g.add(m(box(0.6, 0.085, 1.6), M.darkPlastic, [0, 0.0425, 0]))
  g.add(m(box(0.66, 0.4, 1.7), M.bedWood, [0, 0.29, 0]))
  for (let i = 0; i < 3; i++) {
    const z = -0.56 + i * 0.56
    g.add(m(box(0.018, 0.345, 0.535), M.bedWood, [0.333, 0.29, z]))
    g.add(m(box(0.014, 0.018, 0.16), M.chrome, [0.348, 0.39, z]))
    g.add(m(box(0.012, 0.028, 0.016), M.chrome, [0.343, 0.39, z - 0.075]))
    g.add(m(box(0.012, 0.028, 0.016), M.chrome, [0.343, 0.39, z + 0.075]))
  }
  g.add(m(box(0.012, 0.34, 1.6), M.bedWood, [-0.333, 0.29, 0]))
  // 5) 페이퍼 롤 디스펜서 = 브라켓 2 + 축 + 롤
  g.add(m(new THREE.CylinderGeometry(0.058, 0.058, 0.56, 20), M.paperRoll, [0, 0.7, 0.965], [0, 0, Math.PI / 2]))
  g.add(m(new THREE.CylinderGeometry(0.014, 0.014, 0.63, 10), M.chrome, [0, 0.7, 0.965], [0, 0, Math.PI / 2]))
  for (const x of [-0.31, 0.31]) g.add(m(box(0.016, 0.13, 0.05), M.chrome, [x, 0.655, 0.965]))
  return g
}

/* ══════════════════════════════════════════════════════════════════
   F1 프라이버시 커튼 — 단일 기법 최대 효과
   base : 허공에 뜬 널빤지 7장
   final: 레일 + 브라켓 + 링 + 사인파 주름 천 1장
   ⚠ 불투명화: base 는 판자 사이로 침대가 보였다. 본 씬에 커튼 너머를 보여주는 연출이
     있으면 깨진다. 여기서는 커튼을 반투명(0.94)으로 두지 않고 불투명 유지 —
     대신 본 씬 이식 시 §이식가이드의 확인 항목으로 남긴다.
   ══════════════════════════════════════════════════════════════════ */
function privacyCurtain(final, position, rotation, length) {
  const g = new THREE.Group()
  g.name = 'curtain'
  g.position.set(...position); g.rotation.set(...rotation)
  const railH = 2.0

  if (!final) {
    g.add(m(new THREE.CylinderGeometry(0.018, 0.018, length, 10), M.rail, [0, railH, 0], [0, 0, Math.PI / 2]))
    const panels = 7
    for (let i = 0; i < panels; i++) {
      const x = -length / 2 + (length / panels) * (i + 0.5)
      g.add(m(box(length / panels - 0.01, railH - 0.1, 0.03),
        i % 2 === 0 ? M.curtainA : M.curtainB, [x, railH / 2 - 0.05, i % 2 === 0 ? 0.05 : -0.05]))
    }
    return g
  }

  g.add(m(new THREE.CylinderGeometry(0.016, 0.016, length + 0.06, 12), M.rail, [0, railH, 0], [0, 0, Math.PI / 2]))
  for (let i = 0; i < 3; i++) {
    g.add(m(box(0.03, 0.05, 0.03), M.rail, [-length / 2 + (length / 2) * i, railH + 0.035, 0]))
  }
  const H = railH - 0.14
  const drape = new THREE.PlaneGeometry(length, H, 72, 8)
  const pos = drape.attributes.position
  const folds = Math.max(4, Math.round(length / 0.24))
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i)
    const t = (x + length / 2) / length
    const sag = 0.55 + 0.45 * ((H / 2 - y) / H)          // 아래로 갈수록 주름이 깊어진다
    pos.setZ(i, Math.sin(t * folds * Math.PI * 2) * 0.052 * sag
      + Math.sin(t * folds * Math.PI * 4.3 + 1.1) * 0.012 * sag)
    pos.setY(i, y + (y < -H / 2 + 0.05 ? Math.sin(t * folds * Math.PI * 2) * 0.008 : 0))
  }
  drape.computeVertexNormals()
  const cloth = m(drape, M.curtainA, [0, railH - 0.07 - H / 2 + 0.02, 0])
  cloth.userData.noMerge = true    // DoubleSide 천은 병합 대상에서 뺀다
  g.add(cloth)
  g.add(m(box(length, 0.03, 0.012), M.curtainB, [0, railH - 0.055, 0], [0, 0, 0], { cast: false }))
  const rings = Math.round(length / 0.16)
  for (let i = 0; i < rings; i++) {
    g.add(m(new THREE.TorusGeometry(0.019, 0.0035, 6, 12), M.rail,
      [-length / 2 + (length / rings) * (i + 0.5), railH - 0.008, 0], [0, Math.PI / 2, 0]))
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   의료 기구 (형태는 base 그대로)
   ══════════════════════════════════════════════════════════════════ */
function ivPole(position) {
  const g = new THREE.Group()
  g.name = 'ivPole'
  g.position.set(...position)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    g.add(m(box(0.22, 0.035, 0.04), M.steel, [Math.cos(a) * 0.22, 0.03, Math.sin(a) * 0.22], [0, -a, 0]))
    g.add(m(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 10), M.darkPlastic,
      [Math.cos(a) * 0.33, 0.015, Math.sin(a) * 0.33]))
  }
  g.add(m(new THREE.CylinderGeometry(0.018, 0.018, 1.9, 12), M.chrome, [0, 0.95, 0]))
  g.add(m(new THREE.TorusGeometry(0.05, 0.008, 8, 16, Math.PI), M.chrome, [0, 1.9, 0], [0, 0, Math.PI / 2]))
  g.add(m(box(0.13, 0.24, 0.04), M.ivBag, [0.08, 1.62, 0]))
  g.add(m(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), M.ivDrip, [0.08, 1.44, 0], [0, 0, 0], { cast: false }))
  return g
}

function vitalsCart(position, rotation) {
  const g = new THREE.Group()
  g.name = 'vitalsCart'
  g.position.set(...position); g.rotation.set(...rotation)
  const scr = vitalsTexture()
  const screenMat = new THREE.MeshStandardMaterial({
    map: scr, emissiveMap: scr, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.3,
  })
  for (const [x, z] of [[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]]) {
    g.add(m(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 18), M.blackRubber, [x, 0.09, z], [0, 0, Math.PI / 2]))
    g.add(m(new THREE.CylinderGeometry(0.04, 0.04, 0.07, 12), M.steel, [x, 0.09, z]))
  }
  g.add(m(box(0.5, 0.06, 0.62), M.darkPlastic, [0, 0.18, 0]))
  g.add(m(box(0.46, 0.64, 0.46), M.cartWhite, [0, 0.52, -0.02]))
  g.add(m(box(0.47, 0.12, 0.47), M.darkPlastic, [0, 0.24, -0.02]))
  for (const x of [-0.15, -0.05, 0.05, 0.15]) {
    g.add(m(box(0.07, 0.14, 0.04), M.stainless, [x, 0.6, 0.215]))
    g.add(m(new THREE.CapsuleGeometry(0.022, 0.08, 4, 8), M.probe, [x, 0.62, 0.245]))
  }
  g.add(m(box(0.44, 0.34, 0.1), M.darkPlastic, [0, 1.06, -0.02]))
  const sp = m(plane(0.4, 0.3), screenMat, [0, 1.06, 0.032], [0, 0, 0], { cast: false })
  sp.userData.noMerge = true
  g.add(sp)
  g.add(m(new THREE.CylinderGeometry(0.028, 0.028, 0.36, 10), M.steel, [0, 0.9, -0.02]))
  return g
}

function wallMedStation(position) {
  const g = new THREE.Group()
  g.name = 'medStation'
  g.position.set(...position)
  g.add(m(box(0.78, 0.5, 0.03), M.stainless, [0, 0, 0]))
  GLOVE_COLORS.forEach((col, i) => {
    g.add(m(box(0.2, 0.26, 0.09), gloveMat(col), [-0.26 + i * 0.26, 0.06, 0.06]))
    g.add(m(box(0.1, 0.05, 0.02), M.gloveWhite, [-0.26 + i * 0.26, 0.11, 0.11]))
  })
  g.add(m(box(0.16, 0.2, 0.12), M.sharps, [-0.28, -0.12, 0.07]))
  g.add(m(box(0.16, 0.03, 0.12), M.sharpsLid, [-0.28, -0.01, 0.07]))
  return g
}

/* ══════════════════════════════════════════════════════════════════
   벽 아이템
   ══════════════════════════════════════════════════════════════════ */
function poster(position, rotation, size, kind, frameMat) {
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  const tex = anatomyTexture(kind)
  g.add(m(box(size[0] + 0.04, size[1] + 0.04, 0.02), frameMat, [0, 0, 0]))
  const face = m(plane(size[0], size[1]), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
    [0, 0, 0.012], [0, 0, 0], { cast: false })
  face.userData.noMerge = true
  g.add(face)
  return g
}

function certificate(position, rotation, size) {
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  g.add(m(box(size[0] + 0.04, size[1] + 0.04, 0.025), M.frameGold, [0, 0, 0]))
  g.add(m(plane(size[0] - 0.02, size[1] - 0.02), M.formSheet, [0, 0, 0.014], [0, 0, 0], { cast: false }))
  return g
}

function xrayViewbox(position, rotation, size) {
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  g.add(m(box(size[0] + 0.06, size[1] + 0.06, 0.05), M.stainless, [0, 0, 0]))
  const lit = m(plane(size[0], size[1]),
    new THREE.MeshStandardMaterial({ color: '#dfe9f2', emissive: '#cfe0f0', emissiveIntensity: 0.75 }),
    [0, 0, 0.027], [0, 0, 0], { cast: false })
  lit.userData.noMerge = true
  g.add(lit)
  return g
}

/** 책 — 색을 8개 캐시 재질로 공유해서 병합 패스가 36 call → 8 call 로 줄인다. */
function bookRow(position, rotation, count, width) {
  const g = new THREE.Group()
  g.position.set(...position); g.rotation.set(...rotation)
  const bw = width / count
  for (let i = 0; i < count; i++) {
    const h = 0.2 + ((i * 37) % 9) * 0.012
    g.add(m(box(bw * 0.86, h, 0.16), M.book[i % BOOK_COLORS.length], [-width / 2 + bw * (i + 0.5), h / 2, 0]))
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════
   전체 조립
   ══════════════════════════════════════════════════════════════════ */
export function buildRoom(mode) {
  const final = mode === 'final'
  const root = new THREE.Group()
  root.name = `room-${mode}`

  /* 병합 scope 단위로 나눈다. 방 전체를 하나로 합치면 프러스텀 컬링이 죽는다. */
  const scopes = []
  const scope = (node) => { root.add(node); scopes.push(node); return node }

  scope(shell(final))
  scope(wainscot(final))
  scope(windowGroup(final))
  scope(doorway(final))

  const panels = new THREE.Group(); panels.name = 'ceilingPanels'
  for (const p of PANELS) {
    panels.add(ceilingPanel(final, p.x, p.z))
    const light = new THREE.PointLight(0xffe9cc, 5, 5.5, 2)
    light.position.set(p.x, ROOM.h - 0.02 - 0.4, p.z)
    light.userData.noMerge = true
    panels.add(light)
  }
  scope(panels)

  const desk = new THREE.Group()
  desk.name = 'desk'
  desk.position.set(-2.05, 0, 0.5)
  desk.add(deskItems())
  root.add(desk)
  scopes.push(desk)
  scope(clipboard())
  scope(stool(SEAT.pos))

  scope(examBed(final))
  scope(privacyCurtain(final, [2.4, 0, -2.3], [0, 0, 0], 2.0))
  scope(privacyCurtain(final, [0.9, 0, -3.15], [0, Math.PI / 2, 0], 1.7))

  const books = new THREE.Group(); books.name = 'books'
  for (const [y, z, n, w] of [[1.42, -3.3, 7, 0.9], [1.02, -3.3, 8, 0.92], [0.62, -3.3, 6, 0.88], [1.42, -3.95, 7, 0.86], [1.02, -3.95, 8, 0.9]]) {
    books.add(bookRow([-2.78, y, z], [0, Math.PI / 2, 0], n, w))
  }
  scope(books)

  const wallItems = new THREE.Group(); wallItems.name = 'wallItems'
  wallItems.add(poster([0.62, 1.55, ROOM.backZ + 0.05], [0, 0, 0], [0.6, 0.9], 'organs', M.frameGold))
  wallItems.add(poster([-3.14, 1.55, -2.2], [0, Math.PI / 2, 0], [0.42, 0.66], 'skeleton', M.frameBlue))
  wallItems.add(certificate([0.05, 2.22, ROOM.backZ + 0.05], [0, 0, 0], [0.3, 0.4]))
  wallItems.add(xrayViewbox([-3.13, 1.6, -1.4], [0, Math.PI / 2, 0], [0.6, 0.76]))
  wallItems.add(wallMedStation([1.6, 1.6, ROOM.backZ + 0.05]))
  scope(wallItems)

  scope(ivPole([2.62, 0, -2.7]))
  scope(vitalsCart([2.05, 0, -1.5], [0, -0.63, 0]))

  return { root, deskGroup: desk, scopes }
}

/** GLB 프롭 부착 (두 모드 공통). final 은 tuneGLTF 로 파라미터만 손본다. */
export async function addProps(built, mode) {
  // ?tune=0 — GLTF 파라미터 튜닝만 끈다 (스페큘러 아티팩트 원인 격리용)
  const final = mode === 'final' && new URLSearchParams(location.search).get('tune') !== '0'
  const { root, deskGroup } = built
  await Promise.all([
    propNode('metal_office_desk', [0, 0, -0.08], [0, 0, 0], [0.92, 1.06, 0.88], final).then((n) => n && deskGroup.add(n)),
    propNode('wooden_bookshelf_worn', [-2.9, 0, -3.3], [0, Math.PI / 2, 0], 1.5, final).then((n) => n && root.add(n)),
    propNode('potted_plant_01', [-2.85, 0, ROOM.backZ + 0.5], [0, 0, 0], 1.2, final).then((n) => n && root.add(n)),
    propNode('wall_clock', [2.45, 2.45, ROOM.backZ + 0.08], [0, 0, 0], 1.0, final).then((n) => n && root.add(n)),
    propNode('metal_trash_can', [-2.85, 0, -0.55], [0, 0, 0], 1.0, final).then((n) => n && root.add(n)),
  ])
}

/** 병합 패스 — scope 단위. 반환값은 줄어든 draw call 수. */
export function optimize(built) {
  let saved = 0
  for (const s of built.scopes) saved += mergeScope(s)
  return saved
}
