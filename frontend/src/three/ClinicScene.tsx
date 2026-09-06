/**
 * 진료실 — 우리가 직접 만든 3D 진료실 지오메트리 (의사 1인칭 시점).
 * 병원 HDRI는 배경이 아니라 IBL(이미지 기반 조명)로만 사용한다. 창문 너머로만 살짝 보인다.
 * 입장 컷씬: 노크 → 뒷벽 문이 열림 → 환자가 문에서 의자까지 걸어와 책상 맞은편에 앉는다.
 */
/* ⚠ **이 import 는 반드시 첫 줄이어야 한다.** 아래에 모듈 최상위
   `useGLTF.preload(...)` 가 여러 개 있는데, Draco 디코더 경로가 그보다 먼저
   박혀 있지 않으면 gstatic 으로 나간다 — 인터넷 없는 시연장에서 환자가 한 명도
   안 뜬다. ES 모듈은 import 를 선언 순서대로 평가하므로 첫 줄이면 보장된다.
   (엔트리(main.tsx)에 두면 three 전체가 첫 청크로 끌려온다. 그래서 여기다.) */
import '../dracoLocal'
import { Suspense, useEffect, useMemo, useRef, useState, useCallback, Component, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Html, useGLTF, useAnimations, PerformanceMonitor } from '@react-three/drei'
import { EffectComposer, Vignette, SMAA, Noise, N8AO, Bloom, ToneMapping } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { motion, AnimatePresence } from 'framer-motion'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import {
  buildShell, buildExamTable, buildPatientChair, buildTroffers,
  buildCounter, buildCurtains,
} from './clinicRoom'
import { playAuscultation } from '../audio/examSounds'
import { RenderPeoplePatient } from './RenderPeoplePatient'
import { RealisticPatient, PATIENT_HEAD_WORLD, PATIENT_TORSO, PATIENT_LIMBS } from './RealisticPatient'
import { usesBoneRig, pickAvatarVariant, type AvatarVariant, type MpfbVariant } from './avatarVariant'
import { sfxDoor, sfxKnock, sfxStep } from '../audio/sfx'
import type { AvatarAppearance, Emotion } from '../types'
import {
  useGame,
  TOOL_REGIONS,
  HOLD_SECONDS,
  examProgressKey,
  ABDOMEN_REGIONS,
  HEADNECK_REGIONS,
  CHEST_REGIONS,
  type ExamRegion,
  type ExamToolId,
} from '../store'
import {
  PRESS_DEPTH, PRESS_HALF, PRESS_SOFT, PRESS_SHADE_SOFT, PRESS_SHADE,
  applySkinPress, clearSkinPress, type PressId, type PressUniforms,
} from './skinPress'

type EnterStage = 'knock' | 'open' | 'walk' | 'sit' | 'done'
/** 진찰 자세 — store.examPose와 같은 값 집합 (마주 앉기 / 눕기 / 무릎 세워 눕기 / 진찰대 걸터앉기).
 *  **'sit'(마주앉기)만 환자가 의자에 남고 나머지는 침대로 간다 — 조명 리그가 이걸 따른다.** */
type ExamPose = 'sit' | 'lie' | 'lie_knees' | 'sit_edge'

/* ── 방 치수 (의사 책상 z=0.5 전경, 환자 의자 z=-0.55, 뒷벽 z=-5.2) ── */
const ROOM = {
  w: 6.4, // 좌우 폭 (x: -3.2 ~ 3.2)
  d: 6.6, // 깊이 (z: -5.4 앞쪽벽 뒤 ~ 1.2)
  h: 3.0, // 천장 높이
  backZ: -5.2, // 환자 뒤 벽 (문이 있는 벽)
  frontZ: 1.2, // 의사 등 뒤 벽
}
const DOOR_X = -1.4 // 뒷벽에서 문 중심 x (의자 정중앙을 피해 살짝 왼쪽)

/* ════════════════════════════════════════════════════════════════════════
   신체진찰(3D) 튜닝 상수 — 사용자가 스크린샷 보고 조정할 값들을 한곳에 모음.
   ExamBed는 Room에서 position={[1.95,0,-3.5]} rotation={[0,-Math.PI/2,0]} 로 놓임.
   침대는 월드 X축을 따라 길게 눕고(매트 윗면 y=0.68, 페이퍼롤 윗면 y=0.691),
   x는 1.0~2.9, z는 -3.86~-3.14를 차지한다. 머리쪽은 -X 끝이다.

   ── 환자 기준 좌우(중요, 직접 검증함) ──
   모델 기본 리그는 "발 y=0, 머리 +y, 정면 +z"다. 좌우는 RealisticPatient의 sit 포즈에서 확정:
     aim('lthigh', +0.1, …) / aim('rthigh', -0.1, …) → 왼다리가 +x, 오른다리가 -x로 벌어진다.
     즉 모델 로컬에서 환자의 오른쪽 = -x.
   눕히기 변환은 안쪽 group rotation.x=-90°(x축 성분 불변) → 바깥 group rotation.y=+90°이고,
   R_y(+90°)는 (-1,0,0)을 (0,0,+1)로 보낸다.
     ⇒ 앙와위 환자의 **오른쪽은 월드 +z, 왼쪽은 -z**. (머리가 -x인 것은 기존 주석대로 맞다)
   교차검증: 의사 카메라가 z=-2.72(=환자의 +z쪽)에 서는데, 이는 복부진찰의 정석인
   "의사는 환자의 오른쪽에 선다"와 정확히 일치한다.
   ⇒ 스펙 §6.1의 "환자의 오른쪽은 -z" 서술은 실제 모델 방향과 반대이며,
      기존 z 배치(ruq가 z=-3.4 = +z쪽)가 이미 환자 기준으로 옳다. 좌표는 그대로 두고
      region id만 명시적으로 붙인다.
   ════════════════════════════════════════════════════════════════════════ */
/* 누운 환자의 **발 기준점** x. 진찰대 매트는 x 1.0~2.9(ExamBed [1.95,0,-3.5] ± 0.95).
   ⚠ 2.65는 머리쪽 가용 길이를 1.65 m밖에 안 남겨 키 큰 아바타(mh_m70, 머리 본 x=1.130)의
   머리가 매트 밖으로 나갔다. 동시에 발쪽 25cm가 비어 있었다. 2.82로 옮기면 양쪽이 균형을 찾고,
   덤으로 배꼽이 EXAM.camLook.x(1.9)에 올라와 복부 진찰 프레이밍이 정중앙이 된다.
   아래 폴백 좌표들은 전부 이 값에서 유도하므로, 이 상수만 옮기면 같이 따라간다. */
const EXAM_FOOT_X = 2.82

const EXAM = {
  // 침대를 우측으로 옮김 → 모든 x를 우측(양수)으로 미러링.
  // 누운 환자 컨테이너: parent group의 월드 위치(= 발 기준점).
  patientPos: [EXAM_FOOT_X, 0.78, -3.5] as [number, number, number], // 발 기준점(발이 +x). 머리는 -x(왼쪽)
  patientYawY: Math.PI / 2, // 머리가 -x(왼쪽)을 향하도록
  // 카메라(의사 시점): 의사가 침대 옆에서 '대각선'으로 내려다본다. 환자에 조금 더 가깝게(줌인).
  camPos: [1.9, 1.82, -2.72] as [number, number, number],
  camLook: [1.9, 0.95, -3.5] as [number, number, number],
  /* 진찰 모드 얼굴 키라이트 — 침대 위 환자를 비스듬히 내려다보며 비춘다.
     (인라인 리터럴이던 것을 상수화: target 을 씬에 넣는 FaceKeyLight 가 두 값을 함께 쓴다) */
  faceKeyPos: [2.2, 2.8, -2.6] as [number, number, number],
  /* ⚠ **더 이상 조준점으로 쓰지 않는다** — FaceKeyLight 가 머리 본(HEAD_WORLD)을 따라간다.
     이 값은 누운 환자 머리(x≈1.2 대)에서 50cm 빗나가 있었다. 아바타마다 키·다리 길이가 달라
     고정값은 어차피 틀린다. 남겨 둔 것은 본을 못 찾은 리그의 폴백용이다. */
  faceKeyTarget: [1.75, 1.0, -3.5] as [number, number, number],
  camLerp: 3.0, // 클로즈업 진입/이탈 보간 속도 (클수록 빠름)
  /* 복부 4분면 클릭 메시 — 머리가 -x이므로 상복부(명치)는 -x쪽, 하복부는 +x쪽.
     z는 위 "환자 기준 좌우"대로 +z가 환자의 오른쪽, -z가 환자의 왼쪽이다.

     ⚠ 이 좌표는 **폴백 전용**이다. 실제 위치는 PATIENT_TORSO(몸통 본 프레임)에서 유도한다
     (buildExamAnchors 참고). 아바타마다 다리·몸통 길이가 달라 고정 좌표로는 맞출 수 없어서다.
     GLB를 받아 본이 자세를 잡기 전 몇 프레임 동안만 이 값이 보인다(캡처 85건 중 85건이 본 경로였다).

     ⚠ **절대 좌표로 적지 마라.** 발 기준점이 움직이면 폴백만 제자리에 남아 조용히 어긋난다
     (실제로 2.65→2.82 이동 때 그럴 뻔했다). 전부 EXAM_FOOT_X에서 유도한다.
     오프셋 근거(본 기준 실측 3종 평균): 배꼽 = 발에서 머리쪽 0.97 m,
     상 +0.064 / 하 -0.046(=torsoLen 0.22 × 0.29 / 0.21 — 배꼽이 중앙이 아니라 비대칭이다),
     좌/우 ±0.07(=halfWidth × 0.62). */
  quadrants: [
    { region: 'ruq', label: '우상복부', pos: [EXAM_FOOT_X - 1.055, 0.92, -3.43] as [number, number, number] },
    { region: 'luq', label: '좌상복부', pos: [EXAM_FOOT_X - 1.055, 0.92, -3.57] as [number, number, number] },
    { region: 'rlq', label: '우하복부', pos: [EXAM_FOOT_X - 0.885, 0.92, -3.43] as [number, number, number] },
    { region: 'llq', label: '좌하복부', pos: [EXAM_FOOT_X - 0.885, 0.92, -3.57] as [number, number, number] },
  ],
  /* 폴백 4분면 반지름. 0.07(지름 14cm)은 위 상/하 간격 17cm에 거의 닿아 본 경로에서 고쳤던
     '사분면이 한 덩어리로 뭉치는' 문제를 폴백에 그대로 남겨 두고 있었다. 본 경로의 실측
     반경(0.044~0.059)과 같은 눈금으로 맞춘다. */
  quadrantR: 0.055,
  // 양측 옆구리/등(CVA 압통) 클릭 메시 — 복부보다 약간 발쪽, 더 바깥(z).
  // 누운 자세용 폴백이다. 실제 CVA는 sitEdge(앉은 자세)에서 등 쪽을 두드린다.
  flanks: [
    { region: 'flank_r', label: '우측 옆구리', pos: [EXAM_FOOT_X - 0.87, 0.88, -3.3] as [number, number, number] },
    { region: 'flank_l', label: '좌측 옆구리', pos: [EXAM_FOOT_X - 0.87, 0.88, -3.72] as [number, number, number] },
  ],
  flankR: 0.1,
  /* ── 걸터앉은 자세(CVA 압통 §6.3) ──
     평가표는 "갈비척추각압통 ① 앉은 자세"를 요구한다. 환자를 침대 **먼 쪽(-z) 가장자리**에
     엉덩이만 걸치고 앉히고(다리는 -z로 내려뜨림), 몸을 -z로 돌려(yaw=π) 등이 의사(+z)를 향하게 한다.
     이렇게 하면 의사는 원래 서 있던 +z쪽에 그대로 서서 침대 너머로 등을 본다
     (반대로 배치하면 진찰 조명 spotLight[2.2,2.8,-2.6]이 환자 뒤에서 와 등이 역광으로 죽는다).

     y 오프셋 계산근거: 의자 진찰(SEAT)에서 스툴 좌면 y=0.54에 sitY=-0.41을 썼으므로
     모델 로컬 좌면 높이 h = 0.54 + 0.41 = 0.95. 침대 페이퍼롤 윗면이 0.691이므로
     0.691 - 0.95 = -0.259. 화면에서 뜨거나 파묻히면 이 값만 ±조정하면 된다.

     yaw=π이면 환자의 오른쪽은 +x, 왼쪽은 -x다((-1,0,0) → R_y(π) → (+1,0,0)).
     CVA 지점: 좌면에서 위로 ~0.44m(L1 높이), 정중선에서 좌우 0.13m, 등 표면 z≈-3.64. */
  sitEdge: {
    patientPos: [1.95, -0.259, -3.78] as [number, number, number],
    patientYawY: Math.PI, // 등이 +z(의사 쪽)를 향하도록
    camPos: [1.95, 1.52, -2.62] as [number, number, number],
    camLook: [1.95, 1.12, -3.66] as [number, number, number],
    /* 흉부 전면(심장 4판막 · 전면 폐야)은 등이 아니라 가슴을 봐야 한다.
       환자를 돌리지 않고 **의사가 환자 앞쪽으로 돌아간다**(chest 스펙 §4). 걸터앉은 환자의
       다리는 -z로 내려뜨려 있으므로 그 너머(z ≈ -4.7)에 서서 무릎 위로 가슴을 본다.
       진찰 스팟(2.2,2.8,-2.6)은 환자 뒤에서 오므로 이때는 앞쪽 필라이트가 함께 켜진다. */
    camPosFront: [1.95, 1.34, -4.66] as [number, number, number],
    camLookFront: [1.95, 0.96, -3.88] as [number, number, number],
    frontLightPos: [2.18, 1.80, -4.42] as [number, number, number],
    flanks: {
      flank_r: [2.08, 1.13, -3.64] as [number, number, number], // 환자의 오른쪽 = +x
      flank_l: [1.82, 1.13, -3.64] as [number, number, number], // 환자의 왼쪽 = -x
    },
  },
  // 침대 옆 벽걸이 손소독 디스펜서 (우측 벽, 클로즈업 프레임 안)
  sanitizerPos: [3.14, 1.2, -3.0] as [number, number, number],
  sanitizerRotY: -Math.PI / 2,
} as const

/* ── 문진·입장 단계 환자 좌석 튜닝 상수 — 1인칭 화면 기준 완전 왼쪽 대각선 ──
   examMode 때는 환자가 침대로 이동하므로 이 값과 완전히 무관하다.
   스크린샷 확인 후 pos/rotY/camLook/faceLightTarget/keyLightPos 를 조정해라.

   좌표 규칙: 카메라는 z+방향(뒤쪽) → 화면 왼쪽=세계 -x, 화면 오른쪽=세계 +x.
   pos.x 음수 → 화면 왼쪽. rotY 양수 ≈ 환자가 +x(화면 오른쪽, 의사 방향)를 향해 회전. */
const SEAT = {
  /* ⚠ **z 를 앞으로 당기지 마라.** 2026-08-03 에 0.18 로 옮겼다가 되돌렸다.
     "책상 모서리에 걸터앉은 것 같다"는 지적을 고치려던 건데, 카메라가 고정인
     상태에서 환자만 다가오면 **내려보는 각도가 가팔라진다.** 그러면:
       · 환자 머리가 cameraPitch 를 따라가게 돼 있어(useFrame 의 headPitch 항)
         고개를 더 숙인다 → 얼굴 대신 정수리가 보인다
       · 얼굴이 스팟라이트를 등지면서 잿빛으로 죽는다
       · 얼굴이 화면에서 커져 그 두 결함이 한꺼번에 눈에 띈다
     실제로 "사람이 원숭이가 됐다"는 지적을 받았다.
     정말 옮겨야 한다면 좌석만 만지지 말고 **의사 카메라 위치**를 같이 뒤로
     빼서 내려보는 각을 유지해야 하고, SEAT_KEY_INTENSITY 도 재캘리브레이션해야
     한다(그 값은 여유 0 인 최솟값이다). */
  pos:             [-0.9, 0, -0.1] as [number, number, number],
  rotY:            -1.1,   // 의사(왼쪽 책상)를 확실히 바라보도록 더 돌림 (카메라 눈높이가 높아 더 큰 회전 필요)
  sitY:            -0.41,  // 아바타 앉기 y 오프셋
  camLook:         [-0.92, 1.06, 0.0] as [number, number, number], // 환자 눈높이
  faceLightTarget: [-0.92, 1.08, 0.0] as [number, number, number], // spotLight target (환자 얼굴 따라감)
  keyLightPos:     [-1.0, 2.4, 0.7] as [number, number, number],   // 환자 얼굴 스팟라이트 위치 (창문쪽)
} as const

/** 의자에 앉은 환자(문진 + 마주앉기)용 얼굴 키라이트 세기.
 *  광원-얼굴 거리 1.59m + decay=2 라 체감보다 훨씬 약하다. 런타임 스윕 실측(얼굴 ROI 평균휘도):
 *  0→59.6, 1.35→61.6, 2.4→67.4, 3.2→69.0. 클리핑은 3.2에서도 0%.
 *  1.35는 껐을 때 대비 +2.0(+3.4%)뿐이라 사실상 키라이트 구실을 못 했다. 2.4에서 +7.8(+13%).
 *
 *  [2026-07-25 재조정] 2.4 로도 **문진 얼굴이 잿빛으로 죽는다**(학생이 가장 오래 보는 화면인데
 *  진찰 115.9 와 격차가 컸다). 두 시점을 함께 스윕하고 얼굴 크롭을 나란히 붙여 눈으로 골랐다
 *  (cmp_talk_face.png / cmp_examsit_face.png — 좌→우 2.4/4/6/9/13):
 *      문진      2.4→61.3  4→65.0  6→68.3  9→72.3  13→78.0
 *      마주앉기  2.4→87.8  4→93.2  6→97.5  9→103.4 13→111.6
 *  판정은 수치가 아니라 캡처다(시점마다 크롭 구성이 달라 절대 비교가 무효다):
 *    · 2.4 는 피부가 잿빛이고 이마·볼 모델링이 없다
 *    · 6 부터 이마 하이라이트와 볼 중간톤이 살아난다  ← **죽어 보이지 않는 최솟값**
 *    · 13 은 이마 하이라이트가 평평해지기 시작하고 마주앉기 프레임 클리핑이 0.01% 로 뜬다
 *  6 에서 프레임 클리핑 0.00%, 방 밝기는 거의 그대로다(문진 프레임 평균 162.8→163.9). */
/* ⚠ 이 값은 SEAT.pos 와 짝이다. 여유가 0 인 **최솟값**이라 환자 위치를 옮기면
   바로 무너진다(2026-08-03 에 좌석을 앞으로 당겼다가 얼굴이 잿빛이 됐다).
   좌석을 만질 거면 위 스윕표로 다시 잡아라. */
/* 6 → 8: 얼굴이 잿빛으로 창백하다는 지적(2026-08-03). 스윕표 기준 9부터
   이마 하이라이트가 평평해지므로 8이 상한 직전이다. */
const SEAT_KEY_INTENSITY = 8

/* ── 환자 입장 경로: 뒷벽 문 → 의자까지 '직선'으로 쭉 ── */
// 문에서 의자 바로 앞까지 일직선으로 걸어온다(곡선 없음).
// 도착 후 짧은 암전 페이드 동안 의자에 앉은 상태로 전환 → 관통 장면을 보여주지 않는다.
const _DOOR_OUT = new THREE.Vector3(DOOR_X, 0, ROOM.backZ + 0.35)        // 문 출구 (-1.4, -4.85)
const _SEAT_FRONT = new THREE.Vector3(SEAT.pos[0], 0, SEAT.pos[2] - 0.45) // 의자 바로 앞 도착점
const PATH = [
  _DOOR_OUT,
  _DOOR_OUT.clone().lerp(_SEAT_FRONT, 0.5),  // 직선 위 중간점 (탄젠트 안정용)
  _SEAT_FRONT,
]
const CURVE = new THREE.CatmullRomCurve3(PATH)

/* ── 보호자 입장 경로: 같은 문 → 보호자 좌석 앞까지 직선 ──
   환자와 동시에 걸어 들어오되 목적지가 다르다(보호자 의자는 x=-0.44, z=-0.95).
   도착점은 의자 바로 앞(-0.40m)에 두고 sit 전환 시 의자에 스냅한다. */
const _GUARDIAN_DEST = new THREE.Vector3(-0.44, 0, -1.35)
const GUARDIAN_CURVE = new THREE.CatmullRomCurve3([
  _DOOR_OUT.clone(),
  _DOOR_OUT.clone().lerp(_GUARDIAN_DEST, 0.5),
  _GUARDIAN_DEST,
])
// 디버그용 워크 지속시간 오버라이드(스크린샷 캡처용). 미설정 시 5.2초.
const WALK_DURATION =
  (typeof window !== 'undefined' && Number((window as unknown as { __WALK_DUR__?: number }).__WALK_DUR__)) || 3.2

/* 병원 HDRI — Poly Haven CC0. background 없이 IBL 조명으로만. 창문으로만 살짝 보인다. */
/* ── 렌더 파이프라인 A/B 플래그 (DEV 전용, URL 쿼리) ──
   측정 담당이 파일을 고치지 않고 전/후를 비교할 수 있어야 한다.
     ?nopost=1  후처리 체인 전체 우회 (AO·Bloom·톤매핑·SMAA 없음)
     ?tm=0      후처리는 유지하되 <ToneMapping> 만 제거 (톤매핑 결손 재현)
     ?exposure=  gl.toneMappingExposure override
   프로덕션 빌드에서는 항상 꺼진 것과 같다(import.meta.env.DEV 가드). */
const RENDER_FLAGS = (() => {
  const off = {
    nopost: false,
    noToneMapping: false,
    noShadow: false,
    tonemap: '',
    exposure: 1.0,
    hideChair: false,
  }
  if (!import.meta.env.DEV || typeof window === 'undefined') return off
  const q = new URLSearchParams(window.location.search)
  return {
    nopost: q.get('nopost') === '1',
    noToneMapping: q.get('tm') === '0',
    // `?noshadow=1` — 그림자 얼룩(섀도 애크니) 여부를 한 번에 가른다.
    noShadow: q.get('noshadow') === '1',
    // `?tonemap=agx|aces|neutral` — 톤매퍼 비교용.
    tonemap: q.get('tonemap') ?? '',
    exposure: Number(q.get('exposure') ?? 1.0) || 1.0,
    // `?hideChair=1` — 겨드랑이 얼룩이 의자 관통인지 가른다.
    hideChair: q.get('hideChair') === '1',
  }
})()

const HDRI_FILE = '/hdri/hospital_room_2_2k.hdr'

/* HDRI 환경광 — 오프라인 등 로드 실패 시 조용히 생략 */
class EnvBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function SafeEnvironment({ intensity = 1.0 }: { intensity?: number }) {
  return (
    <EnvBoundary>
      <Suspense fallback={null}>
        {/* background 없음 → 우리 3D 방이 보인다. IBL만 담당. */}
        <Environment files={HDRI_FILE} environmentIntensity={intensity} />
      </Suspense>
    </EnvBoundary>
  )
}

/* CC0 실물 모델 배치 헬퍼 — 텍스처/로드 실패가 씬 전체를 죽이지 않게 개별 바운더리로 감싼다 */
function Prop(props: {
  asset: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}) {
  return (
    <EnvBoundary>
      <PropInner {...props} />
    </EnvBoundary>
  )
}

function PropInner({
  asset,
  position,
  rotation = [0, 0, 0],
  scale = 1,
}: {
  asset: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}) {
  const { scene } = useGLTF(`/models/${asset}/${asset}.gltf`)
  const obj = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return c
  }, [scene])
  return <primitive object={obj} position={position} rotation={rotation} scale={scale} />
}

const PROPS = ['metal_office_desk', 'desk_lamp_arm_01', 'GreenChair_01', 'drawer_cabinet', 'wall_clock', 'potted_plant_01', 'metal_trash_can', 'wooden_bookshelf_worn']
PROPS.forEach((p) => useGLTF.preload(`/models/${p}/${p}.gltf`))

/* ── 단일 .glb 로더 + 자동 크기맞춤(fit) + 중심정렬 ──
   스캔 모델은 단위/크기가 제각각이라 maxDim 기준으로 targetSize에 맞춘다.
   방향(rotation)·세부 위치는 호출부에서 조정. */
function FittedGLB({
  url,
  targetSize,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  removeNode,
}: {
  url: string
  targetSize: number
  position?: [number, number, number]
  rotation?: [number, number, number]
  removeNode?: string // 해당 이름의 노드(서브트리)를 제거 — 예: 청진기 튜브만 빼고 체스트피스만
}) {
  const { scene } = useGLTF(url)
  const { obj, s, center } = useMemo(() => {
    const c = scene.clone(true)
    if (removeNode) {
      // three GLTFLoader가 노드 이름의 '.'·공백·대괄호를 '_'로 치환하므로 치환 후 부분일치로 잡는다.
      // (그룹 노드뿐 아니라 그 하위 메시 노드 "..._BlackPlastic_0" 등도 직접 제거되도록 includes 사용)
      const norm = (s: string) => s.replace(/[.\s[\]]/g, '_')
      const target = norm(removeNode)
      const toRemove: THREE.Object3D[] = []
      c.traverse((o) => { if (o.name && norm(o.name).includes(target)) toRemove.push(o) })
      toRemove.forEach((n) => n.parent?.remove(n))
    }
    c.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true }
    })
    const box = new THREE.Box3().setFromObject(c)
    const size = new THREE.Vector3(); box.getSize(size)
    const ctr = new THREE.Vector3(); box.getCenter(ctr)
    const maxd = Math.max(size.x, size.y, size.z) || 1
    return { obj: c, s: targetSize / maxd, center: ctr }
  }, [scene, targetSize, removeNode])
  return (
    <group position={position} rotation={rotation}>
      <group scale={s}>
        <primitive object={obj} position={[-center.x, -center.y, -center.z]} />
      </group>
    </group>
  )
}
useGLTF.preload('/models/stethoscope_u2.glb')
// female_hand.glb 는 더 이상 쓰지 않는다 — 텍스처가 없어 백묵색이고 손목이 잘려 있었다.
/* ⚠️ `doctor_arm.glb` 도 더 이상 접촉 리그에 쓰지 않는다. 술기마다 손가락 모양이 달라야
   해서(주먹으로 두드리는 CVA vs 손바닥으로 누르는 촉진) 포즈별 GLB 5종으로 갈렸다:
   `hand_palm` 촉진·타진·간촉진 / `hand_fist` CVA / `hand_grip_disc` 청진 /
   `hand_pinch` 설압자·펜라이트 / `hand_two_finger` 갑상샘. `DoctorHand` 가 로드한다.
   좌표 규약은 손끝 = 로컬 −Y, 손바닥 법선 = 로컬 +Z 다. */

/* 구 재질 팩토리(matFloor/matWall/…)와 CeilingPanel은 `clinicRoom.ts`·`clinicMats.ts`로 이관했다. */

/* 해부도 포스터(`AnatomyPoster`/`drawAnatomy`)와 X-ray 뷰박스·면허증 액자·코르크 게시판은
   **제거했다** (사용자 지시 2026-07-26). 벽 장식을 걷어내는 결정이라 되살리려면
   지시부터 확인해라 — 캔버스로 그리던 코드라 되살리는 비용 자체는 크지 않다. */

