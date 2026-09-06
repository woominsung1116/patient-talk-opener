// 제스처 연출 빠른 확인 — LLM 없이 store 직접 호출로 진찰 제스처를 걸고 스크린샷
// node probe_gesture.mjs <케이스키워드> <액션id> <출력이름> [추가대기ms]
import { chromium } from 'playwright'

const [, , caseKey, actionId, outName, extraWait, query = '', rayPoint = '', lightMode = ''] = process.argv
const DIR = '/Users/woominseong/Desktop/최상위/patient-talk-opener/피드백_테스트'

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => { try { localStorage.setItem('ptg-onboarding-seen-v1', '1') } catch {} })
page.setDefaultTimeout(25000)
page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 400)))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300)) })

try {
  await page.goto(`http://localhost:5173${query}`)
  await page.waitForTimeout(4500)
  for (let i = 0; i < 10; i++) {
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('증례 선택'))
      b?.click(); return !!b
    }).catch(() => false)
    if (ok) break
    await page.waitForTimeout(800)
  }
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('이 환자 진료하기')), { timeout: 20000 })
  const clicked = await page.evaluate((key) => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('이 환자 진료하기'))
    for (const b of btns) {
      let n = b.parentElement
      for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
        const cnt = [...n.querySelectorAll('button')].filter((x) => x.textContent?.includes('이 환자 진료하기')).length
        if (cnt > 1) break
        if (n.textContent?.includes(key)) { b.click(); return true }
      }
    }
    return false
  }, caseKey)
  if (!clicked) throw new Error(`카드 못 찾음: ${caseKey}`)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('진료실 들어가기')), { timeout: 25000 })
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('진료실 들어가기'))?.click() })
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.__game.getState().startExam())
  await page.waitForTimeout(2000)
  // doHeadNeckExam → doVoiceExam 으로 개명 (두경부뿐 아니라 손떨림·간·흉부 청진도 이 경로를 쓴다)
  await page.evaluate((a) => window.__game.getState().doVoiceExam(a), actionId)
  await page.waitForTimeout(Number(extraWait ?? 2800))
  if (lightMode === 'penlightOff') {
    await page.evaluate(() => window.__scene?.traverse((node) => {
      if (node.isSpotLight && Math.abs(node.distance - 0.5) < 1e-4) node.intensity = 0
    }))
    await page.waitForTimeout(300)
  }
  if (lightMode === 'noFringe' || lightMode === 'noHairCore') {
    await page.evaluate((mode) => window.__scene?.traverse((node) => {
      if (!/hair_toigo_inverted_bob/i.test(node.name)) return
      if (mode === 'noFringe' && /__fringe$/.test(node.name)) node.visible = false
      if (mode === 'noHairCore' && !/__/.test(node.name)) node.visible = false
    }), lightMode)
    await page.waitForTimeout(300)
  }
  if (lightMode === 'cropHairTex') {
    await page.evaluate(() => window.__scene?.traverse((node) => {
      if (!/hair_toigo_inverted_bob/i.test(node.name)) return
      if (/__bob_seam_(backing|fill)$/.test(node.name)) {
        node.visible = false
        return
      }
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material?.map) continue
        material.map.repeat.y = 0.98
        material.map.needsUpdate = true
      }
    }))
    await page.waitForTimeout(300)
  }
  if (lightMode === 'noHairMap') {
    await page.evaluate(() => window.__scene?.traverse((node) => {
      if (!/hair_toigo_inverted_bob/i.test(node.name)) return
      if (/__bob_seam_(backing|fill)$/.test(node.name)) {
        node.visible = false
        return
      }
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material) continue
        material.map = null
        material.normalMap = null
        material.color?.set?.('#090807')
        material.needsUpdate = true
      }
    }))
    await page.waitForTimeout(300)
  }
  if (lightMode === 'hairUnlit') {
    await page.evaluate(() => window.__scene?.traverse((node) => {
      if (!/hair_toigo_inverted_bob/i.test(node.name)) return
      if (/__bob_seam_(backing|fill)$/.test(node.name)) {
        node.visible = false
        return
      }
      const source = Array.isArray(node.material) ? node.material[0] : node.material
      if (!source) return
      node.material = new window.__three.MeshBasicMaterial({
        map: source.map,
        color: 0xffffff,
        alphaTest: /__fringe$/.test(node.name) ? 0.02 : 0.25,
        transparent: /__fringe$/.test(node.name),
        depthWrite: !/__fringe$/.test(node.name),
        side: window.__three.DoubleSide,
      })
    }))
    await page.waitForTimeout(300)
  }
  const st = await page.evaluate(() => {
    const s = window.__game.getState()
    return {
      gesture: s.examGesture,
      log: s.examLog.map((e) => e.action_id),
      finding: s.lastFinding,
      cam: window.__cam,
      mouth: window.__dbgMouth,
      anchors: window.__examAnchors,
      bones: window.__patientBoneKeys,
      morphs: (() => {
        const result = []
        window.__scene?.traverse((node) => {
          if (node.name !== 'Human001' || !node.morphTargetDictionary || !node.morphTargetInfluences) return
          const active = Object.entries(node.morphTargetDictionary)
            .map(([name, index]) => [name, node.morphTargetInfluences[index] ?? 0])
            .filter(([, value]) => Math.abs(value) > 0.001)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          result.push({ object: node.name, active })
        })
        return result
      })(),
      hair: (() => {
        const result = []
        window.__scene?.traverse((node) => {
          if (!/bob/i.test(node.name) || !node.geometry) return
          node.geometry.computeBoundingBox()
          const box = node.geometry.boundingBox
          result.push({
            name: node.name,
            type: node.type,
            visible: node.visible,
            box: box ? [box.min.toArray(), box.max.toArray()] : null,
            position: node.position.toArray(),
            scale: node.scale.toArray(),
            material: (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).map((m) => ({
              name: m.name,
              color: m.color?.getHexString?.(),
              alphaTest: m.alphaTest,
              transparent: m.transparent,
            })),
          })
        })
        return result
      })(),
    }
  })
  console.log(JSON.stringify(st))
  if (rayPoint) {
    const rayPoints = rayPoint.split(';').map((point) => point.split(',').map(Number))
    const hits = await page.evaluate((points) => {
      const THREE = window.__three
      const camera = window.__camera
      const scene = window.__scene
      if (!THREE || !camera || !scene) return []
      const raycaster = new THREE.Raycaster()
      return points.map(([x, y]) => {
        raycaster.setFromCamera(
          new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1),
          camera,
        )
        return {
          pixel: [x, y],
          hits: raycaster.intersectObjects(scene.children, true).slice(0, 12).map((hit) => {
            const geometry = hit.object.geometry
            const triangle = hit.faceIndex == null || !geometry
              ? []
              : [0, 1, 2].map((corner) => {
                  const offset = hit.faceIndex * 3 + corner
                  const vertex = geometry.index ? geometry.index.getX(offset) : offset
                  const bind = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, vertex)
                  const posed = typeof hit.object.getVertexPosition === 'function'
                    ? hit.object.getVertexPosition(vertex, new THREE.Vector3())
                    : bind.clone()
                  hit.object.localToWorld(posed)
                  const jawIndex = hit.object.morphTargetDictionary?.jawOpen
                  const jaw = jawIndex == null ? null : geometry.morphAttributes.position?.[jawIndex]
                  const jawDelta = jaw
                    ? new THREE.Vector3().fromBufferAttribute(jaw, vertex)
                        .sub(geometry.morphTargetsRelative ? new THREE.Vector3() : bind)
                    : null
                  return {
                    vertex,
                    bind: bind.toArray().map((value) => Number(value.toFixed(4))),
                    posed: posed.toArray().map((value) => Number(value.toFixed(4))),
                    jawDelta: jawDelta?.toArray().map((value) => Number(value.toFixed(4))) ?? null,
                  }
                })
            return {
              distance: Number(hit.distance.toFixed(4)),
              point: hit.point.toArray().map((value) => Number(value.toFixed(4))),
              object: hit.object.name,
              uuid: hit.object.uuid,
              parent: hit.object.parent?.name,
              materials: (Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material])
                .filter(Boolean).map((material) => material.name),
              faceIndex: hit.faceIndex,
              triangle,
            }
          }),
        }
      })
    }, rayPoints)
    console.log('RAY', rayPoint, JSON.stringify(hits))
    const seedHit = hits.flatMap((entry) => entry.hits)
      .find((hit) => hit.object === 'Human001')
    const seedFace = seedHit?.faceIndex
    if (seedFace != null) {
      const component = await page.evaluate(({ faceIndex, uuid }) => {
        let mesh
        window.__scene?.traverse((node) => { if (!mesh && node.uuid === uuid) mesh = node })
        const geometry = mesh?.geometry
        const index = geometry?.index
        const position = geometry?.attributes?.position
        if (!geometry || !position) return null
        const triangleCount = index ? index.count / 3 : position.count / 3
        const vertexFaces = new Map()
        const triangleVertices = (face) => [0, 1, 2].map((corner) => {
          const offset = face * 3 + corner
          return index ? index.getX(offset) : offset
        })
        for (let face = 0; face < triangleCount; face++) {
          for (const vertex of triangleVertices(face)) {
            const faces = vertexFaces.get(vertex) ?? []
            faces.push(face)
            vertexFaces.set(vertex, faces)
          }
        }
        const queued = [faceIndex]
        const visited = new Set([faceIndex])
        for (let cursor = 0; cursor < queued.length; cursor++) {
          const face = queued[cursor]
          for (const vertex of triangleVertices(face)) {
            for (const neighbor of vertexFaces.get(vertex) ?? []) {
              if (visited.has(neighbor)) continue
              visited.add(neighbor)
              queued.push(neighbor)
            }
          }
        }
        const vertices = new Set()
        for (const face of visited) for (const vertex of triangleVertices(face)) vertices.add(vertex)
        const min = [Infinity, Infinity, Infinity]
        const max = [-Infinity, -Infinity, -Infinity]
        for (const vertex of vertices) {
          for (let axis = 0; axis < 3; axis++) {
            const value = position.getComponent(vertex, axis)
            min[axis] = Math.min(min[axis], value)
            max[axis] = Math.max(max[axis], value)
          }
        }
        return {
          seed: faceIndex,
          faces: visited.size,
          vertices: vertices.size,
          bbox: [min, max].map((row) => row.map((value) => Number(value.toFixed(4)))),
          faceIndices: visited.size <= 12000 ? [...visited] : null,
        }
      }, { faceIndex: seedFace, uuid: seedHit.uuid })
      console.log('COMPONENT', JSON.stringify(component))
    }
  }
  await page.screenshot({ path: `${DIR}/${outName}.png` })
  console.log('SHOT', outName)
} catch (e) {
  console.log('FAIL', String(e).slice(0, 200))
} finally {
  await browser.close()
}
