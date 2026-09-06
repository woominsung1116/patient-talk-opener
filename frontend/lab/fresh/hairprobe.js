/**
 * 헤어 렌더 진단 — **읽기 전용**. 아바타 GLB를 수정하지 않는다.
 *
 * 텍스처 파일 통계만으로는 답이 안 나온다(두 헤어 모두 알파 채널이 있고 비율도 비슷하다).
 * 결정적인 것은 **메시가 UV로 실제 어디를 샘플링하느냐**다.
 * 그래서 GLTFLoader로 디코드한 뒤 정점 UV마다 텍스처 알파를 찍어 히스토그램을 낸다.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

const draco = new DRACOLoader()
draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/')
const loader = new GLTFLoader()
loader.setDRACOLoader(draco)

const out = document.getElementById('out')
const log = (s) => { out.textContent += s + '\n' }

const LIST = (new URLSearchParams(location.search).get('a') || 'f20_thin,f60_ob').split(',')

/** 텍스처 이미지를 캔버스로 옮겨 픽셀을 읽는다 */
function imageToCtx(img) {
  const w = img.width, h = img.height
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  return { g, w, h }
}

function pct(n, d) { return (n / d * 100).toFixed(1) + '%' }

async function probe(key) {
  const gltf = await loader.loadAsync(`/avatars/mh_${key}.glb`)
  log(`\n════════ mh_${key} ════════`)
  const hairs = []
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    const n = (o.name + '|' + (o.material?.name || '')).toLowerCase()
    if (/hair|bob|wig/.test(n)) hairs.push(o)
  })
  if (!hairs.length) { log('  헤어 메시 없음'); return }

  for (const m of hairs) {
    const mat = m.material
    const g = m.geometry
    const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3
    log(`\n  mesh: ${m.name}   material: ${mat.name}`)
    log(`    tris ${Math.round(tris)}   verts ${g.attributes.position.count}`)
    log(`    three.js 재질 상태:`)
    log(`      transparent=${mat.transparent}  opacity=${mat.opacity}  alphaTest=${mat.alphaTest}`)
    log(`      depthWrite=${mat.depthWrite}  side=${mat.side === THREE.DoubleSide ? 'Double' : mat.side === THREE.BackSide ? 'Back' : 'Front'}`)
    log(`      map=${mat.map ? (mat.map.image ? `${mat.map.image.width}x${mat.map.image.height}` : 'no image') : 'NONE'}`)
    log(`      color=#${mat.color?.getHexString()}  roughness=${mat.roughness}  metalness=${mat.metalness}`)
    log(`      alphaMap=${mat.alphaMap ? 'yes' : 'none'}  normalMap=${mat.normalMap ? 'yes' : 'none'}`)

    const uv = g.attributes.uv
    if (!uv) { log('    UV 없음 — 텍스처 샘플 불가'); continue }
    let u0 = 9, u1 = -9, v0 = 9, v1 = -9
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i)
      u0 = Math.min(u0, u); u1 = Math.max(u1, u)
      v0 = Math.min(v0, v); v1 = Math.max(v1, v)
    }
    log(`    UV bbox: u ${u0.toFixed(3)}~${u1.toFixed(3)}   v ${v0.toFixed(3)}~${v1.toFixed(3)}`)

    if (!mat.map?.image) { log('    맵 이미지 없음 — 알파 샘플 불가'); continue }
    const { g: ctx, w, h } = imageToCtx(mat.map.image)
    // 정점 UV마다 알파를 찍는다 (three.js는 v를 뒤집어 쓰므로 1-v)
    const bins = { a0: 0, lt64: 0, lt128: 0, lt250: 0, opaque: 0 }
    let sum = 0
    const N = uv.count
    for (let i = 0; i < N; i++) {
      let u = uv.getX(i), v = uv.getY(i)
      u = ((u % 1) + 1) % 1
      v = ((v % 1) + 1) % 1
      const px = Math.min(w - 1, Math.floor(u * w))
      const py = Math.min(h - 1, Math.floor((1 - v) * h))
      const a = ctx.getImageData(px, py, 1, 1).data[3]
      sum += a
      if (a === 0) bins.a0++
      else if (a < 64) bins.lt64++
      else if (a < 128) bins.lt128++
      else if (a < 250) bins.lt250++
      else bins.opaque++
    }
    log(`    ▶ 정점 ${N}개가 실제로 샘플링하는 알파:`)
    log(`        평균 alpha ${(sum / N).toFixed(1)} / 255`)
    log(`        alpha=0(완전투명)  ${String(bins.a0).padStart(5)}  ${pct(bins.a0, N)}`)
    log(`        0<a<64             ${String(bins.lt64).padStart(5)}  ${pct(bins.lt64, N)}`)
    log(`        64<=a<128          ${String(bins.lt128).padStart(5)}  ${pct(bins.lt128, N)}`)
    log(`        128<=a<250         ${String(bins.lt250).padStart(5)}  ${pct(bins.lt250, N)}`)
    log(`        a>=250(불투명)     ${String(bins.opaque).padStart(5)}  ${pct(bins.opaque, N)}   ← 이 값이 높으면 헬멧으로 보인다`)
  }
}