function roundRect(ctx: CanvasingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

type CanvasingContext2D = CanvasRenderingContext2D

/* ── X-ray 뷰박스 (백라이트 + 흉부 X선) ── */
/* ── 손소독 1인칭 모션 — 오른손이 펌프를 누르고 왼 손바닥이 노즐 아래서 젤을 받는다 ── */
export function _HygieneHands({ active }: { active: boolean }) {
  const root = useRef<THREE.Group>(null)
  const rightH = useRef<THREE.Group>(null)
  const start = useRef(0)
  useFrame(({ clock }) => {
    const g = root.current
    if (!g) return
    if (!active) { g.visible = false; start.current = 0; return }
    if (!start.current) start.current = clock.elapsedTime
    g.visible = true
    const t = clock.elapsedTime - start.current
    const enter = Math.min(1, t / 0.3)
    const ease = 1 - Math.pow(1 - enter, 3)
    const exit = t > 1.15 ? Math.min(1, (t - 1.15) / 0.4) : 0
    g.position.set(0, 0, (1 - ease + exit * exit) * 0.45)
    // 펌프 누름 (0.3~0.75초): 오른손 하강 + 젤 방울 등장
    const press = t > 0.3 && t < 0.75 ? Math.sin(((t - 0.3) / 0.45) * Math.PI) : 0
    if (rightH.current) rightH.current.position.y = 0.315 - press * 0.028
  })
  return (
    <group ref={root} visible={false}>
      {/* 플레이어 왼손 — 펌프 헤드를 누름 (오른팔 에셋 X미러 = 왼팔) */}
      <group ref={rightH} position={[-0.015, 0.30, 0.02]}>
        <Suspense fallback={null}>
          <DoctorArm position={[0, 0.02, 0.12]} rotation={[0.85, 0.12, 0]} scale={[-1, 1, 1]} />
        </Suspense>
      </group>
      {/* 플레이어 오른손 — 노즐 아래에서 손바닥이 하늘을 보게 젤 받기 */}
      <group position={[0.075, 0.175, 0.01]}>
        <Suspense fallback={null}>
          <DoctorArm position={[0, 0, 0.10]} rotation={[-0.08, -0.25, Math.PI]} scale={1.0} />
        </Suspense>
      </group>
    </group>
  )
}

/* ── 손소독 디스펜서 헤드 (펌프 보틀) — 진찰 단계에서 클릭하면 손위생 기록 ── */
export function _SanitizerHead({ position, rotation = [0, 0, 0], clickable = false }: { position: [number, number, number]; rotation?: [number, number, number]; clickable?: boolean }) {
  const doExamAction = useGame((s) => s.doExamAction)
  const setExamHint = useGame((s) => s.setExamHint)
  const washed = useGame((s) => s.examLog.some((e) => e.action_id === 'hand_hygiene'))
  const [hover, setHover] = useState(false)
  const onClick = clickable
    ? (e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        if (washed) return
        setExamHint('손위생 완료 — 손소독제를 발랐습니다.')
        void doExamAction('hand_hygiene')
      }
    : undefined
  const bottle = washed ? '#cde8d6' : hover && clickable ? '#ffffff' : '#f0f4f6'
  return (
    <group
      position={position}
      rotation={rotation}
      onClick={onClick}
      onPointerOver={clickable ? (e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' } : undefined}
      onPointerOut={clickable ? () => { setHover(false); document.body.style.cursor = 'auto' } : undefined}
    >
      <mesh castShadow>
        <boxGeometry args={[0.12, 0.2, 0.08]} />
        <meshStandardMaterial color={bottle} roughness={0.4} emissive={hover && clickable && !washed ? '#5aa06e' : '#000000'} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, -0.12, 0.02]} castShadow>
        <boxGeometry args={[0.06, 0.04, 0.05]} />
        <meshStandardMaterial color="#7a8a92" roughness={0.5} />
      </mesh>
      {washed && (
        <mesh position={[0, 0.02, 0.05]}>
          <planeGeometry args={[0.07, 0.07]} />
          <meshStandardMaterial color="#4f9468" transparent opacity={0.0} />
        </mesh>
      )}
    </group>
  )
}

/* ── 벽걸이 의료 디스펜서 스테이션 (장갑 박스 3종 + 손소독 + 샤프스 통) ── */
function WallMedStation({ position, rotation = [0, 0, 0], examMode: _examMode = false }: { position: [number, number, number]; rotation?: [number, number, number]; examMode?: boolean }) {
  const gloveColors = ['#3a6ea5', '#4a4f54', '#5aa06e']
  return (
    <group position={position} rotation={rotation}>
      {/* 백 패널 (스테인리스) */}
      <mesh castShadow>
        <boxGeometry args={[0.78, 0.5, 0.03]} />
        <meshStandardMaterial color="#cfd6da" roughness={0.35} metalness={0.55} />
      </mesh>
      {/* 장갑 박스 3종 (벽 거치) */}
      {gloveColors.map((col, i) => (
        <group key={i} position={[-0.26 + i * 0.26, 0.06, 0.06]}>
          <mesh castShadow>
            <boxGeometry args={[0.2, 0.26, 0.09]} />
            <meshStandardMaterial color={col} roughness={0.6} />
          </mesh>
          {/* 뽑는 구멍의 흰 장갑 */}
          <mesh position={[0, 0.05, 0.05]}>
            <boxGeometry args={[0.1, 0.05, 0.02]} />
            <meshStandardMaterial color="#f4f4ef" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* (벽걸이 손소독 제거 — 책상 펌프 보틀로 일원화) */}
      {/* 샤프스 통 (노란 의료폐기물) */}
      <group position={[-0.28, -0.12, 0.07]}>
        <mesh castShadow>
          <boxGeometry args={[0.16, 0.2, 0.12]} />
          <meshStandardMaterial color="#e4b521" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.11, 0]}>
          <boxGeometry args={[0.16, 0.03, 0.12]} />
          <meshStandardMaterial color="#c2962f" roughness={0.6} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 5발 캐스터 베이스 (모니터/IV 폴 공용) ── */
function CasterBase({ r = 0.26, color = '#9aa0a4' }: { r?: number; color?: string }) {
  return (
    <group>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return (
          <group key={i} position={[Math.cos(a) * r, 0.03, Math.sin(a) * r]}>
            <mesh rotation={[0, -a, 0]} castShadow>
              <boxGeometry args={[r, 0.035, 0.04]} />
              <meshStandardMaterial color={color} roughness={0.4} metalness={0.5} />
            </mesh>
            <mesh position={[Math.cos(a) * r * 0.5, -0.015, Math.sin(a) * r * 0.5]} castShadow>
              <cylinderGeometry args={[0.025, 0.025, 0.03, 10]} />
              <meshStandardMaterial color="#2a2e31" roughness={0.6} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/* ── IV 수액 폴 ── */
function IVPole({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <CasterBase r={0.22} />
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 1.9, 12]} />
        <meshStandardMaterial color="#c2c7cc" roughness={0.3} metalness={0.7} />
      </mesh>
      {/* 상단 후크 */}
      <mesh position={[0, 1.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <torusGeometry args={[0.05, 0.008, 8, 16, Math.PI]} />
        <meshStandardMaterial color="#c2c7cc" roughness={0.3} metalness={0.7} />
      </mesh>
      {/* 수액 백 (반투명) */}
      <mesh position={[0.08, 1.62, 0]} castShadow>
        <boxGeometry args={[0.13, 0.24, 0.04]} />
        <meshStandardMaterial color="#dff0ff" transparent opacity={0.55} roughness={0.2} />
      </mesh>
      {/* 점적통 + 튜브 */}
      <mesh position={[0.08, 1.44, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.06, 8]} />
        <meshStandardMaterial color="#eaf4ff" transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

/* ── 청진기 (벽 후크에 걸린) ── */
/* ── 책상 위 청진기 (사실적: 감긴 코드 루프 + Y분기 + 크롬 바이노럴) ── */
function DeskStethoscope({ position, rotation = [0, 0, 0], scale = 1 }: { position: [number, number, number]; rotation?: [number, number, number]; scale?: number }) {
  // 검은 라텍스 코드 — 체스트피스(우)에서 시작해 한 바퀴 감기며 교차한 뒤 Y분기(좌)로
  const cord = useMemo(() => {
    const p: [number, number, number][] = [
      [0.135, 0.011, -0.03],  // 체스트피스 쪽 시작
      [0.082, 0.011, -0.088],
      [0.0, 0.011, -0.104],   // 아래
      [-0.085, 0.011, -0.072],
      [-0.11, 0.011, 0.0],    // 좌
      [-0.078, 0.011, 0.074],
      [0.0, 0.011, 0.10],     // 위
      [0.085, 0.011, 0.072],
      [0.108, 0.011, 0.0],    // 우
      [0.072, 0.026, -0.052], // 교차(시작 위로 감김) — y 높여 겹침
      [-0.012, 0.026, -0.074],
      [-0.088, 0.019, -0.046],
      [-0.135, 0.013, -0.012],
      [-0.158, 0.011, 0.0],   // Y분기 베이스
    ]
    const curve = new THREE.CatmullRomCurve3(p.map((q) => new THREE.Vector3(...q)))
    return new THREE.TubeGeometry(curve, 90, 0.011, 12, false)
  }, [])
  // 크롬 바이노럴 — Y에서 갈라져 U자로 휘어 양 끝 이어팁으로
  const bin = useMemo(() => {
    const p: [number, number, number][] = [
      [-0.246, 0.011, 0.019],  // 이어팁 1 (위)
      [-0.226, 0.011, 0.046],
      [-0.184, 0.011, 0.046],
      [-0.162, 0.011, 0.013],
      [-0.156, 0.011, 0.0],    // U 바닥(Y 위치)
      [-0.162, 0.011, -0.013],
      [-0.184, 0.011, -0.046],
      [-0.226, 0.011, -0.046],
      [-0.246, 0.011, -0.019], // 이어팁 2 (아래)
    ]
    const curve = new THREE.CatmullRomCurve3(p.map((q) => new THREE.Vector3(...q)))
    return new THREE.TubeGeometry(curve, 60, 0.006, 10, false)
  }, [])
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* 코드(검은 튜브) */}
      <mesh geometry={cord} castShadow>
        <meshStandardMaterial color="#10151a" roughness={0.42} metalness={0.05} />
      </mesh>
      {/* 크롬 바이노럴 */}
      <mesh geometry={bin} castShadow>
        <meshStandardMaterial color="#d4d9dc" metalness={0.94} roughness={0.1} />
      </mesh>
      {/* Y분기 블록 (검은 플라스틱) — 코드와 바이노럴이 만나는 지점 */}
      <mesh position={[-0.156, 0.013, 0]} castShadow>
        <sphereGeometry args={[0.016, 16, 12]} />
        <meshStandardMaterial color="#15191c" roughness={0.5} />
      </mesh>
      {/* 이어팁 (검은 올리브) */}
      <mesh position={[-0.252, 0.011, 0.019]} rotation={[Math.PI / 2, 0, -0.5]} castShadow>
        <coneGeometry args={[0.012, 0.024, 14]} />
        <meshStandardMaterial color="#0c1014" roughness={0.5} />
      </mesh>
      <mesh position={[-0.252, 0.011, -0.019]} rotation={[-Math.PI / 2, 0, 0.5]} castShadow>
        <coneGeometry args={[0.012, 0.024, 14]} />
        <meshStandardMaterial color="#0c1014" roughness={0.5} />
      </mesh>
      {/* 체스트피스(헤드) — 묵직한 크롬 드럼 + 림 + 다이어프램, 책상에 납작 */}
      <group position={[0.16, 0.0, -0.018]}>
        {/* 스템 (코드→헤드) */}
        <mesh position={[-0.03, 0.011, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.0085, 0.0085, 0.045, 14]} />
          <meshStandardMaterial color="#c6cbd0" metalness={0.92} roughness={0.14} />
        </mesh>
        {/* 헤드 드럼 */}
        <mesh position={[0, 0.013, 0]} castShadow>
          <cylinderGeometry args={[0.044, 0.047, 0.024, 40]} />
          <meshStandardMaterial color="#d0d5d9" metalness={0.94} roughness={0.1} />
        </mesh>
        {/* 림 링 */}
        <mesh position={[0, 0.026, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.044, 0.004, 12, 40]} />
          <meshStandardMaterial color="#a9afb4" metalness={0.9} roughness={0.22} />
        </mesh>
        {/* 다이어프램 막 */}
        <mesh position={[0, 0.027, 0]}>
          <cylinderGeometry args={[0.041, 0.041, 0.003, 40]} />
          <meshStandardMaterial color="#0c1014" roughness={0.55} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 검진 침대 (페이퍼 롤 포함) ── */
function ExamBed(_props: { position: [number, number, number]; rotation?: [number, number, number] }) {
  /* 진찰대 — `clinicRoom.buildExamTable()`이 월드 좌표(BED.x/BED.z)에 직접 짓는다.
     ⚠ 매트 윗면 y=0.68 유지 필수. `EXAM.patientPos[1]=0.78`과 `sitEdge` y 오프셋이 이 값에서 유도된다
        (아바타 2체형으로 실측 검증함 — 등이 매트에 정확히 닿는다). */
  const bed = useMemo(() => buildExamTable(), [])
  return <primitive object={bed} />
}

/* ── 책장 위/검진 침대 옆 책·바인더 줄 (따뜻한 색) ── */
/* ── 액자 졸업장/면허증 (따뜻한 양피지 + 가는 금/우드 프레임) ── */
function Stool({ position }: { position: [number, number, number] }) {
  /* 환자 의자 — 5스타 베이스 + 가스실린더 + 비닐 쿠션 + 등받이.
     ⚠ 좌면 윗면 y=0.54 유지 필수 (`SEAT.sitY = -0.41` 전제). */
  const chair = useMemo(() => buildPatientChair(position), [position])
  return <primitive object={chair} />
}

/* ── 벽시계 (실물 모델) ── */
function WallClock({ position }: { position: [number, number, number] }) {
  return (
    <Suspense fallback={null}>
      <Prop asset="wall_clock" position={position} scale={1.0} />
    </Suspense>
  )
}

/* ── 이동식 바이탈 모니터 카트 (ECG/SpO₂/호흡 파형 + 수치 화면) — 정교한 의료기기 ── */
function VitalsCart({ position, rotation = [0, 0, 0] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  const texture = useMemo(() => {
    const W = 512, H = 384
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#060f0a'; ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(40,100,65,0.35)'; ctx.lineWidth = 1
    for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    ctx.font = '700 13px "Helvetica Neue",Arial'; ctx.textBaseline = 'top'
    ctx.fillStyle = '#3dff7a'; ctx.textAlign = 'left'; ctx.fillText('ECG II', 10, 6)
    ctx.fillStyle = '#39d9ff'; ctx.fillText('SpO₂', 10, 114)
    ctx.fillStyle = '#f5d45a'; ctx.fillText('RESP', 10, 218)
    // ECG
    ctx.strokeStyle = '#3dff7a'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath()
    const ecgY = 62
    const beat = (bx: number) => {
      ctx.lineTo(bx + 8, ecgY); ctx.lineTo(bx + 13, ecgY - 8); ctx.lineTo(bx + 18, ecgY + 5)
      ctx.lineTo(bx + 22, ecgY - 52); ctx.lineTo(bx + 27, ecgY + 22); ctx.lineTo(bx + 33, ecgY - 5); ctx.lineTo(bx + 40, ecgY)
    }
    ctx.moveTo(0, ecgY); for (let bx = 0; bx < W; bx += 96) { ctx.lineTo(bx, ecgY); beat(bx) }
    ctx.stroke()
    // SpO2
    ctx.strokeStyle = '#39d9ff'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 158)
    for (let xx = 0; xx <= W; xx += 3) ctx.lineTo(xx, 158 - Math.abs(Math.sin(xx * 0.055)) * 32)
    ctx.stroke()
    // RESP
    ctx.strokeStyle = '#f5d45a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(0, 258)
    for (let xx = 0; xx <= W; xx += 3) ctx.lineTo(xx, 258 - Math.sin(xx * 0.018) * 20)
    ctx.stroke()
    // 수치 패널
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; roundRect(ctx, W - 124, 4, 120, H - 8, 6); ctx.fill()
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#3dff7a'; ctx.font = 'bold 48px "Helvetica Neue",Arial'; ctx.fillText('88', W - 8, 60)
    ctx.font = '700 12px Arial'; ctx.fillText('HR bpm', W - 8, 78)
    ctx.fillStyle = '#39d9ff'; ctx.font = 'bold 42px "Helvetica Neue",Arial'; ctx.fillText('98', W - 8, 158)
    ctx.font = '700 12px Arial'; ctx.fillText('SpO₂ %', W - 8, 175)
    ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 28px "Helvetica Neue",Arial'; ctx.fillText('120/80', W - 8, 245)
    ctx.font = '700 12px Arial'; ctx.fillText('NIBP mmHg', W - 8, 261)
    ctx.fillStyle = '#f5d45a'; ctx.font = 'bold 32px "Helvetica Neue",Arial'; ctx.fillText('16', W - 8, 328)
    ctx.font = '700 12px Arial'; ctx.fillText('RESP /min', W - 8, 344)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true
    return t
  }, [])
  const white = '#eef1f3'
  const dark = '#2a2e31'
  return (
    <group position={position} rotation={rotation}>
      {/* ── 대형 캐스터 바퀴 4개 ── */}
      {[[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]].map(([x, z], i) => (
        <group key={i} position={[x, 0.09, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.09, 0.09, 0.06, 18]} />
            <meshStandardMaterial color="#1c1f22" roughness={0.6} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.04, 0.04, 0.07, 12]} />
            <meshStandardMaterial color="#9aa0a4" roughness={0.4} metalness={0.6} />
          </mesh>
        </group>
      ))}
      {/* 바퀴 프레임 */}
      <mesh position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.5, 0.06, 0.62]} />
        <meshStandardMaterial color={dark} roughness={0.5} />
      </mesh>

      {/* ── 본체 캐비닛 (흰색) ── */}
      <mesh position={[0, 0.52, -0.02]} castShadow>
        <boxGeometry args={[0.46, 0.64, 0.46]} />
        <meshStandardMaterial color={white} roughness={0.45} />
      </mesh>
      {/* 하단 짙은 띠 */}
      <mesh position={[0, 0.24, -0.02]} castShadow>
        <boxGeometry args={[0.47, 0.12, 0.47]} />
        <meshStandardMaterial color={dark} roughness={0.5} />
      </mesh>
      {/* 프로브 홀더 4개 (앞면) + 프로브 */}
      {[-0.15, -0.05, 0.05, 0.15].map((x, i) => (
        <group key={i} position={[x, 0.6, 0.235]}>
          <mesh castShadow>
            <boxGeometry args={[0.07, 0.14, 0.04]} />
            <meshStandardMaterial color="#cfd6da" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.02, 0.03]} castShadow>
            <capsuleGeometry args={[0.022, 0.08, 4, 8]} />
            <meshStandardMaterial color="#e9edf0" roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* ── 제어 콘솔 (캐비닛 위, 앞으로 튀어나온 제어 데크) ── */}
      <group position={[0, 0.88, 0.16]} rotation={[0.16, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.44, 0.07, 0.34]} />
          <meshStandardMaterial color="#d7dde1" roughness={0.5} />
        </mesh>
        {/* 콘솔 터치스크린 (시안 발광) — 뒤쪽 절반, 위를 향함 */}
        <mesh position={[0, 0.04, -0.08]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.32, 0.14]} />
          <meshStandardMaterial color="#0a2230" emissive="#37b6d6" emissiveIntensity={0.6} toneMapped={false} />
        </mesh>
        {/* 트랙볼 (앞쪽) */}
        <mesh position={[0, 0.045, 0.08]} castShadow>
          <sphereGeometry args={[0.028, 16, 12]} />
          <meshStandardMaterial color="#3a8fd0" roughness={0.3} />
        </mesh>
        {/* 버튼 줄 (앞쪽) */}
        {[-0.12, -0.06, 0.06, 0.12].map((x, i) => (
          <mesh key={i} position={[x, 0.04, 0.13]} castShadow>
            <boxGeometry args={[0.03, 0.012, 0.02]} />
            <meshStandardMaterial color="#aeb4b8" roughness={0.5} />
          </mesh>
        ))}
      </group>

      {/* ── 모니터 지지 암 ── */}
      <mesh position={[0, 1.15, -0.1]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.5, 12]} />
        <meshStandardMaterial color="#b8bdc2" roughness={0.3} metalness={0.7} />
      </mesh>

      {/* ── 상단 모니터 (초음파/바이탈 화면) ── */}
      <group position={[0, 1.5, -0.02]} rotation={[0.05, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.64, 0.42, 0.05]} />
          <meshStandardMaterial color={dark} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.01, 0.027]}>
          <planeGeometry args={[0.58, 0.34]} />
          <meshStandardMaterial map={texture} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 진료실 방 (바닥/벽/천장/문) ── */
export function RoomShell({ doorOpenT }: { doorOpenT: number }) {
  /* 방 셸(바닥·벽·천장·문·창)은 `clinicRoom.ts`가 통째로 짓는다.
     이전 구현은 두께 0인 planeGeometry 판때기였다 — 문·창에 리빌이 없어 "붙인 그림"으로 보였다.
     새 셸은 벽을 두께 14cm 상자로 만들고 개구부에 리빌을 남긴다.
     ⚠ 방 **내부 치수는 1mm도 바뀌지 않았다**(두께를 전부 바깥으로 줬다) →
        카메라·EXAM 좌표·문/창 위치·손소독 디스펜서 좌표가 그대로 유효하다. */
  const shell = useMemo(() => buildShell(), [])
  const hinge = useMemo(() => shell.getObjectByName('doorHinge'), [shell])
  useEffect(() => {
    if (hinge) hinge.rotation.y = doorOpenT * (Math.PI * 0.62)
  }, [hinge, doorOpenT])
  return <primitive object={shell} />
}

/* ── 의사 책상 (실물 사무책상, 1인칭 전경) ── */
function Desk() {
  const setFocusedPanel = useGame((s) => s.setFocusedPanel)
  const setCameraHold = useGame((s) => s.setCameraHold)
  const doExamAction = useGame((s) => s.doExamAction)
  // 이 케이스에 손위생 진찰 항목이 있으면(=신체진찰 케이스) 책상 손소독제 클릭도 실제로 기록한다.
  const recordsHygiene = useGame((s) => s.examItems.some((it) => it.id === 'hand_hygiene'))
  const alreadyWashed = useGame((s) => s.examLog.some((e) => e.action_id === 'hand_hygiene'))
  const [sanitizerHit, setSanitizerHit] = useState(false)
  // 발화("손소독하겠습니다")로도 모션 재생
  const hygienePulse = useGame((s) => s.hygienePulse)
  useEffect(() => {
    if (!hygienePulse) return
    setSanitizerHit(true)
    const t = setTimeout(() => setSanitizerHit(false), 1600)
    return () => clearTimeout(t)
  }, [hygienePulse])
  const washHands = () => {
    setSanitizerHit(true)
    setTimeout(() => setSanitizerHit(false), 1600)
    // 진료 전 손위생을 실제 exam_log에 기록 → 채점의 '손위생 선행' 반영.
    // (진찰 단계 침대 옆 디스펜서와 동일하게. 미기록 시 채점에서 '손소독 안 함' 페널티가 잘못 발생하던 버그 수정)
    if (recordsHygiene && !alreadyWashed) void doExamAction('hand_hygiene')
  }
  return (
    <group position={[-2.05, 0, 0.5]}>
      <Suspense fallback={null}>
        <Prop asset="metal_office_desk" position={[0, 0, -0.08]} scale={[0.92, 1.06, 0.88]} />
        {/* (데스크 스탠드 제거) */}
      </Suspense>
      {/* 차트 클립보드 (메디컬, 틸색) — 클릭 → 환자 차트 오버레이 */}
      <group
        position={[0.66, 0.84, 0.1]}
        rotation={[-0.1, -0.3, 0]}
        scale={0.72}
        onClick={(e) => { e.stopPropagation(); setFocusedPanel('chart') }}
        onPointerOver={(e) => { e.stopPropagation(); setCameraHold(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setCameraHold(false); document.body.style.cursor = 'auto' }}
      >
        {/* 플라스틱 백보드 (틸) */}
        <mesh castShadow>
          <boxGeometry args={[0.24, 0.014, 0.32]} />
          <meshStandardMaterial color="#3a7d7b" roughness={0.5} />
        </mesh>
        {/* 흰 양식지 + 인쇄 라인 흉내 */}
        <mesh position={[0, 0.012, 0.015]}>
          <boxGeometry args={[0.2, 0.006, 0.26]} />
          <meshStandardMaterial color="#f7f6f1" roughness={0.92} />
        </mesh>
        {[0.07, 0.04, 0.01, -0.02, -0.05].map((z, i) => (
          <mesh key={i} position={[0, 0.016, z]}>
            <boxGeometry args={[0.15, 0.001, 0.006]} />
            <meshStandardMaterial color="#c7d0d2" roughness={0.9} />
          </mesh>
        ))}
        {/* 상단 금속 클립 */}
        <mesh position={[0, 0.018, -0.14]} castShadow>
          <boxGeometry args={[0.1, 0.014, 0.03]} />
          <meshStandardMaterial color="#aeb4b8" roughness={0.35} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0.026, -0.137]} castShadow>
          <boxGeometry args={[0.06, 0.012, 0.012]} />
          <meshStandardMaterial color="#c2c8cc" roughness={0.3} metalness={0.8} />
        </mesh>
      </group>
      {/* 모니터(EMR) — 클릭 → 환자 상태 패널. 의사 쪽(+z)을 바라보도록 각짐 */}
      <group
        position={[-0.35, 0.83, -0.28]} rotation={[0, 0.45, 0]}
        onClick={(e) => { e.stopPropagation(); setFocusedPanel('status') }}
        onPointerOver={(e) => { e.stopPropagation(); setCameraHold(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setCameraHold(false); document.body.style.cursor = 'auto' }}
      >
        {/* 화면 본체 (제대로 된 데스크탑 모니터 크기) */}
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[0.66, 0.42, 0.04]} />
          <meshStandardMaterial color="#23262a" roughness={0.4} />
        </mesh>
        {/* 화면 (발광) */}
        <mesh position={[0, 0.42, 0.022]}>
          <planeGeometry args={[0.60, 0.36]} />
          <meshStandardMaterial color="#eaf2ea" emissive="#dfe9d8" emissiveIntensity={0.6} />
        </mesh>
        {/* 목(스탠드) — 화면 본체 아래까지만 (관통 방지) */}
        <mesh position={[0, 0.115, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.03, 0.18, 10]} />
          <meshStandardMaterial color="#2a2e31" roughness={0.4} metalness={0.3} />
        </mesh>
        {/* 받침대 */}
        <mesh position={[0, 0.02, 0.02]} castShadow>
          <boxGeometry args={[0.30, 0.025, 0.18]} />
          <meshStandardMaterial color="#2a2e31" roughness={0.45} metalness={0.3} />
        </mesh>
      </group>
      {/* (명패 제거 — 책상 위 갈색 정리) */}
      {/* (티슈 박스 제거 — 참고 사진 준비물에 없음) */}
      {/* 손소독제 펌프 — 책상 환자 쪽(앞) 코너. 클릭 → 펌프 위에 안내가 띠링 */}
      <group
        position={[0.16, 0.84, -0.34]}
        onClick={(e) => { e.stopPropagation(); washHands() }}
        onPointerOver={(e) => { e.stopPropagation(); setCameraHold(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setCameraHold(false); document.body.style.cursor = 'auto' }}
      >
        {/* 손소독 리그 (보틀+양팔 애니메이션 일체형) + 클릭 히트박스 */}
        <Suspense fallback={null}>
          <group rotation={[0, -0.7, 0]}>
            <HygieneRig active={sanitizerHit} />
          </group>
        </Suspense>
        <mesh position={[0, 0.13, 0]} visible={false}>
          <cylinderGeometry args={[0.06, 0.06, 0.3, 8]} />
          <meshBasicMaterial />
        </mesh>
        {/* 클릭 시 펌프 위로 떠오르는 인-월드 안내 */}
        {sanitizerHit && (
          <Html position={[0, 0.42, 0]} center distanceFactor={3} zIndexRange={[20, 0]}>
            <div className="sanitizer-pop" style={{
              whiteSpace: 'nowrap', background: 'rgba(20,24,28,0.92)', color: '#fff',
              fontSize: 13, fontWeight: 700, padding: '5px 11px', borderRadius: 9999,
              boxShadow: '0 4px 14px rgba(0,0,0,0.3)', pointerEvents: 'none',
            }}>
              손을 소독했습니다 🧼
            </div>
          </Html>
        )}
      </group>
      {/* 키보드 + 서류 더미 + 전화기 */}
      {/* 키보드 — 모니터 바로 앞, 평행 (베이스 + 키 줄 + 스페이스바) */}
      <group position={[-0.3, 0.83, 0.02]} rotation={[0, 0.45, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.44, 0.016, 0.15]} />
          <meshStandardMaterial color="#e4e7ea" roughness={0.45} metalness={0.05} />
        </mesh>
        {[-0.045, -0.022, 0.001, 0.024].map((z, i) => (
          <mesh key={i} position={[0, 0.014, z - 0.012]} castShadow>
            <boxGeometry args={[0.4, 0.008, 0.017]} />
            <meshStandardMaterial color="#34383c" roughness={0.6} />
          </mesh>
        ))}
        {/* 스페이스바 */}
        <mesh position={[0, 0.014, 0.05]} castShadow>
          <boxGeometry args={[0.2, 0.008, 0.016]} />
          <meshStandardMaterial color="#34383c" roughness={0.6} />
        </mesh>
      </group>
      {/* (서류 더미 제거 — 정리) */}

      {/* 도구 컵 1 (메탈) — 펜라이트·검이경·신경망치 (참고 사진) */}
      <group position={[0.34, 0.84, -0.33]}>
        <mesh position={[0, 0.065, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.04, 0.13, 24]} />
          <meshStandardMaterial color="#c2c7cc" metalness={0.7} roughness={0.22} />
        </mesh>
        {/* 림(테두리) */}
        <mesh position={[0, 0.13, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.044, 0.0045, 8, 24]} />
          <meshStandardMaterial color="#aeb4b8" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* 안쪽 음각 (속이 빈 느낌) */}
        <mesh position={[0, 0.115, 0]}>
          <cylinderGeometry args={[0.039, 0.039, 0.035, 20]} />
          <meshStandardMaterial color="#2a2e31" roughness={0.7} />
        </mesh>
        {/* 펜라이트 (검정 + 끝 발광) */}
        <group position={[-0.018, 0, 0.012]} rotation={[0.08, 0, 0.05]}>
          <mesh position={[0, 0.18, 0]} castShadow>
            <cylinderGeometry args={[0.008, 0.008, 0.24, 10]} />
            <meshStandardMaterial color="#1e2124" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.305, 0]}>
            <cylinderGeometry args={[0.009, 0.009, 0.018, 10]} />
            <meshStandardMaterial color="#fffbe0" emissive="#fff3b0" emissiveIntensity={0.7} />
          </mesh>
        </group>
        {/* 검이경(오토스코프) — 손잡이 + 원뿔 헤드 */}
        <group position={[0.008, 0, -0.016]} rotation={[-0.05, 0, -0.02]}>
          {/* 손잡이(배터리) */}
          <mesh position={[0, 0.115, 0]} castShadow>
            <cylinderGeometry args={[0.013, 0.013, 0.18, 14]} />
            <meshStandardMaterial color="#2a2e31" metalness={0.3} roughness={0.45} />
          </mesh>
          {/* 헤드(크롬) — 앞으로 기울어짐 + 검은 스페큘럼 */}
          <group position={[0, 0.21, 0]} rotation={[0.5, 0, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.016, 0.016, 0.05, 14]} />
              <meshStandardMaterial color="#cfd4d7" metalness={0.7} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.045, 0]} castShadow>
              <coneGeometry args={[0.012, 0.04, 16]} />
              <meshStandardMaterial color="#1a1e22" roughness={0.5} />
            </mesh>
          </group>
        </group>
        {/* 신경망치 — 가는 금속 손잡이 + 삼각 고무 헤드(토마호크) */}
        <group position={[0.022, 0, 0.014]} rotation={[0.05, 0, 0.13]}>
          <mesh position={[0, 0.15, 0]} castShadow>
            <cylinderGeometry args={[0.005, 0.005, 0.26, 10]} />
            <meshStandardMaterial color="#b8bdc2" metalness={0.65} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.29, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.5]} castShadow>
            <cylinderGeometry args={[0.026, 0.026, 0.055, 3]} />
            <meshStandardMaterial color="#9b2f29" roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* 도구 컵 2 (별도 통) — 면봉 + 압설자(혀누르개) */}
      <group position={[0.52, 0.84, -0.33]}>
        <mesh position={[0, 0.055, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.045, 0.11, 24]} />
          <meshStandardMaterial color="#d6dadd" metalness={0.5} roughness={0.32} />
        </mesh>
        {/* 림(테두리) */}
        <mesh position={[0, 0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.049, 0.0045, 8, 24]} />
          <meshStandardMaterial color="#c2c7cc" metalness={0.6} roughness={0.35} />
        </mesh>
        {/* 안쪽 음각 */}
        <mesh position={[0, 0.097, 0]}>
          <cylinderGeometry args={[0.044, 0.044, 0.03, 20]} />
          <meshStandardMaterial color="#2a2e31" roughness={0.7} />
        </mesh>
        {/* 압설자 (납작한 나무 막대, 끝이 둥글게) */}
        {[-0.02, 0.0, 0.022].map((x, i) => (
          <group key={`td${i}`} position={[x, 0, -0.012]} rotation={[0.05, 0, x * 1.5]}>
            <mesh position={[0, 0.16, 0]} castShadow>
              <boxGeometry args={[0.016, 0.17, 0.004]} />
              <meshStandardMaterial color="#d8b98c" roughness={0.8} />
            </mesh>
            {/* 둥근 끝 */}
            <mesh position={[0, 0.245, 0]} scale={[1, 0.55, 0.28]} castShadow>
              <cylinderGeometry args={[0.008, 0.008, 0.016, 12]} />
              <meshStandardMaterial color="#d8b98c" roughness={0.8} />
            </mesh>
          </group>
        ))}
        {/* 면봉 (가는 막대 + 작은 솜끝) */}
        {[-0.02, 0.0, 0.02].map((x, i) => (
          <group key={`sw${i}`} position={[x, 0, 0.02]} rotation={[-0.04, 0, x * 1.6]}>
            <mesh position={[0, 0.14, 0]} castShadow>
              <cylinderGeometry args={[0.0022, 0.0022, 0.18, 6]} />
              <meshStandardMaterial color="#eceae3" roughness={0.7} />
            </mesh>
            {/* 솜끝 (작은 원기둥) */}
            <mesh position={[0, 0.235, 0]} scale={[1, 1.5, 1]}>
              <cylinderGeometry args={[0.004, 0.004, 0.014, 8]} />
              <meshStandardMaterial color="#fbfbf6" roughness={0.95} />
            </mesh>
          </group>
        ))}
      </group>

      {/* 청진기 — 책상 위에 똬리(코일+다이어프램+헤드셋), 의사에서 멀리 */}
      <DeskStethoscope position={[0.13, 0.835, -0.18]} rotation={[0, 0.4, 0]} scale={0.72} />
      {/* (전화기 제거) */}
      {/* 책상 스탠드 불빛 */}
      <pointLight position={[-0.85, 1.15, -0.2]} intensity={1.1} distance={2.2} decay={2} color="#ffc97d" />
    </group>
  )
}

/* ── clinicRoom.ts 산출물을 씬에 얹는 얇은 래퍼들 ── */
function Troffers() {
  const g = useMemo(() => { RectAreaLightUniformsLib.init(); return buildTroffers() }, [])
  return <primitive object={g} />
}
function Curtains() {
  const g = useMemo(() => buildCurtains(), [])
  return <primitive object={g} />
}
function Counter() {
  const g = useMemo(() => buildCounter(), [])
  return <primitive object={g} />
}
/* ── 방 전체 구성: 셸 + 책상 + 의자 + 의료 소품 ── */
export function Room({ doorOpenT, examMode = false }: { doorOpenT: number; examMode?: boolean }) {
  const { backZ } = ROOM
  return (
    <group>
      <RoomShell doorOpenT={doorOpenT} />
      <Desk />
      {/* (ㄱ자 날개 제거 — 단순 직사각형 책상) */}
      {/* 환자 의자 — 롤링 스툴 1개 (화면 왼쪽 대각선)
          `?hideChair=1` — 앉은 자세에서 상의 겨드랑이에 나오는 어두운 얼룩이
          의자 메시 관통 때문인지 가르는 이분법 probe. */}
      {!RENDER_FLAGS.hideChair && <Stool position={SEAT.pos} />}

      {/* ── 외래 진료실 드레싱: 환자 뒤/옆에 배치 (카메라 프레임에 보이도록) ── */}

      {/* 검진 침대 — 좌측 뒤 코너, 프라이버시 커튼으로 가림 (지배적이지 않게) */}
      <ExamBed position={[1.95, 0, -3.5]} rotation={[0, -Math.PI / 2, 0]} />
      {/* 커튼 레일 — 침대를 코너에서 분리 (L자) */}
      {/* ㄱ자로 연결된 프라이버시 커튼 — 코너(x1.4, z-2.3)에서 두 레일이 만남 */}
      {/* 앞쪽 커튼은 카메라와 침대 사이를 가린다 → 진찰(클로즈업) 때는 숨겨 시야 확보 */}
      {/* 프라이버시 커튼 — 평면 카드 2장 → 천장 트랙 + 주름진 천(sheen).
          커튼 A는 반쯤 열어 두므로 examMode에서 숨길 필요가 없다(진찰 카메라를 가리지 않는다). */}
      <Curtains />

      {/* 책장·책 줄은 **의도적으로 넣지 않는다** (사용자 지시 2026-07-26: "이게 나은데").
          기준은 `lab/fresh` 재설계본 — 거기엔 책장이 없는데 게임 쪽에만 따로 얹혀 있었다.
          큰 우드 책장이 진료실을 도서관처럼 보이게 만든다는 판단이다. 좌측 벽(x≈-2.9)은 비워 둔다. */}

      {/* (수납 캐비닛 제거 — 사용자 요청) */}

      {/* (롤링 스툴 제거 — 환자 의자 1개만 둔다) */}

      {/* 화분 — 뒷벽 좌측 코너 (따뜻함) */}
      <Suspense fallback={null}>
        <Prop asset="potted_plant_01" position={[-2.85, 0, backZ + 0.5]} scale={1.2} />
      </Suspense>

      {/* ── 벽 아이템 ──
          **벽 장식(액자류)은 의도적으로 넣지 않는다** (사용자 지시 2026-07-26:
          "뒤에 액자같은 것도 없애고 그냥 이대로 해줘" — 기준은 `lab/fresh` 재설계본).
          뺀 것: 인체 해부도 2장(뒷벽 organs·좌측벽 skeleton), 면허증 액자, 코르크 게시판,
                 X-ray 뷰박스, 벽걸이 청진기.
          남긴 것: 벽시계, 손소독·장갑 스테이션 — 액자가 아니라 **쓰는 물건**이고 재설계본에도 있다.
          판단 기준은 책상·침대 때와 같다: **쓰는 물건인가, 걸어 둔 장식인가.** */}
      <WallMedStation position={[1.6, 1.6, backZ + 0.05]} examMode={examMode} />
      <WallClock position={[2.45, 2.45, backZ + 0.08]} />

      {/* (침대 옆 벽걸이 손소독 제거 — 손위생은 책상 펌프 보틀에서) */}

      {/* 좌측 벽은 비워 둔다 (위 액자 정책과 같은 이유) */}

      {/* ── 의료 기구 — 우측 벽쪽 (바이탈 모니터는 제거: 컴퓨터 EMR이 상태 패널 역할) ── */}
      {/* 수액걸이는 **좌측 벽에 붙인다** (사용자 지시 2026-07-26: "중간에 말고", "왼쪽에 놔둬").
          종전 [2.62, -2.7]은 침대(x=1.95)와 우측 벽(x=3.2) 사이 통로 한가운데라 바닥에 세워 둔
          장애물처럼 보였다. 좌측 벽(x=-3.2)에 붙이되 책상(x=-2.05, z=0.42)과
          화분(x=-2.85, z=-4.7) 사이 빈 구간에 둔다 — 액자를 걷어내 그 벽이 비었다. */}
      <IVPole position={[-3.0, 0, -2.2]} />
      {/* 싱크 달린 진료 카운터 (뒷벽 오른쪽) */}
      <Counter />
      {/* 이동식 바이탈 모니터 카트 — 침대(오른쪽) 앞, 커튼과 안 겹치게 */}
      <VitalsCart position={[2.05, 0, -1.5]} rotation={[0, -0.63, 0]} />
    </group>
  )
}

