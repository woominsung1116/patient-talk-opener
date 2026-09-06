/* ══════════════════════════════════════════════════════════════════════
   clinic-lab / light 변형 — 조명 리그 2종

   baseline : 본 씬(ClinicScene.tsx)의 조명을 그대로 옮긴 것. 비교 기준.
   light    : 이 실험이 바꾸는 것. 형태·재질은 건드리지 않고 **빛만** 갈아끼운다.
              (a) 천장 형광등 → RectAreaLight(면광원) + 그림자 전용 약한 directional
              (b) 바닥 반사   → roughness/envMap + 천장등 반사 스트라이프(가산 합성)
              (c) 창 빛 띠    → 창 밖 spot + 창 개구부 마스크(그림자 캐스터) → 바닥에 창 모양 빛
              (d) 창밖        → 날아간 흰 면 + 약한 푸른 채움광(RectAreaLight)
              (e) 색온도      → 패널마다 ±100K (깜빡임 없음)
   ══════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { ROOM, PANELS, PANEL, WINDOW } from './room.js'

RectAreaLightUniformsLib.init()

/* 흑체 색온도 → RGB. ref(기준 색온도)에서 흰색이 되도록 정규화한다.
   (원시 흑체값을 그대로 쓰면 4300K가 주황으로 보인다 — 눈은 화이트밸런스를 하니까) */
function blackbody(K) {
  const t = K / 100
  let r, g, b
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12 }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755) }
  if (t >= 66) b = 255
  else if (t <= 19) b = 0
  else b = 138.52 * Math.log(t - 10) - 305.04
  return [r, g, b].map((v) => Math.min(255, Math.max(0, v)) / 255)
}
export function kelvin(K, ref = 4300, tint = [1, 1, 1]) {
  const a = blackbody(K), b = blackbody(ref)
  return new THREE.Color(
    Math.min(1.6, a[0] / b[0]) * tint[0],
    Math.min(1.6, a[1] / b[1]) * tint[1],
    Math.min(1.6, a[2] / b[2]) * tint[2],
  )
}

/* ── 공통: rig가 만든 오브젝트를 한 그룹에 담아 통째로 껐다 켠다 ── */
function rigGroup(scene, name) {
  const g = new THREE.Group(); g.name = name; scene.add(g); return g
}

/* ══════════════════ BASELINE — 본 씬 그대로 ══════════════════ */
export function buildBaseline(scene, ctx) {
  const g = rigGroup(scene, 'rig-baseline')
  const add = (l) => { g.add(l); if (l.target) g.add(l.target); return l }

  add(new THREE.AmbientLight(0xf7f8fb, 0.12))
  add(new THREE.HemisphereLight(0xeef4ff, 0x6a5544, 0.34))

  const d1 = new THREE.DirectionalLight(0xfff2e4, 0.88)
  d1.position.set(4.5, 2.6, -0.9); add(d1)

  const d2 = new THREE.DirectionalLight(0xf5f7ff, 0.5)
  d2.position.set(1.2, 5, 1.0)
  d2.castShadow = true
  d2.shadow.mapSize.set(2048, 2048)
  Object.assign(d2.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 })
  d2.shadow.bias = -0.0004; d2.shadow.normalBias = 0.018
  add(d2)

  // 환자 얼굴 키 스팟 (환자가 없어도 공간 밝기에 기여하므로 그대로 둔다)
  const spot = new THREE.SpotLight(0xfff0e4, 1.9, 5.5, 0.58, 1, 2)
  spot.position.set(-1.0, 2.4, 0.7)
  spot.target.position.set(-0.92, 1.08, 0.0)
  spot.castShadow = true
  spot.shadow.mapSize.set(1024, 1024)
  spot.shadow.bias = -0.0002; spot.shadow.normalBias = 0.012
  add(spot)

  const fill = new THREE.PointLight(0xf5f7ff, 0.26, 2.8, 2)
  fill.position.set(-0.25, 1.45, 0.65); add(fill)
  const rim = new THREE.PointLight(0xd8e7ff, 0.42, 2.6, 2)
  rim.position.set(-1.45, 1.85, -0.9); add(rim)

  // 책상 스탠드
  const deskL = new THREE.PointLight(0xffc97d, 1.1, 2.2, 2)
  deskL.position.set(-2.9, 1.15, 0.3); add(deskL)

  // 천장 패널 = pointLight (본 씬)
  for (const p of PANELS) {
    const pl = new THREE.PointLight(0xffe9cc, 5, 5.5, 2)
    pl.position.set(p.x, ROOM.h - 0.02 - 0.4, p.z)
    add(pl)
  }

  // 진찰 모드용 스팟 위치 전환 (본 씬 examMode 분기)
  const applyCam = (which) => {
    if (which === 'exam') {
      spot.position.set(2.2, 2.8, -2.6); spot.target.position.set(1.75, 1.0, -3.5); spot.intensity = 0.62
      fill.position.set(1.8, 1.8, -2.6); fill.intensity = 0.08
      rim.visible = false
    } else {
      spot.position.set(-1.0, 2.4, 0.7); spot.target.position.set(-0.92, 1.08, 0.0); spot.intensity = 1.9
      fill.position.set(-0.25, 1.45, 0.65); fill.intensity = 0.26
      rim.visible = true
    }
  }

  // 재질 상태 (baseline = 본 씬 값)
  const applyMaterials = () => {
    ctx.floorMat.roughness = 0.6
    ctx.floorMat.envMapIntensity = 1.0
    ctx.floorMat.needsUpdate = true
    ctx.panelMats.forEach((m) => { m.emissive.set('#fff1dc'); m.emissiveIntensity = 2.0; m.color.set('#fff6e8'); m.needsUpdate = true })
    ctx.glassMat.color.set('#fff2dc'); ctx.glassMat.emissive.set('#ffe6bc'); ctx.glassMat.emissiveIntensity = 1.1
    ctx.glassMat.needsUpdate = true
    ctx.blindMeshes.forEach((m) => { m.castShadow = true })
  }

  return {
    name: 'baseline', group: g, applyCam, applyMaterials,
    shadowType: THREE.PCFShadowMap,
    envIntensity: 0.64,
    exposure: 1.0,
    lightCount: g.children.filter((c) => c.isLight).length,
  }
}