;(async () => {
  out.textContent = ''
  for (const k of LIST) {
    try { await probe(k) } catch (e) { log(`\nmh_${k}: 실패 ${e.message}`) }
  }
  log('\n[done]')
  window.__probeDone = true
})()

/* ── 피부 텍스처: 얼굴 UV 섬 vs 몸통 UV 섬 밝기 비교 ──
   같은 재질(AsianSkin)·같은 텍스처를 머리와 몸통이 공유하므로,
   톤 차이가 "텍스처에 이미 구워져 있는지" vs "렌더 단계에서 생기는지"를 가른다.
   ?skin=f60_ob,f20_thin 으로 호출한다. */
const SKIN = (new URLSearchParams(location.search).get('skin') || '').split(',').filter(Boolean)
if (SKIN.length) {
  ;(async () => {
    for (const key of SKIN) {
      const gltf = await loader.loadAsync(`/avatars/mh_${key}.glb`)
      log(`\n════════ 피부 톤 mh_${key} ════════`)
      let headBoneY = null
      gltf.scene.traverse((o) => { if (o.isBone && /^head$/i.test(o.name)) headBoneY = o.getWorldPosition(new THREE.Vector3()).y })
      gltf.scene.updateMatrixWorld(true)
      gltf.scene.traverse((o) => {
        if (!o.isMesh || !/asianskin|skin/i.test(o.material?.name || '')) return
        const mat = o.material
        if (!mat.map?.image) { log('  skin map 없음'); return }
        log(`  mesh=${o.name}  material=${mat.name}`)
        log(`  GLB 내장 텍스처 = ${mat.map.image.width}x${mat.map.image.height}`)
        const { g: ctx, w, h } = imageToCtx(mat.map.image)
        const pos = o.geometry.attributes.position, uv = o.geometry.attributes.uv
        if (!uv) { log('  UV 없음'); return }
        // 머리 기준선: head 본 y (없으면 상위 12% 높이)
        let maxY = -9, minY = 9
        for (let i = 0; i < pos.count; i++) { maxY = Math.max(maxY, pos.getY(i)); minY = Math.min(minY, pos.getY(i)) }
        const cut = headBoneY ?? (minY + (maxY - minY) * 0.86)
        const bandLo = minY + (maxY - minY) * 0.55, bandHi = minY + (maxY - minY) * 0.72 // 가슴~배 구간
        const samp = (test) => {
          let s = 0, n = 0
          for (let i = 0; i < pos.count; i += 3) {
            if (!test(pos.getY(i))) continue
            let u = ((uv.getX(i) % 1) + 1) % 1, v = ((uv.getY(i) % 1) + 1) % 1
            const d = ctx.getImageData(Math.min(w - 1, (u * w) | 0), Math.min(h - 1, ((1 - v) * h) | 0), 1, 1).data
            s += 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]; n++
          }
          return { mean: n ? s / n : 0, n }
        }
        const face = samp((y) => y > cut)
        const body = samp((y) => y > bandLo && y < bandHi)
        log(`  얼굴 UV 샘플 ${face.n}개 : 평균 휘도 ${face.mean.toFixed(1)} / 255`)
        log(`  몸통 UV 샘플 ${body.n}개 : 평균 휘도 ${body.mean.toFixed(1)} / 255`)
        const diff = (face.mean - body.mean) / Math.max(body.mean, 1e-6) * 100
        log(`  ▶ 얼굴 - 몸통 = ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%  ← 텍스처 자체의 톤 차이`)
      })
    }
    log('\n[skin done]')
    window.__probeDone = true
  })()
}
