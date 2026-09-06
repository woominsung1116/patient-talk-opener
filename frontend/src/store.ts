import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { api } from './api'
import { speak, stopSpeaking } from './audio/tts'
import { sfxTrustDown, sfxTrustUp, sfxUnlock, setMasterVolume, setSfxEnabled } from './audio/sfx'
import { setBgmEnabled } from './audio/bgm'
import { setRoomToneEnabled } from './audio/roomTone'
import { playHeartSound, playLungSound, playPercussion, playSwallow } from './audio/examSounds'
import { freshClinicalGarments, inferClinicalGarments } from './clinicalGarments'
import type { ClinicalGarments } from './clinicalGarments'
export { DEFAULT_CLINICAL_GARMENTS, inferClinicalGarments } from './clinicalGarments'
export type {
  ClinicalGarments,
  LowerGarmentState,
  RemovableGarmentState,
  UpperGarmentState,
} from './clinicalGarments'
import type {
  CaseSummary,
  DialogueEntry,
  Emotion,
  EducationPayload,
  ExamItem,
  ExamProgress,
  ExamSummary,
  Fact,
  Report,
  SessionStart,
  TurnResult,
} from './types'
export type { ExamProgress } from './types'

export type Phase = 'title' | 'intro' | 'entering' | 'playing' | 'exam' | 'education' | 'report'
export type Busy = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'
/*
 * 3D 진찰 도구 — 선택된 도구는 3D 클릭 메시(ClinicScene)와 HUD(ExamPanel)가 공유한다.
 * 두경부·흉부도 이제 도구다: 발화는 **도구 선택까지만** 하고, 실제 시행은 3D에서 부위를 찍는 것이다
 * (headneck 스펙 §2 "발화=즉시 완료 경로는 제거한다").
 * 예외는 부위 개념이 없는 시진 술기(`thyroid_inspect`·`tremor_exam`) 뿐이다 — TOOL_REGIONS가 빈 배열.
 */
export type ExamToolId =
  // 복부·옆구리
  | 'auscultation' | 'percussion' | 'palpation' | 'cva_tenderness' | 'liver_palpation'
  // 두경부 (headneck 스펙 §3)
  | 'conjunctiva' | 'sclera_exam' | 'thyroid_palpation' | 'oral_exam' | 'thyroid_inspect'
  // 흉부 (chest 스펙 §2)
  | 'heart_auscultation' | 'lung_auscultation' | 'chest_percussion'
  // 시진 — 자세를 유지시켜 관찰 (추가술기 스펙 §1.1)
  | 'tremor_exam'

/*
 * 3D에서 클릭 가능한 환자 신체 영역.
 * 좌우는 전부 **환자 기준**이다 (의사가 보는 화면 기준이 아님) — 우측 요관결석 케이스에서
 * 좌우가 뒤집히면 소견이 통째로 틀리므로 3D 배치(D)도 이 기준을 따른다.
 */
export type AbdomenRegion =
  | 'ruq' | 'luq' | 'rlq' | 'llq'   // 복부 4분면
  | 'flank_r' | 'flank_l'           // 양측 갈비척추각(CVA)
export type HeadNeckRegion =
  | 'eye_r' | 'eye_l'                 // 결막·공막 (양안)
  | 'thyroid_r' | 'thyroid_l'         // 갑상샘 좌·우엽
  | 'oral_tongue' | 'oral_pharynx'    // 구강 — 혀 / 인두
export type ChestRegion =
  | 'aortic' | 'pulmonic' | 'tricuspid' | 'mitral'   // 심장 4판막
  | 'lung_ant_r_up' | 'lung_ant_r_mid' | 'lung_ant_r_low'
  | 'lung_ant_l_up' | 'lung_ant_l_mid' | 'lung_ant_l_low'
  | 'lung_post_r_up' | 'lung_post_r_mid' | 'lung_post_r_low'
  | 'lung_post_l_up' | 'lung_post_l_mid' | 'lung_post_l_low'

/*
 * 클릭 가능한 부위 전수. **ClinicScene의 `ANCHOR_POOL: Record<ExamRegion, ExamAnchor>`가
 * 이 전수를 요구하므로, 3D 담당은 두경부·흉부 앵커를 함께 추가해야 컴파일된다.**
 * (직전 웨이브에서는 앵커가 없어 두경부·흉부를 별도 타입으로 떼어 뒀지만,
 *  그 상태에서는 서버의 "부위 없는 호출 = 항목 1회 완료" 하위호환 경로를 타서
 *  평가표가 요구하는 "양쪽 눈"·"좌우엽"·"4판막"이 발화 한 번으로 통과돼 버렸다.)
 */
export type ExamRegion = AbdomenRegion | HeadNeckRegion | ChestRegion
/** 서버 exam_progress에 등장할 수 있는 모든 부위 id (= ExamRegion. 이름 하위호환용 별칭) */
export type ExamRegionId = ExamRegion

export const ABDOMEN_REGIONS: readonly AbdomenRegion[] =
  ['ruq', 'luq', 'rlq', 'llq', 'flank_r', 'flank_l']
export const HEADNECK_REGIONS: readonly HeadNeckRegion[] =
  ['eye_r', 'eye_l', 'thyroid_r', 'thyroid_l', 'oral_tongue', 'oral_pharynx']
const LUNG_FIELDS: readonly ChestRegion[] = [
  'lung_ant_r_up', 'lung_ant_r_mid', 'lung_ant_r_low',
  'lung_ant_l_up', 'lung_ant_l_mid', 'lung_ant_l_low',
  'lung_post_r_up', 'lung_post_r_mid', 'lung_post_r_low',
  'lung_post_l_up', 'lung_post_l_mid', 'lung_post_l_low',
]
export const CHEST_REGIONS: readonly ChestRegion[] =
  ['aortic', 'pulmonic', 'tricuspid', 'mitral', ...LUNG_FIELDS]

/** 촉진의 2단계 — 얕게 먼저, 깊게 나중 */
export type ExamPass = 'light' | 'deep'

/* 도구 ↔ 허용 부위. store의 검증과 3D 클릭 메시(D)의 active 판정이 같은 표를 봐야 어긋나지 않는다.
 * 빈 배열 = 부위 클릭이 없는 시진 술기 (headneck 스펙 §3의 `thyroid_inspect: []` 그대로). */
export const TOOL_REGIONS: Record<ExamToolId, readonly ExamRegion[]> = {
  auscultation:    ['ruq', 'luq', 'rlq', 'llq'],
  percussion:      ['ruq', 'luq', 'rlq', 'llq'],
  palpation:       ['ruq', 'luq', 'rlq', 'llq'],
  cva_tenderness:  ['flank_r', 'flank_l'],
  // 간촉진은 새 부위를 만들지 않고 기존 우상복부를 쓴다 (추가술기 스펙 §1.2 required_regions:["ruq"])
  liver_palpation: ['ruq'],
  // ── 두경부 (headneck 스펙 §3 표 그대로) ──
  conjunctiva:        ['eye_r', 'eye_l'],
  sclera_exam:        ['eye_r', 'eye_l'],
  thyroid_palpation:  ['thyroid_r', 'thyroid_l'],
  oral_exam:          ['oral_tongue', 'oral_pharynx'],
  thyroid_inspect:    [],   // 시진 — 부위 클릭 없음
  // ── 흉부 (chest 스펙 §2 표 그대로) ──
  heart_auscultation: ['aortic', 'pulmonic', 'tricuspid', 'mitral'],
  lung_auscultation:  LUNG_FIELDS,
  chest_percussion:   LUNG_FIELDS,
  // ── 시진 ──
  tremor_exam:        [],
}

/* 부위 하나를 몸에 대고 유지해야 하는 시간(초).
 * 복부 4종 값은 종전 ClinicScene의 표와 동일하다(회귀 방지). 두경부·흉부는 스펙 수치.
 * ※ 이 표가 단일 진실이다 — 3D(ClinicScene)는 자체 선언을 지우고 여기서 import 한다. */
export const HOLD_SECONDS: Record<ExamToolId, number> = {
  auscultation:    5.0,  // 평가표 "복부청진 ④ 최소 5초 이상"
  percussion:      1.2,  // 두드리는 동작
  palpation:       1.5,
  cva_tenderness:  1.0,  // 두드림
  liver_palpation: 2.0,  // 갈비뼈 아래에서 위로 밀어 올리며 간 끝을 확인
  conjunctiva:       1.2,  // 아랫눈꺼풀을 내려 들여다보는 동작
  sclera_exam:       1.2,
  thyroid_palpation: 2.0,  // 반대편으로 밀고 촉진
  oral_exam:         1.5,
  thyroid_inspect:   0,    // 부위 클릭 없음 (자리 채움)
  heart_auscultation: 3.0, // 평가표 "한 군데서 3초 이상"
  lung_auscultation:  3.0,
  chest_percussion:   1.2,
  // 평가표 손떨림검사 ③ "자세를 유지한 채 최소 10초 이상 관찰" — 부위 홀드가 아니라 **자세 유지** 시간
  tremor_exam:       10.0,
}

