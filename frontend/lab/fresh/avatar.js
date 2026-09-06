/**
 * 검증용 아바타 로더 — **환자 가시성 확인 전용**이다.
 *
 * 목적은 딱 하나: 문진 카메라에서 소품(특히 EMR 모니터)이 환자 얼굴·상체를 가리는지 본다.
 * 그래서 `RealisticPatient`의 피부 셰이더·표정 모프·호흡·시선은 **재현하지 않는다**.
 * 재현하는 것은 **골격 포즈와 배치**뿐 — 머리 위치와 화면 점유 면적이 맞으면 검증 목적은 달성된다.
 *
 * 포즈 파라미터는 `src/three/RealisticPatient.tsx`의 aim() 호출값을 **그대로 옮겨 적었다**(읽기 전용).
 * 값이 본 씬과 어긋나면 검증이 무의미해지므로 임의로 바꾸지 마라.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

/* MPFB(game_engine 골격) 본 이름 → 역할 키. norm()(소문자·공백/언더바 제거) 후 매핑.
   src/three/RealisticPatient.tsx의 MPFB_ALIAS와 동일해야 한다. */
const MPFB_ALIAS = {
  upperarml: 'lupperarm', upperarmr: 'rupperarm',
  lowerarml: 'lforearm', lowerarmr: 'rforearm',
  handl: 'lhand', handr: 'rhand',
  thighl: 'lthigh', thighr: 'rthigh',
  calfl: 'lcalf', calfr: 'rcalf',
  footl: 'lfoot', footr: 'rfoot',
  balll: 'ltoe0', ballr: 'rtoe0',
  spine01: 'spine', spine03: 'spine2', neck01: 'neck',
  claviclel: 'lclavicle', clavicler: 'rclavicle',
}
const norm = (s) => s.toLowerCase().replace(/[\s_]/g, '')

/* 본이 뻗는 방향을 재는 부모→자식 쌍 (RealisticPatient.aimData와 동일) */
const PAIRS = [
  ['lthigh', 'lcalf'], ['rthigh', 'rcalf'],
  ['lcalf', 'lfoot'], ['rcalf', 'rfoot'],
  ['lfoot', 'ltoe0'], ['rfoot', 'rtoe0'],
  ['lupperarm', 'lforearm'], ['rupperarm', 'rforearm'],
  ['lforearm', 'lhand'], ['rforearm', 'rhand'],
]

/* 자세별 조준값 — RealisticPatient.tsx useFrame에서 그대로 옮김 */
const POSE_AIM = {
  // 앉기: 허벅지 수평 앞으로, 종아리 수직 아래, 손은 무릎 위
  sit: [
    ['lthigh', 0.1, -0.12, 1], ['rthigh', -0.1, -0.12, 1],
    ['lcalf', 0.04, -1, 0.12], ['rcalf', -0.04, -1, 0.12],
    ['lupperarm', 0.16, -0.95, 0.18], ['rupperarm', -0.16, -0.95, 0.18],
    ['lforearm', 0.05, -0.55, 0.85], ['rforearm', -0.05, -0.55, 0.85],
  ],
  // 눕기(다리 곧게 폄) — 모델 공간에서 +y=머리쪽, +z=배(천장)
  lie: [
    ['lupperarm', 0.22, -1, 0.05], ['rupperarm', -0.22, -1, 0.05],
    ['lforearm', 0.12, -1, 0.06], ['rforearm', -0.12, -1, 0.06],
    ['lthigh', 0.05, -1, 0.02], ['rthigh', -0.05, -1, 0.02],
    ['lcalf', 0.02, -1, 0.05], ['rcalf', -0.02, -1, 0.05],
    ['lfoot', 0.02, -0.4, 1], ['rfoot', -0.02, -0.4, 1],
  ],
}

/* mh_*.glb는 **Draco 압축**이라 디코더가 없으면 조용히 로드 실패한다
   ("No DRACOLoader instance provided"). 디코더는 node_modules에 있는 것을 vite가 그대로 서빙하므로
   CDN(gstatic)에 의존하지 않는다 — 오프라인에서도 검증이 돌아간다. */
/* 교정 헤어 텍스처 검증용 스왑 (?hairfix=1).
   ⚠ GLB를 수정하지 않는다 — 런타임에 map만 갈아끼워 렌더 결과를 눈으로 확인하기 위한 것이다.
   실제 배선은 담당 파일이 비면 별도로 한다. */
const HAIR_FIX = {
  'human.toigo_inverted_bob': 'GoldenBlondHair',
  'human.toigo_curled_under_bob': 'GingerHair',
  'human.elvs_grump_hair': 'elvs_grumphair',
  'human.toigo_blunt_bob': 'StrawberryBlondHair',
  'human.toigo_blunt_bob_with_bangs': 'AuburnHair',
  'human.toigo_inverted_bob_with_bangs': 'BlackHair',
  'human.toigo_inverted_bob_with_bangs_hair': 'BlackHair',
}
const _texLoader = new THREE.TextureLoader()

const draco = new DRACOLoader()
draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/')
const loader = new GLTFLoader()
loader.setDRACOLoader(draco)