function Patient({
  stage,
  emotion,
  speaking,
  variant,
  gesture,
  patientAge,
  patientIdentity,
  appearance,
}: {
  stage: EnterStage
  emotion: Emotion
  speaking: boolean
  variant: AvatarVariant
  gesture: 'none' | 'reach'
  patientAge?: number
  patientIdentity?: string
  appearance?: AvatarAppearance
}) {
  /* 통증 기준선 — 케이스가 준 값. 표정이 매 턴 LLM 감정에만 의존하면 계속 밋밋하다.
     보호자에게는 넘기지 않는다 — 아픈 건 환자다. */
  const sessionPainLevel = useGame((st) => st.session?.patient?.pain_level ?? 0)
  const sessionPainColickyPeriod = useGame((st) => st.session?.patient?.pain_colicky_period ?? null)
  const painLevel = appearance?.pain_level ?? sessionPainLevel
  const painColickyPeriod = appearance?.pain_colicky_period ?? sessionPainColickyPeriod
  /* 분당 호흡수 — 케이스 활력징후에서 뽑는다("18회/분" 같은 문자열). 못 읽으면 평상 호흡(14).
     종전에는 코드에 11.6회/분이 박혀 있어 케이스가 뭐라고 적든 화면은 같게 숨 쉬었다. */
  const respRate = useGame((st) => {
    const rr = st.session?.vitals?.rr
    const n = rr ? Number(String(rr).replace(/[^0-9.]/g, '')) : NaN
    return Number.isFinite(n) && n >= 6 && n <= 60 ? n : 14
  })
  const group = useRef<THREE.Group>(null)
  const walkT = useRef(0)
  const [walkSpeed, setWalkSpeed] = useState(0)
  const rocketbox = usesBoneRig(variant)

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    if (stage === 'walk') {
      walkT.current = Math.min(1, walkT.current + delta / WALK_DURATION)
      const t = THREE.MathUtils.smoothstep(walkT.current, 0, 1)
      const pos = CURVE.getPoint(t)
      g.position.set(pos.x, 0, pos.z)
      // 진행 방향을 바라보되, 도착 무렵엔 의사(+z)를 향하도록 보간
      const ahead = CURVE.getPoint(Math.min(1, t + 0.03))
      const lookTarget = new THREE.Vector3().lerpVectors(
        new THREE.Vector3(ahead.x, 0, ahead.z),
        new THREE.Vector3(-1.95, 0, 0.65),  // 도착 무렵 의사(왼쪽 책상) 쪽을 바라봄 → 앉을 때 회전 일치
        THREE.MathUtils.smoothstep(t, 0.7, 1),
      )
      g.lookAt(lookTarget.x, 0, lookTarget.z)
      if (walkSpeed !== 1) setWalkSpeed(1)
    } else {
      // sit/done → 의자로 빠르게 스냅(암전 중 가려짐) 후 정착
      g.position.x = THREE.MathUtils.damp(g.position.x, SEAT.pos[0], 16, delta)
      g.position.y = THREE.MathUtils.damp(g.position.y, SEAT.sitY, 16, delta)
      g.position.z = THREE.MathUtils.damp(g.position.z, SEAT.pos[2], 16, delta)
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, SEAT.rotY, 16, delta)
      if (walkSpeed !== 0) setWalkSpeed(0)
    }
  })

  // 노크/오픈 동안 화면에서는 숨기되 선택된 한 명만 뒤에서 로드한다.
  // 컴포넌트를 통째로 제거하면 걷기 시작과 동시에 GLB 파싱이 시작되어 첫 프레임이 끊긴다.
  const patientVisible = stage !== 'knock' && stage !== 'open'
  const pose: 'walk' | 'sit' = stage === 'walk' ? 'walk' : 'sit'
  const startPos: [number, number, number] =
    stage === 'walk' ? [PATH[0].x, 0, PATH[0].z] : [SEAT.pos[0], SEAT.sitY, SEAT.pos[2]]

  return (
    <group ref={group} position={startPos} visible={patientVisible}>
      <Suspense fallback={null}>
        {rocketbox ? (
          <RealisticPatient
            emotion={emotion}
            speaking={speaking}
            variant={variant}
            pose={pose}
            walkSpeed={walkSpeed}
            gesture={gesture}
            chronologicalAge={patientAge}
            painLevel={painLevel}
            painColickyPeriod={painColickyPeriod}
            respRate={respRate}
            identityKey={patientIdentity}
            appearance={appearance}
          />
        ) : (
          <RenderPeoplePatient
            emotion={emotion}
            speaking={speaking}
            variant={variant}
            pose={pose}
            walkSpeed={walkSpeed}
            gesture={gesture}
          />
        )}
      </Suspense>
    </group>
  )
}

/* ── 보호자 — 아이와 함께 입장하고 옆 의자에 착석 ──
   환자(Patient)와 동일한 stage 를 공유해 입장 타이밍을 맞춘다:
   knock/open → 숨김, walk → GUARDIAN_CURVE 경로로 걸어 들어옴,
   sit/done → 보호자 좌석(-0.44, sitY, -0.95)으로 스냅 후 정착. */
function GuardianWalker({
  stage,
  guardianInfo,
  speaking,
  lastSpeaker,
}: {
  stage: EnterStage
  guardianInfo: { name: string; gender: string; age: number }
  speaking: boolean
  lastSpeaker: 'patient' | 'guardian'
}) {
  const group = useRef<THREE.Group>(null)
  const walkT = useRef(0)
  const [walkSpeed, setWalkSpeed] = useState(0)

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    if (stage === 'walk') {
      walkT.current = Math.min(1, walkT.current + delta / WALK_DURATION)
      const t = THREE.MathUtils.smoothstep(walkT.current, 0, 1)
      const pos = GUARDIAN_CURVE.getPoint(t)
      g.position.set(pos.x, 0, pos.z)
      // 도착 무렵 의자 방향을 바라보도록
      const ahead = GUARDIAN_CURVE.getPoint(Math.min(1, t + 0.03))
      const lookTarget = new THREE.Vector3().lerpVectors(
        new THREE.Vector3(ahead.x, 0, ahead.z),
        new THREE.Vector3(-0.44, 0, -0.95),
        THREE.MathUtils.smoothstep(t, 0.7, 1),
      )
      g.lookAt(lookTarget.x, 0, lookTarget.z)
      if (walkSpeed !== 1) setWalkSpeed(1)
    } else {
      // sit/done → 의자 위치로 빠르게 스냅
      g.position.x = THREE.MathUtils.damp(g.position.x, -0.44, 16, delta)
      g.position.y = THREE.MathUtils.damp(g.position.y, SEAT.sitY, 16, delta)
      g.position.z = THREE.MathUtils.damp(g.position.z, -0.95, 16, delta)
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, -0.92, 16, delta)
      if (walkSpeed !== 0) setWalkSpeed(0)
    }
  })

  // 노크/오픈 동안 숨겨서 환자와 동시에 등장하도록
  if (stage === 'knock' || stage === 'open') return null

  const startPos: [number, number, number] =
    stage === 'walk' ? [_DOOR_OUT.x, 0, _DOOR_OUT.z] : [-0.44, SEAT.sitY, -0.95]
  const pose: 'walk' | 'sit' = stage === 'walk' ? 'walk' : 'sit'
  const variant = pickAvatarVariant(guardianInfo.name, guardianInfo.gender, guardianInfo.age) as MpfbVariant

  return (
    <group ref={group} position={startPos}>
      <Suspense fallback={null}>
        <RealisticPatient
          emotion={lastSpeaker === 'guardian' && speaking ? 'neutral' : 'anxious'}
          speaking={speaking && lastSpeaker === 'guardian'}
          variant={variant}
          pose={pose}
          walkSpeed={walkSpeed}
          chronologicalAge={guardianInfo.age}
          identityKey={`guardian-${guardianInfo.name}`}
        />
      </Suspense>
    </group>
  )
}

/* ── 진찰대에 누운 환자 ──
   환자 모델은 서 있는 리그(발 y=0, 머리 +y, 정면 +z)다. 두 겹의 group 회전으로 눕힌다:
     1) 안쪽 group rotation.x=-90° → 서있는 몸을 등이 바닥(-y)을 향하게 눕힘(정면이 +y 천장).
     2) 가운데 group rotation.y(=EXAM.patientYawY) → 몸 길이축을 침대(월드 X)에 정렬.
   pose='lie'|'lie_knees'는 모델 공간 기준으로만 다리를 포즈한다(aim이 월드 회전 반영). */
function ExamPatient({
  emotion,
  speaking,
  variant,
  pose,
  patientAge,
  patientIdentity,
  groupRef,
  appearance,
}: {
  emotion: Emotion
  speaking: boolean
  variant: AvatarVariant
  pose: 'sit' | 'lie' | 'lie_knees' | 'sit_edge'
  patientAge?: number
  patientIdentity?: string
  appearance?: AvatarAppearance
  /* 진찰 부위를 체표에 안착시키는 레이캐스트의 대상 — 환자 서브트리만 쏘려고 루트를 넘겨받는다.
     (씬 전체에 쏘면 침대·페이퍼롤에 먼저 맞는다) */
  groupRef?: RefObject<THREE.Group | null>
}) {
  /* 통증 기준선 — 케이스가 준 값. 표정이 매 턴 LLM 감정에만 의존하면 계속 밋밋하다.
     보호자에게는 넘기지 않는다 — 아픈 건 환자다. */
  const sessionPainLevel = useGame((st) => st.session?.patient?.pain_level ?? 0)
  const sessionPainColickyPeriod = useGame((st) => st.session?.patient?.pain_colicky_period ?? null)
  const painLevel = appearance?.pain_level ?? sessionPainLevel
  const painColickyPeriod = appearance?.pain_colicky_period ?? sessionPainColickyPeriod
  /* 분당 호흡수 — 케이스 활력징후에서 뽑는다("18회/분" 같은 문자열). 못 읽으면 평상 호흡(14).
     종전에는 코드에 11.6회/분이 박혀 있어 케이스가 뭐라고 적든 화면은 같게 숨 쉬었다. */
  const respRate = useGame((st) => {
    const rr = st.session?.vitals?.rr
    const n = rr ? Number(String(rr).replace(/[^0-9.]/g, '')) : NaN
    return Number.isFinite(n) && n >= 6 && n <= 60 ? n : 14
  })
  const rocketbox = usesBoneRig(variant)
  // 진찰대 가장자리에 걸터앉기(CVA 압통) — 포즈 자체는 의자에 앉는 것과 같아서 pose="sit"을 재사용하고
  // 위치/방향만 EXAM.sitEdge로 바꾼다. 등이 의사 쪽을 향하므로 갈비척추각을 바로 두드릴 수 있다.
  if (pose === 'sit_edge') {
    return (
      <group ref={groupRef} position={EXAM.sitEdge.patientPos} rotation={[0, EXAM.sitEdge.patientYawY, 0]}>
        <Suspense fallback={null}>
          {rocketbox ? (
            <RealisticPatient
              emotion={emotion}
              speaking={speaking}
              variant={variant}
              pose="sit"
              chronologicalAge={patientAge}
              painLevel={painLevel}
              painColickyPeriod={painColickyPeriod}
            respRate={respRate}
              identityKey={patientIdentity}
              appearance={appearance}
              examActiveOverride
            />
          ) : (
            <RenderPeoplePatient emotion={emotion} speaking={speaking} variant={variant} pose="sit" />
          )}
        </Suspense>
      </group>
    )
  }
  // 앉은 진찰(두경부 — 결막·갑상샘·구강): 문진 때와 같은 의자 위치에 그대로 앉아서 받는다.
  if (pose === 'sit') {
    return (
      <group ref={groupRef} position={[SEAT.pos[0], SEAT.sitY, SEAT.pos[2]]} rotation={[0, SEAT.rotY, 0]}>
        <Suspense fallback={null}>
          {rocketbox ? (
            <RealisticPatient
              emotion={emotion}
              speaking={speaking}
              variant={variant}
              pose="sit"
              chronologicalAge={patientAge}
              painLevel={painLevel}
              painColickyPeriod={painColickyPeriod}
            respRate={respRate}
              identityKey={patientIdentity}
              appearance={appearance}
              examActiveOverride
            />
          ) : (
            <RenderPeoplePatient emotion={emotion} speaking={speaking} variant={variant} pose="sit" />
          )}
        </Suspense>
      </group>
    )
  }
  return (
    <group ref={groupRef} position={EXAM.patientPos}>
      <group rotation={[0, EXAM.patientYawY, 0]}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <Suspense fallback={null}>
            {rocketbox ? (
              <RealisticPatient
                emotion={emotion}
                speaking={speaking}
                variant={variant}
                pose={pose}
                chronologicalAge={patientAge}
                painLevel={painLevel}
                painColickyPeriod={painColickyPeriod}
                respRate={respRate}
                identityKey={patientIdentity}
                appearance={appearance}
                examActiveOverride
              />
            ) : (
              <RenderPeoplePatient emotion={emotion} speaking={speaking} variant={variant} pose={pose} />
            )}
          </Suspense>
        </group>
      </group>
    </group>
  )
}

/* ── 진찰 영역 — 복부 4분면 + 옆구리(CVA) + 두경부 + 흉부. 도구 활성 시 꾹 눌러(press-hold) 진찰 ──
   ⚠ 도구별 유지 시간(HOLD_SECONDS)은 store.ts가 단일 진실이다. 예전엔 여기에도 같은 표가 있어
   두경부·흉부 도구가 추가됐을 때 한쪽만 늘어나 타입이 깨졌다 — 다시 만들지 말고 import 해서 써라. */
/* 체스트피스 배치 — 부위 그룹의 로컬 원점은 "체표에서 법선으로 ANATOMY.surfaceLift(1.2cm) 띄운 점"이다.
   따라서 드럼 바닥이 실제 피부에 닿으려면 그만큼 **내려야** 한다(예전 +0.006은 1.4cm 떠 있었다).
   드럼 높이 0.02 × 스케일 → 반쪽이 0.01×스케일. lift = -surfaceLift + 반쪽 + 1mm 여유.

   [높이 실측 — 상수는 지웠고 수치만 남긴다] 체스트피스 머리의 **윗면은 로컬 +0.018**이다.
   Chestpiece() 지오메트리에서 직접 유도된다: 드럼(높이 0.02, 중심 y=0) 윗면 +0.010 <
   씰 토러스(y=0.014, 튜브 0.003) +0.017 < 진동막(y=0.0155, 두께 0.0035) +0.01725 <
   **크롬 림 토러스(y=0.012, 튜브 0.006) +0.018** ← 최고점. 스템이 붙는 높이가 여기다.
   예전엔 이 값을 CHESTPIECE_TOP 상수로 두고 doctor_arm 의 bbox 최저점을 여기에 얹었는데,
   포즈 손(hand_grip_disc)은 손끝이 아니라 **드럼 밑면**이 접촉점이라(handContact) 더는 안 쓴다.
   손이 드럼을 "위에서 덮는" 연출로 돌아갈 일이 있으면 이 0.018 을 다시 쓰면 된다. */
const CHESTPIECE_SCALE = 0.5
// SURFACE_LIFT(=ANATOMY.surfaceLift)는 아래에서 선언되므로 TDZ를 피해 숫자를 직접 쓴다(0.012).
const CHESTPIECE_LIFT = -0.012 + 0.01 * CHESTPIECE_SCALE + 0.001

/* ── 청진기 체스트피스 (몸에 대는 부분) — 다이어프램 헤드: 크롬 드럼 + 밝은 진동막 + 검은 씰 링,
   옆으로 꺾여 올라가는 크롬 스템 + 검은 튜브 목. 위에서 봐도 '청진기 머리'로 읽히게. ── */
/* ── 손소독 리그 (Blender 합성: 보틀+양팔+press 애니메이션) — 클릭 시 팔이 나타나 펌핑 ── */
function HygieneRig({ active }: { active: boolean }) {
  const { scene, animations } = useGLTF('/models/hygiene_rig.glb')
  const inst = useMemo(() => scene.clone(true), [scene])
  const group = useRef<THREE.Group>(null)
  const { actions } = useAnimations(animations, group)
  useEffect(() => {
    const arms: THREE.Object3D[] = []
    inst.traverse((o) => {
      if (o.name === 'R_ARM' || o.name === 'L_ARM') arms.push(o)
    })
    for (const a of arms) a.visible = active
    if (!active) return
    let mixer: THREE.AnimationMixer | null = null
    for (const key of Object.keys(actions)) {
      const act = actions[key]
      if (!act) continue
      mixer = act.getMixer()
      act.reset()
      act.setLoop(THREE.LoopOnce, 1)
      act.clampWhenFinished = true
      act.play()
    }
    // 클립이 끝나면 팔을 즉시 숨김 (퇴장 포즈로 얼어붙는 것 방지)
    const onDone = () => { for (const a of arms) a.visible = false }
    const m = mixer as THREE.AnimationMixer | null
    m?.addEventListener('finished', onDone)
    return () => m?.removeEventListener('finished', onDone)
  }, [active, inst, actions])
  return <group ref={group}><primitive object={inst} /></group>
}
useGLTF.preload('/models/hygiene_rig.glb')

/* ── 의사 팔 에셋 (MakeHuman CC0 절단 + 가운 소매 일체형) ──
   Blender 실측(2026-07-25, doctor_arm.glb 3면 렌더):
     · 원점 = 손목. 손끝 = 로컬 −Y, 손바닥 법선 = 로컬 −Z, 엄지 = 로컬 −X → **오른손**이다.
       (교차검산: 오른손은 palm × finger = thumb. (0,0,−1)×(0,−1,0) = (−1,0,0) ✓)
     · 손(손목~손끝) 로컬 bbox = (−0.0958,−0.1696,−0.0369) ~ (0.0277, 0.02, 0.057)
     · 소매 실린더 = y 0.070~0.370, 지름 ≈ 0.19 m  ← **에셋 원본은 사람 팔의 3배**다.
       그래서 scale 1.0으로 쓰면 폭 19cm짜리 회색 원뿔이 환자 배를 통째로 덮는다.
       손 길이(0.17)를 실제 손(≈15cm)에 맞추면 0.85인데, 그러면 소매가 16cm짜리 통이 된다.
       → 팔은 0.85로 키우고 **소매만 반경을 줄여** 가운 소매로 만든다.

   [2026-07-25 재조정 — 소매만] 0.62(지름 10.0cm)는 호버 중 **왼쪽 하복부(llq) 마커를 덮었다.**
   촉진하려는 부위 옆 사분면이 안 보이면 진찰을 방해한다. 소매 반경만 A/B 로 찍어 골랐다
   (cmp_sleeve_mh_m70.png — 좌→우 0.62 / 0.45 / 0.38 / 0.30, examdebug 로 마커를 켠 호버 상태):
     · 0.62 (10.0cm) llq 가 흰 통에 덮인다 — 통이 팔뚝보다 훨씬 굵어 '깔때기'로 읽힌다
     · 0.45 ( 7.3cm) 대부분 보이지만 llq 위쪽이 아직 걸린다
     · 0.38 ( 6.1cm) **네 마커가 전부 보인다. 소매가 팔뚝을 감싼 채로 유지된다** ← 채택
     · 0.30 ( 4.8cm) 소매가 팔뚝보다 얇아져 손목에서 살이 삐져나온다
   ⚠ 소매 반경 0.38 은 위 A/B 의 결론이다 — 손 GLB 의 소매도 이 지름(6.1cm)에 맞춰 정규화한다
     (HAND_SLEEVE_DIA). 남은 사용처는 손소독 리그와 결막 리그뿐이다. */
const DOCTOR_SLEEVE_SLIM = 0.38
/** 손끝 방향 + 손바닥 법선으로 팔 자세를 만든다.
 *  에셋 실측(정점 좌표): 손끝 = −Y. 손가락은 z가 커지는 쪽으로 굽는다
 *  (평균 z: 손목 0.001 → 손바닥 0.003 → 너클 0.006 → 손끝 0.021) → **손바닥 법선 = +Z**.
 *  엄지가 −X이므로 이 팔은 의사의 **왼팔**이다(오른손이면 palm×finger=thumb 여야 하는데 반대로 나온다).
 *  armQuat(축 하나 + roll)은 손바닥이 어디를 보는지 통제가 안 돼 촉진·청진에는 쓸 수 없다. */
function handQuat(finger: [number, number, number], palm: [number, number, number]): THREE.Quaternion {
  const f = new THREE.Vector3(...finger).normalize()
  const p = new THREE.Vector3(...palm)
  p.addScaledVector(f, -p.dot(f)) // 손끝 축에 직교화 (그람-슈미트)
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(f, -f.z)
  p.normalize()
  // −Y→f, +Z→p 이므로 X의 상 = −(f×p) (에셋 공간에서 (−Y)×(+Z) = −X)
  const xImage = new THREE.Vector3().crossVectors(f, p).negate()
  const m = new THREE.Matrix4().makeBasis(xImage, f.clone().negate(), p)
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

function DoctorArm({
  position,
  rotation,
  scale = 1,
  sleeveLength = 1,
}: {
  position: [number, number, number]
  rotation: [number, number, number]
  scale?: number | [number, number, number]
  sleeveLength?: number // 소매를 화면 밖까지 늘리는 배수 (팔뚝 절단면이 화면 한가운데 뜨는 걸 막는다)
}) {
  const { scene } = useGLTF('/models/doctor_arm.glb')
  const inst = useMemo(() => {
    const clone = scene.clone(true)
    // 소매(Cylinder/Torus)만 반경을 줄인다 — 원본은 팔뚝 대비 3배로 부풀려 있어 원뿔로 읽힌다.
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (!materials.some((m) => m?.name === 'sleeve')) return
      // 소매 원통(y 0.07~0.37)만 길이를 늘린다. 손목 커프(Torus)는 그대로 둔다.
      const stretch = mesh.name.toLowerCase().includes('cylinder') ? sleeveLength : 1
      mesh.scale.set(DOCTOR_SLEEVE_SLIM, stretch, DOCTOR_SLEEVE_SLIM)
      if (stretch !== 1) mesh.position.y += 0.07 * (1 - stretch) // 소매 시작(손목쪽)을 제자리에 고정
    })
    return clone
  }, [scene, sleeveLength])
  return <primitive object={inst} position={position} rotation={rotation} scale={scale} />
}
useGLTF.preload('/models/doctor_arm.glb')

/* ── 의사 손 5포즈 (CC0 · tools/props/make_doctor_hands.py, hands 인수인계 §1) ──────────────
   에셋 규약이 handQuat 규약과 **같다**: 원점 = 손목, 손끝 = 로컬 −Y, 손바닥 법선 = 로컬 +Z.
   그래서 보정 회전 없이 그대로 붙는다.

   노드가 `hand` / `sleeve`(Cylinder) / `cuff`(Torus) 로 분리돼 있어 DoctorArm 의
   "소매만 반경을 줄이고 길이를 늘린다" 수법이 그대로 이식된다. 두 가지가 다르다:
     · **소매 노드에 회전이 들어 있다** (포즈마다 팔뚝 각도가 다르다). doctor_arm 처럼
       position.y 에 그냥 더하면 소매가 축을 벗어나 옆으로 미끄러진다 — 회전을 곱해서 밀어야 한다.
     · 소매의 로컬 +Y 가 **손끝 쪽**을 향하는 포즈가 있다(palm 은 forearm_axis 가 −Y).
       min/max 를 눈대중으로 고르면 늘어나는 방향이 뒤집혀 소매가 손을 삼킨다.
   ⚠ anisotropy·normalMap 금지 (UV 없는 메시에서 탄젠트 NaN → 블랙아웃 전례). */
type HandPose = 'palm' | 'grip_disc' | 'fist' | 'pinch' | 'two_finger'
const HAND_POSES: readonly HandPose[] = ['palm', 'grip_disc', 'fist', 'pinch', 'two_finger']
/** 가운 소매 지름(m). doctor_arm 에서 A/B 로 채택된 0.19 × 0.85 × 0.38 = 6.1cm 과 같게 맞춘다.
 *  손 GLB 의 소매는 포즈마다 5.5~7.9cm 로 제각각이라 그대로 쓰면 palm 포즈(7.9cm)가
 *  0.62(10.0cm) 때처럼 llq 마커를 다시 덮는다. */
const HAND_SLEEVE_DIA = 0.061
/** 소매 원통 길이 배수.
 *  ⚠ 종전 2.2(=28.4cm)는 **팔뚝이 통째로 화면에 들어와 부자연스러웠다** — 1인칭에서 팔이
 *    길게 뻗어 나온 것처럼 보이고, 환자 팔·다리와 교차할 확률도 그만큼 커진다.
 *    사용자 지시(2026-07-26): "한 손목에서 4cm 정도까지만 보여주면 될 거 같고".
 *    원본 13cm 기준 4cm = 0.31배. 소매가 걷어 올려진 것처럼 읽혀 오히려 진찰 장면에 맞는다. */
const HAND_SLEEVE_LEN = 0.31
const HAND_IDENTITY = new THREE.Quaternion()

function DoctorHand({
  pose,
  position = [0, 0, 0],
  quaternion = HAND_IDENTITY,
  scale = 1,
  sleeveLength = HAND_SLEEVE_LEN,
}: {
  pose: HandPose
  position?: [number, number, number]
  quaternion?: THREE.Quaternion
  scale?: number | [number, number, number]
  sleeveLength?: number
}) {
  const { scene } = useGLTF(`/models/hand_${pose}.glb`)
  const inst = useMemo(() => {
    const clone = scene.clone(true)
    const sleeve = clone.getObjectByName('sleeve') as THREE.Mesh | null
    const cuff = clone.getObjectByName('cuff') as THREE.Mesh | null
    if (sleeve?.isMesh) {
      sleeve.geometry.computeBoundingBox()
      const bb = sleeve.geometry.boundingBox
      if (bb) {
        const slim = HAND_SLEEVE_DIA / Math.max(bb.max.x - bb.min.x, 1e-4)
        // 원통 양 끝 중 **손목(부모 원점)에 가까운 쪽**을 제자리에 고정하고 팔꿈치 쪽으로만 늘린다.
        const lo = new THREE.Vector3(0, bb.min.y, 0).applyQuaternion(sleeve.quaternion).add(sleeve.position)
        const hi = new THREE.Vector3(0, bb.max.y, 0).applyQuaternion(sleeve.quaternion).add(sleeve.position)
        const keep = lo.lengthSq() < hi.lengthSq() ? bb.min.y : bb.max.y
        sleeve.scale.set(slim, sleeveLength, slim)
        sleeve.position.add(
          new THREE.Vector3(0, keep * (1 - sleeveLength), 0).applyQuaternion(sleeve.quaternion),
        )
        // 손목 커프(토러스)는 길이는 그대로, 반경만 소매에 맞춘다 (로컬 Y = 튜브 두께).
        if (cuff) cuff.scale.set(slim, 1, slim)
      }
    }
    clone.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const s = mat as THREE.MeshStandardMaterial
        if (s && 'roughness' in s) s.envMapIntensity = 0.7
      }
    })
    return clone
  }, [scene, sleeveLength])
  return <primitive object={inst} position={position} quaternion={quaternion} scale={scale} />
}
for (const p of HAND_POSES) useGLTF.preload(`/models/hand_${p}.glb`)

/** 살(피부) 두께(m) — 앵커는 **본** 좌표라 손가락 배는 그보다 이만큼 바깥이다. */
const HAND_FLESH = 0.009
/** 검지·중지 끝 중점(손 로컬) — 각 `hand_*.anchors.json` 의 `grip_two_finger` 를 옮긴 값. */
const HAND_TIP: Record<HandPose, [number, number, number]> = {
  palm: [-0.01886, -0.16846, 0.00047],
  grip_disc: [-0.00903, -0.14689, -0.0022],
  fist: [-0.01172, -0.08228, 0.00018],
  pinch: [-0.0041, -0.07287, 0.00558],
  two_finger: [-0.01266, -0.15965, -0.00036],
}
const HAND_ROLL_AXIS = new THREE.Vector3(0, 1, 0)

/**
 * 술기별로 **피부에 닿는 손의 지점**(손 로컬) + 손목 축(로컬 Y) 회전.
 *
 * bbox 최저점으로 앉히면 안 된다 — 최저점이 손목/커프라 손바닥이 체표에서 뜬다(인수인계 §5).
 * 술기마다 닿는 곳이 다르다는 것도 bbox 하나로는 표현이 안 된다.
 *
 * 주먹만 회전이 붙는다: 손끝 앵커로 앉히면 **너클부터 파묻힌다**(§6a). CVA 는 실제로
 * 척측(새끼손가락 쪽 = 로컬 −X)이 닿으므로, 손목 축으로 90° 돌려 −X 가 체표를 보게 한다.
 */
function handContact(pose: HandPose): { local: THREE.Vector3; roll: number } {
  const tips = new THREE.Vector3().fromArray(HAND_TIP[pose])
  switch (pose) {
    case 'palm': // 촉진·타진 — 손바닥 한가운데(수지 기저부)가 눌린다
      return { local: tips.multiplyScalar(0.62).setZ(HAND_FLESH + 0.004), roll: 0 }
    case 'grip_disc': // 청진 — 체스트피스 **밑면**이 닿는다 (드럼 높이 0.02 × 스케일)
      return { local: tips.setZ(tips.z + HAND_FLESH + 0.02 * CHESTPIECE_SCALE), roll: 0 }
    case 'fist': // CVA — 주먹 척측. bbox 최소 x 가 곧 피부에 닿는 면이라 살두께를 더하지 않는다
      return { local: new THREE.Vector3(-0.034, -0.055, 0.004), roll: Math.PI / 2 }
    case 'pinch': // 설압자 — 엄지·검지 사이
    case 'two_finger': // 갑상샘 — 2·3지 지문
      return { local: tips.setZ(tips.z + HAND_FLESH), roll: 0 }
  }
}

/**
 * 손을 접촉점에 앉힌다. 반환 position 은 **손목**(에셋 원점)의 부모 로컬 좌표 —
 * 접촉점에서 접촉 지점을 되민 값이다.
 *
 * 고정 오프셋으로 두면 방향이 조금만 바뀌어도 파묻히거나 뜬다 — doctor_arm 시절 +0.03 으로
 * 박아 뒀다가 겪은 일이고, 그래서 계산(armLowestY)으로 바뀌었다가 지금은 술기별 접촉 지점으로
 * 다시 바뀌었다. bbox 최저점 방식으로 되돌아가지 마라: 최저점이 손목/커프라 손바닥이 뜬다.
 */
function seatHand(
  pose: HandPose,
  finger: [number, number, number],
  palm: [number, number, number],
  contact: [number, number, number],
): { q: THREE.Quaternion; position: [number, number, number] } {
  const { local, roll } = handContact(pose)
  const q = handQuat(finger, palm)
  if (roll !== 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(HAND_ROLL_AXIS, roll))
  const w = local.applyQuaternion(q)
  return { q, position: [contact[0] - w.x, contact[1] - w.y, contact[2] - w.z] }
}

/* ── 접촉 압박 (스펙 §3) ─────────────────────────────────────────────────────
   손이 닿는 것만으로는 "누르고 있다"가 안 읽힌다. 접촉점 주변 피부를 눌러 넣고 그늘지게 한다.
   셰이더는 `skinPress.ts`, 여기서는 **어느 재질에 걸고 매 프레임 무엇을 넣을지**만 정한다.

   리그(PalpationRig)가 여기에 접촉 상태를 쓰고, SkinPress 가 그것을 uniform 으로 옮긴다.
   리그에서 직접 재질을 만지지 않는 이유: 재질은 환자(RealisticPatient) 소유라 리그가
   붙었다 떨어질 때마다 건드리면 셰이더가 재컴파일된다. 주입은 한 번, 갱신은 값만. */
const SKIN_PRESS = {
  active: false,
  /** 눌리기 전 체표 접촉점(월드) */
  contact: new THREE.Vector3(0, 999, 0),
  /** 접촉면 법선(월드) = 부위 앵커 normal */
  normal: new THREE.Vector3(0, 1, 0),
  /** 손끝이 향하는 방향(월드) — 발자국 장축 */
  axis: new THREE.Vector3(1, 0, 0),
  press: 'none' as PressId,
  /** 0 = 닿기 직전, 1 = 최대 압박. 리그의 뻗기 이징을 그대로 쓴다 */
  hold: 0,
}

/** 환자 **스킨** 재질 판별. RealisticPatient 의 `materialKind()` 중 skin 분기만 옮긴 것이다
 *  (그 파일은 다른 담당 소유라 import 하지 않는다 — 이름 규칙이 바뀌면 여기도 같이 고쳐야 한다). */
function isPatientSkinMaterial(meshName: string, materialName: string): boolean {
  const id = `${meshName} ${materialName}`.toLowerCase()
  return id.includes('asianskin') || id.includes('patient_skin') || id.includes('h_dds_highres')
}

/** 매 프레임 재질을 찾아 헤매지 않도록, 붙인 uniform 을 들고 다닌다. */
function SkinPress({ patientRef }: { patientRef: RefObject<THREE.Group | null> }) {
  const bound = useRef<{ root: THREE.Object3D | null; u: PressUniforms[]; next: number }>(
    { root: null, u: [], next: 0 },
  )
  useFrame(({ clock }) => {
    const root = patientRef.current
    const b = bound.current
    if (!root) { b.root = null; b.u = [] ; return }
    /* 아바타 교체·의복 변경으로 재질이 다시 만들어질 수 있어 주기적으로 다시 훑는다.
       applySkinPress 는 같은 재질에 두 번 걸어도 안전하므로(userData 표시) 중복 주입은 없다.
       매 프레임 훑으면 트리 순회가 낭비라 0.5초에 한 번만 한다. */
    if (b.root !== root || clock.elapsedTime > b.next) {
      b.root = root
      b.next = clock.elapsedTime + 0.5
      const found: PressUniforms[] = []
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!mat || !isPatientSkinMaterial(mesh.name, mat.name)) continue
          found.push(applySkinPress(mat))
        }
      })
      b.u = found
    }
    if (b.u.length === 0) return
    const s = SKIN_PRESS
    const press = s.active ? s.press : 'none'
    const half = PRESS_HALF[press]
    for (const u of b.u) {
      u.uContact.value.copy(s.contact)
      u.uPressNormal.value.copy(s.normal)
      u.uAxis.value.copy(s.axis)
      u.uDepth.value = PRESS_DEPTH[press] * s.hold
      u.uHalf.value.set(half[0], half[1])
      u.uSoft.value = PRESS_SOFT[press]
      u.uSoftShade.value = PRESS_SHADE_SOFT[press]
      u.uShade.value = PRESS_SHADE[press] * s.hold
    }
  })
  // 진찰을 나갈 때 자국을 지운다 — 재질은 환자 쪽 캐시에 살아남아 다음 화면까지 따라간다.
  useEffect(() => () => {
    for (const u of bound.current.u) clearSkinPress(u)
    SKIN_PRESS.active = false
  }, [])
  return null
}

