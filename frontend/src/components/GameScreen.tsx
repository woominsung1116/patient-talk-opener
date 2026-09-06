/**
 * 메인 진료실 화면 — 1인칭 의사 시점 3D 룸.
 * entering 단계: 환자 입장 컷씬 / playing 단계: 문진 진행.
 */
import { useEffect, useState } from 'react'
import { useGame } from '../store'
import { ClinicScene } from '../three/ClinicScene'
import { debugAvatarVariant, pickAvatarVariant } from '../three/avatarVariant'
import { SubtitleBar } from './SubtitleBar'
import { UnlockToast } from './ClueDrawer'
import { FocusedPanel } from './FocusedPanel'
import { DialogueLog } from './DialogueLog'
import { MicButton } from './MicButton'
import { SubmitModal } from './SubmitModal'
import { ExamPanel } from './ExamPanel'
import { EducationPanel } from './EducationPanel'
import { Onboarding, hasSeenOnboarding } from './Onboarding'
import { Settings } from './Settings'
import { T } from '../ui/theme'
import { AnimatePresence, motion, useAnimation } from 'framer-motion'

/* ── 상단 섹션 타이머 — 섹션별 경과 + 전체 경과. CPX 시간 관리 감각 훈련용 ── */
const SECTION_LABEL: Record<string, string> = { playing: '문진', exam: '신체진찰', education: '환자교육' }
function SectionTimer() {
  const phase = useGame((s) => s.phase)
  const sectionStart = useGame((s) => s.sectionStart)
  const sectionTimes = useGame((s) => s.sectionTimes)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (!(phase in SECTION_LABEL)) return null
  const live = sectionStart ? (Date.now() - sectionStart) / 1000 : 0
  const nowSec = (sectionTimes[phase] ?? 0) + live
  const past = Object.entries(sectionTimes).reduce((a, [k, v]) => a + (k === phase ? 0 : v), 0)
  const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-1.5 text-[13px] text-white shadow-md backdrop-blur-sm">
        <span className="font-display">{SECTION_LABEL[phase]}</span>
        <span className="font-mono tabular-nums">{fmt(nowSec)}</span>
        <span className="opacity-50">|</span>
        <span className="opacity-75">전체</span>
        <span className="font-mono tabular-nums opacity-75">{fmt(past + nowSec)}</span>
      </div>
    </div>
  )
}