/* 부위 클릭이 없고 **자세를 유지**해야 완료되는 시진 술기.
 * 도구를 고른 순간부터 HOLD_SECONDS만큼 유지해야 시행된다(중간에 도구를 바꾸면 취소). */
const SUSTAINED_TOOLS: readonly ExamToolId[] = ['tremor_exam']

/** 환자 제스처 — 도구가 선택된 **동안 유지**된다 (headneck 스펙 §2) */
export type ExamGesture = 'eyes_up' | 'mouth_open' | 'swallow' | 'hands_out' | 'deep_breath'

/* 도구 ↔ 환자 제스처. 도구를 고르면 켜지고, 도구를 바꾸거나 항목이 완료되면 꺼진다.
 * 종전처럼 6초 뒤 자동 해제하면 부위를 다 찍기 전에 눈이 내려가 진찰이 불가능해진다. */
const TOOL_GESTURE: Partial<Record<ExamToolId, ExamGesture>> = {
  conjunctiva: 'eyes_up',
  sclera_exam: 'eyes_up',
  oral_exam: 'mouth_open',
  thyroid_inspect: 'swallow',
  thyroid_palpation: 'swallow',
  tremor_exam: 'hands_out',
  // 폐 청진의 심호흡은 **학생이 지시했을 때만** 유지된다 (deep_breath prep 미시행이면 켜지 않는다).
  // 지시 없이 환자가 알아서 크게 숨쉬면 평가표 흉부청진 ②를 공짜로 통과시키는 셈이 된다.
  lung_auscultation: 'deep_breath',
}

/* 진찰 자세. 평가표가 요구하는 자세를 도구 선택 시점에 맞춘다.
 *  - 복부·간촉진: 눕힌다(무릎을 세운 적 있으면 세운 채로)
 *  - CVA·흉부: "앉은 자세" — 진찰대 걸터앉기
 *  - 두경부: 마주 앉은 자세
 *  - 손떨림·손가락 관절: 책상 소품에 손이 가리지 않도록 진찰대에 걸터앉은 자세 */
const ABDOMEN_TOOLS: readonly ExamToolId[] =
  ['auscultation', 'percussion', 'palpation', 'liver_palpation']
const SIT_EDGE_TOOLS: readonly ExamToolId[] =
  ['cva_tenderness', 'heart_auscultation', 'lung_auscultation', 'chest_percussion', 'tremor_exam']
const SIT_TOOLS: readonly ExamToolId[] =
  ['conjunctiva', 'sclera_exam', 'oral_exam', 'thyroid_inspect', 'thyroid_palpation']

/* 음성 지시 인텐트 → 준비 동작(prep) 항목 id.
 * 평가표가 "제대로 함"의 조건으로 명시한 환자 동작(턱 들기·삼킴·심호흡·"아—" 발성)은
 * 학생이 직접 지시해야 기록된다. 지시하지 않은 동작의 소견을 케이스가 사실로 적어주면
 * 학생은 하지 않은 술기를 했다고 배우게 된다. */
const PREP_INTENTS: Record<string, string> = {
  do_chin_up: 'chin_up',
  do_swallow: 'swallow',
  do_deep_breath: 'deep_breath',
  do_say_ah: 'say_ah',
}

/* 준비 동작 제스처 — 학생이 지시한 순간 환자가 한 번 해 보이는 일시 동작.
 * 도구가 같은 제스처를 유지 중이면 자동 해제하지 않는다(releaseTransientGesture). */
const PREP_GESTURE: Record<string, ExamGesture> = {
  swallow: 'swallow',
  deep_breath: 'deep_breath',
  say_ah: 'mouth_open',
}

/*
 * 진찰 발화(intent) → 진찰 항목(=exam_items의 id = ExamToolId).
 * **모든 진찰은 여기서 '항목 선택'까지만 한다.** required_regions가 있는 항목은 3D에서 부위를
 * 전부 찍어야 시행되고, 없는 항목(시진)만 즉시/유지 후 시행된다 — store.doVoiceExam이 갈라 준다.
 * ※ 여기 없는 항목은 학생이 브라우저에서 시행할 방법이 없다 —
 *   케이스에 새 exam_action을 추가하면 반드시 이 표에 함께 등록해야 한다.
 */
const EXAM_INTENTS: Record<string, ExamToolId> = {
  do_auscultate: 'auscultation',
  do_percuss: 'percussion',
  do_palpate: 'palpation',
  do_cva: 'cva_tenderness',
  do_liver_palpate: 'liver_palpation',
  do_conjunctiva: 'conjunctiva',
  do_sclera: 'sclera_exam',
  do_oral: 'oral_exam',
  do_thyroid_inspect: 'thyroid_inspect',
  do_thyroid: 'thyroid_palpation',
  do_tremor_check: 'tremor_exam',
  do_heart_auscultate: 'heart_auscultation',
  do_lung_auscultate: 'lung_auscultation',
  // ※ chest_percussion(흉부타진)은 인텐트가 아직 없다 — MVP 6케이스 중 쓰는 케이스가 없어서다.
  //    케이스를 붙일 때 backend intent_analyzer에 do_chest_percuss를 3종 세트로 추가하고 여기 등록할 것.
}

/** @deprecated 전부 ExamToolId로 통일됐다. 이름 하위호환용 별칭 */
export type VoiceExamId = ExamToolId

/* 부위 한글 라벨 — 힌트/HUD가 공유 */
export const REGION_LABEL: Record<ExamRegionId, string> = {
  ruq: '우상복부', luq: '좌상복부', rlq: '우하복부', llq: '좌하복부',
  flank_r: '우측 옆구리', flank_l: '좌측 옆구리',
  eye_r: '우안', eye_l: '좌안',
  thyroid_r: '갑상샘 우엽', thyroid_l: '갑상샘 좌엽',
  oral_tongue: '혀', oral_pharynx: '인두',
  aortic: '대동맥판', pulmonic: '폐동맥판', tricuspid: '삼첨판', mitral: '승모판',
  lung_ant_r_up: '우상폐야(전)', lung_ant_r_mid: '우중폐야(전)', lung_ant_r_low: '우하폐야(전)',
  lung_ant_l_up: '좌상폐야(전)', lung_ant_l_mid: '좌중폐야(전)', lung_ant_l_low: '좌하폐야(전)',
  lung_post_r_up: '우상폐야(후)', lung_post_r_mid: '우중폐야(후)', lung_post_r_low: '우하폐야(후)',
  lung_post_l_up: '좌상폐야(후)', lung_post_l_mid: '좌중폐야(후)', lung_post_l_low: '좌하폐야(후)',
}

/** 진행 키 — 서버의 exam_progress와 형식을 맞춘다. passes 없으면 "<region>", 있으면 "<pass>:<region>" */
export function examProgressKey(pass: ExamPass | null | undefined, region: ExamRegionId): string {
  return pass ? `${pass}:${region}` : region
}

/** 진행 키에서 부위 라벨만 뽑는다 — "deep:rlq" → "우하복부" */
export function regionLabelOfKey(key: string): string {
  const r = (key.includes(':') ? key.slice(key.indexOf(':') + 1) : key) as ExamRegionId
  return REGION_LABEL[r] ?? key
}

/*
 * 다음에 시행할 pass를 진행 상태에서 직접 유도한다.
 * examPass 상태만 믿으면 도구를 바꿨다 되돌아왔을 때 이미 끝낸 pass를 가리켜
 * "이미 찍은 부위" 판정에 걸려 클릭이 통째로 먹통이 된다.
 */
function derivePass(item: ExamItem | undefined, prog: ExamProgress | undefined): ExamPass | null {
  const passes = item?.passes
  if (!passes || !passes.length) return null
  const regions = item?.required_regions ?? []
  const done = prog?.done ?? []
  for (const p of passes) {
    if (regions.some((r) => !done.includes(`${p}:${r}`))) return p
  }
  return passes[passes.length - 1]
}

/** 항목이 요구하는 부위 목록. 없거나 빈 배열이면 "부위 클릭이 없는 항목"이다. */
function itemRegions(item: ExamItem | undefined): string[] {
  return item?.required_regions ?? []
}

/* 이 케이스가 배를 드러내야 하는 진찰을 가지고 있는가.
 * 눕는 자세 판정(startExam)과 하의 허리선 판정이 같은 기준을 봐야 어긋나지 않는다. */
const ABDOMEN_EXAM_IDS: readonly string[] =
  ['auscultation', 'percussion', 'palpation', 'cva_tenderness', 'liver_palpation', 'knee_flex']