/* ── 펜라이트 — 실물 GLB + 진짜 SpotLight (스펙 §4.1) ──
   `penlight.anchors.json`: lens_center=[0,0.00028,0], emit_dir=[0,-1,0],
   light_pos=[0,-0.00172,0], lens_radius=0.00465, 몸통 bbox y = -0.0008~0.1412.
   → **렌즈가 y≈0 에 있고 몸통은 +Y 로 뻗으며 빛은 로컬 −Y 로 나간다.**
   손 에셋도 손끝이 로컬 −Y 다(armQuat 참고) → 회전 없이 그대로 쥐어주면 조준이 맞는다.

   ⚠ three 로 읽으면 몸통이 재질별 3개 프리미티브로 쪼개져 메시 이름이
     `Penlight`/`Penlight_1`/`Penlight_2` 가 된다. 렌즈는 **재질 이름**으로 찾아야 한다.
   ⚠ 그림자는 끈다 — 얼굴 몇 cm 앞의 광원은 섀도맵 near/far 비가 극단이라 아크네만 생긴다. */
const PENLIGHT_LIGHT_Y = -0.00172 // anchors.light_pos[1]
function Penlight({
  position,
  aimDir,
  intensity = 0.9,
  aimDistance = 0.12,
  angle = 0.3,
  penumbra = 0.42,
  lightLayer,
}: {
  position: [number, number, number]
  /* 빔이 나아갈 방향(부모 공간). 생략하면 로컬 −Y 그대로 — 손에 쥔 채 손끝 방향으로 쏜다.
     손과 다른 각도로 겨눠야 하는 술기(결막)에서만 지정한다. */
  aimDir?: [number, number, number]
  intensity?: number
  aimDistance?: number // 조준점까지의 거리(m). target 위치만 정하므로 밝기와는 무관하다.
  angle?: number
  penumbra?: number
  lightLayer?: number
}) {
  const { scene } = useGLTF('/models/penlight.glb')
  const quat = useMemo(
    () => (aimDir ? armQuat(aimDir, 0) : new THREE.Quaternion()),
    // armQuat 은 에셋의 −Y 를 주어진 방향으로 돌린다 — 펜라이트의 emit_dir 과 축이 같다.
    [aimDir],
  )
  const inst = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.castShadow = false
      m.receiveShadow = false
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const s = mat as THREE.MeshStandardMaterial
        if (s?.name !== 'Penlight_Lens_Emissive') continue
        // emissive 색(#fff1cc)은 자산에 이미 들어 있다. 세기만 올려 램프 끝을 켠다.
        // 4까지 올리면 Bloom(임계 1.02)이 물려 램프가 흰 덩어리로 번진다. 2.2가 "켜졌다"의 하한.
        s.emissiveIntensity = 2.2
        // 톤매핑에 눌리면 켜진 램프가 회색 점이 된다. 렌즈만 예외로 둔다.
        s.toneMapped = false
      }
    })
    return c
  }, [scene])
  /* spotLight.target 은 씬 그래프에 있어야 조준된다 — FaceKeyLight 주석의 함정과 같다. */
  const target = useMemo(() => new THREE.Object3D(), [])
  const light = useRef<THREE.SpotLight>(null)
  useEffect(() => {
    if (!light.current) return
    light.current.layers.set(lightLayer ?? 0)
  }, [lightLayer])
  return (
    <group position={position} quaternion={quat}>
      <primitive object={inst} />
      <primitive object={target} position={[0, PENLIGHT_LIGHT_Y - aimDistance, 0]} />
      <spotLight
        ref={light}
        position={[0, PENLIGHT_LIGHT_Y, 0]}
        target={target}
        angle={angle}
        penumbra={penumbra}
        intensity={intensity}
        distance={0.5} // 짧은 감쇠: 방을 물들이지 않는다
        decay={2}
        color="#fff4d6"
      />
    </group>
  )
}
useGLTF.preload('/models/penlight.glb')
useGLTF.preload('/models/tongue_depressor.glb')

/* ── 갑상샘 촉진 리그 — 앉은 환자의 목 앞으로 의사의 양손이 뻗어 들어온다.
   AuscultationRig처럼 yaw만 카메라를 향해 돌려 항상 내 쪽에서 팔이 들어오게.
   팔 방향은 오일러 대신 쿼터니언으로 계산: 에셋 기준 손끝=-Z, 손바닥=-Y. ── */
function armQuat(fingerDir: [number, number, number], roll: number): THREE.Quaternion {
  // 항등 렌더 실측: 에셋의 손끝은 -Y(아래), 소매 축은 +Y (glTF 임포트 후 three.js 기준)
  const d = new THREE.Vector3(...fingerDir).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d)
  const qr = new THREE.Quaternion().setFromAxisAngle(d, roll)
  return qr.multiply(q)
}

/* ── 구강검사 리그 — 설압자(나무 스틱)+펜라이트를 쥔 오른손이 입으로 뻗어 들어온다 ── */
function OralExamRig() {
  const aim = useRef<THREE.Group>(null)
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  const wp = useMemo(() => new THREE.Vector3(), [])
  // 끝은 혀 정중선에 유지하되 막대는 구강 개구부를 따라 낮은 각도로 들어온다.
  // 위쪽 성분이 크면 팁은 맞아도 막대 중간이 아랫입술 평면을 관통해 보인다.
  // 폭 방향을 혀와 평행하게 둔다. 정면만 향하게 하면 폭 18mm가 세로로 서서
  // 윗모서리가 치아에 걸리고, 도구를 내리면 팁 전체가 입 밖으로 빠진다.
  const toolRoll = 0.591
  const q = useMemo(() => armQuat([0.42, 0.28, -0.86], toolRoll), [])
  useFrame(({ camera, clock }) => {
    const g = aim.current
    if (!g) return
    // 앵커 = 입 (혀 앵커가 있으면 그 자리, 없으면 머리 본 아래 5.5cm)
    const tongue = ANCHOR_POOL.oral_tongue
    if (tongue.radius > 0) g.position.copy(tongue.pos)
    else g.position.set(HEAD_WORLD.x, HEAD_WORLD.y - 0.055, HEAD_WORLD.z)
    g.getWorldPosition(wp)
    g.rotation.y = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z)
    const r = reach.current
    if (r) {
      if (t0.current === null) t0.current = clock.elapsedTime
      const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.5)
      const ease = 1 - Math.pow(1 - k, 3)
      // 혀와 인두는 같은 설압자 접촉점에서 관찰한다. 인두를 본다고
      // 막대를 더 밀면 혀·아랫입술을 관통한다. 카메라·조명만 바꿔 관찰한다.
      r.position.set(0, (1 - ease) * 0.25, (1 - ease) * 0.7)
    }
  })
  return (
    <group ref={aim}>
      <group ref={reach}>
        <Suspense fallback={null}>
          {/* 150mm 실물 설압자로 바꾸며 손을 입에서 3.5cm 더 멀리 뻔다.
              짧은 115mm 박스에 손을 맞추니 검지가 환자 볼을 뚫고 들어갔다.
              길어진 37.5mm가 거의 같은 팁 위치를 만들어 손만 뒤로 빠진다. */}
          <group position={[-0.071, -0.054, 0.200]} quaternion={q}>
            {/* 설압자를 쥔 손 — 엄지·검지가 집는 hand_pinch.
                집는 점(anchors.pinch, 로컬 y≈-0.090)이 스틱 상단(-0.088~-0.203) 안에 든다. */}
            {/* 설압자 평면은 카메라를 보게 두고, 손만 길이축(Y) 주위로 돌린다.
                도구까지 같이 돌리면 18mm 폭이 안 보이고 2mm 모서리만 보였다. */}
            <group rotation={[0, Math.PI / 2 + toolRoll, 0]}>
              <DoctorHand pose="pinch" />
            </group>
            {/* 설압자 — 150×18×2mm, 라운드 팁·베벨·자작나무 PBR 에셋. */}
            <FittedGLB
              url="/models/tongue_depressor.glb"
              targetSize={0.15}
              // 라운드 팁은 열린 입 사이로 들어가 혀 앞면을 가리며 얹힌다. 관통하던
              // -0.185보다 2cm 밖에 두고, 리그 높이로만 접촉 위치를 맞춘다.
              position={[0, -0.165, 0.008]}
            />
          </group>
          {/* 펜라이트 — 설압자로 혀를 눌러 내리고 다른 손의 펜라이트로 인두를 비추는 것이 실제 술기다.
              ⚠ 손 그룹 **안에** 넣으면 안 된다. 렌즈가 입에서 4cm 거리라 2cm 남짓의 측면 오프셋이
                24.9°(콘 반각 17.2°)로 증폭돼 빔이 입을 통째로 벗어난다 — 실측으로 확인했다.
                aim 공간(원점 = 혀 앵커)에 두고 원점을 직접 겨눠야 한다. */}
          <Penlight
            /* 옆(+x)으로 더 눕히면 몸통이 프레임에 걸리지만 빔이 뺨으로 새고 입 조도가 떨어진다
               (실측: 조사면 평균 174.4 → 155.9). 입을 밝히는 쪽을 택했다 — 실물 펜라이트는
               결막 검사 화면에서 정면으로 보인다. */
            position={[0.075, -0.05, 0.105]}
            aimDir={[-0.542, 0.361, -0.759]} // normalize(원점 − position)
            intensity={0.18}
            aimDistance={0.138}
            /* 17° 콘은 입의 4cm 옆에서 뽘 빔이 뽈에 삼각형으로 걸렸다.
               입술 개구부만 비추도록 9°로 좁히고 가장자리를 부드럽게 풀어준다. */
            angle={0.16}
            penumbra={1}
            lightLayer={2}
          />
        </Suspense>
      </group>
    </group>
  )
}

/* ── 결막·공막 검사 리그 — 아랫눈꺼풀을 검지로 살짝 내리는 손.
   호버한 눈(HOVER_CONTACT)의 앵커 위로 붙는다. 눈은 부위가 작아 접촉물이 없으면
   "무엇을 하고 있는지" 화면에서 읽히지 않는다. ── */
function ConjunctivaReach() {
  const aim = useRef<THREE.Group>(null)
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  const wp = useMemo(() => new THREE.Vector3(), [])
  // 손끝이 위(눈꺼풀)를 향하고 아래에서 올라와 받친다.
  const q = useMemo(() => armQuat([-0.18, 0.66, -0.73], 0), [])
  useFrame(({ camera, clock }) => {
    const g = aim.current
    if (!g) return
    const region = HOVER_CONTACT.region
    const eye = region === 'eye_r' || region === 'eye_l' ? ANCHOR_POOL[region] : null
    g.visible = !!eye && eye.radius > 0
    if (!eye || !g.visible) { t0.current = null; return }
    // 아랫눈꺼풀은 안구 중심보다 ~1.6cm 아래다. 눈 자체를 가리지 않게 살짝 내려 붙인다.
    g.position.copy(eye.pos).addScaledVector(PATIENT_TORSO.up, -0.016)
    g.getWorldPosition(wp)
    g.rotation.y = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z)
    const r = reach.current
    if (r) {
      if (t0.current === null) t0.current = clock.elapsedTime
      const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.45)
      const ease = 1 - Math.pow(1 - k, 3)
      // 정착 후 눈꺼풀을 아주 조금씩 더 내리는 미세 움직임
      const press = k >= 1 ? (Math.sin((clock.elapsedTime - t0.current - 0.45) * 3.0) - 1) * 0.0016 : 0
      r.position.set(0, (1 - ease) * 0.22 + press, (1 - ease) * 0.55)
    }
  })
  return (
    <group ref={aim}>
      <group ref={reach}>
        <Suspense fallback={null}>
          {/* 손목 위치 — 손끝이 아랫눈꺼풀에 닿도록. 실측으로 맞췄다(−0.085는 손이 입가로 내려갔다). */}
          <group position={[0.048, -0.034, 0.062]} quaternion={q}>
            <DoctorArm position={[0, 0, 0]} rotation={[0, 0, 0]} scale={0.52} sleeveLength={1.15} />
          </group>
          {/* 결막을 보려면 빛이 있어야 한다 — 창백/황달 판별이 이 화면의 목적이다.
              손은 눈꺼풀을 내리느라 손끝이 눈을 향하므로, 펜라이트는 손 옆에서 따로 겨눈다.
              aim 원점은 눈 중심에서 1.6cm 아래라 조준점을 그만큼 올려 잡는다. */}
          <Penlight
            position={[0.055, -0.015, 0.055]}
            aimDir={[-0.656, 0.37, -0.656]}
            intensity={0.18}
            aimDistance={0.084}
            angle={0.2}
            penumbra={1}
            lightLayer={3}
          />
        </Suspense>
      </group>
    </group>
  )
}

function ThyroidReach() {
  const aim = useRef<THREE.Group>(null)
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  const wp = useMemo(() => new THREE.Vector3(), [])
  /* 2·3지를 편 손(hand_two_finger)이 아래에서 받쳐 올라와 지문으로 엽을 만진다.
     armQuat(축 하나)은 롤이 통제가 안 돼 편 두 손가락이 옆으로 눕는다 — 손바닥 방향까지
     지정하는 handQuat 을 쓴다. aim 그룹은 +Z 가 카메라 쪽이므로 지문은 −Z(목 안쪽)를 본다. */
  const seatR = useMemo(
    () => seatHand('two_finger', [-0.5, 0.66, -0.55], [0, 0, -1], [0.016, 0, 0.012]),
    [],
  )
  /* 왼손은 오른손의 거울상이다. 자세를 따로 잡으면 좌우가 미묘하게 어긋나므로
     x=0 평면 반사(M)로 유도한다: pos → M·p, quat → M·R·M = (x,−y,−z,w), 메시 → scale x −1. */
  const seatL = useMemo(() => ({
    q: new THREE.Quaternion(seatR.q.x, -seatR.q.y, -seatR.q.z, seatR.q.w),
    position: [-seatR.position[0], seatR.position[1], seatR.position[2]] as [number, number, number],
  }), [seatR])
  useFrame(({ camera, clock }) => {
    const g = aim.current
    if (!g) return
    /* 앵커 = 갑상샘 좌·우엽 앵커의 중점. 앵커가 아직 없으면(도구 미선택 등) 예전처럼
       머리 본 아래 13cm로 근사한다 — 아바타 키와 무관하게 목에 붙는다. */
    const rl = ANCHOR_POOL.thyroid_r
    const ll = ANCHOR_POOL.thyroid_l
    if (rl.radius > 0 && ll.radius > 0) {
      g.position.copy(rl.pos).add(ll.pos).multiplyScalar(0.5)
      // 호버 중인 엽 쪽으로 손을 옮긴다 — 평가표는 "반대편을 밀고 이쪽 엽을 촉진"을 요구한다.
      const hovered = HOVER_CONTACT.region
      if (hovered === 'thyroid_r' || hovered === 'thyroid_l') {
        const target = ANCHOR_POOL[hovered].pos
        g.position.lerp(target, 0.55)
      }
    } else {
      g.position.set(HEAD_WORLD.x, HEAD_WORLD.y - 0.13, HEAD_WORLD.z)
    }
    g.getWorldPosition(wp)
    g.rotation.y = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z)
    const r = reach.current
    if (r) {
      if (t0.current === null) t0.current = clock.elapsedTime
      const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.5)
      const ease = 1 - Math.pow(1 - k, 3)
      // 촉진 중 미세한 상하 움직임 (만져보는 느낌)
      const knead = k >= 1 ? Math.sin((clock.elapsedTime - t0.current) * 4.2) * 0.006 : 0
      r.position.set(0, (1 - ease) * 0.3 + knead, (1 - ease) * 0.8)
    }
  })
  return (
    <group ref={aim}>
      <group ref={reach}>
        <Suspense fallback={null}>
          {/* 손목 위치는 seatHand 가 계산한다 — 지문이 앵커(엽) 옆 1.6cm 에 닿도록 되민 값이다.
              고정 오프셋으로 두면 앵커가 4~5cm 움직였을 때처럼 손이 가슴 위에 얹힌다. */}
          <DoctorHand pose="two_finger" position={seatR.position} quaternion={seatR.q} />
          <DoctorHand pose="two_finger" position={seatL.position} quaternion={seatL.q} scale={[-1, 1, 1]} />
        </Suspense>
      </group>
    </group>
  )
}

/* ── 1인칭 청진 리그 — 의사(나)의 손이 체스트피스를 쥐고 화면 쪽에서 팔이 뻗어 들어온다.
   부모(RegionMesh의 부위 그룹)가 이미 "로컬 +Y = 체표 법선, 로컬 +Z = 카메라 쪽"으로 정렬돼
   있으므로 여기서 다시 yaw를 걸지 않는다. 예전엔 부모가 축정렬이라 월드 x/z로 yaw를 계산했는데,
   부모가 회전한 지금 그 식을 그대로 두면 이중 회전이 되어 팔이 엉뚱한 데서 들어온다. ── */
/* 팔이 들어오는 방향 — 부위 그룹은 "로컬 +Y=체표 법선, +Z=카메라의 접평면 투영"으로 서 있으므로
   시선 방향은 항상 로컬 (0, sinφ, cosφ)다(진찰 카메라 실측 φ≈51°).
   소매를 그대로 +Z(카메라 쪽)로 뻗으면 **시선과 나란해져 소매 통을 정면에서 들여다보게 된다**
   — 그게 "폭 30cm 회색 원뿔"의 정체다. 그래서 방위각을 +Z에서 옆(+X=화면 오른쪽)으로 55~60°
   틀어 팔이 화면 오른쪽에서 비스듬히 들어오게 한다(시선과 약 50~60° 차이 → 팔을 옆에서 본다). */
const STETHO_FINGER: [number, number, number] = [-0.807, -0.407, -0.429]
const STETHO_PALM: [number, number, number] = [0, -1, 0]
/** 의사 팔뚝이 들어오는 방향(부위 그룹 로컬 +y = 체표 법선 기준 요각, rad).
 *
 * ⚠️ 이 값이 0 이면 소매가 **환자 팔뚝을 관통한다.** 환자는 팔을 몸 옆에 붙이고 눕는데
 *   기본 방향이 그 팔을 가로지르기 때문이다(캡처 `scratchpad/arm/03_청진_누름중.png` 로 재현).
 *   실제 진찰에서 의사는 환자 팔 **위로 넘겨** 손을 얹으므로, 팔뚝이 몸통 축(머리 쪽)에서
 *   들어오도록 돌려 준다. 부위 그룹이 체표 법선으로 서 있어 y 회전이 곧 체표면 위 방향 회전이다.
 *   숫자를 바꿨으면 반드시 렌더 캡처를 눈으로 확인해라 — 부위마다 팔 위치가 다르다. */
const DOCTOR_REACH_YAW = -1.15

function AuscultationRig() {
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  useFrame(({ clock }) => {
    // 뻗어 들어오는 애니메이션: 카메라 쪽(로컬 +z)·체표 바깥(로컬 +y)에서 0.45초에 걸쳐 내려앉음.
    // 리그가 더 이상 0.4배 축소 그룹 안에 있지 않으므로 이동량도 실제 미터로 준다.
    const r = reach.current
    if (r) {
      if (t0.current === null) t0.current = clock.elapsedTime
      const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.45)
      const ease = 1 - Math.pow(1 - k, 3)
      const settle = k >= 1 ? Math.sin((clock.elapsedTime - t0.current - 0.45) * 6) * 0.0016 : 0
      r.position.set(0, (1 - ease) * 0.22 + settle, (1 - ease) * 0.46)
    }
  })
  /* 체스트피스를 쥔 손 — 검지·중지가 드럼을 낀다(hand_grip_disc).
     grip_disc 의 접촉 지점은 손끝이 아니라 **체스트피스 밑면**이라(handContact),
     그 점을 드럼 밑면(= CHESTPIECE_LIFT − 드럼 반높이)에 맞추면 손이 디스크를 쥔 채로 얹힌다. */
  const seat = useMemo(
    () => seatHand('grip_disc', STETHO_FINGER, STETHO_PALM,
      [0, CHESTPIECE_LIFT - 0.01 * CHESTPIECE_SCALE, 0]),
    [],
  )
  const tubeGeo = useMemo(() => {
    // 스템(체스트피스 로컬 (0.05,0.016,0)에서 −0.55rad 기울어진 크롬 대) 끝에서 손목 옆으로 빠져 화면 쪽으로.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.038, CHESTPIECE_LIFT + 0.028, 0.004),
      new THREE.Vector3(0.055, CHESTPIECE_LIFT + 0.085, 0.10),
      new THREE.Vector3(0.05, CHESTPIECE_LIFT + 0.175, 0.27),
    ])
    return new THREE.TubeGeometry(curve, 24, 0.0055, 10, false)
  }, [])
  return (
    <group ref={reach} rotation={[0, DOCTOR_REACH_YAW, 0]}>
      <group position={[0, CHESTPIECE_LIFT, 0]} scale={CHESTPIECE_SCALE}>
        <Chestpiece />
      </group>
      {/* 체스트피스를 쥔 손 + 가운 소매 (같은 GLB 안에서 이어진다) */}
      <Suspense fallback={null}>
        <DoctorHand pose="grip_disc" position={seat.position} quaternion={seat.q} />
      </Suspense>
      {/* 청진기 튜브 — 스템에서 손목 옆으로 빠져 화면 쪽으로.
          ⚠ 튜브 곡선은 **화면 쪽으로 빠지도록** 로컬 좌표로 손수 그린 것이라
            리그가 `DOCTOR_REACH_YAW` 만큼 돌면 튜브도 같이 돌아 환자 몸통을 가로지른다.
            그래서 여기서만 같은 각도를 **되돌려** 튜브는 원래 방향을 유지하게 한다. */}
      <group rotation={[0, -DOCTOR_REACH_YAW, 0]}>
        <mesh geometry={tubeGeo}>
          <meshStandardMaterial color="#1d1f24" roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 1인칭 촉진/타진/CVA 리그 — 포즈가 들어간 손 GLB(손가락을 쥔다) 위에 가운 소매가 이어진다.
   손바닥이 체표를 향하고, **술기별 접촉 지점**이 정확히 피부 높이에 오도록 계산해 앉힌다.
   촉진·타진은 손바닥(palm), CVA 압통은 주먹 척측(fist)이 닿는다. ── */
const PALP_FINGER: [number, number, number] = [-0.840, -0.309, -0.446]
const PALP_PALM: [number, number, number] = [0, -1, 0]
function PalpationRig({ deep, pose }: { deep: boolean; pose: HandPose }) {
  const reach = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  // 부위 그룹의 로컬 원점은 피부에서 1.2cm 떠 있다 → 피부는 y=-0.012.
  // 깊은 촉진(deep)은 1.2cm 더 눌러 넣어 '깊게 누른다'가 보이게 한다.
  const seat = useMemo(
    () => seatHand(pose, PALP_FINGER, PALP_PALM, [0, deep ? -0.024 : -0.011, 0]),
    [pose, deep],
  )
  useFrame(({ clock }) => {
    const r = reach.current
    if (!r) return
    if (t0.current === null) t0.current = clock.elapsedTime
    const k = Math.min(1, (clock.elapsedTime - t0.current) / 0.4)
    const ease = 1 - Math.pow(1 - k, 3)
    // 정착 후엔 눌렀다 떼는 미세 움직임 (촉진하는 느낌)
    const knead = k >= 1 ? (Math.sin((clock.elapsedTime - t0.current - 0.4) * 3.4) - 1) * 0.0035 : 0
    r.position.set(0, (1 - ease) * 0.2 + knead, (1 - ease) * 0.4)

    /* 접촉 압박 — 손이 내려앉는 이징을 그대로 홀드 진행률로 쓴다(손과 자국이 같이 움직인다).
       부위 그룹(부모)이 "로컬 +Y = 체표 법선"으로 서 있으므로 접촉 평면은 부모에서 유도한다.
       주먹(CVA)은 두드리는 술기라 발자국(손바닥 18×9cm)이 맞지 않아 제외한다. */
    const parent = r.parent
    if (!parent || pose !== 'palm') { SKIN_PRESS.active = false; return }
    parent.updateWorldMatrix(true, false)
    parent.getWorldQuaternion(PRESS_Q)
    // 부위 그룹 원점은 체표에서 법선으로 ANATOMY.surfaceLift(1.2cm) 띄워 있다 → 피부는 −그만큼
    SKIN_PRESS.contact.set(0, -ANATOMY.surfaceLift, 0).applyMatrix4(parent.matrixWorld)
    SKIN_PRESS.normal.set(0, 1, 0).applyQuaternion(PRESS_Q)
    SKIN_PRESS.axis.set(PALP_FINGER[0], PALP_FINGER[1], PALP_FINGER[2]).applyQuaternion(PRESS_Q).normalize()
    SKIN_PRESS.press = deep ? 'deep' : 'shallow'
    SKIN_PRESS.hold = ease
    SKIN_PRESS.active = true
  })
  // 리그가 사라지면 자국도 사라져야 한다 — 호버를 뗐는데 눌린 자국만 남으면 안 된다.
  useEffect(() => () => { SKIN_PRESS.active = false }, [])
  return (
    <group ref={reach}>
      <Suspense fallback={null}>
        <DoctorHand pose={pose} position={seat.position} quaternion={seat.q} />
      </Suspense>
    </group>
  )
}
const PRESS_Q = new THREE.Quaternion()

/* ── 타진(percussion) 리그 — **양손**이다. 촉진과 같은 한 손 누르기로는 타진이 안 보인다.
 *
 * 실제 술기(사용자가 제시한 표준 도해, 2026-07-26):
 *   · 판(pleximeter) 손 — 체표에 **납작하게** 대고 가운뎃손가락만 살짝 눌러 밀착시킨다
 *   · 망치(plexor) 손  — 다른 손 가운뎃손가락 끝으로 판 손가락의 **첫마디 관절을 두드린다**
 * 종전에는 촉진과 똑같이 `hand_palm` 하나만 눌러서, 화면상 촉진과 구분이 안 됐다
 * (사용자 신고: "지금 타진이 타진이 아니라 촉진이야").
 *
 * ⚠ 접촉 압박(`SKIN_PRESS`)은 걸지 않는다. 타진은 **두드리는** 술기라 손바닥 자국(18×9cm)이
 *   남으면 안 된다 — 촉진과 또 헷갈린다. 그 판단은 종전 `PalpationRig` 주석과 같다.
 * ⚠ 좌표계: 부위 그룹의 로컬 +Y = 체표 바깥 법선. 그래서 "위로 든다" = +Y.
 *   숫자를 만졌으면 반드시 렌더 캡처를 눈으로 확인해라 — 부위마다 손 각도가 다르다. */
const PLEXOR_TAP_HZ = 2.6          // 두드리는 빈도(회/초) — 실제 타진은 부위당 2~3회
/* 들어올린 높이(m). 4.5cm 는 진찰 카메라 거리에서 거의 안 보였다(2026-08-02 렌더 검증).
   실제 타진도 손목 스냅으로 5~8cm 는 들었다 친다. */
const PLEXOR_LIFT = 0.075
const PLEXOR_CONTACT = 0.004       // 두드려 닿았을 때 판 손가락 위 높이(m)
/* 두드리는 **표적**. 손바닥이 아니라 판 손 가운뎃손가락의 **중간마디(중위지골)** 다
   (사용자 지시 2026-07-26: "손바닥을 두드리는 게 아니라 손가락 마디 가운데를 두드려야해").
   손바닥을 치면 소리가 안 나고 술기도 틀린다 — 뼈 위를 쳐야 공명이 생긴다.
   판 손은 `PALP_FINGER`(손끝 방향)를 따라 놓이므로, 그 축으로 손목에서 손가락 쪽으로
   약 7cm 나간 지점이 중간마디다(손 GLB 실측 스케일 기준). */
/** 판 손(체표에 대는 손)의 접촉점 — 부위 로컬. 아래 표적 계산과 platePos 가 같이 쓴다. */
const PALP_CONTACT: [number, number, number] = [0, -0.008, 0]

/* 판 손 손바닥 접촉점에서 **가운뎃손가락 중간마디(중위지골)** 까지의 거리(m).
   `handContact('palm')` 이 잡는 접촉점은 손바닥 한가운데(수지 기저부)라,
   거기서 손끝 방향으로 3.5cm 쯤 나간 지점이 중간마디다. */
const PLEXOR_REACH = 0.035

/* 두드리는 **표적** — 판 손 가운뎃손가락 중간마디의 부위-로컬 좌표.
   손바닥이 아니라 뼈 위를 쳐야 공명이 생긴다
   (사용자 지시 2026-07-26: "손바닥을 두드리는 게 아니라 손가락 마디 가운데를 두드려야해").

   ⚠ **이걸 상수 배열로 박아 두면 안 된다 — 그게 지금까지 틀려 있던 이유다.**
   종전 값 `[0.021, 0, -0.062]` 은 부위 로컬 축 기준이었는데, 판 손은
   `PALP_FINGER = [-0.840, -0.309, -0.446]` 이라는 **대각선**으로 놓인다.
   그래서 "손끝 쪽으로 6.2cm" 가 실제로는 엉뚱한 방향이 되어, 망치 손이 판 손 위로
   겹치지 않고 **옆에 나란히** 놓였다(2026-08-02 렌더 검증: 두 손이 그냥 배에 얹혀 있었다).
   손끝 축을 따라 재야 한다. */
const PLEXOR_TARGET: [number, number, number] = [
  PALP_CONTACT[0] + PALP_FINGER[0] * PLEXOR_REACH,
  PALP_CONTACT[1] + PALP_FINGER[1] * PLEXOR_REACH,
  PALP_CONTACT[2] + PALP_FINGER[2] * PLEXOR_REACH,
]
function PercussionRig() {
  const reach = useRef<THREE.Group>(null)
  const plexor = useRef<THREE.Group>(null)
  const t0 = useRef<number | null>(null)
  // 판 손: 촉진과 같은 방식으로 체표에 앉힌다(납작하게 밀착).
  const platePos = useMemo(
    () => seatHand('palm', PALP_FINGER, PALP_PALM, PALP_CONTACT),
    [],
  )
  /* 망치 손: 판 손 **가운뎃손가락 중간마디 바로 위**에 놓고 그 지점을 내려친다.
     판 손과 같은 자리에 겹치면 두 손이 서로를 뚫으므로 표적만큼 비켜 놓는다. */
  const plexorPos = useMemo(
    /* 표적 **바로 위**(체표 법선 +Y)에 든다. x·z 를 표적에서 그대로 가져와야
       판 손 중지 위에 겹친다 — 종전처럼 x·z 를 따로 주면 옆으로 비켜 앉는다. */
    () => seatHand('two_finger', PALP_FINGER, PALP_PALM, [
      PLEXOR_TARGET[0],
      PLEXOR_TARGET[1] + PLEXOR_LIFT,
      PLEXOR_TARGET[2],
    ]),
    [],
  )
  useFrame(({ clock }) => {
    const r = reach.current
    if (!r) return
    if (t0.current === null) t0.current = clock.elapsedTime
    const t = clock.elapsedTime - t0.current
    const k = Math.min(1, t / 0.4)
    const ease = 1 - Math.pow(1 - k, 3)
    r.position.set(0, (1 - ease) * 0.2, (1 - ease) * 0.4)
    const p = plexor.current
    if (!p || k < 1) return
    /* 두드림 — 위로 들었다가 빠르게 내려친다. 사인파를 그대로 쓰면 올라가는 속도와
       내려오는 속도가 같아 '두드림'이 아니라 '흔들림'으로 보인다.
       그래서 위로는 천천히(코사인), 아래로는 급하게(거듭제곱) 만든다. */
    const phase = (t * PLEXOR_TAP_HZ) % 1
    const swing = phase < 0.72
      ? 1 - Math.cos((phase / 0.72) * Math.PI * 0.5)   // 들어올리기 (느리게)
      : 1 - Math.pow((phase - 0.72) / 0.28, 0.55)      // 내려치기 (빠르게)
    p.position.y = PLEXOR_CONTACT + swing * (PLEXOR_LIFT - PLEXOR_CONTACT) - PLEXOR_LIFT
  })
  return (
    <group ref={reach}>
      <Suspense fallback={null}>
        {/* 판 손 — 체표에 납작하게 */}
        <DoctorHand pose="palm" position={platePos.position} quaternion={platePos.q} />
        {/* 망치 손 — 위에서 두드린다 */}
        <group ref={plexor}>
          <DoctorHand pose="two_finger" position={plexorPos.position} quaternion={plexorPos.q} />
        </group>
      </Suspense>
    </group>
  )
}

function Chestpiece() {
  const chrome = <meshStandardMaterial color="#c9ced3" metalness={0.92} roughness={0.16} />
  return (
    <group renderOrder={14}>
      {/* 크롬 본체 드럼 (아래로 살짝 넓어지는 원통) */}
      <mesh castShadow>
        <cylinderGeometry args={[0.043, 0.047, 0.02, 44]} />
        {chrome}
      </mesh>
      {/* 상단 크롬 테두리 링 (다이어프램을 감싸는 림) */}
      <mesh position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.041, 0.006, 16, 48]} />
        {chrome}
      </mesh>
      {/* 얇은 검은 씰 링 (림과 진동막 사이) */}
      <mesh position={[0, 0.014, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.037, 0.003, 12, 48]} />
        <meshStandardMaterial color="#14181c" roughness={0.5} />
      </mesh>
      {/* 다이어프램 진동막 (밝은 반투명 원판) — 이게 '청진기 머리'로 읽히게 */}
      <mesh position={[0, 0.0155, 0]}>
        <cylinderGeometry args={[0.036, 0.036, 0.0035, 44]} />
        <meshStandardMaterial color="#eef1f3" metalness={0.08} roughness={0.32} />
      </mesh>
      {/* 옆으로 꺾여 올라가는 크롬 스템 + 검은 튜브 목 (청진기 티) */}
      <group position={[0.05, 0.016, 0]} rotation={[0, 0, -0.55]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.0095, 0.0095, 0.055, 18]} />
          {chrome}
        </mesh>
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.0095, 0.035, 18]} />
          <meshStandardMaterial color="#0d1116" roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

/* ── 청진기 바이노럴(귀꽂이) — 의사(카메라)에 붙어 화면 하단에 크게. 내가 끼고 있는 느낌. 줄 없음.
   U(∪): 아래 굴곡=검은 고무, 위 팔=크롬, 끝에 검은 이어피스. ── */
