/**
 * 실사 환자 — Microsoft Rocketbox 아바타 (MIT 라이선스, 페이셜 본 리그 포함).
 * 본 제어로 앉기/걷기 자세, 눈썹/입꼬리 감정, 턱 립싱크, 눈 깜빡임을 구현한다.
 */
/* ⚠ 첫 줄 고정 — 아바타 GLB 17종이 전부 Draco 압축이라 디코더 경로가 먼저
   박혀 있어야 한다. AvatarLab 은 ClinicScene 을 거치지 않고 이 모듈만 불러오는
   경로라, 여기에도 따로 있어야 한다(중복 import 는 모듈 캐시로 무해하다). */
import '../dracoLocal'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import type { AvatarAppearance, ClinicalSkinRegion, Emotion } from '../types'
import type { CharacterVariant } from '../components/PatientCharacter'
import { isValid, isMpfb, type ValidVariant, type MpfbVariant } from './avatarVariant'

/* 현재(메인) 환자의 머리 본 월드좌표 — 두경부 진찰 카메라 줌/팔 앵커가 아바타 키에
   상관없이 정확한 위치를 잡도록 매 프레임 갱신되는 공유 벡터 (ClinicScene에서 읽음) */
// eslint-disable-next-line react-refresh/only-export-components
export const PATIENT_HEAD_WORLD = new THREE.Vector3(-0.94, 1.09, -0.06)

/* 복부·옆구리 진찰 앵커 — 현재 환자의 몸통 본 월드 프레임.
   머리(PATIENT_HEAD_WORLD)와 같은 원리다. 진찰 부위를 월드 절대좌표로 박아 두면
   MPFB 12종 + 비만/마름 변형 + VALID/Rocketbox/RenderPeople 사이의 키·다리 길이·
   몸통 길이 차이만큼 배 위치가 통째로 어긋난다. 본에서 매 프레임 유도해 그 차이를 흡수한다.
   RenderPeoplePatient도 (객체를 새로 만들지 않고) 이 객체를 그대로 채운다. */
// eslint-disable-next-line react-refresh/only-export-components
export const PATIENT_TORSO = {
  pubis: new THREE.Vector3(),   // 골반(pelvis) 본 월드좌표 ≈ 두덩결합 높이
  xiphoid: new THREE.Vector3(), // 가슴(spine2) 본 월드좌표 ≈ 칼돌기 높이
  right: new THREE.Vector3(0, 0, 1),  // 환자 기준 오른쪽 단위벡터 (월드)
  up: new THREE.Vector3(1, 0, 0),     // 두덩결합→칼돌기 (몸통 세로축) 단위벡터
  front: new THREE.Vector3(0, 1, 0),  // 배 바깥쪽 법선 (앙와위면 대략 +y)
  halfWidth: 0.16,              // 몸통 반폭(m) — 좌우 넓적다리 본 간격에서 산출
  valid: false,                 // 본을 못 찾으면 false → 소비측이 기존 상수로 폴백
}

/* 손·하지 미리보기 카메라가 참조하는 실제 리그의 관절 위치.
   몸통 추정과 자세가 바뀌어도 보이는 아바타의 실제 위치를 기준으로 잡는다. */
// eslint-disable-next-line react-refresh/only-export-components
export const PATIENT_LIMBS = {
  leftHand: new THREE.Vector3(),
  rightHand: new THREE.Vector3(),
  leftKnee: new THREE.Vector3(),
  rightKnee: new THREE.Vector3(),
  leftAnkle: new THREE.Vector3(),
  rightAnkle: new THREE.Vector3(),
  handsValid: false,
  legsValid: false,
}

/* 몸통 프레임 계산용 임시 벡터 — 진찰 중 갱신하는 환자는 항상 한 명이라 모듈 스코프로 재사용한다. */
const TORSO_LTHIGH = new THREE.Vector3()
const TORSO_RTHIGH = new THREE.Vector3()
const TORSO_PROJ = new THREE.Vector3()
let torsoFlipWarned = false

/** 몸통 본 4개(골반·가슴·좌우 넓적다리)에서 PATIENT_TORSO를 갱신한다.
 *  본 이름 체계가 다른 RealisticPatient(MPFB/VALID/Rocketbox)와 RenderPeoplePatient가
 *  각자 본을 찾아 넘기고, 좌표계 유도식은 여기 한 곳에만 둔다.
 *  supine: 앙와위(누운 자세)인가 — front 부호 검산에만 쓴다. */
// eslint-disable-next-line react-refresh/only-export-components
export function updatePatientTorso(
  pelvisBone: THREE.Object3D | undefined,
  chestBone: THREE.Object3D | undefined,
  lThighBone: THREE.Object3D | undefined,
  rThighBone: THREE.Object3D | undefined,
  supine: boolean,
): void {
  if (import.meta.env.DEV) {
    /* 새 리그를 추가했을 때 "본 이름이 안 맞아 조용히 고정 좌표 폴백으로 떨어지는" 상황을
       바로 알 수 있게 매칭 결과를 노출한다. 시각 회귀 스크립트도 이 값을 읽는다. */
    ;(window as unknown as { __torsoBones?: unknown }).__torsoBones = {
      pelvis: pelvisBone?.name ?? null,
      chest: chestBone?.name ?? null,
      lthigh: lThighBone?.name ?? null,
      rthigh: rThighBone?.name ?? null,
    }
  }
  if (!pelvisBone || !chestBone || !lThighBone || !rThighBone) {
    PATIENT_TORSO.valid = false
    return
  }
  pelvisBone.getWorldPosition(PATIENT_TORSO.pubis)
  chestBone.getWorldPosition(PATIENT_TORSO.xiphoid)
  lThighBone.getWorldPosition(TORSO_LTHIGH)
  rThighBone.getWorldPosition(TORSO_RTHIGH)
  const torsoLen = PATIENT_TORSO.pubis.distanceTo(PATIENT_TORSO.xiphoid)
  const hipSpan = TORSO_LTHIGH.distanceTo(TORSO_RTHIGH)
  // 로딩 직후엔 본이 전부 원점에 겹쳐 있을 수 있다 → 축을 못 만드니 무효 처리
  if (torsoLen < 1e-4 || hipSpan < 1e-4) {
    PATIENT_TORSO.valid = false
    return
  }
  PATIENT_TORSO.up.subVectors(PATIENT_TORSO.xiphoid, PATIENT_TORSO.pubis).divideScalar(torsoLen)
  // 환자의 오른쪽 = (오른쪽 넓적다리 − 왼쪽 넓적다리). 본 이름이 좌우의 유일한 진실이다.
  // 실측: MPFB thigh_r는 모델공간 x<0, thigh_l은 x>0 → 모델공간 환자 오른쪽 = −X.
  PATIENT_TORSO.right.subVectors(TORSO_RTHIGH, TORSO_LTHIGH).normalize()
  // 그람-슈미트: 몸통 세로축 성분을 빼 up과 직교시킨다(다리를 벌리거나 굽혀도 축이 기울지 않게).
  TORSO_PROJ.copy(PATIENT_TORSO.up).multiplyScalar(PATIENT_TORSO.right.dot(PATIENT_TORSO.up))
  PATIENT_TORSO.right.sub(TORSO_PROJ).normalize()
  // 배 바깥쪽 법선 = up × right.
  //   검산: 모델공간에서 up=+Y, 환자 오른쪽=−X 이므로 up×right = (0,1,0)×(−1,0,0) = +Z = 모델 정면 ✓
  //   (스펙 초판의 right×up 은 −Z, 즉 등 쪽이 나와 틀렸다. 그대로 쓰면 CVA가 배로 간다.)
  PATIENT_TORSO.front.crossVectors(PATIENT_TORSO.up, PATIENT_TORSO.right).normalize()
  // 앙와위에서 배는 천장(+y)을 향해야 한다. 반대로 나온다면 좌/우 본 이름이 뒤바뀐 리그라는 뜻이므로
  // right까지 함께 뒤집어 오른손 좌표계를 유지한다(front만 뒤집으면 왼손계가 되어 CVA가 배 쪽으로 간다).
  // 현재 아바타 풀(MPFB/VALID/Rocketbox/RenderPeople)에서는 걸리지 않아야 정상이라 경고를 남긴다.
  if (supine && PATIENT_TORSO.front.y < 0) {
    PATIENT_TORSO.front.negate()
    PATIENT_TORSO.right.negate()
    if (import.meta.env.DEV && !torsoFlipWarned) {
      torsoFlipWarned = true
      console.warn('[PATIENT_TORSO] 앙와위인데 배 법선이 아래를 향했다 — 좌우 본 이름이 뒤바뀐 리그로 보고 보정함')
    }
  }
  // 넓적다리 본 간격(고관절 중심 사이)에서 몸통 반폭을 근사한다.
  PATIENT_TORSO.halfWidth = hipSpan * 0.62
  PATIENT_TORSO.valid = true
}
import { getMouthFeatures, getMouthLevel } from '../audio/tts'
import { useGame } from '../store'

const TEX_LOADER = new THREE.TextureLoader()

/* MPFB 아바타 파일 버전 — 아바타를 재생성해 교체할 때마다 올려서 브라우저 캐시를 깬다. */
const AVATAR_VER = 'v32'

/* VALID(Mixamo 골격) 본 이름 → 역할 키 별칭. norm()(소문자·공백/언더바 제거) 후 매핑.
   aim 시스템은 바인드포즈 기반이라 이름만 맞으면 포즈가 그대로 작동. */
const MIXAMO_ALIAS: Record<string, string> = {
  leftupleg: 'lthigh', rightupleg: 'rthigh',
  leftleg: 'lcalf', rightleg: 'rcalf',
  leftfoot: 'lfoot', rightfoot: 'rfoot',
  lefttoebase: 'ltoe0', righttoebase: 'rtoe0',
  leftarm: 'lupperarm', rightarm: 'rupperarm',
  leftforearm: 'lforearm', rightforearm: 'rforearm',
  lefthand: 'lhand', righthand: 'rhand',
  leftshoulder: 'lclavicle', rightshoulder: 'rclavicle',
  lefteye: 'leye', righteye: 'reye',
  hips: 'pelvis',
}

/* MPFB(game_engine 골격, Unreal식) 본 이름 → 역할 키 별칭. norm 후:
   upperarm_l→upperarml, thigh_l→thighl, spine_01→spine01 등. */
const MPFB_ALIAS: Record<string, string> = {
  upperarml: 'lupperarm', upperarmr: 'rupperarm',
  lowerarml: 'lforearm', lowerarmr: 'rforearm',
  handl: 'lhand', handr: 'rhand',
  thighl: 'lthigh', thighr: 'rthigh',
  calfl: 'lcalf', calfr: 'rcalf',
  footl: 'lfoot', footr: 'rfoot',
  spine01: 'spine', spine03: 'spine2', neck01: 'neck',
  claviclel: 'lclavicle', clavicler: 'rclavicle',
  // head 는 동일
}

/* 텍스처를 비동기로 로드해 도착 시점에 머티리얼에 꽂는다.
   TextureLoader.load는 로드 전 '빈 텍스처'(샘플링 시 검정)를 즉시 반환하므로,
   map을 미리 달면 로딩 동안 캐릭터가 새카맣게 보인다. 그래서 onLoad에서야 map을 연결한다. */
function assignTexWhenReady(
  mat: THREE.MeshStandardMaterial,
  prop: 'map' | 'normalMap',
  url: string,
  srgb: boolean,
  flipY = false,
  /** 렌더러가 지원하는 최대 비등방 값. 안 주면 8 로 가정한다(대부분의 GPU 가 16 이상). */
  maxAnisotropy = 8,
) {
  TEX_LOADER.load(
    url,
    (t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      t.flipY = flipY
      /* ⚠️ **비등방 필터링을 여기서 걸어야 한다.** `setTextureDetail()` 은 재질을 튜닝하는
       *   시점에 한 번 돌고 끝나는데, 이 텍스처는 그보다 **늦게 비동기로 도착**한다.
       *   그래서 종전에는 교체된 피부 알베도만 `anisotropy = 1`(기본값)로 남았다.
       *
       *   증상: **앉은 자세(문진)에서 얼굴이 깨져 보이고, 누운 자세에서는 멀쩡했다.**
       *   문진은 카메라가 멀어 얼굴이 작게·비스듬히 그려지는데, 비등방 필터가 없으면
       *   눈썹·속눈썹·입술선 같은 고주파가 한 방향으로만 뭉개져 얼룩으로 읽힌다.
       *   누우면 카메라가 가깝고 거의 정면이라 같은 텍스처인데도 멀쩡해 보였다.
       *
       *   ⚠ 이건 `texture.anisotropy`(필터링)다. 프로젝트가 금지한 것은
       *     `material.anisotropy`(KHR_materials_anisotropy) — 그쪽은 탄젠트가 필요해
       *     UV 없는 메시에서 NaN → 블랙아웃을 만든다. 둘은 다른 것이다. */
      t.anisotropy = Math.max(t.anisotropy, maxAnisotropy)
      t.generateMipmaps = true
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.needsUpdate = true
      mat[prop] = t
      mat.userData.patientLoadedTexture = url
      mat.needsUpdate = true
      if (import.meta.env.DEV && url.includes('/avatars/skin/')) {
        console.info(`[patient-skin] loaded ${url} flipY=${String(flipY)}`)
      }
    },
    undefined,
    () => {
      /* 텍스처 없음(예: hyunwoo는 opacity 없음) → 베이스 컬러 유지 */
    },
  )
}

useGLTF.preload('/models/gnm_oral_anatomy.glb?v=4')

function assignClothTextureWhenReady(
  mat: THREE.MeshStandardMaterial,
  url: string,
  maxAnisotropy: number,
) {
  TEX_LOADER.load(
    url,
    (texture) => {
      // 원본 프린트는 대비와 채도가 높아 벽지처럼 보인다. 브라우저에서 같은
      // CC0 이미지를 비파괴 색보정해 생활복 원단처럼 바랜 작은 무늬로 만든다.
      const source = texture.image as HTMLImageElement | undefined
      if (source && typeof document !== 'undefined' && source.width > 0 && source.height > 0) {
        const canvas = document.createElement('canvas')
        canvas.width = source.width
        canvas.height = source.height
        const context = canvas.getContext('2d')
        if (context) {
          context.filter = 'saturate(52%) contrast(62%) brightness(112%)'
          context.drawImage(source, 0, 0, canvas.width, canvas.height)
          ;(texture as THREE.Texture).image = canvas
        }
      }
      texture.name = 'patient-muted-floral-cotton'
      texture.userData.patientTextureOwned = true
      texture.colorSpace = THREE.SRGBColorSpace
      texture.flipY = false
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.repeat.set(2.65, 2.85)
      texture.anisotropy = Math.min(8, maxAnisotropy)
      texture.needsUpdate = true
      mat.map = texture
      mat.needsUpdate = true
    },
    undefined,
    () => {
      /* 프린트를 읽지 못하면 무광 단색 튜닉으로 안전하게 폴백한다. */
    },
  )
}

/* 본 이름 정규화: 'Bip01 L UpperArm' → 'lupperarm' */
function norm(name: string): string {
  return name.replace(/Bip01/g, '').replace(/[ _.]/g, '').toLowerCase()
}

type PatientMaterialKind =
  | 'skin'
  | 'eye'
  | 'hair'
  | 'brow'
  | 'lash'
  | 'teeth'
  | 'tongue'
  | 'fabric'

type ScalarUniform = { value: number }
type Vector2Uniform = { value: THREE.Vector2 }

interface PatientRuntimeUniforms {
  blink?: ScalarUniform
  mouth?: ScalarUniform
  mouthRound?: ScalarUniform
  mouthMood?: ScalarUniform
  browRaise?: ScalarUniform
  browSlant?: ScalarUniform
  gaze?: Vector2Uniform
  time?: ScalarUniform
  motion?: ScalarUniform
}

interface MpfbFaceLandmarks {
  eyeLeft: THREE.Vector3
  eyeRight: THREE.Vector3
  eyeRadius: THREE.Vector2
  mouthCenter: THREE.Vector3
  mouthRadius: THREE.Vector2
}

interface PatientMaterialOptions {
  face?: MpfbFaceLandmarks | null
  // 네이티브 ARKit 모프를 쓰는 모델도 색·거칠기 기반 얼굴 디테일에는 랜드마크가 필요하다.
  surfaceFace?: MpfbFaceLandmarks | null
  ageFactor?: number
  identitySeed?: number
  /** 개인별 점·주근깨·수염 자국·홍조 (patientSkinDetail 참고) */
  skinDetail?: PatientSkinDetail
  longHair?: boolean
  /** 헤어 텍스처가 저대비 교정을 거친 자산인가 — 그렇다면 회색 블렌드를 걷는다. */
  correctedHair?: boolean
  debugSkinSurface?: 'normalOff' | 'albedoOff' | 'mapsOff' | 'recomputeNormals' | 'recomputeFlat'
}

/* 예전에는 f50·f60·f60_ob·f70 이 **연령 신호(회끗한 흑발)를 텍스처 안에** 구운
   교정본(tools/fix_hair_contrast.py)을 썼기 때문에 여기서 회색 블렌드를 걷어냈다.
   지금은 그 아바타들도 전부 원본 해상도 `BlackHair.png` 를 쓴다 — 텍스처에 나이가
   없으므로 **블렌드를 다시 켜야 한다.**

   교정본을 버린 이유: 그 텍스처들은 배포 압축에서 1024² 로 줄어 있었고, 그 해상도에서
   가는 가닥이 고주파 잡티가 되어 **머리가 수세미처럼** 보였다(실측: 교정본 1024²
   평균 (35,28,25) vs 원본 3600² (37,37,37)). 컷오프를 0.10~0.65 로 훑어도 그대로였다 —
   재질이 아니라 텍스처의 문제였다는 증거다. */
const CORRECTED_HAIR_VARIANTS = /^mh_m60$/  // 사진에서 복원한 헤어는 흰머리가 이미 텍스처에 있다

/* 개발용 헤어 알파 컷 스윕(`?hairAlpha=0.2`). 앞머리 끝처럼 알파가 낮은 가닥은
   컷오프를 올리면 통째로 사라져 **계단처럼 각진 검은 슬래브**가 된다.
   ⚠ 컷오프를 만졌으면 반드시 앞머리 경계를 확대 캡처해서 눈으로 확인해라
   (`scratchpad/hair_sweep.mjs`). 평균 밝기 같은 간접 지표로는 안 잡힌다. */
/* ── 2패스 헤어 ────────────────────────────────────────────────────────────
   알파 컷 하나로는 부드러운 머리끝을 만들 수 없다. `alphaTest` 는 **이진 판정**이라
   텍스처가 가진 반투명 띠를 임계값에서 잘라 버린다. BlackHair.png 는 알파 중간값
   픽셀이 12.6% 나 되는 **부드러운** 마스크인데, 그걸 통째로 버리고 있었다.
   그래서 컷오프를 0.10~0.65 로 훑어도 톱니가 그대로였다 — 값의 문제가 아니라
   방식의 문제였다.

   코어: 알파가 확실한 안쪽만 불투명하게 그리고 **깊이를 쓴다**(정렬 담당).
   프린지: 같은 지오메트리를 블렌딩으로 한 번 더 그려 그 바깥의 반투명 띠를 덮는다.
           `depthWrite:false` + `depthFunc:LessDepth` — 코어와 같은 깊이면 탈락하므로
           덧그려지지 않고, 코어가 버린 영역에만 부드럽게 얹힌다.
   ⚠ 프린지만 `depthWrite:false` 다. 코어까지 끄면 예전의 어깨 얼룩이 돌아온다. */
/* ⚠ 0.5 는 **머리끝을 통째로 잘라** 실루엣이 매끈한 헬멧이 됐다("레고 대가리"
   지적, 2026-08-03). 텍스처의 가는 가닥은 알파 0.2~0.45 구간에 몰려 있어서
   컷이 0.5 면 그 층이 전부 날아간다. 0.25 면 끝단이 갈라져 보인다(진료실 스윕
   0.5/0.35/0.22 비교로 확인).
   ⚠ 더 내리면 반투명 텍셀까지 불투명하게 렌더돼 테두리가 뿌예진다. */
const HAIR_CORE_ALPHA_TEST = 0.25
const HAIR_FRINGE_ALPHA_TEST = 0.02
const HAIR_FRINGE_SUFFIX = '__fringe'
/* T존(이마·코·턱)의 거칠기를 낮춰 볼과 반사 대비를 만든다. `?skinTzone=0.2` 로 스윕. */
const SKIN_TZONE_OIL = 0.25
const skinTZoneOverride = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('skinTzone')
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
})()

/* 자세 전환 이징 — 포락선이 0에서 1까지 오르는 데 걸리는 시간(초)과 감쇠율.
   ⚠ 초를 늘리면 **전체가 느려지는 게 아니라 시작이 더 부드러워진다**(포락선이
   천천히 오른다). 전체 속도는 POSE_DAMP_RATE 쪽이다.
   0.85초는 "요청 → 환자가 반응해서 자세를 바꾼다" 로 읽히는 값이다. 더 늘리면
   지시를 못 알아들은 것처럼 굼떠 보인다 — 진료실 씬에서 눈으로 확인해라. */
const POSE_EASE_SECONDS = 0.85
const POSE_DAMP_RATE = 5.5
/* `?poseEase=0` 이면 이징을 끄고 예전의 지수 감쇠(delta*7)로 돌아간다.
   A/B 로 곡선을 비교할 때 쓴다 — 값만 보고 "부드러워졌다"고 하지 마라. */
const poseEaseOverride = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('poseEase')
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 4 ? value : null
})()

/* 힘 뺀 손의 손가락별 말림 비율과 벌림(외전).
   전부 같은 각도로 말면 손가락이 한 덩어리로 붙어 보인다 — 검지에서 새끼로
   갈수록 조금씩 더 말리고, 첫마디는 살짝 벌어져야 사이가 갈라져 보인다.
   엄지는 다른 축에 놓여 있어 훨씬 적게 말고 크게 벌린다. */
const FINGER_RELAX: readonly (readonly [string, number, number])[] = [
  ['thumb', 0.34, 0.30],
  ['index', 0.82, 0.055],
  ['middle', 0.92, 0.012],
  ['ring', 1.0, -0.028],
  ['pinky', 1.08, -0.062],
]

/* 손가락 말림 세기·축. `?fingerCurl=0`(끔) / `?fingerAxis=x|y|z` 로 스윕한다. */
const HAND_CURL = 0.30
const handCurl = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return HAND_CURL
  const raw = new URLSearchParams(window.location.search).get('fingerCurl')
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= -1.5 && value <= 1.5 ? value : HAND_CURL
})()
/* MPFB(game_engine) 골격에서 손가락이 손바닥 쪽으로 말리는 축은 **x** 다.
   렌더 스윕으로 확인했다 — y 는 손가락이 그대로 펴진 채 엄지만 돌고, z 는
   손가락이 뒤로 당겨진다.
   ⚠ 이 스윕을 처음엔 `freeze=1` 로 찍어서 **네 장이 전부 똑같이 나왔다.**
   `debugFreezePose` 가 포즈 루프를 통째로 return 시키기 때문이다. 포즈를
   확인할 때는 freeze 를 빼라 — 안 그러면 "축이 문제가 아니구나" 하고 엉뚱한
   데를 뒤지게 된다(실제로 그랬다). */
const fingerAxis = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 'x'
  const raw = new URLSearchParams(window.location.search).get('fingerAxis')
  return raw === 'x' || raw === 'y' || raw === 'z' ? raw : 'x'
})()

/* 의상 주름 범프 세기. `?clothBump=0.02` 로 스윕한다.
   처음 잡았던 0.0032 는 **렌더에서 전혀 안 보였다** — 기존 직조(weave) 범프가
   0.0011~0.00145 인 것을 보고 비슷한 자릿수로 잡았는데, 그건 실 한 올짜리
   고주파라 기준이 다르다. 저주파 주름은 한 자릿수 위여야 보인다. */
const CLOTH_WRINKLE_BUMP = 0.018
const clothBumpOverride = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('clothBump')
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 0.5 ? value : null
})()

/* `?hideKind=hair,skin` — 재질 종류별로 통째로 숨긴다. "이 얼룩이 무엇인가"를
   한 번에 가르는 이분법 도구다. `?hideHair=1` 은 예전 이름으로 계속 받는다.
   ⚠ 진료실 씬에도 걸린다 — AvatarLab 전용 `debugSkinSurface` 와 달리 모듈 전역이라
   앉은 자세에서만 나오는 아티팩트를 잡을 수 있다. */
const hiddenKinds = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return new Set<string>()
  const query = new URLSearchParams(window.location.search)
  const kinds = (query.get('hideKind') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (query.get('hideHair') === '1') kinds.push('hair')
  return new Set(kinds)
})()

/* `?breathBelly=0` — 복식호흡 진폭 스윕(A/B 검증용). */
const breathBellyOverride = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('breathBelly')
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 0.3 ? value : null
})()

/* `?hairA2C=1` — alpha-to-coverage. MSAA 샘플이 있어야 의미가 있다. */
const hairA2COverride = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('hairA2C')
  return raw === null ? null : raw === '1'
})()

/* `?hairDebug=noSheen|noAniso|noNormal|flat` — 헤어 재질 이분법용. */
const hairDebug = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('hairDebug')
  return raw === 'noSheen' || raw === 'noAniso' || raw === 'noNormal' || raw === 'flat'
    ? raw
    : null
})()

/* `?hairGrey=0.3` / `?hairGreyColor=8f8b88` — 노년 흑발 회색화 스윕. */
const hairGreyOverride = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const query = new URLSearchParams(window.location.search)
  const strength = Number(query.get('hairGrey'))
  const color = query.get('hairGreyColor')
  if (!Number.isFinite(strength) && !color) return null
  return {
    strength: Number.isFinite(strength) ? strength : undefined,
    color: color ? `#${color.replace('#', '')}` : undefined,
  }
})()
const hairAlphaTestOverride = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('hairAlpha')
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
})()

interface NativeFaceMorphRig {
  mesh: THREE.Mesh
  dictionary: Record<string, number>
  influences: number[]
}

function collectNativeFaceMorphRigs(root: THREE.Object3D): NativeFaceMorphRig[] {
  const rigs: NativeFaceMorphRig[] = []
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    const dictionary = mesh.morphTargetDictionary
    const influences = mesh.morphTargetInfluences
    if (!mesh.isMesh || !dictionary || !influences) return
    // Avoid treating unrelated VALID/Rocketbox morph sets as the MPFB ARKit rig.
    if (
      dictionary.jawOpen === undefined
      || dictionary.eyeBlinkLeft === undefined
      || dictionary.mouthSmileLeft === undefined
      || dictionary.viseme_aa === undefined
    ) return
    rigs.push({ mesh, dictionary, influences })
  })
  return rigs
}

function driveNativeMorph(
  rigs: NativeFaceMorphRig[],
  name: string,
  target: number,
  delta: number,
  speed = 18,
) {
  const value = THREE.MathUtils.clamp(target, 0, 1)
  for (const rig of rigs) {
    const index = rig.dictionary[name]
    if (index === undefined) continue
    rig.influences[index] = THREE.MathUtils.damp(
      rig.influences[index] ?? 0,
      value,
      speed,
      delta,
    )
  }
}

export function stableUnit(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

function variantAgeFactor(variant: string, chronologicalAge?: number): number {
  if (chronologicalAge !== undefined && Number.isFinite(chronologicalAge)) {
    if (chronologicalAge < 16) return 0
    return THREE.MathUtils.clamp((chronologicalAge - 20) / 50, 0, 1)
  }
  if (/boy|girl/.test(variant)) return 0
  if (/old/.test(variant)) return 1
  if (/young/.test(variant)) return 0.18
  const age = Number(variant.match(/([2-7])0/)?.[0] ?? 35)
  return THREE.MathUtils.clamp((age - 20) / 50, 0, 1)
}

function variantApproximateAge(variant: string): number {
  if (/boy|girl/.test(variant)) return 10
  if (/old/.test(variant)) return 70
  if (/young/.test(variant)) return 25
  return Number(variant.match(/mh_[mf](\d{2})/)?.[1] ?? 35)
}

/* AvatarLab 이 얼굴 QA 카메라 높이를 맞추는 데도 쓴다 — 고정 높이로 찍으면
   키 큰 남성(m30 은 1.73m)의 얼굴이 프레임 밖으로 나가 목·가슴만 찍힌다. */
export function patientTargetHeight(
  variant: string,
  chronologicalAge: number | undefined,
  identitySeed: number,
): number {
  const age = chronologicalAge ?? variantApproximateAge(variant)
  const male = /mh_(?:m\d|youngm|oldm|boy)/.test(variant)
  const adultBase = male ? 1.73 : 1.62
  if (age < 18) {
    if (age <= 5) return THREE.MathUtils.lerp(0.9, 1.1, THREE.MathUtils.clamp((age - 3) / 2, 0, 1))
    if (age <= 12) return THREE.MathUtils.lerp(1.1, 1.5, (age - 5) / 7)
    return THREE.MathUtils.lerp(1.5, adultBase, (age - 12) / 6)
  }
  const individualVariation = (identitySeed - 0.5) * 0.075
  const seniorLoss = THREE.MathUtils.smoothstep(age, 58, 86) * 0.045
  return adultBase + individualVariation - seniorLoss
}

/* 생성 사진을 얼굴에 투영한 전용 피부가 있는 환자. 메시·뼈대·모프·의상은 그대로라
   표정·입·목 움직임과 탈의는 일반 아바타와 똑같이 동작한다. */
const PHOTO_SKIN_VARIANTS: ReadonlySet<string> = new Set<string>(['mh_m60'])

function mpfbSkinTextureUrl(variant: string, chronologicalAge?: number): string {
  if (PHOTO_SKIN_VARIANTS.has(variant)) return `/avatars/skin/photo_${variant}.webp?skin=v1`
  const male = /mh_(?:m\d|youngm|oldm|boy)/.test(variant)
  const age = chronologicalAge ?? variantApproximateAge(variant)
  const tier = age >= 60 ? 'old' : age >= 40 ? 'middle' : 'young'
  return `/avatars/skin/asian_${tier}_${male ? 'male' : 'female'}.png?skin=v3`
}

/* ── 개인별 피부 자국 ──────────────────────────────────────────────────────
   피부 텍스처는 6장(연령 3 × 성별 2)을 17명이 나눠 쓴다. 그래서 점·주근깨·
   수염 자국이 **모든 환자의 같은 자리에** 똑같이 찍힌다 — 얼굴 형태를 아무리
   다르게 만들어도 자국이 같으면 "같은 사람 복사본"으로 읽힌다.

   텍스처를 17장으로 늘리는 대신 자국만 개인 시드에서 셰이더로 얹는다.
   (17장 베이킹은 asian_old_female.png 하나가 4.7MB라 배포 용량이 3배가 되고,
   그러고도 원본 6장의 변주일 뿐이다.)

   ⚠ 마스크는 전부 **눈·입 랜드마크 기준 오브젝트 공간**이다. UV 좌표나 색
   임계값으로 얼굴 부위를 특정하려던 시도는 구강 붉은 띠에서 두 번 실패했다
   (아래 roughnessmap_fragment 주석 참고) — 같은 실수를 반복하지 마라.
   고주파 잡음(수염 그루터기·주근깨 알갱이)에만 UV를 쓴다. 그건 위치에
   의미가 없는 순수 노이즈라 레이아웃과 무관하다. */
interface PatientSkinDetail {
  /** 점 배치 시드. 셰이더가 여기서 최대 3개의 위치·크기·유무를 뽑는다. */
  moleSeed: number
  /** 주근깨 농도. 대부분 0이고 일부만 뚜렷하다. */
  freckles: number
  /** 수염 자국. 성인 남성만 0보다 크다. */
  beard: number
  /** 볼·코 홍조. */
  flush: number
}

function patientSkinDetail(
  variant: string,
  chronologicalAge: number | undefined,
  identitySeed: number,
): PatientSkinDetail {
  // 사진 피부에는 점·수염 자국이 이미 있다. 셰이더로 또 찍으면 이중으로 나온다.
  if (PHOTO_SKIN_VARIANTS.has(variant)) return { moleSeed: 0, freckles: 0, beard: 0, flush: 0 }
  // identitySeed 하나에서 서로 독립적인 값을 뽑는다(같은 해시를 재사용하면
  // 점이 많은 사람이 항상 수염도 짙은 식으로 특성이 붙어 다닌다).
  const sub = (salt: number) => {
    const value = Math.sin(identitySeed * 127.1 + salt * 311.7) * 43758.5453
    return value - Math.floor(value)
  }
  const male = /mh_(?:m\d|youngm|oldm|boy)/.test(variant)
  const age = chronologicalAge ?? variantApproximateAge(variant)
  const adultMale = male && age >= 17

  /* 주근깨는 **젊은 얼굴에서만** 자연스럽다. 나이 제한 없이 굴렸더니 하필
     m30·m50·m60 세 중년 남성에게만 걸렸고, 수염 자국과 겹쳐서 주근깨가 아니라
     때나 여드름으로 보였다. 40대 미만으로 제한하고 농도도 낮춘다. */
  const freckleRoll = sub(11)
  return {
    moleSeed: sub(4),
    // 한국인에게 주근깨가 흔하지는 않다 — 젊은 축에서 소수만, 그것도 옅게.
    freckles: age < 38 && freckleRoll > 0.66 ? 0.22 + (freckleRoll - 0.66) * 0.95 : 0,
    // 수염 자국은 성인 남성의 인상을 가장 크게 가르는 요소인데 지금까지 전혀
    // 없었다. 사춘기 전에는 0, 고령에서는 옅어진다.
    beard: adultMale
      ? (0.34 + sub(2) * 0.52) * (1 - THREE.MathUtils.smoothstep(age, 62, 88) * 0.35)
      : 0,
    flush: 0.22 + sub(3) * 0.6,
  }
}

function meshBox(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox()
  return mesh.geometry.boundingBox?.clone() ?? new THREE.Box3()
}

/* ── 관통(clipping) 정리 — 바인드포즈 정점을 몸통 축 기준으로 밀어 넣거나 빼낸다 ──
   스키닝은 이 좌표에서 출발하므로 자세가 바뀌어도 유지된다. 같은 GLB를 여러 인스턴스가
   공유(SkeletonUtils.clone은 지오메트리를 공유)하므로 지오메트리에 표시를 남겨 한 번만 적용한다. */
const RADIAL_BINS = 24

function angleBin(x: number, z: number, cx: number, cz: number): number {
  const a = Math.atan2(z - cz, x - cx) + Math.PI
  return Math.min(RADIAL_BINS - 1, Math.floor((a / (Math.PI * 2)) * RADIAL_BINS))
}

/** 메시 묶음에서 [y0,y1] 밴드의 방위각별 최대 반경을 구한다. 없으면 -1. */
function maxRadiusByBin(
  meshes: THREE.Mesh[],
  y0: number,
  y1: number,
  cx: number,
  cz: number,
): Float32Array {
  const bins = new Float32Array(RADIAL_BINS).fill(-1)
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    if (!position) continue
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i)
      if (y < y0 || y > y1) continue
      const x = position.getX(i)
      const z = position.getZ(i)
      const r = Math.hypot(x - cx, z - cz)
      const bin = angleBin(x, z, cx, cz)
      if (r > bins[bin]) bins[bin] = r
    }
  }
  return bins
}

/** [y0,y1] 밴드에 있는 정점들의 평균 반경. 정점이 없으면 -1. */
function meanRadiusInBand(
  meshes: THREE.Mesh[],
  y0: number,
  y1: number,
  cx: number,
  cz: number,
): number {
  let sum = 0
  let count = 0
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    if (!position) continue
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i)
      if (y < y0 || y > y1) continue
      sum += Math.hypot(position.getX(i) - cx, position.getZ(i) - cz)
      count++
    }
  }
  return count ? sum / count : -1
}

/**
 * 상의 밑으로 하의 허리밴드가 뚫고 나오는 것을 없앤다 (mh_m60: 빨간 니트를 가로지르는 진회색 띠).
 * 상의를 부풀리면 셔츠를 바지에 넣어 입은 아바타(m40)가 반대로 터지므로, **겉옷이 바깥일 때만**
 * 하의 허리 쪽 정점을 안으로 당긴다. 겉/속 판정은 허리밴드 **아래** 밴드의 반경 비교로 한다.
 */
/**
 * 겨드랑이에 여유를 준다 — 앉은 자세에서 흰 상의에 생기던 **어두운 깃털 얼룩**의
 * 남은 절반이다.
 *
 * 팔을 내리면 소매 겨드랑이 폴리곤과 몸통 옆면이 거의 겹쳐 서로를 뚫고
 * 접힌다(`?nopost=1` 로 후처리를 끄고 보면 음영이 아니라 접힌 조각이다).
 * 포즈에서 팔을 띄워(0.16 → 0.28) 크게 줄였지만, 원인이 두 면의 **간격 부족**
 * 이라 자세만으로는 남는다. 여기서 바인드 포즈 정점을 바깥으로 밀어 간격을
 * 만든다 — 스키닝이 이 좌표에서 출발하므로 어떤 자세에서도 유지된다.
 *
 * ⚠ 많이 밀면 겨드랑이가 부풀어 옷이 뜬다. 6mm 가 상한이고, 값을 만졌으면
 * 반드시 **진료실 씬 앉은 자세**에서 확대해 확인해라(AvatarLab 은 선 자세라
 * 이 결함이 아예 안 나타난다 — 그래서 오래 못 찾았다).
 */
const ARMPIT_RELIEF = 0.006

function relieveArmpit(uppers: THREE.Mesh[]): void {
  const pending = uppers.filter((mesh) => !mesh.geometry.userData.patientArmpitRelieved)
  if (!pending.length) return

  const box = new THREE.Box3()
  for (const mesh of pending) box.union(meshBox(mesh))
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  if (!(size.y > 0.1) || !(size.x > 0.1)) return

  // 어깨 바로 아래부터 가슴 중간까지가 겨드랑이 구간이다.
  const topY = box.max.y - size.y * 0.08
  const bottomY = box.max.y - size.y * 0.34
  const halfWidth = size.x * 0.5

  for (const mesh of pending) {
    mesh.geometry.userData.patientArmpitRelieved = true
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) continue
    for (let index = 0; index < position.count; index++) {
      const y = position.getY(index)
      if (y < bottomY || y > topY) continue
      const x = position.getX(index)
      const lateral = Math.abs(x - center.x) / halfWidth
      // 몸통 옆면(바깥 30%)에만 준다. 가슴 정면은 건드리면 옷이 부푼다.
      if (lateral < 0.62) continue
      const band = Math.sin(((y - bottomY) / (topY - bottomY)) * Math.PI)
      const push = ARMPIT_RELIEF * band * THREE.MathUtils.smoothstep(lateral, 0.62, 1)
      position.setX(index, x + Math.sign(x - center.x) * push)
    }
    position.needsUpdate = true
    mesh.geometry.computeVertexNormals()
  }
}

function tuckLowerGarmentWaist(uppers: THREE.Mesh[], lowers: THREE.Mesh[]): void {
  if (!uppers.length || !lowers.length) return
  const pending = lowers.filter((mesh) => !mesh.geometry.userData.patientWaistTucked)
  if (!pending.length) return
  const lowerBox = new THREE.Box3()
  for (const mesh of lowers) lowerBox.union(meshBox(mesh))
  const center = lowerBox.getCenter(new THREE.Vector3())
  const waistTop = lowerBox.max.y
  /* 겉/속 판정: 허리밴드가 걸치는 밴드에서 **평균 반경**을 비교한다.
     칸별 최댓값을 세면 관통해 튀어나온 밴드 때문에 판정이 뒤집힌다(mh_m60에서 실제로 그랬다). */
  const probeLow = waistTop - 0.13
  const probeHigh = waistTop - 0.02
  const upperMean = meanRadiusInBand(uppers, probeLow, probeHigh, center.x, center.z)
  const lowerMean = meanRadiusInBand(lowers, probeLow, probeHigh, center.x, center.z)
  if (import.meta.env.DEV) {
    console.info(
      `[patient-garment] waist tuck probe upper=${upperMean.toFixed(4)} lower=${lowerMean.toFixed(4)}`
      + ` waistTop=${waistTop.toFixed(3)}`,
    )
  }
  // 셔츠를 바지에 넣어 입은 형태(상의가 안쪽)면 건드리지 않는다 — 건드리면 셔츠가 터져 나온다.
  if (upperMean < 0 || lowerMean < 0 || upperMean <= lowerMean) return
  const bandLow = waistTop - 0.20
  const upperBins = maxRadiusByBin(uppers, bandLow, waistTop + 0.01, center.x, center.z)
  for (const mesh of pending) {
    mesh.geometry.userData.patientWaistTucked = true
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    let moved = 0
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i)
      if (y < bandLow) continue
      const x = position.getX(i)
      const z = position.getZ(i)
      const limit = upperBins[angleBin(x, z, center.x, center.z)]
      if (limit < 0) continue
      const r = Math.hypot(x - center.x, z - center.z)
      const target = limit - 0.016 // 니트 두께만큼 확실히 안쪽으로
      if (r <= target || r < 1e-5) continue
      // 밴드 아래 경계에서 0 → 허리선에서 100%로 램프를 줘 접히는 자국이 생기지 않게 한다.
      const ramp = THREE.MathUtils.smoothstep(y, bandLow, waistTop - 0.02)
      const scale = (target / r - 1) * ramp + 1
      position.setX(i, center.x + (x - center.x) * scale)
      position.setZ(i, center.z + (z - center.z) * scale)
      moved++
    }
    if (moved) {
      position.needsUpdate = true
      mesh.geometry.computeBoundingBox()
      mesh.geometry.computeBoundingSphere()
    }
    if (import.meta.env.DEV) {
      console.info(`[patient-garment] waist tuck ${mesh.name} moved=${moved}`)
    }
  }
}

const BOB_SEAM_UNDERLAY_SUFFIX = '__bob_seam_underlay'

/**
 * toigo bob 카드에는 좌우 턱 높이에 1px짜리 실제 지오메트리 틈이 있다. 별도 쿼드로
 * 막으면 흰 선이 검은 선으로만 바뀐다. 같은 헤어를 좌우·상하로 엇갈린 두 겹으로
 * 두면 원본 틈은 언더레이의 정상 모발 면이, 언더레이 틈은 원본/반대 레이어가 덮는다.
 */
function addBobHairSeamUnderlay(mesh: THREE.Mesh): void {
  if (mesh.parent?.getObjectByName(`${mesh.name}${BOB_SEAM_UNDERLAY_SUFFIX}_a`)) return
  const skinned = mesh as unknown as THREE.SkinnedMesh
  if (!skinned.isSkinnedMesh) return
  const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
    THREE.MeshStandardMaterial | undefined
  if (!source?.map) return

  const shifts = [
    { suffix: 'a', x: 0.0023, y: -0.0033, z: 0.0030 },
    { suffix: 'b', x: -0.0023, y: 0.0033, z: 0.0022 },
  ]
  for (const shift of shifts) {
    const material = source.clone()
    material.name = `${source.name}${BOB_SEAM_UNDERLAY_SUFFIX}_${shift.suffix}`
    material.transparent = false
    material.depthWrite = true
    material.alphaTest = Math.max(0.18, source.alphaTest)
    material.side = THREE.DoubleSide

    const underlay = new THREE.SkinnedMesh(mesh.geometry, material)
    underlay.bind(skinned.skeleton, skinned.bindMatrix)
    underlay.bindMode = skinned.bindMode
    underlay.name = `${mesh.name}${BOB_SEAM_UNDERLAY_SUFFIX}_${shift.suffix}`
    underlay.position.copy(mesh.position)
    underlay.position.x += shift.x
    underlay.position.y += shift.y
    // 교수자 구강 카메라에서는 밝은 목 피부가 뒤쪽 헤어보다 앞에 온다.
    underlay.position.z += shift.z
    underlay.quaternion.copy(mesh.quaternion)
    underlay.scale.copy(mesh.scale)
    underlay.castShadow = false
    underlay.receiveShadow = false
    underlay.frustumCulled = false
    underlay.renderOrder = (mesh.renderOrder || 0) - 1
    underlay.userData.patientRuntimeUniforms = mesh.userData.patientRuntimeUniforms
    mesh.parent?.add(underlay)
  }
}

/**
 * 긴 머리 알파 카드가 상의를 뚫고 나와 가슴·등에 너덜너덜한 검은 얼룩을 만드는 것을 없앤다
 * (mh_f20_thin: 흰 티셔츠 위로 머리카락 가닥이 그대로 비친다).
 * 어깨선 아래로 흘러내린 부분만 몸통 축에서 바깥으로 밀어 옷 **위에** 얹히게 한다.
 */
function liftLongHairOverGarment(
  hairMeshes: THREE.Mesh[],
  shoulderY: number,
  bodyCenterZ: number,
): void {
  for (const mesh of hairMeshes) {
    const preserveBobSilhouette = /bob/i.test(mesh.name)
    const box = meshBox(mesh)
    if (mesh.geometry.userData.patientHairLifted) continue
    mesh.geometry.userData.patientHairLifted = true
    const center = box.getCenter(new THREE.Vector3())
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    /* ① 앞으로 흘러내린 가닥은 아예 지운다.
       옷 위로 밀어내 봐야 납작한 알파 카드가 가슴에 검은 얼룩으로 얹힐 뿐이라,
       실제 게임 캐릭터가 흔히 그러듯 **어깨 뒤로 넘긴** 머리로 만든다.
       (인덱스 버퍼에서 해당 삼각형만 빼므로 정점/모프/스킨 데이터는 그대로다) */
    const index = mesh.geometry.getIndex()
    /* toigo bob은 어깨 위에서 끝나는 완성된 앞머리 실루엣이다.
       긴 머리용 수평 절단을 같이 적용하면 입 높이에서 삼각형이
       연속으로 사라져 밝은 배경이 가로 흰줄로 비쳤다. bob은 절단하지 않고
       아래의 밖쪽 밀기만 적용한다. */
    if (index && !preserveBobSilhouette) {
      const cutY = shoulderY + 0.06
      const cutZ = bodyCenterZ - 0.035
      const kept: number[] = []
      let dropped = 0
      for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t)
        const b = index.getX(t + 1)
        const c = index.getX(t + 2)
        // 삼각형 무게중심으로 판정한다. '세 정점 모두'로 하면 어깨를 넘어오는 카드가
        // 절반만 잘려 되레 각진 검은 조각이 남는다.
        const cy = (position.getY(a) + position.getY(b) + position.getY(c)) / 3
        const cz = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3
        if (cy < cutY && cz > cutZ) { dropped++; continue }
        kept.push(a, b, c)
      }
      if (dropped) {
        mesh.geometry.setIndex(kept)
        if (import.meta.env.DEV) {
          console.info(`[patient-hair] trimmed front strands ${mesh.name} tris=${dropped}`)
        }
      }
    }
    // ② 남은(뒤로 넘어간) 가닥은 몸통 축에서 바깥으로 밀어 상의 **위에** 얹히게 한다.
    let moved = 0
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i)
      if (y > shoulderY) continue
      const x = position.getX(i)
      const z = position.getZ(i)
      const r = Math.hypot(x - center.x, z - center.z)
      if (r < 1e-4) continue
      // 어깨선에서 0 → 그 아래 10cm에서 최대(2.2cm)로 밀어낸다.
      const push = 0.022 * THREE.MathUtils.smoothstep(shoulderY - y, 0, 0.1)
      const scale = (r + push) / r
      position.setX(i, center.x + (x - center.x) * scale)
      position.setZ(i, center.z + (z - center.z) * scale)
      moved++
    }
    if (moved) {
      position.needsUpdate = true
      mesh.geometry.computeBoundingBox()
      mesh.geometry.computeBoundingSphere()
    }
  }
}

function skinFrontInBand(
  root: THREE.Group,
  minY: number,
  maxY: number,
  fallback: number,
): number {
  let front = Number.NEGATIVE_INFINITY
  const point = new THREE.Vector3()
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (!materials.some((material) => materialKind(mesh.name, material.name) === 'skin')) return
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) return
    for (let index = 0; index < position.count; index++) {
      // getVertexPosition은 비만/마른 체형 morph와 스키닝이 적용된 실제 표면을 돌려준다.
      mesh.getVertexPosition(index, point)
      if (point.y >= minY && point.y <= maxY) front = Math.max(front, point.z)
    }
  })
  return Number.isFinite(front) ? front : fallback
}

/* ── 시각 소견(결막 창백 / 갑상샘 종대 / 위축성 설염) 앵커 측정 ──────────────
   황달은 이미 있는 눈 재질을 틴트하면 끝나지만, 나머지 셋은 모델에 아예 없는
   구조물을 새로 그려야 한다. 눈·혀·목의 실제 높이는 아바타마다 다르므로
   (mh_f30 눈 y=1.397 / mh_m40 눈 y=1.511) 좌표를 상수로 박으면 반드시 어긋난다.
   로드된 메시에서 직접 재서 '머리 본 기준 상대 오프셋'으로 저장하고,
   렌더할 때는 매 프레임 머리 본(ClinicScene가 쓰는 PATIENT_HEAD_WORLD와 같은 본)에
   앵커를 붙인다. 그래서 키·자세가 달라도 위치가 따라온다. */
interface SkinSurfaceWindow {
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** 해당 창에 피부 정점이 하나도 없을 때 쓸 값 */
  fallback: number
}

/* 지정한 창들 안에서 피부 표면의 가장 앞쪽(z 최대)을 정점 1회 순회로 모두 구한다.
   skinFrontInBand는 좌우 제한이 없어 같은 높이의 어깨·팔·코가 섞여 들어오므로 따로 둔다. */
function skinFrontInWindows(root: THREE.Object3D, windows: SkinSurfaceWindow[]): number[] {
  const fronts = windows.map(() => Number.NEGATIVE_INFINITY)
  const point = new THREE.Vector3()
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (!materials.some((material) => material && materialKind(mesh.name, material.name) === 'skin')) return
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) return
    for (let index = 0; index < position.count; index++) {
      // getVertexPosition은 체형 morph와 스키닝이 적용된 실제 표면을 돌려준다.
      mesh.getVertexPosition(index, point)
      for (let slot = 0; slot < windows.length; slot++) {
        const win = windows[slot]
        if (point.x < win.minX || point.x > win.maxX) continue
        if (point.y < win.minY || point.y > win.maxY) continue
        if (point.z > fronts[slot]) fronts[slot] = point.z
      }
    }
  })
  return fronts.map((front, index) => (Number.isFinite(front) ? front : windows[index].fallback))
}

/* 같은 재질 종류를 쓰는 메시들의 지오메트리 바운딩 합집합.
   혀·치아는 모프 타깃이 없어(ARKit 모프는 얼굴 메시에만 있다) 바인드 포즈 값이 곧 실제 위치다. */
function kindGeometryBox(root: THREE.Object3D, kind: PatientMaterialKind): THREE.Box3 | null {
  const box = new THREE.Box3()
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (!materials.some((material) => material && materialKind(mesh.name, material.name) === kind)) return
    box.union(meshBox(mesh))
  })
  return box.isEmpty() ? null : box
}

/* 결막 띠는 안구 곡률을 따라 감싸는 얇은 구각(球殼)이다. 평면을 쓰면 눈에서 들뜬다.
   theta는 +y에서 잰 각이라 π/2보다 크면 적도 아래 = 아래눈꺼풀 쪽. */
const CONJUNCTIVA_PHI_LENGTH = 1.5
/* 결막은 안구 적도 바로 아래의 얇은 띠다. 종전 +0.42rad/0.36rad는 눈 중심에서
   1cm 넘게 내려와 고개를 숙인 환자에서 뺨의 붉은 스티커처럼 보였다. */
const CONJUNCTIVA_THETA_START = Math.PI / 2 + 0.06
const CONJUNCTIVA_THETA_LENGTH = 0.30
/** 띠에서 가장 앞으로 나온 지점의 z 비율 — 이 값으로 중심을 뒤로 빼 피부 위에 얹는다. */
const CONJUNCTIVA_FRONT_RATIO = Math.sin(CONJUNCTIVA_THETA_START)

const SIGN_COLOR = {
  /* 아래눈꺼풀 결막: 정상은 모세혈관이 비쳐 붉은 분홍, 창백은 혈색이 빠진 회분홍 */
  conjunctivaNormal: '#e07a72',
  conjunctivaPale: '#e8c4bd',
  /* 위축성 설염: 사상유두가 소실돼 매끈하고 창백해진 혀 */
  tongueAtrophic: '#d9a8a0',
  /* 스킨 텍스처를 아직 못 읽었을 때 쓸 갑상샘 융기 색 (아시아 피부 텍스처 평균값) */
  skinFallback: '#ce9d7d',
} as const

interface VisualSignAnchors {
  /** 아래 셋 모두 머리 본 기준 상대 오프셋 (모델 공간: +x 환자 왼쪽, +y 위, +z 얼굴 앞).
   *  x는 정중선 위치 — 머리 본이 정확히 정중선에 있지 않은 골격도 있어 따로 담는다. */
  conjunctiva: { midX: number; halfGap: number; y: number; z: number; scale: THREE.Vector3 } | null
  goiter: { x: number; y: number; z: number; radius: THREE.Vector3; swallowLift: number } | null
  tongue: { x: number; y: number; z: number; radius: THREE.Vector3 } | null
  oral: { x: number; y: number; z: number; radius: THREE.Vector2 } | null
}

function measureVisualSignAnchors(
  model: THREE.Group,
  headBone: THREE.Bone | undefined,
  neckBone: THREE.Bone | undefined,
  leftClavicleBone: THREE.Bone | undefined,
  rightClavicleBone: THREE.Bone | undefined,
): VisualSignAnchors {
  if (!headBone) return { conjunctiva: null, goiter: null, tongue: null, oral: null }
  model.updateMatrixWorld(true)
  // 본 월드좌표 → 모델 공간. 지오메트리 좌표와 같은 공간이라야 오프셋을 뺄 수 있다.
  const head = model.worldToLocal(headBone.getWorldPosition(new THREE.Vector3()))
  const neck = neckBone
    ? model.worldToLocal(neckBone.getWorldPosition(new THREE.Vector3()))
    : new THREE.Vector3(head.x, head.y - 0.095, head.z)
  const neckLength = Math.max(0.05, head.y - neck.y)

  const landmarks = findMpfbFaceLandmarks(model)
  const halfGap = Math.max(
    0.012,
    (Math.abs(landmarks.eyeLeft.x) + Math.abs(landmarks.eyeRight.x)) * 0.5,
  )
  const eyeY = (landmarks.eyeLeft.y + landmarks.eyeRight.y) * 0.5
  const eyeHalfHeight = Math.max(0.008, landmarks.eyeRadius.y)
  const eyeHalfWidth = Math.max(0.012, landmarks.eyeRadius.x)
  /* 갑상샘 높이를 목 '본' 길이로 잡으면 안 된다. neck 본은 C7 근처(목 뒤 아래)라
     그 위 36% 지점이 턱 밑에 걸린다(mh_f30 기준 y=1.300 = 아래 치아 높이).
     실제로 보이는 목은 '턱 아래선 ~ 흉골상절흔'이므로 치아 메시에서 턱 끝을 잡아 기준으로 쓴다. */
  const teethBox = kindGeometryBox(model, 'teeth')
  const chinY = teethBox ? teethBox.min.y - 0.014 : head.y - neckLength * 0.62
  const leftClavicle = leftClavicleBone
    ? model.worldToLocal(leftClavicleBone.getWorldPosition(new THREE.Vector3()))
    : null
  const rightClavicle = rightClavicleBone
    ? model.worldToLocal(rightClavicleBone.getWorldPosition(new THREE.Vector3()))
    : null
  const suprasternalY = leftClavicle && rightClavicle
    ? (leftClavicle.y + rightClavicle.y) * 0.5
    : neck.y - 0.025
  const throatSpan = THREE.MathUtils.clamp(chinY - suprasternalY, 0.065, 0.16)
  const goiterY = chinY - throatSpan * 0.66

  const [lidFront, neckFront] = skinFrontInWindows(model, [
    {
      // 아래눈꺼풀~광대 위쪽 피부. 결막 띠를 이 표면보다 살짝 앞에 둬야 뺨에 파묻히지 않는다.
      minX: halfGap - eyeHalfWidth * 0.5,
      maxX: halfGap + eyeHalfWidth * 0.5,
      minY: eyeY - eyeHalfHeight * 1.5,
      maxY: eyeY - eyeHalfHeight * 0.4,
      fallback: landmarks.eyeLeft.z + eyeHalfHeight + 0.004,
    },
    {
      // 목 앞면. 융기를 이 표면에 절반쯤 묻어야 '부푼 목'으로 보이고 공처럼 떠 있지 않다.
      // y 폭을 좁게 잡아 턱(훨씬 앞으로 나온 면)이 섞여 들어오지 않게 한다.
      minX: -0.03,
      maxX: 0.03,
      minY: goiterY - throatSpan * 0.22,
      maxY: goiterY + throatSpan * 0.22,
      fallback: neck.z + throatSpan * 1.8,
    },
  ])

  // 결막은 안구 중심의 큰 구각이 아니라, 아래눈꺼풀을 당겼을 때 보이는
  // 3~5mm 두께의 얇은 띄다. 8mm 최소치는 홍채 밑에 살덩이가 붙은 모양을 만들었다.
  const bandRadius = Math.max(0.004, eyeHalfHeight * 0.46)
  const goiterRadius = new THREE.Vector3(
    throatSpan * 1.05,  // 좌·우엽을 함께 덮는 미만성 종대 — 목 폭과 비슷한 가로
    throatSpan * 0.48,
    throatSpan * 0.62,
  )

  const tongueBox = kindGeometryBox(model, 'tongue')
  let tongue: VisualSignAnchors['tongue']
  if (tongueBox) {
    const size = tongueBox.getSize(new THREE.Vector3())
    const radius = new THREE.Vector3(size.x * 0.53, 0.008, size.z * 0.36)
    tongue = {
      // 실제 혀 등(dorsum) 위에 살짝 얹어 앞쪽 2/3만 덮는다. 뒤로 빼면 치아에 가려 안 보인다.
      x: -head.x,
      y: tongueBox.max.y - 0.005 - head.y,
      z: tongueBox.max.z - radius.z * 0.75 - head.z,
      radius,
    }
  } else {
    // 혀 메시가 없는 아바타(구형 Rocketbox 등)는 치아에서 잡은 입 중심으로 근사한다.
    const radius = new THREE.Vector3(Math.max(0.014, landmarks.mouthRadius.x * 0.52), 0.007, 0.02)
    tongue = {
      x: -head.x,
      y: landmarks.mouthCenter.y - 0.006 - head.y,
      z: landmarks.mouthCenter.z - radius.z * 0.9 - head.z,
      radius,
    }
  }

  return {
    conjunctiva: {
      midX: -head.x,
      halfGap,
      y: eyeY - eyeHalfHeight * 0.52 - head.y,
      // 띠의 가장 앞점이 눈꺼풀 피부보다 1.5mm 앞에 오도록 중심을 뒤로 뺀다.
      // 측정이 코·광대에 오염돼도 눈에서 떨어져 떠 보이지 않게 안구 중심 근처로 클램프한다.
      z: THREE.MathUtils.clamp(
        lidFront + 0.0015 - bandRadius * CONJUNCTIVA_FRONT_RATIO,
        landmarks.eyeLeft.z - 0.003,
        landmarks.eyeLeft.z + 0.005,
      ) - head.z,
      scale: new THREE.Vector3(eyeHalfWidth * 0.96, bandRadius, bandRadius),
    },
    goiter: {
      x: -head.x,
      y: goiterY - head.y,
      z: neckFront - goiterRadius.z * 0.5 - head.z,
      radius: goiterRadius,
      // 실제 연하 시 후두 거상은 2~3cm지만, 이 모델의 '보이는 목'은 3cm 남짓이라
      // 그대로 주면 융기가 턱을 뚫는다. 목 길이에 비례시켜 같은 인상만 남긴다.
      swallowLift: throatSpan * 0.55,
    },
    tongue,
    oral: {
      x: landmarks.mouthCenter.x - head.x,
      y: landmarks.mouthCenter.y - head.y - 0.002,
      // 입술/치아보다 안쪽. 얼굴 메시가 타원을 자연스럽게 가려 입 밖으로 번지지 않는다.
      z: landmarks.mouthCenter.z - head.z - 0.014,
      radius: new THREE.Vector2(
        THREE.MathUtils.clamp(landmarks.mouthRadius.x * 0.58, 0.021, 0.030),
        THREE.MathUtils.clamp(landmarks.mouthRadius.y * 1.05, 0.024, 0.033),
      ),
    },
  }
}

/* 갑상샘 융기는 목 피부의 일부라 피부와 같은 색이어야 한다. 그런데 피부 재질의 color는
   맵과 곱해지도록 흰색으로 중립화돼 있어(tunePatientMaterial 참조) 그대로 쓸 수 없다.
   그래서 스킨 텍스처의 평균색을 뽑아 쓴다. 텍스처는 비동기로 도착하므로 성공할 때까지 재시도한다. */
function averageSkinTone(root: THREE.Object3D): THREE.Color | null {
  if (typeof document === 'undefined') return null
  const found: { map: THREE.Texture | null } = { map: null }
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material || materialKind(mesh.name, material.name) !== 'skin') continue
      const candidate = (material as THREE.MeshStandardMaterial).map
      if (candidate?.image) found.map = candidate
    }
  })
  const image = found.map?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined
  if (!image?.width || !image.height) return null
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  try {
    context.drawImage(image, 0, 0, 8, 8)
    const { data } = context.getImageData(0, 0, 8, 8)
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 8) continue // 투명 여백 제외
      r += data[index]
      g += data[index + 1]
      b += data[index + 2]
      count++
    }
    if (!count) return null
    // 텍스처는 sRGB 인코딩이다. 색공간을 명시하지 않으면 선형값으로 읽혀 허옇게 뜬다.
    return new THREE.Color().setRGB(r / count / 255, g / count / 255, b / count / 255, THREE.SRGBColorSpace)
  } catch {
    return null // 캔버스 오염 등 — 폴백 색을 그대로 쓴다
  }
}

/**
 * 눈·치아 메시에서 얼굴 기준점을 자동 산출한다.
 * MPFB는 양쪽 눈이 한 메시, VALID는 눈이 각각 별도 메시라 모든 후보의 정점을 합산한다.
 */
function findMpfbFaceLandmarks(root: THREE.Group): MpfbFaceLandmarks {
  const eyeMeshes = new Set<THREE.Mesh>()
  const teethMeshes = new Set<THREE.Mesh>()
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const kind = materialKind(mesh.name, material.name)
      if (kind === 'eye') eyeMeshes.add(mesh)
      if (kind === 'teeth') teethMeshes.add(mesh)
    }
  })

  const fallback: MpfbFaceLandmarks = {
    eyeLeft: new THREE.Vector3(0.025, 1.397, 0.115),
    eyeRight: new THREE.Vector3(-0.025, 1.397, 0.115),
    eyeRadius: new THREE.Vector2(0.021, 0.014),
    mouthCenter: new THREE.Vector3(0, 1.334, 0.124),
    mouthRadius: new THREE.Vector2(0.042, 0.022),
  }
  const positive = new THREE.Box3()
  const negative = new THREE.Box3()
  const point = new THREE.Vector3()
  for (const eyeMesh of eyeMeshes) {
    const position = eyeMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) continue
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index)
      ;(point.x >= 0 ? positive : negative).expandByPoint(point)
    }
  }
  if (positive.isEmpty() || negative.isEmpty()) return fallback

  const posSize = positive.getSize(new THREE.Vector3())
  const negSize = negative.getSize(new THREE.Vector3())
  const eyeLeft = positive.getCenter(new THREE.Vector3())
  const eyeRight = negative.getCenter(new THREE.Vector3())
  const eyeRadius = new THREE.Vector2(
    Math.max(posSize.x, negSize.x) * 0.5,
    Math.max(posSize.y, negSize.y) * 0.5,
  )

  let mouthCenter = fallback.mouthCenter.clone()
  let mouthRadius = fallback.mouthRadius.clone()
  const teeth = new THREE.Box3()
  for (const teethMesh of teethMeshes) teeth.union(meshBox(teethMesh))
  if (!teeth.isEmpty()) {
    const size = teeth.getSize(new THREE.Vector3())
    mouthCenter = teeth.getCenter(new THREE.Vector3())
    mouthCenter.y += size.y * 0.11
    mouthCenter.z = teeth.max.z
    mouthRadius = new THREE.Vector2(
      Math.max(eyeRadius.x * 1.62, size.x * 0.72),
      Math.max(eyeRadius.y * 1.24, size.y * 0.46),
    )
  }
  return { eyeLeft, eyeRight, eyeRadius, mouthCenter, mouthRadius }
}

function setTextureDetail(material: THREE.Material, maxAnisotropy: number) {
  if (!isStandardMaterial(material)) return
  for (const texture of [
    material.map,
    material.normalMap,
    material.roughnessMap,
    material.metalnessMap,
    material.alphaMap,
  ]) {
    if (!texture) continue
    texture.anisotropy = Math.min(12, maxAnisotropy)
    // GLTFLoader가 최초 업로드할 때 anisotropy를 읽으므로 needsUpdate를 강제하지 않는다.
    // 디코딩 중인 placeholder를 갱신하면 검은 프레임과 반복 경고가 발생할 수 있다.
  }
}

function materialKind(meshName: string, materialName: string): PatientMaterialKind {
  const id = `${meshName} ${materialName}`.toLowerCase()
  if (id.includes('asianskin') || id.includes('patient_skin') || id.includes('h_dds_highres')) return 'skin'
  if (
    id.includes('high-poly')
    || id.includes('brown_eye')
    || /h_[lr]_eye/.test(id)
  ) return 'eye'
  if (id.includes('eyebrow')) return 'brow'
  if (id.includes('eyelash')) return 'lash'
  if (id.includes('teeth')) return 'teeth'
  if (id.includes('tongue') || id.includes('gland')) return 'tongue'
  if (/(hair|alpha7|ponytail|braid|curled|bob|maxwell|grump|culturalibre)/.test(id)) return 'hair'
  return 'fabric'
}

/** 헤어 메시마다 블렌딩 프린지 패스를 하나 더 붙인다(위 2패스 설명 참고).
 *  지오메트리 수술(`liftLongHairOverGarment` 등)이 **끝난 뒤** 불러야 한다 —
 *  프린지는 같은 지오메트리를 공유하므로, 그 전에 붙이면 교체된 지오메트리를 놓친다. */
function addHairFringePasses(root: THREE.Object3D): void {
  /* ⚠ `?hideKind=hair` 는 이 함수보다 **먼저** 돌기 때문에 코어 메시만 숨긴다.
     프린지는 그 뒤에 새로 만들어지므로 그대로 남고, 알파컷이 0.02 라 머리
     거의 전체를 그린다 — 그래서 "hideKind 가 아예 안 듣는다"로 보였고
     헤어 격리가 통째로 불가능했다(2026-08-03). 여기서 같이 막는다. */
  if (hiddenKinds.has('hair')) return
  const hairMeshes: THREE.Mesh[] = []
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || mesh.name.endsWith(HAIR_FRINGE_SUFFIX)) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some((m) => m && materialKind(mesh.name, m.name) === 'hair')) hairMeshes.push(mesh)
  })
  for (const mesh of hairMeshes) {
    const core = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      THREE.MeshStandardMaterial | undefined
    /* toigo bob은 긴 머리 판정을 통과하지 않으므로 프린지 생성 단계에서 따로
       아래 레이어를 붙여 카드의 수평 틈을 서로 엇갈리게 가린다. */
    if (/bob/i.test(mesh.name)) {
      addBobHairSeamUnderlay(mesh)
    }
    // 알파 맵이 없으면 자를 것도 없다 — 프린지가 통짜 반투명 셸이 되어 오히려 해롭다.
    if (!core?.map) continue
    const fringe = core.clone() as THREE.MeshStandardMaterial
    fringe.alphaTest = HAIR_FRINGE_ALPHA_TEST
    fringe.transparent = true
    fringe.depthWrite = false
    fringe.depthFunc = THREE.LessDepth
    fringe.side = THREE.DoubleSide
    // 셰이더 주입(흰머리·가닥 결)은 clone 이 그대로 물려받되, 프로그램 캐시는 갈라야 한다.
    /* ⚠ 머리 실루엣을 따라 찍히는 흰 점(밝은 옷이 비침)은 **텍스처의 진짜 구멍**이다.
       가닥 끝 사이 텍셀이 알파 0 이라 코어도 프린지도 그릴 것이 없다.
       2026-08-03 에 배제한 것: 정렬(옷 불투명화) · sheen/노멀 · 알파컷 스윕 ·
       후처리 · 프린지 알파 pow 부스트(알파 0.0008 까지 렌더되게 해도 무변화 —
       이것이 '알파 0 구멍' 판정의 근거다). 셰이더로는 못 메운다.
       줄이려면 텍스처를 인페인트하거나 해상도(dpr)를 올려야 한다. */
    const coreCacheKey = core.customProgramCacheKey?.bind(core)
    fringe.customProgramCacheKey = () => `${coreCacheKey ? coreCacheKey() : 'hair'}-fringe`

    const skinned = mesh as unknown as THREE.SkinnedMesh
    let clone: THREE.Mesh
    if (skinned.isSkinnedMesh) {
      const fringeSkinned = new THREE.SkinnedMesh(mesh.geometry, fringe)
      // 코어와 **같은 스켈레톤**에 바인딩해야 두 패스가 한 몸으로 움직인다.
      fringeSkinned.bind(skinned.skeleton, skinned.bindMatrix)
      fringeSkinned.bindMode = skinned.bindMode
      clone = fringeSkinned
    } else {
      clone = new THREE.Mesh(mesh.geometry, fringe)
    }
    clone.name = `${mesh.name}${HAIR_FRINGE_SUFFIX}`
    clone.position.copy(mesh.position)
    clone.quaternion.copy(mesh.quaternion)
    clone.scale.copy(mesh.scale)
    // 헤어는 그림자를 만들지 않는다(알파를 무시한 섀도맵이 얼굴에 반점을 찍는다).
    clone.castShadow = false
    clone.receiveShadow = false
    clone.frustumCulled = false
    clone.renderOrder = (mesh.renderOrder || 0) + 1
    clone.userData.patientHairFringe = true
    // 긴 머리 흔들림 유니폼을 공유해야 코어와 프린지가 같은 위상으로 움직인다.
    clone.userData.patientRuntimeUniforms = mesh.userData.patientRuntimeUniforms
    mesh.parent?.add(clone)
  }
}

type GarmentSlot = 'upper' | 'lower' | 'socks' | 'shoes'

interface GarmentMeshRecord {
  mesh: THREE.Mesh
  slot: GarmentSlot
  originalVisible: boolean
}

// Three.js scene objects are intentionally mutable. Keeping those writes outside
// React effects also makes it explicit that this is renderer state, not React state.
function setGarmentVisibility(record: GarmentMeshRecord, visible: boolean) {
  record.mesh.visible = visible
}

interface GownLayers {
  gown: THREE.SkinnedMesh | null
  gownOpen: THREE.SkinnedMesh | null
  drape: THREE.SkinnedMesh | null
}

/** 진찰 항목에 맞춰 환자복 레이어를 켜고 끈다(위와 같은 이유로 이펙트 밖에 둔다). */
function applyGownState(
  layers: GownLayers,
  visible: boolean,
  mode: 'worn' | 'lowered' | 'raised',
  clipPlane: THREE.Plane,
) {
  const { gown, gownOpen, drape } = layers
  /* 흉부는 셸을 통째로 갈아 끼운다 — 클리핑으로 잘라내면 잘린 단면이 그대로 드러나
     옷단이 없다. 앞섶 개방은 지오메트리에 재단돼 있어 경계가 피부 밑으로 말려 들어간다. */
  const chestOpen = mode === 'lowered' && gownOpen !== null
  if (gown) {
    gown.visible = visible && !chestOpen
    const material = gown.material as THREE.Material
    // 복부 진찰만 클리핑을 쓴다(아랫단을 칼돌기 위로 걷어올림).
    material.clippingPlanes = mode === 'raised' ? [clipPlane] : null
    material.clipShadows = mode === 'raised'
    material.needsUpdate = true
  }
  if (gownOpen) gownOpen.visible = visible && chestOpen
  // 드레이프는 앞섶을 열었을 때만 — 평상 목선 가운은 그쪽이 이미 유방을 덮는다.
  if (drape) drape.visible = visible && chestOpen
}

function setReplacementSkirtClipping(
  material: THREE.MeshPhysicalMaterial,
  clipped: boolean,
  planes: THREE.Plane[],
) {
  material.clippingPlanes = clipped ? planes : null
  material.clipShadows = clipped
  material.side = clipped ? THREE.DoubleSide : THREE.FrontSide
  material.needsUpdate = true
}

function setGarmentMaterialClipping(
  material: THREE.Material,
  clipped: boolean,
  planes: THREE.Plane[],
  intersectPlanes: boolean,
) {
  if (!isStandardMaterial(material)) return
  if (material.userData.patientOriginalSide === undefined) {
    material.userData.patientOriginalSide = material.side
    material.userData.patientOriginalClipIntersection = material.clipIntersection
  }
  material.clippingPlanes = clipped ? planes : null
  material.clipIntersection = clipped && intersectPlanes
  material.clipShadows = clipped
  material.side = clipped
    ? THREE.DoubleSide
    : material.userData.patientOriginalSide as THREE.Side
  material.needsUpdate = true
}

function resetGarmentMaterialClipping(material: THREE.Material) {
  if (!isStandardMaterial(material)) return
  material.clippingPlanes = null
  material.clipIntersection = material.userData.patientOriginalClipIntersection ?? false
  material.clipShadows = false
  if (material.userData.patientOriginalSide !== undefined) {
    material.side = material.userData.patientOriginalSide as THREE.Side
  }
}

/** MPFB 자산팩마다 노드 이름이 조금 달라도 의복 슬롯을 안정적으로 찾아낸다. */
function garmentSlot(mesh: THREE.Mesh): GarmentSlot | null {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const id = `${mesh.name} ${materials.map((material) => material?.name ?? '').join(' ')}`.toLowerCase()
  // 의료용 속옷/중립 바디 레이어는 외의 탈착과 별개로 항상 남긴다.
  if (/(underwear|under_layer|medical_base|brief)/.test(id)) return null
  if (/(sock|stocking)/.test(id)) return 'socks'
  if (/(shoe|sneaker|loafer|boot|slipper)/.test(id)) return 'shoes'
  if (/(pants|trouser|slacks|jeans|skirt|bottom)/.test(id)) return 'lower'
  if (/(clothing|shirt|tshirt|t-shirt|blouse|sweater|pullover|cardigan|tunic|jacket|gown|top)/.test(id)) return 'upper'
  return null
}

function isStandardMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
}

function usesAdultFemaleUniform(variant: string): boolean {
  return /^mh_(?:f(?:20|30|40|50|60|70)(?:_(?:ob|thin))?|youngf|oldf)$/.test(variant)
}

function findSkinBodyMesh(root: THREE.Group): THREE.Mesh | null {
  let result: THREE.Mesh | null = null
  let vertexCount = 0
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (!materials.some((material) => materialKind(mesh.name, material.name) === 'skin')) return
    const count = mesh.geometry.getAttribute('position')?.count ?? 0
    if (count > vertexCount) {
      result = mesh
      vertexCount = count
    }
  })
  return result
}

interface BodySurfaceWarp {
  donor: THREE.BufferAttribute
  target: THREE.BufferAttribute
  cellSize: number
  cells: Map<string, number[]>
}

function bodyCellKey(x: number, y: number, z: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`
}

function createBodySurfaceWarp(donorRoot: THREE.Group, targetRoot: THREE.Group): BodySurfaceWarp | null {
  const donorBody = findSkinBodyMesh(donorRoot)
  const targetBody = findSkinBodyMesh(targetRoot)
  const donor = donorBody?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const target = targetBody?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!donor || !target || donor.count !== target.count) return null

  const cellSize = 0.045
  const cells = new Map<string, number[]>()
  for (let index = 0; index < donor.count; index++) {
    const key = bodyCellKey(donor.getX(index), donor.getY(index), donor.getZ(index), cellSize)
    const cell = cells.get(key)
    if (cell) cell.push(index)
    else cells.set(key, [index])
  }
  return { donor, target, cellSize, cells }
}

function nearestBodySurfaceVertex(
  warp: BodySurfaceWarp,
  x: number,
  y: number,
  z: number,
): number {
  const cx = Math.floor(x / warp.cellSize)
  const cy = Math.floor(y / warp.cellSize)
  const cz = Math.floor(z / warp.cellSize)
  let nearest = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  // 의복은 기준 몸 표면에서 1~8cm 안쪽에 있으므로, 가까운 셀부터 확장한다.
  for (let radius = 1; radius <= 3; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const candidates = warp.cells.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (!candidates) continue
          for (const index of candidates) {
            const px = warp.donor.getX(index) - x
            const py = warp.donor.getY(index) - y
            const pz = warp.donor.getZ(index) - z
            const distance = px * px + py * py + pz * pz
            if (distance < nearestDistance) {
              nearestDistance = distance
              nearest = index
            }
          }
        }
      }
    }
    if (nearest >= 0) break
  }
  return nearest
}

function refitUniformGeometry(
  source: THREE.BufferGeometry,
  warp: BodySurfaceWarp,
  slot: 'upper' | 'lower',
): THREE.BufferGeometry {
  const geometry = source.clone()
  geometry.userData.patientGeometryOwned = true
  const position = geometry.getAttribute('position') as THREE.BufferAttribute

  // glTF의 UV 경계는 동일한 위치에 여러 버텍스로 나뉘어 있다. 각 버텍스를
  // 따로 피팅하면 몸 표면의 서로 다른 점을 찾아 솔기가 벌어지므로, 공간적으로
  // 같은 점을 하나의 그룹으로 용접한 뒤 변위를 계산한다.
  const groupByKey = new Map<string, number>()
  const groups: Array<{
    indices: number[]
    x: number
    y: number
    z: number
    nx: number
    ny: number
    nz: number
  }> = []
  const vertexGroup = new Int32Array(position.count)
  const sourceNormal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const key = `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`
    let groupIndex = groupByKey.get(key)
    if (groupIndex === undefined) {
      groupIndex = groups.length
      groupByKey.set(key, groupIndex)
      groups.push({ indices: [], x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 })
    }
    vertexGroup[index] = groupIndex
    const group = groups[groupIndex]
    group.indices.push(index)
    group.x += x
    group.y += y
    group.z += z
    group.nx += sourceNormal?.getX(index) ?? 0
    group.ny += sourceNormal?.getY(index) ?? 0
    group.nz += sourceNormal?.getZ(index) ?? 1
  }

  const rawDisplacement = new Float32Array(groups.length * 3)
  const adjacency = Array.from({ length: groups.length }, () => new Set<number>())
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]
    const count = group.indices.length
    group.x /= count
    group.y /= count
    group.z /= count
    const normalLength = Math.max(0.0001, Math.hypot(group.nx, group.ny, group.nz))
    group.nx /= normalLength
    group.ny /= normalLength
    group.nz /= normalLength
    const surfaceIndex = nearestBodySurfaceVertex(warp, group.x, group.y, group.z)
    if (surfaceIndex < 0) continue
    const offset = groupIndex * 3
    rawDisplacement[offset] = warp.target.getX(surfaceIndex) - warp.donor.getX(surfaceIndex)
    rawDisplacement[offset + 1] = warp.target.getY(surfaceIndex) - warp.donor.getY(surfaceIndex)
    rawDisplacement[offset + 2] = warp.target.getZ(surfaceIndex) - warp.donor.getZ(surfaceIndex)
  }

  const indexAttribute = geometry.index
  const connect = (a: number, b: number) => {
    const ga = vertexGroup[a]
    const gb = vertexGroup[b]
    if (ga === gb) return
    adjacency[ga].add(gb)
    adjacency[gb].add(ga)
  }
  const triangleCount = indexAttribute ? indexAttribute.count : position.count
  for (let triangle = 0; triangle < triangleCount; triangle += 3) {
    const a = indexAttribute ? indexAttribute.getX(triangle) : triangle
    const b = indexAttribute ? indexAttribute.getX(triangle + 1) : triangle + 1
    const c = indexAttribute ? indexAttribute.getX(triangle + 2) : triangle + 2
    connect(a, b)
    connect(b, c)
    connect(c, a)
  }

  // 가까운 몸 버텍스를 골라 생기는 조각난 변위를 천 메시 인접 관계에서 연속적인
  // 변위로 평탄화한다. 원본 변위로 약간 끌어당겨 나이대별 체형은 유지한다.
  let displacement = rawDisplacement.slice()
  let next = new Float32Array(displacement.length)
  const iterations = slot === 'upper' ? 12 : 8
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const offset = groupIndex * 3
      const neighbors = adjacency[groupIndex]
      if (neighbors.size === 0) {
        next[offset] = displacement[offset]
        next[offset + 1] = displacement[offset + 1]
        next[offset + 2] = displacement[offset + 2]
        continue
      }
      let averageX = 0
      let averageY = 0
      let averageZ = 0
      for (const neighbor of neighbors) {
        const neighborOffset = neighbor * 3
        averageX += displacement[neighborOffset]
        averageY += displacement[neighborOffset + 1]
        averageZ += displacement[neighborOffset + 2]
      }
      averageX /= neighbors.size
      averageY /= neighbors.size
      averageZ /= neighbors.size
      next[offset] = displacement[offset] + (averageX - displacement[offset]) * 0.42
        + (rawDisplacement[offset] - displacement[offset]) * 0.06
      next[offset + 1] = displacement[offset + 1] + (averageY - displacement[offset + 1]) * 0.42
        + (rawDisplacement[offset + 1] - displacement[offset + 1]) * 0.06
      next[offset + 2] = displacement[offset + 2] + (averageZ - displacement[offset + 2]) * 0.42
        + (rawDisplacement[offset + 2] - displacement[offset + 2]) * 0.06
    }
    ;[displacement, next] = [next, displacement]
  }

  const clearance = slot === 'upper' ? 0.0055 : 0.004
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  const garmentHeight = Math.max(0.001, (bounds?.max.y ?? 1) - (bounds?.min.y ?? 0))
  const garmentHalfWidth = Math.max(
    0.001,
    Math.abs(bounds?.min.x ?? -0.25),
    Math.abs(bounds?.max.x ?? 0.25),
  )
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]
    const offset = groupIndex * 3
    // 목둘레 솔기는 원본 20대 티셔츠의 깔끔한 원형을 유지한다. 가까운 몸 점을
    // 찾는 영역을 목까지 적용하면 앞·뒤면이 서로 다른 방향으로 벌어질 수 있다.
    const normalizedHeight = (group.y - (bounds?.min.y ?? 0)) / garmentHeight
    const centerFactor = 1 - THREE.MathUtils.smoothstep(
      Math.abs(group.x) / garmentHalfWidth,
      0.46,
      0.68,
    )
    const necklineFactor = slot === 'upper'
      ? THREE.MathUtils.smoothstep(normalizedHeight, 0.76, 0.91) * centerFactor
      : 0
    const refitWeight = 1 - necklineFactor
    const localClearance = clearance * (1 - necklineFactor * 0.88)
    const x = group.x + displacement[offset] * refitWeight + group.nx * localClearance
    const y = group.y + displacement[offset + 1] * refitWeight + group.ny * localClearance
    const z = group.z + displacement[offset + 2] * refitWeight + group.nz * localClearance
    for (const vertex of group.indices) position.setXYZ(vertex, x, y, z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  // computeVertexNormals도 UV 경계 버텍스는 따로 계산하므로, 용접된 점의 법선을
  // 다시 평균해 밝기가 기운 솔기를 제거한다.
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  for (const group of groups) {
    let nx = 0
    let ny = 0
    let nz = 0
    for (const vertex of group.indices) {
      nx += normal.getX(vertex)
      ny += normal.getY(vertex)
      nz += normal.getZ(vertex)
    }
    const length = Math.max(0.0001, Math.hypot(nx, ny, nz))
    nx /= length
    ny /= length
    nz /= length
    for (const vertex of group.indices) normal.setXYZ(vertex, nx, ny, nz)
  }
  normal.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/* 남성 환자 평상복 색. **저채도로만 고른다** — 채도가 높으면 진찰 화면에서 옷이 환자보다
   먼저 눈에 들어오고, 마커(4분면 색 원판)와도 색이 싸운다. 원본 기증자 옷이 빨강 니트라
   실제로 그 문제가 있었다. 명도는 중간대로 모아 검정으로 뭉개지지 않게 한다. */
const MALE_SHIRT_TONES = ['#8d949b', '#7f8a86', '#9a958c', '#6f7a84', '#8a8378', '#7b8288'] as const
/* 하의는 상의보다 한 단계 어둡되 **순검정은 쓰지 않는다.** 검정으로 두면 다리 실루엣과
   주름이 통째로 사라진다(원본 `tinted_M_Trousers_02` 가 그렇게 나왔다). */
const MALE_TROUSER_TONES = ['#4a5159', '#545a52', '#3f4650', '#5b5750', '#474d55'] as const
/* 아동(`mh_boy`·`mh_girl`)은 같은 중립화를 거치되 **성인 팔레트를 쓰지 않는다** — 사무실 회색을
   입히면 축소된 어른처럼 보인다. 조금 더 밝고 따뜻한 쪽으로 옮기고 채도는 여전히 낮게 둔다.
   아동도 이 분기가 필요하다: `mh_boy` 기증자가 로고 티셔츠(`elvs_male_logo_tshirt1`)라
   알베도를 안 지우면 배 한가운데 로고가 그대로 나온다. */
const CHILD_SHIRT_TONES = ['#a9b3b8', '#b0aca2', '#9fb0a8', '#b5aeb0'] as const
const CHILD_TROUSER_TONES = ['#5b6470', '#63665e', '#556069'] as const

type AdultFemaleOutfitStyle = 'uniform' | 'grandmaCasual'

/** 동일 MPFB 리그의 여성 복장을 대상 체형/골격에 안전하게 다시 결합한다. */
function transplantAdultFemaleOutfit(
  target: THREE.Group,
  donorSource: THREE.Group,
  style: AdultFemaleOutfitStyle,
  refitToBody = true,
  lowerDonorSource?: THREE.Group,
) {
  const donor = skeletonClone(donorSource) as THREE.Group
  const lowerDonor = style === 'grandmaCasual' && lowerDonorSource
    ? skeletonClone(lowerDonorSource) as THREE.Group
    : donor
  const lowerNeedsRefit = style === 'grandmaCasual' && Boolean(lowerDonorSource)
  const donorUniform: Array<{
    mesh: THREE.Mesh
    slot: 'upper' | 'lower'
    parentName: string | null
    source: 'primary' | 'lower'
  }> = []
  const collect = (
    root: THREE.Group,
    accepted: ReadonlySet<'upper' | 'lower'>,
    source: 'primary' | 'lower',
  ) => {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const slot = garmentSlot(mesh)
      if ((slot === 'upper' || slot === 'lower') && accepted.has(slot)) {
        donorUniform.push({ mesh, slot, parentName: mesh.parent?.name ?? null, source })
      }
    })
  }
  if (style === 'grandmaCasual') {
    collect(donor, new Set<'upper' | 'lower'>(['upper']), 'primary')
    collect(lowerDonor, new Set<'upper' | 'lower'>(['lower']), 'lower')
  } else {
    collect(donor, new Set<'upper' | 'lower'>(['upper', 'lower']), 'primary')
  }
  if (!donorUniform.some(({ slot }) => slot === 'upper') || !donorUniform.some(({ slot }) => slot === 'lower')) {
    return
  }

  // 이 전용 의상은 대상 환자와 동일한 f60 비만 체형에서 피팅됐다. 별도 GLB의
  // inverse-bind 행렬을 상세 환자 리그에 다시 계산하면 허리/다리 버텍스가 길게
  // 찢어진다. 원래 의상 리그를 그대로 보존하고 아래의 follower 본 동기화로
  // 환자 자세만 복사하면 재단 형태와 스키닝이 모두 유지된다.
  if (style === 'grandmaCasual' && lowerDonor === donor) {
    const originalGarments: THREE.Mesh[] = []
    target.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const slot = garmentSlot(mesh)
      if (slot === 'upper' || slot === 'lower') originalGarments.push(mesh)
    })
    for (const mesh of originalGarments) mesh.removeFromParent()
    for (const { mesh, slot } of donorUniform) {
      mesh.geometry = mesh.geometry.clone()
      mesh.geometry.userData.patientGeometryOwned = true
      mesh.name = slot === 'upper'
        ? 'PATIENT_GRANDMA_FLORAL_TUNIC'
        : 'PATIENT_GRANDMA_CHARCOAL_SLACKS'
    }
    donor.name = 'PATIENT_GRANDMA_OUTFIT_RIG'
    donor.userData.patientOutfitRig = true
    donor.traverse((node) => {
      if ((node as THREE.Bone).isBone) node.userData.patientOutfitFollower = true
    })
    target.add(donor)
    if (import.meta.env.DEV) {
      console.info(`[patient-garment] grandma follower-rig meshes=${donorUniform.length}`)
    }
    return
  }

  const targetBones = new Map<string, THREE.Bone>()
  target.traverse((node) => {
    const bone = node as THREE.Bone
    if (bone.isBone) targetBones.set(bone.name, bone)
  })
  const canRebind = donorUniform.every(({ mesh }) => {
    const skinned = mesh as THREE.SkinnedMesh
    return !skinned.isSkinnedMesh || skinned.skeleton.bones.every((bone) => targetBones.has(bone.name))
  })
  if (!canRebind) return

  const bodyWarp = refitToBody ? createBodySurfaceWarp(donor, target) : null
  const lowerBodyWarp = lowerNeedsRefit
    ? createBodySurfaceWarp(lowerDonor, target)
    : bodyWarp
  if ((refitToBody && !bodyWarp) || (lowerNeedsRefit && !lowerBodyWarp)) return

  const originalGarments: THREE.Mesh[] = []
  target.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const slot = garmentSlot(mesh)
    if (slot === 'upper' || slot === 'lower') originalGarments.push(mesh)
  })
  for (const mesh of originalGarments) mesh.removeFromParent()

  target.updateMatrixWorld(true)
  for (const { mesh, slot, parentName, source } of donorUniform) {
    const skinned = mesh as THREE.SkinnedMesh
    const warp = source === 'lower' ? lowerBodyWarp : bodyWarp
    const shouldRefit = source === 'lower' ? lowerNeedsRefit : refitToBody
    mesh.geometry = shouldRefit && warp
      ? refitUniformGeometry(mesh.geometry, warp, slot)
      : mesh.geometry.userData.patientGeometryOwned
        ? mesh.geometry
        : mesh.geometry.clone()
    mesh.geometry.userData.patientGeometryOwned = true
    mesh.name = style === 'grandmaCasual'
      ? slot === 'upper' ? 'PATIENT_GRANDMA_FLORAL_TUNIC' : 'PATIENT_GRANDMA_CHARCOAL_SLACKS'
      : slot === 'upper' ? 'PATIENT_WHITE_TEE' : 'PATIENT_BLUE_JEANS'
    if (skinned.isSkinnedMesh) {
      const bones = skinned.skeleton.bones.map((bone) => targetBones.get(bone.name)!)
      const skeleton = new THREE.Skeleton(bones)
      skeleton.calculateInverses()
      skinned.bind(skeleton, skinned.bindMatrix)
      skinned.userData.patientSkeletonOwned = true
    }
    const targetParent = parentName ? target.getObjectByName(parentName) : null
    ;(targetParent ?? target).add(mesh)
  }
}

function makeClinicalDrapeGeometry(width: number, height: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, 28, 22)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const y = position.getY(index)
    const nx = x / Math.max(width * 0.5, 0.001)
    const ny = THREE.MathUtils.clamp((y + height * 0.5) / Math.max(height, 0.001), 0, 1)

    // 허리에서는 몸에 붙고 무릎 쪽에서는 살짝 퍼지는 실제 진찰포 실루엣.
    const edgeScale = THREE.MathUtils.lerp(0.94, 0.86, ny)
      + Math.sin(ny * Math.PI) * 0.045
    // 아래 솔기는 완벽한 직선 대신 무게와 주름에 따라 불규칙하게 처진다.
    const hemWeight = Math.pow(1 - ny, 9)
    const hemDrop = hemWeight * (
      0.009
      + Math.sin(nx * Math.PI * 4.5 + 0.7) * 0.006
      + Math.sin(nx * Math.PI * 9.0) * 0.0025
    )
    const topWeight = THREE.MathUtils.smoothstep(ny, 0.72, 1)
    const topSag = Math.max(0, Math.cos(nx * Math.PI * 0.5)) * topWeight * 0.014

    // 세로 주름, 허리에서 비스듬히 잡히는 장력선, 체형을 감싸는 큰 곡률을 합성한다.
    const looseWeight = THREE.MathUtils.lerp(1, 0.24, ny)
    const verticalFolds = (
      Math.sin(nx * Math.PI * 7.2 + ny * 0.8) * 0.012
      + Math.sin(nx * Math.PI * 14.6 - ny * 1.6) * 0.004
    ) * looseWeight
    const tensionWrinkles = Math.sin((nx * 1.35 + ny * 1.9) * Math.PI * 3.2)
      * topWeight * (1 - Math.min(1, Math.abs(nx))) * 0.006
    const bodyCurve = Math.max(0, Math.cos(nx * Math.PI * 0.5)) * 0.035
    const edgeFall = Math.pow(Math.abs(nx), 2.2) * 0.012

    position.setX(index, x * edgeScale)
    position.setY(index, y - topSag - hemDrop)
    position.setZ(index, bodyCurve + verticalFolds + tensionWrinkles - edgeFall)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

function makeClothWeaveTexture(): THREE.DataTexture {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = Math.sin(x * Math.PI * 0.92) * 24
      const weft = Math.sin(y * Math.PI * 0.78 + (x % 4) * 0.22) * 18
      const cross = Math.sin((x + y) * Math.PI * 0.24) * 7
      const grain = (((x * 17 + y * 29 + x * y * 3) % 19) - 9) * 0.85
      const value = Math.round(THREE.MathUtils.clamp(128 + warp + weft + cross + grain, 32, 224))
      const offset = (y * size + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = 'clinical-drape-weave'
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(7.5, 5.5)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

/* ── 환자복(가운) + 여성 흉부 드레이프 ──────────────────────────────────────
   아바타 GLB 어디에도 속옷/환자복 메시가 없다. 상의 메시를 숨기면 맨몸이 그대로
   드러나므로 CPX 시뮬레이터로 내보낼 수 없다. 새 자산을 받아올 수 없으니
   **스킨 메시의 해당 삼각형만 떼어** 법선 방향으로 밀어낸 오프셋 셸을 만든다.
   스키닝 속성(skinIndex/skinWeight/skeleton/bindMatrix)을 그대로 복사하므로
   앉기·눕기·무릎세움 어느 자세에서도 몸을 따라간다.

   경계는 월드 y 상수가 아니라 **본**(빗장뼈 = 복장뼈 위끝, spine_03 = 칼돌기,
   목 본, 넓적다리 본)에서 유도한 뒤 실제 몸 표면 프로파일로 보정한다. 마른 체형과
   비만 체형의 유방은 같은 비율에 있지 않다(실측: mh_f20_thin 정점 y=1.095 /
   mh_f60_ob 정점 y=1.075, 빗장뼈는 둘 다 y≈1.20). 비율만 쓰면 비만 아바타에서
   젖꼭지가 드레이프 아래로 나온다. */
const CLOTH = {
  offset: 0.017,     // 피부에서 띄우는 천 두께(m). 14mm로도 캡처에서 몸에 칠한 것처럼 보였다
  /* 가장자리를 피부 **밑**으로 말아 넣는 깊이 — 잘린 단면을 감춘다.
     ⚠ 14mm는 얕았다. 셸은 삼각형 단위로 가져오는데, 오목한 자리(목 아래·빗장뼈 위)에서는
     삼각형의 현(弦)이 오목면 **바깥**으로 부풀어 묻어 둔 단이 다시 튀어나온다 — 삼각형
     한 칸 주기의 부채꼴 톱니가 되고, 카메라가 제일 가까운 두경부 경로에서 제일 크게 보였다.
     tuck과 tuckBand를 **같은 비율로** 키우면 lift=0 등고선(=보이는 옷단)은 0.4mm밖에
     안 움직이면서 묻히는 깊이만 깊어진다 — 재단은 그대로 두고 톱니만 없앤다. */
  tuck: 0.030,
  tuckBand: 0.045,
  feather: 0.038,    // 안쪽에서 오프셋이 다 붙기까지의 구간
  /* 옷단 말이 — 경계 바로 안쪽에서 천을 한 번 부풀린다. 오프셋 셸의 단면은 두께가 0이라
     그냥 두면 칼로 자른 종이로 보인다. 실루엣에 단(hem)이 생겨야 천으로 읽힌다. */
  hem: 0.005,
  hemBand: 0.024,
  /* 아래를 향한 면(젖가슴 아래·뱃살 아래)에서 천이 몸을 안 따라가고 뜨는 양.
     법선 오프셋만 쓰면 천이 항상 몸에 붙어 유방 형태가 그대로 드러난다. */
  bridge: 0.034,
  /* 그 뜨는 방향에 섞는 **수평(몸 바깥)** 성분. 법선만 쓰면 아래를 향한 면에서 천이
     아래로만 늘어져 여전히 몸 윤곽을 따라간다 — 천은 가슴 아래를 가로질러 걸쳐야 한다. */
  bridgeOut: 0.55,
  fold: 0.007,       // 몸을 감도는 세로 주름 진폭
  /* 옷걸이 포락선에서 한 정점을 밀어낼 수 있는 최대치(m). 제한이 없으면 어깨 폭까지
     부풀어 통짜 원통이 된다. 28mm는 과했다 — 가운이 누빔 조끼처럼 부풀어 보였다. */
  hangMax: 0.019,
  smoothRate: 0.55,  // 라플라시안 평활 1회당 이웃 평균으로 끌어당기는 비율
  /* 주름 결의 세기. 평활 뒤 **법선에만** 넣는 값이라 형상·경계·마커 판정에 영향이 없다.
     0 이면 완전히 매끈해져 두꺼운 폼 밴드로 보인다. */
  wrinkle: 0.0022,
} as const

/* 진찰 항목별 환자복 상태. store의 ExamToolId 값이지만 여기서는 문자열 비교만 하면 되므로
   타입을 끌어오지 않는다(옷 레이어가 진찰 스펙에 결합되지 않게). */
const CHEST_EXAM_TOOLS: readonly string[] = ['heart_auscultation', 'lung_auscultation', 'chest_percussion']
const ABDOMEN_EXAM_TOOLS: readonly string[] = [
  'auscultation', 'percussion', 'palpation', 'liver_palpation', 'cva_tenderness',
]

const MODESTY = {
  rowStep: 0.008,     // 가슴 앞면 프로파일 샘플 간격(m)
  apexHigh: 0.25,     // 유방 정점 탐색 상한 (복장뼈위끝→칼돌기 span 대비)
  apexLow: 0.80,      // 〃 하한. 더 내리면 비만 아바타의 배가 '정점'으로 잡힌다
  refRatio: 0.14,     // 유방이 없는 복장뼈 상부 기준선
  topThreshold: 0.35, // 유방 상연 판정 — 융기가 이만큼 되돌아오면 갈비뼈 표면이다
  topPad: 0.006,      // 유방 상연보다 더 올려 덮는 여유(m)
  // 젖가슴아래주름보다 더 내려 덮는 여유(m).
  bottomPad: 0.012,
  /* 드레이프 위끝 한계 — 2번째 갈비사이(대동맥판·폐동맥판, ClinicScene ics2Ratio=0.22)를
     덮지 않도록 복장뼈 위끝에서 최소 이만큼은 내려온다. */
  ceilingRatio: 0.27,
  /* 드레이프 **아래끝** 한계(복장뼈위끝→칼돌기 span 대비). 열별 주름 탐색은 그냥 두면
     y=0.977까지 내려가 아래쪽 앞 폐야까지 덮는다(실측 mh_f20_thin).
     ⚠ 0.62(=y 1.069)로 잡았더니 젖가슴아래주름(1.064)보다 위라 유방 아랫부분이 단 밑으로
     드러났다 — 모디스티 실패는 청진 부위가 천에 가리는 것보다 나쁘다. 주름을 덮되
     심첨(ics5Ratio 0.68 = y 1.056) 바로 아래에서 멈추도록 0.72로 내렸다.
     심첨은 천 가장자리 밑에 들어가지만, 메시 이름에 `drape`가 있어 ClinicScene의
     NON_SKIN_MESH가 레이캐스트에서 건너뛰므로 앵커는 그대로 맨살에 앉는다. */
  floorRatio: 0.72,
  /* 복장뼈 앞 파냄 — 윗단이 여기만큼(span 대비) 내려간다. 유방 사이에는 가릴 것이 없고,
     그 자리를 덮으면 대동맥판·폐동맥판 청진 부위가 천 밑에 들어간다. */
  sternalNotch: 0.09,
  /* 몸통 반폭 대비 파냄이 퍼지는 폭. 좁고 깊게 파면 컵 두 개짜리 **속옷**으로 읽힌다
     — 의료용 가리개가 시선을 끄는 역효과가 난다. 넓고 얕게 판다. */
  sternalWidth: 0.5,
  hemSmoothPasses: 5, // 열별 아랫단 평활 반복 — 각진 컵 실루엣을 없앤다
  minHeight: 0.07,    // 프로파일이 밋밋할 때의 최소 높이(m)
} as const

/* 팔에 실린 정점은 밴드에서 뺀다 — A포즈 바인드에서 위팔은 겨드랑이 높이와 겹친다.
   MPFB(game_engine) 손가락 본은 upperarm/hand 규칙에 안 걸려서 이름을 전부 적는다. */
const MODESTY_ARM_BONE = /(upperarm|lowerarm|forearm|hand|wrist|clavicle|shoulder|thumb|index|middle|ring|pinky)/i

function bindBonePositions(skeleton: THREE.Skeleton): Map<string, THREE.Vector3> {
  const result = new Map<string, THREE.Vector3>()
  const inverse = new THREE.Matrix4()
  for (let index = 0; index < skeleton.bones.length; index++) {
    const boneInverse = skeleton.boneInverses[index]
    if (!boneInverse) continue
    // 역바인드행렬의 역 = 바인드 포즈 본 위치. 지오메트리(=바인드) 좌표계 그대로다.
    inverse.copy(boneInverse).invert()
    result.set(norm(skeleton.bones[index].name), new THREE.Vector3().setFromMatrixPosition(inverse))
  }
  return result
}

function pickBindBone(bind: Map<string, THREE.Vector3>, keys: string[]): THREE.Vector3 | null {
  for (const key of keys) {
    const found = bind.get(key)
    if (found) return found
  }
  return null
}

function armWeightAt(
  skinIndex: THREE.BufferAttribute,
  skinWeight: THREE.BufferAttribute,
  armBones: Set<number>,
  index: number,
): number {
  let weight = 0
  for (let component = 0; component < 4; component++) {
    if (armBones.has(skinIndex.getComponent(index, component))) {
      weight += skinWeight.getComponent(index, component)
    }
  }
  return weight
}

/** 바인드 포즈에서 주어진 높이의 몸 앞면(최대 z)을 잰다. 팔은 뺀다.
 *  garmentCutMetrics.lowerFrontZ는 getVertexPosition으로 **자세가 적용된** 표면을 재기 때문에
 *  앉은 자세에서 앞으로 나온 무릎이 잡혀 0.30까지 튄다(실측). 시트 시작점은 그 값을 쓸 수 없다. */
function bindSkinFrontAt(mesh: THREE.SkinnedMesh, y: number, halfBand: number): number | null {
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return null
  const skinIndex = mesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const skinWeight = mesh.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  const armBones = collectArmBones(mesh.skeleton)
  let front = Number.NEGATIVE_INFINITY
  for (let index = 0; index < position.count; index++) {
    if (Math.abs(position.getY(index) - y) > halfBand) continue
    if (skinIndex && skinWeight && armWeightAt(skinIndex, skinWeight, armBones, index) > 0.5) continue
    front = Math.max(front, position.getZ(index))
  }
  return Number.isFinite(front) ? front : null
}

/** 주어진 높이에서 **의복** 메시의 앞면(최대 z)을 잰다.
 *  시트 여유를 피부 반지름으로만 잡으면 통 넓은 바지가 시트를 뚫고 나온다 — mh_m70의
 *  `m_trousers_01`이 시트 위로 통째로 올라와 다리에 검은 덩어리로 찍혔다(실측).
 *  스키니진(mh_f20_thin)에서는 안 났기에 원인이 오래 안 잡혔다. */
function bindGarmentFrontAt(
  records: readonly GarmentMeshRecord[],
  slot: GarmentSlot,
  y: number,
  halfBand: number,
): number | null {
  let front = Number.NEGATIVE_INFINITY
  for (const record of records) {
    if (record.slot !== slot) continue
    const position = record.mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) continue
    for (let index = 0; index < position.count; index++) {
      if (Math.abs(position.getY(index) - y) > halfBand) continue
      front = Math.max(front, position.getZ(index))
    }
  }
  return Number.isFinite(front) ? front : null
}

function collectArmBones(skeleton: THREE.Skeleton): Set<number> {
  const armBones = new Set<number>()
  skeleton.bones.forEach((bone, index) => {
    if (MODESTY_ARM_BONE.test(bone.name)) armBones.add(index)
  })
  return armBones
}

interface BreastBand {
  maxY: number                  // 드레이프 윗단(가장 높은 지점 — 유방 바깥위쪽)
  minY: number                  // 가장 낮은 아랫단(선택 범위 산정용)
  hemAt: (x: number) => number  // 열(column)별 아랫단 = 실제 젖가슴아래주름 높이
  topAt: (x: number) => number  // 열별 윗단 — 복장뼈 앞은 파여 있다(아래 주석)
  centerX: number               // 가슴 단면 중심 — 포락선의 축
  halfWidth: number             // 〃 좌우 반폭
  halfDepth: number             // 〃 앞뒤 반깊이
}

/** 가슴 앞면 프로파일에서 유방을 덮을 드레이프의 위·아래 높이(바인드 좌표 y)를 잡는다.
 *  아랫단은 평평한 y 한 줄이 아니라 **열별 젖가슴아래주름**을 따라간다 — 평평하게 자르면
 *  마른 체형에서도 바깥아래쪽 유방이 단 밑으로 삐져나온다(실제 캡처에서 그렇게 보였다). */
function measureModestyBand(
  mesh: THREE.SkinnedMesh,
  supraY: number,
  xiphoidY: number,
): BreastBand | null {
  const span = supraY - xiphoidY
  if (!(span > 0.05)) return null
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return null
  const skinIndex = mesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const skinWeight = mesh.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  const armBones = collectArmBones(mesh.skeleton)

  const scanTop = supraY + span * 0.1
  const scanBottom = xiphoidY - span * 0.3
  // 가슴 좌우 폭 — 열 격자를 만들기 전에 재야 한다. 앞뒤 깊이는 포락선 축의 타원 정규화용.
  let chestMinX = Number.POSITIVE_INFINITY
  let chestMaxX = Number.NEGATIVE_INFINITY
  let chestMinZ = Number.POSITIVE_INFINITY
  let chestMaxZ = Number.NEGATIVE_INFINITY
  for (let index = 0; index < position.count; index++) {
    const y = position.getY(index)
    if (y < scanBottom || y > scanTop) continue
    if (skinIndex && skinWeight && armWeightAt(skinIndex, skinWeight, armBones, index) > 0.5) continue
    const x = position.getX(index)
    const z = position.getZ(index)
    chestMinX = Math.min(chestMinX, x)
    chestMaxX = Math.max(chestMaxX, x)
    chestMinZ = Math.min(chestMinZ, z)
    chestMaxZ = Math.max(chestMaxZ, z)
  }
  if (!Number.isFinite(chestMinX) || chestMaxX - chestMinX < 0.05) return null

  /* 열 × 행 격자에 가장 앞선 z를 담는다.
     모델 공간에서 +z가 배 쪽이다(updatePatientTorso 검산과 같은 규약). */
  const columns = 14
  const columnWidth = (chestMaxX - chestMinX) / columns
  const rows = new Map<number, Float32Array>()
  const wholeRow = new Map<number, number>()
  for (let index = 0; index < position.count; index++) {
    const y = position.getY(index)
    if (y < scanBottom || y > scanTop) continue
    if (skinIndex && skinWeight && armWeightAt(skinIndex, skinWeight, armBones, index) > 0.5) continue
    const z = position.getZ(index)
    const key = Math.round(y / MODESTY.rowStep)
    let cells = rows.get(key)
    if (!cells) {
      cells = new Float32Array(columns).fill(Number.NEGATIVE_INFINITY)
      rows.set(key, cells)
    }
    const column = THREE.MathUtils.clamp(
      Math.floor((position.getX(index) - chestMinX) / columnWidth),
      0,
      columns - 1,
    )
    if (z > cells[column]) cells[column] = z
    const whole = wholeRow.get(key)
    if (whole === undefined || z > whole) wholeRow.set(key, z)
  }
  if (rows.size < 6) return null
  const rowZ = (y: number): number | undefined => wholeRow.get(Math.round(y / MODESTY.rowStep))

  // 유방 정점 — 탐색 구간을 복장뼈 위끝 기준으로 잘라 배(비만)와 목을 배제한다.
  let apexY = supraY - span * 0.5
  let apexZ = Number.NEGATIVE_INFINITY
  for (const [key, z] of wholeRow) {
    const y = key * MODESTY.rowStep
    if (y > supraY - span * MODESTY.apexHigh || y < supraY - span * MODESTY.apexLow) continue
    if (z > apexZ) {
      apexZ = z
      apexY = y
    }
  }
  const referenceZ = rowZ(supraY - span * MODESTY.refRatio)
  const bulge = referenceZ === undefined ? 0 : apexZ - referenceZ
  const ceiling = supraY - span * MODESTY.ceilingRatio
  // 심첨(ics5Ratio 0.68)이 천 밑으로 들어가지 않도록 아래끝을 여기서 막는다.
  const bandFloor = supraY - span * MODESTY.floorRatio
  const flatHem = bandFloor
  /* 복장뼈 앞은 파낸다. 유방은 좌우로 떨어져 있고 그 사이 복장뼈에는 가릴 것이 없는데,
     평평한 윗단이 거기까지 올라오면 **2번째 갈비사이(대동맥판·폐동맥판)가 천 밑에 들어간다**
     — 실측: ICS2 y=1.154, 종전 평평한 윗단 1.144, 천 두께 17mm면 그대로 덮인다. */
  const centerX = (chestMinX + chestMaxX) * 0.5
  const halfWidth = Math.max(0.02, (chestMaxX - chestMinX) * 0.5)
  const halfDepth = Math.max(0.03, (chestMaxZ - chestMinZ) * 0.5)
  const axis = { centerX, halfWidth, halfDepth }
  const topAt = (top: number) => (x: number): number => {
    const midline = THREE.MathUtils.smoothstep(
      1 - Math.abs(x - centerX) / (halfWidth * MODESTY.sternalWidth),
      0,
      1,
    )
    return top - span * MODESTY.sternalNotch * midline
  }
  if (!(bulge > 0.008)) {
    // 융기를 못 읽었다(프로파일이 밋밋하거나 본이 이상하다) — 해부학 비율로 폴백한다.
    return { minY: flatHem, maxY: ceiling, hemAt: () => flatHem, topAt: topAt(ceiling), ...axis }
  }

  // 유방 상연: 정점에서 위로 올라가며 융기가 갈비뼈 표면 쪽으로 되돌아오는 지점.
  const threshold = apexZ - bulge * (1 - MODESTY.topThreshold)
  let topY = apexY
  for (let y = apexY; y <= supraY; y += MODESTY.rowStep) {
    const z = rowZ(y)
    if (z === undefined) continue
    topY = y
    if (z <= threshold) break
  }
  const maxY = Math.min(topY + MODESTY.topPad, ceiling)

  /* 열별 젖가슴아래주름: 정점 아래에서 프로파일이 가장 가파르게 꺼지는 행(마른 체형)
     또는 다시 배로 부풀기 시작하는 행(비만 체형). 실측상 둘 다 실제 주름과 일치한다. */
  const floor = xiphoidY - span * 0.22
  const hems = new Float32Array(columns)
  for (let column = 0; column < columns; column++) {
    let columnApexY = apexY
    let columnApexZ = Number.NEGATIVE_INFINITY
    for (const [key, cells] of rows) {
      const y = key * MODESTY.rowStep
      if (y > supraY - span * MODESTY.apexHigh || y < supraY - span * MODESTY.apexLow) continue
      if (cells[column] > columnApexZ) {
        columnApexZ = cells[column]
        columnApexY = y
      }
    }
    let hem = maxY - MODESTY.minHeight
    if (Number.isFinite(columnApexZ)) {
      let steepest = 0
      let previousZ = columnApexZ
      for (let y = columnApexY - MODESTY.rowStep; y >= floor; y -= MODESTY.rowStep) {
        const cells = rows.get(Math.round(y / MODESTY.rowStep))
        const z = cells?.[column]
        if (z === undefined || !Number.isFinite(z)) continue
        const drop = previousZ - z
        if (drop < 0) {
          hem = y
          break
        }
        if (drop > steepest) {
          steepest = drop
          hem = y
        }
        previousZ = z
      }
    }
    hems[column] = hem - MODESTY.bottomPad
  }
  /* 이웃 열과 평균해 계단을 없앤다 — 단이 톱니로 보이면 안 된다.
     1회로는 열별 주름 높이차가 그대로 남아 아래 가장자리가 **각진 브라 컵 두 개**로 읽혔다.
     수건은 두 봉우리를 하나의 완만한 선으로 가로지르므로 여러 번 돌려 그 선을 만든다. */
  let smoothed = Float32Array.from(hems)
  for (let pass = 0; pass < MODESTY.hemSmoothPasses; pass++) {
    const next = new Float32Array(columns)
    for (let column = 0; column < columns; column++) {
      const left = smoothed[Math.max(0, column - 1)]
      const right = smoothed[Math.min(columns - 1, column + 1)]
      next[column] = (left + smoothed[column] * 2 + right) * 0.25
    }
    smoothed = next
  }
  for (let column = 0; column < columns; column++) {
    smoothed[column] = THREE.MathUtils.clamp(smoothed[column], bandFloor, maxY - 0.03)
  }

  let minY = Number.POSITIVE_INFINITY
  for (const hem of smoothed) minY = Math.min(minY, hem)
  return {
    maxY,
    minY,
    hemAt: (x: number) => {
      const t = THREE.MathUtils.clamp((x - chestMinX) / columnWidth - 0.5, 0, columns - 1)
      const low = Math.floor(t)
      const high = Math.min(columns - 1, low + 1)
      return THREE.MathUtils.lerp(smoothed[low], smoothed[high], t - low)
    },
    topAt: topAt(maxY),
    ...axis,
  }
}

interface ClothShellSpec {
  /** ⚠ 이름은 반드시 `medical_base`로 시작해야 한다 — garmentSlot()이 그 패턴만 null(항상 유지)로
   *  돌린다. 'patient_gown'으로 지었다가 'gown' 규칙에 걸려 상의 슬롯으로 등록됐고,
   *  "상의 벗기" 상태에서 환자복째 숨겨져 알몸이 그대로 렌더됐다. */
  name: string
  /** 옷 안쪽이면 양수, 밖이면 음수인 부호 거리(m). 가장자리 처리를 이 값으로 한다. */
  edge: (x: number, y: number, z: number, armWeight: number) => number
  /** 몸통 세로축(주름 각도의 기준) */
  axisX: number
  axisZ: number
  bridge?: number
  fold?: number
  /** 위치별 두께 배율(0~1). 바지 허리선 아래처럼 다른 옷이 이미 덮은 구간은 얇게 눌러
   *  관통을 막는다 — 14mm 그대로 두면 청바지를 뚫고 나와 천이 찢어진 것처럼 보인다. */
  offsetScale?: (x: number, y: number, z: number) => number
  /** 어깨에서 **걸쳐 내려오는** 정도(0~1). 0이면 체표를 그대로 따라간다(속옷),
   *  1이면 위쪽에서 가장 굵은 단면까지 부풀려 그 아래를 가로지른다(가운). */
  hang?: number
  /** 포락선을 재는 타원 반지름. 몸통은 원통이 아니라 앞뒤로 납작하다 — 정규화하지 않으면
   *  넓은 좌우 반경이 앞뒤까지 부풀려 배가 통으로 나온다. */
  hangRadiusX?: number
  hangRadiusZ?: number
  /** 아랫단이 제 무게로 처지는 양(m). 0이면 경계가 몸 윤곽을 그대로 따라간다. */
  hemFall?: number
  /** 주름 결 세기(법선 전용). 생략하면 CLOTH.wrinkle. */
  wrinkle?: number
  /** 라플라시안 평활 반복 수. 젖꼭지·갈비뼈 같은 체표 고주파를 지운다 — 이게 없으면
   *  두께를 아무리 키워도 '몸에 칠한 천'으로 남는다. */
  smooth?: number
}

/** 스킨 메시에서 옷에 해당하는 삼각형을 떼어 오프셋 셸(SkinnedMesh)로 만든다.
 *
 *  가장자리는 **자르지 않고 피부 밑으로 말아 넣는다**(CLOTH.tuck). 잘라내면 단면이
 *  톱니로 드러나 "천이 아니라 스티커"로 보인다 — 실제 캡처에서 그렇게 보였다.
 *  오프셋이 0을 지나 음수가 되는 등고선이 곧 옷단이 되므로 경계선이 매끄럽다. */
function buildClothShell(skin: THREE.SkinnedMesh, spec: ClothShellSpec): THREE.SkinnedMesh | null {
  const geometry = skin.geometry
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  const skinIndex = geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const skinWeight = geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  const index = geometry.getIndex()
  if (!position || !normal || !skinIndex || !skinWeight || !index) return null

  const armBones = collectArmBones(skin.skeleton)
  const edges = new Float32Array(position.count)
  for (let vertex = 0; vertex < position.count; vertex++) {
    edges[vertex] = spec.edge(
      position.getX(vertex),
      position.getY(vertex),
      position.getZ(vertex),
      armWeightAt(skinIndex, skinWeight, armBones, vertex),
    )
  }

  // 한 정점이라도 옷 안쪽이면 삼각형째 가져온다. 밖으로 나간 부분은 피부 밑에 묻힌다.
  const remap = new Int32Array(position.count).fill(-1)
  const shellIndices: number[] = []
  const sourceVertices: number[] = []
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    if (edges[triangle[0]] <= 0 && edges[triangle[1]] <= 0 && edges[triangle[2]] <= 0) continue
    for (const vertex of triangle) {
      if (remap[vertex] < 0) {
        remap[vertex] = sourceVertices.length
        sourceVertices.push(vertex)
      }
      shellIndices.push(remap[vertex])
    }
  }
  if (shellIndices.length < 30) return null

  const bridge = spec.bridge ?? CLOTH.bridge
  const foldAmp = spec.fold ?? CLOTH.fold
  const hemFall = spec.hemFall ?? 0
  const count = sourceVertices.length
  /* 아랫단이 어디인지 알아야 천을 늘어뜨린다 — 남긴 정점의 y 범위를 먼저 잰다.
     경계 거리(edges)만으로는 위쪽 단과 아래쪽 단을 구분할 수 없다. */
  let shellMinY = Number.POSITIVE_INFINITY
  let shellMaxY = Number.NEGATIVE_INFINITY
  for (let vertex = 0; vertex < count; vertex++) {
    const y = position.getY(sourceVertices[vertex])
    if (y < shellMinY) shellMinY = y
    if (y > shellMaxY) shellMaxY = y
  }
  const shellSpanY = Math.max(1e-4, shellMaxY - shellMinY)
  const shellPosition = new Float32Array(count * 3)
  const shellNormal = new Float32Array(count * 3)
  const shellUv = uv ? new Float32Array(count * 2) : null
  const shellSkinIndex = new Uint16Array(count * 4)
  const shellSkinWeight = new Float32Array(count * 4)
  const shellInside = new Float32Array(count)   // 옷 안쪽 정도 — 포락선·평활을 옷단에서 죽인다
  for (let vertex = 0; vertex < count; vertex++) {
    const source = sourceVertices[vertex]
    const x = position.getX(source)
    const y = position.getY(source)
    const z = position.getZ(source)
    const n0x = normal.getX(source)
    const n0y = normal.getY(source)
    const n0z = normal.getZ(source)
    let nx = n0x
    let ny = n0y
    let nz = n0z

    const distance = edges[source]
    const thickness = spec.offsetScale ? spec.offsetScale(x, y, z) : 1
    // 바깥쪽은 음수 오프셋 → 피부 안으로 들어가 가려진다. 옷단이 톱니로 드러나지 않는다.
    const shell = THREE.MathUtils.lerp(
      -CLOTH.tuck,
      CLOTH.offset * thickness,
      THREE.MathUtils.smoothstep(distance, -CLOTH.tuckBand, CLOTH.feather),
    )
    // 경계 직전에서 한 번 도톰해졌다 가라앉는다 = 말아 박은 옷단.
    const hemRoll = CLOTH.hem * thickness
      * Math.sin(Math.PI * THREE.MathUtils.clamp(distance / CLOTH.hemBand, 0, 1))
    const insideWeight = THREE.MathUtils.smoothstep(distance, 0, CLOTH.feather) * thickness
    shellInside[vertex] = insideWeight
    /* 아래를 향한 면에서는 천이 몸을 따라가지 않고 걸쳐진다(젖가슴 아래·뱃살 아래).
       ⚠ 지수 1.5 + insideWeight 1승은 밴드 **바깥쪽 끝**(겨드랑이 쪽)에서도 절반 넘게 밀어
       공기 넣은 것처럼 부푼 혹이 생겼다. 지수를 올려 진짜 밑면에만 걸리게 하고,
       insideWeight를 제곱해 경계 근처에서 빠르게 죽인다 — 혹이 생기던 자리가 거기다. */
    const drop = Math.max(0, -n0y)
    const bridgeLift = bridge * Math.pow(drop, 2.4) * insideWeight * insideWeight

    const angle = Math.atan2(x - spec.axisX, z - spec.axisZ)
    const radius = Math.max(0.02, Math.hypot(x - spec.axisX, z - spec.axisZ))
    /* 주름은 주기가 다른 파를 겹쳐야 천으로 읽힌다(lab/fresh curtain()의 교훈 —
       단일 사인파는 버티컬 블라인드로 보인다). */
    const foldPhase = Math.sin(angle * 7 + y * 9)
      + 0.45 * Math.sin(angle * 13 - y * 5 + 1.7)
    const foldSlope = 7 * Math.cos(angle * 7 + y * 9)
      + 0.45 * 13 * Math.cos(angle * 13 - y * 5 + 1.7)
    const fold = foldAmp * foldPhase * insideWeight
    const lift = shell + hemRoll + fold
    /* 아랫단 흘러내림 — 천은 아래 가장자리에서 몸을 놓고 제 무게로 처진다. 이게 없으면
       경계가 몸 윤곽을 그대로 따라가서 '성형된 컵'으로 읽힌다(흉부 드레이프 지적). */
    const hemZone = 1 - THREE.MathUtils.smoothstep((y - shellMinY) / shellSpanY, 0, 0.34)
    const fall = hemFall * hemZone
      * (0.75 + 0.25 * Math.sin(angle * 5.3 + 0.7))  // 단이 직선이 아니라 물결지게
      * THREE.MathUtils.smoothstep(distance, -CLOTH.tuckBand * 0.5, CLOTH.feather)

    /* 주름의 접선 기울기만큼 법선을 틀어 준다. 스킨 법선을 그대로 쓰면 변위가
       실루엣에만 나타나 여전히 몸에 칠한 것처럼 보인다. UV 솔기에서 정점이 갈라져
       있으므로 computeVertexNormals()는 쓸 수 없다(솔기마다 각진 선이 생긴다). */
    const slope = (foldAmp * foldSlope * insideWeight) / radius
    nx -= Math.cos(angle) * slope
    nz += Math.sin(angle) * slope
    const length = Math.max(1e-5, Math.hypot(nx, ny, nz))
    nx /= length
    ny /= length
    nz /= length

    /* 걸치는 성분만 방향을 달리 쓴다 — 법선(아래) + 몸 바깥(수평)을 섞어야 가슴 아래를
       가로질러 걸린다. 전부 법선으로 밀면 아래로만 늘어져 윤곽이 그대로 남는다. */
    const outX = (x - spec.axisX) / radius
    const outZ = (z - spec.axisZ) / radius
    const bridgeX = n0x * (1 - CLOTH.bridgeOut) + outX * CLOTH.bridgeOut
    const bridgeY = n0y * (1 - CLOTH.bridgeOut)
    const bridgeZ = n0z * (1 - CLOTH.bridgeOut) + outZ * CLOTH.bridgeOut
    const bridgeLength = Math.max(1e-5, Math.hypot(bridgeX, bridgeY, bridgeZ))
    shellPosition[vertex * 3] = x + n0x * lift + (bridgeX / bridgeLength) * bridgeLift
    shellPosition[vertex * 3 + 1] = y + n0y * lift + (bridgeY / bridgeLength) * bridgeLift - fall
    shellPosition[vertex * 3 + 2] = z + n0z * lift + (bridgeZ / bridgeLength) * bridgeLift
    shellNormal[vertex * 3] = nx
    shellNormal[vertex * 3 + 1] = ny
    shellNormal[vertex * 3 + 2] = nz
    if (shellUv && uv) {
      shellUv[vertex * 2] = uv.getX(source)
      shellUv[vertex * 2 + 1] = uv.getY(source)
    }
    for (let component = 0; component < 4; component++) {
      shellSkinIndex[vertex * 4 + component] = skinIndex.getComponent(source, component)
      shellSkinWeight[vertex * 4 + component] = skinWeight.getComponent(source, component)
    }
  }

  /* ── 옷걸이 포락선 ─────────────────────────────────────────────────────
     오프셋 셸은 체표를 그대로 복사하므로 두께만 키워도 '몸에 칠한 천'으로 남는다
     (17mm에서도 젖꼭지·갈비뼈가 그대로 드러났다 — 캡처 확인).
     실제 옷은 위쪽에서 가장 굵은 단면에 **걸려** 그 아래를 가로지른다. 높이별 최대 반경을
     위에서 아래로 누적한 선까지 부풀려 그 걸침을 만든다. */
  const hang = spec.hang ?? 0
  if (hang > 0) {
    const hangRadiusX = Math.max(1e-3, spec.hangRadiusX ?? 1)
    const hangRadiusZ = Math.max(1e-3, spec.hangRadiusZ ?? 1)
    const rowStep = 0.012
    const normRadius = (px: number, pz: number): number => Math.hypot(
      (px - spec.axisX) / hangRadiusX,
      (pz - spec.axisZ) / hangRadiusZ,
    )
    // 팔은 뺀다 — 소매까지 넣으면 어깨 폭이 최대 반경이 되어 가운이 통짜가 된다.
    const rowMax = new Map<number, number>()
    for (let vertex = 0; vertex < count; vertex++) {
      const source = sourceVertices[vertex]
      if (armWeightAt(skinIndex, skinWeight, armBones, source) > 0.35) continue
      const key = Math.round(position.getY(source) / rowStep)
      const value = normRadius(position.getX(source), position.getZ(source))
      const current = rowMax.get(key)
      if (current === undefined || value > current) rowMax.set(key, value)
    }
    const profile = new Map<number, number>()
    let running = 0
    for (const key of [...rowMax.keys()].sort((a, b) => b - a)) {
      running = Math.max(running, rowMax.get(key) as number)
      profile.set(key, running)
    }
    const growLimit = CLOTH.hangMax / hangRadiusX
    for (let vertex = 0; vertex < count; vertex++) {
      const inside = shellInside[vertex]
      if (inside <= 0) continue
      const source = sourceVertices[vertex]
      /* ⚠ 소매는 포락선에서 **뺀다.** 반경은 몸통 축에서 재는데 위팔은 그 축에서 멀리 떨어져
         있어서, 어깨 높이의 몸통 최대 반경(=어깨 너비)까지 밀리면 소매가 풍선처럼 부푼다.
         프로파일을 만들 때는 이미 팔을 뺐는데 적용할 때 안 뺐다 —
         캡처에서 소매가 마시멜로 베개로 보인 원인이 이것이다. */
      if (armWeightAt(skinIndex, skinWeight, armBones, source) > 0.35) continue
      const target = profile.get(Math.round(position.getY(source) / rowStep))
      if (target === undefined) continue
      const px = shellPosition[vertex * 3]
      const pz = shellPosition[vertex * 3 + 2]
      const radius = normRadius(px, pz)
      if (!(radius > 1e-4) || target <= radius) continue
      const scale = (radius + Math.min(target - radius, growLimit) * hang * inside) / radius
      shellPosition[vertex * 3] = spec.axisX + (px - spec.axisX) * scale
      shellPosition[vertex * 3 + 2] = spec.axisZ + (pz - spec.axisZ) * scale
    }
  }

  /* ── 평활 ──────────────────────────────────────────────────────────────
     실이 짜인 천은 젖꼭지 같은 잔요철을 못 따라간다. 라플라시안으로 고주파만 지운다
     (큰 형태는 저주파라 남는다 — 유방이 사라지지는 않는다).
     UV 솔기에서 갈라진 정점을 원래 체표 좌표로 **묶어야** 한다. 안 묶으면 솔기가 벌어진다. */
  const smoothPasses = spec.smooth ?? 0
  if (smoothPasses > 0) {
    const weldOf = new Int32Array(count)
    const weldKeys = new Map<string, number>()
    for (let vertex = 0; vertex < count; vertex++) {
      const source = sourceVertices[vertex]
      const key = `${Math.round(position.getX(source) * 8192)}`
        + `,${Math.round(position.getY(source) * 8192)}`
        + `,${Math.round(position.getZ(source) * 8192)}`
      let group = weldKeys.get(key)
      if (group === undefined) {
        group = weldKeys.size
        weldKeys.set(key, group)
      }
      weldOf[vertex] = group
    }
    const groups = weldKeys.size
    const groupPosition = new Float32Array(groups * 3)
    const groupInside = new Float32Array(groups)
    for (let vertex = 0; vertex < count; vertex++) {
      const group = weldOf[vertex]
      groupPosition[group * 3] = shellPosition[vertex * 3]
      groupPosition[group * 3 + 1] = shellPosition[vertex * 3 + 1]
      groupPosition[group * 3 + 2] = shellPosition[vertex * 3 + 2]
      groupInside[group] = Math.max(groupInside[group], shellInside[vertex])
    }
    const neighbours: number[][] = Array.from({ length: groups }, () => [])
    const seenEdge = new Set<number>()
    for (let i = 0; i < shellIndices.length; i += 3) {
      const corner = [
        weldOf[shellIndices[i]],
        weldOf[shellIndices[i + 1]],
        weldOf[shellIndices[i + 2]],
      ]
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          if (a === b || corner[a] === corner[b]) continue
          const pair = corner[a] * groups + corner[b]
          if (seenEdge.has(pair)) continue
          seenEdge.add(pair)
          neighbours[corner[a]].push(corner[b])
        }
      }
    }
    const nextPosition = new Float32Array(groups * 3)
    for (let pass = 0; pass < smoothPasses; pass++) {
      for (let group = 0; group < groups; group++) {
        const list = neighbours[group]
        // 옷단(insideWeight 0)은 붙잡아 둔다 — 움직이면 피부 밑에 묻어 둔 단이 튀어나온다.
        const rate = CLOTH.smoothRate * groupInside[group]
        if (!list.length || rate <= 0) {
          nextPosition[group * 3] = groupPosition[group * 3]
          nextPosition[group * 3 + 1] = groupPosition[group * 3 + 1]
          nextPosition[group * 3 + 2] = groupPosition[group * 3 + 2]
          continue
        }
        let sumX = 0
        let sumY = 0
        let sumZ = 0
        for (const other of list) {
          sumX += groupPosition[other * 3]
          sumY += groupPosition[other * 3 + 1]
          sumZ += groupPosition[other * 3 + 2]
        }
        const inverse = 1 / list.length
        for (let axis = 0; axis < 3; axis++) {
          const current = groupPosition[group * 3 + axis]
          const average = (axis === 0 ? sumX : axis === 1 ? sumY : sumZ) * inverse
          nextPosition[group * 3 + axis] = current + (average - current) * rate
        }
      }
      groupPosition.set(nextPosition)
    }

    /* 평활한 면의 법선을 삼각형에서 다시 잡는다. 웰드 그룹 단위라 솔기에 각진 선이 안 생긴다
       — computeVertexNormals()를 쓸 수 없었던 이유가 그거였다. */
    const groupNormal = new Float32Array(groups * 3)
    for (let i = 0; i < shellIndices.length; i += 3) {
      const a = weldOf[shellIndices[i]]
      const b = weldOf[shellIndices[i + 1]]
      const c = weldOf[shellIndices[i + 2]]
      const bx = groupPosition[b * 3] - groupPosition[a * 3]
      const by = groupPosition[b * 3 + 1] - groupPosition[a * 3 + 1]
      const bz = groupPosition[b * 3 + 2] - groupPosition[a * 3 + 2]
      const cx = groupPosition[c * 3] - groupPosition[a * 3]
      const cy = groupPosition[c * 3 + 1] - groupPosition[a * 3 + 1]
      const cz = groupPosition[c * 3 + 2] - groupPosition[a * 3 + 2]
      const fx = by * cz - bz * cy
      const fy = bz * cx - bx * cz
      const fz = bx * cy - by * cx
      for (const group of [a, b, c]) {
        groupNormal[group * 3] += fx
        groupNormal[group * 3 + 1] += fy
        groupNormal[group * 3 + 2] += fz
      }
    }
    for (let vertex = 0; vertex < count; vertex++) {
      const group = weldOf[vertex]
      shellPosition[vertex * 3] = groupPosition[group * 3]
      shellPosition[vertex * 3 + 1] = groupPosition[group * 3 + 1]
      shellPosition[vertex * 3 + 2] = groupPosition[group * 3 + 2]
      const length = Math.hypot(
        groupNormal[group * 3],
        groupNormal[group * 3 + 1],
        groupNormal[group * 3 + 2],
      )
      if (length < 1e-9) continue
      const source = sourceVertices[vertex]
      // 감김 방향이 반대인 자산도 있다 — 원본 법선과 부호를 맞춰 안팎이 뒤집히지 않게 한다.
      const sign = (groupNormal[group * 3] * normal.getX(source)
        + groupNormal[group * 3 + 1] * normal.getY(source)
        + groupNormal[group * 3 + 2] * normal.getZ(source)) < 0 ? -1 : 1
      shellNormal[vertex * 3] = (groupNormal[group * 3] / length) * sign
      shellNormal[vertex * 3 + 1] = (groupNormal[group * 3 + 1] / length) * sign
      shellNormal[vertex * 3 + 2] = (groupNormal[group * 3 + 2] / length) * sign
    }
  }

  /* ── 주름 결 (평활 **뒤에** 법선에만 넣는다) ────────────────────────────────
     지오메트리로 넣은 주름은 라플라시안이 그대로 지운다 — 평활은 젖꼭지를 감추려고
     반드시 켜야 하는데, 같은 필터가 주름도 같이 지워서 가운이 마시멜로 베개로 보였다.
     그래서 형상은 매끈하게 두고 **음영만** 결을 갖게 한다. 위치를 안 건드리니 모디스티도,
     경계도, 마커 판정도 영향이 없다.
     ⚠ 노멀맵이 아니라 정점 법선을 직접 트는 방식이다 — 탄젠트가 필요 없다.
     (`anisotropy`/노멀맵은 이 프로젝트에서 UV 없는 셸에 걸었다가 블랙아웃 전례가 있다) */
  const wrinkle = spec.wrinkle ?? CLOTH.wrinkle
  if (wrinkle > 0) {
    for (let vertex = 0; vertex < count; vertex++) {
      const inside = shellInside[vertex]
      if (inside <= 0) continue
      const px = shellPosition[vertex * 3]
      const py = shellPosition[vertex * 3 + 1]
      const pz = shellPosition[vertex * 3 + 2]
      const dx = px - spec.axisX
      const dz = pz - spec.axisZ
      const radius = Math.max(0.03, Math.hypot(dx, dz))
      const angle = Math.atan2(dx, dz)
      // 주기가 다른 세 파를 겹친다 — 하나면 골판지처럼 규칙적으로 보인다.
      const dWdAngle = wrinkle * (
        9 * Math.cos(angle * 9 + py * 22)
        + 0.5 * 17 * Math.cos(angle * 17 - py * 13 + 1.3)
        + 0.3 * 3 * Math.cos(angle * 3 + py * 41)
      ) * inside
      const dWdY = wrinkle * (
        22 * Math.cos(angle * 9 + py * 22)
        - 0.5 * 13 * Math.cos(angle * 17 - py * 13 + 1.3)
        + 0.3 * 41 * Math.cos(angle * 3 + py * 41)
      ) * inside
      // 수평 접선 = 몸통 축을 도는 방향. 세로 접선은 y축으로 근사한다.
      const tangentX = Math.cos(angle)
      const tangentZ = -Math.sin(angle)
      let nx = shellNormal[vertex * 3] - (tangentX * dWdAngle) / radius
      let ny = shellNormal[vertex * 3 + 1] - dWdY
      let nz = shellNormal[vertex * 3 + 2] - (tangentZ * dWdAngle) / radius
      const length = Math.max(1e-5, Math.hypot(nx, ny, nz))
      nx /= length
      ny /= length
      nz /= length
      shellNormal[vertex * 3] = nx
      shellNormal[vertex * 3 + 1] = ny
      shellNormal[vertex * 3 + 2] = nz
    }
  }

  const shellGeometry = new THREE.BufferGeometry()
  shellGeometry.setAttribute('position', new THREE.BufferAttribute(shellPosition, 3))
  shellGeometry.setAttribute('normal', new THREE.BufferAttribute(shellNormal, 3))
  if (shellUv) shellGeometry.setAttribute('uv', new THREE.BufferAttribute(shellUv, 2))
  shellGeometry.setAttribute('skinIndex', new THREE.BufferAttribute(shellSkinIndex, 4))
  shellGeometry.setAttribute('skinWeight', new THREE.BufferAttribute(shellSkinWeight, 4))
  shellGeometry.setIndex(shellIndices)
  shellGeometry.userData.patientGeometryOwned = true

  const shell = new THREE.SkinnedMesh(shellGeometry, makeClinicalGownMaterial(spec.name))
  shell.name = spec.name
  /* ClinicScene의 부위 앵커 레이캐스트가 이 천을 구분할 수 있게 표시한다.
     raycast 자체는 살려 둔다 — 어떻게 다룰지는 앵커 쪽에서 정한다.
     ⚠ 앵커 쪽 주의: 가운은 '숨김'이 아니라 **클리핑 평면**으로 걷어올린다(복부 진찰).
     잘려 보이지 않는 부분도 레이캐스트에는 그대로 맞으므로, 옷 슬롯 메시와 똑같이
     material.clippingPlanes로 판정해야 한다(ClinicScene의 garmentVisibleAt가 그 로직이다). */
  shell.userData.clinicalCloth = true
  shell.frustumCulled = false
  shell.castShadow = true
  shell.receiveShadow = true
  shell.visible = false
  shell.bindMode = skin.bindMode
  shell.position.copy(skin.position)
  shell.quaternion.copy(skin.quaternion)
  shell.scale.copy(skin.scale)
  const parent = skin.parent ?? skin
  // StrictMode 이중 실행에서 옷이 두 장 겹치지 않게 한다.
  for (const existing of [...parent.children]) {
    if (existing.name === spec.name) parent.remove(existing)
  }
  parent.add(shell)
  shell.updateMatrixWorld(true)
  // 스켈레톤은 스킨 메시와 공유한다 — patientSkeletonOwned를 찍지 않아야 정리 때 함께 죽지 않는다.
  shell.bind(skin.skeleton, skin.bindMatrix)
  return shell
}

/* 환자복 재단 치수 — 전부 본과 실측 프로파일에서 유도한다. */
interface GownPattern {
  hemY: number          // 아랫단 (대전자 높이)
  collarTopY: number    // 어깨·등 쪽 윗한계 (목 바로 아래)
  neckCutY: number      // 이 위로는 목 원통을 파낸다
  collarRadius: number
  scoopBottomY: number  // 앞 목선의 가장 깊은 지점
  scoopWidth: number    // 몸통 반폭 대비 스쿱이 퍼지는 폭
  openBottomY: number   // 흉부 진찰용 앞섶 개방의 아래끝
  openTopY: number      // 〃 위끝. 이 위는 천이 남아 어깨 요크·끈이 된다
  openHalfWidth: number // 〃 좌우 한계 (몸통 반폭 대비)
  openWidth: number     // 〃 퍼지는 폭
  openFalloff: number   // 〃 좌우 감쇠 지수. 1이면 V, 크면 넓은 보트넥이 된다
  axisX: number
  axisZ: number
  halfWidth: number
  halfDepth: number
  /** 그 높이에서 몸의 **가장 앞선 z**. 목선 깊이를 이 값 기준으로 재야 한다 —
   *  가슴 단면의 중심(axisZ)을 기준으로 삼으면 유방이 그 중심을 앞으로 끌어당겨
   *  위쪽 복장뼈가 '앞면이 아님'으로 판정되고, 거기만 천이 가로띠로 남는다(캡처 확인). */
  frontAt: (y: number) => number
  sleeveReach: number   // 어깨 본에서 소매 끝까지
  shoulderL: THREE.Vector3
  shoulderR: THREE.Vector3
}

function measureGownPattern(
  skin: THREE.SkinnedMesh,
  bind: Map<string, THREE.Vector3>,
  bodyScale: number,
): GownPattern | null {
  const clavicleL = pickBindBone(bind, ['claviclel', 'leftshoulder'])
  const clavicleR = pickBindBone(bind, ['clavicler', 'rightshoulder'])
  const chest = pickBindBone(bind, ['spine03', 'spine02', 'spine2'])
  const neck = pickBindBone(bind, ['neck01', 'neck'])
  const thigh = pickBindBone(bind, ['thighl', 'leftupleg'])
  const shoulderL = pickBindBone(bind, ['upperarml', 'leftarm'])
  const shoulderR = pickBindBone(bind, ['upperarmr', 'rightarm'])
  if (!clavicleL || !clavicleR || !chest || !neck || !thigh || !shoulderL || !shoulderR) return null

  const position = skin.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const skinIndex = skin.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const skinWeight = skin.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  if (!position) return null
  const armBones = collectArmBones(skin.skeleton)

  const supraY = (clavicleL.y + clavicleR.y) * 0.5
  const chestSpan = supraY - chest.y
  if (!(chestSpan > 0.05)) return null

  // 목 반지름과 가슴 단면 — 목선을 파려면 실제 굵기를 알아야 한다.
  let neckRadius = 0
  let chestMinX = Number.POSITIVE_INFINITY
  let chestMaxX = Number.NEGATIVE_INFINITY
  let chestMinZ = Number.POSITIVE_INFINITY
  let chestMaxZ = Number.NEGATIVE_INFINITY
  const chestSampleY = supraY - chestSpan * 0.4
  // 높이별 최전면 z — 목선 깊이의 기준이다(GownPattern.frontAt 주석 참조).
  const frontStep = 0.012
  const frontRows = new Map<number, number>()
  for (let vertex = 0; vertex < position.count; vertex++) {
    const y = position.getY(vertex)
    if (skinIndex && skinWeight && armWeightAt(skinIndex, skinWeight, armBones, vertex) > 0.5) continue
    const x = position.getX(vertex)
    const z = position.getZ(vertex)
    if (Math.abs(y - neck.y) < 0.018) {
      neckRadius = Math.max(neckRadius, Math.hypot(x - neck.x, z - neck.z))
    }
    if (Math.abs(y - chestSampleY) < 0.02) {
      chestMinX = Math.min(chestMinX, x)
      chestMaxX = Math.max(chestMaxX, x)
      chestMinZ = Math.min(chestMinZ, z)
      chestMaxZ = Math.max(chestMaxZ, z)
    }
    const frontKey = Math.round(y / frontStep)
    const front = frontRows.get(frontKey)
    if (front === undefined || z > front) frontRows.set(frontKey, z)
  }
  if (!(neckRadius > 0.02) || !Number.isFinite(chestMinX) || !Number.isFinite(chestMinZ)) return null
  const fallbackFront = (chestMinZ + chestMaxZ) * 0.5
  const frontAt = (y: number): number => {
    const key = Math.round(y / frontStep)
    // 이웃 행과 평균해 계단을 없앤다 — 목선이 톱니로 잘리면 안 된다.
    let sum = 0
    let seen = 0
    for (let step = -1; step <= 1; step++) {
      const value = frontRows.get(key + step)
      if (value === undefined) continue
      sum += value
      seen++
    }
    return seen ? sum / seen : fallbackFront
  }

  return {
    hemY: thigh.y - 0.03,
    collarTopY: neck.y - 0.015,
    neckCutY: supraY,
    collarRadius: neckRadius + 0.016,
    /* 앞 목선은 **2번째 갈비사이(ics2Ratio=0.22)보다 아래**로 파야 대동맥판·폐동맥판
       청진 부위가 목선 위로 드러난다. 이게 이 옷의 진짜 제약이다. */
    scoopBottomY: supraY - chestSpan * 0.30,
    scoopWidth: 0.9,
    /* 흉부 진찰에서는 같은 가운의 **앞섶만** 칼돌기 아래까지 연다. 어깨·소매·옆구리·아랫단은
       그대로 남으므로 밴드형 가리개처럼 튜브톱으로 읽히지 않고 배도 덮인 채로 있다.
       아래끝은 칼돌기보다 span의 15% 더 내려야 아래쪽 앞 폐야(lungAntRatios 0.78)가 나온다. */
    /* 아래끝은 **청진에 필요한 만큼만** 내린다. 종전 `chest.y - span*0.15`(칼돌기 아래)는
       배까지 넓게 열려 흉부 진찰에 불필요한 노출이 생겼다. 가장 아래 청진 부위가
       아래쪽 앞 폐야(ClinicScene lungAntRatios 0.78)이므로 거기서 span의 10%만 더 내린다
       — 천 두께(17mm)+옷단 말이가 그 부위를 덮지 않을 만큼의 여유다. */
    openBottomY: supraY - chestSpan * 0.88,
    /* 위끝 — 가장 높은 청진 부위가 2번째 갈비사이(ics2Ratio 0.22)다. 그 위로 천을 남겨야
       어깨 요크와 끈이 생겨 튜브톱으로 안 읽힌다. 쇄골·흉골상절흔은 목선 쪽이 파서 드러낸다. */
    openTopY: supraY - chestSpan * 0.12,
    /* 좌우 한계 — 심첨이 몸통 반폭의 0.85(ClinicScene mitralLateral)라 그보다는 넓어야 하지만,
       0.98로 두니 개방이 옆구리까지 닿아 **어깨 요크와 아랫단을 잇는 천이 없어졌다**:
       가운이 어깨패드·수건·허리띠 세 조각으로 끊겨 보였다(캡처 확인).
       0.9면 심첨 바깥으로 여유가 남으면서 옆구리에 세로 띠가 남아 한 벌로 이어진다. */
    openHalfWidth: 0.9,
    /* 심첨(승모판)은 빗장중간선 바깥 — ClinicScene mitralLateral=0.85(몸통 반폭 대비)다.
       V자로 파면 거기가 천 밑에 남는다. 넓은 보트넥이라야 4판막과 앞 폐야가 전부 열린다. */
    openWidth: 1.32,
    openFalloff: 2.8,
    axisX: (chestMinX + chestMaxX) * 0.5,
    axisZ: (chestMinZ + chestMaxZ) * 0.5,
    halfWidth: Math.max(0.05, (chestMaxX - chestMinX) * 0.5),
    halfDepth: Math.max(0.04, (chestMaxZ - chestMinZ) * 0.5),
    frontAt,
    sleeveReach: 0.135 * bodyScale,
    shoulderL,
    shoulderR,
  }
}

/** 환자복 상의 — 어깨·짧은 소매부터 대전자까지. 성별 무관하게 입는다.
 *
 *  같은 재단으로 셸을 **둘** 만든다. 목선 깊이만 다르다.
 *   · `medical_base_gown`      평상 목선. 두경부 진찰·복부 진찰(아랫단을 걷어올려 쓴다)
 *   · `medical_base_gown_open` 앞섶을 칼돌기 아래까지 연 것. 흉부 청진·타진
 *  흉부에서 가운을 통째로 벗기면(예전 방식) 어깨끈도 목선도 없는 밴드만 남아 튜브톱으로
 *  읽혔고, 배까지 드러났다. 앞섶만 여는 쪽이 실제 진찰 복장이고 노출도 부위에 한정된다. */
function createPatientGown(
  root: THREE.Group,
  bodyScale: number,
  waistY: number | null,
): THREE.SkinnedMesh | null {
  const skin = findSkinBodyMesh(root) as THREE.SkinnedMesh | null
  if (!skin?.isSkinnedMesh || !skin.skeleton) return null
  const pattern = measureGownPattern(skin, bindBonePositions(skin.skeleton), bodyScale)
  if (!pattern) return null

  /* 바지 허리선 아래는 천을 얇게 눌러 넣는다 — 이미 바지가 덮은 구간이라 두께만큼
     관통이 생긴다(첫 캡처에서 가운이 청바지를 뚫고 찢어진 것처럼 보였다). */
  const offsetScale = waistY === null
    ? undefined
    : (_x: number, y: number) => THREE.MathUtils.lerp(
        0.22,
        1,
        THREE.MathUtils.smoothstep(y, waistY - 0.02, waistY + 0.05),
      )

  const sleeveEdge = (x: number, y: number, z: number): number => {
    // 소매는 어깨 본에서 반경으로 자른다 — 수평으로 자르면 A포즈에서 비스듬히 잘린다.
    const left = Math.hypot(x - pattern.shoulderL.x, y - pattern.shoulderL.y, z - pattern.shoulderL.z)
    const right = Math.hypot(x - pattern.shoulderR.x, y - pattern.shoulderR.y, z - pattern.shoulderR.z)
    return pattern.sleeveReach - Math.min(left, right)
  }
  /* 몸통 재단 — 목선 아래끝(bottomY)·폭(width)·좌우 감쇠(falloff)만 바꿔 두 벌을 뽑는다.
     앞 중앙일수록 깊게 파이므로 어깨는 항상 천이 남고(=어깨끈) 등은 열리지 않는다. */
  const bodyEdge = (
    x: number, y: number, z: number,
    bottomY: number, width: number, falloff: number,
    frontOpenY?: number,
  ): number => {
    const hem = y - pattern.hemY
    const collar = pattern.collarTopY - y
    const neckHole = y > pattern.neckCutY
      ? Math.hypot(x - pattern.axisX, z - pattern.axisZ) - pattern.collarRadius
      : Number.POSITIVE_INFINITY
    // 그 높이의 최전면에서 얼마나 돌아 나갔는가. 옆·등으로 갈수록 0이 되어 목선이 안 파인다.
    const frontness = THREE.MathUtils.clamp(
      1 - (pattern.frontAt(y) - z) / (pattern.halfDepth * 0.8),
      0,
      1,
    )
    const lateral = THREE.MathUtils.clamp(
      1 - Math.pow(Math.abs(x - pattern.axisX) / (pattern.halfWidth * width), falloff),
      0,
      1,
    )
    /* 상한을 0.85로 두면 앞면 대부분이 포화해 목선이 **가로 일직선**으로 잘린다 —
       캡처에서 사각 구멍으로 보인 원인이다. 1에 가깝게 둬야 U자로 파인다. */
    const scoop = THREE.MathUtils.smoothstep(frontness * lateral, 0.04, 0.98)
    const necklineY = THREE.MathUtils.lerp(pattern.collarTopY, bottomY, scoop)
    const neckline = necklineY - y
    if (frontOpenY === undefined) return Math.min(hem, collar, neckHole, neckline)

    /* 앞섶 개방(흉부 진찰) — 목선과 **따로** 잡는다.
       목선처럼 좌우 감쇠를 태우면 개방 아래끝이 옆으로 갈수록 올라가는 U자가 되는데,
       청진 부위는 그 U자 바깥에 있다: 앞 폐야는 몸통 반폭의 0.62, 심첨은 0.85 지점이다.
       실측으로 `lung_ant_*_low`가 통째로 천 밑에 들어갔다. 그래서 아래끝은 가로 일직선이다.

       ⚠ 네 경계 전부 좌표에 **선형**이어야 한다. `frontness`(높이별 최전면 프로파일)로 열었더니
       그 프로파일이 12mm 버킷의 최댓값이라 계단·잡음이 있어 등고선이 삼각형마다 튀었고
       개방 둘레 전체가 **톱니**로 잘렸다(캡처 확인). 선형 항만 쓰면 등고선이 매끄럽다. */
    const opening = Math.max(
      frontOpenY - y,                                 // 아래끝 — 배는 덮인 채로 둔다
      y - pattern.openTopY,                           // 위끝 — 어깨 요크·끈을 남긴다
      pattern.axisZ - pattern.halfDepth * 0.3 - z,    // 등·옆은 열지 않는다
      Math.abs(x - pattern.axisX) - pattern.halfWidth * pattern.openHalfWidth,
    )
    return Math.min(hem, collar, neckHole, neckline, opening)
  }
  /* 두 벌 공통 — 가운은 몸에 붙지 않는다. 어깨에 걸려 가슴·배를 가로지르고,
     짜인 천이라 젖꼭지·갈비뼈 같은 잔요철을 따라가지 않는다. */
  const gownDrapeTuning = {
    // 0.7 + hangMax 28mm는 누빔 조끼처럼 부풀었다. 부풀림은 줄이고 평활로 잔요철을 지운다.
    hang: 0.45,
    hangRadiusX: pattern.halfWidth,
    hangRadiusZ: pattern.halfDepth,
    smooth: 5,
    hemFall: 0.014,
  }

  const gown = buildClothShell(skin, {
    name: 'medical_base_gown',
    axisX: pattern.axisX,
    axisZ: pattern.axisZ,
    offsetScale,
    ...gownDrapeTuning,
    // 앞 중앙일수록 목선이 깊게 파인다 → 빗장뼈·목아래패임·2번째 갈비사이가 드러난다.
    edge: (x, y, z, armWeight) => (armWeight > 0.5
      ? sleeveEdge(x, y, z)
      : bodyEdge(x, y, z, pattern.scoopBottomY, pattern.scoopWidth, 1)),
  })
  const gownOpen = buildClothShell(skin, {
    name: 'medical_base_gown_open',
    axisX: pattern.axisX,
    axisZ: pattern.axisZ,
    offsetScale,
    ...gownDrapeTuning,
    edge: (x, y, z, armWeight) => (armWeight > 0.5
      ? sleeveEdge(x, y, z)
      /* 목선은 평상 가운과 같은 재단을 쓰고(어깨끈·쇄골 노출이 그대로 유지된다),
         앞섶 개방만 따로 얹는다. */
      : bodyEdge(
          x, y, z,
          pattern.scoopBottomY, pattern.scoopWidth, 1,
          pattern.openBottomY,
        )),
  })
  if (gown && import.meta.env.DEV) {
    console.info(
      `[patient-garment] gown hem=${pattern.hemY.toFixed(3)}`
      + ` collar=${pattern.collarTopY.toFixed(3)} scoop=${pattern.scoopBottomY.toFixed(3)}`
      + ` open=${pattern.openBottomY.toFixed(3)}`
      + ` tris=${(gown.geometry.getIndex()?.count ?? 0) / 3}`
      + `/${(gownOpen?.geometry.getIndex()?.count ?? 0) / 3}`,
    )
  }
  return gown
}

/** 여성 흉부 드레이프 — 가운을 어깨에서 내렸을 때 유방 위에 남는 천. */
function createBreastDrape(root: THREE.Group): THREE.SkinnedMesh | null {
  const skin = findSkinBodyMesh(root) as THREE.SkinnedMesh | null
  if (!skin?.isSkinnedMesh || !skin.skeleton) return null
  const bind = bindBonePositions(skin.skeleton)
  const clavicleL = pickBindBone(bind, ['claviclel', 'leftshoulder'])
  const clavicleR = pickBindBone(bind, ['clavicler', 'rightshoulder'])
  const chest = pickBindBone(bind, ['spine03', 'spine02', 'spine2'])
  if (!clavicleL || !clavicleR || !chest) return null
  const band = measureModestyBand(skin, (clavicleL.y + clavicleR.y) * 0.5, chest.y)
  if (!band) return null

  const drape = buildClothShell(skin, {
    name: 'medical_base_chest_drape',
    axisX: band.centerX,
    axisZ: 0,
    /* 포락선 — 수건은 두 유방 **각각**을 감싸지 않는다. 위(유방 정점)에서 걸린 폭이
       아래까지 유지되며 가슴 사이 골과 유방 아래를 가로지른다. 평활만으로는 컵 두 개가
       남았다(팀리드 캡처 확인). 이게 브라와 수건을 가르는 구조적 차이다. */
    hang: 0.8,
    hangRadiusX: band.halfWidth,
    hangRadiusZ: band.halfDepth,
    // 유방 아래에서 천이 몸을 따라가면 안 된다 — 형태가 그대로 드러난다.
    bridge: 0.026,
    /* 평활을 세게 건다. 4회로는 두 유방을 각각 감싼 '성형된 컵'으로 읽혔다 — 실제 수건은
       두 봉우리를 하나의 면으로 가로지른다. 고주파를 더 지워 그 면을 만든다. */
    smooth: 7,
    // 아래 가장자리가 몸을 놓고 처져야 수건으로 보인다(브라 컵과 갈리는 지점이다).
    hemFall: 0.02,
    edge: (x, y, _z, armWeight) => {
      if (armWeight > 0.5) return -1
      return Math.min(y - band.hemAt(x), band.topAt(x) - y)
    },
  })
  if (drape && import.meta.env.DEV) {
    console.info(
      `[patient-garment] chest drape y=${band.minY.toFixed(3)}~${band.maxY.toFixed(3)}`
      + ` tris=${(drape.geometry.getIndex()?.count ?? 0) / 3}`,
    )
  }
  return drape
}

/* 환자복 원단 — 흰 바탕에 잔점. 캔버스 대신 DataTexture로 만들어 SSR/워커에서도 안전하다. */
function makeGownDotTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 8px 격자에 지름 2px 잔점. 서로 어긋난 두 격자를 겹쳐 규칙성을 흐린다.
      const dotA = Math.hypot((x % 16) - 4, (y % 16) - 4) < 1.6
      const dotB = Math.hypot(((x + 8) % 16) - 4, ((y + 8) % 16) - 4) < 1.4
      const value = dotA || dotB ? 214 : 252
      const offset = (y * size + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value - 2
      data[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = 'gown-dots'
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(22, 22)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** 환자복/드레이프 공통 재질. ⚠ anisotropy는 걸지 않는다 — 탄젠트 NaN으로 화면 전체가
 *  블랙아웃된 전례가 있다. 요철은 탄젠트가 필요 없는 bumpMap으로만 준다. */
/* 러프니스 잡음 — 균일 러프니스는 어느 밝기에서도 사출 플라스틱으로 보인다.
   실이 눕고 서는 방향에 따라 반사가 흩어지는 걸 흉내 낸다. `anisotropy`는 쓰지 않는다
   (UV 없는 오프셋 셸에서 탄젠트가 NaN이 되어 화면 전체가 검게 나온 전례가 두 번 있다). */
function makeClothRoughnessTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const thread = Math.sin(x * Math.PI * 0.5) * 9 + Math.sin(y * Math.PI * 0.42 + 1.1) * 7
      const speckle = (((x * 31 + y * 17 + ((x * y) % 13)) % 23) - 11) * 0.7
      const value = Math.round(THREE.MathUtils.clamp(234 + thread + speckle, 208, 255))
      const offset = (y * size + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = 'cloth-roughness-noise'
  texture.userData.patientTextureOwned = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(14, 16)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function makeClinicalGownMaterial(name: string): THREE.MeshPhysicalMaterial {
  /* 흉부 드레이프는 가운과 **다른 천**이라야 한다. 같은 무늬·같은 색이면 가운 가슴에
     네모난 구멍을 뚫은 것처럼 보인다 — 실제 진찰에서 유방 위에 덮는 건 별도의 수건이다. */
  const towel = name.includes('drape')
  const dots = towel ? null : makeGownDotTexture()
  const weave = makeCottonWeaveTexture()
  weave.repeat.set(towel ? 34 : 26, towel ? 38 : 30)
  if (dots) dots.userData.patientTextureOwned = true
  weave.userData.patientTextureOwned = true
  const material = new THREE.MeshPhysicalMaterial({
    color: towel ? '#dfe6e6' : '#eceae2',
    // roughnessMap이 곱해진다 — 최종 0.82~1.0. 면직물의 물리값 범위 안이다.
    roughness: 1,
    roughnessMap: makeClothRoughnessTexture(),
    metalness: 0,
    map: dots,
    bumpMap: weave,
    bumpScale: towel ? 0.0034 : 0.0022,
    side: THREE.DoubleSide,
    // 천은 sheen이 있어야 천으로 보인다 (lab/fresh M.fabric과 같은 계열)
    sheen: 0.5,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color('#f4f6f3'),
    envMapIntensity: 0.55,
  })
  material.name = name
  material.userData.patientMaterialOwned = true
  return material
}

/* ── 프라이버시 시트 (store의 clinicalGarments.privacyDrape 3D 반영) ──────────
   기존 드레이프는 골반 앞에 세운 평면 한 장이라 '바지를 벗은' 상태에서만 쓸모가 있었다.
   실제 진찰에서 시트는 자세를 따라간다: 누우면 두덩결합 아래부터 발목까지 덮고(배는
   진찰 부위라 노출된 채로 둔다), 앉으면 무릎 위 랩 드레이프가 된다.
   그래서 다리 경로(허리→무릎→발목)를 따라 천을 로프트한다. 경로 점은 **바인드 본**에서
   자세별 조준 방향으로 유도하므로 키·다리 길이가 다른 아바타에서도 따라간다. */
/* 경로 점은 **이미 천이 놓일 표면 좌표**다(본 위치 + 팔다리 반지름). 로프트에서는
   주름·흘러내림만 경로 법선 방향으로 얹는다 — 여유를 경로 법선으로 한꺼번에 밀면
   앉은 자세에서 법선이 위를 향해 시트가 배까지 타고 올라온다(실측으로 확인). */
interface DrapePathPoint {
  y: number     // 모델 공간 세로축 (서 있는 기준)
  z: number     // 모델 공간 앞뒤축 (+z = 배 쪽)
}

function makeClinicalSheetGeometry(
  halfWidth: number,
  path: readonly DrapePathPoint[],
): THREE.BufferGeometry {
  const alongSegments = 40
  const acrossSegments = 36
  // 경로를 구간 길이 비례로 리샘플한다(꺾이는 무릎 부근이 성기게 나오지 않게).
  const lengths: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(path[i].y - path[i - 1].y, path[i].z - path[i - 1].z))
  }
  const total = lengths[lengths.length - 1] || 1
  const sample = (t: number): { y: number; z: number; ny: number; nz: number } => {
    const distance = t * total
    let segment = 1
    while (segment < path.length - 1 && lengths[segment] < distance) segment++
    const a = path[segment - 1]
    const b = path[segment]
    const spanLength = Math.max(1e-5, lengths[segment] - lengths[segment - 1])
    const local = THREE.MathUtils.clamp((distance - lengths[segment - 1]) / spanLength, 0, 1)
    const ty = b.y - a.y
    const tz = b.z - a.z
    const tangent = Math.max(1e-5, Math.hypot(ty, tz))
    // 경로 법선 = 접선을 90° 돌린 것. 아래로 내려가면(-y) 법선은 +z(배/천장) 쪽을 본다.
    return {
      y: THREE.MathUtils.lerp(a.y, b.y, local),
      z: THREE.MathUtils.lerp(a.z, b.z, local),
      ny: tz / tangent,
      nz: -ty / tangent,
    }
  }

  /* 경로에서 **무릎이 어디쯤인지**(정규화 호길이) 찾아 둔다 — z 가 가장 배/천장 쪽인 점.
     아래 두 항이 이 값을 쓴다. 상수로 박으면 무릎 각도를 바꿀 때마다 어긋난다
     (실제로 무릎을 66°→45°로 눕히자 시트가 널빤지처럼 변했다). */
  let kneeT: number
  {
    let best = -Infinity, bestLen = 0
    for (let i = 0; i < path.length; i++) {
      if (path[i].z > best) { best = path[i].z; bestLen = lengths[i] }
    }
    kneeT = THREE.MathUtils.clamp(bestLen / total, 0.08, 0.92)
  }

  const geometry = new THREE.PlaneGeometry(1, 1, acrossSegments, alongSegments)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index++) {
    const u = position.getX(index) * 2          // -1 … 1 (좌우)
    const t = 0.5 - position.getY(index)        // 0 (허리) … 1 (자락 끝)
    const point = sample(t)
    /* 옆단이 직선이면 천이 아니라 판때기다. 길이 방향으로 폭을 흔들어 늘어진 자락을 만든다. */
    const width = halfWidth * (0.90 + 0.16 * t)
      * (1 + Math.sin(t * Math.PI * 2.3 + 1.1) * 0.03 + Math.sin(t * Math.PI * 5.1) * 0.015)
    /* 무릎 부근에서만 세게 걸리는 가중치. 허리·발목 쪽은 천이 침대에 가까워서
       여기서 크게 흔들면 매트리스를 뚫는다(§ 아래 실패 기록 참조). */
    const kneeBand = Math.exp(-Math.pow((t - kneeT) / 0.30, 2))
    /* ⚠️ **다리는 둘인데 종전 프로파일은 봉우리가 하나였다.**
       `cos(u·π/2)` 는 정중선이 가장 높은 단일 돔이라, 두 무릎 위에 덮인 천이 아니라
       한 장짜리 판때기로 읽혔다. 실제 시트는 **무릎마다 솟고 다리 사이가 꺼진다.**
       봉우리를 |u|≈0.42(다리 중심)에 두고 그 사이를 파 내려간다. */
    const twoHump = Math.exp(-Math.pow((Math.abs(u) - 0.42) / 0.28, 2))
    /* twoHump는 중앙(u=0)에서 ≈0.105로, `twoHump - 0.52`를 그대로 쓰면 -0.41로
       경로 법선 안쪽으로 밀어 다리를 뚫는 자기교차가 생긴다(블랙 슬래시 원인).
       `Math.max(0, …)`로 클리핑해 중앙이 경로 표면 위에 놓이게 한다.
       진폭은 0.028 — 무릎 두 봉우리가 구분되면서 자기교차가 안 나는 값(캡처 확인). */
    const legDrape = Math.max(0, twoHump - 0.52) * 0.028 * kneeBand
    /* 옆으로 흘러내리는 양은 **진찰대 높이보다 작아야 한다.** 11cm를 상수로 내렸더니 시트 옆단이
       매트리스 표면 아래로 파고들어 침대가 시트를 뚫고 뾰족한 쐐기로 보였다(f20_thin 실측).
       → 상수 대신 `kneeBand` 로 스케일한다. 천이 높이 떠 있는 무릎 위에서는 많이 흘러내리고
         침대에 가까운 허리·발목 쪽에서는 거의 안 내려간다. 그 실패의 원인은 값 자체가 아니라
         **낮은 구간에도 같은 값을 먹인 것**이었다.
       무릎 각도 45.4° 로 눕히면서 경로 법선 방향이 달라졌다 — 종전 0.052+0.070 은 너무 커서
       옆단이 경로 안쪽으로 깊이 파고들어 자루가 됐다. 0.018+0.022 로 줄인다. */
    const wrap = legDrape
      - Math.pow(Math.abs(u), 2.2) * (0.018 + 0.022 * kneeBand)
    /* 주름은 아래(자락)로 갈수록 벌어지고 몸에 눌린 위쪽은 잡혀 있다.
       ⚠ 단일 사인파는 버티컬 블라인드로 읽힌다(lab/fresh curtain()의 교훈).
       주기가 다른 파를 위상까지 어긋나게 겹쳐야 주름 간격이 불규칙해져 천이 된다. */
    const spread = 0.32 + 0.68 * t
    const folds = (
      Math.sin(u * Math.PI * 2.6 + t * 0.7)
      + Math.sin(u * Math.PI * 0.96 + 1.1) * 0.45
      + Math.sin(u * Math.PI * 4.3 + 2.3 - t * 1.4) * 0.22
    ) * 0.019 * spread
    // 길이 방향으로도 잔물결이 있어야 판때기로 안 보인다.
    const ripple = (
      Math.sin(t * Math.PI * 3.1 + u * 2.0)
      + Math.sin(t * Math.PI * 6.7 + u * 0.8) * 0.35
    ) * 0.007 * spread
    // 아래 솔기는 직선이 아니라 무게에 따라 불규칙하게 처진다.
    const hemWeight = Math.pow(t, 6)
    const hem = hemWeight * (0.02 + Math.sin(u * Math.PI * 4.1 + 0.6) * 0.014)
    const lift = wrap + folds + ripple
    position.setX(index, u * width)
    position.setY(index, point.y + point.ny * lift - hem)
    position.setZ(index, point.z + point.nz * lift)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.userData.patientGeometryOwned = true
  return geometry
}

function makeCottonWeaveTexture(): THREE.DataTexture {
  const size = 96
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = Math.sin(x * Math.PI * 0.96) * 12
      const weft = Math.sin(y * Math.PI * 0.88 + (x % 3) * 0.18) * 9
      const fiber = Math.sin((x * 1.7 + y * 2.3) * 0.41) * 3
      const value = Math.round(THREE.MathUtils.clamp(142 + warp + weft + fiber, 92, 196))
      const offset = (y * size + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = 'patient-cotton-weave'
  texture.userData.patientTextureOwned = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(26, 24)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

/* 옷 주름 — 직조(makeCottonWeaveTexture)와는 **주파수가 다른** 층이다.
   직조는 실 한 올 단위의 고주파라 가까이서만 보이고, 옷이 "천"으로 읽히게
   만드는 것은 그보다 훨씬 낮은 주파수의 **접힘**이다. 이게 없으면 아무리
   거칠기를 올려도 옷이 몸에 칠한 페인트나 진공 성형 껍데기처럼 보인다.

   실제 주름은 무작위 노이즈가 아니라 **한 방향으로 늘어진 골**이다(중력과
   관절 굽힘 방향). 그래서 세로로 길게 늘인 사인파를 서로 다른 주기로 겹치고,
   접힌 골이 갈라지도록 얇은 가지를 섞는다.

   ⚠ 노멀맵이 아니라 **범프맵**으로 쓴다. 노멀맵으로 만들려면 탄젠트 공간이
   필요한데 의상 메시마다 UV 방향이 제각각이라 주름이 엉뚱한 쪽으로 눕는다. */
function makeClothWrinkleTexture(): THREE.DataTexture {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      // 굵은 세로 골 두 겹 — 주기를 무리수 비로 두어 반복 티가 안 나게 한다.
      const major = Math.sin(u * Math.PI * 2 * 3 + Math.sin(v * Math.PI * 2 * 1.3) * 1.1) * 16
      const minor = Math.sin(u * Math.PI * 2 * 7.3 + Math.sin(v * Math.PI * 2 * 2.7) * 0.8) * 7
      // 가로로 눕는 접힘(허리·팔꿈치에 생기는 것) — 세로 골보다 약하게.
      const cross = Math.sin(v * Math.PI * 2 * 5.1 + Math.sin(u * Math.PI * 2 * 1.7) * 1.4) * 5
      // 골이 갈라지는 잔주름.
      const branch = Math.sin((u * 11.3 + v * 17.9) * Math.PI) * 2.5
      const value = Math.round(
        THREE.MathUtils.clamp(128 + major + minor + cross + branch, 88, 190),
      )
      const offset = (y * size + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = 'patient-cloth-wrinkle'
  texture.userData.patientTextureOwned = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // 주름은 옷 한 벌에 몇 개 수준이라 반복이 낮아야 한다(직조는 26×24).
  texture.repeat.set(3, 4)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

/* 주름·직조 텍스처는 의상마다 새로 만들 이유가 없다 — 한 장을 전 의상이 공유한다.
   (반복 횟수만 다르게 쓰고 싶으면 `.clone()` 해서 repeat 만 바꿔라.) */
let sharedWrinkleTexture: THREE.DataTexture | null = null
function clothWrinkleTexture(): THREE.DataTexture {
  if (!sharedWrinkleTexture) sharedWrinkleTexture = makeClothWrinkleTexture()
  return sharedWrinkleTexture
}

function makeClinicalSkirtGeometry(
  topRadius: number,
  bottomRadius: number,
  height: number,
): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, height, 48, 16, true)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const radius = Math.max(0.0001, Math.hypot(x, z))
    const angle = Math.atan2(z, x)
    const fromTop = THREE.MathUtils.clamp(0.5 - y / Math.max(height, 0.001), 0, 1)
    const fold = Math.sin(angle * 9) * 0.012 * fromTop
      + Math.sin(angle * 17 + fromTop * 2.4) * 0.0045 * fromTop
    const scale = (radius + fold) / radius
    position.setXYZ(index, x * scale, y, z * scale)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/**
 * MakeHuman GLB exports every surface with nearly the same glossy physical setup.
 * Rebalance each surface by what it represents so skin, wet eyes, hair cards and
 * cloth stop reflecting the room like the same plastic object.
 */
/**
 * 헤어 재질을 **물리 재질로 승격**한다. 아래 `case 'hair'` 의 이방성 이중 하이라이트는
 * `if (physical.isMeshPhysicalMaterial)` 안에 있어서, GLB 가 `MeshStandardMaterial` 로
 * 들여온 헤어에서는 **예외 하나 없이 조용히 건너뛰어졌다.**
 *
 * 실측(`scratchpad/hair_survey.mjs`, 17종 전수): **6종이 그렇게 빠져 있었다** —
 * `mh_m30·m40·m60·m70·f20·f20_thin`. 성인 남성 6명 중 4명이다. 남성 머리가 캡처마다
 * 납작한 헬멧으로 보인 게 취향 문제가 아니라 이것 때문이었다.
 *
 * ⚠️ three 의 함정 두 개를 피해야 한다. 둘 다 조용히 깨진다:
 *  1. **`MeshPhysicalMaterial.copy(standardMat)` 를 쓰면 안 된다.** 그 copy 는
 *     `this.ior = source.ior` 처럼 물리 전용 필드를 그대로 읽는데 표준 재질엔 없어서
 *     `undefined` 가 들어가고, 셰이더에서 NaN 이 된다. 그래서 **표준 단계의 copy 만**
 *     빌려 쓰고 물리 전용 값은 생성자 기본값으로 남긴다.
 *  2. **`defines` 를 되돌려야 한다.** `Material.copy` 가 `defines` 를 통째로 덮어써서
 *     물리 재질이 `{STANDARD:''}` 만 갖게 되고 `PHYSICAL` 이 사라진다 → 물리 셰이더가
 *     컴파일되지 않는다. 생성자가 만든 defines 를 보관했다가 다시 넣는다.
 */
function upgradeHairToPhysical(source: THREE.Material): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial
  if (!standard.isMeshStandardMaterial) return source.clone()
  if ((standard as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return source.clone()
  const physical = new THREE.MeshPhysicalMaterial()
  const physicalDefines = physical.defines
  THREE.MeshStandardMaterial.prototype.copy.call(physical, standard)
  physical.defines = { ...physicalDefines, ...(physical.defines ?? {}) }
  physical.needsUpdate = true
  return physical
}

function tunePatientMaterial(
  source: THREE.Material,
  kind: PatientMaterialKind,
  maxAnisotropy: number,
  options: PatientMaterialOptions = {},
): THREE.Material {
  const cloned = kind === 'hair' ? upgradeHairToPhysical(source) : source.clone()
  cloned.userData.patientMaterialOwned = true
  if (!isStandardMaterial(cloned)) return cloned

  const mat = cloned
  const physical = mat as THREE.MeshPhysicalMaterial
  setTextureDetail(mat, maxAnisotropy)

  // 눈·눈썹·속눈썹 아틀라스는 저알파 색을 겹쳐 만드는 MPFB 고유 방식이다.
  // 불투명/물리 재질로 재해석하면 홍채가 청회색 막처럼 변하므로 원본 블렌딩을 보존한다.
  if (kind === 'eye' || kind === 'brow' || kind === 'lash') {
    mat.needsUpdate = true
    return mat
  }

  mat.metalness = 0
  mat.depthTest = true
  mat.depthWrite = true
  mat.dithering = true
  mat.opacity = 1
  mat.alphaTest = 0
  mat.transparent = false
  mat.side = THREE.FrontSide

  if (physical.isMeshPhysicalMaterial) {
    physical.sheen = 0
    physical.clearcoat = 0
    physical.clearcoatRoughness = 1
    physical.iridescence = 0
  }

  switch (kind) {
    case 'skin': {
      const age = options.ageFactor ?? 0.3
      const identity = options.identitySeed ?? 0.5
      // 원본 GLB는 옷 아래 피부용 재질 슬롯에 짙은 갈색 baseColor를 따로 남긴다.
      // 전신 알베도를 교체할 때 그 색이 다시 곱해지지 않도록 모든 피부 슬롯을 중립화한다.
      if (mat.map) mat.color.setRGB(1, 1, 1)
      /* 환자별 피부톤. **텍스처 6장(young/middle/old × 남녀)을 17명이 돌려 쓴다** —
         그래서 이 색 변주가 "다른 사람"으로 읽히게 하는 거의 유일한 장치다.

         ⚠ 종전 폭은 ±1.4% 로 **사실상 눈에 안 보였다.** 실제 한국인 피부는 명도도
         언더톤도 그보다 훨씬 넓게 퍼져 있어서, 전원이 같은 톤으로 보이는 원인이었다.

         명도와 언더톤을 **서로 다른 시드**로 뽑는다. 같은 시드를 쓰면 "밝은 사람은 전부
         붉고 어두운 사람은 전부 노랗게" 붙어 다녀 조합이 절반으로 줄어든다.
         ⚠ 폭을 더 키우면 인종이 바뀐 것처럼 보인다 — 반드시 여러 아바타를 나란히 렌더해
           확인해라(tools/render_qa/face_shot.mjs). */
      const lightness = Math.sin(identity * Math.PI * 2 + 0.7)      // −1~+1
      const warmth = Math.sin(identity * Math.PI * 4.13 + 2.1)      // 붉은기 ↔ 푸른기
      const olive = Math.sin(identity * Math.PI * 6.37)             // 노란/올리브 기
      const lift = 1 + lightness * 0.062
      mat.color.multiply(new THREE.Color(
        lift * (1 + warmth * 0.030),
        lift * (1 + olive * 0.016),
        lift * (1 - warmth * 0.034),
      ))
      // AvatarLab의 원인 분리용. 제품 장면에서는 인자가 전달되지 않는다.
      if (options.debugSkinSurface === 'normalOff') mat.normalMap = null
      if (options.debugSkinSurface === 'albedoOff') {
        mat.map = null
        mat.color.set('#b98267')
      }
      if (options.debugSkinSurface === 'mapsOff' || options.debugSkinSurface === 'recomputeFlat') {
        mat.map = null
        mat.normalMap = null
        mat.roughnessMap = null
        mat.color.set('#b98267')
      }
      mat.roughness = THREE.MathUtils.lerp(0.64, 0.73, age)
      mat.envMapIntensity = THREE.MathUtils.lerp(0.4, 0.3, age)
      // 소스 노멀에는 절차적 모공과 사진 고주파가 이미 함께 구워져 있다.
      // 웹 조명에서 다시 강하게 증폭하면 피부가 사포처럼 보이고 UV 삼각 경계가
      // 드러나므로, 연령별 요철은 유지하되 실물 피부 범위로 절제한다.
      mat.normalScale.setScalar(THREE.MathUtils.lerp(0.46, 0.62, age))
      if (physical.isMeshPhysicalMaterial) {
        physical.ior = 1.4
        physical.specularIntensity = THREE.MathUtils.lerp(0.38, 0.3, age)
        physical.specularColor.set('#fff0e8')
        physical.clearcoat = THREE.MathUtils.lerp(0.06, 0.025, age)
        physical.clearcoatRoughness = THREE.MathUtils.lerp(0.72, 0.86, age)
      }
      // Uniform-material baseline for renderer/normal diagnostics. Keeping it
      // out of the custom shader makes the comparison geometry-only.
      if (options.debugSkinSurface === 'mapsOff' || options.debugSkinSurface === 'recomputeFlat') break
      const face = options.face
      const surfaceFace = options.surfaceFace ?? face
      const runtime: PatientRuntimeUniforms = {}
      const mouth = { value: 0 }
      const mouthRound = { value: 0 }
      const blink = { value: 0 }
      const mouthMood = { value: 0 }
      const gaze = { value: new THREE.Vector2() }
      const browRaise = { value: 0 }
      const browSlant = { value: 0 }
      if (face) {
        runtime.mouth = mouth
        runtime.mouthRound = mouthRound
        runtime.blink = blink
        runtime.mouthMood = mouthMood
        runtime.gaze = gaze
        runtime.browRaise = browRaise
        runtime.browSlant = browSlant
        cloned.userData.patientRuntimeUniforms = runtime
      }
      const compile = mat.onBeforeCompile
      mat.onBeforeCompile = (shader, renderer) => {
        compile.call(mat, shader, renderer)
        // 고해상도 노멀맵 위에 아주 낮은 진폭의 모공성 거칠기 변화를 더한다.
        // 색을 노이즈로 오염시키지 않고 하이라이트의 플라스틱 같은 균일함만 끊는다.
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          #ifdef USE_MAP
            float patientSkinMicroA = sin(vMapUv.x * 347.0 + vMapUv.y * 193.0);
            float patientSkinMicroB = sin(vMapUv.x * 151.0 - vMapUv.y * 419.0);
            float patientSkinMicro = patientSkinMicroA * patientSkinMicroB;
            roughnessFactor = clamp(roughnessFactor + patientSkinMicro * 0.018, 0.46, 0.96);
          #endif
          // PATIENT_FACE_ROUGHNESS`,
        )

        if (surfaceFace) {
          shader.uniforms.patientSurfaceAge = { value: age }
          shader.uniforms.patientSurfaceIdentity = { value: identity }
          shader.uniforms.patientSkinTZone = { value: skinTZoneOverride ?? SKIN_TZONE_OIL }
          shader.uniforms.patientSurfaceEyeLeft = { value: surfaceFace.eyeLeft }
          shader.uniforms.patientSurfaceEyeRight = { value: surfaceFace.eyeRight }
          shader.uniforms.patientSurfaceEyeRadius = { value: surfaceFace.eyeRadius }
          shader.uniforms.patientSurfaceMouthCenter = { value: surfaceFace.mouthCenter }
          shader.uniforms.patientSurfaceMouthRadius = { value: surfaceFace.mouthRadius }
          const detail = options.skinDetail ?? { moleSeed: 0.5, freckles: 0, beard: 0, flush: 0.4 }
          shader.uniforms.patientMoleSeed = { value: detail.moleSeed }
          shader.uniforms.patientFreckles = { value: detail.freckles }
          shader.uniforms.patientBeard = { value: detail.beard }
          shader.uniforms.patientFlush = { value: detail.flush }
          // 네이티브 얼굴 모프는 형상을 담당하고, 이 별도 varying은 피부 노화 마스크만 담당한다.
          // 따라서 입·눈 모프와 중복 변형 없이 모든 신형 MPFB 아바타에 적용된다.
          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <common>',
              `#include <common>
              varying vec3 vPatientAgePosition;
              varying vec3 vPatientAgeNormal;`,
            )
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
              vPatientAgePosition = position;`,
            )
            // 구강 내부 판정에 쓴다. objectNormal 은 이 청크 이후에 존재한다.
            .replace(
              '#include <beginnormal_vertex>',
              `#include <beginnormal_vertex>
              vPatientAgeNormal = objectNormal;`,
            )
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
              uniform float patientSurfaceAge;
              uniform float patientSurfaceIdentity;
              uniform float patientSkinTZone;
              uniform vec3 patientSurfaceEyeLeft;
              uniform vec3 patientSurfaceEyeRight;
              uniform vec2 patientSurfaceEyeRadius;
              uniform vec3 patientSurfaceMouthCenter;
              uniform vec2 patientSurfaceMouthRadius;
              uniform float patientMoleSeed;
              uniform float patientFreckles;
              uniform float patientBeard;
              uniform float patientFlush;
              varying vec3 vPatientAgePosition;
              varying vec3 vPatientAgeNormal;

              float patientSurfaceHash(vec2 value) {
                return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
              }

              /* 셀 하나에 **둥근** 알갱이 하나. 검버섯·주근깨·수염 그루터기가 전부
                 이걸 쓴다.

                 ⚠ 셀 해시 값을 그대로 임계값에 넣으면 자국이 **정사각형**으로
                 찍힌다 — 셀 안에서 값이 상수라 경계가 셀 경계와 같아지기 때문이다.
                 기존 검버섯(patientAgeSpot)이 정확히 그 상태로 나가고 있었고,
                 확대하면 노인 얼굴에 픽셀 블록이 깔려 있었다. 셀 안에 해시로
                 흔든 중심을 두고 거리로 falloff 를 줘야 점이 된다.

                 ⚠ AA 항이 필요하다. 셀이 픽셀보다 작아지면(멀리서 보거나 스치는
                 각도) 알갱이가 잡티로 번쩍인다 — 노년 헤어가 '수세미'로 보였던
                 것과 같은 원인이고, 같은 fwidth 방식으로 막는다. */
              float patientSpeckle(vec2 uv, vec2 density, float seed, float rarity) {
                vec2 scaled = uv * density + seed;
                vec2 cell = floor(scaled);
                float present = patientSurfaceHash(cell + seed);
                if (present < rarity) return 0.0;
                vec2 center = vec2(
                  patientSurfaceHash(cell + 11.3),
                  patientSurfaceHash(cell + 27.9)
                ) * 0.62 + 0.19;
                float radius = mix(0.17, 0.36, patientSurfaceHash(cell + 41.1));
                float dot0 = smoothstep(radius, radius * 0.3, length(fract(scaled) - center));
                float aa = 1.0 - smoothstep(0.3, 0.95, max(fwidth(scaled.x), fwidth(scaled.y)));
                return dot0 * aa;
              }

              /* 점 하나. 시드에서 위치·크기·유무를 뽑는다 — index 를 바꿔 여러 번
                 부르면 사람마다 개수와 자리가 다른 점이 생긴다.
                 좌표는 눈 간격으로 정규화한 얼굴 단위계다(x: 0=중앙, ±1=얼굴 가장자리 /
                 y: 0=눈높이, 음수=아래). */
              float patientMoleAt(vec2 unit, float seed, float index) {
                vec2 s = vec2(seed * 71.3 + index * 13.7, seed * 37.9 + index * 29.1);
                float present = patientSurfaceHash(s + 47.3);
                // 절반 조금 넘게만 실제로 찍힌다 — 모두가 점 3개를 갖고 있으면
                // 그것대로 균일해진다.
                if (present < 0.45) return 0.0;
                vec2 center = vec2(
                  mix(-0.86, 0.86, patientSurfaceHash(s)),
                  mix(-1.35, 0.95, patientSurfaceHash(s + 19.7))
                );
                vec2 delta = (unit - center) / mix(0.018, 0.032, present);
                return exp(-dot(delta, delta));
              }`,
            )
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
              #ifdef USE_MAP
                float patientAgeAmount = smoothstep(0.08, 0.98, patientSurfaceAge);
                float patientSeniorAmount = smoothstep(0.5, 1.0, patientSurfaceAge);
                float patientEyeSpan = max(
                  abs(patientSurfaceEyeLeft.x - patientSurfaceEyeRight.x),
                  patientSurfaceEyeRadius.x * 2.0
                );
                float patientFaceFront = smoothstep(
                  patientSurfaceEyeLeft.z - patientSurfaceEyeRadius.y * 0.35,
                  patientSurfaceEyeLeft.z + patientSurfaceEyeRadius.y * 0.72,
                  vPatientAgePosition.z
                );
                float patientFaceWidth = 1.0 - smoothstep(
                  patientEyeSpan * 0.72,
                  patientEyeSpan * 1.2,
                  abs(vPatientAgePosition.x)
                );

                vec2 patientUnderEyeL = (
                  vPatientAgePosition.xy
                  - patientSurfaceEyeLeft.xy
                  + vec2(0.0, patientSurfaceEyeRadius.y * 0.58)
                ) / (patientSurfaceEyeRadius * vec2(1.42, 0.72));
                vec2 patientUnderEyeR = (
                  vPatientAgePosition.xy
                  - patientSurfaceEyeRight.xy
                  + vec2(0.0, patientSurfaceEyeRadius.y * 0.58)
                ) / (patientSurfaceEyeRadius * vec2(1.42, 0.72));
                float patientUnderEyes = (
                  exp(-dot(patientUnderEyeL, patientUnderEyeL) * 2.15)
                  + exp(-dot(patientUnderEyeR, patientUnderEyeR) * 2.15)
                ) * patientFaceFront;

                float patientForehead = smoothstep(
                  patientSurfaceEyeLeft.y + patientSurfaceEyeRadius.y * 1.25,
                  patientSurfaceEyeLeft.y + patientSurfaceEyeRadius.y * 2.0,
                  vPatientAgePosition.y
                ) * (1.0 - smoothstep(
                  patientSurfaceEyeLeft.y + patientSurfaceEyeRadius.y * 5.1,
                  patientSurfaceEyeLeft.y + patientSurfaceEyeRadius.y * 6.7,
                  vPatientAgePosition.y
                )) * patientFaceWidth * patientFaceFront;
                float patientForeheadWave = 0.5 + 0.5 * sin(
                  (vPatientAgePosition.y - patientSurfaceEyeLeft.y)
                  / max(patientSurfaceEyeRadius.y, 0.0001) * 9.6
                  + patientSurfaceIdentity * 4.0
                );
                float patientForeheadLines = pow(patientForeheadWave, 13.0) * patientForehead;

                vec3 patientAgeEye = vPatientAgePosition.x >= 0.0
                  ? patientSurfaceEyeLeft
                  : patientSurfaceEyeRight;
                vec2 patientCrowDelta = (
                  vPatientAgePosition.xy - patientAgeEye.xy
                ) / patientSurfaceEyeRadius;
                float patientCrowBand = smoothstep(1.05, 1.42, abs(patientCrowDelta.x))
                  * (1.0 - smoothstep(1.42, 2.5, abs(patientCrowDelta.x)))
                  * (1.0 - smoothstep(0.25, 1.16, abs(patientCrowDelta.y)))
                  * patientFaceFront;
                float patientCrowLines = pow(
                  0.5 + 0.5 * sin(patientCrowDelta.y * 18.0 + abs(patientCrowDelta.x) * 2.8),
                  11.0
                ) * patientCrowBand;

                float patientFoldY = clamp(
                  (patientSurfaceEyeLeft.y - patientSurfaceEyeRadius.y * 0.75 - vPatientAgePosition.y)
                  / max(patientSurfaceEyeLeft.y - patientSurfaceMouthCenter.y, 0.0001),
                  0.0,
                  1.0
                );
                float patientFoldX = mix(
                  patientSurfaceEyeRadius.x * 0.62,
                  patientSurfaceMouthRadius.x * 0.88,
                  patientFoldY
                );
                float patientNasolabial = 1.0 - smoothstep(
                  patientSurfaceEyeRadius.x * 0.07,
                  patientSurfaceEyeRadius.x * 0.25,
                  abs(abs(vPatientAgePosition.x) - patientFoldX)
                );
                patientNasolabial *= smoothstep(0.08, 0.26, patientFoldY)
                  * (1.0 - smoothstep(0.76, 0.98, patientFoldY)) * patientFaceFront;

                float patientAgeSpot = patientSpeckle(
                  vMapUv,
                  vec2(173.0, 211.0),
                  patientSurfaceIdentity * 37.0,
                  0.972
                ) * patientFaceWidth * patientFaceFront
                  * smoothstep(
                    patientSurfaceMouthCenter.y - patientSurfaceMouthRadius.y,
                    patientSurfaceEyeLeft.y + patientSurfaceEyeRadius.y * 4.8,
                    vPatientAgePosition.y
                  );

                float patientAgeCrease = patientUnderEyes * 0.42
                  + patientForeheadLines * 0.34
                  + patientCrowLines * 0.38
                  + patientNasolabial * 0.32;
                diffuseColor.rgb *= 1.0 - patientAgeAmount * patientAgeCrease * 0.085;
                vec3 patientSpotColor = diffuseColor.rgb * vec3(0.74, 0.67, 0.58);
                diffuseColor.rgb = mix(
                  diffuseColor.rgb,
                  patientSpotColor,
                  patientAgeSpot * patientSeniorAmount * 0.26
                );

                /* ── 개인별 자국 (patientSkinDetail 참고) ──────────────────
                   피부 텍스처 6장을 17명이 공유하므로, 자국까지 텍스처에 맡기면
                   모두 같은 자리에 같은 점이 찍힌다. 여기서 개인 시드로 흩뿌린다. */
                vec2 patientFaceUnit = vec2(
                  vPatientAgePosition.x,
                  vPatientAgePosition.y - patientSurfaceEyeLeft.y
                ) / max(patientEyeSpan, 1e-4);
                // 눈알·눈꺼풀 위에는 점도 주근깨도 찍지 않는다.
                float patientEyeKeepOut = min(
                  smoothstep(0.62, 1.02, length(
                    (vPatientAgePosition.xy - patientSurfaceEyeLeft.xy)
                    / (patientSurfaceEyeRadius * vec2(1.5, 1.25))
                  )),
                  smoothstep(0.62, 1.02, length(
                    (vPatientAgePosition.xy - patientSurfaceEyeRight.xy)
                    / (patientSurfaceEyeRadius * vec2(1.5, 1.25))
                  ))
                );

                /* ── 눈꺼풀 붉은 라인 억제 ────────────────────────────────
                   눈테가 충혈처럼 붉던 것의 진짜 출처는 눈·속눈썹 메시가 아니라
                   **피부 텍스처의 눈꺼풀 가장자리 텍셀**이었다 — 눈 메시 빨강을
                   22% 눌러도 렌더가 안 변한 것이 근거다(2026-08-03).
                   눈 타원 안에서만, G·B 평균보다 튀는 빨강 초과분을 깎는다.
                   ⚠ 구강 붉은 띠 때 배운 것: 색 판정은 반드시 **알베도에서 상대
                   비교**로, 그리고 **랜드마크 마스크 안**에서만. 전역 임계값은
                   볼·입술까지 먹는다. patientEyeKeepOut 의 여집합이 곧 눈 주변이다. */
                float patientLidZone = 1.0 - patientEyeKeepOut;
                float patientLidRedExcess = max(
                  0.0,
                  diffuseColor.r - (diffuseColor.g + diffuseColor.b) * 0.58
                );
                /* 빨강만 깎으면 색상이 초록 쪽으로 돌아 눈 주변이 회녹색이 된다
                   (0.45 에서도 진료실 화면 전원에게 나타났다, 2026-11-09).
                   G·B 도 비율을 맞춰 함께 내려서 색상은 살빛에 두고 붉은기만 뺀다. */
                diffuseColor.rgb -= patientLidRedExcess * patientLidZone * vec3(0.30, 0.14, 0.08);

                float patientMoles = clamp(
                  patientMoleAt(patientFaceUnit, patientMoleSeed, 0.0)
                  + patientMoleAt(patientFaceUnit, patientMoleSeed, 1.0)
                  + patientMoleAt(patientFaceUnit, patientMoleSeed, 2.0),
                  0.0,
                  1.0
                ) * patientFaceFront * patientFaceWidth * patientEyeKeepOut;
                diffuseColor.rgb = mix(
                  diffuseColor.rgb,
                  diffuseColor.rgb * vec3(0.44, 0.36, 0.32),
                  patientMoles * 0.82
                );

                /* 주근깨 — 코·광대에만. 알갱이 자체는 위치에 의미가 없는 잡음이라
                   UV 고주파를 써도 안전하다(부위 판정은 랜드마크가 한다). */
                if (patientFreckles > 0.0) {
                  float patientFreckleBand = patientFaceFront * patientEyeKeepOut
                    * (1.0 - smoothstep(0.15, 0.95, abs(patientFaceUnit.y + 0.42)))
                    * (1.0 - smoothstep(0.55, 1.05, abs(patientFaceUnit.x)));
                  float patientFreckleDots = patientSpeckle(
                    vMapUv,
                    vec2(392.0, 476.0),
                    patientSurfaceIdentity * 53.0,
                    0.88
                  );
                  diffuseColor.rgb = mix(
                    diffuseColor.rgb,
                    diffuseColor.rgb * vec3(0.79, 0.68, 0.60),
                    patientFreckles * patientFreckleBand * patientFreckleDots * 0.6
                  );
                }

                /* 수염 자국 — 성인 남성 얼굴의 인상을 가장 크게 가르는데 지금까지
                   전혀 없어서 남성 환자가 전부 매끈한 소년처럼 보였다.
                   입 중심에서 살짝 내린 타원(턱·구레나룻까지)에서 입술만 뺀다. */
                if (patientBeard > 0.0) {
                  vec2 patientBeardDelta = (
                    vPatientAgePosition.xy
                    - patientSurfaceMouthCenter.xy
                    - vec2(0.0, patientSurfaceMouthRadius.y * 0.35)
                  ) / (patientSurfaceMouthRadius * vec2(2.5, 2.9));
                  float patientBeardMask = (1.0 - smoothstep(0.58, 1.06, length(patientBeardDelta)))
                    * patientFaceFront;
                  // 세로로 너무 퍼지면 콧등까지 그루터기가 올라간다 — 코 아래로 자른다.
                  patientBeardMask *= 1.0 - smoothstep(
                    patientSurfaceMouthCenter.y + patientSurfaceMouthRadius.y * 1.35,
                    patientSurfaceMouthCenter.y + patientSurfaceMouthRadius.y * 2.3,
                    vPatientAgePosition.y
                  );
                  // 입술 자체에는 수염이 안 난다.
                  patientBeardMask *= smoothstep(0.70, 1.04, length(
                    (vPatientAgePosition.xy - patientSurfaceMouthCenter.xy)
                    / (patientSurfaceMouthRadius * vec2(1.04, 0.94))
                  ));
                  float patientStubble = patientSpeckle(
                    vMapUv,
                    vec2(880.0, 1090.0),
                    7.0,
                    0.30
                  );
                  /* 면도 자국은 그냥 어두운 게 아니라 **채도가 빠진 푸른 회색**이다.
                     알갱이 항을 크게 잡으면 수염이 아니라 여드름처럼 보인다 —
                     은은한 그늘을 바탕으로 깔고 알갱이는 그 위에 얹는 비율이 맞다. */
                  diffuseColor.rgb = mix(
                    diffuseColor.rgb,
                    diffuseColor.rgb * vec3(0.66, 0.65, 0.70),
                    patientBeard * patientBeardMask * (0.40 + patientStubble * 0.33)
                  );
                }

                /* 볼·코 혈색 — 얼굴 전체가 한 톤이면 마네킹처럼 보인다.
                   구형 아바타 경로(vPatientFacePosition)에만 있던 것을 신형 MPFB
                   경로로 옮기고, 세기를 사람마다 다르게 준다. */
                vec2 patientFlushScale = vec2(
                  patientEyeSpan * 0.42,
                  patientSurfaceEyeRadius.y * 1.85
                );
                float patientFlushY = mix(
                  patientSurfaceMouthCenter.y,
                  patientSurfaceEyeLeft.y,
                  0.5
                );
                vec2 patientFlushL = (
                  vPatientAgePosition.xy
                  - vec2(patientSurfaceEyeLeft.x * 0.78, patientFlushY)
                ) / patientFlushScale;
                vec2 patientFlushR = (
                  vPatientAgePosition.xy
                  - vec2(patientSurfaceEyeRight.x * 0.78, patientFlushY)
                ) / patientFlushScale;
                float patientPerfusion = clamp(
                  (exp(-dot(patientFlushL, patientFlushL) * 1.8)
                    + exp(-dot(patientFlushR, patientFlushR) * 1.8)) * 0.34,
                  0.0,
                  0.5
                ) * patientFaceFront * patientFlush;
                diffuseColor.rgb *= mix(
                  vec3(1.0),
                  vec3(1.030, 0.986, 0.976),
                  patientPerfusion
                );

              #endif`,
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
              float patientAgeRoughnessMask = smoothstep(
                patientSurfaceMouthCenter.y - patientSurfaceMouthRadius.y,
                patientSurfaceEyeLeft.y + patientSurfaceEyeRadius.y * 5.5,
                vPatientAgePosition.y
              ) * (1.0 - smoothstep(
                abs(patientSurfaceEyeLeft.x - patientSurfaceEyeRight.x) * 0.74,
                abs(patientSurfaceEyeLeft.x - patientSurfaceEyeRight.x) * 1.12,
                abs(vPatientAgePosition.x)
              ));
              roughnessFactor = clamp(
                roughnessFactor + patientSurfaceAge * patientAgeRoughnessMask * 0.035,
                0.46,
                0.98
              );

              /* ⚠ **구강 내부를 랜드마크 마스크로 어둡게 하지 마라.** 2026-08-02 에
                 '입 타원 × 깊이'로 넣었다가 2026-08-03 에 제거했다 — 타원을 아래로
                 늘려야 입 안 바닥이 덮이는데, 그러면 **턱이 같이 걸린다.** 턱은
                 뒤로 말리는 면이라 깊이 판정에도 통과해서, 얼굴에 갈색 그림자가
                 번졌다(사용자가 여러 번 지적). 잇몸 쪽(teeth 재질의 채도 판정)은
                 부작용이 없어 남겨 뒀다.
                 다시 시도한다면 마스크가 아니라 **jawOpen 모프 값**으로 게이트를
                 걸고, 반드시 진료실에서 입 주변을 **확대**해 확인해라 — 낮은 배율
                 A/B 로는 이 번짐이 안 보여서 한 번 놓쳤다.
                 ⚠ 이 블록은 JS 템플릿 리터럴 안이다 — 주석에 백틱을 쓰면 문자열이 끊긴다. */

              /* T존 유분 — 이마·콧등·인중·턱은 볼보다 기름지다. 거칠기가 얼굴 전체에서
                 균일하면 하이라이트가 한 덩어리로 뭉쳐 **분칠한 마네킹**처럼 보인다.
                 실제 얼굴에서 "살아 있다"는 인상의 상당 부분이 이 반사 대비다.
                 랜드마크(눈·입) 기준 오브젝트 공간 마스크라 UV 레이아웃과 무관하고,
                 얼굴 앞면에만 걸리므로 몸통·뒤통수에는 영향이 없다.
                 ⚠ 값을 올리면 이마가 젖은 것처럼 번들거린다 — 렌더로 확인해라. */
              float patientTSpan = max(
                abs(patientSurfaceEyeLeft.x - patientSurfaceEyeRight.x),
                patientSurfaceEyeRadius.x * 2.0
              );
              float patientTEyeY = patientSurfaceEyeLeft.y;
              float patientTEyeR = max(patientSurfaceEyeRadius.y, 1e-4);
              float patientTFront = smoothstep(
                patientSurfaceEyeLeft.z - patientTEyeR * 0.2,
                patientSurfaceEyeLeft.z + patientTEyeR * 0.9,
                vPatientAgePosition.z
              );
              // 콧등에서 턱으로 내려오는 좁은 세로 띠
              float patientTStrip =
                (1.0 - smoothstep(patientTSpan * 0.14, patientTSpan * 0.44, abs(vPatientAgePosition.x)))
                * (1.0 - smoothstep(patientTEyeY + patientTEyeR * 4.2,
                                    patientTEyeY + patientTEyeR * 6.4,
                                    vPatientAgePosition.y));
              // 이마 — 눈썹 위로 넓게
              float patientTBrow =
                smoothstep(patientTEyeY + patientTEyeR * 1.3,
                           patientTEyeY + patientTEyeR * 2.8, vPatientAgePosition.y)
                * (1.0 - smoothstep(patientTEyeY + patientTEyeR * 4.6,
                                    patientTEyeY + patientTEyeR * 6.2, vPatientAgePosition.y))
                * (1.0 - smoothstep(patientTSpan * 0.5, patientTSpan * 0.95,
                                    abs(vPatientAgePosition.x)));
              float patientTZone = clamp(max(patientTStrip, patientTBrow), 0.0, 1.0) * patientTFront;
              // 피지 분비는 나이가 들수록 줄어 노년 피부는 더 건조하다.
              roughnessFactor = clamp(
                roughnessFactor - patientTZone * patientSkinTZone * mix(1.0, 0.45, patientSurfaceAge),
                0.34,
                0.98
              );`,
            )
        }
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          float patientSkinFresnel = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.060, 0.018, 0.012) * patientSkinFresnel;`,
        )
      }
      // SSS 는 세 경로 모두에 들어가므로 키를 전부 올린다.
      mat.customProgramCacheKey = () => face
        ? 'patient-skin-face-rig-v13-age-tzone'
        : surfaceFace
          ? 'patient-skin-native-v8-lidred'
          : 'patient-skin-scatter-v3'
      break
    }
    case 'hair': {
      const age = options.ageFactor ?? 0.3
      const identity = options.identitySeed ?? 0.5
      const greyBlend = THREE.MathUtils.smoothstep(age, 0.42, 1)
      mat.roughness = THREE.MathUtils.lerp(0.84, 0.78, age)
      mat.envMapIntensity = 0.14
      /* 나이든 흑발은 **전체가 조금 밝아질 뿐** 가닥마다 흰 점이 박히지 않는다.
       * 예전 값(#aaa6a4 로 0.62)은 60대에서 색을 (37,37,37) → 약 (98,96,95) 까지
       * 끌어올렸고, 그 밝기에서 알파로 잘린 가는 가닥 끝이 배경과 대비되어
       * **머리가 수세미처럼** 보였다 — f50(블런트 밥, 같은 텍스처·같은 폴리곤)은
       * 멀쩡한데 f60·f70 만 그랬던 이유가 이것이고, 컷오프를 훑어도 안 변한 이유다.
       * 대비를 낮춰 잡티를 없애고, 나이 신호는 뒤의 sheen 이 이어받는다.
       * ⚠ 값을 올릴 거면 반드시 f60·f70 을 렌더로 확인해라. */
      const greyTarget = hairGreyOverride?.color ?? '#8f8b88'
      const greyStrength = hairGreyOverride?.strength ?? 0.38
      mat.color.lerp(new THREE.Color(greyTarget), greyBlend * greyStrength)
      if (hairDebug === 'noNormal' || hairDebug === 'flat') mat.normalMap = null
      if (physical.isMeshPhysicalMaterial) {
        physical.sheen = hairDebug === 'noSheen' || hairDebug === 'flat'
          ? 0
          : THREE.MathUtils.lerp(0.11, 0.2, age)
        physical.sheenColor.set(age > 0.65 ? '#d4d0ce' : '#716b68')
        physical.sheenRoughness = THREE.MathUtils.lerp(0.82, 0.68, age)
        physical.specularIntensity = THREE.MathUtils.lerp(0.18, 0.25, age)
        if (hairDebug === 'noAniso' || hairDebug === 'flat') {
          physical.anisotropy = 0
        } else if (mat.map) {
          // UV의 V축을 따라 흐르는 가닥에 맞춘 이방성 이중 하이라이트.
          // 주의: 텍스처(UV) 없는 헤어(hair_05 등)에 걸면 탄젠트 도함수가 NaN이 되어
          // Bloom/AO가 화면 전체를 검게 만든다 (m40 블랙스크린의 원인).
          physical.anisotropy = THREE.MathUtils.lerp(0.48, 0.34, age)
          physical.anisotropyRotation = Math.PI / 2
        } else {
          physical.anisotropy = 0
        }
      }
      /* ⚠️ **알파 블렌딩(`transparent` + `depthWrite:false`)을 쓰지 않는다.**
       * 종전 주석은 "긴 머리의 반투명 가닥은 컷아웃보다 알파 블렌딩이 자연스럽다"였다.
       * 가닥 하나만 보면 맞는 말이지만, **깊이 기록을 끄면 카드가 서로·몸과 정렬되지 않는다.**
       * 그 결과 뒤통수 쪽 카드가 어깨·목 위에 덧그려져 **검은 깃털 얼룩**이 번졌다
       * (캡처 `scratchpad/look/crop.png` 에서 어깨·쇄골에 뚜렷하다).
       * 부드러운 가닥 끝 하나를 얻으려다 얼굴 옆 전체를 더럽히는 거래였다.
       *
       * 알파 테스트로 바꾸면 깊이가 제대로 기록돼 정렬이 맞는다. 가장자리가 조금 단단해지지만
       * 얼룩이 사라지는 쪽이 훨씬 낫다.
       * ⚠ `alphaTest` 를 올리면 가는 가닥이 통째로 사라진다. 내리면 얼룩이 돌아온다.
       *   바꿨으면 반드시 얼굴 옆·어깨 크롭을 눈으로 확인해라. */
      mat.transparent = false
      mat.depthWrite = true
      mat.alphaTest = hairAlphaTestOverride ?? HAIR_CORE_ALPHA_TEST
      /* 가닥 결을 세운다. toigo 계열은 베이크된 노멀맵을 갖고 있는데 기본
         강도로는 덩어리로 보인다 — 결이 보여야 '머리카락'으로 읽힌다. */
      if (mat.normalMap) mat.normalScale.setScalar(1.6)
      mat.alphaToCoverage = hairA2COverride ?? false
      mat.side = THREE.DoubleSide
      const time = { value: 0 }
      const motion = { value: 0 }
      if (options.longHair) {
        const runtime: PatientRuntimeUniforms = { time, motion }
        cloned.userData.patientRuntimeUniforms = runtime
      }
      const compile = mat.onBeforeCompile
      mat.onBeforeCompile = (shader, renderer) => {
        compile.call(mat, shader, renderer)
        shader.uniforms.patientHairAge = { value: age }
        shader.uniforms.patientHairIdentity = { value: identity }
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
          uniform float patientHairAge;
          uniform float patientHairIdentity;

          float patientHairHash(float value) {
            return fract(sin(value * 91.3458) * 47453.5453);
          }`,
        )
        if (options.longHair) {
          shader.uniforms.patientHairTime = time
          shader.uniforms.patientHairMotion = motion
          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <common>',
              `#include <common>
              uniform float patientHairTime;
              uniform float patientHairMotion;`,
            )
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
              float patientLooseHair = 1.0 - smoothstep(1.04, 1.35, position.y);
              float patientHairWave = sin(patientHairTime * 0.74 + position.y * 16.0 + position.x * 7.0)
                + sin(patientHairTime * 0.39 + position.z * 19.0) * 0.45;
              transformed.x += patientHairWave * patientLooseHair * patientHairMotion * 0.00125;
              transformed.z += sin(patientHairTime * 0.57 + position.y * 13.0)
                * patientLooseHair * patientHairMotion * 0.0007;`,
            )
        }
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            #ifdef USE_MAP
              float patientHairFine = sin(
                vMapUv.y * 360.0 + sin(vMapUv.x * 71.0) * 2.4
              );
              float patientHairBroad = sin(
                vMapUv.x * 67.0 + vMapUv.y * 31.0
              );
              float patientHairStrand = patientHairFine * 0.68 + patientHairBroad * 0.32;
              diffuseColor.rgb *= 0.975 + patientHairStrand * 0.045;
              /* 흰머리 — 예전에는 UV를 228칸으로 floor해 20%의 칸을 통째로 밝게 칠했다.
                 짧은 머리처럼 UV 한 칸이 넓은 에셋에서는 그게 두피에 그어진 **하드에지 흰 줄무늬**가
                 되어 니트 비니/수영모처럼 보였다(mh_m60·mh_m70 지적).
                 → 칸을 훨씬 잘게 쪼개 '가닥 한 올'이 되게 하고, 경계를 부드럽게, 세기도 낮춘다.
                 전체적인 백발화는 아래 mat.color 의 회색 보간이 담당한다. */
              float patientHairCellCoord = vMapUv.x * 1450.0 + patientHairIdentity * 97.0;
              float patientSilverSeed = patientHairHash(floor(patientHairCellCoord));
              /* ⚠ **셀이 픽셀보다 작아지면 이 해시는 흰머리가 아니라 화면 노이즈다.**
                 1450칸은 얼굴 클로즈업에서나 '가닥 한 올'이지, 진료실 거리에서는
                 한 픽셀 안에 여러 칸이 들어와 **머리가 수세미처럼** 지글거렸다
                 (f60·f70 만 그랬던 이유 — 이 항은 patientHairAge 로 열린다.
                 같은 에셋·같은 텍스처를 쓰는 f20_thin 은 나이가 낮아 멀쩡했다).
                 화면에서 셀 폭을 재서 서브픽셀이 되면 끈다. 그 거리에서의 백발은
                 위 mat.color 의 회색 보간이 대신 표현한다. */
              float patientSilverAA = 1.0 - smoothstep(0.35, 1.0, fwidth(patientHairCellCoord));
              float patientSilverAmount = smoothstep(0.44, 1.0, patientHairAge)
                * smoothstep(0.52, 0.98, patientSilverSeed)
                * (0.55 + 0.45 * (patientHairStrand * 0.5 + 0.5))
                * patientSilverAA;
              float patientHairLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
              vec3 patientSilver = mix(
                vec3(patientHairLuma),
                vec3(0.62, 0.61, 0.6),
                0.56
              );
              diffuseColor.rgb = mix(diffuseColor.rgb, patientSilver, patientSilverAmount * 0.34);
            #endif`,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            #ifdef USE_MAP
              roughnessFactor = clamp(
                roughnessFactor - patientHairStrand * 0.045,
                0.58,
                1.0
              );
            #endif`,
          )

      }
      mat.customProgramCacheKey = () => options.longHair
        ? 'patient-hair-strands-motion-v5-age'
        : 'patient-hair-strands-v5-age'
      break
    }
    /* ⚠ **입 안은 그늘이다.** 종전에는 치아를 `#eadfce` 로 더 밝히고 clearcoat 광택까지
     * 얹었는데, 그러면 살짝 벌어진 입에서 치아가 **밝은 흰 띠**로 튀어나온다
     * (요로결석처럼 통증 표정이 턱을 벌리는 케이스에서 특히 — 진찰 거리에서는
     *  "입술을 가로지르는 흰 조각"으로 읽혔다).
     * 화면에서 치아가 차지하는 건 몇 픽셀짜리 띠라, 거기 광택을 주면 그 띠 전체가 번진다.
     * 실제로 입 안에 들어오는 빛은 거의 없다 — 어둡게 깔고 광택을 없앤다. */
    case 'teeth': {
      mat.color.lerp(new THREE.Color('#8f8578'), 0.42)
      mat.roughness = 0.62
      mat.envMapIntensity = 0.14
      if (physical.isMeshPhysicalMaterial) {
        physical.clearcoat = 0
        physical.specularIntensity = 0.12
        physical.specularColor.set('#fff8ed')
      }

      /* ── 잇몸 ────────────────────────────────────────────────────────────
         입이 벌어지면 아래 잇몸이 **납작한 산호색 판때기**가 되어 입 안을
         가득 채웠다. 진찰 거리에서 "입술을 가로지르는 밝은 조각"으로 읽히던
         것의 정체가 이것이다.

         ⚠ 범인을 찾는 데 세 번 틀렸다. 기록으로 남긴다:
           · 피부 메시라고 봤다 → 피부 셰이더에서 마스크를 색으로 출력해 보니
             그 판때기는 **색이 안 바뀐다**. 피부가 아니다.
           · 혀라고 봤다 → hideKind=tongue 이 useFrame 에 덮여 무시되고 있었다.
             그걸 고치고 다시 찍으니 혀를 숨겨도 **그대로 남는다**. 혀도 아니다.
           · 실제로는 teeth_base 아틀라스의 잇몸이다. 위 mat.color.lerp 가
             에나멜을 위해 전체를 밝히는데, 그게 짙은 잇몸까지 같이 들어올려
             산호색으로 만들고 있었다.

         에나멜과 잇몸은 **채도로 깨끗하게 갈린다** — 알베도 텍스처에서 직접
         잰 분포가 채도 0.1 이하 65%(에나멜·여백)와 0.4~0.8(잇몸)으로
         완전히 떨어져 있다. 입술 대 볼처럼 붙어 있는 경우와 달라서 임계값이
         안전하다.
         ⚠ 비율은 반드시 **알베도**에서 재라. 렌더 화면에서 재면 조명·톤매핑이
         섞인 값을 보게 된다 — 예전 시도가 그래서 볼에 얼룩을 만들었다. */
      const compileTeeth = mat.onBeforeCompile
      mat.onBeforeCompile = (shader, renderer) => {
        compileTeeth.call(mat, shader, renderer)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          #ifdef USE_MAP
            float patientGumMax = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
            float patientGumMin = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
            float patientGumSat = patientGumMax > 1e-4
              ? (patientGumMax - patientGumMin) / patientGumMax
              : 0.0;
            float patientGum = smoothstep(0.25, 0.45, patientGumSat);
            // 입 안은 빛이 거의 안 드는 공동이다. 잇몸만 그늘로 눌러 앉힌다.
            diffuseColor.rgb = mix(
              diffuseColor.rgb,
              diffuseColor.rgb * vec3(0.34, 0.22, 0.22),
              patientGum
            );
          #endif`,
        )
      }
      mat.customProgramCacheKey = () => 'patient-teeth-gum-shadow-v1'
      break
    }
    /* 잇몸·혀의 채도 높은 분홍이 입꼬리에서 **자홍색 블록**으로 튄다. 같은 이유로
       어둡게 깔고 채도를 죽인다. */
    case 'tongue':
      mat.color.lerp(new THREE.Color('#6b4a46'), 0.45)
      mat.roughness = 0.72
      mat.envMapIntensity = 0.1
      if (physical.isMeshPhysicalMaterial) {
        physical.clearcoat = 0
        physical.specularIntensity = 0.08
      }
      break
    case 'fabric':
      /* ⚠ **옷을 투명 큐에 두지 마라.** GLB 의 의상 재질이 전부 alphaMode=BLEND 로
         나오는데, 셔츠·바지는 불투명한 옷이라 블렌딩이 필요 없다. 투명 큐에 두면
         헤어 프린지(반투명, depthWrite=off)와 정렬 경쟁이 생기고, 겹친 옷끼리
         지퍼처럼 번갈아 뚫린다. 불투명으로 돌리면 깊이를 쓰므로 정렬이 결정적이 된다.
         (참고: 머리 실루엣의 흰 점은 이걸로 **안 없어졌다** — 그건 정렬이 아니라
         다른 원인이다. 이 변경은 정렬 정확성 자체로 유지한다.) */
      mat.transparent = false
      mat.depthWrite = true
      mat.roughness = 0.86
      mat.envMapIntensity = 0.2
      mat.normalScale.setScalar(0.82)
      if (physical.isMeshPhysicalMaterial) {
        physical.sheen = 0.08
        physical.sheenColor.set('#aeb5bd')
        physical.sheenRoughness = 0.92
      }
      /* 주름을 넣어야 옷이 천으로 읽힌다. 기증자 의상 대부분은 노멀맵도 범프맵도
         없어서, 거칠기만 올려 놓은 **매끈한 껍데기**로 나가고 있었다 — 진찰
         거리에서 옷이 몸에 칠한 페인트처럼 보이던 원인이다.
         ⚠ 이미 맵을 가진 의상(청바지 데님 등)은 건드리지 않는다. 덮어쓰면
         원단 고유의 결을 지우게 된다. */
      if (!mat.normalMap && !mat.bumpMap) {
        mat.bumpMap = clothWrinkleTexture()
        // `?clothBump=0.02` 로 스윕한다. 올리면 주름이 아니라 우글거리는 요철이
        // 되므로 반드시 진료실 렌더로 확인해라(AvatarLab 은 조명이 다르다).
        mat.bumpScale = clothBumpOverride ?? CLOTH_WRINKLE_BUMP
        if (import.meta.env.DEV) {
          console.info(`[patient-garment] wrinkle bump on ${mat.name} = ${mat.bumpScale}`)
        }
      }
      break
  }

  mat.needsUpdate = true
  return mat
}

/** MPFB의 저알파 얼굴 아틀라스를 그대로 보존하면서 눈·눈꺼풀·눈썹만 GPU에서 움직인다. */
function tuneMpfbFaceOverlay(
  source: THREE.Material,
  kind: 'eye' | 'brow' | 'lash',
  maxAnisotropy: number,
  face: MpfbFaceLandmarks,
  options: { ageFactor?: number; identitySeed?: number } = {},
): THREE.Material {
  const cloned = source.clone()
  cloned.userData.patientMaterialOwned = true
  setTextureDetail(cloned, maxAnisotropy)
  if (!isStandardMaterial(cloned)) return cloned

  const mat = cloned
  mat.dithering = true
  if (kind !== 'eye') {
    mat.transparent = true
    mat.depthWrite = false
    mat.metalness = 0
    mat.roughness = 1
    mat.envMapIntensity = 0.04
    const physical = mat as THREE.MeshPhysicalMaterial
    if (physical.isMeshPhysicalMaterial) {
      physical.specularIntensity = kind === 'lash' ? 0.025 : 0.07
      physical.clearcoat = 0
    }
    // 속눈썹 아틀라스도 적갈색이라 눈테가 충혈처럼 붉었다 — 검은 갈색으로 누른다.
    if (kind === 'lash') mat.color.setRGB(0.62, 0.72, 0.82)

    /* 눈썹은 머리와 **같이** 세야 한다. 예전에는 'hair'만 나이로 회색화하고
     * 눈썹·속눈썹은 손대지 않아서, 백발에 가까운 70대 환자가 새까만 눈썹을
     * 달고 나왔다 — 노년 아바타에서 가장 먼저 눈에 띄는 위화감이었다.
     * 회색화 곡선은 'hair'와 동일한 값을 쓴다(같은 나이에 같은 만큼 세도록).
     * 눈썹 색을 파이프라인에서 굽지 않고 여기서 처리하는 이유: 나이의
     * 단일 출처를 런타임에 두어야 이중 회색화가 생기지 않는다. */
    const age = options.ageFactor ?? 0.3
    const identity = options.identitySeed ?? 0.5
    const greyBlend = THREE.MathUtils.smoothstep(age, 0.42, 1)
    const greyTarget = hairGreyOverride?.color ?? '#8f8b88'
    const greyStrength = hairGreyOverride?.strength ?? 0.38
    // 속눈썹은 눈썹만큼 세지 않는다 — 실제로도 마지막까지 색이 남는 편이다.
    const greyScale = kind === 'lash' ? 0.45 : 1
    mat.color.lerp(new THREE.Color(greyTarget), greyBlend * greyStrength * greyScale)

    /* 사람마다 눈썹 농도가 다르다. 자산은 하나를 공유하더라도 이 정도 편차가
     * 있어야 17명이 한 사람처럼 보이지 않는다. 한국인 범위라 폭은 좁게 잡는다
     * (밝기 ±7%, 갈색 기운 ±3%). */
    if (kind === 'brow') {
      const density = Math.sin(identity * Math.PI * 2 + 1.3)
      const warmth = Math.sin(identity * Math.PI * 3.7 + 0.4)
      mat.color.multiply(
        new THREE.Color(
          (1 + density * 0.07) * (1 + warmth * 0.030),
          1 + density * 0.07,
          (1 + density * 0.07) * (1 - warmth * 0.034),
        ),
      )
    }
  } else {
    mat.transparent = true
    mat.depthWrite = false
    mat.roughness = 0.12
    mat.envMapIntensity = 0.58
    /* MPFB 눈 아틀라스의 홍채·눈꺼풀 라인이 **적갈색**이라, 통증으로 눈이
       70% 감기면 남는 눈틈이 온통 붉어 충혈처럼 읽혔다("눈이 빨갛다" 지적,
       2026-08-03 진료실 확대로 확인). 한국인 홍채는 거의 검은 갈색이다 —
       빨강만 12% 눌러 어두운 갈색으로 되돌린다. 공막의 분홍기도 같이 빠진다. */
    mat.color.setRGB(0.78, 0.97, 1.0)
    const physical = mat as THREE.MeshPhysicalMaterial
    if (physical.isMeshPhysicalMaterial) {
      physical.ior = 1.376
      physical.specularIntensity = 0.52
      physical.specularColor.set('#fffdfb')
      physical.clearcoat = 0.46
      physical.clearcoatRoughness = 0.075
    }
  }

  const runtime: PatientRuntimeUniforms = {}
  const blink = { value: 0 }
  const gaze = { value: new THREE.Vector2() }
  const browRaise = { value: 0 }
  const browSlant = { value: 0 }
  if (kind === 'eye' || kind === 'lash') runtime.blink = blink
  if (kind === 'eye') runtime.gaze = gaze
  if (kind === 'brow') {
    runtime.browRaise = browRaise
    runtime.browSlant = browSlant
  }
  cloned.userData.patientRuntimeUniforms = runtime

  const compile = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    compile.call(mat, shader, renderer)
    if (kind === 'eye') {
      shader.uniforms.patientGaze = gaze
      shader.uniforms.patientBlink = blink
      shader.uniforms.patientEyeLeft = { value: face.eyeLeft }
      shader.uniforms.patientEyeRight = { value: face.eyeRight }
      shader.uniforms.patientEyeRadius = { value: face.eyeRadius }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec2 patientGaze;
          uniform float patientBlink;
          uniform vec3 patientEyeLeft;
          uniform vec3 patientEyeRight;
          uniform vec2 patientEyeRadius;
          varying vec3 vPatientEyePoint;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float patientNormalYawCos = cos(patientGaze.x);
          float patientNormalYawSin = sin(patientGaze.x);
          objectNormal.xz = mat2(
            patientNormalYawCos, -patientNormalYawSin,
            patientNormalYawSin, patientNormalYawCos
          ) * objectNormal.xz;
          float patientNormalPitchCos = cos(patientGaze.y);
          float patientNormalPitchSin = sin(patientGaze.y);
          objectNormal.yz = mat2(
            patientNormalPitchCos, -patientNormalPitchSin,
            patientNormalPitchSin, patientNormalPitchCos
          ) * objectNormal.yz;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 patientEyeCenter = position.x >= 0.0 ? patientEyeLeft : patientEyeRight;
          vec3 patientEyePoint = transformed - patientEyeCenter;
          float patientYawCos = cos(patientGaze.x);
          float patientYawSin = sin(patientGaze.x);
          patientEyePoint.xz = mat2(
            patientYawCos, -patientYawSin,
            patientYawSin, patientYawCos
          ) * patientEyePoint.xz;
          float patientPitchCos = cos(patientGaze.y);
          float patientPitchSin = sin(patientGaze.y);
          patientEyePoint.yz = mat2(
            patientPitchCos, -patientPitchSin,
            patientPitchSin, patientPitchCos
          ) * patientEyePoint.yz;
          transformed = patientEyeCenter + patientEyePoint;
          vPatientEyePoint = patientEyePoint;
          transformed.z -= patientBlink * patientEyeRadius.y * 2.7;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float patientBlink;
          uniform vec2 patientEyeRadius;
          varying vec3 vPatientEyePoint;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `vec2 patientEyeSurface = vPatientEyePoint.xy / max(patientEyeRadius, vec2(0.0001));
          float patientEyeFront = smoothstep(-0.22, 0.42, vPatientEyePoint.z / max(patientEyeRadius.y, 0.0001));
          float patientCatchKey = 1.0 - smoothstep(
            0.055,
            0.16,
            length(patientEyeSurface - vec2(-0.31, 0.27))
          );
          float patientCatchFill = 1.0 - smoothstep(
            0.025,
            0.09,
            length(patientEyeSurface - vec2(0.23, 0.12))
          );
          float patientIrisRadius = length(patientEyeSurface * vec2(1.0, 1.04));
          float patientIrisRing = smoothstep(0.19, 0.27, patientIrisRadius)
            * (1.0 - smoothstep(0.48, 0.61, patientIrisRadius));
          float patientIrisAngle = atan(patientEyeSurface.y, patientEyeSurface.x);
          float patientIrisFiber = sin(patientIrisAngle * 34.0 + patientIrisRadius * 31.0)
            * sin(patientIrisAngle * 17.0 - patientIrisRadius * 23.0);
          outgoingLight += vec3(0.038, 0.018, 0.006)
            * patientIrisRing * (0.78 + patientIrisFiber * 0.22)
            * patientEyeFront * (1.0 - patientBlink);
          outgoingLight += vec3(1.0, 0.955, 0.9)
            * (patientCatchKey * 0.22 + patientCatchFill * 0.055)
            * patientEyeFront * (1.0 - patientBlink);

          diffuseColor.a *= 1.0 - patientBlink;
          #include <opaque_fragment>`,
        )
    } else if (kind === 'lash') {
      shader.uniforms.patientBlink = blink
      shader.uniforms.patientEyeLeft = { value: face.eyeLeft }
      shader.uniforms.patientEyeRight = { value: face.eyeRight }
      shader.uniforms.patientEyeRadius = { value: face.eyeRadius }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float patientBlink;
          uniform vec3 patientEyeLeft;
          uniform vec3 patientEyeRight;
          uniform vec2 patientEyeRadius;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 patientEyeCenter = position.x >= 0.0 ? patientEyeLeft : patientEyeRight;
          vec3 patientLashDelta = transformed - patientEyeCenter;
          transformed.y = patientEyeCenter.y + patientLashDelta.y * 0.88;
          transformed.z = patientEyeCenter.z + patientLashDelta.z * 0.92;
          float patientLashDistance = length(
            (position.xy - patientEyeCenter.xy) / (patientEyeRadius * vec2(1.45, 1.8))
          );
          float patientLashMask = 1.0 - smoothstep(0.72, 1.3, patientLashDistance);
          transformed.y = mix(
            transformed.y,
            patientEyeCenter.y - patientEyeRadius.y * 0.05,
            patientBlink * patientLashMask * 0.94
          );
          transformed.z += patientBlink * patientLashMask * patientEyeRadius.y * 0.1;`,
        )
    } else {
      shader.uniforms.patientBrowRaise = browRaise
      shader.uniforms.patientBrowSlant = browSlant
      shader.uniforms.patientEyeLeft = { value: face.eyeLeft }
      shader.uniforms.patientEyeRight = { value: face.eyeRight }
      shader.uniforms.patientEyeRadius = { value: face.eyeRadius }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float patientBrowRaise;
          uniform float patientBrowSlant;
          uniform vec3 patientEyeLeft;
          uniform vec3 patientEyeRight;
          uniform vec2 patientEyeRadius;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 patientEyeCenter = position.x >= 0.0 ? patientEyeLeft : patientEyeRight;
          float patientBrowHorizontal = abs(position.x - patientEyeCenter.x)
            / max(patientEyeRadius.x * 1.9, 0.0001);
          float patientBrowInner = 1.0 - smoothstep(0.18, 0.92, patientBrowHorizontal);
          transformed.y += patientBrowRaise * patientEyeRadius.y * (0.17 + patientBrowInner * 0.2);
          transformed.y += patientBrowSlant * patientEyeRadius.y * (patientBrowInner - 0.48) * 0.26;`,
        )
      /* 눈썹 아틀라스는 가는 털이 낮은 알파로 깔려 있어서, 얼굴이 작게 그려지는
         문진 거리에서는 평균 알파가 떨어져 피부에 묻힌다. 곡선으로 밀도만 올린다. */
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `diffuseColor.a = clamp(pow(diffuseColor.a, 0.62) * 1.08, 0.0, 1.0);
        #include <opaque_fragment>`,
      )
    }
  }
  mat.customProgramCacheKey = () => `patient-embedded-${kind}-rig-v13`
  mat.needsUpdate = true
  return mat
}

type Bones = Record<string, THREE.Bone>
type InitQuats = Record<string, THREE.Quaternion>

interface FaceCfg {
  browInner: number // +위로(놀람) / -아래로(찡그림)
  browSlant: number // +안쪽이 위(걱정) / -안쪽이 아래(화남)
  mouthCorner: number // +미소 / -울상
  jawIdle: number // 평상시 턱 벌림
  lidDown: number // 0~1 눈 감김
  headTilt: number
  headTurn: number
  headDown: number
}

const FACES: Record<Emotion, FaceCfg> = {
  neutral:           { browInner: 0,     browSlant: 0,     mouthCorner: 0,     jawIdle: 0,    lidDown: 0,    headTilt: 0,     headTurn: 0,    headDown: 0 },
  anxious:           { browInner: 0.5,   browSlant: 0.7,   mouthCorner: -0.25, jawIdle: 0.18, lidDown: 0,    headTilt: -0.03, headTurn: 0,    headDown: 0.06 },
  defensive:         { browInner: -0.2,  browSlant: 0.4,   mouthCorner: -0.3,  jawIdle: 0,    lidDown: 0.35, headTilt: -0.05, headTurn: 0.3,  headDown: 0.1 },
  calm:              { browInner: 0.15,  browSlant: 0,     mouthCorner: 0.45,  jawIdle: 0,    lidDown: 0,    headTilt: 0,     headTurn: 0,    headDown: 0 },
  warm:              { browInner: 0.3,   browSlant: 0,     mouthCorner: 0.9,   jawIdle: 0.1,  lidDown: 0.18, headTilt: 0.05,  headTurn: 0,    headDown: 0 },
  relieved:          { browInner: 0.3,   browSlant: 0.15,  mouthCorner: 0.7,   jawIdle: 0,    lidDown: 0.25, headTilt: 0.04,  headTurn: 0,    headDown: 0 },
  hesitant_relieved: { browInner: 0.4,   browSlant: 0.6,   mouthCorner: 0.45,  jawIdle: 0,    lidDown: 0.15, headTilt: -0.05, headTurn: 0,    headDown: 0.1 },
  guarded:           { browInner: 0.2,   browSlant: 0.55,  mouthCorner: -0.35, jawIdle: 0,    lidDown: 0.3,  headTilt: -0.07, headTurn: 0.35, headDown: 0.12 },
  hurt:              { browInner: 0.6,   browSlant: 0.8,   mouthCorner: -0.6,  jawIdle: 0.1,  lidDown: 0.2,  headTilt: -0.06, headTurn: 0,    headDown: 0.1 },
  shocked:           { browInner: 0.9,   browSlant: 0,     mouthCorner: -0.2,  jawIdle: 0.5,  lidDown: -0.3, headTilt: 0.02,  headTurn: 0,    headDown: -0.05 },
  annoyed:           { browInner: -0.6,  browSlant: -0.5,  mouthCorner: -0.4,  jawIdle: 0,    lidDown: 0.45, headTilt: 0,     headTurn: -0.12, headDown: 0 },
  thinking:          { browInner: 0.2,   browSlant: 0.2,   mouthCorner: 0,     jawIdle: 0,    lidDown: 0.1,  headTilt: 0.06,  headTurn: 0.25, headDown: -0.03 },
  speaking:          { browInner: 0.1,   browSlant: 0,     mouthCorner: 0.1,   jawIdle: 0.2,  lidDown: 0,    headTilt: 0,     headTurn: 0,    headDown: 0 },
}

/* 심한 **신체 통증** 표정 — `FACES.hurt` 와는 다른 것이다.
   `hurt` 는 "마음이 상한" 대화 감정이라 눈썹만 살짝 찌푸리는 정도다. 그걸로 신산통(NRS 9~10)을
   표현하려니 "별로 안 아파 보인다"는 지적이 나왔다(사용자, 2026-07-26).
   실제 심한 복통의 얼굴: 미간을 강하게 모으고, 눈을 질끈 감고, 입을 일그러뜨리고,
   턱에 힘이 들어가며 고개를 숙여 몸을 웅크린다. */
/** 들숨에 흉곽이 넓어지는 비율. 실제 조용한 호흡의 가슴둘레 변화가 2~4% 다.
 *  ⚠ 올리기 전에 반드시 들숨/날숨 차분 캡처로 확인해라 — 과하면 풍선처럼 부푼다. */
const BREATH_CHEST_WIDEN = 0.030
/** 복식호흡(횡격막) 진폭. 앙와위에서 배가 오르내리는 폭 — 누운 환자의 유일한 생명 신호다. */
const BREATH_BELLY_RISE = 0.026

const AGONY: FaceCfg = {
  /* 미간을 모은다. ⚠ 1.0 은 파고마다 모프 한계까지 치는 값이라 표정이
     '고통'이 아니라 '가면'으로 읽혔다 — 실제 얼굴은 최대 수축을 계속
     유지하지 못한다. 0.7 대면 찡그림은 분명하되 얼굴이 살아 있다. */
  /* FaceCfg에서 음수는 눈썹을 아래·안쪽으로 누르는 방향이다. 기존 양수는
     `browInnerUp` 모프를 켜 슬퍼 보이게 했고, 신산통의 강한 미간 수축이 아니었다. */
  browInner: -0.96,
  browSlant: 0.7,
  /* ⚠ -0.95 는 과했다. 입꼬리가 극단으로 내려가고 턱까지 벌어지면 찡그림이
     아니라 **주둥이가 튀어나온 인상**이 된다("원숭이" 지적의 남은 절반,
     2026-08-03). 통증은 눈가·미간이 주로 말하고 입은 거드는 정도면 충분하다. */
  /* -0.66 도 진료실에서는 전 환자가 입을 삐죽 내민 얼굴로 읽혔다(2026-11-09). */
  mouthCorner: -0.3,
  jawIdle: 0.22,
  /* 눈을 질끈 감는다 — 통증 표정의 핵심 단서다.
     ⚠ 0.7 은 과했다: 산통 파고에서 눈이 70% 감기면 남는 눈틈이 홍채·눈꺼풀
     라인의 적갈색으로만 채워져 **충혈된 실눈**으로 보였다(2026-08-03 진료실
     확대 확인). 0.5 면 찡그림은 유지되면서 홍채가 절반쯤 보여 사람 눈으로
     읽힌다. 값을 올릴 거면 반드시 진료실 눈 확대 캡처로 확인해라. */
  lidDown: 0.22,
  /* ⚠ 고개를 **많이 숙이면 안 된다.** 0.24 로 뒀더니 문진 화면에서 얼굴 대신 정수리가 보였고,
     애써 만든 통증 표정이 카메라에서 아예 안 보였다(캡처로 확인).
     실제 산통 환자도 의사와 말할 때는 얼굴을 든다 — 통증은 **표정**으로 읽혀야지
     얼굴을 감춰서 표현하는 게 아니다. 살짝 숙이는 정도로만 둔다. */
  headTilt: -0.06,
  headTurn: 0.05,
  headDown: 0.07,
}

/* ── 누운 무릎세움(lie_knees) 다리 포즈 튜닝값 (모델 공간: +y머리, -y발, +z배/천장, -z등/침대) ── */
/* 무릎을 **완만하게** 세운다 (사용자 지시 2026-07-26: "무릎을 좀만 더 완만하게 세워줘").
   종전 thigh=(y-0.40, z0.88)은 침대면에서 약 66° — 무릎이 거의 수직으로 솟아
   복벽 이완 자세가 아니라 힘주고 있는 자세로 보였다. 약 44°로 낮춘다.
   ⚠ thigh 를 눕히면 종아리도 같이 눕혀야 **발이 침대에 닿는다.** 허벅지만 낮추면
     정강이가 매트리스를 뚫거나 발이 공중에 뜬다. 두 벡터는 같이 움직여라.
   ⚠ `LEG_AIM.lie_knees` 가 이 값을 그대로 읽어 시트 경로를 만든다 — 여기만 고치면 시트도 따라온다. */
const LIE = {
  thighX: 0.12,  thighY: -0.70, thighZ: 0.72,
  calfX:  0.05,  calfY:  -0.62, calfZ:  -0.78,
  footX:  0.04,  footY:  -0.72, footZ:  -0.55,
} as const

/* ── 무릎 세우기 키프레임 ────────────────────────────────────────────────
   목표 자세 하나로 감쇠하면 허벅지·종아리·발이 같은 순간에 같은 속도로 움직여
   다리가 통째로 튀어 오른다. 실제 환자는 한쪽 다리부터, 뒤꿈치를 침대에 끌면서
   무릎을 세우고, 중간에 한 번 멈칫했다가 올린다.
   [진행률 u, 들린 정도 s] — 첫 구간이 평평한 것은 힘을 주기 전의 뜸이다. */
type MotionKey = readonly [number, number]
const KNEE_LIFT_KEYS: readonly MotionKey[] = [
  [0, 0], [0.14, 0.03], [0.38, 0.3], [0.58, 0.62], [0.66, 0.66], [0.86, 0.95], [1, 1],
]
const FOOT_SET_KEYS: readonly MotionKey[] = [[0, 0], [0.3, 0.05], [0.7, 0.55], [1, 1]]
/* `?kneeSeconds=20` — 캡처가 프레임당 수백 ms 걸려 2초짜리 동작을 놓치므로 느리게 재생한다. */
const KNEE_RAISE_SECONDS = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 2.0
  const value = Number(new URLSearchParams(window.location.search).get('kneeSeconds'))
  return value > 0 ? value : 2.0
})()
/** 둘째 다리가 첫째 다리보다 늦는 정도(진행률). */
const KNEE_RAISE_TRAIL = 0.22
/** 몸이 침대에 자리 잡은 뒤에야 다리를 든다(초). */
const KNEE_RAISE_SETTLE = 0.9
/* 허벅지 각 θ 에서 종아리 각 φ 를 sinφ = k·sinθ 로 유도하면 뒤꿈치 높이가
   일정하게 유지되어 발이 침대 위를 미끄러진다. k 는 LIE 최종 자세에서 구한다. */
const KNEE_THETA = Math.atan2(LIE.thighZ, -LIE.thighY)
const KNEE_CALF_RATIO =
  Math.sin(Math.atan2(-LIE.calfZ, -LIE.calfY)) / Math.sin(KNEE_THETA)

/** 키 사이를 속도가 끊기지 않게 잇는다(유한차분 접선 Hermite). */
function sampleMotionKeys(keys: readonly MotionKey[], u: number): number {
  const t = THREE.MathUtils.clamp(u, 0, 1)
  let i = 0
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++
  const [t0, v0] = keys[i]
  const [t1, v1] = keys[i + 1]
  const slope = (a: number, b: number) =>
    (keys[b][1] - keys[a][1]) / Math.max(1e-5, keys[b][0] - keys[a][0])
  const span = t1 - t0
  const m0 = (i > 0 ? slope(i - 1, i + 1) : 0) * span
  const m1 = (i < keys.length - 2 ? slope(i, i + 2) : 0) * span
  const x = (t - t0) / Math.max(1e-5, span)
  const x2 = x * x
  const x3 = x2 * x
  return (2 * x3 - 3 * x2 + 1) * v0 + (x3 - 2 * x2 + x) * m0
    + (-2 * x3 + 3 * x2) * v1 + (x3 - x2) * m1
}

/* 다리 조준 방향 — 아래 useFrame의 aim() 호출과 **같은 값**이어야 시트가 다리 위에 얹힌다.
   (왼다리 기준. 오른다리는 x 부호만 반대라 좌우 대칭인 시트 경로에는 영향이 없다) */
const LEG_AIM: Record<'sit' | 'lie' | 'lie_knees', { thigh: [number, number]; calf: [number, number] }> = {
  // [y, z] 성분만 쓴다 — 시트 경로는 몸통 정중면(x=0) 위에 있다.
  sit: { thigh: [-0.12, 1], calf: [-1, 0.12] },
  lie: { thigh: [-1, 0.02], calf: [-1, 0.05] },
  lie_knees: { thigh: [LIE.thighY, LIE.thighZ], calf: [LIE.calfY, LIE.calfZ] },
}

/* 시트를 얹을 다리 경로 — 바인드 본 위치 + 자세별 조준 방향으로 무릎·발목을 유도한다.
   본 길이에서 유도하므로 키 1.49m 마른 아바타와 1.60m 남성 아바타가 같은 코드로 맞는다. */
function makeDrapePath(
  bind: Map<string, THREE.Vector3>,
  pose: 'sit' | 'lie' | 'lie_knees',
  waist: DrapePathPoint,
  bodyScale: number,
  /** 넓적다리 앞면까지의 실측 반지름(m). null이면 체격 배율로 근사한다.
   *  상수로 두면 비만 아바타에서 바지가 시트를 뚫고 나온다(실측으로 확인). */
  thighRadius: number | null,
): DrapePathPoint[] | null {
  const thigh = pickBindBone(bind, ['thighl', 'leftupleg'])
  const calf = pickBindBone(bind, ['calfl', 'leftleg'])
  const foot = pickBindBone(bind, ['footl', 'leftfoot'])
  if (!thigh || !calf || !foot) return null
  const thighLength = thigh.distanceTo(calf)
  const calfLength = calf.distanceTo(foot)
  const aim = LEG_AIM[pose]
  const unit = ([y, z]: [number, number]): [number, number] => {
    const length = Math.max(1e-5, Math.hypot(y, z))
    return [y / length, z / length]
  }
  const [thighY, thighZ] = unit(aim.thigh)
  const [calfY, calfZ] = unit(aim.calf)
  // 반지름 + 여유. 시트는 맨다리가 아니라 **바지 위**에도 얹히므로 옷 두께만큼 더 띄운다.
  const clothAllowance = 0.032 * bodyScale
  const thighPad = (thighRadius ?? 0.07 * bodyScale) + clothAllowance
  const anklePad = (thighRadius ?? 0.07 * bodyScale) * 0.55 + clothAllowance * 0.6
  /* 뼈에서 바깥쪽(천이 얹히는 면)으로 미는 방향 = 뼈 방향을 90° 돌린 것.
     같은 회전 방향을 계속 쓰면 무릎을 넘어 정강이로 꺾여도 바깥면을 유지한다. */
  const onThigh = (distance: number, pad: number): DrapePathPoint => ({
    y: thigh.y + thighY * distance + thighZ * pad,
    z: thigh.z + thighZ * distance - thighY * pad,
  })
  const kneeBase = onThigh(thighLength, 0)
  /* 무릎에서 넓적다리 법선 → 정강이 법선으로 **감아 돈다**. 무릎 점 하나만 찍으면
     무릎을 세운 자세(넓적다리와 정강이가 141° 꺾인다)에서 천이 제자리에서 접혀
     자기 자신을 뚫는다 — 실제로 그렇게 렌더됐다. */
  const startAngle = Math.atan2(-thighY, thighZ)
  let endAngle = Math.atan2(-calfY, calfZ)
  while (endAngle - startAngle > Math.PI) endAngle -= Math.PI * 2
  while (endAngle - startAngle < -Math.PI) endAngle += Math.PI * 2
  const kneeArc: DrapePathPoint[] = []
  const arcSteps = 4
  /* 무릎은 넓적다리보다 가늘다. 넓적다리 여유 그대로 감으면 무릎 세운 자세에서
     반지름이 커져 다리를 삼킨 돔이 되고, 옆자락이 서로를 파고들어 조각이 튄다. */
  /* 무릎을 45°로 눕히면서 이 여유가 과해졌다 — 천이 무릎에 얹히지 않고 위에 떠서
     돔처럼 보이고, 남는 폭이 접히며 스스로를 뚫어 검은 슬래시가 생겼다.
     0.72 → 0.46 으로 줄여 천이 무릎에 닿게 한다.
     45° 기준으로 추가 캡처 후 0.28 로 더 줄임 — 경로가 다리 윤곽에 더 가깝게 붙는다. */
  const kneePad = thighPad * 0.28
  for (let step = 0; step <= arcSteps; step++) {
    const angle = THREE.MathUtils.lerp(startAngle, endAngle, step / arcSteps)
    kneeArc.push({
      y: kneeBase.y + Math.cos(angle) * kneePad,
      z: kneeBase.z + Math.sin(angle) * kneePad,
    })
  }
  const shinStart = kneeArc[kneeArc.length - 1]
  if (pose === 'sit') {
    // 앉은 자세는 무릎 위 랩 드레이프 — 무릎을 넘어 정강이 앞으로 자락만 늘어뜨린다.
    return [
      waist,
      onThigh(thighLength * 0.5, thighPad),
      ...kneeArc,
      {
        y: shinStart.y + calfY * calfLength * 0.45,
        z: shinStart.z + calfZ * calfLength * 0.45,
      },
    ]
  }
  const ankle = {
    y: kneeBase.y + calfY * calfLength + calfZ * anklePad,
    z: kneeBase.z + calfZ * calfLength - calfY * anklePad,
  }
  return [
    waist,
    onThigh(thighLength * 0.5, thighPad),
    ...kneeArc,
    ankle,
    // 발목 너머로 조금 더 흘려 발등까지 덮는다.
    {
      y: ankle.y + (ankle.y - shinStart.y) * 0.18,
      z: ankle.z + (ankle.z - shinStart.z) * 0.18,
    },
  ]
}

export function RealisticPatient({
  emotion,
  speaking,
  variant,
  pose,
  walkSpeed = 0,
  gesture = 'none',
  debugSkinSurface,
  debugFreezePose = false,
  debugAssetUrl,
  chronologicalAge,
  identityKey,
  painLevel = 0,
  painColickyPeriod = null,
  respRate = 14,
  appearance,
  examActiveOverride = false,
}: {
  emotion: Emotion
  speaking: boolean
  variant: CharacterVariant | ValidVariant | MpfbVariant
  pose: 'walk' | 'sit' | 'lie' | 'lie_knees'
  walkSpeed?: number
  gesture?: 'none' | 'reach'
  debugSkinSurface?: 'normalOff' | 'albedoOff' | 'mapsOff' | 'recomputeNormals' | 'recomputeFlat'
  debugFreezePose?: boolean
  debugAssetUrl?: string
  chronologicalAge?: number
  identityKey?: string
  /** 통증 기준선 0~1. 대화 감정과 무관하게 기본 표정을 아프게 만든다. */
  painLevel?: number
  /** 산통 주기(초). 0/미지정이면 파고 없이 일정한 통증. */
  painColickyPeriod?: number | null
  /** 분당 호흡수. 케이스 활력징후(`vitals.rr`)에서 온다. 없으면 평상 호흡(14). */
  respRate?: number
  /** 교수자 대시보드의 저장 전 미리보기. 없으면 현재 세션의 appearance를 사용한다. */
  appearance?: AvatarAppearance
  /** 실제 게임 phase 전환 없이 ClinicScene 진찰 미리보기를 렌더할 때 사용한다. */
  examActiveOverride?: boolean
}) {
  const sessionAppearance = useGame((state) => state.session?.patient?.appearance)
  const clinicalAppearance = appearance ?? sessionAppearance
  const valid = isValid(variant)
  const mpfb = isMpfb(variant)
  const adultFemaleOutfit = mpfb && usesAdultFemaleUniform(variant)
  const grandmaCasual = adultFemaleOutfit && variant === 'mh_f60_ob'
  const femaleUniform = adultFemaleOutfit && !grandmaCasual
  const donorFemaleOutfit = adultFemaleOutfit && variant !== 'mh_f20'
  const embedded = valid || mpfb // GLB에 텍스처 임베드 → 외부 jpg 로딩 불필요
  const productionUrl = valid
    ? `/avatars/valid_${variant}.glb`
    : mpfb
      ? `/avatars/${variant}.glb?${AVATAR_VER}`
      : `/avatars/${variant}.glb`
  const url = debugAssetUrl ?? productionUrl
  const { scene } = useGLTF(url)
  const { scene: oralAssetScene } = useGLTF('/models/gnm_oral_anatomy.glb?v=4')
  // 남성/기타 모델에서는 같은 URL을 사용하므로 추가 네트워크 비용이 없다.
  const femaleOutfitUrl = donorFemaleOutfit
    ? grandmaCasual
      ? `/avatars/mh_f60_ob_grandma_casual.glb?${AVATAR_VER}-casual`
      : `/avatars/mh_f20.glb?${AVATAR_VER}-uniform`
    : url
  const { scene: femaleOutfitScene } = useGLTF(femaleOutfitUrl)
  /* ── 통증 기준선 ──
   * 표정이 매 턴 LLM 이 고른 `emotion` 에만 의존하면 **모든 케이스가 비슷하게 밋밋하다**
   * (사용자 신고 2026-07-26: "요로결석같은 거 ㅈㄴ 아파서 엄청 고통스러운 표정이라는데
   *  지금은 다 표정이 너무 일관돼").
   * 요로결석 산통은 NRS 9~10 으로 분류되는 최고 강도 통증이고, **가만히 있어도 아프다.**
   * 그러니 대화 감정과 무관하게 기본 표정 자체가 아파야 한다.
   *
   * 두 겹으로 만든다:
   *   (1) 기준선 — 케이스의 `pain_level` 만큼 `hurt` 표정을 상시 섞는다
   *   (2) 파고   — 산통(colic)은 **파도처럼 몰려왔다 잦아든다.** 일정한 찡그림은 오히려
   *       가면처럼 보이므로, 주기적으로 세졌다 풀리는 성분을 얹는다. 이게 "일관돼 보인다"의 해법이다.
   * ⚠ 웃는 표정(warm/relieved/calm)일 때도 통증을 섞는다 — 진통제를 준 것도 아닌데
   *   질문 하나에 통증이 사라지면 그게 더 이상하다. 다만 입꼬리는 감정 쪽을 존중해 덜 누른다. */
  const emotionFace = FACES[emotion] ?? FACES.neutral
  /* 통증을 섞은 최종 표정. `FACES.hurt` 를 가중 혼합하되 파고(colic)를 얹는다.
     `useFrame` 이 매 프레임 이 객체의 값만 갱신한다 — 새 객체를 만들면 GC 가 돈다. */
  const face = useRef({ ...emotionFace }).current
  const group = useRef<THREE.Group>(null)
  const [blink, setBlink] = useState(false)
  const blinkAmount = useRef(0)
  const speechEnergy = useRef(0)
  /* 환자가 의사를 올려다보는 정도. `?headUp=0.9` 로 스윕한다. */
const HEAD_LOOK_UP_GAIN = (() => {
  const d = 1.1
  if (typeof window === 'undefined') return d
  const raw = new URLSearchParams(window.location.search).get('headUp')
  const v = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(v) && v >= 0 && v <= 3 ? v : d
})()

/* 자세 전환 이징 상태. key 가 바뀌면 포락선을 0에서 다시 올린다.
     ⚠ pose 뿐 아니라 gesture·examGesture 도 키에 넣어야 한다 — "손 내밀어
     주세요"나 "입 벌려 주세요"도 몸이 움직이는 전환이라, 빼면 그쪽만 예전처럼
     튄다. */
  const poseEase = useRef({ key: '', t: 1 })
  const kneeRaise = useRef({ progress: 0, lyingFor: 0 })
  const gazeMotion = useRef({
    x: 0, y: 0, targetX: 0, targetY: 0, nextMove: 0,
    // 미세 시선 — 고정 중에도 눈이 멈추지 않게 한다(useFrame 의 microsaccade 항 참고)
    microX: 0, microY: 0, microCurX: 0, microCurY: 0, nextMicro: 0,
  })
  const appearanceKey = identityKey?.trim() || variant
  const identitySeed = useMemo(() => stableUnit(appearanceKey), [appearanceKey])
  const motionPhase = useMemo(() => stableUnit(`${appearanceKey}:motion`) * Math.PI * 2, [appearanceKey])
  const skinTextureUrl = useMemo(
    () => mpfb ? mpfbSkinTextureUrl(variant, chronologicalAge) : null,
    [mpfb, variant, chronologicalAge],
  )
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())
  const replaceBrokenLower = mpfb && !adultFemaleOutfit && /^(mh_f60_ob|mh_oldf)$/.test(variant)

  // 모델 복제 (변형 안전) + 머티리얼 구성.
  // 베이스 컬러(피부/의류)를 먼저 깔고, JPG 텍스처가 도착하면 onLoad에서 map을 연결한다.
  // → 로딩 동안 검은 캐릭터가 보이지 않는다.
  const model = useMemo(() => {
    const m = skeletonClone(scene) as THREE.Group
    if (donorFemaleOutfit) {
      const needsBodyRefit = !grandmaCasual && variant !== 'mh_f30' && variant !== 'mh_f30_thin'
      transplantAdultFemaleOutfit(
        m,
        femaleOutfitScene,
        grandmaCasual ? 'grandmaCasual' : 'uniform',
        needsBodyRefit,
      )
    }
    // VALID/MPFB: GLB에 텍스처가 임베드돼 있으므로 원본 머티리얼 유지(외부 jpg 로딩 불필요).
    if (embedded) {
      // VALID는 이름 없는 65개 모프가 포함된 별도 토폴로지다. MPFB 좌표 기반 버텍스
      // 얼굴 리그를 겹치면 스키닝 경계가 깨질 수 있어, 공통 PBR 보정만 적용한다.
      const faceLandmarks = mpfb ? findMpfbFaceLandmarks(m) : null
      const hasNativeFaceMorphs = mpfb && collectNativeFaceMorphRigs(m).length > 0
      const ageFactor = variantAgeFactor(variant, chronologicalAge)
      const skinDetail = patientSkinDetail(variant, chronologicalAge, identitySeed)
      // VALID는 눈·치아·전신이 같은 원본 재질을 공유한다. 메시 종류까지 키에 넣지 않으면
      // 첫 번째로 순회한 치아 설정이 몸 전체에 재사용되는 문제가 생긴다.
      const materialCache = new Map<THREE.Material, Map<string, THREE.Material>>()
      m.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        if (
          !femaleUniform
          && (variant === 'mh_f30' || variant === 'mh_f30_thin')
          && garmentSlot(mesh) === 'upper'
        ) {
          // 허리의 치마 메시가 상의를 관통하지 않도록 천에 실제 두께만큼 여유를 준다.
          mesh.scale.x *= 1.015
          mesh.scale.z *= 1.12
        }
        /* ⚠️ **헤어는 그림자를 만들지 않는다.** 머리카락은 알파로 뚫린 판(카드)인데
         *   섀도맵은 알파를 안 보고 **판을 통째로 불투명하게** 그린다. 그래서 앞머리가
         *   이마·눈두덩에 커다란 검은 반점을 찍었고, 그게 "앉으면 얼굴이 깨진다"의 정체였다.
         *   런타임 이분법으로 확인했다(`scratchpad/face_bisect.mjs`):
         *     헤어 그림자만 끔 → 이마 얼룩 대부분 사라짐
         *     헤어 통째로 숨김 → 얼굴이 완전히 깨끗 (즉 피부·텍스처는 처음부터 멀쩡했다)
         *   알파를 따르는 `customDepthMaterial` 로 제대로 된 그림자를 만드는 길도 있지만,
         *   알파 카드 헤어의 실시간 그림자는 원래 지저분해서 얻는 것보다 잃는 게 크다.
         *   ⚠ 다시 켜고 싶으면 반드시 얼굴 크롭 캡처로 이마 얼룩부터 확인해라. */
        const meshKind = materialKind(mesh.name, (mesh.material as THREE.Material)?.name ?? '')
        const isHair = meshKind === 'hair'
        if (hiddenKinds.has(meshKind)) mesh.visible = false
        mesh.castShadow = !isHair
        mesh.receiveShadow = true
        mesh.frustumCulled = false
        if (
          (debugSkinSurface === 'recomputeNormals' || debugSkinSurface === 'recomputeFlat')
          && (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(
            (material) => materialKind(mesh.name, material.name) === 'skin',
          )
        ) {
          mesh.geometry.computeVertexNormals()
        }
        const tune = (source: THREE.Material) => {
          const kind = materialKind(mesh.name, source.name)
          const longHair = kind === 'hair'
            && meshBox(mesh).getSize(new THREE.Vector3()).y > 0.36
          // 같은 원피스 재질을 상·하의로 나눠도 진찰 클리핑이 독립적으로 작동해야 한다.
          const cacheKey = `${kind}:${longHair ? 'long' : 'short'}:${garmentSlot(mesh) ?? 'body'}`
          const sourceCache = materialCache.get(source)
          const cached = sourceCache?.get(cacheKey)
          if (cached) return cached
          const overlay = kind === 'eye' || kind === 'brow' || kind === 'lash'
          const tuned = faceLandmarks && overlay
            ? tuneMpfbFaceOverlay(source, kind, maxAnisotropy, faceLandmarks, {
                ageFactor,
                identitySeed,
              })
            : overlay
              ? source
              : tunePatientMaterial(source, kind, maxAnisotropy, {
                  // 새 MPFB GLB는 실제 ARKit 모프가 얼굴을 움직인다. 구형 GLB만
                  // 좌표 기반 셰이더 리그를 폴백으로 사용해 이중 변형을 막는다.
                  face: kind === 'skin' && !hasNativeFaceMorphs ? faceLandmarks : null,
                  surfaceFace: kind === 'skin' ? faceLandmarks : null,
                  ageFactor,
                  identitySeed,
                  skinDetail,
                  correctedHair: CORRECTED_HAIR_VARIANTS.test(variant),
                  longHair,
                  debugSkinSurface,
                })
          if (
            kind === 'fabric'
            && isStandardMaterial(tuned)
            && garmentSlot(mesh) === 'upper'
            && (
              variant === 'mh_f30'
              || variant === 'mh_f30_thin'
              || femaleUniform
              || replaceBrokenLower
              || /punkduck|v[-_ ]?neck/.test(`${mesh.name} ${source.name}`.toLowerCase())
            )
          ) {
            // 이 무료 V-neck 알베도에는 복부에 큰 검은 로고 마스크가 남아 있어
            // 깨끗한 진료복 색으로 중립화하고 원래의 천 노멀/거칠기만 보존한다.
            tuned.map = null
            if (replaceBrokenLower || femaleUniform) {
              tuned.normalMap = null
              tuned.roughnessMap = null
            }
            tuned.metalnessMap = null
            tuned.aoMap = null
            tuned.vertexColors = false
            tuned.color.set(femaleUniform ? '#e7e8e4' : replaceBrokenLower ? '#66747c' : '#e7ecee')
            tuned.roughness = femaleUniform ? 0.95 : tuned.roughness
            tuned.envMapIntensity = femaleUniform ? 0.08 : tuned.envMapIntensity
            if (femaleUniform) {
              const cottonWeave = makeCottonWeaveTexture()
              cottonWeave.anisotropy = Math.min(8, maxAnisotropy)
              tuned.bumpMap = cottonWeave
              tuned.bumpScale = 0.0014
            }
            const uniformPhysical = tuned as THREE.MeshPhysicalMaterial
            if (femaleUniform && uniformPhysical.isMeshPhysicalMaterial) {
              uniformPhysical.clearcoat = 0
              uniformPhysical.sheen = 0.025
              uniformPhysical.sheenRoughness = 1
            }
            tuned.polygonOffset = true
            tuned.polygonOffsetFactor = -24
            tuned.polygonOffsetUnits = -24
            tuned.needsUpdate = true
            if (import.meta.env.DEV) {
              console.info(`[patient-garment] sanitized ${variant} mesh=${mesh.name} material=${source.name}`)
            }
          }
          if (
            femaleUniform
            && kind === 'fabric'
            && garmentSlot(mesh) === 'lower'
            && isStandardMaterial(tuned)
          ) {
            // 청바지는 원본 데님 알베도만 살리고 비현실적인 금속광/코팅 반사를 제거한다.
            tuned.metalness = 0
            tuned.metalnessMap = null
            tuned.normalMap = null
            tuned.roughnessMap = null
            tuned.bumpMap = null
            tuned.displacementMap = null
            tuned.roughness = 0.91
            tuned.envMapIntensity = 0.12
            const denimPhysical = tuned as THREE.MeshPhysicalMaterial
            if (denimPhysical.isMeshPhysicalMaterial) {
              denimPhysical.clearcoat = 0
              denimPhysical.sheen = 0.035
              denimPhysical.sheenRoughness = 0.98
            }
            tuned.needsUpdate = true
          }
          if (grandmaCasual && kind === 'fabric' && isStandardMaterial(tuned)) {
            const slot = garmentSlot(mesh)
            if (slot !== 'upper' && slot !== 'lower') return tuned
            // 현실적인 노년 생활복: 상의에만 작은 저채도 꽃무늬를 쓰고, 하의는
            // 무늬 없는 차콜 울 슬랙스로 유지한다. 두 재질 모두 코팅광을 없앤다.
            tuned.color.set(slot === 'upper' ? '#c2b1ae' : '#4a5055')
            tuned.metalness = 0
            tuned.metalnessMap = null
            tuned.normalMap = null
            tuned.roughnessMap = null
            tuned.displacementMap = null
            tuned.aoMap = null
            tuned.vertexColors = false
            tuned.map = null
            tuned.roughness = slot === 'upper' ? 0.94 : 0.96
            tuned.envMapIntensity = 0.055
            if (slot === 'upper') {
              assignClothTextureWhenReady(
                tuned,
                '/avatars/clothes/muted_floral.png?outfit=v2',
                maxAnisotropy,
              )
            }
            const cottonWeave = makeCottonWeaveTexture()
            cottonWeave.repeat.set(slot === 'upper' ? 20 : 15, slot === 'upper' ? 22 : 25)
            cottonWeave.anisotropy = Math.min(8, maxAnisotropy)
            tuned.bumpMap = cottonWeave
            tuned.bumpScale = slot === 'upper' ? 0.0011 : 0.00145
            const garmentPhysical = tuned as THREE.MeshPhysicalMaterial
            if (garmentPhysical.isMeshPhysicalMaterial) {
              garmentPhysical.clearcoat = 0
              garmentPhysical.sheen = slot === 'upper' ? 0.035 : 0.06
              garmentPhysical.sheenRoughness = 1
            }
            /* ⚠ 앉은 자세에서 흰 상의 옆구리에 **어두운 깃털 모양 얼룩**이 나온다(미해결).
               진료실 씬에서만 보이고 선 자세인 AvatarLab 에서는 안 보인다.
               **다섯 가지를 렌더 이분법으로 배제했다** — 같은 가설을 다시 세우지 마라:
                 · 헤어 아님        `?hideKind=hair` 로 숨겨도 그대로
                 · 몸 뚫림 아님     `?hideKind=skin` 으로 몸을 숨겨도 그대로
                 · 환자복 아님      `?hideKind=medical`(가운·드레이프)로 숨겨도 그대로
                 · 섀도 애크니 아님 `?noshadow=1` 로 그림자를 꺼도 그대로
                 · 의상 맵 아님     노멀/거칠기/범프를 전부 null 로 해도 그대로
               `?hideKind=fabric` 으로 상의를 숨길 때만 사라진다 = **상의 메시 위의 음영**이다.
               다음 후보: 환자가 의자 안쪽으로 너무 깊이 앉아 **의자 메시가 옆구리를 관통**하는 것
               (얼룩이 의자 teal 기둥 바로 옆에서만 나오고 색조도 푸르스름하다). 확인하려면
               ClinicScene 에서 의자를 숨기고 같은 크롭을 비교해라. */
            tuned.polygonOffset = true
            tuned.polygonOffsetFactor = -6
            tuned.polygonOffsetUnits = -6
            tuned.needsUpdate = true
          }
          /* ── 남성(및 여성 유니폼 경로를 안 타는 나머지) MPFB 의 평상복 ─────────────
             여성은 위쪽 분기들이 알베도를 중립화해 주는데 **남성은 어느 분기도 안 탔다.**
             그래서 기증자 옷의 원본 알베도가 그대로 나왔고, 진찰 카메라 거리에서 이렇게 보였다
             (실측 캡처 `garment_mat/mh_m50.png`, `llq_click/mh_m70.png`):
               · 상의 `tinted_Knitted_Sweater_02` — 채도 높은 빨강 + 검정 케이블 니트.
                 1024 알베도의 고주파 니트 결이 그 거리에서 **지그재그 노이즈로 에일리어싱**된다.
                 천으로 안 읽히고 화면에서 제일 시끄러운 물체가 된다
               · 하의 `tinted_M_Trousers_02` — 거의 순검정으로 뭉개져 다리 실루엣이 사라진다
             여성 분기와 **같은 수법**으로 고친다: 알베도만 버리고 천의 노멀·거칠기는 남긴다.
             ⚠ `normalMap`/`roughnessMap`(`fab_n_Human`/`fab_r_Human`)은 **지우지 마라.**
               저게 천으로 읽히게 하는 전부다. 알베도만 없애면 민무늬가 아니라 결이 남는다.
             색은 `identitySeed`(아바타별 고정 난수)로 흔들어 12인이 같은 옷으로 안 보이게 한다 —
             중립화가 곧 제복화가 되면 캐릭터 구분이 사라진다. */
          if (
            mpfb
            && !adultFemaleOutfit
            && kind === 'fabric'
            && isStandardMaterial(tuned)
            && (garmentSlot(mesh) === 'upper' || garmentSlot(mesh) === 'lower')
          ) {
            const slot = garmentSlot(mesh)
            const child = /boy|girl/.test(variant)
            const shirtTones = child ? CHILD_SHIRT_TONES : MALE_SHIRT_TONES
            const pantsTones = child ? CHILD_TROUSER_TONES : MALE_TROUSER_TONES
            /* 두 슬롯이 **다른 승수**를 써야 한다. 같은 씨앗에 같은 승수를 쓰면 상·하의 인덱스가
               붙어 다녀 조합 수가 팔레트 크기로 주저앉는다. 7919는 그냥 서로소인 소수다. */
            const shirt = shirtTones[Math.floor(identitySeed * shirtTones.length) % shirtTones.length]
            const pants = pantsTones[Math.floor(identitySeed * 7919) % pantsTones.length]
            tuned.map = null            // 시끄러운 니트/데님 알베도만 버린다
            tuned.metalnessMap = null
            tuned.aoMap = null
            tuned.vertexColors = false
            tuned.metalness = 0
            /* ⚠️ **알베도를 지워도 지그재그가 안 없어진다.** 무늬는 `normalMap`(`fab_n_Human`)에
               케이블 니트 요철로 구워져 있고, 그게 셔츠 무늬의 사실상 전부다.
               런타임 이분법 실측(`scratchpad/chevron_bisect.mjs`, mh_m50 셔츠 영역 상대대비):
                 normalMap 제거   −27.5%   ← 원인
                 bumpMap  제거    +0.3%    (오차)
                 roughnessMap 제거 −0.3%    (오차)
               상의만 지운다 — **하의는 같은 맵을 쓰는데 셰브런이 안 나온다**(UV 배치가 달라
               아틀라스의 다른 영역을 본다). 바지에서 지우면 주름 결만 잃는다. 실측 확인. */
            if (slot === 'upper') tuned.normalMap = null
            tuned.color.set(slot === 'upper' ? shirt : pants)
            /* 하의를 상의보다 덜 거칠게 둔다 — 면 니트보다 치노·데님이 빛을 조금 더 받는다.
               `envMapIntensity` 는 낮게 유지한다. 올리면 실내 HDRI 를 받아 옷이 비닐처럼 번들거린다. */
            tuned.roughness = slot === 'upper' ? 0.94 : 0.88
            tuned.envMapIntensity = slot === 'upper' ? 0.07 : 0.1
            const malePhysical = tuned as THREE.MeshPhysicalMaterial
            if (malePhysical.isMeshPhysicalMaterial) {
              malePhysical.clearcoat = 0     // 옷에 코팅 반사가 있으면 즉시 플라스틱으로 읽힌다
              malePhysical.sheen = slot === 'upper' ? 0.045 : 0.03
              malePhysical.sheenRoughness = 1
            }
            /* 여성 분기와 같은 면 조직 범프. `repeat` 은 상의를 조금 더 곱게 — 니트 자리라
               결이 굵으면 버린 알베도가 범프로 되살아난 것처럼 보인다. */
            const weave = makeCottonWeaveTexture()
            weave.repeat.set(slot === 'upper' ? 24 : 18, slot === 'upper' ? 26 : 22)
            weave.anisotropy = Math.min(8, maxAnisotropy)
            tuned.bumpMap = weave
            tuned.bumpScale = slot === 'upper' ? 0.0012 : 0.0016
            tuned.needsUpdate = true
            if (import.meta.env.DEV) {
              console.info(`[patient-garment] ${child ? 'child' : 'male'} ${variant} ${slot} → ${slot === 'upper' ? shirt : pants}`)
            }
          }
          if (
            skinTextureUrl
            && kind === 'skin'
            && isStandardMaterial(tuned)
            && debugSkinSurface !== 'albedoOff'
            && debugSkinSurface !== 'mapsOff'
            && debugSkinSurface !== 'recomputeFlat'
          ) {
            // GLB 내부 피부에는 옷 아래 몸통에 어두운 삭제 마스크가 구워져 있다.
            // 동일 UV의 원본 CC0 전신 알베도로 교체하되 glTF UV 규격대로 flipY=false를 유지한다.
            assignTexWhenReady(tuned, 'map', skinTextureUrl, true, false, Math.min(12, maxAnisotropy))
          }
          const nextCache = sourceCache ?? new Map<string, THREE.Material>()
          nextCache.set(cacheKey, tuned)
          if (!sourceCache) materialCache.set(source, nextCache)
          return tuned
        }
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(tune)
          : tune(mesh.material)
      })
      /* 관통 정리 — 재질을 다 만든 뒤 지오메트리를 손본다.
         (a) 상의를 뚫고 나오는 하의 허리밴드, (b) 상의를 뚫고 나오는 긴 머리. */
      const uppers: THREE.Mesh[] = []
      const lowers: THREE.Mesh[] = []
      const longHairs: THREE.Mesh[] = []
      const bodyBox = new THREE.Box3()
      m.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const slot = garmentSlot(mesh)
        if (slot === 'upper') uppers.push(mesh)
        else if (slot === 'lower') lowers.push(mesh)
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const isHair = materials.some((material) => materialKind(mesh.name, material?.name ?? '') === 'hair')
        const box = meshBox(mesh)
        if (isHair && box.getSize(new THREE.Vector3()).y > 0.36) longHairs.push(mesh)
        if (!isHair && !slot) bodyBox.union(box)
      })
      /* 환자복 — 성별 무관하게 입힌다. 여성은 가운을 내렸을 때 유방 위에 남는 드레이프를 더 만든다.
         model 안에서 만들어야 자세·의복 이펙트와 GPU 정리 경로를 그대로 탄다. */
      const gownBox = new THREE.Box3().setFromObject(m)
      const gownScale = THREE.MathUtils.clamp((gownBox.max.y - gownBox.min.y) / 1.6, 0.7, 1.35)
      /* 바지 허리선 — 그 아래에서는 가운을 얇게 눌러 청바지를 뚫지 않게 한다.
         17mm 그대로 두면 허리 아래에서 천이 바지를 뚫고 나와 찢어진 것처럼 보인다. */
      let waistY = Number.NEGATIVE_INFINITY
      for (const lower of lowers) waistY = Math.max(waistY, meshBox(lower).max.y)
      createPatientGown(m, gownScale, Number.isFinite(waistY) ? waistY : null)
      if (adultFemaleOutfit) createBreastDrape(m)
      tuckLowerGarmentWaist(uppers, lowers)
      relieveArmpit(uppers)
      if (longHairs.length && !bodyBox.isEmpty()) {
        // 어깨선 ≈ 키의 82% (MPFB 실측: 키 1.60m에서 어깨 1.31m)
        liftLongHairOverGarment(
          longHairs,
          bodyBox.min.y + (bodyBox.max.y - bodyBox.min.y) * 0.82,
          bodyBox.getCenter(new THREE.Vector3()).z,
        )
      }
      // 지오메트리 수술이 전부 끝난 뒤에 프린지를 붙인다(지오메트리를 공유하므로 순서가 중요).
      addHairFringePasses(m)
      /* `?hideKind=medical` — 런타임이 덧붙인 환자복(가운·드레이프)만 숨긴다.
         가운은 위 tune 순회보다 **나중에** 만들어지므로 여기서 따로 걸러야 한다. */
      if (hiddenKinds.has('medical')) {
        m.traverse((node) => {
          if (node.name.startsWith('medical_base')) node.visible = false
        })
      }
      return m
    }
    const headBase = new THREE.MeshPhysicalMaterial({ color: '#c79a78', roughness: 0.55 }) // 피부
    headBase.name = 'patient_skin'
    const bodyBase = new THREE.MeshPhysicalMaterial({ color: '#7b818a', roughness: 0.75 }) // 의류(중성 그레이)
    bodyBase.name = 'patient_fabric'
    const opacityBase = new THREE.MeshPhysicalMaterial({
      color: '#3a352f', // 머리카락/속눈썹 기본 (어두운 갈색)
      roughness: 0.6,
      side: THREE.DoubleSide,
    })
    opacityBase.name = 'patient_hair'
    const headMat = tunePatientMaterial(headBase, 'skin', maxAnisotropy) as THREE.MeshStandardMaterial
    const bodyMat = tunePatientMaterial(bodyBase, 'fabric', maxAnisotropy) as THREE.MeshStandardMaterial
    const opacityMat = tunePatientMaterial(opacityBase, 'hair', maxAnisotropy) as THREE.MeshStandardMaterial
    headBase.dispose()
    bodyBase.dispose()
    opacityBase.dispose()
    assignTexWhenReady(headMat, 'map', `/avatars/${variant}_head_color.jpg`, true)
    assignTexWhenReady(headMat, 'normalMap', `/avatars/${variant}_head_normal.jpg`, false)
    assignTexWhenReady(bodyMat, 'map', `/avatars/${variant}_body_color.jpg`, true)
    assignTexWhenReady(bodyMat, 'normalMap', `/avatars/${variant}_body_normal.jpg`, false)
    // opacity 텍스처는 jieun/sujin에만 존재 (hyunwoo는 없음 → 404 회피)
    if (variant === 'jieun' || variant === 'sujin') {
      assignTexWhenReady(opacityMat, 'map', `/avatars/${variant}_opacity.png`, true)
    }
    m.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      const name = ((mesh.material as THREE.Material)?.name ?? '').toLowerCase()
      mesh.material = name.includes('opacity') ? opacityMat : name.includes('head') ? headMat : bodyMat
    })
    return m
  }, [
    scene,
    femaleOutfitScene,
    variant,
    embedded,
    mpfb,
    adultFemaleOutfit,
    grandmaCasual,
    femaleUniform,
    donorFemaleOutfit,
    maxAnisotropy,
    debugSkinSurface,
    chronologicalAge,
    identitySeed,
    skinTextureUrl,
    replaceBrokenLower,
  ])

  const nativeFaceMorphRigs = useMemo(() => collectNativeFaceMorphRigs(model), [model])
  const hasNativeFaceMorphs = nativeFaceMorphRigs.length > 0

  // ── 의료 진찰용 모듈 의복 ──
  // 모든 일치 메시를 수집해 같은 슬롯의 레이어(셔츠+재킷 등)를 한꺼번에 제어한다.
  const examActiveFromStore = useGame((state) => state.phase === 'exam')
  const examActive = examActiveFromStore || examActiveOverride
  const examGesture = useGame((state) => state.examGesture)
  const examTool = useGame((state) => state.examTool)
  const nativeOralMeshes = useMemo(() => {
    const result: { mesh: THREE.Mesh; visible: boolean }[] = []
    model.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const isNativeOral = materials.some((material) => {
        const kind = materialKind(mesh.name, material.name)
        return kind === 'teeth' || kind === 'tongue'
      })
      if (isNativeOral) result.push({ mesh, visible: mesh.visible })
    })
    return result
  }, [model])
  useEffect(() => {
    const replaceWithClinicalAsset = examActive && examGesture === 'mouth_open'
    for (const entry of nativeOralMeshes) {
      entry.mesh.visible = replaceWithClinicalAsset ? false : entry.visible
    }
    return () => {
      for (const entry of nativeOralMeshes) entry.mesh.visible = entry.visible
    }
  }, [nativeOralMeshes, examActive, examGesture])
  // 황달(공막 황염) — 케이스 patient.signs에 'jaundice'가 있으면 눈(공막) 재질을 노랗게 틴트.
  // 캐시된 재질을 다른 케이스가 재사용하므로 양방향으로 명시 설정해 잔류를 방지한다.
  const legacyJaundice = useGame((state) => !!state.session?.patient?.signs?.includes('jaundice'))
  const scleralIcterus = clinicalAppearance?.scleral_icterus ?? (legacyJaundice ? 1 : 0)
  const scleraColor = clinicalAppearance?.sclera_color ?? '#d9c775'
  useEffect(() => {
    const target = new THREE.Color(scleraColor)
    const tint = new THREE.Color('#ffffff').lerp(target, THREE.MathUtils.clamp(scleralIcterus, 0, 1))
    model.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if (materialKind(mesh.name, material.name) !== 'eye') continue
        // 결막 편라이트는 레이어 3의 안구·결막만 비춰 피부와 헤어에
        // 좁은 가로 조사 경계가 생기지 않게 한다. 카메라용 기본 레이어는 유지한다.
        mesh.layers.enable(3)
        const std = material as THREE.MeshStandardMaterial
        if (std.color) std.color.copy(tint)
      }
    })
  }, [model, scleralIcterus, scleraColor])

  /* 피부 황달·청색증·발한 — 텍스처를 교체하지 않고 재질 승수/광택만 조절한다.
     원래 재질값을 userData에 한 번 보관해 슬라이더를 왕복해도 색이 누적되지 않게 한다. */
  const skinJaundice = clinicalAppearance?.skin_jaundice ?? (legacyJaundice ? 0.65 : 0)
  const cyanosis = clinicalAppearance?.cyanosis ?? 0
  const diaphoresis = clinicalAppearance?.diaphoresis ?? 0
  const skinTintColor = clinicalAppearance?.skin_tint_color ?? '#d7b84a'
  useEffect(() => {
    const jaundiceTint = new THREE.Color(skinTintColor)
    const cyanosisTint = new THREE.Color('#7894b7')
    model.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if (materialKind(mesh.name, material.name) !== 'skin') continue
        const std = material as THREE.MeshStandardMaterial
        const physical = material as THREE.MeshPhysicalMaterial
        if (!std.color) continue
        type Base = { color: number; roughness: number; clearcoat: number }
        const existing = std.userData.clinicalAppearanceBase as Base | undefined
        const base = existing ?? {
          color: std.color.getHex(),
          roughness: std.roughness,
          clearcoat: physical.isMeshPhysicalMaterial ? physical.clearcoat : 0,
        }
        std.userData.clinicalAppearanceBase = base
        const multiplier = new THREE.Color('#ffffff')
          .lerp(jaundiceTint, THREE.MathUtils.clamp(skinJaundice, 0, 1) * 0.28)
          .lerp(cyanosisTint, THREE.MathUtils.clamp(cyanosis, 0, 1) * 0.26)
        std.color.setHex(base.color).multiply(multiplier)
        std.roughness = THREE.MathUtils.lerp(base.roughness, 0.22, diaphoresis)
        if (physical.isMeshPhysicalMaterial) {
          physical.clearcoat = THREE.MathUtils.lerp(base.clearcoat, 0.38, diaphoresis)
        }
        std.needsUpdate = true
      }
    })
  }, [model, skinJaundice, cyanosis, diaphoresis, skinTintColor])
  const upperGarment = useGame((state) => state.clinicalGarments.upper)
  const lowerGarment = useGame((state) => state.clinicalGarments.lower)
  const socksGarment = useGame((state) => state.clinicalGarments.socks)
  const shoesGarment = useGame((state) => state.clinicalGarments.shoes)
  const privacyDrape = useGame((state) => state.clinicalGarments.privacyDrape)
  const garmentMeshes = useMemo(() => {
    const records: GarmentMeshRecord[] = []
    model.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const slot = garmentSlot(mesh)
      if (!slot) return
      /* 진찰 부위를 체표에 안착시키는 ClinicScene의 레이캐스트가 옷을 구분할 수 있게 표시해 둔다.
         옷을 걷어올린 상태는 '메시 숨김'이 아니라 클리핑 평면으로 잘라내는 방식이라, 레이캐스트는
         잘려 보이지 않는 부분에도 그대로 맞는다 → 표시가 없으면 부위가 허공에 뜬다. */
      mesh.userData.patientGarment = slot
      records.push({ mesh, slot, originalVisible: mesh.visible })
    })
    return records
  }, [model])
  const garmentCutMetrics = useMemo(() => {
    const upper = new THREE.Box3()
    const lower = new THREE.Box3()
    for (const record of garmentMeshes) {
      if (record.slot !== 'upper' && record.slot !== 'lower') continue
      const box = meshBox(record.mesh)
      ;(record.slot === 'upper' ? upper : lower).union(box)
    }
    const fallbackUpper = new THREE.Box3(
      new THREE.Vector3(-0.24, 0.74, -0.16),
      new THREE.Vector3(0.24, 1.28, 0.2),
    )
    const fallbackLower = new THREE.Box3(
      new THREE.Vector3(-0.22, 0.02, -0.14),
      new THREE.Vector3(0.22, 0.84, 0.16),
    )
    const upperBox = upper.isEmpty() ? fallbackUpper : upper
    const lowerBox = lower.isEmpty() ? fallbackLower : lower
    const upperSize = upperBox.getSize(new THREE.Vector3())
    const lowerSize = lowerBox.getSize(new THREE.Vector3())
    const upperCenter = upperBox.getCenter(new THREE.Vector3())
    const appearanceAge = chronologicalAge ?? variantApproximateAge(variant)
    const pediatric = appearanceAge < 18
    const male = /mh_(?:m\d|youngm|oldm|boy)/.test(variant)
    const obese = variant.includes('_ob')
    const raiseRatio = pediatric ? 0.43 : male ? 0.4 : 0.6
    const proportionalRaise = THREE.MathUtils.lerp(upperBox.min.y, upperBox.max.y, raiseRatio)
    const anatomicalCeiling = pediatric ? 0.95 : male ? 1.035 : 1.0
    /* 노출 창의 두 끝은 **본**에서 온다 — 옷 bbox 비율로 잡으면 아바타마다 창이 제멋대로다.
       실측(mh_m70): 비율식이 만든 창은 17.2cm인데 평가표가 요구하는 칼돌기~두덩결합은 28.7cm라
       상복부가 니트 위에, 하복부가 바지 위에 찍혔다. 본을 쓰면 체형과 무관하게 그 구간이 나온다. */
    const skinMesh = findSkinBodyMesh(model) as THREE.SkinnedMesh | null
    const cutBones = skinMesh?.isSkinnedMesh && skinMesh.skeleton
      ? bindBonePositions(skinMesh.skeleton)
      : null
    const xiphoidY = cutBones ? pickBindBone(cutBones, ['spine03', 'spine02', 'spine2'])?.y ?? null : null
    const pubisY = cutBones ? pickBindBone(cutBones, ['pelvis', 'hips'])?.y ?? null : null
    const lowerDrapeHeight = THREE.MathUtils.clamp(lowerSize.y * 0.58, 0.44, 0.52)
    const lowerSkinFront = skinFrontInBand(
      model,
      lowerBox.max.y - lowerDrapeHeight * 1.08,
      lowerBox.max.y + 0.025,
      Math.min(lowerBox.max.z, obese ? 0.24 : 0.2),
    )
    return {
      upperRest: upperBox.min.y - upperSize.y * 0.03,
      /* 상의 절단 높이 = **칼돌기**(spine_03). 그 아래를 잘라내므로 상복부가 맨살이 된다.
         칼돌기는 젖가슴아래주름보다 7~8cm 아래라(실측 f20_thin: 칼돌기 0.988 / 주름 1.064)
         여기까지 걷어도 유방은 덮인 채로 남는다. 본이 없으면 종전 비율식으로 폴백한다. */
      /* 2026-07-26: 사용자 지시로 조금 더 걷었다("윗옷 조금만 더 걷어달래").
         칼돌기 그대로면 옷단이 상복부 마커에 닿아 '옷을 누르는' 그림이 남는다. 3cm 더 올린다.
         ⚠ 더 올리지 마라 — 젖가슴아래주름이 칼돌기보다 7~8cm 위라(실측 f20_thin: 칼돌기 0.988 /
           주름 1.064) 여유가 그만큼뿐이다. 넘기면 유방이 드러나 불필요한 노출이 된다. */
      upperRaised: xiphoidY !== null
        ? THREE.MathUtils.clamp(xiphoidY + 0.03, upperBox.min.y + upperSize.y * 0.12, upperBox.max.y)
        : Math.max(
            upperBox.min.y + upperSize.y * 0.2,
            Math.min(proportionalRaise, anatomicalCeiling),
          ),
      upperCenterX: upperCenter.x,
      // 하의 허리 폭을 몸통 폭의 근사치로 써 소매/판초 자락은 남기고 중앙 몸통만 걷는다.
      upperTorsoHalfWidth: THREE.MathUtils.clamp(
        lowerSize.x * 0.55,
        upperSize.x * 0.2,
        upperSize.x * 0.47,
      ),
      lowerRest: lowerBox.min.y - lowerSize.y * 0.03,
      lowerRolled: THREE.MathUtils.lerp(lowerBox.min.y, lowerBox.max.y, 0.62),
      /* 복부 노출 시 하의 허리선을 접어 내리는 높이.
         공식 평가표의 복부 진찰 노출 범위는 "칼돌기부터 두덩결합까지"인데, 상의만 걷어올리면
         배꼽 아래(하복부 2분면)가 통째로 바지 위에 남는다 — 학생 눈에는 '바지를 누르는' 진찰이 된다.
         허리밴드를 4~7cm 접어 내려 하복부를 드러내되 두덩부는 덮인 채로 둔다.
         (평소에는 lowerWaistRest = 옷 위쪽 바깥이라 아무것도 잘리지 않는다) */
      lowerWaistRest: lowerBox.max.y + lowerSize.y * 0.5 + 1,
      /* 허리선을 **두덩결합**(골반 본) 바로 위까지 접어 내린다. 종전의 "옷 높이의 10%"는
         마른 아바타에서 7cm밖에 안 내려가 하복부 2분면이 통째로 청바지 위에 남았다. */
      /* 2026-07-26: 사용자 지시로 조금 더 내렸다("저거 바지도 약간 내려야한데").
         `pubisY + 0.025`(두덩결합 2.5cm 위)는 하복부 2분면 마커가 여전히 허리밴드에 가까웠다.
         ⚠ 0 이하로는 내리지 마라 — 두덩부가 드러나면 평가표가 감점하는 **불필요한 노출**이다. */
      lowerWaistLowered: pubisY !== null
        ? THREE.MathUtils.clamp(pubisY + 0.008, lowerBox.min.y, lowerBox.max.y)
        : lowerBox.max.y - THREE.MathUtils.clamp(lowerSize.y * 0.1, 0.07, 0.11),
      lowerDrapeWidth: THREE.MathUtils.clamp(lowerSize.x * 1.08, 0.46, obese ? 0.68 : 0.58),
      lowerDrapeHeight,
      lowerGarmentTop: lowerBox.max.y + 0.012,
      // 프라이버시 천은 허리선보다 약간 아래에서 시작해 골반과 상부 대퇴를 덮는다.
      lowerDrapeTop: lowerBox.max.y + 0.012 - lowerDrapeHeight * 0.2,
      // 손상된 원본 치마의 비정상 bbox가 아니라 해당 골반/허벅지 피부 표면을 따라 놓는다.
      lowerFrontZ: THREE.MathUtils.clamp(
        lowerSkinFront + 0.025,
        0.12,
        obese ? 0.45 : 0.33,
      ),
    }
  }, [garmentMeshes, model, variant, chronologicalAge])
  const upperClipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const upperLeftClipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), [])
  const upperRightClipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), [])
  const lowerClipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  // 아래를 향한 법선 = "이 높이 위쪽을 잘라낸다" → 허리밴드를 접어 내리는 평면.
  const lowerWaistClipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), [])
  const localUpperPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -garmentCutMetrics.upperRest))
  const localUpperLeftPlane = useRef(new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0))
  const localUpperRightPlane = useRef(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0))
  const localLowerPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -garmentCutMetrics.lowerRest))
  const localLowerWaistPlane = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), garmentCutMetrics.lowerWaistRest))
  const upperCut = useRef(garmentCutMetrics.upperRest)
  const lowerCut = useRef(garmentCutMetrics.lowerRest)
  const lowerWaistCut = useRef(garmentCutMetrics.lowerWaistRest)
  /* 스킨 메시의 바인드 포즈 본 위치 — 모디스티 밴드와 시트 경로가 같은 좌표계를 쓴다.
     자세를 바꿔도 본의 바인드 위치는 변하지 않으므로 model마다 한 번만 잰다. */
  const bindBones = useMemo(() => {
    const skin = findSkinBodyMesh(model) as THREE.SkinnedMesh | null
    if (!skin?.isSkinnedMesh || !skin.skeleton) return null
    const box = new THREE.Box3().setFromObject(model)
    const positions = bindBonePositions(skin.skeleton)
    const pelvis = pickBindBone(positions, ['pelvis', 'hips'])
    const chest = pickBindBone(positions, ['spine03', 'spine02', 'spine2'])
    const thighBone = pickBindBone(positions, ['thighl', 'leftupleg'])
    const calfBone = pickBindBone(positions, ['calfl', 'leftleg'])
    return {
      positions,
      // MPFB 기준 키 1.6m 대비 배율 — 시트가 몸에서 뜨는 여유를 체격에 비례시킨다.
      bodyScale: THREE.MathUtils.clamp((box.max.y - box.min.y) / 1.6, 0.7, 1.35),
      pelvisFrontZ: pelvis ? bindSkinFrontAt(skin, pelvis.y, 0.05) : null,
      /* 넓적다리 앞면 반지름 — 바인드는 다리를 편 자세라 그 높이의 최대 z가 곧 반지름이다.
         마른 체형과 비만 체형이 2배 가까이 차이 나므로 시트 여유를 상수로 둘 수 없다.
         ⚠ **피부가 아니라 바지 앞면**을 기준으로 잡아야 한다. 시트는 맨다리가 아니라 바지 위에
         얹히는데, 통 넓은 바지는 피부보다 훨씬 앞으로 나온다(mh_m70에서 바지가 시트를 뚫었다). */
      thighRadius: thighBone && calfBone
        ? (() => {
            const midThighY = (thighBone.y + calfBone.y) * 0.5
            const skinFront = bindSkinFrontAt(skin, midThighY, 0.04)
            const garmentFront = bindGarmentFrontAt(garmentMeshes, 'lower', midThighY, 0.04)
            if (skinFront === null && garmentFront === null) return null
            return Math.max(skinFront ?? 0, garmentFront ?? 0)
          })()
        : null,
      // 복부 진찰: 칼돌기 바로 아래까지 걷어올린다(공식 평가표 노출 범위 = 칼돌기~두덩결합).
      gownRaiseY: (chest?.y ?? 1) - 0.012,
    }
  }, [model, garmentMeshes])
  const lowerDrape = useMemo(() => {
    const pelvis = bindBones ? pickBindBone(bindBones.positions, ['pelvis', 'hips']) : null
    const path = bindBones && pelvis
      ? makeDrapePath(
          bindBones.positions,
          pose === 'walk' ? 'sit' : pose,
          {
            // 두덩결합(≈골반 본 높이) 바로 위에서 시작한다 — 배는 진찰 부위라 노출된 채로 둔다.
            y: pelvis.y + 0.02,
            /* 골반 앞면 실측 + 여유. 여기만 이미 체표 좌표라 팔다리처럼 반지름을 더하지 않는다.
               시트는 맨몸이 아니라 **바지 위**에 얹히므로 옷 두께만큼 더 띄운다. */
            z: (bindBones.pelvisFrontZ ?? pelvis.z + 0.1) + 0.062,
          },
          bindBones.bodyScale,
          bindBones.thighRadius,
        )
      : null
    // 경로 시트는 모델 공간 절대좌표라 메시를 원점에 둔다. 폴백 패널만 종전처럼 배치한다.
    if (path) {
      return {
        /* 대체 치마를 숨기고 시트가 그 역할을 대신하므로, 시트 폭이 최소한 그 치마만큼은
           돼야 한다(비만 치마 밑단 반경 0.36 ≈ lowerDrapeWidth 0.68 × 0.52). */
        /* 폭 계수 0.52 는 **건드리지 마라.** 0.75 로 키워 봤다가 천이 다리를 삼킨 자루가 됐고
           옆단이 스스로를 뚫어 검은 슬래시가 생겼다(2026-07-26, 캡처 확인).
           위 `makeClinicalSheetGeometry` 주석의 "과하면 다리를 삼킨 자루" 경고가 그대로 재현됐다.

           ⚠️ 폭을 월드 X 범위로 재서 판단하지 마라. 시트는 다리 경로를 따라 로프트돼서
              **로컬 X 가 월드 X 와 다르다** — 바지의 월드 X 폭과 비교하면 항상 시트가 좁아 보인다.
              그걸 근거로 넓혔다가 위 사고가 났다. 판정은 캡처를 눈으로 보는 게 맞다. */
        geometry: makeClinicalSheetGeometry(garmentCutMetrics.lowerDrapeWidth * 0.52, path),
        offset: [0, 0, 0] as [number, number, number],
      }
    }
    return {
      // 본을 못 찾은 리그 — 종전의 골반 앞 패널로 폴백한다(적어도 두덩부는 가린다).
      geometry: makeClinicalDrapeGeometry(
        garmentCutMetrics.lowerDrapeWidth,
        garmentCutMetrics.lowerDrapeHeight,
      ),
      offset: [
        0,
        garmentCutMetrics.lowerDrapeTop - garmentCutMetrics.lowerDrapeHeight * 0.5,
        garmentCutMetrics.lowerFrontZ,
      ] as [number, number, number],
    }
  }, [garmentCutMetrics, bindBones, pose])
  const lowerDrapeWeave = useMemo(() => makeClothWeaveTexture(), [])
  const lowerDrapeMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#829fa2',
    roughness: 0.93,
    metalness: 0,
    bumpMap: lowerDrapeWeave,
    bumpScale: 0.0045,
    side: THREE.DoubleSide,
    // 천은 sheen이 있어야 천으로 보인다 (lab/fresh M.fabric과 같은 계열)
    sheen: 0.5,
    sheenColor: new THREE.Color('#dbe5e5'),
    sheenRoughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  }), [lowerDrapeWeave])

  useEffect(() => {
    if (!import.meta.env.DEV || !replaceBrokenLower) return
    console.info(
      `[patient-garment] drape ${variant}`
      + ` top=${garmentCutMetrics.lowerDrapeTop.toFixed(3)}`
      + ` height=${garmentCutMetrics.lowerDrapeHeight.toFixed(3)}`
      + ` front=${garmentCutMetrics.lowerFrontZ.toFixed(3)}`,
    )
  }, [garmentCutMetrics, replaceBrokenLower, variant])
  const replacementSkirtSize = useMemo(() => {
    const obese = variant === 'mh_f60_ob'
    return {
      topRadius: obese ? 0.28 : 0.215,
      bottomRadius: obese ? 0.36 : 0.335,
      height: obese ? 0.52 : 0.58,
      depthScale: obese ? 0.58 : 0.68,
      topOffset: obese ? -0.03 : 0,
    }
  }, [variant])
  const replacementSkirtGeometry = useMemo(
    () => makeClinicalSkirtGeometry(
      replacementSkirtSize.topRadius,
      replacementSkirtSize.bottomRadius,
      replacementSkirtSize.height,
    ),
    [replacementSkirtSize],
  )
  const replacementSkirtMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#46515d',
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
    sheen: 0.1,
    sheenColor: new THREE.Color('#aebbc4'),
    sheenRoughness: 0.92,
  }), [])

  useEffect(() => () => {
    lowerDrape.geometry.dispose()
    lowerDrapeMaterial.dispose()
    lowerDrapeWeave.dispose()
    replacementSkirtGeometry.dispose()
    replacementSkirtMaterial.dispose()
  }, [
    lowerDrape,
    lowerDrapeMaterial,
    lowerDrapeWeave,
    replacementSkirtGeometry,
    replacementSkirtMaterial,
  ])

  /* 환자복은 model 안에서 만들어진다(위 useMemo). 여기서는 표시·절단만 제어한다 —
     메시를 이펙트에서 만들면 StrictMode의 모의 언마운트가 지오메트리를 dispose해 버린다. */
  const gownLayers = useMemo(() => ({
    gown: (model.getObjectByName('medical_base_gown') as THREE.SkinnedMesh | undefined) ?? null,
    gownOpen: (model.getObjectByName('medical_base_gown_open') as THREE.SkinnedMesh | undefined) ?? null,
    drape: (model.getObjectByName('medical_base_chest_drape') as THREE.SkinnedMesh | undefined) ?? null,
  }), [model])
  /* 진찰 항목이 곧 노출 범위다(팀 스펙 표).
       흉부 청진·타진 → 앞섶을 칼돌기 아래까지 연 가운으로 바꾼다(여성은 유방 위 드레이프가 남는다)
       복부·옆구리   → 아랫단을 칼돌기 위로 걷어올린다
       두경부        → 그대로 입고 있는다 */
  const gownMode: 'worn' | 'lowered' | 'raised' = !examTool
    ? 'worn'
    : CHEST_EXAM_TOOLS.includes(examTool)
      ? 'lowered'
      : ABDOMEN_EXAM_TOOLS.includes(examTool)
        ? 'raised'
        : 'worn'
  const gownVisible = examActive && upperGarment === 'removed'
  const gownClipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const localGownPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  useEffect(() => {
    applyGownState(gownLayers, gownVisible, gownMode, gownClipPlane)
  }, [gownLayers, gownVisible, gownMode, gownClipPlane])

  useEffect(() => {
    const activeUpper = examActive ? upperGarment : 'worn'
    const activeLower = examActive ? lowerGarment : 'worn'
    const activeSocks = examActive ? socksGarment : 'worn'
    const activeShoes = examActive ? shoesGarment : 'worn'
    for (const record of garmentMeshes) {
      const { mesh, slot } = record
      if (replaceBrokenLower && slot === 'lower') {
        setGarmentVisibility(record, false)
      }
      const removed = slot === 'upper'
        ? activeUpper === 'removed'
        : slot === 'lower'
          ? activeLower === 'removed'
          : slot === 'socks'
            ? activeSocks === 'removed'
            : activeShoes === 'removed'
      if (!(replaceBrokenLower && slot === 'lower')) {
        setGarmentVisibility(record, record.originalVisible && !removed)
      }
      /* 하의는 '무릎까지 걷어올림(rolled)' 외에 '허리선 접어 내림(lowered)'도 클리핑으로 만든다.
         ⚠ 종전에는 `upper === 'raised'` 를 허리밴드 트리거로 같이 썼다. 그러면 상의만 올리는
         진찰(CVA 압통 등)에서도 바지가 내려가 sit_edge 캡처에서 볼기가 통째로 드러났다.
         노출은 진찰별로 갈려야 하고, 그 판단은 이미 store의 `lower === 'lowered'` 가 들고 있다. */
      const clipped = (slot === 'upper' && activeUpper === 'raised')
        || (slot === 'lower' && (activeLower === 'rolled' || activeLower === 'lowered'))
      const planes = slot === 'upper'
        ? [upperClipPlane, upperLeftClipPlane, upperRightClipPlane]
        : [lowerClipPlane, lowerWaistClipPlane]
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        // 상의는 '절단 높이 아래 AND 몸통 폭 안쪽'에서만 제거해 소매가 잘리지 않게 한다.
        setGarmentMaterialClipping(material, clipped, planes, slot === 'upper')
      }
    }
    return () => {
      for (const record of garmentMeshes) {
        setGarmentVisibility(record, record.originalVisible)
        const materials = Array.isArray(record.mesh.material) ? record.mesh.material : [record.mesh.material]
        for (const material of materials) {
          resetGarmentMaterialClipping(material)
        }
      }
    }
  }, [
    examActive,
    upperGarment,
    lowerGarment,
    socksGarment,
    shoesGarment,
    garmentMeshes,
    upperClipPlane,
    upperLeftClipPlane,
    upperRightClipPlane,
    lowerClipPlane,
    lowerWaistClipPlane,
    replaceBrokenLower,
  ])

  useEffect(() => {
    const clipped = replaceBrokenLower && examActive
      && (lowerGarment === 'rolled' || lowerGarment === 'lowered')
    setReplacementSkirtClipping(
      replacementSkirtMaterial,
      clipped,
      [lowerClipPlane, lowerWaistClipPlane],
    )
  }, [
    replaceBrokenLower,
    examActive,
    lowerGarment,
    upperGarment,
    lowerClipPlane,
    lowerWaistClipPlane,
    replacementSkirtMaterial,
  ])

  useFrame((_, delta) => {
    // 의복 자체 높이의 비율로 절단면을 감쇠 이동시켜 아동·고령·비만 체형도 같은 부위가 노출된다.
    const upperTarget = examActive && upperGarment === 'raised'
      ? garmentCutMetrics.upperRaised
      : garmentCutMetrics.upperRest
    const lowerTarget = examActive && lowerGarment === 'rolled'
      ? garmentCutMetrics.lowerRolled
      : garmentCutMetrics.lowerRest
    // 허리밴드는 store가 'lowered'(복부 진찰)라고 할 때만 접어 내린다 — 위 이펙트와 같은 트리거다.
    const waistTarget = examActive && lowerGarment === 'lowered'
      ? garmentCutMetrics.lowerWaistLowered
      : garmentCutMetrics.lowerWaistRest
    upperCut.current = THREE.MathUtils.damp(upperCut.current, upperTarget, 7.5, delta)
    lowerCut.current = THREE.MathUtils.damp(lowerCut.current, lowerTarget, 7.5, delta)
    lowerWaistCut.current = THREE.MathUtils.damp(lowerWaistCut.current, waistTarget, 7.5, delta)
    model.updateWorldMatrix(true, false)
    localUpperPlane.current.normal.set(0, 1, 0)
    localUpperPlane.current.constant = -upperCut.current
    upperClipPlane.copy(localUpperPlane.current).applyMatrix4(model.matrixWorld)
    const centerX = garmentCutMetrics.upperCenterX
    const halfWidth = garmentCutMetrics.upperTorsoHalfWidth
    localUpperLeftPlane.current.normal.set(-1, 0, 0)
    localUpperLeftPlane.current.constant = centerX - halfWidth
    upperLeftClipPlane.copy(localUpperLeftPlane.current).applyMatrix4(model.matrixWorld)
    localUpperRightPlane.current.normal.set(1, 0, 0)
    localUpperRightPlane.current.constant = -centerX - halfWidth
    upperRightClipPlane.copy(localUpperRightPlane.current).applyMatrix4(model.matrixWorld)
    localLowerPlane.current.normal.set(0, 1, 0)
    localLowerPlane.current.constant = -lowerCut.current
    lowerClipPlane.copy(localLowerPlane.current).applyMatrix4(model.matrixWorld)
    localLowerWaistPlane.current.normal.set(0, -1, 0)
    localLowerWaistPlane.current.constant = lowerWaistCut.current
    lowerWaistClipPlane.copy(localLowerWaistPlane.current).applyMatrix4(model.matrixWorld)
    /* 환자복 절단면 — 복부 진찰에서 아랫단을 칼돌기 위로 걷어올린다(그 높이 **위**만 남긴다).
       흉부는 앞섶을 연 셸로 교체하므로 클리핑을 쓰지 않는다.
       클리핑 평면은 월드 공간이라 자세 회전(눕히기)까지 매 프레임 반영해야 한다. */
    if (gownMode === 'raised' && bindBones) {
      localGownPlane.current.normal.set(0, 1, 0)
      localGownPlane.current.constant = -bindBones.gownRaiseY
      gownClipPlane.copy(localGownPlane.current).applyMatrix4(model.matrixWorld)
    }
  })

  // 본 맵 + 초기 쿼터니언 저장. VALID(Mixamo)·MPFB(game_engine)는 별칭으로 역할 키에 매핑.
  const boneAlias = valid ? MIXAMO_ALIAS : mpfb ? MPFB_ALIAS : null
  const { bones, init, followerBones } = useMemo(() => {
    const bones: Bones = {}
    const init: InitQuats = {}
    const followerBones: Record<string, THREE.Bone[]> = {}
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone && !o.name.includes('$AssimpFbx$')) {
        const k0 = norm(o.name)
        const k = boneAlias ? (boneAlias[k0] ?? k0) : k0
        if (o.userData.patientOutfitFollower) {
          ;(followerBones[k] ??= []).push(o as THREE.Bone)
          return
        }
        if (!bones[k]) {
          bones[k] = o as THREE.Bone
          init[k] = o.quaternion.clone()
        }
      }
    })
    /* 포즈가 안 먹을 때 **키 이름부터** 확인하라고 열어 둔다. 손가락 포즈를
       넣었는데 렌더가 그대로여서 축을 x/y/z 로 훑었는데, 실제 원인은 축이
       아니라 키가 안 잡히는 것일 수도 있었다 — 값을 훑기 전에 이걸 봐라. */
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      ;(window as unknown as { __patientBoneKeys?: string[] }).__patientBoneKeys =
        Object.keys(bones).sort()
    }
    return { bones, init, followerBones }
  }, [model, boneAlias])

  // 신장 정규화: 연령·성별·개인차를 반영하고 발은 항상 y=0에 둔다.
  const fit = useMemo(() => {
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const h = box.max.y - box.min.y
    const targetHeight = patientTargetHeight(variant, chronologicalAge, identitySeed)
    const s = h > 0 ? targetHeight / h : 1
    return { scale: s, yOff: -box.min.y * s }
  }, [model, variant, chronologicalAge, identitySeed])

  useEffect(() => {
    let alive = true
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        fn()
      }, ms)
      timers.add(timer)
    }
    const loop = () => {
      later(() => {
        if (!alive) return
        setBlink(true)
        later(() => alive && setBlink(false), 105 + Math.random() * 35)
        // 사람은 가끔 한 번 더 짧게 깜빡인다. 규칙적인 메트로놈 인상을 줄인다.
        if (Math.random() < 0.18) {
          later(() => alive && setBlink(true), 220)
          later(() => alive && setBlink(false), 315)
        }
        loop()
      }, 2300 + Math.random() * 3200)
    }
    loop()
    return () => {
      alive = false
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // 환자 교대 시 이전 모델의 머티리얼/텍스처 GPU 메모리 해제
  useEffect(() => {
    return () => {
      const materials = new Set<THREE.Material>()
      const ownedTextures = new Set<THREE.Texture>()
      const ownedGeometries = new Set<THREE.BufferGeometry>()
      const ownedSkeletons = new Set<THREE.Skeleton>()
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        if (mesh.geometry.userData.patientGeometryOwned) ownedGeometries.add(mesh.geometry)
        const skinned = mesh as THREE.SkinnedMesh
        if (skinned.isSkinnedMesh && skinned.userData.patientSkeletonOwned) {
          ownedSkeletons.add(skinned.skeleton)
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of mats) {
          if (!material || materials.has(material)) continue
          if (!material.userData.patientMaterialOwned) continue
          materials.add(material)
          if (isStandardMaterial(material)) {
            for (const texture of [
              material.map,
              material.normalMap,
              material.roughnessMap,
              material.metalnessMap,
              material.alphaMap,
              material.bumpMap,
              material.displacementMap,
            ]) {
              if (texture && (!embedded || texture.userData.patientTextureOwned)) {
                ownedTextures.add(texture)
              }
            }
          }
        }
      })
      for (const texture of ownedTextures) texture.dispose()
      for (const material of materials) material.dispose()
      for (const geometry of ownedGeometries) geometry.dispose()
      for (const skeleton of ownedSkeletons) skeleton.dispose()
    }
  }, [model, embedded])

  /* 본에 오일러 오프셋 적용 (바인드 포즈 기준) */
  const E = useMemo(() => new THREE.Euler(), [])
  const Q = useMemo(() => new THREE.Quaternion(), [])
  const TARGET_Q = useMemo(() => new THREE.Quaternion(), [])
  const apply = (key: string, x: number, y: number, z: number, damp = 0) => {
    const b = bones[key]
    const q0 = init[key]
    if (!b || !q0) return
    E.set(x, y, z)
    Q.setFromEuler(E)
    TARGET_Q.copy(q0).multiply(Q)
    if (damp > 0) b.quaternion.slerp(TARGET_Q, damp)
    else b.quaternion.copy(TARGET_Q)
  }

  /* ── 조준(aim) 기반 포즈: 본을 모델 공간의 원하는 방향으로 향하게 한다 ──
   * 바인드 포즈(T)에서 본→자식 방향과 본의 월드 회전을 한 번 측정해 두면,
   * 임의의 골격 축 배치에서도 정확한 자세를 만들 수 있다. */
  const aimData = useMemo(() => {
    model.updateMatrixWorld(true)
    const data: Record<string, { localDir: THREE.Vector3 }> = {}
    const pairs: [string, string][] = [
      ['lthigh', 'lcalf'], ['rthigh', 'rcalf'],
      ['lcalf', 'lfoot'], ['rcalf', 'rfoot'],
      ['lfoot', 'ltoe0'], ['rfoot', 'rtoe0'],
      ['lupperarm', 'lforearm'], ['rupperarm', 'rforearm'],
      ['lforearm', 'lhand'], ['rforearm', 'rhand'],
      ['leye', 'leyeend'], ['reye', 'reyeend'],
    ]
    for (const [parent, child] of pairs) {
      const p = bones[parent]
      const c = bones[child]
      if (!p || !c) continue
      data[parent] = { localDir: c.position.clone().normalize() } // 본 로컬에서 뼈가 뻗는 방향
    }
    // Rocketbox 눈 본은 끝 본이 없다. 바인드 포즈에서 캐릭터의 +Z 전방을 눈 본
    // 로컬로 환산해 조준 기준축으로 사용한다.
    const eyeWorldQ = new THREE.Quaternion()
    for (const key of ['leye', 'reye']) {
      const eye = bones[key]
      if (!eye || data[key]) continue
      eye.getWorldQuaternion(eyeWorldQ)
      data[key] = {
        localDir: new THREE.Vector3(0, 0, 1).applyQuaternion(eyeWorldQ.invert()).normalize(),
      }
    }
    return data
  }, [model, bones])

  const AIM_V = useMemo(() => new THREE.Vector3(), [])
  const AIM_Q = useMemo(() => new THREE.Quaternion(), [])
  const AIM_TARGET_Q = useMemo(() => new THREE.Quaternion(), [])
  const PARENT_Q = useMemo(() => new THREE.Quaternion(), [])
  const ROOT_Q = useMemo(() => new THREE.Quaternion(), [])
  const CAMERA_LOCAL = useMemo(() => new THREE.Vector3(), [])
  const HEAD_LOCAL = useMemo(() => new THREE.Vector3(), [])
  const CAMERA_DIRECTION = useMemo(() => new THREE.Vector3(), [])
  /* dir: 모델 공간(캐릭터 기준: +z 앞, +y 위)에서 뼈가 향할 방향.
   * 부모 본의 현재 자세와 캐릭터 루트 회전을 매 프레임 반영한다. */
  const aim = (key: string, dx: number, dy: number, dz: number, damp: number) => {
    const d = aimData[key]
    const b = bones[key]
    const q0 = init[key]
    if (!d || !b || !q0 || !b.parent || !group.current) return
    group.current.getWorldQuaternion(ROOT_Q)
    AIM_V.set(dx, dy, dz).normalize().applyQuaternion(ROOT_Q) // 모델공간 → 월드
    b.parent.getWorldQuaternion(PARENT_Q).multiply(q0) // 본이 바인드 로컬 자세일 때의 월드 회전
    AIM_V.applyQuaternion(PARENT_Q.invert()) // 월드 → 본 바인드 로컬
    AIM_Q.setFromUnitVectors(d.localDir, AIM_V)
    AIM_TARGET_Q.copy(q0).multiply(AIM_Q)
    b.quaternion.slerp(AIM_TARGET_Q, damp)
  }

  useFrame((state, delta) => {
    if (debugFreezePose) return
    const t = state.clock.elapsedTime
    const dampF = Math.min(1, delta * 7)

    /* ── 자세 전환 이징 ────────────────────────────────────────────────────
       "무릎 올려 주세요" 에 무릎이 **확** 올라오던 문제.

       원인은 속도가 아니라 **곡선**이다. 지수 감쇠(slerp 를 매 프레임 같은
       비율로)는 오차에 비례해 움직이므로 **시작 순간이 가장 빠르고** 끝에서만
       느려진다 — 사람 눈에는 "튕겨 나갔다가 스르르 멈추는" 로봇 동작이다.
       실제 몸은 반대로 천천히 시작해(가속) 천천히 멈춘다.

       그래서 자세 전용 감쇠율에 **0에서 올라오는 포락선**을 곱한다. 전환
       직후에는 비율이 0에 가까워 거의 안 움직이고(가속), 오차가 줄면서
       자연히 감속한다 — 지수 감쇠에 없던 이즈인이 생긴다.

       얼굴·시선·호흡은 그대로 dampF 를 쓴다. 그쪽까지 늦추면 말할 때 입이
       굼떠져 오히려 어색하다 — 느려야 하는 건 **몸통·팔다리**뿐이다. */
    const poseKey = `${pose}|${gesture}|${examGesture ?? ''}`
    if (poseEase.current.key !== poseKey) {
      poseEase.current = { key: poseKey, t: 0 }
    }
    const easeSeconds = poseEaseOverride ?? POSE_EASE_SECONDS
    poseEase.current.t = easeSeconds > 0
      ? Math.min(1, poseEase.current.t + delta / easeSeconds)
      : 1
    if (pose !== 'lie' && pose !== 'lie_knees') {
      kneeRaise.current.progress = 0
      kneeRaise.current.lyingFor = 0
    }
    const easeT = poseEase.current.t
    const envelope = easeSeconds > 0 ? easeT * easeT * (3 - 2 * easeT) : 1
    const dampP = Math.min(1, delta * (easeSeconds > 0 ? POSE_DAMP_RATE : 7) * envelope)

    /* ── 표정 = 대화 감정 + 통증 ──
     * 통증이 0 이면 종전과 완전히 같다(감정 표정 그대로). 0 보다 크면 `hurt` 를 섞는다.
     *  · 산통 파고: `painColickyPeriod` 주기로 0.55~1.0 사이를 오간다. **일정한 찡그림은
     *    가면처럼 보인다** — 세졌다 풀리는 변화가 있어야 아파 보인다. 파고는 급히 올라오고
     *    천천히 빠지는 비대칭이라 사인파를 그대로 쓰지 않는다(신산통의 실제 양상).
     *  · 입꼬리만 감정 쪽을 더 존중한다 — 웃으려는 환자가 통증에 입이 굳는 정도로만 눌린다. */
    const painBase = THREE.MathUtils.clamp(painLevel, 0, 1)
    let painNow = painBase
    if (painBase > 0 && painColickyPeriod && painColickyPeriod > 0) {
      const phase = ((t + motionPhase) / painColickyPeriod) % 1
      const surge = phase < 0.22
        ? Math.pow(phase / 0.22, 0.5)          // 몰려온다 (빠르게)
        : 1 - Math.pow((phase - 0.22) / 0.78, 1.6) // 잦아든다 (천천히)
      /* 파고 사이에도 신산통 NRS 9 환자가 정상 얼굴로 돌아가면 안 된다. 종전 최저 30%는
         캡처 시점에 따라 거의 무표정이 되어 “진짜 안 아파 보인다”는 인상을 만들었다. */
      painNow = painBase * (0.58 + 0.42 * surge)
    }
    face.browInner = THREE.MathUtils.lerp(emotionFace.browInner, AGONY.browInner, painNow)
    face.browSlant = THREE.MathUtils.lerp(emotionFace.browSlant, AGONY.browSlant, painNow)
    face.mouthCorner = THREE.MathUtils.lerp(emotionFace.mouthCorner, AGONY.mouthCorner, painNow * 0.85)
    face.jawIdle = THREE.MathUtils.lerp(emotionFace.jawIdle, AGONY.jawIdle, painNow)
    face.lidDown = THREE.MathUtils.lerp(emotionFace.lidDown, AGONY.lidDown, painNow)
    face.headTilt = THREE.MathUtils.lerp(emotionFace.headTilt, AGONY.headTilt, painNow)
    face.headTurn = THREE.MathUtils.lerp(emotionFace.headTurn, AGONY.headTurn, painNow)
    face.headDown = THREE.MathUtils.lerp(emotionFace.headDown, AGONY.headDown, painNow)
    /* 호흡 — **케이스 활력징후의 호흡수**를 따른다.
       ⚠ 종전에는 1.22 rad/s 로 고정돼 있어 어떤 케이스든 11.6회/분이었다. 케이스가 20회/분이라고
         적어 놔도 화면은 그것과 무관하게 숨 쉬었다.
       통증이 심하면 **빠르고 얕아진다**(splinting) — 복통 환자가 깊게 숨 쉬면 더 아프기 때문이다.
       그래서 painNow 만큼 주파수를 올리고 진폭은 줄인다. */
    const rrPerMin = THREE.MathUtils.clamp(respRate * (1 + painNow * 0.35), 8, 40)
    const breathW = (rrPerMin / 60) * Math.PI * 2
    const breathDepth = 1 - painNow * 0.35
    const breath = (
      Math.sin(t * breathW + motionPhase) * 0.72
      + Math.sin(t * breathW * 0.5 + motionPhase * 1.7) * 0.28
    ) * breathDepth
    const rawMouthLevel = speaking ? getMouthLevel() : 0
    const mouthDrive = speaking
      ? rawMouthLevel > 0.02
        ? rawMouthLevel
        : 0.12 + Math.abs(Math.sin(t * 6.4 + motionPhase)) * 0.16
      : 0
    speechEnergy.current = THREE.MathUtils.damp(
      speechEnergy.current,
      mouthDrive,
      speaking ? 10 : 6,
      delta,
    )
    blinkAmount.current = THREE.MathUtils.damp(
      blinkAmount.current,
      blink ? 1 : 0,
      blink ? 34 : 20,
      delta,
    )
    const voice = speechEnergy.current
    // 구강검사("아- 해보세요") 제스처 중엔 입을 크게 벌린 채 유지
    // 셰이더 개구 변위가 발화용(최대 ~4mm)이라 "아-"는 2배 정도로 크게 연다.
    // 2.0 이상은 Rocketbox 입꼬리를 볼쪽으로 길게 늘여 점막이 가짜 살점처럼 보였다.
    const proceduralMouth = examGesture === 'mouth_open'
      ? 1.65
      : Math.min(1, voice * 2.2 + face.jawIdle * 0.1)
    // 단순 상하 개폐 대신 원순/평순 모양이 교차하는 비짐 드라이브.
    const visemePulse = Math.sin(t * 8.3 + motionPhase * 1.7) * 0.58
      + Math.sin(t * 13.7 + motionPhase * 0.9) * 0.27
    const proceduralRound = speaking
      ? THREE.MathUtils.clamp((visemePulse * 0.5 + 0.5) * (0.26 + voice * 0.62), 0, 0.82)
      : 0

    // 카메라(의사)의 실제 위치를 기준으로 눈맞춤을 유지하되, 짧은 미세 도약과 드문
    // 회피 시선을 더한다. 진찰대처럼 캐릭터 루트가 회전해도 로컬 좌표로 환산된다.
    let cameraYaw = 0
    let cameraPitch = 0
    const patientGroup = group.current
    const headBone = bones.head
    if (patientGroup && headBone) {
      // 두경부 진찰 카메라/팔 앵커용 — 현재 환자의 머리 본 월드좌표를 공유 (아바타별 키 차이 자동 흡수)
      if (!embedded) headBone.getWorldPosition(PATIENT_HEAD_WORLD)
      state.camera.getWorldPosition(CAMERA_LOCAL)
      patientGroup.worldToLocal(CAMERA_LOCAL)
      headBone.getWorldPosition(HEAD_LOCAL)
      patientGroup.worldToLocal(HEAD_LOCAL)
      CAMERA_DIRECTION.subVectors(CAMERA_LOCAL, HEAD_LOCAL).normalize()
      cameraYaw = Math.atan2(CAMERA_DIRECTION.x, CAMERA_DIRECTION.z)
      cameraPitch = Math.atan2(
        CAMERA_DIRECTION.y,
        Math.hypot(CAMERA_DIRECTION.x, CAMERA_DIRECTION.z),
      )
    }
    const gaze = gazeMotion.current
    if (t >= gaze.nextMove) {
      const guarded = emotion === 'defensive'
        || emotion === 'guarded'
        || emotion === 'annoyed'
        || emotion === 'thinking'
      const away = Math.random() < (guarded ? 0.34 : 0.1)
      const yawRange = away ? 0.12 : 0.025
      const pitchRange = away ? 0.052 : 0.018
      gaze.targetX = (Math.random() * 2 - 1) * yawRange
      gaze.targetY = (Math.random() * 2 - 1) * pitchRange + (away ? 0.008 : 0)
      gaze.nextMove = t + (away ? 0.55 + Math.random() * 0.85 : 1.4 + Math.random() * 2.7)
    }
    const attention = emotion === 'defensive' || emotion === 'guarded' || emotion === 'annoyed'
      ? 0.42
      : 1
    // 결막검사("위를 봐주세요") — 시선을 위로 고정하고 눈을 크게 뜬다 (깜빡임 억제)
    const eyesUp = examGesture === 'eyes_up'
    const faceGesture = eyesUp || examGesture === 'mouth_open'
    /* 눈맞춤 범위. **종전 ±0.16rad(±9°)은 너무 좁아 환자가 의사를 안 봤다**
       (사용자 지적 2026-07-26: "말할 때 환자가 내 눈을 안 봐").
       문진 카메라는 정면이 아니라 옆에서 비스듬히 잡으므로 `cameraYaw` 가 20~40°까지 간다.
       9°로 자르면 시선이 의사를 한참 지나쳐 허공을 본다.
       ±0.45rad(±26°)로 넓힌다 — 사람 안구의 편안한 좌우 회전 한계가 그 근처다.
       ⚠ `aim()` 은 **모델 공간 절대 방향**을 받는다(`b.parent` 의 현재 월드 회전으로 역변환).
         즉 머리를 돌려도 눈은 여기서 준 방향을 그대로 본다 — 아래 `headTurn` 과 **이중 계산되지 않는다.** */
    const gazeGoalX = eyesUp ? 0 : THREE.MathUtils.clamp(cameraYaw * attention + gaze.targetX, -0.45, 0.45)
    /* ⚠ gaze.y 는 **음수가 위**다(바로 위 eyesUp 이 음수를 쓰는 것이 근거).
       그런데 종전에는 `+cameraPitch` 라, 의사 카메라가 환자보다 위에 있을수록
       눈이 더 **아래로** 내려갔다 — 머리 각도와 정확히 같은 부호 오류다.
       그래서 문진 화면에서 홍채가 안 보이고 흰자만 드러났다. */
    const gazeGoalY = eyesUp
      // -0.42는 홍채가 상안검 뒤로 완전히 숨어 흰자만 보였다.
      // 홍채 하부를 남기는 약 14° 상전이 결막 검사 시선으로 자연스럽다.
      ? -0.24
      : THREE.MathUtils.clamp(-cameraPitch * attention + gaze.targetY, -0.22, 0.22)
    gaze.x = THREE.MathUtils.damp(gaze.x, gazeGoalX, 18, delta)
    gaze.y = THREE.MathUtils.damp(gaze.y, gazeGoalY, eyesUp ? 8 : 18, delta)

    /* ── 미세 시선(microsaccade + drift) ──
     * ⚠ **사람 눈은 고정하고 있을 때도 결코 멈춰 있지 않는다.** 위 재타겟은 1.4~4.1초마다
     *   일어나는데, 그 사이 안구가 완전히 정지해 있으면 **인형 눈**으로 읽힌다.
     *   재질(각막 ior·clearcoat)은 이미 제대로 들어가 있어서, 남은 건 이 움직임이었다.
     * 실제 수치를 그대로 쓴다: 미세도약 0.1~0.5°(≈0.002~0.009rad)가 0.3~1.6초 간격,
     * 그 사이를 훨씬 작은 드리프트가 메운다. 진폭을 올리면 눈이 떨리는 환자가 되므로
     * ⚠ 값을 만졌으면 반드시 얼굴 클로즈업 **동영상**(연속 프레임)으로 확인해라 —
     *   정지 이미지로는 이 항이 있는지 없는지 알 수 없다. */
    if (t >= gaze.nextMicro) {
      gaze.microX = (Math.random() * 2 - 1) * 0.0065
      gaze.microY = (Math.random() * 2 - 1) * 0.0042
      gaze.nextMicro = t + 0.3 + Math.random() * 1.3
    }
    // 도약은 빠르게 붙고(damp 40), 드리프트는 저주파 사인으로 항상 흐른다.
    gaze.microCurX = THREE.MathUtils.damp(gaze.microCurX, gaze.microX, 40, delta)
    gaze.microCurY = THREE.MathUtils.damp(gaze.microCurY, gaze.microY, 40, delta)
    const driftX = Math.sin(t * 1.7 + motionPhase) * 0.0016 + Math.sin(t * 0.61) * 0.0011
    const driftY = Math.sin(t * 1.3 + motionPhase * 1.4) * 0.0012
    // 결막검사처럼 시선을 고정시켜야 하는 동작에서는 미세 움직임을 절반으로 줄인다.
    const microScale = faceGesture ? 0.45 : 1
    gaze.x += (gaze.microCurX + driftX) * microScale
    gaze.y += (gaze.microCurY + driftY) * microScale
    const lidAmount = faceGesture ? 0 : THREE.MathUtils.clamp(
      Math.max(blinkAmount.current, Math.max(0, face.lidDown) * 0.50),
      0,
      1,
    )

    if (hasNativeFaceMorphs) {
      const audio = getMouthFeatures()
      const spectrumDriven = speaking && rawMouthLevel > 0.012
      const fallbackWide = THREE.MathUtils.clamp(
        (1 - proceduralRound) * (0.42 + Math.sin(t * 10.7 + motionPhase) * 0.2),
        0,
        1,
      )
      const openShape = speaking
        ? spectrumDriven ? audio.open : proceduralMouth
        : face.jawIdle * 0.22
      const roundShape = speaking
        ? spectrumDriven ? audio.round : proceduralRound
        : 0
      const wideShape = speaking
        ? spectrumDriven ? audio.wide : fallbackWide
        : 0
      const closedShape = speaking
        ? spectrumDriven
          ? audio.closed
          : THREE.MathUtils.clamp(0.12 + Math.max(0, -visemePulse) * 0.45, 0, 1)
        : 0
      const fricativeShape = speaking
        ? spectrumDriven
          ? audio.fricative
          : THREE.MathUtils.clamp(Math.max(0, Math.sin(t * 15.1 + motionPhase)) * 0.28, 0, 1)
        : 0
      const speechShape = speaking
        ? THREE.MathUtils.clamp(0.08 + voice * 1.72, 0, 0.84)
        : 0
      const restingMouthClose = !speaking && face.jawIdle <= 0.001 ? 0.11 : 0

      // Broad spectral classes become a normalized blend of Meta visemes.
      // Normalizing prevents several individually valid targets from adding up
      // to an exaggerated, game-like mouth pose.
      const rawVisemes: Record<string, number> = {
        viseme_aa: 0.08 + openShape * (1 - roundShape * 0.72) * (1 - wideShape * 0.32),
        viseme_O: roundShape * (0.62 + openShape * 0.25),
        viseme_U: roundShape * (0.3 + closedShape * 0.28),
        viseme_E: wideShape * 0.58,
        viseme_I: wideShape * 0.34,
        viseme_PP: closedShape * 0.52,
        viseme_FF: fricativeShape * 0.38,
        viseme_SS: fricativeShape * (1 - roundShape) * 0.24,
      }
      const visemeTotal = Object.values(rawVisemes).reduce((sum, value) => sum + value, 0)
      const visemeScale = visemeTotal > 1e-5 ? speechShape / visemeTotal : 0
      for (const [name, value] of Object.entries(rawVisemes)) {
        driveNativeMorph(nativeFaceMorphRigs, name, value * visemeScale, delta, 20)
      }

      const smile = Math.max(0, face.mouthCorner) * 0.58 * (1 - speechShape * 0.28)
      const frown = Math.max(0, -face.mouthCorner) * 0.56 * (1 - speechShape * 0.22)
      const browRaise = Math.max(0, face.browInner)
      const browDown = Math.max(0, -face.browInner)
      const expressionAsymmetry = Math.sin(t * 0.41 + motionPhase * 1.3) * 0.035
      const leftExpression = 1 + expressionAsymmetry
      const rightExpression = 1 - expressionAsymmetry
      const guardedExpression = emotion === 'defensive'
        || emotion === 'guarded'
        || emotion === 'annoyed'
      const painExpression = painNow > 0.12 || emotion === 'hurt' || emotion === 'anxious'
      const emotionalSquint = Math.max(0, face.lidDown) * 0.22 + smile * 0.12
      const emotionalWide = Math.max(0, -face.lidDown) * 0.68
      const eyeWide = eyesUp ? Math.max(0.38, emotionalWide) : emotionalWide
      /* 구강검사에서는 jawOpen 하나만 입술 개구를 담당한다. 감정용 mouthFrown/
         mouthShrug 등을 동시에 합성하면 MPFB의 한쪽 입꼬리 정점이 턱 아래로 길게
         끌려가 피부 돌기처럼 보인다. 통증·불안은 눈과 눈썹에 계속 남기되 입 주변
         감정 모프만 잠시 중립화한다. */
      const oralExpressionScale = examGesture === 'mouth_open' ? 0 : 1

      driveNativeMorph(nativeFaceMorphRigs, 'eyeBlinkLeft', lidAmount * leftExpression, delta, 28)
      driveNativeMorph(nativeFaceMorphRigs, 'eyeBlinkRight', lidAmount * rightExpression, delta, 28)
      driveNativeMorph(nativeFaceMorphRigs, 'eyeSquintLeft', emotionalSquint * leftExpression, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'eyeSquintRight', emotionalSquint * rightExpression, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'eyeWideLeft', eyeWide * leftExpression, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'eyeWideRight', eyeWide * rightExpression, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'browInnerUp', browRaise * 0.58, delta)
      driveNativeMorph(
        nativeFaceMorphRigs,
        'browOuterUpLeft',
        (browRaise * 0.22 + (emotion === 'shocked' ? 0.34 : 0)) * leftExpression,
        delta,
      )
      driveNativeMorph(
        nativeFaceMorphRigs,
        'browOuterUpRight',
        (browRaise * 0.22 + (emotion === 'shocked' ? 0.34 : 0)) * rightExpression,
        delta,
      )
      driveNativeMorph(nativeFaceMorphRigs, 'browDownLeft', (browDown * 0.86 + (emotion === 'annoyed' ? 0.12 : 0)) * leftExpression, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'browDownRight', (browDown * 0.86 + (emotion === 'annoyed' ? 0.12 : 0)) * rightExpression, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthSmileLeft', smile * leftExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthSmileRight', smile * rightExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthFrownLeft', frown * leftExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthFrownRight', frown * rightExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'cheekSquintLeft', Math.max(smile * 0.20, painNow * 0.12) * leftExpression, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'cheekSquintRight', Math.max(smile * 0.20, painNow * 0.12) * rightExpression, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthPressLeft', Math.max(guardedExpression ? 0.12 : 0, painNow * 0.2) * leftExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthPressRight', Math.max(guardedExpression ? 0.12 : 0, painNow * 0.2) * rightExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthDimpleLeft', (guardedExpression ? 0.07 * leftExpression : 0) * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthDimpleRight', (guardedExpression ? 0.07 * rightExpression : 0) * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthUpperUpLeft', painNow * 0.2 * leftExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthUpperUpRight', painNow * 0.2 * rightExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthShrugUpper', (painExpression ? 0.06 + painNow * 0.16 : 0) * oralExpressionScale, delta)
      driveNativeMorph(
        nativeFaceMorphRigs,
        'noseSneerLeft',
        (emotion === 'annoyed' ? 0.07 : painNow * 0.18) * leftExpression,
        delta,
      )
      driveNativeMorph(
        nativeFaceMorphRigs,
        'noseSneerRight',
        (emotion === 'annoyed' ? 0.07 : painNow * 0.18) * rightExpression,
        delta,
      )
      driveNativeMorph(
        nativeFaceMorphRigs,
        'jawOpen',
        // 구강검사("아- 해보세요") 제스처 중엔 입을 크게 벌린 채 유지
        examGesture === 'mouth_open'
          // 정면 진료 카메라에서 0.62는 상·하악 사이가 좁아 혀와 인두가 가려졌다.
          // 구강검사 중 입 감정 모프는 중립이므로 0.78까지 열어 임상 시야를 확보한다.
          ? 0.78
          : THREE.MathUtils.clamp(openShape * 0.58 + voice * 0.18 + face.jawIdle * 0.1, 0, 0.78),
        delta,
        22,
      )
      driveNativeMorph(nativeFaceMorphRigs, 'mouthFunnel', roundShape * speechShape * 0.1, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthPucker', roundShape * speechShape * 0.075, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthStretchLeft', Math.max(wideShape * speechShape * 0.045, painNow * 0.12) * leftExpression * oralExpressionScale, delta)
      driveNativeMorph(nativeFaceMorphRigs, 'mouthStretchRight', Math.max(wideShape * speechShape * 0.045, painNow * 0.12) * rightExpression * oralExpressionScale, delta)
      driveNativeMorph(
        nativeFaceMorphRigs,
        'mouthClose',
        examGesture === 'mouth_open' ? 0 : Math.max(restingMouthClose, closedShape * speechShape * 0.08),
        delta,
        22,
      )
    }
    const hairMotion = pose === 'walk' ? 1 : pose === 'sit' ? 0.55 : 0.06
    group.current?.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const array = Array.isArray(mesh.material) ? mesh.material : null
      const materialCount = array ? array.length : 1
      for (let index = 0; index < materialCount; index++) {
        const material = array ? array[index] : mesh.material as THREE.Material
        const runtime = material.userData.patientRuntimeUniforms as PatientRuntimeUniforms | undefined
        if (!runtime) continue
        if (runtime.mouth) {
          runtime.mouth.value = THREE.MathUtils.damp(runtime.mouth.value, proceduralMouth, 16, delta)
          if (import.meta.env.DEV) (window as unknown as { __dbgMouth?: number }).__dbgMouth = runtime.mouth.value
        }
        if (runtime.mouthRound) {
          runtime.mouthRound.value = THREE.MathUtils.damp(runtime.mouthRound.value, proceduralRound, 13, delta)
        }
        if (runtime.blink) runtime.blink.value = lidAmount
        if (runtime.mouthMood) {
          runtime.mouthMood.value = THREE.MathUtils.damp(
            runtime.mouthMood.value,
            face.mouthCorner,
            8,
            delta,
          )
        }
        if (runtime.browRaise) runtime.browRaise.value = face.browInner
        if (runtime.browSlant) runtime.browSlant.value = face.browSlant
        if (runtime.gaze) runtime.gaze.value.set(gaze.x, gaze.y)
        if (runtime.time) runtime.time.value = t + motionPhase
        if (runtime.motion) {
          runtime.motion.value = THREE.MathUtils.damp(runtime.motion.value, hairMotion, 4, delta)
        }
      }
    })
    if (!embedded) {
      const eyeX = Math.tan(gaze.x)
      const eyeY = Math.tan(gaze.y)
      aim('leye', eyeX, eyeY, 1, Math.min(1, delta * 18))
      aim('reye', eyeX, eyeY, 1, Math.min(1, delta * 18))
    }
    /* ── 흉곽 팽창 ──
     * ⚠ **호흡은 본 회전으로 만들 수 없다.** 척추를 회전시키면 상체가 통째로 기울어
     *   머리까지 흔들린다 — 화면에서는 호흡이 아니라 **몸을 흔드는 것**으로 읽힌다.
     *   들숨/날숨 정점 차분 캡처로 확인했다: 밝게 빛나는 곳이 머리뿐이고 가슴은 검었다
     *   (`scratchpad/breathv/cmp.png`). 회전 진폭을 4배 올려도 가슴은 그대로였다.
     * 그래서 흉곽 자체를 **스케일**한다. 본 스케일은 그 본에 가중된 정점을 부풀리므로
     * 갈비뼈가 벌어지는 실제 호흡에 가깝다.
     * ⚠ 스케일은 **자식 본에 전파된다** — `spine2`(상부 흉곽)를 키우면 목·머리·팔이 같이 커진다.
     *   그래서 직계 자식(목·좌우 쇄골)에 역수를 걸어 상쇄한다. 이걸 빼먹으면 숨 쉴 때마다
     *   머리가 커졌다 작아진다. */
    /* ⚠ **자세에 따라 숨 쉬는 곳이 달라진다.** 앉거나 서 있으면 흉곽이 앞·옆으로
     *   벌어지지만, **누우면 횡격막 호흡이 우세해져 배가 오르내린다.** 예전에는 흉곽만
     *   부풀렸기 때문에 누운 환자는 사실상 숨을 안 쉬는 것처럼 보였다 —
     *   하필 복부 진찰이 그 자세에서 이뤄지는데, 학생이 봐야 할 배가 정지해 있었다.
     *   (모델 공간 +z=배 방향. 누우면 그룹이 X축 −90°로 돌아 +z가 화면 위가 되므로
     *    같은 스케일이 그대로 "배가 부풀어 오르는" 움직임이 된다.) */
    const lying = pose === 'lie' || pose === 'lie_knees'
    const chestGain = lying ? 0.55 : 1
    const bellyGain = lying ? 1 : 0.34
    const abdomenBone = bones.spine
    const chestBone = bones.spine2
    /* 스케일은 자식 본에 전파된다. 배(spine) → 흉곽(spine2) → 목·쇄골 순으로 쌓이므로
       각 단계에서 부모 몫을 나눠 상쇄해야 한다. 안 그러면 숨 쉴 때마다 머리가 커진다. */
    const bellyRise = breathBellyOverride ?? BREATH_BELLY_RISE
    const ax = 1 + breath * bellyRise * bellyGain
    const ay = 1 + breath * bellyRise * bellyGain * 0.25
    if (abdomenBone) abdomenBone.scale.set(ax, ay, ax)
    if (chestBone) {
      const sx = 1 + breath * BREATH_CHEST_WIDEN * chestGain
      const sy = 1 + breath * BREATH_CHEST_WIDEN * chestGain * 0.3
      // 부모(배)가 이미 곱한 만큼을 나눠서, 흉곽의 **최종** 배율이 sx가 되게 한다.
      chestBone.scale.set(abdomenBone ? sx / ax : sx, abdomenBone ? sy / ay : sy, abdomenBone ? sx / ax : sx)
      const ix = 1 / sx, iy = 1 / sy
      for (const k of ['neck', 'lclavicle', 'rclavicle'] as const) {
        const child = bones[k]
        if (child) child.scale.set(ix, iy, ix)
      }
    }
    const postureDrift = Math.sin(t * 0.37 + motionPhase) * (mpfb ? 0.004 : 0.012)

    /* ── 몸부림 (writhing) ────────────────────────────────────────────────
       신산통 환자는 **가만히 있지 못한다.** 자세를 계속 바꾸고 뒤척인다 —
       움직이면 아파서 굳어 있는 복막염과 갈리는 임상 소견이라 표현할 값어치가
       있다. 종전에는 누운 자세에 통증 반응이 **아예 없어서**(guard 항이 앉은
       자세에만 있었다) 얼굴만 찡그리고 몸은 마네킹처럼 굳어 있었다.

       파고(painNow)에 동기화한다 — 산통이 몰려올 때 뒤척이고 잦아들면 늘어진다.
       ⚠ 사인파 하나로 흔들면 시계추처럼 보인다. 서로 무리수 비의 주기 셋을
       섞어 같은 자세가 반복되지 않게 한다(호흡·미세 시선에서 쓴 방식과 같다). */
    const painWave = painBase > 0.001 ? painNow / painBase : 1
    const restlessnessBase = THREE.MathUtils.clamp(
      clinicalAppearance?.restlessness ?? painBase,
      0,
      1,
    )
    const guardingBase = THREE.MathUtils.clamp(
      clinicalAppearance?.guarding ?? painBase,
      0,
      1,
    )
    const writheGain = pose === 'lie' || pose === 'lie_knees' ? 1 : 0.5
    const writhe = restlessnessBase * (0.38 + painWave * 0.62) * writheGain
    const writheRoll =
      (Math.sin(t * 0.31 + motionPhase) * 0.6
        + Math.sin(t * 0.53 + motionPhase * 2.1) * 0.4) * writhe
    // 웅크리는 정도 0~1 — 파고에서 몸을 말았다가 풀린다.
    const writheCurl =
      (Math.sin(t * 0.19 + motionPhase * 0.7) * 0.5 + 0.5) * writhe

    // ── 자세 (모델 공간 방향: +z 앞, +y 위) ──
    const w = Math.sin(t * 5.0) * walkSpeed
    const stepCounter = Math.sin(t * 10.0 + motionPhase)
    if (pose === 'walk') {
      apply('pelvis', stepCounter * 0.008, w * 0.018, w * 0.024, dampF)
    } else {
      // 골반이 먼저 돌고 척추·다리가 따라간다 — 뒤척임의 축이다.
      apply(
        'pelvis',
        0,
        postureDrift * 0.12 + writheRoll * 0.10,
        postureDrift * 0.18 + writheRoll * 0.16,
        dampF,
      )
    }
    const shoulderBreath = breath * (mpfb ? 0.013 : 0.016)
    apply('lclavicle', 0, 0, shoulderBreath, dampF)
    apply('rclavicle', 0, 0, -shoulderBreath, dampF)
    if (pose === 'walk') {
      // 다리: 앞뒤 스윙(절제된 보폭), 뒷발 들 때만 무릎 굽힘
      aim('lthigh', 0.03, -1, w * 0.32, dampP)
      aim('rthigh', -0.03, -1, -w * 0.32, dampP)
      aim('lcalf', 0.03, -1, 0.06 + Math.max(0, -w) * 0.85, dampP)
      aim('rcalf', -0.03, -1, 0.06 + Math.max(0, w) * 0.85, dampP)
      aim('lfoot', 0.03, -0.35, 1, dampP)
      aim('rfoot', -0.03, -0.35, 1, dampP)
      // 팔: 다리 반대 스윙(작게)
      aim('lupperarm', 0.14, -1, -w * 0.22, dampP)
      aim('rupperarm', -0.14, -1, w * 0.22, dampP)
      aim('lforearm', 0.08, -1, -w * 0.18 + 0.3, dampP)
      aim('rforearm', -0.08, -1, w * 0.18 + 0.3, dampP)
    } else if (pose === 'sit') {
      // 앉기: 허벅지 수평 앞으로, 종아리 수직 아래, 손은 무릎 위
      aim('lthigh', 0.1, -0.12, 1, dampP)
      aim('rthigh', -0.1, -0.12, 1, dampP)
      aim('lcalf', 0.04, -1, 0.12, dampP)
      aim('rcalf', -0.04, -1, 0.12, dampP)
      /* 통증 방어자세(guarding) — 아프면 **배를 감싸 쥐고 몸을 웅크린다.**
         표정만 아프고 몸은 꼿꼿하면 오히려 어색하다(사용자 지시 2026-07-26:
         "행동도 약간 아파보이게 ... 배를 부여잡고 약간 숙이는").
         · 팔뚝을 배 쪽(안쪽·위)으로 모아 감싸 쥔다
         · 척추를 앞으로 숙인다
         통증 0이면 `guard`가 0이라 종전 자세와 **완전히 동일**하다. */
      /* 위팔은 몸통에서 **충분히 띄워야** 한다. 예전 값(0.16)은 팔이 옆구리에
         거의 붙는 각도라, 소매 겨드랑이 폴리곤이 서로 겹쳐 접히면서 흰 상의에
         **어두운 깃털 모양 얼룩**이 생겼다.

         원인 규명 기록(2026-08-02) — 같은 가설을 다시 세우지 마라:
           · 헤어/피부/환자복/그림자/의상맵 — 전부 렌더 이분법으로 배제(이전 조사)
           · **의자 관통 아님** — `?hideChair=1` 로 의자를 지워도 얼룩이 동일하다.
             이전 조사가 남긴 "다음 후보: 의자 관통" 은 여기서 기각됐다.
           · **음영이 아니라 지오메트리** — `?nopost=1` 로 후처리를 끄니 부드러운
             얼룩이 아니라 **접힌 소매 폴리곤 조각**으로 또렷하게 보였다.
             AO/그림자를 아무리 만져도 안 없어질 수밖에 없었다.

         ⚠ **완전히 없어지진 않았다.** 0.16 → 0.28 로 팔을 띄워 접힘을 크게
         줄였지만 소매-몸통 이음매의 주름은 남는다. 완전히 없애려면 포즈가
         아니라 **의상 메시 쪽**을 손봐야 한다(바인드 포즈에서 겨드랑이 정점을
         바깥으로 밀어내는 방식 — 허리 tuck 과 같은 계열). */
      const guard = guardingBase * (0.52 + painWave * 0.48)
      if (examGesture === 'hands_out') {
        // 손·관절/떨림검사: 양팔을 앞으로 내밀고 손바닥을 아래로 펴 좌우 손가락을 비교한다.
        aim('lupperarm', 0.20, -0.24, 0.95, dampP)
        aim('rupperarm', -0.20, -0.24, 0.95, dampP)
        aim('lforearm', 0.08, 0.02, 1, dampP)
        aim('rforearm', -0.08, 0.02, 1, dampP)
        aim('lhand', 0.04, -0.08, 1, dampP)
        aim('rhand', -0.04, -0.08, 1, dampP)
      } else {
        aim(
          'lupperarm',
          0.28 - guard * 0.05,
          -0.95 + guard * 0.10,
          0.18 + postureDrift + guard * 0.12,
          dampP,
        )
        aim(
          'lforearm',
          0.05 - guard * 0.26,          // 안쪽(정중선)으로 모은다
          -0.55 + guard * 0.30,         // 배 높이로 올린다
          0.85 + postureDrift * 0.6 - guard * 0.22,
          dampP,
        )
      }
      if (examGesture === 'hands_out') {
        // 위에서 양팔을 모두 배치했다.
      } else if (gesture === 'reach') {
        // 의사에게 손을 내미는 동작 — 오른팔을 앞으로 쭉 (+z 전방, 거의 수평)
        aim('rupperarm', -0.12, -0.3, 0.95, dampP)
        aim('rforearm', -0.04, 0.02, 1, dampP)
        aim('rhand', -0.04, 0.05, 1, dampP)
      } else {
        aim(
          'rupperarm',
          -0.28 + guard * 0.05,      // 좌측과 같은 이유 — 위 주석 참고
          -0.95 + guard * 0.10,
          0.18 - postureDrift + guard * 0.12,
          dampP,
        )
        aim(
          'rforearm',
          -0.05 + guard * 0.26,
          -0.55 + guard * 0.30,
          0.85 - postureDrift * 0.6 - guard * 0.22,
          dampP,
        )
      }
      apply(
        'spine',
        // 앞으로 숙인다. 파고가 셀 때 더 웅크린다.
        // 척추 굴곡도 같은 이유로 절제한다 — 너무 웅크리면 얼굴이 책상만 본다
        0.05 + breath * (mpfb ? 0.014 : 0.017) + guard * 0.09,
        postureDrift * 0.32,
        postureDrift * 0.22,
        dampP,
      )
    } else {
      // ── 누움(진찰대) ── 환자 group이 parent에서 X축 -90°로 눕혀진다.
      //   모델 공간(+y=머리쪽, -y=발쪽, +z=배(천장), -z=등(침대)) 기준으로만 포즈한다.
      /* 팔: 몸통 옆에 가지런히. 통증이 오면 아픈 쪽(우측 옆구리)으로 손이
         가고 팔이 몸에 붙는다 — 결석 환자가 실제로 하는 동작이다. */
      const lieGuardArm = writhe * 0.35
      aim('lupperarm', 0.22 - lieGuardArm * 0.10, -1, 0.05 + writheRoll * 0.06, dampP)
      aim('rupperarm', -0.22 + lieGuardArm * 0.10, -1, 0.05 + writheRoll * 0.06, dampP)
      aim('lforearm', 0.12 - lieGuardArm * 0.18, -1, 0.06 + writheCurl * 0.10, dampP)
      aim('rforearm', -0.12 + lieGuardArm * 0.34, -1, 0.06 + writheCurl * 0.16, dampP)
      /* 다리는 펴진 자세(파고 몸부림 포함)와 무릎 세움을 키프레임 진행률로 잇는다. */
      const raise = kneeRaise.current
      raise.lyingFor += delta
      const raiseGoal = pose === 'lie_knees' && raise.lyingFor > KNEE_RAISE_SETTLE
        ? 1 + KNEE_RAISE_TRAIL
        : 0
      // 아플수록 조심스럽게 느려진다. 내릴 때는 무게에 맡겨 조금 빠르다.
      const raiseStep = delta / (KNEE_RAISE_SECONDS * (1 + painBase * 0.6))
      raise.progress = raiseGoal > raise.progress
        ? Math.min(raiseGoal, raise.progress + raiseStep)
        : Math.max(raiseGoal, raise.progress - raiseStep * 1.15)
      // 앉은 자세에서 넘어오는 동안은 몸통과 같은 이징, 자리 잡은 뒤에는 키프레임을 그대로 따른다.
      const legRate = THREE.MathUtils.lerp(
        dampP,
        Math.min(1, delta * 16),
        THREE.MathUtils.smoothstep(raise.lyingFor, KNEE_RAISE_SETTLE, KNEE_RAISE_SETTLE + 0.6),
      )
      const legPull = writheCurl * 0.16
      const poseLeg = (side: 'l' | 'r', progress: number, thighPull: number, calfPull: number) => {
        const mirror = side === 'l' ? 1 : -1
        const lift = sampleMotionKeys(KNEE_LIFT_KEYS, progress)
        const footSet = sampleMotionKeys(FOOT_SET_KEYS, progress)
        const flat = 1 - lift
        const theta = KNEE_THETA * lift
        const phi = Math.asin(Math.min(1, KNEE_CALF_RATIO * Math.sin(theta)))
        // 들어 올리는 도중에 무릎이 살짝 바깥으로 흔들린다.
        const sway = 4 * lift * flat * 0.05 * mirror
        aim(
          `${side}thigh`,
          THREE.MathUtils.lerp(0.05 * mirror + writheRoll * 0.05, LIE.thighX * mirror, lift) + sway,
          -Math.cos(theta),
          Math.sin(theta) + (0.02 + thighPull) * flat,
          legRate,
        )
        aim(
          `${side}calf`,
          THREE.MathUtils.lerp(0.02 * mirror, LIE.calfX * mirror, lift),
          -Math.cos(phi),
          -Math.sin(phi) + (0.05 - calfPull) * flat,
          legRate,
        )
        aim(
          `${side}foot`,
          THREE.MathUtils.lerp(0.02 * mirror, LIE.footX * mirror, footSet),
          THREE.MathUtils.lerp(-0.4, LIE.footY, footSet),
          THREE.MathUtils.lerp(1, LIE.footZ, footSet),
          legRate,
        )
      }
      poseLeg('l', raise.progress, legPull, legPull * 0.8)
      poseLeg('r', raise.progress - KNEE_RAISE_TRAIL, legPull * 1.3, legPull)
      // 다리를 드는 동안 몸통에 힘이 들어간다.
      const raiseEffort = Math.sin(Math.PI * THREE.MathUtils.clamp(raise.progress / (1 + KNEE_RAISE_TRAIL), 0, 1))
      apply('spine', raiseEffort * 0.05, 0, 0, dampP)
    }

    /* ── 손 ────────────────────────────────────────────────────────────────
       바인드 포즈의 손은 손가락이 **일자로 편 채 붙어 있어** 확대하면 손이
       아니라 주걱으로 보인다(손가락 사이가 이음선으로만 남는다). 실제로 힘을
       뺀 손은 손가락마다 조금씩 다르게 말리고, 새끼로 갈수록 더 많이 말린다.

       MPFB(game_engine) 골격은 손가락 본이 마디마다 3개씩 있다
       (`index_01_l` … `pinky_03_l`). 별칭 없이 정규화 이름으로 잡힌다.
       ⚠ 굴곡 축은 골격마다 다르다 — 짐작하지 말고 `?fingerAxis=x|y|z` 와
       `?fingerCurl=` 로 렌더를 보고 맞춰라. */
    for (const side of ['l', 'r'] as const) {
      const mirror = side === 'l' ? 1 : -1
      for (const [finger, curlScale, spread] of FINGER_RELAX) {
        for (let joint = 1; joint <= 3; joint++) {
          // 끝마디로 갈수록 더 말린다. 첫마디는 벌림(외전)도 조금 준다.
          const curl = handCurl * curlScale * (joint === 1 ? 0.62 : joint === 2 ? 1 : 0.78)
          const abduct = joint === 1 ? spread * mirror * 0.5 : 0
          const key = `${finger}0${joint}${side}`
          if (fingerAxis === 'x') apply(key, curl, abduct, 0, dampF)
          else if (fingerAxis === 'y') apply(key, 0, curl, abduct, dampF)
          else apply(key, abduct, 0, curl, dampF)
        }
      }
    }

    // ── 머리/호흡 ── 단일 사인파 대신 서로 다른 주기를 섞어 반복 기계 동작을 줄인다.
    const speechNod = Math.sin(t * 4.1 + motionPhase) * voice * 0.028
    const microNod =
      Math.sin(t * 0.73 + motionPhase) * 0.0045
      + Math.sin(t * 0.21 + motionPhase * 1.8) * 0.0025
    /* ⚠ 의사를 **올려다봐야** 한다. 종전에는 `+ cameraPitch * 0.035` 였는데
       부호도 반대고 크기도 1° 미만이라 사실상 없는 항이었다. 그 결과 의사
       카메라가 환자보다 위에 있는데도 환자는 계속 **9.2° 아래**를 보고 있었고
       (본 실측), 화면에서는 얼굴 대신 정수리와 흰자만 보였다.
       "사람이 원숭이가 됐다"는 지적의 실제 원인이 이것이다.
       ⚠ 값을 바꾸면 진료실에서 머리 전방벡터를 다시 재라 — AvatarLab 은 카메라가
       정면이라 이 결함이 아예 안 나타난다. */
    /* ⚠ **앉은 자세에서만** 건다. 이 항은 문진 카메라(환자보다 위)를 올려다보게
       하려는 것인데, 누운 자세에 걸리면 천장 카메라를 향해 **턱을 치켜드는**
       부자연스러운 자세가 된다 — "누웠을 때 예전이 낫다"는 지적(2026-08-03)의
       원인. 걷기(입장)도 카메라를 계속 쳐다보며 걸을 이유가 없다. */
    const lookAtDoctor = pose === 'sit'
      ? THREE.MathUtils.clamp(cameraPitch * attention, -0.5, 0.5) * HEAD_LOOK_UP_GAIN
      : 0
    const headPitch = mpfb
      ? face.headDown + breath * 0.0035 + microNod + speechNod * 0.65 - lookAtDoctor
      : face.headDown + breath * 0.006 + speechNod + blinkAmount.current * 0.003 - lookAtDoctor
    /* 고개도 의사 쪽으로 돌린다. 종전 `clamp(cameraYaw, ±0.12) * 0.16` 은
       **최대 0.019rad = 1.1°** 라 사실상 정면만 보고 있었다 — 눈만 굴리고 고개는 안 돌리니
       시선을 피하는 사람처럼 보였다.
       사람은 비스듬한 상대를 볼 때 고개로 각도의 절반쯤을 먹고 나머지를 눈이 채운다.
       0.5 배·최대 ±0.40rad(±23°)로 그 비율을 맞춘다. 눈은 위에서 이미 전체 각도를 보므로
       고개는 **자연스러움 담당**이고, 많이 돌린다고 눈맞춤이 어긋나지 않는다. */
    /* 구강검사 카메라는 몸통의 정면축에 정렬된다. 그런데 환자 머리는
       감정 headTurn과 시선 보정으로 따로 돌아가, 입안 옆벽이 한쪽 입꼬리
       밖으로 튀어나온 것처럼 보였다. "아-"를 하는 동안은 머리를 정면으로 고정한다. */
    const headTurn = examGesture === 'mouth_open'
      ? 0
      : face.headTurn
        + THREE.MathUtils.clamp(cameraYaw * 0.5 * attention, -0.40, 0.40)
        + Math.sin(t * 0.24 + motionPhase) * (mpfb ? 0.006 : 0.014)
    const headRoll = examGesture === 'mouth_open'
      ? 0
      : face.headTilt + Math.sin(t * 0.31 + motionPhase * 0.7) * (mpfb ? 0.004 : 0.008)
    apply('head', headPitch, headTurn, headRoll, dampF)
    apply(
      'neck',
      headPitch * (mpfb ? 0.1 : 0.18),
      headTurn * (mpfb ? 0.07 : 0.12),
      -headRoll * 0.1,
      dampF,
    )
    apply(
      'spine2',
      breath * (mpfb ? 0.026 : 0.030) + voice * (mpfb ? 0.0035 : 0.006),
      Math.sin(t * 0.19 + motionPhase) * (mpfb ? 0.0015 : 0.004),
      postureDrift * (mpfb ? 0.08 : 0.18),
      dampF,
    )

    // ── 표정 ──
    const browUp = face.browInner
    apply('linnereyebrow', -browUp * 0.25 - face.browSlant * 0.12, 0, 0, dampF)
    apply('rinnereyebrow', -browUp * 0.25 - face.browSlant * 0.12, 0, 0, dampF)
    apply('mmiddleeyebrow', -browUp * 0.2, 0, 0, dampF)
    apply('loutereyebrow', -browUp * 0.1 + face.browSlant * 0.1, 0, 0, dampF)
    apply('routereyebrow', -browUp * 0.1 + face.browSlant * 0.1, 0, 0, dampF)
    /* "아-"로 크게 벌린 입에 감정/통증 입꼬리 본까지 계속 당기면
       Rocketbox의 한쪽 입꼬리가 볼 밖으로 길게 늘어진다. 구강검사 자세에서만
       입꼬리를 중립으로 두고, 통증 표정은 미간·눈가·고개에 남긴다. */
    const mouthCornerBone = examGesture === 'mouth_open' ? 0 : face.mouthCorner * -0.3
    apply('lmouthcorner', mouthCornerBone, 0, 0, dampF)
    apply('rmouthcorner', mouthCornerBone, 0, 0, dampF)

    // ── 턱 (립싱크) ──
    // 립싱크: 실제 음성 진폭에 맞춰 입 벌림 (없으면 약한 폴백 오실레이션)
    // Rocketbox(Biped) 턱은 Z축이 입 벌림 (X는 비틀림)
    const jaw = examGesture === 'mouth_open'
      // 구형 Rocketbox는 음성 파형의 순간 피크를 그대로 턱 본에 넣으면
      // 하순 스키닝 일부가 볼 밖으로 찢어진다. "아-"는 고정 개구각이 더 자연스럽다.
      ? 0.10
      : speaking
        ? rawMouthLevel > 0.02
          ? 0.03 + rawMouthLevel * 0.42
          : 0.035 + voice * 0.5
        : face.jawIdle * 0.2
    // 네이티브 jawOpen이 피부/입술을 담당하고, 턱 본은 치아·혀가 따라오는
    // 정도만 남긴다. 구형 아바타는 기존 본 기반 개폐를 그대로 유지한다.
    apply('mjaw', 0, 0, hasNativeFaceMorphs ? jaw * 0.34 : jaw, dampF * 2.4)

    // ── 눈꺼풀 (깜빡임 + 감정) ──
    const lid = Math.max(blinkAmount.current * 0.5, Math.max(0, face.lidDown) * 0.35)
    apply('leyeblinktop', lid, 0, 0, 1)
    apply('reyeblinktop', lid, 0, 0, 1)

    // 전용 의상 리그에는 환자의 최종 자세만 복사한다. 각 의상 본의 원래 위치와
    // inverse-bind 행렬은 건드리지 않아 비만 체형에서도 천이 찢어지지 않는다.
    for (const [key, followers] of Object.entries(followerBones)) {
      const source = bones[key]
      if (!source) continue
      for (const follower of followers) {
        follower.quaternion.copy(source.quaternion)
        follower.scale.copy(source.scale)
      }
    }
  })

  /* ── 시각 소견(§7) — 결막 창백 / 갑상샘 종대 / 위축성 설염 ──────────────────
     황달과 달리 이 셋은 모델에 없는 구조물이라 메시를 새로 얹는다. 지킬 규칙:
     · 위치는 머리 본 기준 상대 오프셋. 절대 좌표를 쓰면 아바타 키마다 어긋난다.
     · 재질에 anisotropy 금지. UV 없는 메시에 걸면 탄젠트가 NaN이 되어
       Bloom/N8AO가 화면 전체를 검게 만든 전례가 있다.
     · 해당 제스처 중에만 보이게 해 평상시 얼굴은 그대로 둔다.
     · 정상 소견은 굳이 그리지 않는다. 단 결막만은 "정상은 이렇게 붉다"는 대조가
       학습 자체라 소견 유무와 무관하게 eyes_up 중 항상 그리고 색만 바꾼다. */
  const legacyPaleConjunctiva = useGame((state) => !!state.session?.patient?.signs?.includes('pale_conjunctiva'))
  const legacyGoiter = useGame((state) => !!state.session?.patient?.signs?.includes('goiter'))
  const legacyAtrophicGlossitis = useGame((state) => !!state.session?.patient?.signs?.includes('atrophic_glossitis'))
  const conjunctivalPallor = clinicalAppearance?.conjunctival_pallor ?? (legacyPaleConjunctiva ? 1 : 0)
  const conjunctivaColor = clinicalAppearance?.conjunctiva_color ?? SIGN_COLOR.conjunctivaPale
  const goiterSign = clinicalAppearance?.goiter ?? legacyGoiter
  const atrophicGlossitis = clinicalAppearance?.atrophic_glossitis ?? legacyAtrophicGlossitis
  const oralAsset = useMemo(() => {
    const clone = oralAssetScene.clone(true)
    const materialClones = new Map<THREE.Material, THREE.Material>()
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const cloneMaterial = (source: THREE.Material) => {
        const cached = materialClones.get(source)
        if (cached) return cached
        const next = source.clone()
        materialClones.set(source, next)
        return next
      }
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(cloneMaterial)
        : cloneMaterial(mesh.material)
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      mesh.layers.enable(2)
    })
    return clone
  }, [oralAssetScene])
  useEffect(() => {
    oralAsset.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if (material.name !== 'GNM_Tongue') continue
        const standard = material as THREE.MeshStandardMaterial
        standard.color.set(atrophicGlossitis ? SIGN_COLOR.tongueAtrophic : '#78383e')
        standard.roughness = atrophicGlossitis ? 0.32 : 0.48
      }
    })
  }, [oralAsset, atrophicGlossitis])
  useEffect(() => () => {
    const materials = new Set<THREE.Material>()
    oralAsset.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const values = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of values) materials.add(material)
    })
    for (const material of materials) material.dispose()
  }, [oralAsset])
  const signAnchors = useMemo(
    () => measureVisualSignAnchors(model, bones.head, bones.neck, bones.lclavicle, bones.rclavicle),
    [model, bones],
  )
  const oralAssetScale = signAnchors.oral
    ? THREE.MathUtils.clamp(signAnchors.oral.radius.x * 1.85 / 0.0851, 0.48, 0.72)
    : 0.6
  const fingerSwelling = {
    left: THREE.MathUtils.clamp(clinicalAppearance?.finger_swelling_left ?? 0, 0, 1),
    right: THREE.MathUtils.clamp(clinicalAppearance?.finger_swelling_right ?? 0, 0, 1),
  }
  const legEdema = {
    left: THREE.MathUtils.clamp(clinicalAppearance?.leg_edema_left ?? 0, 0, 1),
    right: THREE.MathUtils.clamp(clinicalAppearance?.leg_edema_right ?? 0, 0, 1),
  }
  const rashLevel = THREE.MathUtils.clamp(clinicalAppearance?.rash_level ?? 0, 0, 1)
  const rashRegion = clinicalAppearance?.rash_region ?? 'torso'
  const rashColor = clinicalAppearance?.rash_color ?? '#b94a55'
  const bruiseLevel = THREE.MathUtils.clamp(clinicalAppearance?.bruise_level ?? 0, 0, 1)
  const bruiseRegion = clinicalAppearance?.bruise_region ?? 'left_leg'
  const bruiseColor = clinicalAppearance?.bruise_color ?? '#59456f'
  // 단위 구 하나를 결막 띠(구각)와 융기(타원체)가 나눠 쓰고, 크기는 mesh scale로 준다.
  const conjunctivaGeometry = useMemo(() => new THREE.SphereGeometry(
    1, 28, 6,
    Math.PI / 2 - CONJUNCTIVA_PHI_LENGTH / 2, CONJUNCTIVA_PHI_LENGTH,
    CONJUNCTIVA_THETA_START, CONJUNCTIVA_THETA_LENGTH,
  ), [])
  const bulgeGeometry = useMemo(() => new THREE.SphereGeometry(1, 28, 18), [])
  const jointGeometry = useMemo(() => new THREE.SphereGeometry(1, 18, 12), [])
  const edemaGeometry = useMemo(() => new THREE.CapsuleGeometry(1, 1, 8, 20), [])
  const lesionGeometry = useMemo(() => new THREE.CircleGeometry(1, 36), [])
  const lesionAlphaMap = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const context = canvas.getContext('2d')!
    context.fillStyle = '#000'
    context.fillRect(0, 0, 128, 128)
    const gradient = context.createRadialGradient(61, 59, 5, 64, 64, 62)
    gradient.addColorStop(0, '#f4f4f4')
    gradient.addColorStop(0.46, '#d8d8d8')
    gradient.addColorStop(0.76, '#838383')
    gradient.addColorStop(0.91, '#252525')
    gradient.addColorStop(1, '#000')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 128)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.NoColorSpace
    return texture
  }, [])
  const conjunctivaMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: SIGN_COLOR.conjunctivaNormal,
    roughness: 0.4,   // 젖은 점막이라 약하게 반짝인다
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: true,
    // 눈꺼풀 피부와 거의 같은 깊이에 놓여 z-fighting이 나므로 살짝 앞으로 당긴다.
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  }), [])
  const goiterMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: SIGN_COLOR.skinFallback,
    roughness: 0.66,
    metalness: 0,
    depthWrite: true,
  }), [])
  const oralCavityMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#6a3038', roughness: 0.82, metalness: 0, side: THREE.DoubleSide,
  }), [])
  const softPalateMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#a65b61', roughness: 0.68, metalness: 0, side: THREE.DoubleSide,
  }), [])
  const tonsilMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#87434b', roughness: 0.76, metalness: 0, side: THREE.DoubleSide,
  }), [])
  const swellingMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: SIGN_COLOR.skinFallback,
    roughness: 0.68,
    metalness: 0,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }), [])
  const rashMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: rashColor,
    roughness: 0.76,
    metalness: 0,
    transparent: true,
    opacity: rashLevel * 0.72,
    alphaMap: lesionAlphaMap,
    depthWrite: false,
    depthTest: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  }), [])
  const bruiseMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: bruiseColor,
    roughness: 0.72,
    metalness: 0,
    transparent: true,
    opacity: bruiseLevel * 0.78,
    alphaMap: lesionAlphaMap,
    depthWrite: false,
    depthTest: false,
    polygonOffset: true,
    polygonOffsetFactor: -9,
    polygonOffsetUnits: -9,
  }), [])
  useEffect(() => {
    rashMaterial.color.set(rashColor)
    rashMaterial.opacity = rashLevel * 0.72
    rashMaterial.needsUpdate = true
  }, [rashMaterial, rashColor, rashLevel])
  useEffect(() => {
    bruiseMaterial.color.set(bruiseColor)
    bruiseMaterial.opacity = bruiseLevel * 0.78
    bruiseMaterial.needsUpdate = true
  }, [bruiseMaterial, bruiseColor, bruiseLevel])
  useEffect(() => {
    // 재질은 케이스가 바뀌어도 재사용되므로 정상/창백 양방향으로 명시해 잔류를 막는다.
    conjunctivaMaterial.color
      .set(SIGN_COLOR.conjunctivaNormal)
      .lerp(new THREE.Color(conjunctivaColor), THREE.MathUtils.clamp(conjunctivalPallor, 0, 1))
  }, [conjunctivaMaterial, conjunctivalPallor, conjunctivaColor])
  useEffect(() => () => {
    conjunctivaGeometry.dispose()
    bulgeGeometry.dispose()
    jointGeometry.dispose()
    edemaGeometry.dispose()
    lesionGeometry.dispose()
    lesionAlphaMap.dispose()
    conjunctivaMaterial.dispose()
    goiterMaterial.dispose()
    oralCavityMaterial.dispose()
    softPalateMaterial.dispose()
    tonsilMaterial.dispose()
    swellingMaterial.dispose()
    rashMaterial.dispose()
    bruiseMaterial.dispose()
  }, [conjunctivaGeometry, bulgeGeometry, jointGeometry, edemaGeometry, lesionGeometry, lesionAlphaMap, conjunctivaMaterial, goiterMaterial, oralCavityMaterial, softPalateMaterial, tonsilMaterial, swellingMaterial, rashMaterial, bruiseMaterial])

  const signAnchorRef = useRef<THREE.Group>(null)
  const conjunctivaRef = useRef<THREE.Group>(null)
  const goiterRef = useRef<THREE.Group>(null)
  const fingerJointRefs = useRef<(THREE.Group | null)[]>([])
  const leftEdemaRef = useRef<THREE.Group>(null)
  const rightEdemaRef = useRef<THREE.Group>(null)
  const rashRef = useRef<THREE.Group>(null)
  const bruiseRef = useRef<THREE.Group>(null)
  const fingerJoints = useMemo(() => {
    const result: {
      bone: THREE.Bone
      side: 'left' | 'right'
      longAxis: 'x' | 'y' | 'z'
      baseScale: THREE.Vector3
    }[] = []
    for (const [suffix, side] of [['l', 'left'], ['r', 'right']] as const) {
      for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
        for (const joint of [1, 2]) {
          const bone = bones[`${finger}0${joint}${suffix}`]
          if (bone) {
            const child = bone.children.find((node) => (node as THREE.Bone).isBone)
            const direction = child?.position ?? new THREE.Vector3(0, 1, 0)
            const longAxis = Math.abs(direction.x) >= Math.abs(direction.y) && Math.abs(direction.x) >= Math.abs(direction.z)
              ? 'x'
              : Math.abs(direction.y) >= Math.abs(direction.z) ? 'y' : 'z'
            result.push({ bone, side, longAxis, baseScale: bone.scale.clone() })
          }
        }
      }
    }
    return result
  }, [bones])
  const calfBones = useMemo(() => ([
    { bone: bones.lcalf, foot: bones.lfoot, level: legEdema.left },
    { bone: bones.rcalf, foot: bones.rfoot, level: legEdema.right },
  ]).map((entry) => {
    const direction = entry.foot?.position ?? new THREE.Vector3(0, -1, 0)
    const longAxis = Math.abs(direction.x) >= Math.abs(direction.y) && Math.abs(direction.x) >= Math.abs(direction.z)
      ? 'x'
      : Math.abs(direction.y) >= Math.abs(direction.z) ? 'y' : 'z'
    return {
      ...entry,
      longAxis,
      baseScale: entry.bone?.scale.clone() ?? new THREE.Vector3(1, 1, 1),
    }
  }), [bones, legEdema.left, legEdema.right])
  const signWorldA = useMemo(() => new THREE.Vector3(), [])
  const signWorldB = useMemo(() => new THREE.Vector3(), [])
  const signLocalA = useMemo(() => new THREE.Vector3(), [])
  const signNormal = useMemo(() => new THREE.Vector3(), [])
  const signRootQuaternion = useMemo(() => new THREE.Quaternion(), [])
  const signHeadLocal = useMemo(() => new THREE.Vector3(), [])
  /* 시각 소견은 머리 본의 원점뿐 아니라 **회전도** 따라야 한다. 위치만 복사하면
     통증으로 고개를 숙이거나 돌릴 때 결막 띠가 뺨 위에 남아 붉은 스티커처럼 보인다.
     바인드 자세의 머리 회전을 빼고 현재 변화량만 앵커에 적용한다. */
  const signHeadBindInverse = useMemo(() => {
    const head = bones.head
    if (!head) return new THREE.Quaternion()
    model.updateWorldMatrix(true, true)
    const modelWorld = model.getWorldQuaternion(new THREE.Quaternion())
    const headWorld = head.getWorldQuaternion(new THREE.Quaternion())
    return modelWorld.invert().multiply(headWorld).invert()
  }, [model, bones.head])
  const signHeadWorldQuat = useMemo(() => new THREE.Quaternion(), [])
  const signRootWorldQuat = useMemo(() => new THREE.Quaternion(), [])
  const signHeadDeltaQuat = useMemo(() => new THREE.Quaternion(), [])
  const lidReveal = useRef(0)
  const swallowStart = useRef<number | null>(null)
  // 스킨 텍스처가 도착할 때까지 재시도하되, 없는 경우(디버그 모드 등) 매 프레임 훑지 않게 간격을 둔다.
  const skinToneRead = useRef({ done: false, nextTry: 0 })
  useEffect(() => {
    // 환자가 교대되면 이전 아바타의 피부색이 남지 않도록 다시 뽑는다.
    skinToneRead.current = { done: false, nextTry: 0 }
  }, [model])

  // 본 자세가 이미 적용된 뒤 실행돼야 해서 메인 useFrame보다 뒤에 등록한다.
  useFrame((state, delta) => {
    /* 복부·옆구리 진찰 앵커 — 포즈가 반영된 뒤의 몸통 본 월드 프레임을 공유한다.
       진찰 단계에서만 갱신한다: 문진 중엔 보호자 아바타도 같이 렌더돼 서로 덮어쓴다. */
    if (examActive) {
      updatePatientTorso(
        bones.pelvis,
        bones.spine2 ?? bones.spine,
        bones.lthigh,
        bones.rthigh,
        pose === 'lie' || pose === 'lie_knees',
      )
      PATIENT_LIMBS.handsValid = !!bones.lhand && !!bones.rhand
      if (PATIENT_LIMBS.handsValid) {
        bones.lhand!.getWorldPosition(PATIENT_LIMBS.leftHand)
        bones.rhand!.getWorldPosition(PATIENT_LIMBS.rightHand)
      }
      PATIENT_LIMBS.legsValid = !!bones.lcalf && !!bones.rcalf && !!bones.lfoot && !!bones.rfoot
      if (PATIENT_LIMBS.legsValid) {
        bones.lcalf!.getWorldPosition(PATIENT_LIMBS.leftKnee)
        bones.rcalf!.getWorldPosition(PATIENT_LIMBS.rightKnee)
        bones.lfoot!.getWorldPosition(PATIENT_LIMBS.leftAnkle)
        bones.rfoot!.getWorldPosition(PATIENT_LIMBS.rightAnkle)
      }
    }
    const anchor = signAnchorRef.current
    const root = group.current
    if (!anchor || !root) return

    // 손가락 관절 부종 — 별도 구를 얹지 않고 각 마디의 장축을 제외한 두 축만 굵힌다.
    // 피부·손톱 텍스처와 음영이 그대로 이어져 PIP/MCP가 국소적으로 붓는 형태가 된다.
    fingerJoints.forEach((joint, index) => {
      const node = fingerJointRefs.current[index]
      const level = joint.side === 'left' ? fingerSwelling.left : fingerSwelling.right
      joint.bone.scale.copy(joint.baseScale)
      const transverse = 1 + level * 0.22
      if (joint.longAxis !== 'x') joint.bone.scale.x *= transverse
      if (joint.longAxis !== 'y') joint.bone.scale.y *= transverse
      if (joint.longAxis !== 'z') joint.bone.scale.z *= transverse
      if (node) node.visible = false
    })

    // 일측 하지부종도 종아리 피부 자체를 횡방향으로 늘린다. 오버레이 캡슐처럼 경계가
    // 생기지 않고 정상측과 실루엣·발목 굵기를 직접 비교할 수 있다.
    calfBones.forEach(({ bone, longAxis, baseScale, level }) => {
      if (!bone) return
      bone.scale.copy(baseScale)
      const transverse = 1 + level * 0.18
      if (longAxis !== 'x') bone.scale.x *= transverse
      if (longAxis !== 'y') bone.scale.y *= transverse
      if (longAxis !== 'z') bone.scale.z *= transverse
    })

    const exposedLegs = examActive
      && (lowerGarment === 'rolled' || lowerGarment === 'removed')
      && socksGarment === 'removed'
    // 과거의 별도 캡슐 메시를 숨긴다. 위 골격 기반 변형이 실제 피부 소견을 담당한다.
    if (leftEdemaRef.current) leftEdemaRef.current.visible = false
    if (rightEdemaRef.current) rightEdemaRef.current.visible = false

    const regionExposed = (region: ClinicalSkinRegion) => {
      if (region === 'face' || region.endsWith('_arm')) return true
      if (region === 'torso') return examActive && upperGarment !== 'worn'
      return exposedLegs
    }
    const placeLesion = (node: THREE.Group | null, region: ClinicalSkinRegion, level: number) => {
      if (!node) return
      node.visible = level > 0.02 && regionExposed(region)
      if (!node.visible) return
      let a: THREE.Bone | undefined
      let b: THREE.Bone | undefined
      let surfaceOffset = 0.045
      let size = 0.052
      signNormal.copy(PATIENT_TORSO.front)
      if (region === 'face') {
        a = bones.head
        surfaceOffset = 0.085
        size = 0.038
      } else if (region === 'torso') {
        // 상의를 걷었을 때 실제로 드러나는 배꼽 위 복부. 상부 흉곽은 환자복 앞섶에 남는다.
        a = bones.spine ?? bones.spine2
        surfaceOffset = PATIENT_TORSO.halfWidth * 1.16
        size = 0.086
      } else if (region === 'left_arm' || region === 'right_arm') {
        const left = region === 'left_arm'
        a = bones[left ? 'lupperarm' : 'rupperarm']
        b = bones[left ? 'lforearm' : 'rforearm']
        signNormal.copy(PATIENT_TORSO.right).multiplyScalar(left ? -1 : 1)
          .addScaledVector(PATIENT_TORSO.front, 0.28).normalize()
        surfaceOffset = 0.035
        size = 0.048
      } else {
        const left = region === 'left_leg'
        a = bones[left ? 'lcalf' : 'rcalf']
        b = bones[left ? 'lfoot' : 'rfoot']
        surfaceOffset = 0.052
        size = 0.062
      }
      if (!a) { node.visible = false; return }
      if (region === 'torso' && PATIENT_TORSO.valid) {
        // spine 본 원점은 아바타마다 골반 가까이에 있기도 해 병변이 바지 위로 내려갔다.
        // 두덩결합↔칼돌기 프레임의 실제 복부 중앙을 직접 사용한다.
        signWorldA.copy(PATIENT_TORSO.pubis).lerp(PATIENT_TORSO.xiphoid, 0.60)
      } else {
        a.getWorldPosition(signWorldA)
      }
      if (b && region !== 'torso') {
        b.getWorldPosition(signWorldB)
        signWorldA.lerp(signWorldB, region.endsWith('_leg') ? 0.42 : 0.48)
      }
      if (region === 'face') {
        signWorldA.addScaledVector(PATIENT_TORSO.up, 0.035)
          .addScaledVector(PATIENT_TORSO.right, -0.035)
      } else if (region === 'torso') {
        signWorldA.addScaledVector(PATIENT_TORSO.up, 0.018)
          .addScaledVector(PATIENT_TORSO.right, -0.045)
      }
      signWorldA.addScaledVector(signNormal, surfaceOffset)
      signLocalA.copy(signWorldA); root.worldToLocal(signLocalA)
      node.position.copy(signLocalA)
      root.getWorldQuaternion(signRootQuaternion)
      signNormal.applyQuaternion(signRootQuaternion.invert()).normalize()
      node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), signNormal)
      node.scale.setScalar(size * (0.72 + level * 0.28))
    }
    placeLesion(rashRef.current, rashRegion, rashLevel)
    placeLesion(bruiseRef.current, bruiseRegion, bruiseLevel)
    const headBone = bones.head
    if (headBone) {
      // 머리 본의 현재 월드 위치를 루트 로컬(=모델 공간)로 되돌린다.
      // ClinicScene의 카메라·팔 앵커가 쓰는 PATIENT_HEAD_WORLD와 같은 본이다.
      headBone.getWorldPosition(signHeadLocal)
      root.worldToLocal(signHeadLocal)
      anchor.position.copy(signHeadLocal)
      headBone.getWorldQuaternion(signHeadWorldQuat)
      root.getWorldQuaternion(signRootWorldQuat)
      signHeadDeltaQuat
        .copy(signRootWorldQuat)
        .invert()
        .multiply(signHeadWorldQuat)
        .multiply(signHeadBindInverse)
      anchor.quaternion.copy(signHeadDeltaQuat)
    }

    const conjunctiva = conjunctivaRef.current
    if (conjunctiva) {
      // 아래눈꺼풀을 손가락으로 내리는 동작 — 띠가 위에서 아래로 밀려 나오게 한다.
      lidReveal.current = THREE.MathUtils.damp(
        lidReveal.current,
        examGesture === 'eyes_up' ? 1 : 0,
        14,
        delta,
      )
      conjunctiva.visible = lidReveal.current > 0.03
      conjunctiva.position.y = (1 - lidReveal.current) * 0.005
    }

    const goiter = goiterRef.current
    if (goiter) {
      if (examGesture === 'swallow') {
        if (swallowStart.current === null) swallowStart.current = state.clock.elapsedTime
      } else {
        swallowStart.current = null
      }
      // 삼킬 때 갑상샘은 후두와 함께 올라갔다 내려온다. 이 거상이 곧 갑상샘 진찰의 핵심이라
      // 6초짜리 제스처 동안 두 번 삼키게 한다(포물선 봉우리 폭 0.55초 ≈ 실제 연하 1회).
      const since = swallowStart.current === null ? -1 : state.clock.elapsedTime - swallowStart.current
      const bump = (center: number) => {
        const k = (since - center) / 0.55
        return since < 0 ? 0 : Math.max(0, 1 - k * k)
      }
      goiter.position.y = Math.min(1, bump(0.9) + bump(3.2)) * (signAnchors.goiter?.swallowLift ?? 0)
    }

    // 갑상샘 융기와 부종 오버레이는 같은 환자의 실제 스킨 텍스처 평균색을 공유한다.
    const tone = skinToneRead.current
    if (!tone.done && state.clock.elapsedTime >= tone.nextTry) {
      const sampled = averageSkinTone(model)
      if (sampled) {
        goiterMaterial.color.copy(sampled)
        swellingMaterial.color.copy(sampled).lerp(new THREE.Color('#fff2e8'), 0.34)
        // 텍스처 전체 평균은 음영·모공·UV 여백까지 포함한다. 실제 노출 피부보다 어두운
        // 무텍스처 메시를 밝게 섞어 피부에서 떨어진 갈색 덩어리로 보이지 않게 한다.
        tone.done = true
      } else {
        tone.nextTry = state.clock.elapsedTime + 0.5
      }
    }

  })

  return (
    <group ref={group} scale={fit.scale} position={[0, fit.yOff, 0]}>
      <primitive object={model} />
      {/* ── 시각 소견 메시 — 머리 본 위치에 매 프레임 붙는 앵커 아래에 둔다 ── */}
      <group ref={signAnchorRef}>
        {signAnchors.conjunctiva && (
          <group ref={conjunctivaRef} visible={false}>
            <mesh
              name="ClinicalConjunctivaRight"
              geometry={conjunctivaGeometry}
              material={conjunctivaMaterial}
              onUpdate={(mesh) => mesh.layers.enable(3)}
              position={[
                signAnchors.conjunctiva.midX + signAnchors.conjunctiva.halfGap,
                signAnchors.conjunctiva.y,
                signAnchors.conjunctiva.z,
              ]}
              scale={signAnchors.conjunctiva.scale}
            />
            <mesh
              name="ClinicalConjunctivaLeft"
              geometry={conjunctivaGeometry}
              material={conjunctivaMaterial}
              onUpdate={(mesh) => mesh.layers.enable(3)}
              position={[
                signAnchors.conjunctiva.midX - signAnchors.conjunctiva.halfGap,
                signAnchors.conjunctiva.y,
                signAnchors.conjunctiva.z,
              ]}
              scale={signAnchors.conjunctiva.scale}
            />
          </group>
        )}
        {signAnchors.oral && (
          /* 치아·잇몸·혀는 Google GNM의 실제 스캔 기반 메시를 쓴다.
             배경 점막면은 자산 전체보다 더 뒤로 보내 구강 깊이 중간에서 치아를
             잘라내지 않게 한다. */
          <group visible={examActive && examGesture === 'mouth_open'}>
            <mesh
              geometry={lesionGeometry}
              material={oralCavityMaterial}
              position={[signAnchors.oral.x, signAnchors.oral.y, signAnchors.oral.z - 0.027]}
              scale={[signAnchors.oral.radius.x, signAnchors.oral.radius.y, 1]}
            />
            <mesh
              geometry={lesionGeometry}
              material={softPalateMaterial}
              position={[
                signAnchors.oral.x,
                signAnchors.oral.y + signAnchors.oral.radius.y * 0.40,
                signAnchors.oral.z - 0.025,
              ]}
              scale={[signAnchors.oral.radius.x * 0.74, signAnchors.oral.radius.y * 0.22, 1]}
            />
            {/* 구개수 — 연구개 정중앙에서 아래로 늘어진 작은 물방울 형태. */}
            <mesh
              geometry={lesionGeometry}
              material={softPalateMaterial}
              position={[
                signAnchors.oral.x,
                signAnchors.oral.y + signAnchors.oral.radius.y * 0.20,
                signAnchors.oral.z - 0.024,
              ]}
              scale={[0.0030, 0.0062, 1]}
            />
            {/* 좌우 편도/구개궁 — 돌출 구체가 치아처럼 매달려 보이지 않게 얇은 점막면으로 둔다. */}
            {[-1, 1].map((side) => (
              <mesh key={side} geometry={lesionGeometry} material={tonsilMaterial}
                position={[
                  signAnchors.oral!.x + side * signAnchors.oral!.radius.x * 0.58,
                  signAnchors.oral!.y + signAnchors.oral!.radius.y * 0.06,
                  signAnchors.oral!.z - 0.023,
                ]}
                scale={[0.0038, 0.0082, 1]}
              />
            ))}
            <group
              position={[
                signAnchors.oral.x,
                signAnchors.oral.y - 0.002,
                signAnchors.oral.z + 0.005,
              ]}
              scale={[oralAssetScale, oralAssetScale, oralAssetScale * 0.45]}
            >
              <primitive object={oralAsset} />
            </group>
          </group>
        )}
        {goiterSign && signAnchors.goiter && (
          /* 갑상샘 종대는 목 소견이라 제스처 없이도 보여야 시진이 성립한다.
             다만 문진 화면까지 건드리지 않도록 진찰 단계에서만 렌더한다. */
          <group ref={goiterRef} visible={examActive}>
            <mesh
              geometry={bulgeGeometry}
              material={goiterMaterial}
              position={[signAnchors.goiter.x, signAnchors.goiter.y, signAnchors.goiter.z]}
              scale={signAnchors.goiter.radius}
              receiveShadow
            />
          </group>
        )}
      </group>
      {/* 관절·부종은 머리가 아니라 각 손가락/종아리 본의 현재 좌표를 매 프레임 따라간다. */}
      {fingerJoints.map((joint, index) => (
        <group
          key={`${joint.bone.uuid}-${index}`}
          ref={(node) => { fingerJointRefs.current[index] = node }}
          visible={false}
        >
          <mesh geometry={jointGeometry} material={swellingMaterial} castShadow receiveShadow />
        </group>
      ))}
      <group ref={leftEdemaRef} visible={false}>
        <mesh geometry={edemaGeometry} material={swellingMaterial} castShadow receiveShadow />
      </group>
      <group ref={rightEdemaRef} visible={false}>
        <mesh geometry={edemaGeometry} material={swellingMaterial} castShadow receiveShadow />
      </group>
      {/* 발진: 크기·간격이 다른 홍반 여러 개를 묶어 한 장의 스티커처럼 보이지 않게 한다. */}
      <group ref={rashRef} name="clinical-rash" visible={false} renderOrder={8}>
        {[
          [-0.42, 0.18, 0.26], [-0.12, 0.32, 0.18], [0.19, 0.22, 0.22],
          [0.38, -0.06, 0.16], [0.08, -0.22, 0.25], [-0.31, -0.26, 0.19],
          [-0.02, 0.02, 0.15],
        ].map(([x, y, scale], index) => (
          <mesh key={index} geometry={lesionGeometry} material={rashMaterial}
            position={[x, y, index * 0.002]} rotation={[0, 0, index * 0.71]}
            scale={[scale, scale * (0.62 + (index % 3) * 0.08), 1]} />
        ))}
      </group>
      {/* 멍: 서로 다른 색 농도로 겹친 반상 세 장이 불규칙한 가장자리와 중심부 농담을 만든다. */}
      <group ref={bruiseRef} name="clinical-bruise" visible={false} renderOrder={8}>
        <mesh geometry={lesionGeometry} material={bruiseMaterial} scale={[0.58, 0.42, 1]} />
        <mesh geometry={lesionGeometry} material={bruiseMaterial} position={[0.20, 0.08, 0.002]} scale={[0.34, 0.29, 1]} />
        <mesh geometry={lesionGeometry} material={bruiseMaterial} position={[-0.18, -0.10, 0.003]} scale={[0.28, 0.22, 1]} />
      </group>
      <group
        position={[
          0,
          garmentCutMetrics.lowerGarmentTop
            + replacementSkirtSize.topOffset
            - replacementSkirtSize.height * 0.5,
          0,
        ]}
        scale={[1, 1, replacementSkirtSize.depthScale]}
        /* 프라이버시 시트를 덮으면 대체 치마는 숨긴다. 이건 스키닝이 없는 **고정 원뿔**이라
           누운 자세에서 자세를 안 따라가고 침대를 가로질러 뻗는다 — 시트를 뚫고 나와
           다리 위에 검은 덩어리로 찍혔다(f60_ob 실측). 시트가 두덩결합~발목을 덮으므로
           가릴 것은 시트가 대신한다. */
        visible={
          replaceBrokenLower
          && (!examActive || lowerGarment !== 'removed')
          && !(examActive && privacyDrape)
        }
      >
        <mesh
          geometry={replacementSkirtGeometry}
          material={replacementSkirtMaterial}
          castShadow
          receiveShadow
        />
      </group>
      <mesh
        /* 이름을 붙여 두는 이유: ClinicScene이 진찰 부위를 체표에 안착시킬 때 쏘는 레이캐스트가
           이 드레이프에 맞으면 부위가 천 위로 떠 버린다. 이름으로 걸러내려면 name이 필요하다.
           (userData.clinicalCloth도 같은 목적의 표식이다 — 모디스티 밴드와 규약을 맞춘다) */
        name="patient_privacy_drape"
        userData={{ clinicalCloth: true }}
        geometry={lowerDrape.geometry}
        material={lowerDrapeMaterial}
        position={lowerDrape.offset}
        /* 학생이 "가려드리겠습니다"라고 말하면 PPI 점수만 오르고 화면은 그대로였다.
           이제 자세에 맞는 시트(누우면 두덩결합~발목, 앉으면 무릎 랩)가 실제로 덮인다. */
        visible={examActive && privacyDrape}
        castShadow
        receiveShadow
      />
    </group>
  )
}