function hasAbdomenExam(items: ExamItem[]): boolean {
  return items.some((it) => ABDOMEN_EXAM_IDS.includes(it.id))
}

/* 자세 유지형 시진(손떨림)의 타이머 — 도구를 바꾸거나 단계를 벗어나면 취소한다.
 * 화면에 하나뿐인 진찰이라 모듈 스코프 하나로 충분하다. */
let sustainTimer: ReturnType<typeof setTimeout> | null = null
function clearSustainTimer() {
  if (sustainTimer !== null) {
    clearTimeout(sustainTimer)
    sustainTimer = null
  }
}

/*
 * 진찰 자세 — 평가표가 요구하는 자세를 도구 선택 시점에 맞춘다.
 * 무릎을 세운 적이 있으면 복부로 돌아올 때 세운 자세를 유지한다(간촉진 요건).
 */
function poseForTool(
  tool: ExamToolId | null,
  current: 'sit' | 'lie' | 'lie_knees' | 'sit_edge',
  examLog: { action_id: string }[],
): 'sit' | 'lie' | 'lie_knees' | 'sit_edge' {
  if (!tool) return current
  if (ABDOMEN_TOOLS.includes(tool)) {
    return examLog.some((e) => e.action_id === 'knee_flex') ? 'lie_knees' : 'lie'
  }
  if (SIT_EDGE_TOOLS.includes(tool)) return 'sit_edge'
  if (SIT_TOOLS.includes(tool)) return 'sit'
  return current
}

/*
 * 진찰 중 의복은 단순 visible 토글이 아니라 부위별 상태를 가진다.
 * 같은 환자에게 복부를 보인 뒤 신발/양말만 추가로 벗기는 식의 조합을 보존하기 위해
 * 상·하의와 말단 의복을 독립 슬롯으로 관리한다.
 */
/* 의사 발화가 '손/팔을 내밀어 달라'는 요청인지 — 환자 손 내미는 제스처 트리거 */
function isReachRequest(text: string): boolean {
  const t = text.replace(/\s/g, '')
  const part = /(손목|손|팔)/.test(t)
  const act = /(내밀|내미|보여|줘|주세|줄래|펴|올려|들어|이리|만져|진맥|맥좀|맥을)/.test(t)
  return part && act
}

interface GameStore {
  phase: Phase
  sectionStart: number
  sectionTimes: Record<string, number>
  hygienePulse: number
  pauseTimer: () => void
  resumeTimer: () => void
  cases: CaseSummary[]
  session: SessionStart | null
  dialogue: DialogueEntry[]
  trust: number
  anxiety: number
  rapport: number
  disclosedFacts: Fact[]
  hiddenTotal: number
  hiddenUnlocked: number
  turn: number
  maxTurns: number
  emotion: Emotion
  gesture: 'none' | 'reach'
  busy: Busy
  micLevel: number
  lastDelta: { trust: number; anxiety: number } | null
  lastUnlocked: Fact[] | null
  gameOver: 'trust_collapsed' | 'turns_exhausted' | null
  submitOpen: boolean
  report: Report | null
  error: string | null

  // ── CPX 단계 (신체진찰 / 환자교육) ──
  isCpx: boolean
  examItems: ExamItem[]
  examLog: { action_id: string; label: string; finding: string }[]
  examSummary: ExamSummary | null
  lastFinding: string | null
  examBusy: boolean
  /**
   * 항목별 부분 진행 — action_id → 찍은/남은 부위 키.
   * 서버 응답(progress)을 그대로 받아 둔다. 3D(완료 부위 회색 처리)와 HUD(진행률)가 함께 읽는다.
   */
  examProgress: Record<string, ExamProgress>
  /** 현재 촉진 단계. passes 없는 도구에서는 null */
  examPass: ExamPass | null
  // 3D 진찰 자세: 'lie'(누움) → 'lie_knees'(무릎 세움). 구어 "무릎 세워주세요"로 전환.
  // 'sit_edge'는 CVA 압통용 — 평가표가 "앉은 자세"를 요구해 도구 선택 시 자동 전환된다
  examPose: 'sit' | 'lie' | 'lie_knees' | 'sit_edge'
  /**
   * 환자 제스처 — 결막(위 보기)/구강(입 벌리기)/갑상샘(삼키기)/손떨림(양팔 뻗기)/폐청진(심호흡).
   * **도구가 선택된 동안 유지된다.** 도구를 바꾸거나 항목이 완료되면 해제.
   * (준비 지시로 켜진 일시 제스처만 몇 초 뒤 자동 해제 — 그때도 도구가 같은 제스처를 쥐고 있으면 유지)
   */
  examGesture: ExamGesture | null
  /**
   * 자세 유지형 시진(손떨림)이 시작된 시각(ms). null이면 진행 중 아님.
   * HOLD_SECONDS[examTool]만큼 유지돼야 시행된다 — HUD가 이 값으로 유지 막대를 그린다.
   */
  examSustainStart: number | null
  // 선택된 3D 진찰 도구 (HUD ↔ 3D 클릭 메시 공유)
  examTool: ExamToolId | null
  // 3D 클릭/HUD 안내 토스트 메시지 (자동 소멸)
  examHint: string | null
  // 강한 압통 반응 시 화면 진동 트리거 (잠시 true)
  examShake: boolean
  /** 직전 환자측 발화의 화자 — 아이+보호자 케이스에서 보호자('guardian')로 전환됨 */
  lastSpeaker: 'patient' | 'guardian'
  /**
   * 진찰 발화 → 항목 시작. **부위가 있는 항목은 도구 선택까지만** 하고 3D 부위 클릭을 기다린다.
   * 부위가 없는 시진만 여기서 시행된다 (손떨림은 자세를 10초 유지해야, 갑상샘 시진은 즉시).
   */
  doVoiceExam: (actionId: ExamToolId) => void
  // 상·하의/양말/신발의 실제 3D 탈착 상태
  clinicalGarments: ClinicalGarments
  // 클릭 가능한 3D 오브젝트 호버 중 — true면 카메라 패럴랙스를 멈춰 클릭을 쉽게 한다
  cameraHold: boolean
  // 포인터가 2D UI(버튼·패널) 위에 있는 동안 — 카메라 패럴랙스 정지 (버튼 누르러 갈 때 화면이 도는 불편 방지)
  uiHold: boolean
  voiceEnabled: boolean
  volume: number
  musicEnabled: boolean
  sfxEnabled: boolean
  resumable: boolean
  savedPhase: Phase | null
  focusedPanel: 'status' | 'chart' | null

  // 교대근무: 랜덤 순서로 환자를 연속 진료
  queue: string[]
  patientIndex: number
  patientNumber: number // 오늘 N번째 환자 (1-base 표시용)
  loadCases: () => Promise<void>
  startShift: () => Promise<void>
  nextPatient: () => Promise<void>
  startGame: (caseId: string) => Promise<void>
  replay: () => Promise<void>
  beginPlay: () => void
  finishEntering: () => void
  sendText: (text: string) => Promise<void>
  applyTurn: (r: TurnResult) => void
  setBusy: (b: Busy) => void
  setMicLevel: (v: number) => void
  setSubmitOpen: (open: boolean) => void
  submit: (diagnosis: string[], tests: string[], education?: EducationPayload | null) => Promise<void>
  startExam: () => void
  // opts.region이 있으면 부분 진행 호출 — 응답의 progress/current_pass로 상태를 갱신한다
  doExamAction: (actionId: string, opts?: { region?: ExamRegionId; pass?: ExamPass | null }) => Promise<void>
  setExamTool: (t: ExamToolId | null) => void
  setExamHint: (m: string | null) => void
  setClinicalGarments: (next: Partial<ClinicalGarments>) => void
  setCameraHold: (v: boolean) => void
  setUiHold: (v: boolean) => void
  // 3D에서 선택된 도구로 신체 영역을 클릭했을 때의 진찰 처리 (도구↔부위 검증 포함)
  examRegion: (region: ExamRegionId) => void
  finishExam: () => void
  reset: () => void
  setError: (e: string | null) => void
  toggleVoice: () => void
  setVolume: (v: number) => void
  toggleMusic: () => void
  toggleSfx: () => void
  goTitle: () => void
  resume: () => void
  setFocusedPanel: (p: 'status' | 'chart' | null) => void
}


/* 현재 섹션 경과를 누적하고 타이머를 리셋한 패치 객체 */
function rollSection(get: () => GameStore): { sectionTimes: Record<string, number>; sectionStart: number } {
  const { phase, sectionStart, sectionTimes } = get()
  const now = Date.now()
  if (!sectionStart) return { sectionTimes, sectionStart: now }
  return {
    sectionTimes: { ...sectionTimes, [phase]: (sectionTimes[phase] ?? 0) + (now - sectionStart) / 1000 },
    sectionStart: now,
  }
}