function WornEarpiece() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    if (!ref.current) return
    const off = new THREE.Vector3(0, -0.165, -0.45).applyQuaternion(camera.quaternion)
    ref.current.position.copy(camera.position).add(off)
    ref.current.quaternion.copy(camera.quaternion)
  })
  const R = 0.04 // 작게
  const t = 0.005 // 크롬 팔 두께
  // 크롬 팔 — 수직에서 위쪽이 안쪽으로 '부드럽게' 휘는 곡선(TubeGeometry)
  const arms = useMemo(() =>
    [-1, 1].map((s) => {
      const pts = [
        new THREE.Vector3(s * R, 0.02, 0),
        new THREE.Vector3(s * R, 0.075, 0),
        new THREE.Vector3(s * R * 0.5, 0.112, 0),
        new THREE.Vector3(s * 0.015, 0.122, 0),
      ]
      return {
        geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, t, 8, false),
        tip: [s * 0.015, 0.124, 0] as [number, number, number],
      }
    }), [R, t])
  const chrome = <meshStandardMaterial color="#d2d7da" metalness={0.9} roughness={0.15} />
  const rubber = <meshStandardMaterial color="#0d1116" roughness={0.5} />
  return (
    <group ref={ref}>
      {/* 검은 고무 ∪ 굴곡 (아래, 위로 열림) — 두툼한 튜브 */}
      <mesh position={[0, 0.02, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[R, 0.008, 14, 48, Math.PI]} />
        {rubber}
      </mesh>
      {/* 고무→크롬 연결 마디 */}
      {[-R, R].map((x, i) => (
        <mesh key={`j${i}`} position={[x, 0.022, 0]}>
          <sphereGeometry args={[0.007, 10, 10]} />
          {chrome}
        </mesh>
      ))}
      {/* 부드럽게 휘는 크롬 팔 + 검은 이어팁 */}
      {arms.map((a, i) => (
        <group key={i}>
          <mesh geometry={a.geo}>
            <meshStandardMaterial color="#d2d7da" metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={a.tip}>
            <sphereGeometry args={[0.0085, 12, 12]} />
            <meshStandardMaterial color="#0d1116" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
/* ── 착용 청진기(GLB) — 실제 stethoscope.glb를 카메라에 붙여 화면 하단에 띄운다.
   손으로 만든 지오메트리 대신 스캔 모델의 U(헤드셋)+튜브 조금만 화면 위로 보이게 하고,
   나머지(긴 튜브·체스트피스)는 화면 아래 프레임 밖으로 밀어 자연스럽게 "잘려" 보이게 한다.
   ── 아래 STETHO 상수만 만지면 위치/크기/방향을 조정할 수 있다. ── */
const STETHO = {
  targetSize: 0.4,           // 화면상 청진기(U) 크기 (크게↑/작게↓)
  offX: -0.03,               // 좌우 위치 (+오른쪽 / -왼쪽)
  /* 상하 위치 (음수로 내림). -0.245 는 U 윗단이 화면 세로 중앙 바로 아래(y≈518/900)까지 올라와
     **복부 하복부 2분면 마커를 가렸다**(캡처 nodbg_mh_f60_ob_lie_ausc_hover_ruq.png — 크롬 U가
     배 한가운데에 얹혀 보인다). 클릭은 막지 않지만(이벤트 핸들러가 없어 R3F 가 건너뛴다)
     진찰 부위를 가리는 건 곤란하다. 계산: fov 52°, 거리 0.6m → 화면 반높이 0.293m 이므로
     U 윗단 = offY + targetSize/2 를 -0.14 아래로 두면 화면 y≈665 로 마커 띠(370~550) 밖이다. */
  offY: -0.34,
  offZ: -0.6,                // 카메라 앞 거리 (작을수록 가까워 큼)
  rotX: 0,                   // 앞뒤 눕히기
  rotY: 0,                   // 좌우 회전
  rotZ: 0,                   // 화면 평면 회전 — U가 거꾸로면 Math.PI
} as const

void WornEarpiece // 이전 수제 지오메트리 버전 — 폴백 참고용 보존 (GLB가 안 뜨면 되돌리기)

function WornStethoGLB() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    if (!ref.current) return
    const off = new THREE.Vector3(STETHO.offX, STETHO.offY, STETHO.offZ).applyQuaternion(camera.quaternion)
    ref.current.position.copy(camera.position).add(off)
    ref.current.quaternion.copy(camera.quaternion)
  })
  return (
    <group ref={ref}>
      <Suspense fallback={null}>
        <FittedGLB
          url="/models/stethoscope_u2.glb" // 체스트피스를 GLB 파일에서 영구 제거한 버전 (U+튜브만)
          targetSize={STETHO.targetSize}
          rotation={[STETHO.rotX, STETHO.rotY, STETHO.rotZ]}
        />
      </Suspense>
    </group>
  )
}

/* 진행 디스크 색 — 매 프레임 문자열 파싱을 피하려고 미리 만들어 둔다.
   진행 중(초록) / 이미 찍은 부위(옅은 회색). */
const DISK_ACTIVE = new THREE.Color('#6fd0a0')
const DISK_DONE = new THREE.Color('#b9c0c4')

/* 체스트피스를 대는 도구 — 복부·심장·폐 청진. 타진·촉진은 손이다. */
const AUSCULTATION_TOOLS: readonly ExamToolId[] = ['auscultation', 'heart_auscultation', 'lung_auscultation']
const HEADNECK_SET = new Set<string>(HEADNECK_REGIONS)

/* 두경부 접촉 리그는 머리 프레임(PATIENT_HEAD_WORLD)에 붙어 씬 루트에서 렌더되므로,
   RegionMesh(부위 그룹) 안에 넣을 수 없다. 어느 부위를 향할지만 여기로 전달한다.
   화면의 진찰 환자는 항상 한 명이고 호버도 한 번에 하나라 모듈 스코프 하나로 충분하다. */
const HOVER_CONTACT: { region: ExamRegion | null } = { region: null }

/* ══════════════════════════════════════════════════════════════════════════
   진찰 부위 앵커 — 본(bone) 기준 해부학적 유도 + 체표 레이캐스트
   ──────────────────────────────────────────────────────────────────────────
   EXAM.patientPos는 '발 기준점'이라, 같은 자리에 눕혀도 배의 실제 높이·위치는
   아바타의 다리 길이/몸통 길이/체형에 따라 달라진다. 아바타 풀이 MPFB 12종 +
   비만·마름 변형 + VALID 6종 + Rocketbox 3종 + RenderPeople 3종이라 고정 좌표로는
   맞출 방법이 없다(사용자 지적: "미묘하게 안 맞는다").
   → 환자 컴포넌트가 매 프레임 갱신하는 PATIENT_TORSO(골반·가슴·좌우 넓적다리 본에서
     만든 몸통 프레임)에서 해부학적 비율로 중심을 잡고, 레이캐스트로 실제 피부에 올린다.
   ══════════════════════════════════════════════════════════════════════════ */

/* 해부학 비율 — 공식 평가표의 "칼돌기부터 두덩결합까지", "배꼽 중심 4구역" 서술을 수치화한 것.
   화면에서 4분면이 너무 몰리거나 벌어지면 여기 비율만 조정하면 된다.

   ⚠ 기준선은 진짜 칼돌기·두덩결합이 아니라 **본 위치**(pelvis 본 ↔ spine_03 본)다.
   MPFB 실측(mh_f60_ob, 앙와위): pelvis (1.808, 0.809), spine_03 (1.579, 0.787) → torsoLen 0.230 m.
   실제 두덩결합~칼돌기는 이보다 1.4배쯤 길다(본이 랜드마크까지 닿지 않는다). 그래서
   간격 비율은 스펙 초안값(0.16/0.55)을 그대로 쓰지 않고 이 짧은 기준선에 맞춰 다시 잡았다.
   검산: 갈비활 x≈1.596 / 배꼽 x≈1.72 / 두덩결합 x≈1.844(키 1.55 m 기준 표준 인체비율)일 때
   상복부 중심 1.653(이상값 1.658), 하복부 중심 1.772(이상값 1.782)로 떨어진다. */
const ANATOMY = {
  /* 배꼽 높이 = 두덩결합에서 몸통 길이의 42% (아래쪽 4할).
     [2026-07-25 캡처 실측] 화면의 배꼽 오목과 4분면 무게중심을 비교했다:
     mh_m70 1.2cm, mh_f60_ob 1.8cm 차이(사실상 일치), mh_f20_thin만 4.4cm 발쪽으로 치우친다.
     3종 중 2종이 맞으므로 비율은 그대로 둔다 — 마른 체형만 본↔체표 정합이 다른 것이다. */
  umbilicusRatio: 0.42,
  /* 상/하복부 중심의 세로 간격(몸통 길이 대비).
     ⚠ 0.21은 **너무 좁았다**. 본 기준 몸통 길이(pelvis↔spine_03)로 0.21이면 상/하 중심이
     9cm밖에 안 떨어지는데 클릭 구 지름이 11cm라 상·하 사분면이 실제로 겹쳤다
     (b2_regions/mh_m70_lie_palp_markers.png — 네 마커가 한 덩어리로 읽힌다).
     0.38이면 상복부 중심이 기준선의 0.80(갈비활 근처), 하복부가 0.04(두덩 위)로 떨어져
     "칼돌기~두덩결합을 배꼽으로 4등분"이라는 평가표 서술과도 맞는다.
     옷에 가려지는 문제는 아래 slideMax(겹치지 않는 범위에서만 미끄러진다)가 받는다. */
  /* ⚠️ **상·하 간격은 대칭이면 안 된다.** 배꼽이 기준선의 0.42 에 있어서 아래 공간(0.42)이
     위 공간(0.58)보다 좁다. 종전처럼 ±0.38 을 쓰면
       상복부 = 0.42 + 0.38 = 0.80  (갈비활 근처 — 적당)
       하복부 = 0.42 − 0.38 = 0.04  ← 두덩결합 바로 위. **배가 아니라 치골이다**
     사용자 신고 2026-07-26: "2, 3분면쪽은 약간 올려야할듯 배꼽에서 너무 멀다".
     사분면 중심은 각 구역의 무게중심, 즉 배꼽과 경계(칼돌기 / 두덩결합)의 중점이다:
       상 = (0.42 + 1.00)/2 = 0.71 → 오프셋 +0.29
       하 = (0.42 + 0.00)/2 = 0.21 → 오프셋 −0.21
     ⚠ 간격을 더 좁히지 마라. 상·하 중심 거리 0.50 × torsoLen(≈0.22m) ≈ 11cm 인데
       클릭 구 지름이 그와 비슷해서, 더 좁히면 상·하 사분면이 겹쳐 클릭이 엉뚱한 부위로 들어간다
       (종전 0.21 대칭일 때 실제로 그랬다 — 네 마커가 한 덩어리로 읽혔다). */
  axialGapUpRatio: 0.29,
  axialGapDownRatio: 0.21,
  lateralGapRatio: 0.62,   // 좌/우 중심의 가로 간격 (몸통 반폭 대비)
  /* 갈비척추각(CVA)은 12번 갈비뼈가 척추와 만나는 곳(T12~L1)이다.
     실측(mh_f60_ob): pelvis 본 = 발바닥에서 0.842 m = 0.53·H(엉덩관절), spine_03 = 1.071 m = 0.674·H.
     표준 인체비율로 엉덩뼈능선이 0.60·H(≈L4), 거기서 T12까지 약 4마디(≈0.14 m)이므로
     T12 ≈ 0.688·H → spine_03 바로 아래위다. 즉 CVA는 몸통 길이의 거의 끝(0.95)에 온다.
     스펙 초안의 0.55로 두면 걸터앉은 자세에서 마커가 셔츠 밑단(엉치)까지 내려간다. */
  /* 갈비척추각 높이. 위 실측대로 T12 ≈ 0.688·H, spine_03 = 0.674·H 이므로 기준선의 **끝을 조금 넘는다**.
     0.95로 두면 마커가 엉덩뼈능선(셔츠 밑단)까지 내려가 '엉치를 두드리는' 그림이 된다.

     [2026-07-25 랜드마크 실측 — cva_probe.mjs] "마커가 8~9cm 낮다"는 육안 판단은 **틀렸다.**
     빗장뼈 본 두 개의 중점(=목아래패임, 실제 해부 랜드마크)과 골반 본(엉덩관절)을 화면에 찍어 재니
     표준 인체비율상 T12 = 엉덩관절→목아래패임의 0.545 지점이고, 월드 축 높이로:
       mh_m70      이상 0.238 / 현재 0.222 (−1.6 cm),  목아래패임 0.437, spine_03 0.212
       mh_f20_thin 이상 0.241 / 현재 0.232 (−0.9 cm),  목아래패임 0.442, spine_03 0.221
     화면에서 훨씬 낮아 **보이는** 것은 마커가 척추 축이 아니라 등 표면(카메라에 가까운 쪽)에
     앉기 때문이다 — 이상점을 같은 깊이로 밀어 찍으면(T12_surface) 마커 위 테두리에 붙는다.
     그래서 대폭 올리지 않고 1.05 → 1.12 로만 맞춘다(m70 0.237, f20_thin 0.247 ≈ 이상값 ±0.6 cm). */
  cvaHeightRatio: 1.12,
  cvaLateralRatio: 0.58,   // 척추에서 좌우로 (몸통 반폭 대비) — 좌우 마커가 서로 겹치지 않을 만큼
  cvaDepthRatio: 0.45,     // 등 쪽으로 파고드는 깊이 (몸통 반폭 대비)
  supineFlankRatio: 0.8,   // 누운 자세 폴백: 옆구리는 몸통 옆면 (등은 침대에 눌려 못 만진다)
  /* 누운 자세 옆구리 높이. CVA와 같은 0.95를 쓰면 마커가 갈비/겨드랑이까지 올라가
     상의 위나 팔 위에 얹힌다. 옆구리 중간(갈비활 아래~엉덩뼈능선 위)으로 내린다. */
  supineFlankHeightRatio: 0.62,
  /* 체표로 인정할 히트의 '다리 본 가중치' 상한 (nonTorsoWeight). 팔·다리 살을 거른다.
     ⚠ 이것만으로는 부족하다 — 넓적다리를 덮은 **바지**는 pelvis/spine_01 이 끌고 있어 그냥 통과한다.
     0.12까지 조여 봤지만 그 히트는 여전히 통과했고(mh_f60_ob lie_knees llq 1.85 그대로), 대신
     비만 아바타 상복부의 정상적인 튜닉 히트를 거부해 §4.1("보이는 옷이 곧 체표")을 깼다. 0.3 유지. */
  nonTorsoWeightMax: 0.3,
  /* 복부 4분면 전용 체표 깊이 창(몸통 반폭 대비). 레이는 front 축을 따라가므로 히트의 (up,right)
     좌표는 언제나 중심과 같다 — 즉 걸러낼 수 있는 자유도는 깊이 하나뿐이다.
     실측(3아바타 × 눕기/무릎세움/가운, D 수정 후):
       정상 배 표면 0.63 ~ 1.54 · halfWidth
       세운 넓적다리   −0.99 / −0.51 / +2.16 / +2.82 / +2.86 · halfWidth
     그래서 [0.10, 1.90] 으로 자른다. 전부 걸러지면 liftToSkin 이 fallbackDepth(0.85)로 떨어지는데,
     그건 정상 대역 한가운데라 '무릎 위 허공'보다 훨씬 낫다.

     ⚠ **알려진 미해결 1건 — 일부러 안 고쳤다.** `mh_f60_ob` + `lie_knees` + `llq` 는 아직도
     세운 넓적다리의 슬랙스(1.85·halfWidth)에 앉는다. 이 아바타는 배가 나와 **정상 배 표면이
     1.67 까지 올라오므로** 넓적다리(1.85)와의 분리 마진이 0.18·halfWidth(≈2.4 cm)밖에 없다.
     상한을 1.75 로 조이면 이 1건은 잡히지만 비만 상복부의 정상 히트를 잘라 먹는다 —
     검증된 11건(3아바타 × 4샷)을 위험에 빠뜨리는 거래라 남겼다.
     재검토 조건: 아바타 프로파일이 바뀌거나, 깊이 말고 다른 판별축이 생겼을 때.
     (레이가 front 축 고정이라 지금은 깊이 외에 쓸 자유도가 없다.) */
  quadrantDepthMin: 0.10,
  quadrantDepthMax: 1.90,
  surfaceLift: 0.012,      // 피부에서 살짝 띄우기 — 파묻힘/z-fighting 방지
  probeDist: 0.45,         // 레이 시작점(몸 밖) 거리
  probeRange: 0.9,         // 레이 사거리
  fallbackDepth: 0.85,     // 레이가 빗나갔을 때 중심에서 halfWidth의 몇 배만큼 밀어낼지

  /* ── 두경부 (headneck 스펙 §4) — 기준은 몸통 프레임이 아니라 머리/목 본이다 ──
     아바타마다 머리 크기·목 길이가 달라 고정 좌표는 못 쓴다. 눈 본이 있으면 그것을 쓰고,
     없으면 머리 본에서 아래 비율로 근사한다. */
  eyeUpFromHead: 0.055,    // 눈 본이 없을 때: 머리 본에서 위로 (m) — 머리 본 원점은 목 위다
  eyeHalfGap: 0.032,       // 눈 본이 없을 때: 좌우 반간격 (m)
  eyeFrontLift: 0.014,     // 안구 중심에서 각막 표면까지 (m). 눈은 레이캐스트하지 않는다 —
                           // 앞머리·속눈썹·눈썹에 먼저 맞아 마커가 이마로 튄다.
  eyeRadius: 0.024,        // 클릭 구 반지름. 좌우 간격(≈64mm)의 절반보다 작아야 두 눈이 안 겹친다
  thyroidHeightRatio: 0.42, // 목 본 → 머리 본 사이에서 반지연골 아래(갑상샘)의 높이 비율
  thyroidHalfGap: 0.020,   // 좌·우엽 중심의 반간격 (m, 몸통 크기에 비례 보정)
  thyroidRadius: 0.017,    // 좌우엽이 겹치지 않도록 반간격보다 작게
  mouthDownFromHead: 0.055, // 머리 본에서 입까지 아래로 (OralExamRig가 쓰는 값과 같다)
  oralTongueFront: 0.018,  // 입 중심에서 앞(혀 앞부분)
  oralPharynxBack: 0.030,  // 혀에서 더 안쪽(인두)
  oralRadius: 0.019,

  /* ── 흉부 (chest 스펙 §3) ──
     복장뼈 위끝(suprasternal)은 본이 없다. 목 본의 몸통축 높이에서 조금 내려 잡는다
     (목 본은 C7 근처라 실제 목아래패임보다 살짝 위·뒤에 있다). */
  suprasternalDrop: 0.10,  // 목 본 높이에서 아래로 (몸통 길이 대비)
  ics2Ratio: 0.22,         // 복장뼈 위끝(0)~칼돌기(1) 사이에서 2번째 갈비사이
  ics5Ratio: 0.68,         // 〃 5번째 갈비사이
  aorticLateral: 0.30,     // 몸통 반폭 대비 (환자 오른쪽 복장뼈옆)
  pulmonicLateral: 0.30,   // 〃 (환자 왼쪽 복장뼈옆)
  tricuspidLateral: 0.18,  // 왼쪽 복장뼈 하연
  /* 심첨(승모판). 스펙 초안 0.62는 삼첨판과 4.6cm밖에 안 떨어져 반지름 3cm짜리 두 구가 겹쳤다
     — 겹치면 클릭이 엉뚱한 판막으로 들어가 소견이 뒤바뀐다. 해부학적으로도 심첨은 빗장중간선이라
     복장뼈 하연보다 훨씬 바깥이다. */
  mitralLateral: 0.85,
  valveRadius: 0.026,      // 4판막이 서로 겹치지 않을 만큼 (가장 가까운 쌍의 간격보다 작게)
  /* 폐야 — 전면은 빗장뼈 아래부터 갈비활까지, 후면은 더 아래(T10)까지 내려간다.
     전면 상부를 0.18로 두면 마커가 빗장뼈/어깨에 걸린다. */
  lungAntRatios: [0.22, 0.50, 0.78] as [number, number, number],
  lungPostRatios: [0.24, 0.58, 0.92] as [number, number, number],
  lungAntLateral: 0.62,    // 몸통 반폭 대비 좌우 (빗장중간선)
  lungPostLateral: 0.72,   // 후면은 견갑골 사이가 아니라 그 바깥을 듣는다
  lungBackDepth: 0.9,      // 후면 폐야: 몸통 반폭 대비 등 쪽 깊이
  /* 상·중·하 간격(≈6cm)의 절반보다 작아야 세 부위가 겹치지 않는다. 0.04로 두면 전부 겹쳐
     한 점을 눌러도 다른 폐야가 잡힌다. */
  lungRadius: 0.028,
} as const

type ExamAnchor = {
  region: ExamRegion
  pos: THREE.Vector3      // 체표 위 월드 좌표
  normal: THREE.Vector3   // 체표 바깥 방향 — 청진기·손·진행 디스크를 이 축으로 세운다
  radius: number          // 클릭 구 반지름 (체형 비례). 0 = 아직 계산 전 → 클릭 불가
  skin: boolean           // 맨살에 앉았는가 (false = 옷 위 / 폴백). 시각 회귀 진단용
  /* 레이가 실제로 맞은 메시 이름. '마커가 왜 옷 위에 찍혔나'는 이것 없이는 못 가린다 —
     옷 메시가 garmentSlot() 이름표에 안 걸려 맨살로 오인되는 경우가 있어서다. */
  surface: string
}

/* 부위 앵커 풀 — 화면에 있는 진찰 환자는 항상 한 명이라 부위별 객체 하나를 재사용하고
   제자리에서 갱신한다. 매 프레임 새 객체를 만들면 RegionMesh가 리렌더돼 호버/홀드가 끊긴다.
   ⚠ store의 ExamRegion 전수를 반드시 채워야 한다(Record 강제). 부위를 추가하면 여기도 자동으로 는다. */
const ALL_REGIONS: readonly ExamRegion[] = [...ABDOMEN_REGIONS, ...HEADNECK_REGIONS, ...CHEST_REGIONS]
const ANCHOR_POOL = Object.fromEntries(ALL_REGIONS.map((region) => [region, {
  region,
  pos: new THREE.Vector3(),
  normal: new THREE.Vector3(0, 1, 0),
  radius: 0,
  skin: false,
  surface: '',
} satisfies ExamAnchor])) as Record<ExamRegion, ExamAnchor>

const ANT_LUNG: readonly ExamRegion[] = [
  'lung_ant_r_up', 'lung_ant_r_mid', 'lung_ant_r_low',
  'lung_ant_l_up', 'lung_ant_l_mid', 'lung_ant_l_low',
]
const POST_LUNG: readonly ExamRegion[] = [
  'lung_post_r_up', 'lung_post_r_mid', 'lung_post_r_low',
  'lung_post_l_up', 'lung_post_l_mid', 'lung_post_l_low',
]
/* 자세별 기본 부위 — **도구가 선택되면 TOOL_REGIONS가 우선한다**(그쪽이 store와 같은 단일 진실).
   자세만으로 고르면 걸터앉은 자세에서 옆구리 2 + 흉부 16이 한꺼번에 떠 클릭이 서로를 가로챈다. */
const REGIONS_BY_POSE: Record<ExamPose, readonly ExamRegion[]> = {
  sit: HEADNECK_REGIONS,
  lie: ['ruq', 'luq', 'rlq', 'llq', 'flank_r', 'flank_l'],
  lie_knees: ['ruq', 'luq', 'rlq', 'llq', 'flank_r', 'flank_l'],
  sit_edge: ['flank_r', 'flank_l'],
}

/* 레이캐스트 재사용 객체 — 진찰 중 동시에 도는 앵커 계산은 하나뿐이라 모듈 스코프로 둔다. */
const SURFACE_RAY = new THREE.Raycaster()
const RAY_ORIGIN = new THREE.Vector3()
const RAY_DIR = new THREE.Vector3()
/* 체표로 인정하지 않을 메시 — 프라이버시 드레이프(이불)에 맞으면 부위가 천 위로 뜬다. */
const NON_SKIN_MESH = /drape|sheet|blanket/i
/* 체표로 인정하지 않을 **본** — 몸통 옆으로 쏜 레이는 몸통보다 '몸 옆에 놓인 팔'을 먼저 맞는다.
   메시 이름으로는 거를 수 없다(팔도 셔츠 소매도 같은 스킨 메시/의복 메시의 일부다).
   그래서 맞은 삼각형의 지배 본 이름으로 판정한다. 이게 없으면 옆구리 마커가 맨 팔뚝에 찍히고
   lie→lie_knees에서 팔이 조금만 움직여도 마커가 14cm씩 튄다.
   다리도 같다 — 무릎을 세운 자세(lie_knees)에서 넓적다리가 아랫배 위를 가로질러, 배로 쏜 레이가
   허벅지를 먼저 맞는다(캡처: 네 마커가 무릎 위 허공에 떠 있었다). 진찰 부위 중 다리에 있는 것은
   하나도 없으므로 통째로 건너뛴다. 골반/척추(pelvis·spine)는 아랫배의 지배 본이라 넣지 말 것. */
const NON_TORSO_BONE = /(arm|hand|finger|thumb|wrist|elbow|clavicle|shoulder|metacarp|palm|thigh|shin|calf|knee|leg|foot|toe)/i

/** 레이가 맞은 삼각형에서 스킨 가중치가 가장 큰 본의 이름. 스킨드 메시가 아니면 null. */
function dominantBoneName(hit: THREE.Intersection): string | null {
  const mesh = hit.object as THREE.SkinnedMesh
  if (!mesh.isSkinnedMesh || !hit.face || !mesh.skeleton) return null
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  if (!skinIndex || !skinWeight) return null
  let bestWeight = -1
  let bestBone = -1
  for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) {
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(vertex, k)
      if (w > bestWeight) {
        bestWeight = w
        bestBone = skinIndex.getComponent(vertex, k)
      }
    }
  }
  return mesh.skeleton.bones[bestBone]?.name ?? null
}

/** 레이가 맞은 삼각형에서 '몸통이 아닌' 본(팔·다리)이 끌고 있는 스킨 가중치의 합(정점 평균).
 *  지배 본 **하나**만 보면 엉덩관절 근처를 놓친다 — 세운 넓적다리를 덮은 바지·피부는
 *  pelvis 0.55 / thigh 0.45 처럼 섞여 있어 argmax가 `pelvis`로 나오고 이름 필터를 그냥 통과한다.
 *  그 결과 무릎 세운 자세(lie_knees)에서 아랫배 마커가 무릎 위로 올라앉았다
 *  (캡처: mh_f60_ob rlq가 슬랙스 위 −0.99·halfWidth, mh_f20_thin rlq/llq가 +2.2~2.8·halfWidth).
 *  `pelvis`/`spine`은 아랫배의 정당한 지배 본이라 이름 필터에 넣을 수 없으므로,
 *  "다리 본이 이 삼각형을 얼마나 끌고 있는가"를 가중치로 재는 쪽이 옳다. */
function nonTorsoWeight(hit: THREE.Intersection): number {
  const mesh = hit.object as THREE.SkinnedMesh
  if (!mesh.isSkinnedMesh || !hit.face || !mesh.skeleton) return 0
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  if (!skinIndex || !skinWeight) return 0
  let sum = 0
  for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) {
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(vertex, k)
      if (w <= 0) continue
      const bone = mesh.skeleton.bones[skinIndex.getComponent(vertex, k)]
      if (bone && NON_TORSO_BONE.test(bone.name)) sum += w
    }
  }
  return sum / 3
}

const ANCHOR_CENTER = new THREE.Vector3()
const ANCHOR_PROBE = new THREE.Vector3()

/** 몸 속 중심점(ANCHOR_CENTER)을 실제 체표(스킨 메시)로 끌어올려 anchor에 쓴다.
 *  three의 SkinnedMesh.raycast는 본 변형을 반영하므로 눕히고 무릎 세운 실제 자세에 맞는다. */
/* 한 번의 레이 결과 — 맨살에 맞았는지, 옷에 맞았는지.
   cover = 통과해 온 '의료용 천'(모디스티 레이어/프라이버시 드레이프)의 가장 바깥면.
   있으면 최종 앵커를 그 위로 올려야 마커가 천 밑에 파묻히지 않는다. */
type SurfaceProbe = { skin: boolean; point: THREE.Vector3; cover: THREE.Vector3 | null; name: string }
const PROBE_POINT = new THREE.Vector3()
const PROBE_COVER = new THREE.Vector3()
const PROBE_DEPTH = new THREE.Vector3()
const FIRST_POINT = new THREE.Vector3()
const FIRST_COVER = new THREE.Vector3()
/* 슬라이드 탐색이 PROBE_* 를 덮어쓰므로, 첫 옷 히트는 여기 복사해 둔다. */
const FIRST_PROBE: SurfaceProbe = { skin: false, point: FIRST_POINT, cover: null, name: '' }

/** 이 지점의 옷 표면이 화면에 실제로 보이는가.
 *  진찰 중 걷어올린 옷은 '메시 숨김'이 아니라 **클리핑 평면**으로 잘려 있어서 레이캐스트에는
 *  그대로 맞는다. 렌더러와 같은 판정식(clipIntersection 포함)을 그대로 써서 "잘려 나가 안 보이는
 *  옷"과 "실제로 살을 가리고 있는 옷"을 구분한다. */
function garmentVisibleAt(mesh: THREE.Object3D, point: THREE.Vector3): boolean {
  const materials = Array.isArray((mesh as THREE.Mesh).material)
    ? (mesh as THREE.Mesh).material as THREE.Material[]
    : [(mesh as THREE.Mesh).material as THREE.Material]
  for (const material of materials) {
    const planes = material?.clippingPlanes
    if (!planes || planes.length === 0) return true
    if (material.clipIntersection) {
      // 모든 평면이 잘라낼 때만 제거된다 → 하나라도 살리는 평면이 있으면 보인다
      let allClip = true
      for (const plane of planes) {
        if (plane.distanceToPoint(point) >= 0) { allClip = false; break }
      }
      if (!allClip) return true
    } else {
      let clipped = false
      for (const plane of planes) {
        if (plane.distanceToPoint(point) < 0) { clipped = true; break }
      }
      if (!clipped) return true
    }
  }
  return false
}

/* 체표로 인정할 깊이 창(중심에서 normal 방향, m). null 이면 제한 없음.
   복부 4분면만 쓴다 — 다른 부위는 실측 대역이 없어 섣불리 자르면 멀쩡한 히트를 버린다. */
type DepthWindow = { min: number; max: number } | null

function probeSurface(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  root: THREE.Object3D,
  depth: DepthWindow = null,
): SurfaceProbe | null {
  RAY_ORIGIN.copy(center).addScaledVector(normal, ANATOMY.probeDist)
  RAY_DIR.copy(normal).negate()
  SURFACE_RAY.set(RAY_ORIGIN, RAY_DIR)
  SURFACE_RAY.near = 0
  SURFACE_RAY.far = ANATOMY.probeRange
  const hits = SURFACE_RAY.intersectObject(root, true)
  let cover: THREE.Vector3 | null = null
  for (const hit of hits) {
    /* three r150+ 의 Raycaster는 visible=false를 걸러 주지 않는다.
       벗겨 놓은(숨긴) 옷 메시가 그대로 맞아 부위가 공중에 뜨는 걸 막으려면 직접 확인해야 한다.
       ⚠ 이 검사는 아래 clinicalCloth 분기보다 **먼저** 와야 한다. 환자복 셸(medical_base_gown)은
       가운을 안 입힌 상태에서도 visible=false 로 씬에 남아 있고 raycast에는 그대로 맞는다.
       천 분기를 먼저 두면 그 숨은 셸이 cover 로 잡혀 settleAnchor가 앵커를 셸 표면(피부에서
       CLOTH.offset 1.7cm + 늘어짐)까지 밀어 올린다 — 가운도 드레이프도 없는 진찰에서
       아랫배 앵커가 전부 같은 깊이(0.1410)로 핀 박히는 것을 캡처 4종 교차로 확인했다. */
    let node: THREE.Object3D | null = hit.object
    let hidden = false
    while (node && node !== root) {
      if (!node.visible) { hidden = true; break }
      node = node.parent
    }
    if (hidden) continue
    /* 체표로 인정할 깊이 창. 레이는 normal 축을 따라가므로 히트의 (up,right) 좌표는 언제나 중심과
       같다 — 걸러낼 수 있는 자유도는 깊이 하나뿐이다. 두 가지를 동시에 막는다:
         · 세운 넓적다리를 덮은 **바지** — 지배 본이 pelvis/spine_01 이라 다리 본 가중치로 못 거른다.
         · 무릎 위로 **천막처럼** 뜬 드레이프 — cover 로 잡히면 settleAnchor 가 배 마커를 거기까지
           끌어올린다(실측: mh_f60_ob llq 2.86·halfWidth). 배 위에 실제로 얹힌 모디스티 밴드는
           창 안이라 §5.3 동작(천 위로 올리기)은 그대로 유지된다.
       대역 근거는 ANATOMY.quadrantDepth* 주석 참고. */
    if (depth) {
      const d = PROBE_DEPTH.subVectors(hit.point, center).dot(normal)
      if (d < depth.min || d > depth.max) continue
    }
    /* 의료용 모디스티 레이어·프라이버시 드레이프(RealisticPatient가 userData.clinicalCloth로 표시).
       진찰 내내 덮여 있는 천이라 여기서 멈추면 네 부위가 전부 '천을 피해' 미끄러지다 해부학적
       위치를 잃는다. 옷처럼 통과해 맨살 기준으로 자리를 잡되, 가장 바깥 천면을 기억해 뒀다가
       (hits는 거리순 — 첫 히트가 가장 바깥) 마커를 그 위로 올려 파묻힘을 막는다. */
    if (hit.object.userData.clinicalCloth === true) {
      // 걷어올려 잘려 나간 자락은 화면에 없다 — 옷과 같은 판정식으로 없는 셈 친다.
      if (!garmentVisibleAt(hit.object, hit.point)) continue
      if (!cover) cover = PROBE_COVER.copy(hit.point)
      continue
    }
    if (NON_SKIN_MESH.test(hit.object.name)) continue
    // 몸통이 아니라 몸 옆에 놓인 팔·세운 다리(또는 그 위의 소매)에 맞았으면 체표가 아니다.
    const bone = dominantBoneName(hit)
    if (nonTorsoWeight(hit) > ANATOMY.nonTorsoWeightMax) continue
    // 지배 본을 진단에 남긴다 — '왜 이 표면을 골랐나'를 좌표만으로는 못 가린다.
    const via = bone ? `#${bone}` : ''
    if (hit.object.userData.patientGarment) {
      // 잘려 나가 안 보이는 옷은 없는 셈 치고 계속 파고든다.
      if (!garmentVisibleAt(hit.object, hit.point)) continue
      // 보이는 옷이면 **여기가 체표**다. 예전처럼 옷을 뚫고 그 밑의 살을 잡으면
      // 청진기·손이 옷 속에 파묻히고(손가락만 삐져나온다), 마커도 천 밑에 박힌다.
      return { skin: false, point: PROBE_POINT.copy(hit.point), cover, name: `${hit.object.name}:${hit.object.userData.patientGarment}${via}` }
    }
    return { skin: true, point: PROBE_POINT.copy(hit.point), cover, name: `${hit.object.name}${via}` }
  }
  return null
}

