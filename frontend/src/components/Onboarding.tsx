/**
 * 첫 플레이어용 가벼운 온보딩 코치마크 (1~3스텝).
 * - HUD와 동일한 '종이 진료차트 + 음영 잉크' 톤. 사실적 무드(8번출구/당직근무)와 통일.
 * - localStorage로 한 번 본 사람은 자동으로 다시 안 뜸.
 * - 언제든 다시 볼 수 있는 작은 ? 버튼(OnboardingButton) 제공.
 */
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { sfxPop } from '../audio/sfx'

const SEEN_KEY = 'ptg-onboarding-seen-v1'

// HUD와 동일한 음영 톤
const INK = '#2f343a'
const INK_SOFT = '#5b626a'
const PAPER = '#ffffff'
const LINE = '#e2e6ea'
const SAGE = '#5b8c6e'
const AMBER = '#b07f45'

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* localStorage 차단 환경 — 조용히 무시 */
  }
}

type Step = {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
}

const STEPS: Step[] = [
  {
    icon: <HeartGlyph />,
    title: '마음을 열어야 진짜 이야기가 나와요',
    body: (
      <>
        공감하며 <b style={{ color: SAGE }}>부드럽게</b> 물으면{' '}
        <b style={{ color: SAGE }}>신뢰</b>가 오르고, 환자가 숨겨둔 병력을 하나씩 꺼냅니다.
      </>
    ),
  },
  {
    icon: <StormGlyph />,
    title: '다그치면 마음을 닫아요',
    body: (
      <>
        성급히 단정하거나 몰아붙이면 <b style={{ color: AMBER }}>불안</b>이 치솟아요. 신뢰를
        잃으면 환자는 입을 닫고, 단서는 더 이상 해금되지 않아요.
      </>
    ),
  },
  {
    icon: <MicGlyph />,
    title: '꾹 눌러 말하기 (또는 키보드)',
    body: (
      <>
        마이크 버튼을 <b style={{ color: INK }}>꾹 눌러</b> 말하고 떼면 전송돼요(스페이스바도 가능).
        마이크가 어렵다면 <b style={{ color: INK }}>“키보드로 입력할래요”</b>로 텍스트 질문도 돼요.
      </>
    ),
  },
]

export function Onboarding({
  open,
  onClose,
  onComplete,
}: {
  open: boolean
  onClose: () => void
  onComplete?: () => void // 마지막 단계 완료 시 (타이틀에서는 근무 시작)
}) {
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  const close = useCallback(() => {
    markOnboardingSeen()
    onClose()
  }, [onClose])

  const next = () => {
    sfxPop()
    if (last) {
      close()
      onComplete?.() // 타이틀: 바로 근무 시작
    } else setStep((s) => s + 1)
  }

  const prev = () => {
    sfxPop()
    setStep((s) => Math.max(0, s - 1))
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22 }}
            className="relative mx-4 w-full max-w-sm overflow-hidden rounded-[6px] border shadow-[0_14px_40px_rgba(30,22,12,0.45)]"
            style={{ background: PAPER, borderColor: LINE }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 차트 헤더 */}
            <div
              className="flex items-center justify-between border-b px-4 py-2"
              style={{ borderColor: '#eef1f3', background: 'rgba(241,243,245,0.7)' }}
            >
              <span className="text-[10px] font-bold tracking-[0.22em]" style={{ color: '#98a0a8' }}>
                진료 안내
              </span>
              <button
                onClick={close}
                className="text-[11px] transition hover:opacity-100"
                style={{ color: '#98a0a8', opacity: 0.8 }}
              >
                건너뛰기
              </button>
            </div>

            <div className="px-7 pt-6 pb-6">
              {/* 아이콘 — 종이 위 얇은 라인 아트 */}
              <div
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border"
                style={{ background: '#f4f6f7', borderColor: '#eef1f3' }}
              >
                <span className="h-9 w-9">{STEPS[step].icon}</span>
              </div>

              <h3
                className="font-display mt-4 text-center text-[19px] leading-snug"
                style={{ color: INK }}
              >
                {STEPS[step].title}
              </h3>
              <p
                className="mt-3 text-center text-[13.5px] leading-relaxed"
                style={{ color: INK_SOFT }}
              >
                {STEPS[step].body}
              </p>

              {/* 스텝 점 */}
              <div className="mt-6 flex justify-center gap-1.5">
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: i === step ? 22 : 6,
                      background: i === step ? INK_SOFT : '#d8cdb4',
                    }}
                  />
                ))}
              </div>

              {/* 내비게이션 */}
              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  onClick={prev}
                  disabled={step === 0}
                  className="font-display rounded-full px-4 py-2 text-sm transition disabled:opacity-0"
                  style={{ color: INK_SOFT }}
                >
                  이전
                </button>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={next}
                  className="font-display rounded-full px-8 py-2.5 text-sm shadow-md transition"
                  style={{ background: INK, color: PAPER }}
                >
                  {last ? '진료 시작' : '다음'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ── 다시 보기용 작은 ? 버튼 (HUD 톤) ──────────────────────────── */
export function OnboardingButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={() => {
        sfxPop()
        onClick()
      }}
      title="게임 방법 다시 보기"
      aria-label="게임 방법 다시 보기"
      className="font-display flex h-8 w-8 items-center justify-center rounded-full border text-base shadow transition"
      style={{ background: 'rgba(255,255,255,0.92)', borderColor: LINE, color: INK_SOFT }}
    >
      ?
    </button>
  )
}

/* ── 얇은 라인 아트 글리프 (단색 음영, 외부 에셋 0개) ──────────── */
function HeartGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <path
        d="M12 20.5s-6.8-4.2-8.9-8.4C1.7 8.6 3.2 6 5.9 6c1.7 0 3.1 1 4.1 2.4C11 7 12.4 6 14.1 6c2.7 0 4.2 2.6 2.8 6.1-2.1 4.2-8.9 8.4-8.9 8.4z"
        fill="none"
        stroke={SAGE}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StormGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <path
        d="M7 16.5a3.6 3.6 0 0 1-.4-7.18A4.6 4.6 0 0 1 15.6 8.6a3.2 3.2 0 0 1 .4 6.4"
        fill="none"
        stroke={AMBER}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 12.5l-2 3.4h1.9l-.9 3.6 3.4-4.8h-1.9l1.2-2.2z"
        fill="none"
        stroke={AMBER}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke={INK} strokeWidth="1.5" />
      <path
        d="M6 11a6 6 0 0 0 12 0"
        fill="none"
        stroke={INK}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M12 17v3M9 20h6" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
