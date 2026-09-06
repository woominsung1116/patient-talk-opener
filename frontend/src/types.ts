export type Emotion =
  | 'neutral'
  | 'anxious'
  | 'defensive'
  | 'calm'
  | 'warm'
  | 'relieved'
  | 'hesitant_relieved'
  | 'guarded'
  | 'hurt'
  | 'shocked'
  | 'annoyed'
  | 'thinking'
  | 'speaking'

export interface PublicState {
  trust: number
  anxiety: number
  rapport: number
  disclosed_facts: Fact[]
  hidden_total: number
  hidden_unlocked: number
}

export interface Fact {
  key: string
  label: string
  value: string
}

export interface CaseSummary {
  case_id: string
  title: string
  subtitle: string
  difficulty: number
  patient: {
    name: string
    age: number
    gender: string
    occupation?: string
    body_type?: string | null
    signs?: string[]
    appearance?: AvatarAppearance
  }
  guardian?: { name: string; relation: string; gender: string; age: number } | null
  chief_complaint?: string
  diagnosis_label?: string
  teaching_points?: string[]
  max_turns: number
}

/** 교수자 대시보드에서 편집하고 3D 렌더러가 즉시 소비하는 임상 외형값. */
export interface AvatarAppearance {
  pain_level: number
  /** null이면 지속통, 숫자면 해당 초 간격으로 심해졌다 잦아드는 산통. */
  pain_colicky_period: number | null
  /** 통증과 별개로 배를 감싸고 웅크리는 정도. */
  guarding: number
  /** 산통처럼 가만히 있지 못하고 뒤척이는 정도. */
  restlessness: number
  scleral_icterus: number
  skin_jaundice: number
  conjunctival_pallor: number
  cyanosis: number
  diaphoresis: number
  sclera_color: string
  skin_tint_color: string
  conjunctiva_color: string
  goiter: boolean
  atrophic_glossitis: boolean
  /** 손가락 관절 주위 연부조직 부종. 좌우는 환자 기준이다. */
  finger_swelling_left: number
  finger_swelling_right: number
  /** 종아리/발목 부종. 한쪽만 올려 비대칭도 표현한다. */
  leg_edema_left: number
  leg_edema_right: number
  rash_level: number
  rash_region: ClinicalSkinRegion
  rash_color: string
  bruise_level: number
  bruise_region: ClinicalSkinRegion
  bruise_color: string
}

export type ClinicalSkinRegion =
  | 'face'
  | 'torso'
  | 'left_arm'
  | 'right_arm'
  | 'left_leg'
  | 'right_leg'

export interface DiagnosisOption {
  id: string
  label: string
}

export interface TestOption {
  id: string
  label: string
}

export interface ScoringWeights {
  history_taking: number
  physical_exam: number
  patient_education: number
  ppi: number
}

export interface ExamItem {
  id: string
  label: string
  type: 'prep' | 'exam_action'
  points: number
  order: number
  finding?: string
  ppi?: string[]
  must_precede?: string[]
  /**
   * 이 부위를 "전부" 찍어야 항목이 완료된다(순서 자유).
   * 비어 있거나 없으면 부위 개념이 없는 항목 — 발화 한 번(또는 자세 유지)으로 완료된다.
   * store.doVoiceExam이 이 값으로 "도구 선택 vs 즉시 시행"을 가른다.
   */
  required_regions?: string[]
  /** 이 항목 전에 지시했어야 하는 준비 동작(턱 들기·삼킴·심호흡·"아—"·무릎 세우기·가려주기).
   *  완료를 막지는 않고 서버 채점에서 감점된다 — 게임이 멈추면 안 되기 때문(scoring._score_exam). */
  requires_prep?: string[]
  /** 부위별 sound가 없을 때 쓰는 항목 대표 청진음 키 */
  sound?: string | null
  /** 얕게→깊게 2단계가 필요한 항목(촉진)만. 각 pass마다 required_regions를 전부 돌아야 한다 */
  passes?: ('light' | 'deep')[]
  /** 부위/패스별 소견·반응. 키는 passes 없으면 "<region>", 있으면 "<pass>:<region>" */
  region_findings?: Record<string, { finding?: string; reaction?: ExamReaction }>
  /** 압통 부위 — 설정되면 그 부위를 가장 마지막에 진찰해야 감점이 없다 */
  tender_region?: string | null
}

export interface EvidenceOption {
  id: string
  label: string
  correct?: boolean
}

export interface EducationItem {
  id: string
  label: string
  kind: 'diagnosis_explanation' | 'test_plan' | 'treatment' | 'complication'
  points: number
  purpose?: string
  rubric?: { good?: string; ok?: string; miss?: string }
  evidence_options?: EvidenceOption[]
}

export interface ExamSummary {
  order: string[]
  performed: string[]
  first_exam_index: number | null
  order_ok: boolean
  /** must_precede 위반 목록 — 페널티 문구를 정확히 만들기 위해 구조화해서 받는다 */
  order_violations?: { item: string; before: string; kind: string }[]
  /** 케이스가 가진 exam_item id 목록 — PPI 6-3/6-4의 na 판정 근거 */
  exam_item_ids?: string[]
}

/** 항목 하나의 부분 진행 상태. done/remaining은 "<region>" 또는 "<pass>:<region>" 키 */
export interface ExamProgress {
  done: string[]
  remaining: string[]
  total: number
}

export interface ExamReaction {
  emotion: Emotion
  line: string
  intensity: 'none' | 'mild' | 'strong'
}