/** 레이 결과를 앵커 위치로 확정한다. 모디스티 천을 통과해 잡은 맨살이면 그 천 바깥면 위로 올린다. */
function settleAnchor(anchor: ExamAnchor, probe: SurfaceProbe, normal: THREE.Vector3) {
  anchor.pos.copy(probe.point).addScaledVector(normal, ANATOMY.surfaceLift)
  anchor.surface = probe.name
  if (!probe.cover) return
  const above = probe.cover.dot(normal) + ANATOMY.surfaceLift - anchor.pos.dot(normal)
  if (above > 0) anchor.pos.addScaledVector(normal, above)
}

/** 몸 속 중심점(ANCHOR_CENTER)을 실제 체표(스킨 메시)로 끌어올려 anchor에 쓴다.
 *  three의 SkinnedMesh.raycast는 본 변형을 반영하므로 눕히고 무릎 세운 실제 자세에 맞는다.
 *
 *  slide/slideMax를 주면, 첫 레이가 **옷**에만 맞았을 때 그 방향으로 조금씩 옮겨 가며
 *  드러난 맨살을 찾는다. 복부 4분면이 걷어올린 상의 자락이나 바지 허리선 위에 얹히는 걸 막는 장치다
 *  (해부학 비율만으로 잡으면 마른 체형에서 하복부 2분면이 통째로 청바지 위에 올라간다). */
function liftToSkin(
  anchor: ExamAnchor,
  normal: THREE.Vector3,
  root: THREE.Object3D | null,
  slide?: THREE.Vector3,
  slideMax = 0,
  depth: DepthWindow = null,
): boolean {
  anchor.normal.copy(normal)
  anchor.skin = false
  anchor.surface = ''
  if (root) {
    const probed = probeSurface(ANCHOR_CENTER, normal, root, depth)
    if (probed?.skin) {
      settleAnchor(anchor, probed, normal)
      anchor.skin = true
      return true
    }
    // PROBE_POINT/PROBE_COVER는 아래 슬라이드 탐색이 덮어쓰므로 옷 히트는 따로 보관한다.
    if (probed) {
      FIRST_POINT.copy(probed.point)
      FIRST_PROBE.cover = probed.cover ? FIRST_COVER.copy(probed.cover) : null
      FIRST_PROBE.name = probed.name
    }
    if (slide && slideMax > 0) {
      const steps = 6
      for (let i = 1; i <= steps; i++) {
        ANCHOR_PROBE.copy(ANCHOR_CENTER).addScaledVector(slide, (slideMax * i) / steps)
        const shifted = probeSurface(ANCHOR_PROBE, normal, root, depth)
        if (shifted?.skin) {
          ANCHOR_CENTER.copy(ANCHOR_PROBE)
          settleAnchor(anchor, shifted, normal)
          anchor.skin = true
          return true
        }
      }
    }
    // 피부를 못 찾았으면(완전히 옷에 덮인 부위) 옷 표면이라도 쓴다 — 그 위에 대는 게 자연스럽다.
    if (probed) {
      settleAnchor(anchor, FIRST_PROBE, normal)
      return true
    }
  }
  // 레이가 빗나감(모델 미준비 등) — 본 중심에서 몸통 반폭만큼 밀어내 대충 체표 근처에 둔다.
  anchor.pos.copy(ANCHOR_CENTER).addScaledVector(normal, PATIENT_TORSO.halfWidth * ANATOMY.fallbackDepth)
  return false
}

const ANCHOR_NORMAL = new THREE.Vector3()
const ANCHOR_SLIDE = new THREE.Vector3()

/* ── 머리·목 본 찾기 (두경부/흉부 앵커용) ──
   RealisticPatient는 머리 본만 export한다(PATIENT_HEAD_WORLD). 눈·목 본은 여기서 직접 찾는다.
   본 이름 체계가 셋(MPFB `eye_l`/`neck_01`, Mixamo `LeftEye`/`Neck`, Rocketbox `Bip01 Neck`)이라
   정규화 후 패턴으로 잡는다. 스켈레톤 스캔은 아바타가 바뀔 때 한 번만 한다(매 프레임 traverse 금지). */
const NORM_BONE = (n: string) => n.toLowerCase().replace(/[_.\s:|]/g, '')
const EYE_BONE_RE = /^(?:bip01)?(?:eye[lr]|[lr]eye|lefteye|righteye)$/
const NECK_BONE_RE = /^(?:bip01)?neck0?1?$/
const HEAD_BONE_RE = /^(?:bip01)?head$/
const CLAVICLE_BONE_RE = /^(?:bip01)?(?:clavicle[lr]|[lr]clavicle|(?:left|right)shoulder)$/
type HeadBones = {
  eyes: THREE.Object3D[]
  neck: THREE.Object3D | null
  head: THREE.Object3D | null
  clavicles: THREE.Object3D[]
}
const HEAD_BONE_CACHE: { root: THREE.Object3D | null; found: HeadBones } =
  { root: null, found: { eyes: [], neck: null, head: null, clavicles: [] } }

function findHeadBones(root: THREE.Object3D): HeadBones {
  /* ⚠ 머리 본을 찾기 전까지는 캐시를 신뢰하지 않는다.
     진찰 진입 첫 프레임의 루트 그룹은 아직 비어 있어서(GLB 파싱 전) 한 번 캐시하면
     영영 "본이 없다"로 굳는다 — 그러면 두경부·흉부 앵커가 통째로 폴백으로 떨어진다. */
  if (HEAD_BONE_CACHE.root === root && HEAD_BONE_CACHE.found.head) return HEAD_BONE_CACHE.found
  const eyes: THREE.Object3D[] = []
  const clavicles: THREE.Object3D[] = []
  let neck: THREE.Object3D | null = null
  let head: THREE.Object3D | null = null
  root.traverse((o) => {
    if (!o.name) return
    const n = NORM_BONE(o.name)
    if (eyes.length < 2 && EYE_BONE_RE.test(n)) eyes.push(o)
    else if (!neck && NECK_BONE_RE.test(n)) neck = o
    else if (!head && HEAD_BONE_RE.test(n)) head = o
    else if (clavicles.length < 2 && CLAVICLE_BONE_RE.test(n)) clavicles.push(o)
  })
  HEAD_BONE_CACHE.root = root
  HEAD_BONE_CACHE.found = { eyes, neck, head, clavicles }
  return HEAD_BONE_CACHE.found
}

/* ── 얼굴 랜드마크 (눈·치아·혀 메시에서 실측) ──────────────────────────────────
   MPFB 골격에는 **눈 본이 없다**(본은 pelvis~head + 팔다리뿐). 그래서 머리 본에서 비율로
   잡으면 마커가 이마에 찍힌다(실측: 5cm 위). 대신 아바타 안에 있는 실제 눈/치아/혀 메시의
   지오메트리 상자를 재서 쓴다 — 아바타마다 얼굴이 달라도 자동으로 맞는다.

   좌표계: 스킨 메시의 지오메트리는 **바인드 포즈 모델 공간**이다. 진찰 자세(앉기/눕기)는 본이
   움직인 결과라 지오메트리 좌표를 그대로 쓸 수 없다. RealisticPatient가 시각 소견 메시를
   붙이는 방식과 똑같이 — 머리 본의 **현재 월드 위치** + (모델 공간 오프셋을 모델 루트의
   회전/스케일로 돌린 것) — 으로 옮긴다. 머리를 갸웃하는 정도의 회전은 무시된다(원본도 동일). */
type FaceLandmarks = {
  valid: boolean
  headBind: THREE.Vector3   // 모델 공간에서의 머리 본 바인드 위치
  eyeA: THREE.Vector3       // 모델 공간 (좌우는 나중에 PATIENT_TORSO.right로 판정)
  eyeB: THREE.Vector3
  eyeRadius: number
  mouth: THREE.Vector3      // 치아/혀 상자에서 잡은 입 중심
  chinY: number             // 모델 공간 y — 갑상샘 높이의 기준선
  toWorld: THREE.Matrix3    // 모델 공간 방향 → 월드 방향 (회전+스케일)
}
const FACE_CACHE: { root: THREE.Object3D | null; found: FaceLandmarks } = {
  root: null,
  found: {
    valid: false,
    headBind: new THREE.Vector3(),
    eyeA: new THREE.Vector3(),
    eyeB: new THREE.Vector3(),
    eyeRadius: 0.012,
    mouth: new THREE.Vector3(),
    chinY: 0,
    toWorld: new THREE.Matrix3(),
  },
}
/** 메시 이름/재질 이름으로 부위를 가른다 — RealisticPatient의 materialKind와 같은 기준. */
function meshIsKind(mesh: THREE.Mesh, kind: 'eye' | 'teeth' | 'tongue'): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const id = `${mesh.name} ${materials.map((m) => m?.name ?? '').join(' ')}`.toLowerCase()
  if (kind === 'eye') return id.includes('high-poly') || id.includes('brown_eye') || /h_[lr]_eye/.test(id)
  if (kind === 'teeth') return id.includes('teeth')
  return id.includes('tongue')
}

const GEO_BOX = new THREE.Box3()
const GEO_SIZE = new THREE.Vector3()

function findFaceLandmarks(root: THREE.Object3D): FaceLandmarks {
  if (FACE_CACHE.root === root && FACE_CACHE.found.valid) return FACE_CACHE.found
  const found = FACE_CACHE.found
  FACE_CACHE.root = root
  found.valid = false
  const bones = findHeadBones(root)
  const head = bones.head
  if (!head) return found

  let eyeMesh: THREE.Mesh | null = null
  const mouthBox = new THREE.Box3()
  let skin: THREE.SkinnedMesh | null = null
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh && !skin) skin = mesh as THREE.SkinnedMesh
    if (!eyeMesh && meshIsKind(mesh, 'eye')) eyeMesh = mesh
    if (meshIsKind(mesh, 'teeth') || meshIsKind(mesh, 'tongue')) {
      mesh.geometry.computeBoundingBox()
      if (mesh.geometry.boundingBox) mouthBox.union(mesh.geometry.boundingBox)
    }
  })
  const eye = eyeMesh as THREE.Mesh | null
  if (!eye || mouthBox.isEmpty()) return found

  /* 머리 본의 바인드(정지) 위치 = 역바인드 행렬의 역행렬 이동성분.
     스킨 메시를 못 찾았으면 본의 현재 위치를 그대로 쓴다(첫 프레임 폴백). */
  const skinned = skin as THREE.SkinnedMesh | null
  const headIndex = skinned ? skinned.skeleton.bones.indexOf(head as THREE.Bone) : -1
  if (skinned && headIndex >= 0) {
    const inv = skinned.skeleton.boneInverses[headIndex]
    found.headBind.setFromMatrixPosition(new THREE.Matrix4().copy(inv).invert())
  } else {
    head.getWorldPosition(found.headBind)
  }

  eye.geometry.computeBoundingBox()
  GEO_BOX.copy(eye.geometry.boundingBox!)
  GEO_BOX.getSize(GEO_SIZE)
  GEO_BOX.getCenter(found.eyeA)
  found.eyeB.copy(found.eyeA)
  // 두 눈이 한 메시라 상자 폭 = 좌우 안구 바깥 끝 사이. 안구 지름 ≈ 상자 높이.
  found.eyeRadius = Math.max(0.006, GEO_SIZE.y * 0.5)
  const halfGap = Math.max(0.012, GEO_SIZE.x * 0.5 - found.eyeRadius)
  found.eyeA.x += halfGap
  found.eyeB.x -= halfGap

  mouthBox.getCenter(found.mouth)
  // 턱 끝 — RealisticPatient가 갑상샘 융기를 놓을 때 쓰는 기준선과 같다(치아 상자 아래 1.4cm).
  found.chinY = mouthBox.min.y - 0.014

  const src = skinned ?? (eye as THREE.Object3D)
  src.updateWorldMatrix(true, false)
  found.toWorld.setFromMatrix4(src.matrixWorld)
  found.valid = true
  return found
}

const FACE_OFFSET = new THREE.Vector3()
/** 모델(바인드) 공간의 얼굴 좌표를 현재 머리 본 위치 기준 월드 좌표로 옮긴다. */
function faceToWorld(face: FaceLandmarks, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  FACE_OFFSET.subVectors(local, face.headBind).applyMatrix3(face.toWorld)
  return out.copy(HEAD_WORLD).add(FACE_OFFSET)
}

const EYE_A = new THREE.Vector3()
const EYE_B = new THREE.Vector3()
const NECK_POS = new THREE.Vector3()
const SUPRA = new THREE.Vector3()
const HEAD_TO_NECK = new THREE.Vector3()
const CHIN_TO_NECK = new THREE.Vector3()
const CHIN_POS = new THREE.Vector3()
const THYROID_LOCAL = new THREE.Vector3()
const CLAV_A = new THREE.Vector3()
const CLAV_B = new THREE.Vector3()
const CHEST_SPAN = new THREE.Vector3()

/* 머리 본의 **실측** 월드좌표. RealisticPatient가 export하는 PATIENT_HEAD_WORLD는
   `embedded`(= MPFB/VALID = 현재 아바타 풀의 대부분) 아바타에서 갱신되지 않고 초기 상수에 머문다.
   그 상수가 의자 좌석 위치와 우연히 맞아 문진·두경부에선 티가 안 났지만, 진찰대(x≈1.95)로 옮기면
   2.9 m 어긋난다 — 흉부 앵커가 통째로 빈 의자 위에 생긴다.
   RealisticPatient는 우리 소유가 아니므로 여기서 머리 본을 직접 찾아 매 프레임 갱신하고,
   못 찾은 리그에서만 기존 값으로 폴백한다. */
const HEAD_WORLD = new THREE.Vector3().copy(PATIENT_HEAD_WORLD)

function updateHeadWorld(root: THREE.Object3D | null): void {
  const bone = root ? findHeadBones(root).head : null
  if (bone) bone.getWorldPosition(HEAD_WORLD)
  else HEAD_WORLD.copy(PATIENT_HEAD_WORLD)
}

/** 목 본의 월드좌표. 못 찾으면 머리 본에서 몸통축을 따라 근사한다. */
function neckWorld(root: THREE.Object3D | null, out: THREE.Vector3): THREE.Vector3 {
  const bone = root ? findHeadBones(root).neck : null
  if (bone) return bone.getWorldPosition(out)
  return out.copy(HEAD_WORLD).addScaledVector(PATIENT_TORSO.up, -0.095)
}

/* ── 두경부 앵커 (headneck 스펙 §4) — 기준은 PATIENT_HEAD_WORLD와 눈·목 본 ── */
function buildHeadNeckAnchors(root: THREE.Object3D | null, regions: readonly ExamRegion[]): boolean {
  const { up, right, front, halfWidth } = PATIENT_TORSO
  const head = HEAD_WORLD
  // 아바타 크기 보정 — 기준 몸통 반폭 0.16 m(성인 표준)에 대한 비율. 소아·비만도 눈 간격이 따라간다.
  const scale = THREE.MathUtils.clamp(halfWidth / 0.16, 0.8, 1.25)
  let ok = false

  const face = root ? findFaceLandmarks(root) : null
  const wantEye = regions.includes('eye_r') || regions.includes('eye_l')
  if (wantEye) {
    const eyes = root ? findHeadBones(root).eyes : []
    if (eyes.length === 2) {
      // 눈 본이 있는 리그(Mixamo/VALID 등)는 본이 가장 정확하다.
      eyes[0].getWorldPosition(EYE_A)
      eyes[1].getWorldPosition(EYE_B)
    } else if (face?.valid) {
      // MPFB 골격에는 눈 본이 없다 — 실제 안구 메시(high-poly)의 상자에서 잰다.
      faceToWorld(face, face.eyeA, EYE_A)
      faceToWorld(face, face.eyeB, EYE_B)
    } else {
      // 눈 본도 눈 메시도 없는 리그 — 머리 본에서 비율로 근사한다(스펙 §4의 폴백식).
      EYE_A.copy(head).addScaledVector(up, ANATOMY.eyeUpFromHead * scale)
        .addScaledVector(right, ANATOMY.eyeHalfGap * scale)
      EYE_B.copy(head).addScaledVector(up, ANATOMY.eyeUpFromHead * scale)
        .addScaledVector(right, -ANATOMY.eyeHalfGap * scale)
    }
    /* ⚠ 좌우는 본/메시 **이름**이 아니라 PATIENT_TORSO.right(넓적다리 본에서 유도한 환자 오른쪽)로
       정한다. 리그마다 eye_l/eye_r 표기가 뒤집히는 사례가 있어서, 복부·CVA와 같은 기준으로 통일한다. */
    const midDot = (EYE_A.dot(right) + EYE_B.dot(right)) * 0.5
    const rightEye = EYE_A.dot(right) > midDot ? EYE_A : EYE_B
    const leftEye = rightEye === EYE_A ? EYE_B : EYE_A
    // 안구 반지름을 알면 클릭 구도 눈 크기에 맞춘다(눈 두 개가 겹치면 좌우 구분이 무의미해진다).
    const eyeR = face?.valid
      ? THREE.MathUtils.clamp(face.eyeRadius * 1.9, 0.014, EYE_A.distanceTo(EYE_B) * 0.45)
      : ANATOMY.eyeRadius * scale
    for (const [region, src] of [['eye_r', rightEye], ['eye_l', leftEye]] as const) {
      const anchor = ANCHOR_POOL[region]
      // 눈은 레이캐스트하지 않는다 — 앞머리·눈썹·속눈썹에 먼저 맞아 마커가 이마로 튄다.
      // 안구 중심에서 각막 표면까지 밀어내는 것이 해부학적으로 정확하다.
      anchor.pos.copy(src).addScaledVector(front, (face?.valid ? face.eyeRadius : ANATOMY.eyeFrontLift * scale))
      anchor.normal.copy(front)
      anchor.radius = eyeR
      anchor.skin = true
    }
    ok = true
  }

  if (regions.includes('thyroid_r') || regions.includes('thyroid_l')) {
    neckWorld(root, NECK_POS)
    /* 갑상샘 높이는 턱끝→흉골상절흔의 앞목 기준선에서 잡는다. neck 본은 C7(목 뒤)에 있어
       앞목 아래 경계가 아니며, 그 본을 기준으로 한 종전 손은 환자의 턱밑을 만졌다.
       좌우 쇄골 본 중점이 흉골상절흔의 가장 안정적인 리그 랜드마크다. */
    let goiterHeight: number
    if (face?.valid) {
      faceToWorld(face, THYROID_LOCAL.set(face.mouth.x, face.chinY, face.mouth.z), CHIN_POS)
      const clavicles = root ? findHeadBones(root).clavicles : []
      if (clavicles.length === 2) {
        clavicles[0].getWorldPosition(CLAV_A)
        clavicles[1].getWorldPosition(CLAV_B)
        SUPRA.addVectors(CLAV_A, CLAV_B).multiplyScalar(0.5)
      } else {
        SUPRA.copy(NECK_POS).addScaledVector(up, -0.025)
      }
      const throatSpan = THREE.MathUtils.clamp(CHIN_TO_NECK.subVectors(CHIN_POS, SUPRA).dot(up), 0.065, 0.16)
      // 반지연골 아래~제5기관륜: 턱보다 흉골상절흔 쪽에 가까운 앞목 아래 2/3 지점.
      goiterHeight = CHIN_POS.dot(up) - throatSpan * 0.66 - NECK_POS.dot(up)
    } else {
      const neckToHead = Math.max(0.05, HEAD_TO_NECK.subVectors(HEAD_WORLD, NECK_POS).dot(up))
      goiterHeight = neckToHead * ANATOMY.thyroidHeightRatio - 0.025 * scale
    }
    for (const region of ['thyroid_r', 'thyroid_l'] as const) {
      const side = region === 'thyroid_r' ? 1 : -1
      ANCHOR_CENTER.copy(NECK_POS)
        .addScaledVector(up, goiterHeight)
        .addScaledVector(right, side * ANATOMY.thyroidHalfGap * scale)
      const anchor = ANCHOR_POOL[region]
      anchor.radius = ANATOMY.thyroidRadius * scale
      // 목 앞면으로 끌어올린다. 옷깃에 맞으면 그 위가 체표다(그 위에서 만지는 그림이 맞다).
      if (liftToSkin(anchor, front, root)) ok = true
    }
  }

  if (regions.includes('oral_tongue') || regions.includes('oral_pharynx')) {
    // 입은 체표가 아니라 '구멍'이라 레이캐스트하지 않는다 — 쏘면 입술/턱 피부에 맞아 밖으로 나온다.
    /* ⚠ face.mouth는 MPFB 지오메트리 좌표인데 일부 Rocketbox 아바타에서는
       faceToWorld 변환 후 입이 복부 높이로 떨어졌다(지은: head y=1.062, mouth y=0.304).
       구강 도구·카메라가 환자 몸 안으로 들어가는 치명적 오차라, 리그간
       의미가 공통인 머리 본과 몸통 축으로 입 중심을 정한다. */
    ANCHOR_CENTER.copy(head)
      .addScaledVector(up, -ANATOMY.mouthDownFromHead * scale)
      .addScaledVector(front, 0.006 * scale)
    const tongue = ANCHOR_POOL.oral_tongue
    tongue.pos.copy(ANCHOR_CENTER).addScaledVector(front, ANATOMY.oralTongueFront * scale)
    tongue.normal.copy(front)
    tongue.radius = ANATOMY.oralRadius * scale
    tongue.skin = true
    const pharynx = ANCHOR_POOL.oral_pharynx
    pharynx.pos.copy(tongue.pos).addScaledVector(front, -ANATOMY.oralPharynxBack * scale)
    pharynx.normal.copy(front)
    pharynx.radius = ANATOMY.oralRadius * scale
    pharynx.skin = true
    ok = true
  }
  return ok
}

/* ── 흉부 앵커 (chest 스펙 §3) — 복장뼈 위끝~칼돌기 사이를 갈비사이 비율로 나눈다 ── */
function buildChestAnchors(root: THREE.Object3D | null, regions: readonly ExamRegion[]): boolean {
  const { xiphoid, up, right, front, halfWidth } = PATIENT_TORSO
  /* 복장뼈 위끝(목아래패임)은 본이 따로 없다. **빗장뼈 본 두 개의 중점**이 곧 복장빗장관절이라
     해부학적으로 목아래패임과 같은 높이다 — 이게 목 본(C7, 뒤·위)보다 훨씬 정확하다.
     빗장뼈가 없는 리그에서만 목 본에서 몸통축을 따라 내려 근사한다. */
  const clavicles = root ? findHeadBones(root).clavicles : []
  const torsoLen = PATIENT_TORSO.pubis.distanceTo(xiphoid)
  if (clavicles.length === 2) {
    clavicles[0].getWorldPosition(CLAV_A)
    clavicles[1].getWorldPosition(CLAV_B)
    SUPRA.addVectors(CLAV_A, CLAV_B).multiplyScalar(0.5)
  } else {
    neckWorld(root, NECK_POS)
    SUPRA.copy(NECK_POS).addScaledVector(up, -torsoLen * ANATOMY.suprasternalDrop)
  }
  const chestLen = CHEST_SPAN.subVectors(SUPRA, xiphoid).dot(up)
  if (chestLen < 0.05) return false // 본을 못 찾았거나 아직 바인드포즈 — 다음 프레임 재시도
  let ok = false

  // 심장 4판막 — 오른쪽 2번째 갈비사이(대동맥판) / 왼쪽 2번째(폐동맥판) / 왼쪽 5번째(삼첨판) / 심첨(승모판)
  const valves: [ExamRegion, number, number][] = [
    ['aortic', ANATOMY.ics2Ratio, ANATOMY.aorticLateral],
    ['pulmonic', ANATOMY.ics2Ratio, -ANATOMY.pulmonicLateral],
    ['tricuspid', ANATOMY.ics5Ratio, -ANATOMY.tricuspidLateral],
    ['mitral', ANATOMY.ics5Ratio, -ANATOMY.mitralLateral],
  ]
  for (const [region, axial, lateral] of valves) {
    if (!regions.includes(region)) continue
    ANCHOR_CENTER.copy(SUPRA)
      .addScaledVector(up, -chestLen * axial)
      .addScaledVector(right, halfWidth * lateral)
    const anchor = ANCHOR_POOL[region]
    anchor.radius = ANATOMY.valveRadius
    if (liftToSkin(anchor, front, root)) ok = true
  }

  // 폐야 — 좌우 각각 상/중/하. 전면은 배 쪽(front), 후면은 등 쪽(-front)에서 쏜다.
  const levelIndex: Record<string, number> = { up: 0, mid: 1, low: 2 }
  for (const region of [...ANT_LUNG, ...POST_LUNG]) {
    if (!regions.includes(region)) continue
    const [, face, side, level] = region.split('_') as [string, 'ant' | 'post', 'r' | 'l', string]
    const back = face === 'post'
    const sign = side === 'r' ? 1 : -1
    const ratios = back ? ANATOMY.lungPostRatios : ANATOMY.lungAntRatios
    const lateral = back ? ANATOMY.lungPostLateral : ANATOMY.lungAntLateral
    ANCHOR_CENTER.copy(SUPRA)
      .addScaledVector(up, -chestLen * ratios[levelIndex[level] ?? 1])
      .addScaledVector(right, sign * halfWidth * lateral)
    if (back) ANCHOR_CENTER.addScaledVector(front, -halfWidth * ANATOMY.lungBackDepth)
    ANCHOR_NORMAL.copy(front)
    if (back) ANCHOR_NORMAL.negate()
    const anchor = ANCHOR_POOL[region]
    anchor.radius = ANATOMY.lungRadius
    if (liftToSkin(anchor, ANCHOR_NORMAL, root)) ok = true
  }
  return ok
}

/** PATIENT_TORSO(본 프레임)에서 이번 자세의 진찰 부위를 계산해 ANCHOR_POOL에 쓴다.
 *  반환값은 "본도 있고 체표 레이캐스트도 맞았다"는 뜻 — 즉 이 프레임 결과를 확정해도 되는가다.
 *  false면 아직 모델이 준비 중이니 호출측이 다음 프레임에 다시 부른다. */
function buildExamAnchors(
  pose: ExamPose,
  root: THREE.Object3D | null,
  regions: readonly ExamRegion[],
): boolean {
  if (!PATIENT_TORSO.valid) return false
  const { pubis, xiphoid, up, right, front, halfWidth } = PATIENT_TORSO
  const torsoLen = pubis.distanceTo(xiphoid)
  if (torsoLen < 0.05) return false // 아직 바인드포즈에 겹쳐 있는 상태 — 다음 프레임에 재시도
  /* 반경도 체형 비례(부록 §2.5 표: 복부 4분면 = halfWidth * 0.42). 겹치면 클릭이 엉뚱한 부위로
     들어가 좌우 소견이 뒤바뀐다.
     ⚠ 하한 0.055 / 상한 0.105는 표를 무력화하고 있었다. mh_f20_thin은 halfWidth 0.105라
     표대로면 0.044인데 하한에 걸려 0.055로 부풀려졌고, 그게 상·하 사분면이 겹친 직접 원인이다.
     클릭 가능한 최소 크기(화면상 반지름 ≈30px)만 남기고 하한을 내린다. */
  const quadrantR = THREE.MathUtils.clamp(halfWidth * 0.42, 0.042, 0.075)
  const flankR = THREE.MathUtils.clamp(halfWidth * 0.5, 0.06, 0.11)
  let anySkinHit = false

  if (regions.some((r) => (HEADNECK_REGIONS as readonly string[]).includes(r))) {
    if (buildHeadNeckAnchors(root, regions)) anySkinHit = true
  }
  if (regions.some((r) => (CHEST_REGIONS as readonly string[]).includes(r))) {
    if (buildChestAnchors(root, regions)) anySkinHit = true
  }

  const wantFlank = regions.includes('flank_r') || regions.includes('flank_l')
  if (pose === 'sit_edge') {
    if (wantFlank) {
      // 갈비척추각은 등 쪽, 12번 갈비뼈 아래, 척추 양옆. 걸터앉은 환자는 등이 의사를 향한다.
      // 바깥 법선이 배(front)의 반대라 레이도 등 뒤에서 쏴야 한다. front로 쏘면 배 피부에 먼저 맞는다.
      ANCHOR_NORMAL.copy(front).negate()
      for (const region of ['flank_r', 'flank_l'] as const) {
        const side = region === 'flank_r' ? 1 : -1
        ANCHOR_CENTER.copy(pubis)
          .addScaledVector(up, torsoLen * ANATOMY.cvaHeightRatio)
          .addScaledVector(right, side * halfWidth * ANATOMY.cvaLateralRatio)
          .addScaledVector(front, -halfWidth * ANATOMY.cvaDepthRatio)
        const anchor = ANCHOR_POOL[region]
        anchor.radius = flankR
        if (liftToSkin(anchor, ANCHOR_NORMAL, root)) anySkinHit = true
      }
    }
    return anySkinHit
  }
  if (pose === 'sit') return anySkinHit

  // 상/하 오프셋이 다르다 — 위 ANATOMY 주석 참고 (배꼽이 기준선 중앙이 아니다)
  const axialGapUp = torsoLen * ANATOMY.axialGapUpRatio
  const axialGapDown = torsoLen * ANATOMY.axialGapDownRatio
  const lateralGap = halfWidth * ANATOMY.lateralGapRatio
  // ruq=상+오른쪽, luq=상+왼쪽, rlq=하+오른쪽, llq=하+왼쪽.
  // 좌우는 PATIENT_TORSO.right(넓적다리 본에서 유도)라 라벨과 자동으로 일치한다 — 손으로 뒤집지 말 것.
  const quads: [ExamRegion, number, number][] = [
    ['ruq', 1, 1], ['luq', 1, -1], ['rlq', -1, 1], ['llq', -1, -1],
  ]
  /* 옷에 가렸으면 배꼽 쪽으로 미끄러뜨려 드러난 맨살을 찾는다(상복부는 아래로, 하복부는 위로).
     ⚠ 노출 창(걷어올린 상의 밑단 ~ 접어 내린 바지 허리선)은 마른 체형에서 15cm 남짓인데
     본 기준 몸통 길이(pelvis↔spine_03)는 22cm라, 비율만으로는 하복부가 바지 위에 얹힌다.
     상한은 '끝까지 미끄러져도 상·하 구가 안 닿는' 거리다 — 예전의 축간격 0.9배는 네 마커를
     배꼽 한 점으로 모아 버려 사분면 구분을 없앴다(겹치면 클릭이 엉뚱한 부위로 들어간다). */
  // 상/하 오프셋이 달라졌으니 **작은 쪽(하복부)** 을 기준으로 잡는다 — 큰 쪽으로 잡으면
  // 하복부가 배꼽을 넘어 미끄러져 상복부 구와 겹친다.
  const slideMax = Math.max(0, Math.min(axialGapUp, axialGapDown) - quadrantR * 1.15)
  /* 세운 넓적다리가 아랫배 위를 가로지르면 배로 쏜 레이가 그것부터 맞는다. 본 이름·가중치로는
     못 거르므로(바지 정점의 지배 본이 pelvis/spine_01 이다) 체표로 인정할 깊이 창을 준다. */
  const quadrantDepth: DepthWindow = {
    min: halfWidth * ANATOMY.quadrantDepthMin,
    max: halfWidth * ANATOMY.quadrantDepthMax,
  }
  for (const [region, axial, lateral] of quads) {
    if (!regions.includes(region)) continue
    ANCHOR_CENTER.copy(pubis)
      .addScaledVector(
        up,
        torsoLen * ANATOMY.umbilicusRatio + (axial > 0 ? axialGapUp : -axialGapDown), // 배꼽 기준 상/하
      )
      .addScaledVector(right, lateral * lateralGap)
    ANCHOR_SLIDE.copy(up).multiplyScalar(-axial) // 배꼽을 향하는 방향
    const anchor = ANCHOR_POOL[region]
    anchor.radius = quadrantR
    if (liftToSkin(anchor, front, root, ANCHOR_SLIDE, slideMax, quadrantDepth)) anySkinHit = true
  }
  // 누운 자세의 옆구리는 폴백이다(실제 CVA는 sit_edge에서 등을 두드린다).
  // 등은 침대에 눌려 손이 못 들어가므로 몸통 '옆면'을 잡고, 바깥 법선도 좌우축(±right)으로 둔다.
  // 높이는 CVA(0.95=갈비뼈)가 아니라 옆구리 중간이다 — 0.95로 두면 마커가 겨드랑이/갈비까지 올라간다.
  if (wantFlank) {
    for (const region of ['flank_r', 'flank_l'] as const) {
      const side = region === 'flank_r' ? 1 : -1
      ANCHOR_NORMAL.copy(right).multiplyScalar(side)
      ANCHOR_CENTER.copy(pubis)
        .addScaledVector(up, torsoLen * ANATOMY.supineFlankHeightRatio)
        .addScaledVector(right, side * halfWidth * ANATOMY.supineFlankRatio)
      const anchor = ANCHOR_POOL[region]
      anchor.radius = flankR
      if (liftToSkin(anchor, ANCHOR_NORMAL, root)) anySkinHit = true
    }
  }
  return anySkinHit
}

/** 본을 못 찾았을 때만 쓰는 고정 좌표 폴백 — 기존 EXAM 상수 그대로 풀에 채운다.
 *  두경부·흉부는 고정 좌표 폴백이 없다(머리 크기·목 길이가 아바타마다 달라 의미가 없다).
 *  대신 반지름 0으로 두어 계산 전에는 클릭되지 않게 한다. */
