/**
 * 우측 환자 차트 — 진짜 진료 차트처럼 줄눈 기록지에 소견이 한 줄씩 추가된다.
 * 새 소견 해금 시 중앙에 '차트 기록' 노트.
 */
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useGame } from '../store'
import { T } from '../ui/theme'

export function ClueDrawer() {
  const { disclosedFacts, hiddenTotal, hiddenUnlocked } = useGame()

  return (
    <div
      className="pointer-events-none absolute top-16 right-4 z-20 w-72 select-none"
      style={{ perspective: '1200px' }}
    >
      <div
        style={{
          // 차트 보드가 벽/책상에 비스듬히 — 오른쪽 모서리가 앞으로, 왼쪽이 안으로
          transform: 'rotateY(-15deg) rotateX(3deg)',
          transformOrigin: 'right center',
        }}
      >
        {/* 클립보드 집게 */}
        <div
          className="mx-auto h-2.5 w-16 rounded-t-md"
          style={{ background: T.line, boxShadow: 'inset 0 -1px 2px rgba(0,0,0,0.08)' }}
        />
        <div
          className="overflow-hidden rounded-[5px] border"
          style={{
            borderColor: T.line,
            background: 'linear-gradient(240deg, #ffffff 0%, #fbfcfc 55%, #eef1f2 100%)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.95) inset, 2px 0 0 rgba(0,0,0,0.04) inset, 0 14px 26px -6px rgba(30,40,50,0.32), 0 34px 52px -18px rgba(30,40,50,0.3)',
          }}
        >
        {/* 차트 헤더 */}
        <div className="border-b px-3 py-1.5" style={{ borderColor: T.ink }}>
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[13px] tracking-wide" style={{ color: T.ink }}>
              환자 차트
            </span>
            <span className="text-[10px] tabular-nums" style={{ color: T.faint }}>
              소견 {hiddenUnlocked}/{hiddenTotal}
            </span>
          </div>
        </div>

        {/* 기록지 — 줄눈 위에 소견 누적 */}
        <div className="nice-scroll max-h-72 overflow-y-auto">
          <AnimatePresence initial={false}>
            {disclosedFacts.map((f, i) => (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', stiffness: 240, damping: 22 }}
                className="flex gap-2 px-3 py-2"
                style={{ borderBottom: `1px solid ${T.line2}` }}
              >
                <span
                  className="font-display mt-px shrink-0 text-[10px] tabular-nums"
                  style={{ color: T.slate }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <div className="font-display text-[12px]" style={{ color: T.ink }}>{f.label}</div>
                  <div className="text-[12px] leading-snug" style={{ color: T.inkSoft }}>{f.value}</div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {disclosedFacts.length === 0 && (
            <p className="px-3 py-4 text-center text-[12px]" style={{ color: T.faint }}>
              아직 기록된 소견이 없습니다
            </p>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

/** 새 소견 해금 시 — 차트에 기록되는 노트 (화면 중앙 상단) */
export function UnlockToast() {
  const lastUnlocked = useGame((s) => s.lastUnlocked)
  const [dismissed, setDismissed] = useState<typeof lastUnlocked>(null)
  const visible = lastUnlocked !== null && lastUnlocked !== dismissed

  useEffect(() => {
    if (!lastUnlocked) return
    const t = setTimeout(() => setDismissed(lastUnlocked), 2600)
    return () => clearTimeout(t)
  }, [lastUnlocked])

  return (
    <AnimatePresence>
      {visible && lastUnlocked && (
        <motion.div
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className="pointer-events-none absolute top-20 left-1/2 z-40 -translate-x-1/2"
        >
          <div
            className="flex items-center gap-2.5 rounded-[6px] border bg-white px-4 py-2.5 shadow-[0_8px_24px_rgba(40,50,60,0.22)]"
            style={{ borderColor: T.line, borderLeft: `3px solid ${T.sage}` }}
          >
            {/* 차트에 기록되는 펜 아이콘 */}
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
              <path d="M4 20h16" stroke={T.faint} strokeWidth="1.6" strokeLinecap="round" />
              <path
                d="M14.5 4.5l3 3L8 17l-3.5.5.5-3.5z"
                fill="none"
                stroke={T.sage}
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <div className="text-[10px] tracking-wide" style={{ color: T.faint }}>차트에 기록됨</div>
              {lastUnlocked.map((f) => (
                <div key={f.key} className="font-display text-[14px]" style={{ color: T.ink }}>
                  {f.label}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
