/**
 * 진단 + 검사 제출 모달. 2단계: 진단명 직접 입력 → 검사 선택(최대 4) → 제출.
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '../store'
import { T } from '../ui/theme'

const MAX_TESTS = 4

/* 모달이 열릴 때마다 새로 마운트 → 이전 입력이 자연히 초기화됨 */
export function SubmitModal() {
  const submitOpen = useGame((s) => s.submitOpen)
  return <AnimatePresence>{submitOpen && <ModalContent />}</AnimatePresence>
}

function ModalContent() {
  const { setSubmitOpen, session, submit, gameOver } = useGame()
  const [step, setStep] = useState<0 | 1>(0)
  const [dx, setDx] = useState('')
  const [tests, setTests] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  if (!session) return null

  const toggleTest = (id: string) => {
    if (tests.includes(id)) setTests(tests.filter((x) => x !== id))
    else if (tests.length < MAX_TESTS) setTests([...tests, id])
  }

  const close = () => {
    if (gameOver) return // 게임오버 시 제출 강제
    setSubmitOpen(false)
  }

  const doSubmit = async () => {
    if (sending) return
    setSending(true)
    try {
      await submit([dx.trim()], tests)
    } finally {
      setSending(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ background: `${T.ink}66` }}
      onClick={close}
    >
      <motion.div
        initial={{ scale: 0.9, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="mx-4 w-full max-w-xl rounded-3xl p-6 shadow-2xl"
        style={{ background: T.paper, border: `3px solid ${T.line}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl" style={{ color: T.ink }}>
          {step === 0 ? '진단명을 입력해주세요' : '시행할 검사를 골라주세요'}
        </h2>
        <p className="mt-1 text-[13px]" style={{ color: T.inkSoft }}>
          {step === 0
            ? '가장 의심되는 진단을 직접 적어주세요'
            : `꼭 필요한 검사만! 불필요한 검사는 감점이에요 (최대 ${MAX_TESTS}개)`}
        </p>

        {step === 0 ? (
          <div className="mt-4">
            <input
              autoFocus
              value={dx}
              onChange={(e) => setDx(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && dx.trim()) setStep(1)
              }}
              placeholder="예: 공황장애"
              className="w-full rounded-xl border-2 px-4 py-3 text-[16px] outline-none transition"
              style={{ borderColor: T.line, background: T.paperHi, color: T.ink }}
              onFocus={(e) => (e.currentTarget.style.borderColor = T.sage)}
              onBlur={(e) => (e.currentTarget.style.borderColor = T.line)}
            />
            <p className="mt-2 text-[12px]" style={{ color: T.faint }}>
              한글 진단명으로 적어주세요. 표현이 조금 달라도 인식돼요.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto nice-scroll pr-1">
            {session.test_options.map((opt) => {
              const selected = tests.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  onClick={() => toggleTest(opt.id)}
                  className="relative rounded-xl border-2 px-3 py-2.5 text-left text-[14px] transition-all"
                  style={
                    selected
                      ? { borderColor: T.sage, background: `${T.sage}18`, color: T.ink, fontWeight: 700 }
                      : { borderColor: T.line2, background: T.paper, color: T.ink }
                  }
                  onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = T.line }}
                  onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = T.line2 }}
                >
                  {opt.label}
                  {selected && (
                    <span
                      className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full text-[12px]"
                      style={{ background: T.sage, color: T.paper }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-5 flex justify-between">
          {step === 0 ? (
            <button
              onClick={close}
              className="rounded-full px-4 py-2 text-sm transition"
              style={{ color: T.inkSoft }}
              disabled={!!gameOver}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.paperHi)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {gameOver ? '제출해야 해요' : '돌아가기'}
            </button>
          ) : (
            <button
              onClick={() => setStep(0)}
              className="rounded-full px-4 py-2 text-sm transition"
              style={{ color: T.inkSoft }}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.paperHi)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              ← 진단 다시 입력
            </button>
          )}
          {step === 0 ? (
            <button
              onClick={() => setStep(1)}
              disabled={!dx.trim()}
              className="font-display rounded-full px-6 py-2 shadow-md transition"
              style={!dx.trim() ? { background: T.line2, color: T.faint } : { background: T.ink, color: T.paper }}
              onMouseEnter={(e) => { if (dx.trim()) e.currentTarget.style.background = T.inkSoft }}
              onMouseLeave={(e) => { if (dx.trim()) e.currentTarget.style.background = T.ink }}
            >
              다음 →
            </button>
          ) : (
            <button
              onClick={() => void doSubmit()}
              disabled={tests.length === 0 || sending}
              className="font-display rounded-full px-6 py-2 shadow-md transition"
              style={
                tests.length === 0 || sending
                  ? { background: T.line2, color: T.faint }
                  : { background: T.ink, color: T.paper }
              }
              onMouseEnter={(e) => { if (tests.length > 0 && !sending) e.currentTarget.style.background = T.inkSoft }}
              onMouseLeave={(e) => { if (tests.length > 0 && !sending) e.currentTarget.style.background = T.ink }}
            >
              {sending ? '채점 중...' : '최종 제출'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