/**
 * @param url  /avatars/mh_*.glb
 * @param pose 'sit' | 'lie'
 * @returns { root, bones, headBone, applyPose() }  root를 원하는 그룹에 넣고 applyPose()를 호출한다.
 */
/** RealisticPatient.patientTargetHeight()와 동일. identitySeed는 0.5(개인차 없음)로 고정. */
function targetHeight(key) {
  const male = /^(m\d|youngm|oldm|boy)/.test(key)
  const ageMatch = key.match(/(\d{2})/)
  const age = ageMatch ? Number(ageMatch[1]) : 40
  const adultBase = male ? 1.73 : 1.62
  const smoothstep = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  if (age < 18) return 1.5
  return adultBase - smoothstep(age, 58, 86) * 0.045
}

export function loadAvatar(url, pose = 'sit') {
  const key = (url.split('/').pop() || '').replace(/^mh_/, '').replace(/\.glb$/, '')
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      const root = gltf.scene
      const bones = {}
      root.traverse((o) => {
        if (!o.isBone) return
        const n = norm(o.name)
        const key = MPFB_ALIAS[n] ?? n
        if (!bones[key]) bones[key] = o
      })
      /* ?hairshadow=0 : 헤어 메시의 그림자 투사만 끈다.
         불투명한 헤어 캡이 섀도맵으로 얼굴을 덮어 어둡게 만드는지 A/B 하기 위한 진단 스위치. */
      const hairShadow = new URLSearchParams(location.search).get('hairshadow') !== '0'
      const hairFix = new URLSearchParams(location.search).get('hairfix') === '1'
      root.traverse((o) => {
        if (!o.isMesh) return
        const isHair = /(hair|alpha7|ponytail|braid|curled|bob|maxwell|grump|culturalibre)/i
          .test(o.name + '|' + (o.material?.name || ''))
        if (hairFix && isHair) {
          const fixName = HAIR_FIX[(o.material?.name || '').toLowerCase()]
          if (fixName && o.material?.map) {
            const t = _texLoader.load(`/lab/fresh/hair_fixed/${fixName}.png`)
            t.flipY = false                    // glTF 규격 — 원본 텍스처와 같은 방향
            t.colorSpace = THREE.SRGBColorSpace
            t.wrapS = o.material.map.wrapS
            t.wrapT = o.material.map.wrapT
            o.material = o.material.clone()
            o.material.map = t
            o.material.needsUpdate = true
          }
        }
        o.castShadow = isHair ? hairShadow : true
        o.receiveShadow = true
        o.frustumCulled = false
      })

      /* 신장 정규화 — RealisticPatient의 `fit`과 동일하게 **바인드(선) 자세** bbox로 계산한다.
         이걸 빼면 아바타가 원본 크기 그대로여서 앉은 높이 검증이 무의미해진다.
           scale = 목표신장 / 원본신장,  yOff = -bbox.min.y * scale (발을 y=0으로) */
      root.updateMatrixWorld(true)
      const bindBox = new THREE.Box3().setFromObject(root)
      const rawH = bindBox.max.y - bindBox.min.y
      const th = targetHeight(key)
      const scale = rawH > 0 ? th / rawH : 1
      const fitGroup = new THREE.Group()
      fitGroup.scale.setScalar(scale)
      fitGroup.position.y = -bindBox.min.y * scale
      fitGroup.add(root)

      // 바인드 로컬 쿼터니언과 뼈가 뻗는 로컬 방향을 기록
      root.updateMatrixWorld(true)
      const init = {}
      const localDir = {}
      for (const [p, c] of PAIRS) {
        const pb = bones[p], cb = bones[c]
        if (!pb || !cb) continue
        localDir[p] = cb.position.clone().normalize()
      }
      for (const k of Object.keys(bones)) init[k] = bones[k].quaternion.clone()

      /** RealisticPatient.aim()과 같은 계산. damp=1(즉시 스냅) — 애니메이션은 필요 없다. */
      const applyPose = () => {
        fitGroup.updateMatrixWorld(true)
        const ROOT_Q = new THREE.Quaternion()
        fitGroup.getWorldQuaternion(ROOT_Q) // RealisticPatient의 group.current와 같은 노드
        for (const [key, dx, dy, dz] of (POSE_AIM[pose] ?? [])) {
          const b = bones[key], d = localDir[key], q0 = init[key]
          if (!b || !d || !q0 || !b.parent) continue
          const v = new THREE.Vector3(dx, dy, dz).normalize().applyQuaternion(ROOT_Q) // 모델공간 → 월드
          const PARENT_Q = new THREE.Quaternion()
          b.parent.getWorldQuaternion(PARENT_Q).multiply(q0) // 바인드 자세일 때의 월드 회전
          v.applyQuaternion(PARENT_Q.invert())               // 월드 → 본 바인드 로컬
          b.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromUnitVectors(d, v))
        }
        fitGroup.updateMatrixWorld(true)
      }

      resolve({ root: fitGroup, model: root, bones, headBone: bones.head, applyPose, scale, rawH: +rawH.toFixed(3), targetH: th, missing: PAIRS.filter(([p]) => !bones[p]).map(([p]) => p) })
    }, undefined, reject)
  })
}