export const useGame = create<GameStore>()(
  persist(
    (set, get) => ({
  phase: 'title',
  sectionStart: 0,
  sectionTimes: {},
  hygienePulse: 0,
  cases: [],
  session: null,
  dialogue: [],
  trust: 0,
  anxiety: 0,
  rapport: 0,
  disclosedFacts: [],
  hiddenTotal: 0,
  hiddenUnlocked: 0,
  turn: 0,
  maxTurns: 15,
  emotion: 'neutral',
  gesture: 'none',
  busy: 'idle',
  micLevel: 0,
  lastDelta: null,
  lastUnlocked: null,
  gameOver: null,
  submitOpen: false,
  report: null,
  error: null,
  isCpx: false,
  examItems: [],
  examLog: [],
  examSummary: null,
  lastFinding: null,
  examBusy: false,
  examProgress: {},
  examPass: null,
  examPose: 'lie',
  examTool: null,
  examHint: null,
  examShake: false,
  examGesture: null,
  examSustainStart: null,
  lastSpeaker: 'patient',
  clinicalGarments: freshClinicalGarments(),
  cameraHold: false,
  uiHold: false,
  voiceEnabled: true,
  volume: 1,
  musicEnabled: true,
  sfxEnabled: true,
  resumable: false,
  savedPhase: null,
  focusedPanel: null,

  queue: [],
  patientIndex: 0,
  patientNumber: 0,

  loadCases: async () => {
    try {
      set({ cases: await api.listCases() })
    } catch {
      set({ error: '서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인해주세요.' })
    }
  },

  startShift: async () => {
    const cases = await api.listCases()
    if (!cases.length) {
      set({ error: '사용 가능한 케이스가 없어요. 서버 상태를 확인해주세요.' })
      return
    }
    const queue = [...cases.map((c) => c.case_id)].sort(() => Math.random() - 0.5)
    set({ cases, queue, patientIndex: 0, patientNumber: 1 })
    await get().startGame(queue[0])
  },

  nextPatient: async () => {
    const { queue, patientIndex, patientNumber } = get()
    let next = patientIndex + 1
    let q = queue
    if (next >= q.length) {
      // 한 바퀴 끝 → 새로 섞어서 계속 (직전 환자 연속 방지)
      const last = q[q.length - 1]
      do {
        q = [...q].sort(() => Math.random() - 0.5)
      } while (q.length > 1 && q[0] === last)
      next = 0
    }
    set({ queue: q, patientIndex: next, patientNumber: patientNumber + 1 })
    await get().startGame(q[next])
  },

  startGame: async (caseId) => {
    set({ error: null })
    clearSustainTimer()
    let session: SessionStart
    try {
      session = await api.startSession(caseId)
    } catch {
      set({ error: '게임을 시작할 수 없어요. 서버 상태를 확인해주세요.', phase: 'title' })
      return
    }
    set({
      phase: 'intro',
      session,
      dialogue: [],
      trust: session.state.trust,
      anxiety: session.state.anxiety,
      rapport: session.state.rapport,
      disclosedFacts: session.state.disclosed_facts,
      hiddenTotal: session.state.hidden_total,
      hiddenUnlocked: session.state.hidden_unlocked,
      turn: 0,
      maxTurns: session.max_turns,
      emotion: 'anxious',
      busy: 'idle',
      gameOver: null,
      report: null,
      lastDelta: null,
      lastUnlocked: null,
      resumable: false,
      // CPX 단계 데이터
      isCpx: !!(session.exam_items && session.exam_items.length),
      examItems: session.exam_items ?? [],
      examLog: [],
      examSummary: null,
      lastFinding: null,
      examBusy: false,
      examProgress: {},
      examPass: null,
      examPose: 'lie',
      examTool: null,
      examHint: null,
      examGesture: null,
      examSustainStart: null,
      clinicalGarments: freshClinicalGarments(),
    })
  },

  // 같은 환자 다시 진료 (리포트 → 다시하기)
  replay: async () => {
    const { queue, patientIndex } = get()
    const caseId = queue[patientIndex]
    if (caseId) await get().startGame(caseId)
  },

  beginPlay: () => {
    if (!get().session) return
    set({ phase: 'entering', dialogue: [], emotion: 'anxious' })
  },

  finishEntering: () => {
    const { session, phase } = get()
    if (!session || phase !== 'entering') return
    // 환자가 자리에 앉으면 의사(플레이어)가 먼저 말을 건다 — 환자는 조용히 기다림
    set({ phase: 'playing', dialogue: [], emotion: 'anxious', busy: 'idle', sectionStart: Date.now(), sectionTimes: {} })
  },

  sendText: async (text) => {
    const { session, busy } = get()
    if (!session || !text.trim()) return
    // 턴이 이미 진행 중일 때만 중복 차단. 'transcribing'은 음성→턴 정상 흐름이므로 허용해야 함
    // (마이크 흐름이 busy='transcribing' 상태로 sendText를 부르기 때문)
    if (busy === 'thinking') return
    if (busy === 'speaking') stopSpeaking()
    set((s) => ({
      busy: 'thinking',
      emotion: 'thinking',
      dialogue: [
        ...s.dialogue,
        { turn: s.turn + 1, speaker: 'user', text: text.trim() },
      ],
    }))
    try {
      const r = await api.sendTurn(session.session_id, text)
      get().applyTurn(r)
    } catch (e) {
      stopSpeaking()
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('404')) {
        // 백엔드 재시작 등으로 세션 소멸 — 데드락 방지를 위해 초기화
        set({
          busy: 'idle',
          emotion: 'neutral',
          error: '세션이 만료되었어요. 메인 화면으로 돌아갑니다.',
        })
        setTimeout(() => get().reset(), 2200)
      } else {
        set({
          busy: 'idle',
          emotion: 'neutral',
          error: '응답을 받지 못했어요. 다시 시도해주세요.',
        })
      }
    }
  },

  applyTurn: (r) => {
    const { voiceEnabled } = get()
    // 의사가 "손 내밀어봐 / 손목 좀 줘봐" 류 요청 → 환자가 손을 내미는 제스처
    const lastUser = [...get().dialogue].reverse().find((d) => d.speaker === 'user')?.text ?? ''

    // 자막·HUD·효과음·제스처를 음성 시작 시점에 한 번에 노출 (글과 목소리 동기화)
    let revealed = false
    const reveal = () => {
      if (revealed) return
      revealed = true
      if (r.unlocked_facts.length) sfxUnlock()
      else if (r.delta.trust > 0) sfxTrustUp()
      else if (r.delta.trust < 0) sfxTrustDown()
      if (isReachRequest(lastUser)) {
        set({ gesture: 'reach' })
        setTimeout(() => {
          if (get().gesture === 'reach') set({ gesture: 'none' })
        }, 5500)
      }
      set((s) => ({
        trust: r.state.trust,
        anxiety: r.state.anxiety,
        rapport: r.state.rapport,
        disclosedFacts: r.state.disclosed_facts,
        hiddenTotal: r.state.hidden_total,
        hiddenUnlocked: r.state.hidden_unlocked,
        turn: r.turn,
        maxTurns: r.max_turns,
        emotion: r.emotion,
        lastDelta: { trust: r.delta.trust, anxiety: r.delta.anxiety },
        lastUnlocked: r.unlocked_facts.length ? r.unlocked_facts : null,
        gameOver: r.game_over,
        lastSpeaker: r.speaker === 'guardian' ? 'guardian' as const : 'patient' as const,
        dialogue: [
          ...s.dialogue,
          {
            turn: r.turn,
            speaker: 'patient',
            text: r.speaker === 'guardian' && s.session?.guardian
              ? `(${s.session.guardian.relation}) ${r.patient_text}`
              : r.patient_text,
            emotion: r.emotion,
            unlocked: r.unlocked_facts,
          },
        ],
      }))
      // 신뢰도 붕괴 → 자동으로 제출 화면
      if (r.game_over === 'trust_collapsed') {
        setTimeout(() => set({ submitOpen: true }), 2500)
      }
      // "손소독하겠습니다" 발화 → 손위생 기록 + 손소독 모션 (문진/진찰 어느 단계든)
      if (r.intent_analysis?.intent === 'hand_hygiene') {
        const hasItem = get().examItems.some((it) => it.id === 'hand_hygiene')
        const done = get().examLog.some((e) => e.action_id === 'hand_hygiene')
        if (hasItem && !done) void get().doExamAction('hand_hygiene')
        set({ hygienePulse: Date.now() })
      }
      // 케이스에 있는 항목만 서버로 보낸다. 없는 action_id를 보내면 /exam이 404를 내고
      // store가 "진찰 기록에 실패했어요" 에러를 띄운다 — 학생 잘못이 아닌데 진행이 끊긴다.
      // (가려주기·무릎 세우기는 케이스마다 있고 없고가 갈린다: 두경부 케이스엔 drape가 없다)
      const recordPrep = (id: string): boolean => {
        if (!get().examItems.some((it) => it.id === id)) {
          get().setExamHint('이 환자에게는 필요하지 않은 준비 동작이에요.')
          return false
        }
        void get().doExamAction(id)
        return true
      }
      /* 구체적 진찰 발화("갑상샘 만져보겠습니다")도 **진찰 시작 요청으로 본다.**
       *
       * ⚠️ `doVoiceExam` 은 `phase !== 'exam'` 이면 **아무 말 없이 return 한다.** 그래서 문진 중에
       *   술기를 말하면 화면에 아무 일도 안 일어나고 이유도 안 보인다(사용자 신고 2026-07-26:
       *   "갑상샘 만져보겠다고 했는데 전환 안돼 자꾸 왜 그래").
       *   "신체진찰 시작" 버튼을 없앤 뒤로는 이 경로가 유일한 진입로라 더 자주 걸린다.
       * 실제 CPX 에서도 "갑상샘을 만져보겠습니다" 는 진찰 개시 선언이다 — 별도로
       * "이제 진찰하겠습니다" 를 먼저 말해야 할 이유가 없다.
       * → 케이스가 가진 술기면 `request_exam` 과 똑같이 전환시키고, 전환 후 그 도구를 집어 준다. */
      const specificExamIntent = (() => {
        const ix = r.intent_analysis?.intent
        const toolId = ix ? EXAM_INTENTS[ix] : undefined
        if (!toolId) return undefined
        return get().examItems.some((it) => it.id === toolId) ? toolId : undefined
      })()
      if (specificExamIntent && get().isCpx && !r.game_over && get().phase === 'playing') {
        if (get().examItems.some((it) => it.id === 'explain_consent')) {
          void get().doExamAction('explain_consent')
        }
        setTimeout(() => {
          if (get().phase !== 'playing') return
          get().startExam()
          // 전환 직후 그 술기를 이어서 집는다 (startExam 이 도구를 null 로 리셋하므로 뒤에 와야 한다)
          setTimeout(() => get().doVoiceExam(specificExamIntent), 120)
        }, 2600)
      }
      // "침대에 누우실까요" 등 진찰 권유 → 환자가 협조한 뒤 신체진찰 단계로 전환 (암전)
      if (r.intent_analysis?.intent === 'request_exam' && get().isCpx && !r.game_over && get().phase === 'playing') {
        // 진찰 권유 발화 자체가 설명·동의다 → explain_consent 기록 (전환 시점 누락 방지, PPI 6-2 반영).
        // 진찰 단계 진입 후의 request_exam은 아래 exam 블록에서 별도 처리됨.
        if (get().examItems.some((it) => it.id === 'explain_consent')) {
          void get().doExamAction('explain_consent')
        }
        setTimeout(() => {
          if (get().phase === 'playing') get().startExam()
        }, 2600)
      }
      // ── 진찰 단계: 음성 지시로 준비/자세 수행 (시험이라 화면 안내 없이 학생이 직접 말해야 함) ──
      if (get().phase === 'exam') {
        const ix = r.intent_analysis?.intent
        const age = get().session?.patient.age ?? 30
        const previousGarments = get().clinicalGarments
        const garmentUpdate = inferClinicalGarments(
          lastUser,
          previousGarments,
          age < 18,
        )
        const needsDrapeRecord = Boolean(
          garmentUpdate?.privacyDrape && !previousGarments.privacyDrape,
        )
        if (garmentUpdate) set({ clinicalGarments: garmentUpdate })
        if (ix === 'flex_knees') {
          // "무릎 굽혀/세워주세요" → 3D 환자가 무릎을 세움 + knee_flex 기록.
          // 앉아서 하는 케이스(두경부·흉부)엔 knee_flex 항목이 없으니 자세도 바꾸지 않는다.
          if (recordPrep('knee_flex')) set({ examPose: 'lie_knees' })
        } else if (ix === 'drape' || needsDrapeRecord) {
          // "가려드릴게요 / 옷을 올리겠습니다" → 가려주기 기록 (의복 상태는 위에서 이미 반영됨)
          recordPrep('drape')
        } else if (ix === 'explain_consent' || ix === 'request_exam') {
          // 이미 진찰 중이므로 "진찰하겠습니다/동의 구하겠습니다" 등은 설명·동의로 기록
          recordPrep('explain_consent')
        } else if (ix && PREP_INTENTS[ix]) {
          // 음성 지시로 수행하는 준비 동작 — 턱 들기 / 삼킴 / 심호흡 / "아—" 발성.
          // 평가표가 "제대로 함"의 조건으로 요구하는 환자 동작이라 학생이 직접 지시해야 기록된다.
          // (지시하지 않았는데 케이스가 그 소견을 사실로 적어주면 안 된다 — 거짓 진찰 로그)
          const prepId = PREP_INTENTS[ix]
          if (!get().examItems.some((it) => it.id === prepId)) {
            get().setExamHint('이 환자에게는 필요하지 않은 준비 동작이에요.')
          } else {
            /* ⚠️ **기록(채점)과 동작(연출)을 분리한다.**
             * 종전에는 `examLog` 에 이미 있으면 통째로 건너뛰어서, 한 번 지시한 뒤에는
             * "침 한 번 삼켜보세요" 를 다시 말해도 **환자가 아무 반응도 안 했다**(사용자 신고).
             * 실제 갑상샘 촉진은 좌·우엽을 만지며 삼킴을 **여러 번** 시킨다. 심호흡도 마찬가지다.
             *  · 제스처(환자가 실제로 삼키는 동작) → **지시할 때마다** 재생
             *  · exam_log 기록(채점)               → 최초 1회만 (중복 기록 방지)
             * 도구가 같은 제스처를 유지 중이면 자동 해제하지 않는다
             * (폐 청진 중 "숨 크게 쉬세요" → 청진이 끝날 때까지 큰 호흡이 이어져야 한다). */
            const prepGesture = PREP_GESTURE[prepId]
            if (prepGesture) {
              set({ examGesture: prepGesture })
              // 삼킴은 **소리까지 나야** 실제로 삼킨 것으로 읽힌다. 지시할 때마다 재생한다.
              if (prepGesture === 'swallow') playSwallow()
              setTimeout(() => {
                const cur = get()
                if (cur.examGesture !== prepGesture) return
                if (cur.examTool && TOOL_GESTURE[cur.examTool] === prepGesture) return
                set({ examGesture: null })
              }, 6000)
            }
            if (!get().examLog.some((e) => e.action_id === prepId)) {
              void get().doExamAction(prepId)
            }
          }
        } else {
          // 진찰 발화 → **항목 선택까지만**. required_regions가 있는 항목은 3D에서 부위를 전부
          // 찍어야 시행되고(headneck 스펙 §2), 부위가 없는 시진만 doVoiceExam이 곧바로/유지 후 시행한다.
          let examId = ix ? EXAM_INTENTS[ix] : undefined
          // [의학리뷰 #6] 결막과 공막은 평가표상 **별개 술기**다. "공막 볼게요"가 빈혈 케이스에서
          // 결막검사로 둔갑하면 학생은 하지 않은 술기를 했다고 배운다. 그래서 명시 발화는 그대로 두고,
          // 서버가 모호하다고 표시한 발화("눈 좀 볼게요")만 케이스가 가진 눈 항목으로 돌린다.
          if (
            (examId === 'conjunctiva' || examId === 'sclera_exam')
            && r.intent_analysis?.eye_target_ambiguous
          ) {
            const eyeItem = get().examItems.find(
              (it) => it.id === 'conjunctiva' || it.id === 'sclera_exam',
            )?.id as 'conjunctiva' | 'sclera_exam' | undefined
            if (eyeItem) examId = eyeItem
          }
          // 청진도 같은 원리다. "청진하겠습니다"는 복부(do_auscultate)로 떨어지는데, 공황장애처럼
          // 흉부 청진만 있는 케이스에서는 있지도 않은 복부 4분면이 떠서 학생이 막힌다.
          // 부위를 지목하지 않은 발화만(ausc_target_ambiguous) 케이스가 가진 청진으로 돌린다.
          // 심장·폐를 둘 다 가진 케이스는 **아직 안 한 것**을 고른다 — 두 번 말하면 둘 다 된다.
          const AUSC: ExamToolId[] = ['auscultation', 'heart_auscultation', 'lung_auscultation']
          if (examId && AUSC.includes(examId) && r.intent_analysis?.ausc_target_ambiguous) {
            const done = new Set(get().examLog.map((e) => e.action_id))
            const owned = get().examItems
              .filter((it) => AUSC.includes(it.id as ExamToolId))
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            const next = owned.find((it) => !done.has(it.id)) ?? owned[0]
            if (next) examId = next.id as ExamToolId
          }
          if (examId) {
            get().doVoiceExam(examId)
            // 안내 토스트("복부에 6초간 꾹 눌러 대세요")는 표시하지 않는다 (사용자 요청)
          }
        }
      }
    }

    if (voiceEnabled) {
      // 음성 받아오는 동안은 '생각 중'(점) 유지 → 목소리 시작될 때 글이 같이 뜸
      const voiceOf = r.speaker === 'guardian' && get().session?.guardian
        ? get().session!.guardian!
        : get().session?.patient
      speak(r.patient_text, r.emotion, {
        gender: voiceOf?.gender,
        age: voiceOf?.age,
        onStart: () => {
          reveal()
          set({ busy: 'speaking' })
        },
        onEnd: () => {
          set({ busy: 'idle' })
        },
      })
      // 안전망 — TTS가 *완전히 실패*했을 때만 글을 강제로 띄운다.
      // (정상 합성은 ~1.5~3초 걸리므로, 그 전에 폴백이 글을 먼저 띄우면 글↔목소리가 어긋남.
      //  6초 이상 음성이 시작 안 되면 그때만 글을 보여줘 데드락 방지)
      setTimeout(() => {
        reveal()
        if (get().busy === 'thinking') set({ busy: 'idle' })
      }, 6000)
    } else {
      reveal()
      set({ busy: 'idle' })
    }
  },

  /* 일시정지: 현재 섹션 경과를 누적하고 타이머 정지 / 재개: 다시 시작 */
  pauseTimer: () => {
    if (!get().sectionStart) return
    set({ ...rollSection(get), sectionStart: 0 })
  },
  resumeTimer: () => {
    if (get().sectionStart) return
    set({ sectionStart: Date.now() })
  },

  setBusy: (b) => set({ busy: b }),
  setMicLevel: (v) => set({ micLevel: v }),
  setSubmitOpen: (open) => set({ submitOpen: open }),
  setFocusedPanel: (p) => set({ focusedPanel: p }),

  submit: async (diagnosis, tests, education = null) => {
    const { session } = get()
    if (!session) return
    stopSpeaking()
    const rolled = rollSection(get)
    set(rolled)
    const report = await api.submit(session.session_id, diagnosis, tests, education, rolled.sectionTimes)
    set({ report, phase: 'report', submitOpen: false, busy: 'idle' })
  },

  // 문진 → 신체진찰 단계 진입 (암전 전환)
  startExam: () => {
    const { session, isCpx } = get()
    if (!session || !isCpx) return
    stopSpeaking()
    clearSustainTimer()
    // 복부 진찰 항목이 있으면 눕고, 두경부·흉부(결막·갑상샘·구강·심폐 청진) 위주 케이스는 앉은 채 진찰.
    // 간촉진은 평가표가 "침대에 눕혀 무릎을 세운 상태"를 요구하므로 반드시 눕는 쪽이다.
    const hasAbdomen = hasAbdomenExam(get().examItems)
    set({
      ...rollSection(get),
      phase: 'exam',
      busy: 'idle',
      lastFinding: null,
      examProgress: {},
      examPass: null,
      examPose: hasAbdomen ? 'lie' : 'sit',
      examTool: null,
      examHint: null,
      examShake: false,
      examGesture: null,
      examSustainStart: null,
      clinicalGarments: freshClinicalGarments(),
    })
  },

  // 신체진찰 행위 1건 — 서버 기록 + 이번 부위의 finding 표시
  doExamAction: async (actionId, opts) => {
    const { session, examBusy } = get()
    if (!session || examBusy) return
    set({ examBusy: true })
    try {
      const r = await api.examAction(session.session_id, actionId, opts)
      // 준비 단계(손위생·설명동의·가려주기·무릎세움)는 안내 멘트("환자가 무릎을 세워…")를 띄우지 않는다.
      const PREP_IDS = ['hand_hygiene', 'explain_consent', 'drape', 'knee_flex']
      const isPrep = PREP_IDS.includes(actionId)
      // 구버전 응답(required_regions 없는 11개 케이스)엔 complete가 없다 → 종전처럼 1회로 완료 취급
      const complete = r.complete !== false
      const prevPass = get().examPass
      set({
        examLog: r.exam_log,
        examSummary: r.summary,
        examBusy: false,
        ...(r.progress ? { examProgress: { ...get().examProgress, [actionId]: r.progress } } : {}),
        ...(opts?.region ? { examPass: r.current_pass ?? null } : {}),
        // 소견은 찍을 때마다 갱신하되, 도구(체스트피스/손)는 **항목이 끝났을 때만** 내려놓는다.
        // 남은 부위를 계속 찍어야 하므로 도구를 해제하면 흐름이 끊긴다.
        // 항목이 끝나면 제스처(위 보기·입 벌림·양팔 뻗기)도 함께 푼다 — 환자를 계속 그 자세로 두지 않는다.
        ...(isPrep ? {} : {
          lastFinding: r.finding,
          ...(complete ? {
            examTool: null,
            examSustainStart: null,
            // 제스처는 **그 도구가 쥐고 있던 경우에만** 푼다. 갑상샘 시진처럼 도구 없이 즉시
            // 시행되는 항목은 방금 켠 삼킴 연출이 응답 도착과 동시에 꺼져 버린다.
            ...(get().examTool === actionId ? { examGesture: null } : {}),
          } : {}),
        }),
        ...(actionId === 'knee_flex' ? { examPose: 'lie_knees' as const } : {}),
        /* ⚠️ `drape` 항목을 **기록**하는 것과 3D 에서 **천을 덮는 것**은 별개다. 여기서는 기록만 한다.
         *
         * 종전에는 이 자리에서 `privacyDrape: true` + 상의 올리기 + 바지 내리기를 한꺼번에 했다.
         * 그런데 `drape` 채점 항목의 이름이 "가려주기/**필요 부위만 노출**"이라 백엔드 의도 정규식이
         * `걷어`·`옷.{0,6}(올|걷|벗|풀|내)` 까지 포함한다 — 즉 **"옷 좀 걷어주세요"(노출)도 `drape` 로 잡힌다.**
         * 그래서 학생이 천 얘기를 한 적이 없는데 천이 덮였다(사용자 신고 2026-07-26:
         * "천 얘기 안 했는데 자꾸 천 덮어주는데").
         * 채점 관점에서 노출과 가려주기를 같은 항목으로 묶는 건 맞다 — 틀린 건 **그걸 3D 상태로 옮긴 것**이다.
         *
         * → 의복·천 상태는 발화 추론(`inferClinicalGarments`)만 담당한다. 그쪽은
         *   "천 덮어드리겠습니다" 류에만 `privacyDrape` 를 켜도록 이미 분리돼 있다. */
      })
      if (!isPrep && complete) clearSustainTimer()
      // 청진/타진 즉시 피드백 사운드 (장음·심음·폐음은 실제 임상 녹음, 타진음은 자체 합성 — 둘 다 상업안전).
      // 항목 완료 1회가 아니라 **부위를 찍을 때마다** 울려야 4분면을 하나씩 듣는 느낌이 난다.
      // 심음·폐음은 케이스가 명시한 region_findings.sound(서버가 r.sound로 전달)를 그대로 쓴다 —
      // 소견 텍스트 추정은 문구를 조금만 다듬어도 조용히 깨진다.
      /* 복부 청진음은 **홀드 도중 4초 지점**에서 이미 울렸다(ClinicScene 의 부위 마커).
         여기서 또 울리면 손을 뗀 뒤 같은 소리가 한 번 더 나서 겹친다.
         심음·폐음은 부위 클릭이 아닌 경로로도 들어와서 그대로 둔다. */
      else if (actionId === 'percussion' || actionId === 'chest_percussion') playPercussion(r.sound, r.finding)
      else if (actionId === 'heart_auscultation') playHeartSound(r.sound)
      else if (actionId === 'lung_auscultation') playLungSound(r.sound)
      // 부분 진행 안내 — 남은 부위, light→deep 전환.
      // 손위생 미시행이면 examRegion이 띄운 경고가 더 중요하므로 이번 클릭에선 덮어쓰지 않는다.
      if (opts?.region && !complete && get().examLog.some((e) => e.action_id === 'hand_hygiene')) {
        if (prevPass === 'light' && r.current_pass === 'deep') {
          get().setExamHint('이제 같은 4분면을 깊게 촉진하세요.')
        } else {
          const cur = r.current_pass
          const rest = (r.progress?.remaining ?? [])
            // passes가 있는 항목은 지금 해야 할 pass의 부위만 남은 부위로 안내한다
            .filter((k) => !cur || !k.includes(':') || k.startsWith(`${cur}:`))
            .map(regionLabelOfKey)
          const labels = [...new Set(rest)]
          if (labels.length) get().setExamHint(`남은 부위: ${labels.join(', ')}`)
        }
      }
      // 촉진/CVA 등 환자 반응 — 표정 변화 + 대사(TTS) + 강한 압통이면 화면 진동
      const reaction = r.reaction
      if (reaction) {
        set({ emotion: reaction.emotion })
        if (reaction.intensity === 'strong') {
          set({ examShake: true })
          setTimeout(() => set({ examShake: false }), 600)
        }
        if (reaction.line && get().voiceEnabled) {
          speak(reaction.line, reaction.emotion, { gender: get().session?.patient.gender, age: get().session?.patient.age })
        }
      }
    } catch {
      set({ examBusy: false, error: '진찰 기록에 실패했어요. 다시 시도해주세요.' })
    }
  },

  /* 3D 클릭 메시 ↔ HUD 가 공유하는 도구 선택.
   * 평가표가 요구하는 자세를 도구별로 맞추고(복부=눕힘 / CVA·흉부=걸터앉기 / 두경부·손떨림=앉음),
   * 제스처는 **도구가 선택된 동안 유지**한다(headneck 스펙 §2 — 6초 자동 해제 금지).
   * **옷은 건드리지 않는다** — 노출은 학생 발화로만 이뤄진다(아래 주석 참조). */
  setExamTool: (t) => {
    const { examPose, examLog, examItems, examProgress } = get()
    // 케이스에 없는 도구는 아예 고르지 않는다. 고르면 3D 클릭이 서버에 없는 action_id를 보내
    // /exam이 404를 내고(예: 공황 케이스에 'auscultation', 간부전 케이스에 'palpation') 진찰이 통째로 막힌다.
    if (t && !examItems.some((it) => it.id === t)) {
      get().setExamHint('이 환자에게는 필요하지 않은 진찰이에요.')
      return
    }
    // 도구가 바뀌면 유지형 시진(손떨림)은 취소된다 — 평가표의 "자세를 유지한 채" 요건.
    clearSustainTimer()
    const pose = poseForTool(t, examPose, examLog)
    // 촉진처럼 pass가 있는 항목은 도구를 고른 시점에 다음 단계를 정해 둬야 HUD가 '얕게/깊게'를 바로 표시한다
    const pass = t ? derivePass(examItems.find((it) => it.id === t), examProgress[t]) : null
    let gesture: ExamGesture | null = t ? TOOL_GESTURE[t] ?? null : null
    // 심호흡은 학생이 지시했을 때만 유지한다 (지시 없이 환자가 알아서 크게 숨쉬면 평가표 흉부청진 ②가 공짜다)
    if (gesture === 'deep_breath' && !examLog.some((e) => e.action_id === 'deep_breath')) gesture = null
    /* ⚠️ **도구를 고르는 것만으로 옷을 벗기지 않는다** (사용자 지시 2026-07-26:
     *   "옷을 걷어달라고 해야 걷는 거 아닌가").
     *
     * 종전에는 복부 도구를 고르면 하의 허리선을 자동으로 내렸다([결함3] — 공식 평가표의
     * 복부 노출 범위가 "칼돌기~두덩결합"인데 상의만 걷으면 배꼽 아래 2분면이 바지에 남아서였다).
     * 노출 **범위**에 대한 그 진단은 지금도 맞다. 틀린 것은 **계기**였다:
     *   · 실제 CPX 에서 노출은 학생이 **환자에게 말해서** 얻어내는 것이고,
     *     그 자체가 채점 항목이다(`drape` = "가려주기/필요 부위만 노출").
     *   · 도구 선택만으로 옷이 벗겨지면 **채점 항목을 공짜로 통과시키는 셈**이고,
     *     학생이 한마디도 안 했는데 환자 옷이 내려가는 그림이 된다.
     * → 노출은 발화 경로(`inferClinicalGarments`)만 담당한다. "바지 좀 내려주세요",
     *   "배 좀 볼게요" 같은 지시에 반응하며, 그쪽은 상·하의 "내리다"의 의미 반전까지
     *   처리한다(발화 18종 검증 완료).
     * 노출을 안 하고 진찰하면 마커가 옷 위에 앉는데, 그건 결함이 아니라 **학생이 빠뜨린 것**이다. */
    set({
      examTool: t,
      examPose: pose,
      examPass: pass,
      examGesture: gesture,
      examSustainStart: null,
    })
    /* 자세가 바뀌면 **환자가 자리를 잡는 동안 부위를 못 누른다.**
     * 3D 는 앵커가 정착(`ANCHOR_SETTLE`)하기 전까지 부위 그룹을 통째로 숨긴다 —
     * 정착 전 좌표는 아직 의자에 앉은 몸 기준이라, 빈 침대 위에 마커가 떠서 눌리는 사고가 있었다.
     * 문제는 그 동안 **아무 안내가 없어서** 눌러도 반응이 없는 것처럼 보인다는 것이다.
     * 실측(문진 중 "청진하겠습니다"): 도구 선택 +6초 → 앵커 정착 +14초. 그 8초가 통째로 먹통이다.
     * (사용자 신고 2026-07-26: "청진하겠습니다 클릭이 안돼")
     * → 자세가 실제로 바뀌었을 때만 안내를 띄운다. 같은 자세면 정착이 이미 끝나 있어 불필요하다. */
    if (t && pose !== examPose) {
      get().setExamHint('환자가 자세를 잡고 있어요. 잠시 후 부위를 눌러주세요.')
    }
  },

  /* 진찰 발화 → 항목 시작. **여기서 항목이 완료되는 것은 부위 개념이 없는 시진뿐이다.**
   *
   * 종전에는 두경부·흉부가 부위 없는 호출을 보내 서버의 하위호환 분기
   * (main.py exam_action: region이 없으면 required 전부를 채움)를 타고 발화 한 번에 완료됐다.
   * 그러면 평가표가 요구하는 "양쪽 눈"·"좌우엽"·"4판막"이 시행되지 않았는데 시행으로 기록된다.
   *  · required_regions가 있는 항목  → 도구 선택까지만. 3D에서 부위를 전부 찍어야 완료.
   *  · 부위가 없고 유지가 필요한 항목(손떨림) → 도구 선택 + 자세 유지 타이머(10초).
   *  · 부위도 유지도 없는 항목(갑상샘 시진) → 즉시 시행. 완료 조건인 prep은 서버가 채점한다. */
  doVoiceExam: (actionId) => {
    const { examItems, examLog } = get()
    if (get().phase !== 'exam') return
    const item = examItems.find((it) => it.id === actionId)
    if (!item) {
      get().setExamHint('이 환자에게는 필요하지 않은 진찰이에요.')
      return
    }
    if (examLog.some((e) => e.action_id === actionId)) {
      get().setExamHint('이미 시행한 진찰이에요.')
      return
    }
    // 복부 진찰(examRegion)과 같은 원칙 — 손위생을 안 했으면 알려만 주고 진행은 막지 않는다.
    // 케이스에 hand_hygiene 항목이 있을 때만 띄운다 (없는 케이스에 헛경고를 주지 않기 위해)
    if (examItems.some((it) => it.id === 'hand_hygiene')
      && !examLog.some((e) => e.action_id === 'hand_hygiene')) {
      get().setExamHint('진찰 전 손위생(손소독제)을 먼저 하는 것이 원칙이에요.')
    }

    // ① 부위를 찍어야 하는 항목 — 도구 선택까지만 (제스처·자세는 setExamTool이 잡는다)
    if (itemRegions(item).length > 0) {
      get().setExamTool(actionId)
      return
    }

    // ② 자세 유지형 시진 — 평가표 손떨림검사 ③ "자세를 유지한 채 최소 10초 이상 관찰"
    if (SUSTAINED_TOOLS.includes(actionId)) {
      get().setExamTool(actionId)          // hands_out 제스처 + 앉은 자세
      if (get().examTool !== actionId) return   // 케이스에 없어 선택이 거부된 경우
      const startedAt = Date.now()
      set({ examSustainStart: startedAt })
      clearSustainTimer()
      sustainTimer = setTimeout(() => {
        sustainTimer = null
        const s = get()
        // 도구를 바꿨거나 단계를 벗어났으면 취소 — 유지하지 않은 관찰을 시행으로 기록하지 않는다
        if (s.phase !== 'exam' || s.examTool !== actionId || s.examSustainStart !== startedAt) return
        if (s.examLog.some((e) => e.action_id === actionId)) return
        set({ examSustainStart: null })
        void get().doExamAction(actionId)
      }, HOLD_SECONDS[actionId] * 1000)
      return
    }

    // ③ 부위도 유지도 없는 시진(갑상샘 시진) — 즉시 시행. 턱 들기·삼킴 prep은 서버가 채점한다.
    if (get().examBusy) return
    const gesture = TOOL_GESTURE[actionId]
    if (gesture) {
      set({ examGesture: gesture })
      setTimeout(() => {
        const cur = get()
        if (cur.examGesture !== gesture) return
        if (cur.examTool && TOOL_GESTURE[cur.examTool] === gesture) return
        set({ examGesture: null })
      }, 6000)
    }
    void get().doExamAction(actionId)
  },

  // 클릭 가능한 3D 오브젝트 호버 시 카메라 정지 (클릭 쉽게)
  setCameraHold: (v) => set({ cameraHold: v }),
  setUiHold: (v) => set({ uiHold: v }),

  // 안내 토스트 — 잠시 뒤 자동 소멸 (3D 클릭/HUD 공용)
  setExamHint: (m) => {
    set({ examHint: m })
    if (m) {
      setTimeout(() => {
        if (get().examHint === m) set({ examHint: null })
      }, 2600)
    }
  },

  setClinicalGarments: (next) => set((state) => ({
    clinicalGarments: { ...state.clinicalGarments, ...next },
  })),

  /* 3D에서 환자 신체 영역 클릭 → 선택 도구로 그 부위를 진찰.
   * 부위를 나눠 찍는 항목은 필요한 부위를 전부 찍어야 서버가 exam_log에 기록(=채점)한다. */
  examRegion: (region) => {
    const { examTool, examItems, examLog, examProgress, examBusy } = get()
    if (!examTool) {
      /* ⚠ "진찰 도구를 선택하세요" 는 틀린 안내다 — 갑상샘·복부 촉진은 **맨손**으로 하는 술기라
         학생이 "무슨 도구?" 로 읽는다(사용자 신고 2026-07-26).
         그리고 이 게임에는 도구 버튼이 없다. 술기는 **말로** 시작한다("갑상샘 촉진하겠습니다").
         그러니 안내도 도구가 아니라 **말로 시작하라**고 해야 한다. */
      get().setExamHint('먼저 무엇을 할지 환자에게 말해주세요. 예: "복부를 촉진하겠습니다"')
      return
    }
    // 도구↔부위 검증은 TOOL_REGIONS 한 곳만 본다 (3D의 클릭 활성 판정과 동일 기준).
    // 안내 문구는 **해부학적 방향**만 알려준다 — 남은 부위를 세어 주면 체크리스트가 된다(시험).
    if (!TOOL_REGIONS[examTool].includes(region)) {
      get().setExamHint(
        examTool === 'cva_tenderness' ? 'CVA 압통은 옆구리/등 쪽을 두드려야 해요.'
          : examTool === 'liver_palpation' ? '간은 오른쪽 갈비뼈 모서리 아래에서 만져요.'
            : ABDOMEN_TOOLS.includes(examTool) ? '청진·타진·촉진은 복부에서 하세요.'
              : '이 진찰을 하는 부위가 아니에요.',
      )
      return
    }
    if (examBusy) return
    // 항목이 이미 완료돼 exam_log에 올라갔으면 더 찍을 게 없다
    if (examLog.some((e) => e.action_id === examTool)) return
    const item = examItems.find((it) => it.id === examTool)
    const pass = derivePass(item, examProgress[examTool])
    // 같은 (pass, 부위)를 다시 찍은 경우 — 조용히 무시 (연타/드래그 방지)
    if (examProgress[examTool]?.done.includes(examProgressKey(pass, region))) return
    // 손위생은 막지 않고 힌트만 — 진행을 끊지 않고 채점에서 감점되게 두는 것이 기존 동작
    if (!examLog.some((e) => e.action_id === 'hand_hygiene')) {
      get().setExamHint('진찰 전 손위생(손소독제)을 먼저 하는 것이 원칙이에요.')
    }
    void get().doExamAction(examTool, { region, pass })
  },

  // 신체진찰 마치기 → 환자교육 단계
  finishExam: () => {
    if (!get().session) return
    clearSustainTimer()
    set({
      ...rollSection(get),
      phase: 'education',
      busy: 'idle',
      examTool: null,
      examGesture: null,
      examSustainStart: null,
      clinicalGarments: freshClinicalGarments(),
    })
  },

  reset: () => {
    stopSpeaking()
    clearSustainTimer()
    set({
      phase: 'title',
  sectionStart: 0,
  sectionTimes: {},
  hygienePulse: 0,
      session: null,
      dialogue: [],
      report: null,
      gameOver: null,
      submitOpen: false,
      busy: 'idle',
      error: null,
      queue: [],
      patientIndex: 0,
      patientNumber: 0,
      resumable: false,
      isCpx: false,
      examItems: [],
      examLog: [],
      examSummary: null,
      lastFinding: null,
      examBusy: false,
      examProgress: {},
      examPass: null,
      examPose: 'lie',
      examTool: null,
      examHint: null,
      examGesture: null,
      examSustainStart: null,
      clinicalGarments: freshClinicalGarments(),
    })
  },

  setError: (e) => set({ error: e }),
  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v))
    setMasterVolume(vol)
    set({ volume: vol })
  },
  toggleMusic: () => {
    const next = !get().musicEnabled
    setBgmEnabled(next)
    set({ musicEnabled: next })
  },
  toggleSfx: () => {
    const next = !get().sfxEnabled
    setSfxEnabled(next)
    // 룸톤은 음악이 아니라 환경음이므로 효과음 토글을 따른다
    setRoomToneEnabled(next)
    set({ sfxEnabled: next })
  },
  // 진료 중 메인으로 — 게임 상태는 보존하고 '이어하기' 가능하게
  goTitle: () => {
    stopSpeaking()
    const { session, phase } = get()
    const inGame = !!session && (phase === 'playing' || phase === 'entering' || phase === 'intro' || phase === 'exam' || phase === 'education')
    // 이어하기 시 같은 단계로 복귀하도록 현재 단계를 보존 (entering/intro는 playing으로)
    const savedPhase: Phase = phase === 'exam' || phase === 'education' ? phase : 'playing'
    set({ phase: 'title', resumable: inGame, savedPhase, busy: 'idle', submitOpen: false })
  },
  // 이어하기 — 보존된 진료로 복귀
  resume: () => {
    if (!get().session) return
    set({ phase: get().savedPhase ?? 'playing', busy: 'idle', resumable: false })
  },
  toggleVoice: () => {
    const next = !get().voiceEnabled
    if (!next) stopSpeaking()
    set({ voiceEnabled: next })
  },
    }),
    {
      name: 'patient-talk-game',
      // 새 탭은 새 게임, 새로고침/HMR은 게임 유지
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        phase: s.phase,
        session: s.session,
        queue: s.queue,
        patientIndex: s.patientIndex,
        patientNumber: s.patientNumber,
        dialogue: s.dialogue,
        trust: s.trust,
        anxiety: s.anxiety,
        rapport: s.rapport,
        disclosedFacts: s.disclosedFacts,
        hiddenTotal: s.hiddenTotal,
        hiddenUnlocked: s.hiddenUnlocked,
        turn: s.turn,
        maxTurns: s.maxTurns,
        emotion: s.emotion,
        gameOver: s.gameOver,
        report: s.report,
        isCpx: s.isCpx,
        examItems: s.examItems,
        examLog: s.examLog,
        examSummary: s.examSummary,
        // 새로고침/HMR로 진행 중이던 부분 진찰(4분면 2/4 같은 상태)이 날아가지 않게 함께 보존
        examProgress: s.examProgress,
        examPass: s.examPass,
        lastFinding: s.lastFinding,
        clinicalGarments: s.clinicalGarments,
        savedPhase: s.savedPhase,
        voiceEnabled: s.voiceEnabled,
        volume: s.volume,
        musicEnabled: s.musicEnabled,
        sfxEnabled: s.sfxEnabled,
        resumable: s.resumable,
      }),
      // 저장된 볼륨/음악/효과음 설정을 오디오에 복원 (재생은 사용자 제스처 후 시작)
      onRehydrateStorage: () => (state) => {
        if (state) {
          setMasterVolume(state.volume ?? 1)
          setBgmEnabled(state.musicEnabled ?? true)
          setSfxEnabled(state.sfxEnabled ?? true)
          setRoomToneEnabled(state.sfxEnabled ?? true)
        }
      },
    },
  ),
)

// 디버그/테스트 훅 — 콘솔/자동화에서 상태를 직접 조작 (프로덕션 동작 영향 없음)
if (typeof window !== 'undefined') {
  ;(window as unknown as { __game?: typeof useGame }).__game = useGame
}