export function GameScreen() {
  const {
    phase,
    dialogue,
    busy,
    emotion,
    setSubmitOpen,
    error,
    setError,
    gameOver,
    session,
    finishEntering,
    gesture,
    goTitle,
    isCpx,
    examPose,
    examShake,
    examHint,
    setUiHold,
  } = useGame()

  // 카메라 패럴랙스 정지 조건 2가지:
  //  (1) 포인터가 3D 캔버스가 아닌 2D UI(버튼·패널) 위 — 버튼 누르러 갈 때 화면이 도는 불편 방지
  //  (2) Shift 키를 누르고 있는 동안 — 마우스를 어디로 움직여도 화면 완전 고정
  useEffect(() => {
    let overUi = false
    let shiftHeld = false
    let last: boolean | null = null
    const apply = () => {
      const hold = overUi || shiftHeld
      if (hold !== last) {
        last = hold
        setUiHold(hold)
      }
    }
    const onOver = (e: Event) => {
      overUi = (e.target as HTMLElement)?.tagName !== 'CANVAS'
      apply()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeld = e.type === 'keydown'
        apply()
      }
    }
    document.addEventListener('pointerover', onOver)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      document.removeEventListener('pointerover', onOver)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      setUiHold(false)
    }
  }, [setUiHold])

  /* ── 강한 압통 반응 시 화면 진동 + 빨간 비네트 플래시 ── */
  const shakeControls = useAnimation()
  useEffect(() => {
    if (!examShake) return
    void shakeControls
      .start({ x: [0, -7, 6, -4, 3, -1, 0], y: [0, 2, -2, 1, -1, 0] }, { duration: 0.45 })
      .then(() => shakeControls.set({ x: 0, y: 0 }))
  }, [examShake, shakeControls])

  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [paused, setPaused] = useState(false)
  // 일시정지 동안 섹션 타이머 정지
  const pauseTimer = useGame((s) => s.pauseTimer)
  const resumeTimer = useGame((s) => s.resumeTimer)
  useEffect(() => {
    if (paused) pauseTimer()
    else resumeTimer()
  }, [paused, pauseTimer, resumeTimer])
  const entering = phase === 'entering'

  // ESC = 일시정지 토글 (입력창에서는 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (phase === 'playing') setPaused((p) => !p)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  // 첫 진료 진입 시(처음 본 사람) 자동으로 온보딩 1회 노출
  useEffect(() => {
    if (phase === 'playing' && !hasSeenOnboarding()) {
      setOnboardingOpen(true)
    }
  }, [phase])
  // 환자 성별 + 나이 → 연령대에 맞는 아바타 (아동/청년/노년).
  const patientVariant = pickAvatarVariant(
    session?.patient.name ?? '',
    session?.patient.gender ?? 'female',
    session?.patient.age,
    session?.patient.body_type,
  )
  const variant = (import.meta.env.DEV
    ? debugAvatarVariant(new URLSearchParams(window.location.search).get('av'))
    : null) ?? patientVariant
  const lastPatientLine = [...dialogue].reverse().find((d) => d.speaker === 'patient')?.text ?? ''
  const thinking = busy === 'thinking' || busy === 'transcribing'

  return (
    <motion.div animate={shakeControls} className="relative h-full overflow-hidden bg-[#1a1c1e]">
      <ClinicScene
        entering={entering}
        onEnterComplete={finishEntering}
        emotion={entering ? 'anxious' : busy === 'thinking' ? 'thinking' : emotion}
        speaking={busy === 'speaking'}
        variant={variant}
        gesture={gesture}
        examMode={phase === 'exam'}
        examPose={examPose}
        patientAge={session?.patient.age}
        patientIdentity={session?.patient.name}
      />

      {/* 섹션 타이머 (상단 중앙) */}
      {!entering && <SectionTimer />}

      {/* ───── 신체진찰 / 환자교육 단계 오버레이 ───── */}
      {phase === 'exam' && <ExamPanel />}
      {phase === 'education' && <EducationPanel />}

      {/* 설정(볼륨/음성/게임 방법/나가기) — 진찰·교육 단계에서도 접근 가능하게 */}
      {(phase === 'exam' || phase === 'education') && (
        <Settings onShowOnboarding={() => setOnboardingOpen(true)} />
      )}

      {/* ───── 게임 UI (문진 단계) ───── */}
      <AnimatePresence>
        {phase === 'playing' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
            <UnlockToast />
            <FocusedPanel />
            <DialogueLog />

            {/* 하단 자막 바 — 환자 대사 / 첫 인사 안내 */}
            {dialogue.length === 0 && !thinking ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="pointer-events-none absolute bottom-[12%] left-1/2 z-20 -translate-x-1/2"
              >
                <div
                  className="rounded-[6px] border px-6 py-3 text-center shadow-lg backdrop-blur-[2px]"
                  style={{ background: 'rgba(255,255,255,0.94)', borderColor: T.line }}
                >
                  <p className="text-[15px] font-bold" style={{ color: T.ink }}>
                    환자가 자리에 앉았습니다. 먼저 말을 걸어보세요.
                  </p>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: T.faint }}>
                    예: “안녕하세요, 어디가 불편해서 오셨어요?”
                  </p>
                </div>
              </motion.div>
            ) : (
              <SubtitleBar
                text={thinking ? '' : lastPatientLine}
                thinking={thinking}
                patientName={session?.patient.name ?? ''}
              />
            )}

            {/* 우하단: 마이크 + 진단 제출 */}
            <div className="absolute right-6 bottom-5 z-20 flex flex-col items-center gap-3">
              <MicButton />
              {/* CPX 는 **버튼으로 진찰에 들어가지 않는다** (사용자 지시 2026-07-26:
                  "신체진찰 시작하기 이런 거 없애 우리는 대화로 유도해야 해").
                  실제 CPX 에서 진찰 전환은 학생이 환자에게 말해서 얻는 것이고,
                  그 발화 자체가 채점 항목(`explain_consent` = 진찰 전 설명·동의)이다.
                  버튼을 두면 그 항목을 공짜로 건너뛰게 된다.
                  ⚠ 전환 경로는 `store.ts` 의 `request_exam` 처리다 — "진찰 좀 하겠습니다",
                    "침대에 누워주시겠어요?" 같은 발화가 `explain_consent` 를 기록하고
                    2.6초 뒤 `startExam()` 을 부른다. **그 경로를 지우면 진찰에 못 들어간다.** */}
              {isCpx ? null : (
                <button
                  onClick={() => setSubmitOpen(true)}
                  className="font-display rounded-full border px-5 py-2 text-sm shadow-md transition hover:brightness-105"
                  style={{ background: T.paper, borderColor: T.line, color: T.ink }}
                >
                  진단 제출하기
                </button>
              )}
            </div>

            {/* 우상단 설정 — 볼륨/환자 음성/게임 방법/나가기 */}
            <Settings onShowOnboarding={() => setOnboardingOpen(true)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3D 클릭 안내 토스트 (문진 단계 — 예: 손소독제 클릭) */}
      <AnimatePresence>
        {phase === 'playing' && examHint && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute bottom-32 left-1/2 z-30 -translate-x-1/2 rounded-full px-5 py-2 text-sm font-bold shadow-lg"
            style={{ background: T.ink, color: T.paper }}
          >
            {examHint}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 게임오버 배너 */}
      <AnimatePresence>
        {gameOver === 'trust_collapsed' && (
          <motion.div
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-[8px] border-2 px-8 py-4 text-center shadow-2xl"
            style={{ background: T.paper, borderColor: T.danger }}
          >
            <div className="text-2xl" style={{ color: T.danger }}>환자가 마음을 닫았어요</div>
            <div className="mt-1 text-sm" style={{ color: T.inkSoft }}>지금까지의 정보로 진단을 제출해야 해요</div>
          </motion.div>
        )}
        {gameOver === 'turns_exhausted' && (
          <motion.div
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-[8px] border-2 px-8 py-4 text-center shadow-2xl"
            style={{ background: T.paper, borderColor: T.amber }}
          >
            <div className="text-2xl" style={{ color: T.amber }}>진료 시간이 끝났어요</div>
            <div className="mt-1 text-sm" style={{ color: T.inkSoft }}>진단을 제출해주세요</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 에러 토스트 */}
      <AnimatePresence>
        {error && (
          <motion.button
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={() => setError(null)}
            className="absolute bottom-36 left-1/2 z-40 -translate-x-1/2 rounded-[6px] border px-5 py-2.5 text-sm shadow-xl"
            style={{ background: T.paper, borderColor: T.danger, color: T.danger }}
          >
            {error} <span className="ml-1 text-[11px]" style={{ color: T.faint }}>(눌러서 닫기)</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* 일시정지 (ESC) */}
      <AnimatePresence>
        {paused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(20,24,28,0.5)', backdropFilter: 'blur(3px)' }}
            onClick={() => setPaused(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              className="w-72 overflow-hidden rounded-[8px] border bg-white shadow-2xl"
              style={{ borderColor: T.line }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="border-b px-5 py-3 text-center font-display text-lg"
                style={{ borderColor: T.line2, color: T.ink }}
              >
                일시정지
              </div>
              <div className="space-y-2 p-4">
                <button
                  onClick={() => setPaused(false)}
                  className="font-display w-full rounded-lg py-2.5 text-sm shadow-sm transition hover:brightness-110"
                  style={{ background: T.ink, color: T.paper }}
                >
                  계속하기
                </button>
                <button
                  onClick={() => { setPaused(false); goTitle() }}
                  className="font-display w-full rounded-lg border py-2.5 text-sm transition"
                  style={{ borderColor: T.line, color: T.inkSoft }}
                >
                  메인으로
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 강한 압통 빨간 비네트 플래시 (0.5초) */}
      <AnimatePresence>
        {examShake && (
          <motion.div
            key="shake-vignette"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute inset-0 z-50"
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 35%, rgba(200,30,30,0.65) 100%)',
            }}
          />
        )}
      </AnimatePresence>

      <SubmitModal />

      {/* 첫 플레이어 온보딩 (자동 1회 + ? 버튼으로 재호출) */}
      <Onboarding open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </motion.div>
  )
}
