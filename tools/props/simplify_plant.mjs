/**
 * potted_plant_01 폴리곤 감축 (176k → 1만 이하).
 *
 * 왜 메시별로 다른 비율을 주는가:
 *   이 자산은 4개 메시로 갈라져 있고 시각적 기여도가 완전히 다르다.
 *     leaves  106,900 tri — alphaMode=MASK. 실루엣은 알파 텍스처가 만든다.
 *                            잎 카드가 잘게 쪼개져 있을 뿐이라 과감히 줄여도 된다.
 *     pebbles  56,878 tri — 화분 흙 위 자갈. 방 구석에서 위에서 살짝 보이는 정도.
 *     stem      7,008 tri — 줄기. 가늘어서 조금만 줄여도 실루엣이 상한다.
 *     pot       5,440 tri — 화분 본체. 매끈한 회전체라 실루엣이 제일 눈에 띈다.
 *   전역 단일 비율을 주면 화분이 각져버리고 잎은 여전히 무겁다.
 *
 * 사용: node simplify_plant.mjs <in.gltf> <out.gltf>
 */
import { NodeIO } from '@gltf-transform/core'
import { weld, simplifyPrimitive } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import path from 'node:path'

// 메시 이름 -> [목표 트라이앵글, 허용 오차(메시 반지름 대비), 경계 고정]
//
// 잎(Plane.070)은 182장이 각각 독립된 연결요소라 단순화기가 6,236 tri (장당 34) 아래로는
// 못 내려간다. 요소 하나를 더 접으면 잎이 사라지기 때문이다. 그래서 목표를 낮게 잡아도
// 6,236 에서 멈춘다 — 이건 한계지 설정 실수가 아니다.
// 나머지는 잎이 쓰고 남은 예산에 맞춰 배분한다. 화분(Circle.002)은 매끈한 회전체라
// 실루엣이 제일 눈에 띄므로 오차를 가장 빡빡하게 주고 예산도 넉넉히 준다.
const PLAN = {
  'Plane.070': [3000, 0.20, false],          // leaves — 실제로는 6,236 에서 바닥
  'Circle.008': [800, 0.12, false],          // pebbles — 흙 위 자갈, 화분 테두리에 대부분 가린다
  'potted_plant_01_base_low': [900, 0.02, false], // stem
  'Circle.002': [1900, 0.008, false],        // pot
}

const [, , SRC, DST] = process.argv
const io = new NodeIO()
const doc = await io.read(SRC)
await MeshoptSimplifier.ready

const triOf = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3

// weld 를 먼저 해야 한다 — 분리된 정점이 많으면 단순화기가 붙일 게 없어 목표에 못 간다
await doc.transform(weld({}))

const rows = []
for (const mesh of doc.getRoot().listMeshes()) {
  const name = mesh.getName()
  const plan = PLAN[name]
  for (const prim of mesh.listPrimitives()) {
    const before = triOf(prim)
    if (!plan) { rows.push([name, before, before, '(계획없음, 유지)']); continue }
    const [target, error, lock] = plan
    const ratio = Math.min(1, target / before)
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: lock })
    rows.push([name, before, triOf(prim), `ratio=${ratio.toFixed(3)} err=${error} lock=${lock}`])
  }
}

await io.write(DST, doc)

let b = 0, a = 0
for (const [n, x, y, note] of rows) {
  b += x; a += y
  console.log(`  ${n.padEnd(26)} ${String(x).padStart(7)} -> ${String(y).padStart(6)}  ${note}`)
}
console.log(`  ${'TOTAL'.padEnd(26)} ${String(b).padStart(7)} -> ${String(a).padStart(6)}  (${(100 * a / b).toFixed(1)}%)`)
console.log('  out:', path.basename(DST))