/* 앵커가 **본에서 유도된 값으로 한 번이라도 계산됐는가.**
   진찰 진입/도구 전환 직후 약 1.5초 동안은 아바타 GLB 가 아직 로딩·감쇠 중이라
   ANCHOR_POOL 이 고정 폴백 좌표를 들고 있다. 그 값은 화면 밖(ndc.y≈1.10)이거나
   **빈 침대 위**에 떠서(실측: settle/fresh_t1000.png — 환자가 없는 침대 위에 4분면 마커) 두 가지로 샌다:
     · 사용자에게 보이는 글리치 (examdebug 가 아니어도 진행 디스크는 그려진다)
     · 그 창에 클릭하면 **엉뚱한 좌표가 그 부위로 기록된다** (히트 메시가 살아 있다)
   그래서 정착 전에는 부위 그룹을 통째로 숨긴다 — three 레이캐스트는 invisible 을 건너뛰므로
   클릭까지 같이 막힌다. `__examAnchors.settled` 로 자동화도 같은 기준을 볼 수 있다. */
const ANCHOR_SETTLE = { ok: false }

function resetAnchorPool(pose: ExamPose) {
  for (const region of [...HEADNECK_REGIONS, ...CHEST_REGIONS]) {
    ANCHOR_POOL[region].radius = 0
    ANCHOR_POOL[region].skin = false
  }
  if (pose === 'sit') return
  if (pose === 'sit_edge') {
    for (const region of ['flank_r', 'flank_l'] as const) {
      const anchor = ANCHOR_POOL[region]
      anchor.pos.fromArray(EXAM.sitEdge.flanks[region])
      anchor.normal.set(0, 0, 1) // 등이 의사(+z)를 향한다
      anchor.radius = EXAM.flankR
    }
    return
  }
  for (const q of EXAM.quadrants) {
    const anchor = ANCHOR_POOL[q.region as ExamRegion]
    anchor.pos.fromArray(q.pos)
    anchor.normal.set(0, 1, 0) // 앙와위 배는 천장을 본다
    anchor.radius = EXAM.quadrantR
  }
  for (const f of EXAM.flanks) {
    const anchor = ANCHOR_POOL[f.region as ExamRegion]
    anchor.pos.fromArray(f.pos)
    // z=-3.3이 환자의 오른쪽(+z), -3.72가 왼쪽(-z)
    anchor.normal.set(0, 0, f.region === 'flank_r' ? 1 : -1)
    anchor.radius = EXAM.flankR
  }
}

/* 자동 시각 회귀용.
   - DEV면 항상 부위 좌표를 window.__examAnchors 로 내보낸다(좌우 검산 + 스크립트가 호버할 좌표).
   - 여기에 더해 ?examdebug=1 이면 평소 투명한 클릭 구를 부위별 색으로 칠해 눈에 보이게 한다. */
const EXAM_ANCHOR_DUMP = import.meta.env.DEV
const EXAM_DEBUG = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('examdebug') === '1'
const DEBUG_REGION_COLOR: Record<string, string> = {
  ruq: '#ff5a5a', luq: '#5aa0ff', rlq: '#ffb45a', llq: '#5affa0',
  flank_r: '#ff5aff', flank_l: '#ffff5a',
  // 두경부 — 환자 오른쪽은 따뜻한 색, 왼쪽은 찬 색으로 통일해 좌우 검산을 눈으로 하기 쉽게.
  eye_r: '#ff5a5a', eye_l: '#5aa0ff',
  thyroid_r: '#ff9a3c', thyroid_l: '#3cc8ff',
  oral_tongue: '#ff5aff', oral_pharynx: '#ffff5a',
  // 흉부 — 심장 4판막
  aortic: '#ff5a5a', pulmonic: '#5aa0ff', tricuspid: '#5affa0', mitral: '#ff5aff',
  // 폐야 — 오른쪽 계열 붉은색 / 왼쪽 계열 푸른색, 상→하로 밝기 감소
  lung_ant_r_up: '#ff8a8a', lung_ant_r_mid: '#ff5a5a', lung_ant_r_low: '#c03030',
  lung_ant_l_up: '#8ac0ff', lung_ant_l_mid: '#5aa0ff', lung_ant_l_low: '#3060c0',
  lung_post_r_up: '#ffc08a', lung_post_r_mid: '#ff9a3c', lung_post_r_low: '#c06a10',
  lung_post_l_up: '#8affd0', lung_post_l_mid: '#3cffb0', lung_post_l_low: '#10a070',
}

/* 부위 그룹 정렬용 임시값 — 매 프레임 새로 만들지 않는다. */
const ORIENT_X = new THREE.Vector3()
const ORIENT_Z = new THREE.Vector3()
const ORIENT_M = new THREE.Matrix4()
const ORIENT_UP = new THREE.Vector3(0, 1, 0)

/** 부위 그룹을 "로컬 +Y = 체표 법선, 로컬 +Z = 카메라(의사) 쪽"으로 세운다.
 *  이렇게 해야 청진기 다이어프램과 손바닥이 자세와 무관하게 피부에 수직으로 닿고,
 *  팔은 항상 의사 쪽에서 뻗어 들어온다. 누운 자세(법선=+y)에선 예전 축정렬과 거의 같다. */
function orientToSurface(
  group: THREE.Object3D,
  worldPos: THREE.Vector3,
  normal: THREE.Vector3,
  cameraPos: THREE.Vector3,
) {
  ORIENT_Z.subVectors(cameraPos, worldPos)
  ORIENT_Z.addScaledVector(normal, -ORIENT_Z.dot(normal)) // 접평면으로 투영
  if (ORIENT_Z.lengthSq() < 1e-8) ORIENT_Z.copy(ORIENT_UP).addScaledVector(normal, -ORIENT_UP.dot(normal))
  ORIENT_Z.normalize()
  ORIENT_X.crossVectors(normal, ORIENT_Z) // x = y × z (오른손 좌표계)
  ORIENT_M.makeBasis(ORIENT_X, normal, ORIENT_Z)
  group.quaternion.setFromRotationMatrix(ORIENT_M)
}

function RegionMesh({ anchor }: { anchor: ExamAnchor }) {
  const region = anchor.region
  const examTool = useGame((s) => s.examTool)
  const examPass = useGame((s) => s.examPass)
  const examRegion = useGame((s) => s.examRegion)
  // 이 도구로 이 부위를 찍을 수 있는가 (§1.2). 도구↔부위 매칭은 store의 TOOL_REGIONS가 단일 진실.
  const active = !!examTool && TOOL_REGIONS[examTool].includes(region)
  // 이번 항목에서 이미 찍은 (pass, region)인가. 셀렉터 안에서 키를 만들어 boolean만 반환해야
  // 매 렌더 새 객체를 돌려주지 않아 zustand가 불필요한 리렌더를 일으키지 않는다.
  // 진행 키 형식은 store의 examProgressKey 하나만 쓴다(서버 exam_progress와 같은 형식).
  const done = useGame((s) => {
    const t = s.examTool
    if (!t) return false
    const prog = s.examProgress[t]
    if (!prog) return false
    return prog.done.includes(examProgressKey(s.examPass, region))
  })
  const [hover, setHover] = useState(false)
  const [holding, setHolding] = useState(false)
  const holdingRef = useRef(false)
  const progRef = useRef(0)
  // 이번 홀드에서 청진음을 이미 울렸나 (홀드당 1회)
  const soundedRef = useRef(false)
  const fillRef = useRef<THREE.Mesh>(null)
  const rootRef = useRef<THREE.Group>(null)
  const hitRef = useRef<THREE.Mesh>(null)
  // 도구별 유지 시간 (§1.3). 도구가 없으면 active=false라 실제로 쓰이지 않는다.
  const holdSec = examTool ? HOLD_SECONDS[examTool] : 1

  useFrame(({ camera }, delta) => {
    /* 위치·자세·크기는 앵커 객체(ExamInteractables가 제자리에서 갱신)를 매 프레임 읽어 반영한다.
       React state로 돌리면 앵커가 갱신될 때마다 리렌더가 나서 호버/홀드 상태가 흔들린다. */
    const root = rootRef.current
    if (root) {
      /* 앵커가 정착하기 전에는 통째로 숨긴다 — 그 사이 좌표는 고정 폴백이라 **빈 침대 위에**
         마커가 뜨고, 거기를 클릭하면 엉뚱한 부위로 기록된다(ANCHOR_SETTLE 주석의 실측). */
      root.visible = ANCHOR_SETTLE.ok
      if (!root.visible) return
      root.position.copy(anchor.pos)
      orientToSurface(root, anchor.pos, anchor.normal, camera.position)
    }
    // 지오메트리는 반지름 1로 만들고 스케일로 체형 비례 반경을 준다(재생성 비용 회피).
    if (hitRef.current) hitRef.current.scale.setScalar(anchor.radius)
    const fill = fillRef.current
    if (!fill) return
    // 진행 디스크는 체표 바로 위(법선 방향 1.2cm)에 눕힌다. 예전엔 구 중심이 몸 속이라 반지름만큼
    // 띄워야 했지만, 이제 중심 자체가 피부 위라 그대로 띄우면 배 위로 6cm 떠 버린다.
    fill.position.y = 0.012
    const m = fill.material as THREE.MeshBasicMaterial
    const diskR = anchor.radius * 1.5
    if (holdingRef.current && active) {
      progRef.current = Math.min(1, progRef.current + delta / holdSec)
      const s = progRef.current
      /* 청진음은 **누르고 있는 도중**에 들려야 한다 (사용자 지시 2026-07-26: "한 4초쯤에").
         종전에는 홀드가 끝나고 서버 응답이 온 뒤 `doExamAction` 에서 울렸다 — 청진을 5초 하는
         내내 아무 소리도 없다가 손을 뗀 뒤에야 장음이 들려서, 듣고 판단하는 술기가 아니라
         '기다렸더니 결과가 나오는' 연출이 됐다.
         5초 홀드의 0.6 지점 = 3초 (사용자 지시 2026-07-26: "4초가 아니라 3초로").
         홀드당 한 번만 울린다(`soundedRef`). */
      if (!soundedRef.current && s >= 0.6 && examTool && AUSCULTATION_TOOLS.includes(examTool)) {
        soundedRef.current = true
        /* 케이스가 이 부위에 적어 둔 소견 문구로 장음 변형(항진/감소/정상)을 고른다.
           서버 응답을 기다리면 홀드가 끝난 뒤에야 소리가 나므로 **로컬 데이터**를 쓴다. */
        const item = useGame.getState().examItems.find((it) => it.id === examTool)
        playAuscultation(item?.region_findings?.[region]?.finding ?? null, null)
      }
      fill.scale.set(diskR * s, diskR * s, 1)
      m.color.copy(DISK_ACTIVE)
      m.opacity = 0.35 + s * 0.45
      if (s >= 1) {
        holdingRef.current = false
        progRef.current = 0
        setHolding(false)
        examRegion(region) // 이 부위 시행 (도구↔부위 검증 + 부분 진행 기록은 store가 담당)
      }
      return
    }
    // 이미 시행한 부위는 옅은 회색 디스크로 채워 남겨 둔다 — 어디를 남겼는지 한눈에 보이게.
    if (done) {
      fill.scale.set(diskR, diskR, 1)
      m.color.copy(DISK_DONE)
      m.opacity = 0.32
    } else {
      fill.scale.set(0, 0, 1)
    }
  })

  const cancel = () => {
    holdingRef.current = false
    progRef.current = 0
    soundedRef.current = false
    setHolding(false)
  }
  /* ⚠️ **포인터 캡처가 없으면 긴 홀드가 완성되지 않는다.**
   * `onPointerOut` 이 `cancel()` 을 부르는데, 청진은 5초를 눌러야 한다(게임에서 가장 긴 홀드).
   * 그 사이에
   *   · 마우스가 몇 픽셀만 흔들리거나
   *   · **환자가 호흡·미세동작으로 움직여 마커가 커서 밑에서 빠져나가면**
   * 곧바로 pointerOut → 진행도 0 리셋이다. 사용자에겐 "꾹 눌러도 안 된다"로 보인다
   * (신고 2026-07-26). 자동화 테스트는 마우스를 완벽히 고정해서 이 결함을 못 잡았다.
   * → 누르는 순간 포인터를 캡처해 놓으면 뗄 때까지 이 메시가 이벤트를 계속 받는다. */
  const onDown = (e: {
    stopPropagation: () => void
    pointerId?: number
    target?: { setPointerCapture?: (id: number) => void }
  }) => {
    e.stopPropagation()
    // 도구 미선택/부위 불일치/이미 시행 — 전부 store가 안내 문구를 결정한다(§5.3).
    if (!active || done) { examRegion(region); return }
    if (e.pointerId !== undefined) {
      try { e.target?.setPointerCapture?.(e.pointerId) } catch { /* 캡처 실패해도 홀드는 진행 */ }
    }
    progRef.current = 0
    soundedRef.current = false
    holdingRef.current = true
    setHolding(true)
  }
  const onUp = (e: {
    pointerId?: number
    target?: { releasePointerCapture?: (id: number) => void }
  }) => {
    if (e?.pointerId !== undefined) {
      try { e.target?.releasePointerCapture?.(e.pointerId) } catch { /* 이미 해제됨 */ }
    }
    cancel()
  }
  /* 두경부 접촉 리그(씬 루트의 설압자·양손·손가락)가 어느 쪽을 향할지 알려 준다.
     ⚠ 렌더 파생값(useEffect)이 아니라 포인터 핸들러에서 직접 쓴다 — 호버 state가 리렌더를
     거치는 사이 프레임이 지나가 리그가 깜빡이거나 아예 안 뜬다(실측으로 확인). */
  const markContact = (on: boolean) => {
    if (!HEADNECK_SET.has(region)) return
    if (on) HOVER_CONTACT.region = region
    else if (HOVER_CONTACT.region === region) HOVER_CONTACT.region = null
  }

  const showContact = active && (hover || holding)
  // 깊은 촉진(deep pass): 손을 조금 더 아래로 눌러 넣고 살짝 키워 '깊게 누른다'는 걸 구분해 보여준다.
  const deep = examTool === 'palpation' && examPass === 'deep'
  return (
    <group ref={rootRef}>
      {/* 히트 영역 (반투명 하이라이트) — 반지름 1로 만들고 스케일로 체형 비례 반경을 준다 */}
      <mesh
        ref={hitRef}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); markContact(active); document.body.style.cursor = active && !done ? 'pointer' : 'default' }}
        /* 누르고 있는 동안에는 **취소하지 않는다.** 위 캡처와 짝이다 —
           호버 표시만 끄고 홀드는 유지한다. 손을 떼는 것(`onPointerUp`)만이 취소다. */
        onPointerOut={() => {
          setHover(false)
          if (!holdingRef.current) cancel()
          markContact(false)
          document.body.style.cursor = 'auto'
        }}
        renderOrder={10}
      >
        <sphereGeometry args={[1, 16, 16]} />
        {/* 파란 원 제거 — 보이지 않게(클릭/호버만). 호버 시 체스트피스/손이 나타남.
            ?examdebug=1(DEV)일 때만 부위별 색으로 보이게 해서 스크린샷 검증에 쓴다. */}
        <meshBasicMaterial
          transparent
          opacity={EXAM_DEBUG ? 0.42 : 0}
          color={EXAM_DEBUG ? DEBUG_REGION_COLOR[region] ?? '#ffffff' : '#ffffff'}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      {/* 꾹 누르는 동안 차오르는 진행 디스크 (체표 법선 방향 = 로컬 +y).
          완료 후엔 회색으로 채워진 채 남는다. 반지름 1 원판을 스케일로 키운다. */}
      <mesh ref={fillRef} rotation={[-Math.PI / 2, 0, 0]} scale={[0, 0, 1]} renderOrder={12}>
        <circleGeometry args={[1, 28]} />
        <meshBasicMaterial color="#6fd0a0" transparent opacity={0.5} depthTest={false} depthWrite={false} />
      </mesh>

      {/* 접촉 지점 표시 — 청진(복부·심장·폐): 체스트피스(디스크) / 타진·촉진: 손 GLB (줄 없음).
          부모가 체표 법선으로 서 있으므로 오프셋 +y는 곧 "피부에서 바깥으로"다.
          두경부는 부위가 작고 접촉물(설압자·펜라이트·양손)이 머리 프레임에 붙어야 해서
          여기가 아니라 씬 루트의 전용 리그(OralExamRig/ThyroidReach/ConjunctivaReach)가 담당한다. */}
      {showContact && !HEADNECK_SET.has(region) && (
        examTool && AUSCULTATION_TOOLS.includes(examTool)
          ? <AuscultationRig />
          // CVA 압통만 주먹(척측으로 두드린다). 촉진·타진·간촉진은 손바닥.
          // 타진은 **양손 술기**라 별도 리그다 — 한 손 누르기로는 촉진과 구분이 안 된다.
          : examTool === 'percussion' || examTool === 'chest_percussion'
            ? <PercussionRig />
            : <PalpationRig deep={deep} pose={examTool === 'cva_tenderness' ? 'fist' : 'palm'} />
      )}
    </group>
  )
}

function ExamInteractables({
  pose,
  variant,
  patientRef,
}: {
  pose: ExamPose
  variant: AvatarVariant
  patientRef: RefObject<THREE.Group | null>
}) {
  const tool = useGame((s) => s.examTool)
  /* 도구가 있으면 그 도구의 부위만 띄운다(store의 TOOL_REGIONS가 단일 진실).
     자세만으로 고르면 걸터앉은 자세에서 옆구리 2 + 흉부 16이 겹쳐 떠 클릭이 서로를 가로챈다. */
  const regions = useMemo<readonly ExamRegion[]>(
    () => (tool && TOOL_REGIONS[tool].length > 0 ? TOOL_REGIONS[tool] : REGIONS_BY_POSE[pose]),
    [tool, pose],
  )
  /* 레이캐스트는 비싸서 매 프레임 돌리지 않는다. 다만 진찰 진입/자세 전환 직후엔 본이
     목표 자세로 감쇠(damp)해 가는 중이라 한 프레임만 재면 '아직 서 있는 몸'을 재게 된다.
     그래서 트리거 후 1.6초 동안만 매 프레임 다시 재고, 자세가 굳으면 얼린다. */
  const probeKey = `${pose}:${variant}:${tool ?? ''}`
  const probe = useRef({ key: '', firstHit: -1, done: false })
  const debugProject = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock, camera }) => {
    const p = probe.current
    /* 머리 본 월드좌표는 앵커가 얼어붙은 뒤에도 계속 갱신한다 —
       진찰 카메라(sit 줌)와 두경부 접촉 리그가 매 프레임 이 값을 읽는다. */
    updateHeadWorld(patientRef.current)
    // 재계산 트리거: 진찰 진입(마운트) / 자세 전환 / 아바타 교체 / 도구 변경(부위 집합이 달라진다).
    // useEffect가 아니라 여기서 비교하는 건, 이펙트가 한 박자 늦게 돌아 그 프레임 동안 옛 좌표가
    // 그대로 쓰이는 걸 막기 위해서다.
    if (p.key !== probeKey) {
      p.key = probeKey
      p.firstHit = -1
      p.done = false
      ANCHOR_SETTLE.ok = false // 다시 잴 때까지 부위를 숨긴다(폴백 좌표로 클릭되는 걸 막는다)
      resetAnchorPool(pose) // 본이 준비될 때까지는 고정 좌표 폴백을 들고 있는다
    }
    if (!p.done) {
      /* 프레임 수가 아니라 '첫 성공 측정' 기준으로 1.6초를 센다.
         스펙은 60프레임 상한을 뒀지만, 빠른 기기에선 GLB를 받는 1초 동안 60프레임이 그냥 지나가
         영영 고정 좌표 폴백에 갇힌다(느린 기기에서만 우연히 통과한다). 본이 없으면 buildExamAnchors가
         즉시 false로 빠져 비용이 없으니, 상한 없이 될 때까지 재시도하는 편이 안전하다. */
      if (buildExamAnchors(pose, patientRef.current, regions)) {
        if (p.firstHit < 0) p.firstHit = clock.elapsedTime
        // 자세 감쇠가 끝난 뒤 얼린다. 그 전에는 매 프레임 최신 자세로 다시 잰다.
        if (clock.elapsedTime - p.firstHit > 1.6) { p.done = true; ANCHOR_SETTLE.ok = true }
      }
    }
    if (EXAM_ANCHOR_DUMP) {
      const root = patientRef.current
      const bones: HeadBones = root
        ? findHeadBones(root)
        : { eyes: [], neck: null, head: null, clavicles: [] }
      ;(window as unknown as { __examAnchors?: unknown }).__examAnchors = {
        pose,
        tool,
        /* 앵커가 **확정**됐는가. 자동 검증 스크립트는 이 값이 true 가 된 뒤에 좌표를 읽어야 한다.
           도구를 고르면 store 의 poseForTool 이 자세까지 바꾸므로(예: 의자 'sit' → 침대 'lie'),
           그 직후 몇 백 ms 동안은 앵커가 **아직 의자에 앉은 몸**을 기준으로 잡힌다
           (실측 mh_m70: 전환 직전 pubis=[-0.896,0.491,-0.102] = 의자, ndc.y=-1.14 로 화면 밖.
            침대에 자리 잡기까지 약 600ms). torsoValid 는 '본을 찾았나'일 뿐 '자세가 끝났나'가
           아니라서 이 구분이 필요하다.
           ⚠ "화면에는 안 그려진다"가 아니다 — 실측(settle/fresh_t1000.png)에서 정착 전 1초 동안
             **빈 침대 위에 4분면 마커가 떠서** 그려졌고 그 자리가 클릭까지 됐다. 그래서 이제
             RegionMesh 가 이 값이 false 인 동안 부위 그룹을 통째로 숨긴다(ANCHOR_SETTLE). */
        settled: ANCHOR_SETTLE.ok,
        torsoValid: PATIENT_TORSO.valid,
        halfWidth: Math.round(PATIENT_TORSO.halfWidth * 1000) / 1000,
        right: PATIENT_TORSO.right.toArray().map((v) => Math.round(v * 100) / 100),
        up: PATIENT_TORSO.up.toArray().map((v) => Math.round(v * 100) / 100),
        front: PATIENT_TORSO.front.toArray().map((v) => Math.round(v * 100) / 100),
        pubis: PATIENT_TORSO.pubis.toArray().map((v) => Math.round(v * 1000) / 1000),
        xiphoid: PATIENT_TORSO.xiphoid.toArray().map((v) => Math.round(v * 1000) / 1000),
        head: HEAD_WORLD.toArray().map((v) => Math.round(v * 1000) / 1000),
        headExported: PATIENT_HEAD_WORLD.toArray().map((v) => Math.round(v * 1000) / 1000),
        neck: NECK_POS.toArray().map((v) => Math.round(v * 1000) / 1000),
        hoverContact: HOVER_CONTACT.region,
        supra: SUPRA.toArray().map((v) => Math.round(v * 1000) / 1000),
        supraNdc: (() => { debugProject.copy(SUPRA).project(camera); return [Math.round(debugProject.x * 1000) / 1000, Math.round(debugProject.y * 1000) / 1000] })(),
        xiphoidNdc: (() => { debugProject.copy(PATIENT_TORSO.xiphoid).project(camera); return [Math.round(debugProject.x * 1000) / 1000, Math.round(debugProject.y * 1000) / 1000] })(),
        clavicles: bones.clavicles.map((b2) => b2.name),
        headBone: (bones.head as THREE.Object3D | null)?.name ?? null,
        neckBone: (bones.neck as THREE.Object3D | null)?.name ?? null,
        eyeBones: bones.eyes.map((b) => b.name),
        regions: regions.map((r) => {
          // 스크린 NDC도 같이 내보낸다 — 시각 회귀 스크립트가 이 좌표로 마우스를 올려 검증한다.
          debugProject.copy(ANCHOR_POOL[r].pos).project(camera)
          return {
            region: r,
            pos: ANCHOR_POOL[r].pos.toArray().map((v) => Math.round(v * 1000) / 1000),
            normal: ANCHOR_POOL[r].normal.toArray().map((v) => Math.round(v * 100) / 100),
            r: Math.round(ANCHOR_POOL[r].radius * 1000) / 1000,
            skin: ANCHOR_POOL[r].skin,
            surface: ANCHOR_POOL[r].surface,
            ndc: [Math.round(debugProject.x * 1000) / 1000, Math.round(debugProject.y * 1000) / 1000],
          }
        }),
      }
    }
  })
  return (
    <group>
      {regions.map((r) => (
        <RegionMesh key={r} anchor={ANCHOR_POOL[r]} />
      ))}
      {/* 청진 도구 활성 시: 실제 청진기 GLB(U+튜브)를 화면 하단에 표시 — 끼고 있는 느낌 */}
      {tool && AUSCULTATION_TOOLS.includes(tool) && pose !== 'sit_edge' && <WornStethoGLB />}
    </group>
  )
}

/* 카메라 패럴랙스 — 마우스 따라 살짝 시선 이동. examMode면 침대 클로즈업으로 보간.
 * 패럴랙스 세기 튜닝(클수록 마우스에 더 흔들림). 진찰은 클릭 정밀도를 위해 거의 고정.
 * 화면이 너무 흔들리거나 클릭이 어긋나면 아래 PARALLAX 값을 더 낮춰라. */
// 문진 카메라(의사 시점) 기준 위치 — 왼쪽 책상 자리. 여기서 오른쪽 대각선(환자)을 본다.
const CAM_BASE = [-1.85, 1.34, 0.95] as const
// 문진 기본 시선 — 환자(오른쪽 대각선)를 향함. 좌로 보면 책상, 우로 보면 침대.
const LOOK_CENTER = [-0.55, 1.05, 0.1] as const

const PARALLAX = {
  playX: 0.28,    // 문진 시 카메라 좌우 이동(미세 패럴랙스)
  playY: 0.12,    // 문진 시 상하
  lookPanX: 2.8,  // 시선 좌우 패닝 — 클수록 고개를 더 많이 돌려 좌(모니터)/우(환자)를 봄
  lookPanY: 0.45, // 시선 상하 패닝
  examX: 0.04,    // 진찰 시 좌우 (거의 고정 — 손소독제/4분면 클릭 정밀)
  examY: 0.025,   // 진찰 시 상하
  damp: 6,        // 따라오는 속도(클수록 빠릿) — 이전(4)과 빠름(8)의 중간
} as const

// 자동 시각 회귀 테스트는 DOM/UI 호버 상태와 무관하게 환자를 정면에 고정한다.
// DEV 빌드에서 ?camera=patient를 명시한 경우에만 활성화된다.
const FORCE_PATIENT_CAMERA = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('camera') === 'patient'

/** 걸터앉은 자세에서 의사가 환자 **앞쪽**에 서야 하는가 (chest 스펙 §4).
 *  · 심장 청진 — 4판막이 전부 앞가슴이라 항상 앞
 *  · 폐 청진/흉부 타진 — 전면 6곳을 다 찍기 전까지 앞, 다 찍으면 뒤로 돌아간다
 *  · 그 밖(CVA 압통) — 기존대로 등 뒤 */
function chestFacesFront(s: ReturnType<typeof useGame.getState>): boolean {
  const tool = s.examTool
  if (tool === 'heart_auscultation') return true
  if (tool === 'lung_auscultation' || tool === 'chest_percussion') {
    const done = s.examProgress[tool]?.done ?? []
    return !ANT_LUNG.every((r) => done.includes(examProgressKey(s.examPass, r)))
  }
  return false
}

/** 흉부 전면 진찰용 앞쪽 필라이트 — 진찰 스팟은 환자 뒤(+z)에 있어 가슴이 역광으로 죽는다.
 *  카메라가 앞으로 돌아갔을 때만 켠다(그 밖에는 등을 비추는 기존 조명 그대로).
 *  spotLight의 target은 씬 그래프에 없으면 방향이 안 잡히므로 target이 필요 없는 pointLight를 쓴다. */
function ChestFrontLight() {
  const light = useRef<THREE.PointLight>(null)
  useFrame((_, delta) => {
    const l = light.current
    if (!l) return
    const s = useGame.getState()
    const want = s.examPose === 'sit_edge' && chestFacesFront(s) ? 2.2 : 0
    l.intensity = THREE.MathUtils.damp(l.intensity, want, 3.2, delta)
  })
  return (
    <pointLight
      ref={light}
      position={EXAM.sitEdge.frontLightPos}
      intensity={0}
      distance={3.0}
      decay={2}
      color="#fff2e6"
    />
  )
}

type ClinicalPreviewFocus = 'room' | 'face' | 'eyes' | 'mouth' | 'neck' | 'hands' | 'legs' | 'skin'