export interface ExamActionResult {
  action_id: string
  label: string
  /** 이번에 찍은 부위의 소견. 항목이 완료되는 호출에서는 최상위 종합 소견이 온다 */
  finding: string
  reaction?: ExamReaction | null
  /**
   * 청진음 파일 키 (public/sounds/exam/{heart,lung}/<sound>.mp3).
   * 케이스 region_findings의 sound를 그대로 전달받는다 — finding 텍스트 추정 대신 이 값으로 음원을 고른다.
   */
  sound?: string | null
  /** 항목 전체 완료 여부. 구버전 응답엔 없으므로 없으면 '완료'로 본다 (기존 케이스 회귀 방지) */
  complete?: boolean
  progress?: ExamProgress | null
  /** passes가 있는 항목만 채워짐 — 다음에 해야 할 pass */
  current_pass?: 'light' | 'deep' | null
  exam_log: { action_id: string; label: string; finding: string }[]
  summary: ExamSummary
}

export interface EducationPayload {
  diagnosis_evidence: string[]
  test_plan: string[]
  treatment: string[]
  complication: string[]
}

export interface SessionStart {
  session_id: string
  patient: {
    name: string
    age: number
    gender: string
    occupation: string
    body_type?: string | null
    signs?: string[]
    /** 통증 기준선 0(무통)~1(견딜 수 없음). 표정이 매 턴 LLM 감정에만 의존하면
     *  요로결석 산통 같은 케이스도 계속 밋밋하다 — 이 값이 기본 표정을 아프게 만든다. */
    pain_level?: number
    /** 산통 주기(초). 신산통은 20~40초 간격으로 파고가 온다. 없으면 일정한 통증. */
    pain_colicky_period?: number | null
    appearance?: AvatarAppearance
  }
  guardian?: { name: string; relation: string; gender: string; age: number } | null
  title: string
  chief_complaint: string
  initial_message: string
  // CPX 상황지침 — 한 줄 제시문 + 활력징후 (구버전 케이스엔 없음)
  presentation?: string | null
  vitals?: { bp: string; hr: string; rr: string; temp: string } | null
  max_turns: number
  state: PublicState
  diagnosis_options: DiagnosisOption[]
  test_options: TestOption[]
  // CPX 가중치 케이스면 채워짐 (없으면 null/빈배열 → 기존 흐름)
  scoring_weights?: ScoringWeights | null
  exam_items?: ExamItem[]
  education_items?: EducationItem[]
}

export interface TurnResult {
  speaker?: 'patient' | 'guardian'
  turn: number
  max_turns: number
  user_text: string
  patient_text: string
  intent_analysis: {
    intent: string
    empathy: boolean
    tone: string
    is_red_flag_check: boolean
    /**
     * [의학리뷰 #6] "눈 좀 볼게요"처럼 결막·공막 중 무엇인지 특정하지 않은 발화만 true.
     * true일 때만 "케이스가 가진 눈 항목"으로 대체 라우팅해도 된다 —
     * "공막 볼게요"(false)가 빈혈 케이스에서 결막검사를 시행하면 평가표상 다른 술기를 한 것이 된다.
     */
    eye_target_ambiguous?: boolean
    /** "청진하겠습니다"처럼 부위를 지목하지 않은 청진 발화 — 케이스가 가진 청진으로 돌려도 된다는 표시 */
    ausc_target_ambiguous?: boolean
  }
  state: PublicState
  delta: { trust: number; anxiety: number; rapport: number }
  unlocked_facts: Fact[]
  emotion: Emotion
  game_over: 'trust_collapsed' | 'turns_exhausted' | null
}

export interface DialogueEntry {
  turn: number
  speaker: 'user' | 'patient'
  text: string
  emotion?: Emotion
  unlocked?: Fact[]
}

export interface Report {
  final_score: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F'
  scores: Record<string, number>
  max_scores: Record<string, number>
  covered_questions: { topic: string; label: string }[]
  missed_questions: { topic: string; label: string }[]
  unlocked_facts: Fact[]
  correct_diagnosis: { id: string; label: string }
  diagnosis_correct: boolean
  feedback: {
    good_points: string[]
    missed_points: string[]
    short_feedback: string
  }
  teaching_points: string[]
  turns_used: number
  section_times?: Record<string, number> | null
  final_state: PublicState
  // 교육 강화용 파생 데이터 (백엔드 rule-based). 구버전 호환 위해 optional.
  rapport_curve?: RapportPoint[]
  trust_moments?: TrustMoment[]
  missed_hidden_facts?: MissedHiddenFact[]
  diagnosis_feedback?: DiagnosisFeedback
  // CPX 가중치 채점 세부 (요로결석 등)
  weighted?: boolean
  ppi_detail?: PpiDetail
  exam_detail?: ExamDetail
  education_detail?: EducationDetail
}

export interface PpiItemResult {
  id: string
  category: number
  label: string
  status: 'pass' | 'fail' | 'na'
  feedback?: string
}

export interface PpiCategory {
  category: number
  label: string
  got: number
  measurable: number
  total: number
}

export interface PpiDetail {
  items: PpiItemResult[]
  categories: PpiCategory[]
  raw: number
  measurable: number
  total_items: number
  ratio: number
  weight: number
  scaled: number
}

export interface ExamDetail {
  ratio: number
  got: number
  max: number
  detail: { id: string; label: string; points: number; done: boolean }[]
  penalties: string[]
}

export interface EducationDetail {
  ratio: number
  got: number
  max: number
  detail: { id: string; label: string; got: number; max: number; note: string }[]
}

export interface RapportPoint {
  turn: number
  trust: number
  anxiety: number | null
  unlocked: boolean
}

export interface TrustMoment {
  turn: number
  user_text: string
  trust_delta: number
  unlocked: boolean
  reason: string
}

export interface MissedHiddenFact {
  label: string
  question: string
  tip: string
  sensitive: boolean
}

export interface DiagnosisFeedback {
  correct: boolean
  chosen: string[]
  correct_label: string
  verdict: string
}