/* ══════════════════ LIGHT — 빛만 갈아끼운 리그 ══════════════════ */
export function buildLight(scene, ctx) {
  const g = rigGroup(scene, 'rig-light')
  const add = (l) => { g.add(l); if (l.target) g.add(l.target); return l }

  /* 형광등의 차가운 기색 (백색 기준에서 아주 살짝 푸른 쪽) */
  /* 형광등 백색. 완전히 차갑게 하면 진료실이 서늘해진다(브리프: 안심되고 평범해야 한다).
     4300K 기준 화이트밸런스에서 거의 중성 — 아주 살짝만 차갑다. */
  const FLUO = [0.995, 0.998, 1.0]

  /* ── (a) 천장 형광등 = 면광원 4개 ──
     패널마다 ±100K. 깜빡임 없음. RectAreaLight는 그림자를 못 만든다. */
  const KELVIN = [4400, 4200, 4300, 4250] // 4000~4500K 형광등 대역 안에서 ±100K 편차
  const rects = []
  PANELS.forEach((p, i) => {
    const col = kelvin(KELVIN[i], 4300, FLUO)
    const r = new THREE.RectAreaLight(col, 6.0, PANEL.fw, PANEL.fd)
    r.position.set(p.x, PANEL.y, p.z)
    r.lookAt(p.x, 0, p.z)
    add(r); rects.push(r)
  })

  /* ── 면광원은 그림자를 못 만든다 → 그림자 전용 약한 directional 하나 ──
     4개 패널의 "평균 방향"에서 거의 수직으로 내려온다. 부드럽게(PCFSoft + normalBias). */
  const shadowDir = new THREE.DirectionalLight(kelvin(4300, 4300, FLUO), 0.42)
  /* 그림자 카메라 범위는 성능에 직결된다. 본 씬의 d2도 x<-2.8을 잘라 좌측 코너의 책장·화분(합쳐서
     ~35만 삼각형)을 그림자 패스에서 빼고 있다. 같은 절단선을 유지한다 — 이걸 넓히면 삼각형이 3배가 된다. */
  shadowDir.position.set(0.9, 6.2, -2.1)
  shadowDir.target.position.set(0.35, 0, -2.5)
  shadowDir.castShadow = true
  shadowDir.shadow.mapSize.set(2048, 2048)
  Object.assign(shadowDir.shadow.camera, { left: -3.55, right: 3.55, top: 3.55, bottom: -3.55, near: 1, far: 12 })
  shadowDir.shadow.bias = -0.0005; shadowDir.shadow.normalBias = 0.022
  shadowDir.shadow.radius = 2.5
  add(shadowDir)

  /* ── 아주 옅은 채움 — 면광원만으로는 천장/구석이 죽는다 ── */
  add(new THREE.AmbientLight(0xf4f6fa, 0.11))
  /* 바닥(따뜻한 나무)에서 올라오는 바운스를 흉내 — 이게 없으면 방이 서늘해진다 */
  add(new THREE.HemisphereLight(0xeaf1ff, 0x8f7a5e, 0.30))

  /* ── (d) 창 — 밝은 바깥 + 약한 푸른 채움 (면광원) ── */
  const skyRect = new THREE.RectAreaLight(new THREE.Color('#cfe0ff'), 2.6, WINDOW.w, WINDOW.h)
  skyRect.position.set(WINDOW.x - 0.02, WINDOW.y, WINDOW.z)
  skyRect.lookAt(WINDOW.x - 1.6, WINDOW.y - 0.45, WINDOW.z)
  add(skyRect)

  /* ── (c) 창 빛 띠 — 창 밖의 해.
     오른쪽 벽은 castShadow가 없어서 빛이 벽을 통과한다(본 씬도 같다).
     그래서 벽 바깥(x=3.26)에 **보이지 않는 개구부 마스크**를 세워 창 모양으로만 통과시킨다.
     → 바닥에 창 모양 빛 띠 + 블라인드 슬랫 줄무늬가 그림자맵에서 그대로 나온다. */
  /* 광선이 커튼(x1.4~3.4, z-2.3)에 막히지 않도록 **열린 바닥**을 노린다.
     광선은 x=3.14에서 y≈2.09, z≈-0.22 를 지나 (창 개구부 안) 바닥 (0.6,-1.4)에 떨어진다. */
  /* 세기: 실내 조도 대비 3배쯤 되어야 '햇빛 띠'로 읽힌다. 4.2로는 바닥이 5% 밝아질 뿐 아무도 못 알아본다.
   단, 톤매핑이 없으면 이 값이 그대로 흰색으로 잘린다(파이프라인 의존). */
  const sun = new THREE.SpotLight(new THREE.Color('#fff4e2'), 11.0, 0, 0.34, 0.42, 0.0)
  sun.position.set(6.2, 4.6, 1.2)
  sun.target.position.set(0.6, 0, -1.4)
  sun.castShadow = true
  /* far를 광선이 바닥에 닿는 거리(≈7.7m)까지만 잡는다 → 방 반대편 책장·화분이 그림자 패스에서 컬링돼
     삼각형 수가 크게 준다. 이게 없으면 셰도우맵 하나가 씬 전체를 한 번 더 그린다. */
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.near = 3.0; sun.shadow.camera.far = 8.6
  sun.shadow.bias = -0.0009; sun.shadow.normalBias = 0.006
  add(sun)

  // 개구부 마스크 (벽 바깥이라 실내 카메라에는 절대 안 보인다)
  const maskMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
  const mask = new THREE.Group(); mask.position.set(3.26, 0, 0)
  const apZ0 = WINDOW.z - WINDOW.w / 2, apZ1 = WINDOW.z + WINDOW.w / 2
  const apY0 = WINDOW.y - WINDOW.h / 2, apY1 = WINDOW.y + WINDOW.h / 2
  const maskPart = (yc, hgt, zc, dep) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, hgt, dep), maskMat)
    m.position.set(0, yc, zc); m.castShadow = true; m.receiveShadow = false
    mask.add(m)
  }
  maskPart(apY0 / 2, apY0, ROOM.backZ / 2 + ROOM.frontZ / 2, ROOM.frontZ - ROOM.backZ)              // 창 아래 전체
  maskPart((apY1 + ROOM.h) / 2, ROOM.h - apY1, ROOM.backZ / 2 + ROOM.frontZ / 2, ROOM.frontZ - ROOM.backZ) // 창 위 전체
  maskPart((apY0 + apY1) / 2, WINDOW.h, (ROOM.backZ + apZ0) / 2, apZ0 - ROOM.backZ)                  // 창 뒤쪽 옆
  maskPart((apY0 + apY1) / 2, WINDOW.h, (apZ1 + ROOM.frontZ) / 2, ROOM.frontZ - apZ1)                // 창 앞쪽 옆
  g.add(mask)

  /* ── 책상 스탠드 (방 안의 실물 기구 — 리그가 바뀌어도 남는다) ── */
  const deskL = new THREE.PointLight(0xffc97d, 0.85, 2.2, 2)
  deskL.position.set(-2.9, 1.15, 0.3); add(deskL)

  /* ── (b) 바닥 반사 — 천장등이 흐릿하게 늘어져 비친다.
     완전 거울(Reflector)은 젖은 바닥이 된다. 대신
     ① 바닥 roughness를 낮춰 HDRI가 옅게 얹히게 하고
     ② 패널 아래에 늘어진 가산(additive) 반사 얼룩을 깐다. */
  /* 반사는 '늘어진 사각형'이어야 병원 바닥으로 읽힌다. 방사형 얼룩은 그냥 빛무리로 보인다.
     가로(패널 폭)는 가장자리만 부드럽게, 세로(시선 방향)는 길게 흐린다. */
  const streakTex = (() => {
    const W = 64, H = 256
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d')
    const gx = x.createLinearGradient(0, 0, W, 0)
    gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.28, 'rgba(255,255,255,1)')
    gx.addColorStop(0.72, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = gx; x.fillRect(0, 0, W, H)
    const gy = x.createLinearGradient(0, 0, 0, H)
    gy.addColorStop(0.0, 'rgba(0,0,0,1)'); gy.addColorStop(0.18, 'rgba(0,0,0,0)')
    gy.addColorStop(0.55, 'rgba(0,0,0,0.35)'); gy.addColorStop(1.0, 'rgba(0,0,0,1)')
    x.globalCompositeOperation = 'destination-out'
    x.fillStyle = gy; x.fillRect(0, 0, W, H)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  })()
  /* ⚠ 실험 결과 이 기법은 **역효과**였다(ablation: 켜면 바닥이 뿌옇게 흐려진다).
     스펙 §6.6(b)는 병원 비닐/타일 바닥을 전제했는데 본 씬 바닥은 brown_planks(따뜻한 무광 원목)다.
     원목은 실제로 천장등을 늘어뜨려 비추지 않으므로, 가짜 반사는 반사가 아니라 '먼지 낀 자국'으로 읽힌다.
     코드는 남기되 기본값은 끈다. 바닥을 타일/비닐로 바꾸면 그때 다시 켜라. */
  const FLOOR_REFLECTION = false
  const streakGroup = new THREE.Group()
  streakGroup.visible = FLOOR_REFLECTION
  PANELS.forEach((p, i) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 3.6),
      new THREE.MeshBasicMaterial({
        map: streakTex, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true,
        color: kelvin(KELVIN[i], 4300, [1.0, 0.99, 0.96]),
      }),
    )
    m.rotation.x = -Math.PI / 2
    m.position.set(p.x, 0.006, p.z + 0.75)
    m.renderOrder = 2
    streakGroup.add(m)
  })
  // 창 쪽 바닥의 넓은 광택 (창 빛이 바닥에 얹히는 느낌)
  const winSheen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 4.4),
    new THREE.MeshBasicMaterial({
      map: streakTex, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, depthWrite: false,
      color: new THREE.Color('#e8f0ff'),
    }),
  )
  winSheen.rotation.x = -Math.PI / 2
  winSheen.position.set(2.1, 0.005, -1.9)
  winSheen.renderOrder = 2
  streakGroup.add(winSheen)
  g.add(streakGroup)

  const applyCam = (which) => {
    // 진찰 시점에서는 침대 위 국소광이 조금 더 필요하다. 면광원 하나를 침대 위로.
    // (본 씬의 spotLight 대체 — 그림자는 shadowDir가 담당)
    if (!applyCam._examRect) {
      const r = new THREE.RectAreaLight(kelvin(4350, 4300, FLUO), 1.3, 1.0, 1.9)
      r.position.set(1.95, 2.55, -3.5)
      r.lookAt(1.95, 0.7, -3.5)
      g.add(r)
      applyCam._examRect = r
    }
    applyCam._examRect.visible = which === 'exam'
  }

  const applyMaterials = () => {
    // (b) 바닥: 병원 비닐 바닥의 흐릿한 반사. 거울 금지.
    ctx.floorMat.roughness = 0.44
    ctx.floorMat.envMapIntensity = 1.25
    ctx.floorMat.needsUpdate = true
    // 패널 자체가 빛나 보이게 (광원만 있고 패널이 어두우면 이상하다) + 색온도 반영
    ctx.panelMats.forEach((m, i) => {
      const c = kelvin(KELVIN[i], 4300, FLUO)
      m.color.copy(c); m.emissive.copy(c); m.emissiveIntensity = 2.5; m.needsUpdate = true
    })
    // 창 = 밝게 날아간 바깥 (따뜻한 노랑 → 살짝 푸른 하늘빛으로)
    ctx.glassMat.color.set('#ffffff')
    ctx.glassMat.emissive.set('#eaf2ff')
    ctx.glassMat.emissiveIntensity = 3.4
    ctx.glassMat.needsUpdate = true
    ctx.blindMeshes.forEach((m) => { m.castShadow = true })
  }

  return {
    name: 'light', group: g, applyCam, applyMaterials,
    parts: { streaks: streakGroup, sun, rects, skyRect, shadowDir, mask },
    shadowType: THREE.PCFSoftShadowMap,
    envIntensity: 0.5,
    exposure: 1.0,
    lightCount: g.children.filter((c) => c.isLight).length,
  }
}