function CameraRig({ examMode = false, previewFocus }: { examMode?: boolean; previewFocus?: ClinicalPreviewFocus }) {
  const look = useRef(new THREE.Vector3(LOOK_CENTER[0], LOOK_CENTER[1], LOOK_CENTER[2]))
  const focusTarget = useRef(new THREE.Vector3())
  const focusPosition = useRef(new THREE.Vector3())
  useFrame((state, delta) => {
    const { camera, pointer } = state
    if (import.meta.env.DEV) {
      ;(window as unknown as { __cam?: unknown }).__cam = {
        p: camera.position.toArray().map((v) => Math.round(v * 100) / 100),
        examMode,
        pose: useGame.getState().examPose,
        gesture: useGame.getState().examGesture,
      }
    }
    if (examMode) {
      const gs = useGame.getState()
      const focusL = EXAM.camLerp
      const gesture = gs.examGesture
      const wantsHands = gesture === 'hands_out' || previewFocus === 'hands'
      const wantsLegs = previewFocus === 'legs'
        || (!gesture && !gs.examTool
          && gs.clinicalGarments.lower === 'rolled'
          && gs.clinicalGarments.socks === 'removed')
      const wantsSkin = previewFocus === 'skin'
        || (!gesture && !gs.examTool && gs.clinicalGarments.upper !== 'worn')
      /* 관절·부종 미리보기는 추정 몸통 좌표가 아니라 실제 손목·무릎·발목 본을 조준한다.
         이 분기는 자세보다 먼저 실행돼 의자/진찰대 어디서든 같은 임상 부위를 프레임에 담는다. */
      if (wantsHands && PATIENT_LIMBS.handsValid) {
        focusTarget.current.copy(PATIENT_LIMBS.leftHand).add(PATIENT_LIMBS.rightHand).multiplyScalar(0.5)
        focusPosition.current.copy(focusTarget.current)
          .addScaledVector(PATIENT_TORSO.front, 0.58)
          .addScaledVector(PATIENT_TORSO.right, 0.02)
          .addScaledVector(PATIENT_TORSO.up, 0.24)
        camera.position.x = THREE.MathUtils.damp(camera.position.x, focusPosition.current.x + pointer.x * PARALLAX.examX, focusL, delta)
        camera.position.y = THREE.MathUtils.damp(camera.position.y, focusPosition.current.y + pointer.y * PARALLAX.examY, focusL, delta)
        camera.position.z = THREE.MathUtils.damp(camera.position.z, focusPosition.current.z, focusL, delta)
        look.current.x = THREE.MathUtils.damp(look.current.x, focusTarget.current.x, focusL, delta)
        look.current.y = THREE.MathUtils.damp(look.current.y, focusTarget.current.y, focusL, delta)
        look.current.z = THREE.MathUtils.damp(look.current.z, focusTarget.current.z, focusL, delta)
        camera.lookAt(look.current)
        return
      }
      if (wantsLegs && PATIENT_LIMBS.legsValid) {
        focusTarget.current.copy(PATIENT_LIMBS.leftKnee).add(PATIENT_LIMBS.rightKnee)
          .add(PATIENT_LIMBS.leftAnkle).add(PATIENT_LIMBS.rightAnkle).multiplyScalar(0.25)
        focusPosition.current.copy(focusTarget.current)
          .addScaledVector(PATIENT_TORSO.front, 0.48)
          .addScaledVector(PATIENT_TORSO.right, -0.22)
          .addScaledVector(PATIENT_TORSO.up, 0.18)
        camera.position.x = THREE.MathUtils.damp(camera.position.x, focusPosition.current.x + pointer.x * PARALLAX.examX, focusL, delta)
        camera.position.y = THREE.MathUtils.damp(camera.position.y, focusPosition.current.y + pointer.y * PARALLAX.examY, focusL, delta)
        camera.position.z = THREE.MathUtils.damp(camera.position.z, focusPosition.current.z, focusL, delta)
        look.current.x = THREE.MathUtils.damp(look.current.x, focusTarget.current.x, focusL, delta)
        look.current.y = THREE.MathUtils.damp(look.current.y, focusTarget.current.y, focusL, delta)
        look.current.z = THREE.MathUtils.damp(look.current.z, focusTarget.current.z, focusL, delta)
        camera.lookAt(look.current)
        return
      }
      if (wantsSkin && PATIENT_TORSO.valid) {
        focusTarget.current.copy(PATIENT_TORSO.pubis).lerp(PATIENT_TORSO.xiphoid, 0.48)
          .addScaledVector(PATIENT_TORSO.front, PATIENT_TORSO.halfWidth * 0.72)
        focusPosition.current.copy(focusTarget.current)
          .addScaledVector(PATIENT_TORSO.front, 0.62)
          .addScaledVector(PATIENT_TORSO.right, 0.06)
          .addScaledVector(PATIENT_TORSO.up, 0.08)
        camera.position.x = THREE.MathUtils.damp(camera.position.x, focusPosition.current.x + pointer.x * PARALLAX.examX, focusL, delta)
        camera.position.y = THREE.MathUtils.damp(camera.position.y, focusPosition.current.y + pointer.y * PARALLAX.examY, focusL, delta)
        camera.position.z = THREE.MathUtils.damp(camera.position.z, focusPosition.current.z, focusL, delta)
        look.current.x = THREE.MathUtils.damp(look.current.x, focusTarget.current.x, focusL, delta)
        look.current.y = THREE.MathUtils.damp(look.current.y, focusTarget.current.y, focusL, delta)
        look.current.z = THREE.MathUtils.damp(look.current.z, focusTarget.current.z, focusL, delta)
        camera.lookAt(look.current)
        return
      }
      if (gs.examPose === 'sit') {
        // 앉은 진찰: 실제 머리 본 위치 기준 상대 오프셋 — 아바타 키 차이 자동 흡수.
        // 결막·구강은 얼굴, 갑상샘은 목으로 줌인. 제스처 없으면 상반신 프레임.
        const L = EXAM.camLerp
        const head = HEAD_WORLD
        const oral = gesture === 'mouth_open' || previewFocus === 'mouth'
        const neck = gesture === 'swallow' || previewFocus === 'neck'
        if (oral) {
          /* 구강은 환자 정면축에서 본다. 고정 XYZ 오프셋은 아바타가 의자를 향해 돌아간 각도만큼
             카메라가 볼 쪽으로 새어 설압자와 뺨이 겹쳤다. 혀 앵커를 조준하고 몸통 front 축을
             따라 들어가면 구개수·편도기둥·인두후벽이 좌우 대칭으로 보인다. */
          const tongue = ANCHOR_POOL.oral_tongue
          const mouth = tongue.radius > 0
            ? tongue.pos
            : head.clone().addScaledVector(PATIENT_TORSO.up, -0.04)
          // 얼굴 중앙(입 위 약 3.5cm)을 조준하고 환자 정면축을 따른다.
          // 44cm에서는 전체 얼굴은 보였지만 입안 진찰 영역이 너무 작았다.
          // 36cm는 눈·코·턱을 남기면서 치아·인두를 약 22% 더 크게 보여준다.
          focusTarget.current.copy(mouth).addScaledVector(PATIENT_TORSO.up, 0.035)
          focusPosition.current.copy(mouth)
            .addScaledVector(PATIENT_TORSO.front, 0.36)
            .addScaledVector(PATIENT_TORSO.up, 0.045)
        } else if (neck) {
          const rightThyroid = ANCHOR_POOL.thyroid_r
          const leftThyroid = ANCHOR_POOL.thyroid_l
          focusTarget.current.copy(rightThyroid.radius > 0 && leftThyroid.radius > 0
            ? rightThyroid.pos.clone().add(leftThyroid.pos).multiplyScalar(0.5)
            : head.clone().addScaledVector(PATIENT_TORSO.up, -0.12))
          focusPosition.current.copy(focusTarget.current)
            .addScaledVector(PATIENT_TORSO.front, 0.48)
            .addScaledVector(PATIENT_TORSO.up, 0.08)
        } else if (wantsHands) {
          focusTarget.current.copy(PATIENT_TORSO.xiphoid)
            .addScaledVector(PATIENT_TORSO.up, 0.02)
            .addScaledVector(PATIENT_TORSO.front, 0.24)
          focusPosition.current.copy(focusTarget.current)
            // 책상 상판보다 위에서 손등을 내려다본다. 낮으면 카메라가 상판 안으로 들어간다.
            .addScaledVector(PATIENT_TORSO.front, 0.58)
            .addScaledVector(PATIENT_TORSO.up, 0.50)
        } else if (wantsLegs) {
          focusTarget.current.copy(PATIENT_TORSO.pubis)
            .addScaledVector(PATIENT_TORSO.up, -0.26)
            .addScaledVector(PATIENT_TORSO.front, 0.12)
          focusPosition.current.copy(focusTarget.current)
            // 다리는 책상 아래에 있으므로 정면 저각이 아니라 환자 왼쪽 측면 위에서 본다.
            .addScaledVector(PATIENT_TORSO.front, 0.46)
            .addScaledVector(PATIENT_TORSO.right, -0.62)
            .addScaledVector(PATIENT_TORSO.up, 0.78)
        } else if (wantsSkin) {
          focusTarget.current.copy(PATIENT_TORSO.xiphoid)
            .addScaledVector(PATIENT_TORSO.up, -0.05)
          focusPosition.current.copy(focusTarget.current)
            .addScaledVector(PATIENT_TORSO.front, 0.62)
            .addScaledVector(PATIENT_TORSO.up, 0.50)
        } else {
          const closeFace = gesture === 'eyes_up' || previewFocus === 'eyes' || previewFocus === 'face'
          focusTarget.current.copy(head).addScaledVector(PATIENT_TORSO.up, closeFace ? 0.055 : 0)
          focusPosition.current.copy(focusTarget.current)
            .addScaledVector(PATIENT_TORSO.front, closeFace ? 0.42 : 0.72)
            .addScaledVector(PATIENT_TORSO.up, closeFace ? 0.08 : 0.14)
        }
        camera.position.x = THREE.MathUtils.damp(camera.position.x, focusPosition.current.x + pointer.x * PARALLAX.examX, L, delta)
        camera.position.y = THREE.MathUtils.damp(camera.position.y, focusPosition.current.y + pointer.y * PARALLAX.examY, L, delta)
        camera.position.z = THREE.MathUtils.damp(camera.position.z, focusPosition.current.z, L, delta)
        look.current.x = THREE.MathUtils.damp(look.current.x, focusTarget.current.x, L, delta)
        look.current.y = THREE.MathUtils.damp(look.current.y, focusTarget.current.y, L, delta)
        look.current.z = THREE.MathUtils.damp(look.current.z, focusTarget.current.z, L, delta)
        camera.lookAt(look.current)
        return
      }
      if (gs.examPose === 'sit_edge') {
        /* CVA 압통 · 후면 폐야: 걸터앉은 환자의 등 뒤에서 내려다본다.
           카메라는 원래 서 있던 +z쪽에 그대로 두고 침대 너머로 등을 보는 앵글이라
           진찰 조명(spotLight)이 그대로 등을 비춘다. 클릭 정밀도를 위해 패럴랙스는 최소.
           흉부 전면(심장·전면 폐야)일 때만 환자 앞쪽(-z)으로 돌아간다 — chest 스펙 §4. */
        const L = EXAM.camLerp
        const S = EXAM.sitEdge
        const front = chestFacesFront(gs)
        const pos = front ? S.camPosFront : S.camPos
        const aim = front ? S.camLookFront : S.camLook
        // 앞↔뒤 전환은 벽을 뚫고 지나가지 않도록 damp 속도를 낮춰 부드럽게 돈다(멀미 방지).
        const lerp = camera.position.z < -4.2 !== front ? L * 0.55 : L
        camera.position.x = THREE.MathUtils.damp(camera.position.x, pos[0] + pointer.x * PARALLAX.examX, lerp, delta)
        camera.position.y = THREE.MathUtils.damp(camera.position.y, pos[1] + pointer.y * PARALLAX.examY, lerp, delta)
        camera.position.z = THREE.MathUtils.damp(camera.position.z, pos[2], lerp, delta)
        look.current.x = THREE.MathUtils.damp(look.current.x, aim[0], lerp, delta)
        look.current.y = THREE.MathUtils.damp(look.current.y, aim[1], lerp, delta)
        look.current.z = THREE.MathUtils.damp(look.current.z, aim[2], lerp, delta)
        camera.lookAt(look.current)
        return
      }
      // 진찰: 침대 클로즈업으로 부드럽게 이동. 클릭 타깃이 흔들리지 않게 패럴랙스 최소화.
      const L = EXAM.camLerp
      camera.position.x = THREE.MathUtils.damp(camera.position.x, EXAM.camPos[0] + pointer.x * PARALLAX.examX, L, delta)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, EXAM.camPos[1] + pointer.y * PARALLAX.examY, L, delta)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, EXAM.camPos[2], L, delta)
      camera.lookAt(EXAM.camLook[0], EXAM.camLook[1], EXAM.camLook[2])
      return
    }
    if (FORCE_PATIENT_CAMERA) {
      camera.position.set(CAM_BASE[0], CAM_BASE[1], CAM_BASE[2])
      look.current.set(SEAT.camLook[0], SEAT.camLook[1], SEAT.camLook[2])
      camera.lookAt(look.current)
      return
    }
    // 클릭 가능한 오브젝트 호버 중(cameraHold) 또는 포인터가 2D UI 위(uiHold)엔
    // 카메라를 멈춰 클릭을 쉽게 한다 (위치·시선 모두 고정)
    const gs = useGame.getState()
    if (gs.cameraHold || gs.uiHold) {
      camera.lookAt(look.current)
      return
    }
    const targetX = CAM_BASE[0] + pointer.x * PARALLAX.playX
    const targetY = CAM_BASE[1] + pointer.y * PARALLAX.playY
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, PARALLAX.damp, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, PARALLAX.damp, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, CAM_BASE[2], PARALLAX.damp, delta)
    // 기본 시선은 정면 중앙 — 마우스 좌우로 고개를 돌려 환자(왼쪽)/컴퓨터(오른쪽)를 본다
    look.current.x = THREE.MathUtils.damp(look.current.x, LOOK_CENTER[0] + pointer.x * PARALLAX.lookPanX, PARALLAX.damp, delta)
    look.current.y = THREE.MathUtils.damp(look.current.y, LOOK_CENTER[1] + pointer.y * PARALLAX.lookPanY, PARALLAX.damp, delta)
    look.current.z = LOOK_CENTER[2]
    camera.lookAt(look.current)
  })
  return null
}

/** 환자 얼굴 키라이트.
 *
 *  ⚠⚠ **`target-position` 만 주면 조명이 얼굴을 안 본다.** three 의 `WebGLLights.setup()` 은
 *  `light.target.matrixWorld` 에서 조준점을 뽑는데, `light.target` 은 씬 그래프에 붙어 있지 않으면
 *  `updateMatrixWorld()` 가 호출되지 않아 **단위행렬(=월드 원점)** 로 남는다.
 *  실측: 의도한 조준점 [-0.92,1.08,0] 대신 [0,0,0] 을 봤고, 얼굴이 콘 중심에서 24.8° 벗어나
 *  penumbra=1 감쇠 0.41 — **얼굴이 키라이트를 40%밖에 못 받았다.**
 *  (같은 함정을 아래 ChestFrontLight 주석도 지적하고 있다 — 거긴 pointLight 로 우회했다.)
 *
 *  그래서 target 을 실제 Object3D 로 만들어 `<primitive>` 로 **씬에 넣는다.**
 *  조준이 정상화되면 실효 광량이 약 2.4배가 되므로 intensity 는 그만큼 되내려야 한다. */
/** 침대 리그 조준 폴백 — 머리 본이 없는 리그에서만 쓴다(FaceKeyLight 안 주석 참고). */
const FACE_KEY_FALLBACK = new THREE.Vector3().fromArray(EXAM.faceKeyTarget)
/** 의자(문진) 리그의 조준 폴백 — 머리 본을 못 읽을 때만 쓴다. */
const SEAT_FACE_FALLBACK = new THREE.Vector3().fromArray(SEAT.faceLightTarget)

export function FaceKeyLight({ examMode, examPose }: { examMode: boolean; examPose: ExamPose }) {
  const target = useMemo(() => new THREE.Object3D(), [])
  /* ⚠ **`examMode` 만 보고 조명을 침대로 옮기면 안 된다.** 마주앉기(pose 'sit')는 환자가
     침대가 아니라 **의자에 그대로 앉아 있다**(ExamPatient 의 pose==='sit' 분기가 SEAT.pos 를 쓴다).
     그런데도 EXAM.faceKeyPos/Target 으로 넘기면 스팟이 **빈 침대**를 비춘다.
     실측: 머리는 콘 중심에서 **75.0°** 떨어져 있었고(반각 33.2°) 콘 밖이라 기여가 정확히 0이었다 —
     intensity 를 0→3.2 로 흔들어도 얼굴 휘도가 87.2→85.0 으로 **움직이지 않았다**(노이즈 수준).
     그래서 조도 부족이 아니라 **조준** 문제다. 환자가 의자에 있는 동안은 문진과 같은 리그를 쓴다. */
  const inChair = !examMode || examPose === 'sit'
  const pos = inChair ? SEAT.keyLightPos : EXAM.faceKeyPos
  /* ⚠ 침대 리그의 조준점을 **하드코딩하면 어차피 틀린다.** 아바타 풀이 MPFB 12종 + 체형 변형 +
     VALID/Rocketbox/RenderPeople 이라 키·다리 길이가 달라 누운 머리의 월드 x 가 20cm 넘게 움직인다.
     실측(2026-07-25): 고정값 EXAM.faceKeyTarget=[1.75,1.0,-3.5] 은 누운 환자 머리(x≈1.2)에서
     50cm 빗나가 있었고, penumbra=1 의 콘 가장자리 감쇠 탓에 intensity 를 **9배**(0.26→2.4) 올려도
     얼굴 휘도가 95.6→98.7 로 +3.2 밖에 안 움직였다 — 조도가 아니라 **조준** 문제다.
     그래서 머리 본 월드좌표(HEAD_WORLD, ExamInteractables 가 매 프레임 갱신)를 따라간다.
     이 파일에서 같은 계열 버그가 이번이 세 번째다(light.target 미부착 → 월드 원점 조준,
     빈 침대 조준, 그리고 이것). 조준점은 본에서 유도해라. */
  useFrame(() => {
    if (inChair) {
      /* ⚠ 의자 리그도 **머리 본을 따라가야 한다.** 종전에는 고정 좌표(`SEAT.faceLightTarget`)를
         썼는데, 환자가 통증으로 고개를 숙이거나 몸을 웅크리면 얼굴이 그 지점을 벗어나
         **얼굴이 통째로 그늘에 묻힌다**(통증 자세를 넣은 뒤 캡처에서 실제로 그랬다).
         이 파일에서 같은 계열 버그가 이미 세 번 있었고 그 교훈이 아래 주석에 적혀 있다 —
         "조준점은 본에서 유도해라". 의자 리그만 예외로 남아 있었다.
         `PATIENT_HEAD_WORLD` 는 RealisticPatient 가 매 프레임 갱신하는 머리 본 월드 좌표다. */
      const head = PATIENT_HEAD_WORLD
      const sane = Number.isFinite(head.x) && head.lengthSq() > 1e-6
        && head.distanceTo(SEAT_FACE_FALLBACK) < 1.2
      target.position.copy(sane ? head : SEAT_FACE_FALLBACK)
    } else {
      target.position.copy(HEAD_WORLD)
      /* 머리 본을 못 찾은 리그에서는 HEAD_WORLD 가 PATIENT_HEAD_WORLD(문진용 **의자** 좌표)로
         폴백한다. 그대로 조준하면 침대 조명이 빈 의자를 비춘다 — 침대에서 너무 멀면 고정값을 쓴다. */
      if (target.position.distanceTo(FACE_KEY_FALLBACK) > 1.5) target.position.copy(FACE_KEY_FALLBACK)
    }
    // 씬 그래프 갱신 순서와 무관하게 이번 프레임에 반영되도록 직접 갱신한다.
    target.updateMatrixWorld()
  })
  return (
    <>
      <primitive object={target} />
      <spotLight
        position={pos}
        target={target}
        angle={0.58}
        penumbra={1}
        /* 의자 리그는 광원-얼굴 거리가 1.59m(decay=2)라 생각보다 약하다 — 실측으로 정했다.
           침대 리그는 2.32m 라 더 약하다. decay=2 는 거리 제곱으로 나누므로 두 리그의 값을
           같은 눈금으로 보면 안 된다(1.59² vs 2.32² = 2.1배 차이).

           [2026-07-25 조준 수정 후 런타임 스윕 — 얼굴 크롭 휘도 / 프레임 클리핑]
             0 → 95.5    2.2 → 98.4   5 → 102.2   10 → 107.9
             18 → 115.5  30 → 125.4   48 → 137.2   (전 구간 클리핑 0.00%)
           종전 0.26 은 **껐을 때(95.5)와 구분이 안 되는 값**이었다 — 조준이 50cm 빗나가 있어
           0.26→2.4 로 9배 올려도 +3 밖에 안 움직였고, 그래서 '더 올려도 소용없다'로 오해됐다.
           조준을 머리 본에 붙인 뒤에야 값이 실제로 먹는다.
           18 을 고른 근거: 병합 전 얼굴 휘도(115.2)와 일치하고 클리핑이 0 이며, 30 부터는
           페이퍼롤 흰 시트가 계조를 잃기 시작한다(캡처 light_exam_18/30.png 비교). */
        intensity={inChair ? SEAT_KEY_INTENSITY : 18}
        distance={5.5}
        decay={2}
        color="#fff0e4"
        /* 그림자는 두 리그 모두 켜 둔다.
           [2026-07-25] 한때 의자 리그에서만 껐었다 — 마주앉기가 61.3fps 로 아슬아슬해서
           이 그림자 하나가 2.0ms(+8.6fps)였기 때문이다. A/B 캡처로 얼굴이 납작해지지 않는 것도
           확인했다(cmp_facekey_shadow.png: 얼굴 크롭 표준편차 48.6 → 49.4, 차이는 얼굴 형태가
           아니라 턱→가슴 접촉 그림자에 몰린다).
           **그 최적화는 더 이상 필요 없다.** 진짜 병목은 벽시계 유리의 `transmission: 1` 이었다 —
           three 는 씬에 transmission > 0 이 하나라도 있으면 매 프레임 씬을 한 번 더 그린다.
           자산에서 그걸 걷어내자 결막 시점이 61~73 → 116.6fps 가 됐다(팀리드 실측).
           프레임이 남으니 그림자를 살려 두는 편이 얼굴 입체감에 낫다.
           ⚠ 다시 끄고 싶어지면 껐다 켜는 토글 말고 key 로 remount 해라 — castShadow 를
             런타임에 토글하면 이미 만들어진 섀도맵이 남아 첫 프레임에 옛 그림자가 비친다. */
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.012}
        /* PCFSoftShadowMap 폐기분을 여기서 메운다(Canvas shadows 주석 참고).
           얼굴 그림자는 딱딱하면 바로 CG로 읽히므로 조금 넉넉하게. */
        shadow-radius={3}
      />
    </>
  )
}

export function ClinicScene({
  entering,
  onEnterComplete,
  emotion,
  speaking,
  variant,
  showPatient = true,
  gesture = 'none',
  examMode = false,
  examPose = 'lie',
  patientAge,
  patientIdentity,
  patientAppearance,
  previewFocus,
}: {
  entering: boolean
  onEnterComplete: () => void
  emotion: Emotion
  speaking: boolean
  variant: AvatarVariant
  showPatient?: boolean
  gesture?: 'none' | 'reach'
  examMode?: boolean
  examPose?: 'sit' | 'lie' | 'lie_knees' | 'sit_edge'
  patientAge?: number
  patientIdentity?: string
  /** 교수자 대시보드의 저장 전 미리보기 값. 없으면 현재 세션 값을 쓴다. */
  patientAppearance?: AvatarAppearance
  /** 교수자 연출 스튜디오 전용 카메라 초점. 실제 진료에서는 제스처/도구가 같은 구도를 고른다. */
  previewFocus?: ClinicalPreviewFocus
}) {
  const examGestureLive = useGame((s) => s.examGesture)
  /* 두경부 리그(갑상샘·구강·결막)의 **표시 조건**에 쓴다.
     ⚠ 종전에는 준비 제스처(`swallow`/`mouth_open`/`eyes_up`)만 보고 켰는데, 그러면
       도구를 골라도 그 순간 제스처가 아니면 **손이 아예 안 나온다**(사용자 신고 2026-07-26:
       "갑상샘 진단할 때 왜 손이 안 떠"). 삼킴은 촉진 **중의 한 단계**지 손이 존재할 조건이 아니다. */
  const examToolLive = useGame((s) => s.examTool)
  // 아이+보호자 동반 진료 — 보호자가 아이 옆에 함께 앉는다. 화자 전환 시 보호자가 말하는 모션.
  const guardianInfo = useGame((s) => s.session?.guardian)
  const lastSpeaker = useGame((s) => s.lastSpeaker)
  const [stage, setStage] = useState<EnterStage>(entering ? 'knock' : 'done')
  const [fade, setFade] = useState(false) // 착석 전환을 가리는 암전
  const [examFade, setExamFade] = useState(false) // 진찰 진입 시 환자 위치 전환을 가리는 짧은 암전
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const doneRef = useRef(!entering)
  // 진찰 부위를 실제 피부 위로 올리는 레이캐스트의 대상(환자 서브트리 루트)
  const examPatientRef = useRef<THREE.Group>(null)

  // 진찰 단계 진입(의자→침대 순간이동) 순간을 짧은 암전으로 가린다
  useEffect(() => {
    if (!examMode) return
    setExamFade(true)
    const t = setTimeout(() => setExamFade(false), 560)
    return () => clearTimeout(t)
  }, [examMode])

  const complete = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    timers.current.forEach(clearTimeout)
    setStage('done')
    onEnterComplete()
  }, [onEnterComplete])

  useEffect(() => {
    if (!entering) return
    doneRef.current = false
    const localTimers = timers.current
    const at = (ms: number, fn: () => void) => localTimers.push(setTimeout(fn, ms))
    sfxKnock()
    at(900, () => {
      sfxDoor()
      setStage('open')
    })
    at(1500, () => setStage('walk'))
    for (let i = 0; i < 9; i++) at(1800 + i * 560, () => sfxStep(i))
    const walkEnd = 1500 + WALK_DURATION * 1000
    // 걷기 종료 → 암전 → (가려진 채) 의자에 착석 → 페이드 업
    at(walkEnd, () => setFade(true))
    at(walkEnd + 480, () => { sfxDoor(); setStage('sit') }) // 암전 중 좌석으로 스냅
    at(walkEnd + 1050, () => { setFade(false); complete() }) // 앉은 모습으로 밝아짐
    return () => localTimers.forEach(clearTimeout)
  }, [entering, complete])

  // 문은 오픈 단계에 열려서 walk 동안 열린 채 유지, sit에 닫힌다
  const doorOpenT = stage === 'open' || stage === 'walk' ? 1 : 0

  /* 적응형 렌더 스케일 — 프레임이 밀리면 해상도를 낮추고, 여유가 생기면 되돌린다.
     시연 노트북 성능이 매번 같지 않은데 고정 dpr 은 둘 중 하나로만 실패한다
     (약한 기기에서 버벅이거나, 좋은 기기에서 흐릿하거나).
     ⚠ **하한을 1.0 아래로 내리지 마라.** 학생이 황달·결막 창백·손떨림을 화면으로
     판정하는 제품이다. 프레임을 벌자고 임상 소견을 못 읽게 만들면 본말전도다
     (우주게임이 0.62배까지 내리는 건 판정할 소견이 없기 때문이다). */
  const [dpr, setDpr] = useState(1.5)

  return (
    <div className="absolute inset-0" onClick={entering ? complete : undefined}>
      <Canvas
        /* ⚠ **PCFSoftShadowMap 은 three r184 에서 폐기됐다 — 무슨 수를 써도 적용되지 않는다.**
           R3F 는 shadows="soft" 든 boolean 이든 gl.shadowMap.type 에 PCFSoftShadowMap(2) 을 넣지만,
           three 의 WebGLShadowMap.render() 첫머리가 매 프레임 이렇게 되돌린다:
             if (this.type === 2) { warn('PCFSoftShadowMap has been deprecated...'); this.type = 1 }
           (three 0.184.0 build/three.module.js:9137)
           런타임 트랩으로 확인: onCreated 시점엔 2였다가 첫 그림자 렌더에서 1로 내려간다.
           그 렌더를 부르는 건 ContactShadows 의 useFrame(gl.render) 다.
           그러니 여기서 무엇을 넘기든 결과는 PCF(1) 이다. 착각을 남기지 않게 boolean 으로 둔다.
           **부드러운 그림자는 이제 타입이 아니라 광원별 `shadow-radius` 로 만든다**(PCF 경로가
           shadowRadius 로 탭 간격을 넓힌다 — shadowmap_pars_fragment.glsl.js:132). */
        shadows
        onCreated={({ gl, scene, camera }) => {
          if (import.meta.env.DEV) {
            const w = window as unknown as {
              __scene?: unknown; __camera?: unknown; __gl?: unknown; __three?: unknown
            }
            w.__scene = scene
            w.__camera = camera
            w.__gl = gl
            // 픽셀 단위 아티팩트를 레이캐스트로 특정할 때 필요하다(render_qa 하네스).
            w.__three = THREE
          }
          gl.localClippingEnabled = true
          gl.outputColorSpace = THREE.SRGBColorSpace
          if (RENDER_FLAGS.noShadow) gl.shadowMap.enabled = false
        }}
        camera={{ position: [-1.85, 1.34, 0.95], fov: 52, near: 0.1, far: 100 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: RENDER_FLAGS.exposure,
        }}
        dpr={dpr}
        performance={{ min: 0.5 }}
      >
        {/* HDRI는 IBL(조명/반사)만 담당 — 배경은 우리 3D 방 */}
        {/* HDRI는 반사에만 쓴다. 0.64는 면광원이 없던 시절 밝기를 보상하던 값이라
            이제 과하고, 이 HDRI가 푸른 탓에 흰 벽이 라벤더로 물든다(랩 실측). */}
        <SafeEnvironment intensity={0.30} />
        {/* 균일한 노란 앰비언트를 줄이고, 천장/바닥 색이 다른 자연스러운 채움광으로 분리 */}
        <ambientLight intensity={0.08} color="#f7f8fb" />
        {/* 지면색 #6a5544는 원목 바닥 시절의 반사색이다. 바닥이 회색 비닐로 바뀌어 중성으로. */}
        <hemisphereLight args={['#f4f6f4', '#c9c6bf', 0.26]} />
        {/* 창문(우측 벽) 쪽의 넓은 중성 주광 */}
        {/* 창측 주광 — 천장 면광원이 주광을 맡으므로 창 방향 보조 수준으로 낮춘다 */}
        <directionalLight position={[4.5, 2.6, -0.9]} intensity={0.32} color="#fff2e4" />
        {/* 위에서 부드러운 디렉셔널 (접지 그림자) */}
        <directionalLight
          position={[1.2, 5, 1.0]}
          intensity={0.5}
          color="#f5f7ff"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-4}
          shadow-camera-right={4}
          shadow-camera-top={4}
          shadow-camera-bottom={-4}
          shadow-bias={-0.0004}
          shadow-normalBias={0.018}
          shadow-radius={2.5}
        />
        {/* 환자 얼굴의 넓고 부드러운 키 — 피부 형태와 눈 밑 음영을 살린다.
            ⚠ 천장 면광원은 **위를 향한 면**(가슴)만 밝히고 수직면인 얼굴은 어둡게 남긴다.
               이 스팟이 그걸 메운다. 절대 제거하지 마라 — 빼면 환자 얼굴이 죽는다(랩 실측).
               채움광을 줄이면서 1.9 → 3.2 로 올렸다(얼굴 89 → 목표 105 이상). */}
        <FaceKeyLight examMode={examMode} examPose={examPose} />
        {/* 카메라 쪽 약한 필과 뒤쪽 쿨 림 — 눈의 캐치라이트와 머리 윤곽만 살린다 */}
        <pointLight
          position={examMode ? [1.8, 1.8, -2.6] : [-0.25, 1.45, 0.65]}
          intensity={examMode ? 0.08 : 0.26}
          distance={2.8}
          decay={2}
          color="#f5f7ff"
        />
        {!examMode && (
          <pointLight
            position={[-1.45, 1.85, -0.9]}
            intensity={0.42}
            distance={2.6}
            decay={2}
            color="#d8e7ff"
          />
        )}
        <Suspense fallback={null}>
          {/* 천장 형광등 패널 (방 조명) */}
          {/* 천장 형광등 — 점광원 4개 → **면광원(rectAreaLight) 6개**.
              점광원은 그림자가 딱딱해 즉시 CG로 읽힌다. 면광원은 그림자를 못 만드는 대신
              넓은 부드러운 확산과 바닥 스페큘러를 준다(그림자는 아래 directional이 전담). */}
          <Troffers />
          <Room doorOpenT={doorOpenT} examMode={examMode} />
          {/* 환자 로드 실패(텍스처 디코드 등)가 캔버스 전체를 검게 만들지 않도록 바운더리로 격리 */}
          <EnvBoundary>
            {showPatient && (examMode
              ? <ExamPatient
                  emotion={emotion}
                  speaking={speaking && lastSpeaker !== 'guardian'}
                  variant={variant}
                  pose={examPose}
                  patientAge={patientAge}
                  patientIdentity={patientIdentity}
                  appearance={patientAppearance}
                  groupRef={examPatientRef}
                />
              : <Patient
                  stage={stage}
                  emotion={emotion}
                  speaking={speaking && lastSpeaker !== 'guardian'}
                  variant={variant}
                  gesture={gesture}
                  patientAge={patientAge}
                  patientIdentity={patientIdentity}
                  appearance={patientAppearance}
                />)}
          </EnvBoundary>
          {/* 보호자(엄마 등) — 아이와 함께 입장, 옆 보조 의자에 착석. 진찰 단계에선 비활성 */}
          {showPatient && guardianInfo && !examMode && (
            <EnvBoundary>
              <GuardianWalker
                stage={stage}
                guardianInfo={guardianInfo}
                speaking={speaking}
                lastSpeaker={lastSpeaker}
              />
              <Stool position={[-0.44, 0, -0.95]} />
            </EnvBoundary>
          )}
          {/* 진찰: 환자 몸 위 클릭 영역.
              복부 4분면·옆구리(눕기/걸터앉기) + 두경부 6부위(마주 앉기) + 흉부 16부위(걸터앉기).
              두경부도 이제 발화가 아니라 **부위를 찍어야** 시행되므로 sit 자세에서도 띄운다.
              부위 좌표는 환자 본에서 유도하므로 아바타(variant)와 환자 루트를 함께 넘긴다. */}
          {examMode && (
            <ExamInteractables pose={examPose} variant={variant} patientRef={examPatientRef} />
          )}
          {/* 접촉 압박 — 환자 스킨 재질에 눌린 자국(변형 + 그늘)을 주입하고 매 프레임 값만 갱신 */}
          {examMode && <SkinPress patientRef={examPatientRef} />}
          {/* 흉부 전면을 볼 때만 켜지는 앞쪽 필라이트 */}
          {examMode && <ChestFrontLight />}
          {/* 갑상샘 촉진 — 앉은 환자 목으로 양손이 뻗어 들어옴.
              **도구가 선택돼 있으면 손이 있어야 한다.** 삼킴 제스처는 촉진 중의 한 단계지
              손이 존재할 조건이 아니다(종전에는 `swallow` 일 때만 켜져 손이 안 보였다). */}
          {examMode && examPose === 'sit'
            && (examToolLive === 'thyroid_palpation' || examGestureLive === 'swallow') && (
            <ThyroidReach />
          )}
          {/* 구강검사 — 설압자+펜라이트를 쥔 손이 입으로.
              같은 이유로 도구 선택만으로도 켠다. 입을 벌리기 전에도 학생이
              "설압자로 보겠습니다" 하면 손이 들어오는 게 맞다. */}
          {examMode && examPose === 'sit'
            && (examToolLive === 'oral_exam' || examGestureLive === 'mouth_open') && (
            <OralExamRig />
          )}
          {/* 결막·공막 검사 — 아랫눈꺼풀을 내리는 손가락 */}
          {examMode && examPose === 'sit'
            && (examToolLive === 'conjunctiva' || examToolLive === 'sclera_exam'
              || examGestureLive === 'eyes_up') && (
            <ConjunctivaReach />
          )}
          {/* 환자 발밑 그림자 캐처 (진찰 단계에선 침대 위라 비활성) */}
          {!examMode && <ContactShadows position={[SEAT.pos[0], 0.01, SEAT.pos[2]]} opacity={0.5} scale={5} blur={2.4} far={1.8} resolution={1024} />}
        </Suspense>
        <CameraRig examMode={examMode} previewFocus={previewFocus} />
        <PerformanceMonitor
          onDecline={() => setDpr((d) => Math.max(1, Number((d - 0.25).toFixed(2))))}
          onIncline={() => setDpr((d) => Math.min(2, Number((d + 0.25).toFixed(2))))}
        />
        {RENDER_FLAGS.nopost ? null : (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={0.36} intensity={1.18} distanceFalloff={0.8} quality="medium" />
          {/* 발광 천장 패널/창문에만 은은한 블룸 */}
          <Bloom intensity={0.17} luminanceThreshold={1.02} luminanceSmoothing={0.35} mipmapBlur radius={0.45} />
          {/* ⚠️ 이 이펙트가 없으면 톤매핑이 **아예 적용되지 않는다.**
              Canvas의 gl={{ toneMapping: ACESFilmic }} 는 EffectComposer가 마운트되는 순간
              postprocessing 라이브러리가 NoToneMapping으로 덮어쓴다(톤매핑을 체인의 이펙트로
              처리하라는 설계). 실제로 실행 중인 게임에서 gl.toneMapping === 0 을 확인했다.
              그 결과 선형값이 그대로 화면에 나가 **문진 9.6% / 진찰 34.6% 픽셀이 255로 클리핑**됐다
              (진찰 화면 1/3이 순백 — 황달·결막 창백을 판별해야 하는 화면에서).
              AO·Bloom은 HDR 선형에서 돌아야 하므로 그 뒤, LDR용 SMAA·Noise·Vignette 앞에 둔다. */}
          {/* 톤매퍼는 **피부색을 결정한다.** ACES Filmic 은 따뜻하고 채도 높은 색을
              하이라이트에서 주황 쪽으로 밀어 한국인 피부가 구릿빛으로 뜬다.
              AgX 는 색조를 유지한 채 하이라이트만 굴려 살색이 훨씬 덜 변한다.
              `?tonemap=aces|agx|neutral` 로 비교할 수 있다. */}
          {RENDER_FLAGS.noToneMapping ? <></> : (
            <ToneMapping
              mode={
                RENDER_FLAGS.tonemap === 'aces' ? ToneMappingMode.ACES_FILMIC
                  : RENDER_FLAGS.tonemap === 'neutral' ? ToneMappingMode.NEUTRAL
                    : ToneMappingMode.AGX
              }
            />
          )}
          <SMAA />
          <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.02} />
          <Vignette eskil={false} offset={0.23} darkness={0.24} />
        </EffectComposer>
        )}
      </Canvas>

      {/* 착석 전환을 가리는 암전 (걷기 종료 → 앉은 모습) */}
      <div
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-500"
        style={{ opacity: fade ? 1 : 0 }}
      />

      {/* 진찰 진입 암전 (의자 → 침대 전환을 가림) */}
      <div
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-500"
        style={{ opacity: examFade ? 1 : 0 }}
      />

      {/* 노크 연출 (HTML 오버레이) — 뒷벽 문 위치 */}
      <AnimatePresence>
        {stage === 'knock' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: [1, 1.12, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="font-display absolute top-[34%] left-[38%] -translate-x-1/2 text-3xl text-white/85 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
          >
            똑똑 ...
          </motion.div>
        )}
      </AnimatePresence>

      {entering && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-4 py-1.5 text-[12px] text-white/80 backdrop-blur">
          클릭해서 건너뛰기
        </div>
      )}
    </div>
  )
}
