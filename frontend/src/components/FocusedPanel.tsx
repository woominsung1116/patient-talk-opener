import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '../store'
import { T } from '../ui/theme'

export function FocusedPanel() {
  const focusedPanel = useGame((s) => s.focusedPanel)
  const setFocusedPanel = useGame((s) => s.setFocusedPanel)
  const trust = useGame((s) => s.trust)
  const anxiety = useGame((s) => s.anxiety)
  const rapport = useGame((s) => s.rapport)
  const turn = useGame((s) => s.turn)
  const maxTurns = useGame((s) => s.maxTurns)
  const hiddenUnlocked = useGame((s) => s.hiddenUnlocked)
  const hiddenTotal = useGame((s) => s.hiddenTotal)
  const patientNumber = useGame((s) => s.patientNumber)
  const disclosedFacts = useGame((s) => s.disclosedFacts)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusedPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFocusedPanel])

  return (
    <AnimatePresence>
      {focusedPanel !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
          style={{ background: 'rgba(10,12,14,0.55)' }}
          onClick={() => setFocusedPanel(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {focusedPanel === 'status' ? (
              <StatusCard
                trust={trust}
                anxiety={anxiety}
                rapport={rapport}
                turn={turn}
                maxTurns={maxTurns}
                hiddenUnlocked={hiddenUnlocked}
                hiddenTotal={hiddenTotal}
                patientNumber={patientNumber}
                onClose={() => setFocusedPanel(null)}
              />
            ) : (
              <ChartCard
                disclosedFacts={disclosedFacts}
                onClose={() => setFocusedPanel(null)}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// 모니터 화면 그리드 (은은한 격자)
const SCREEN_GRID =
  'repeating-linear-gradient(0deg, rgba(45,110,75,0.16) 0 1px, transparent 1px 22px),' +
  'repeating-linear-gradient(90deg, rgba(45,110,75,0.16) 0 1px, transparent 1px 22px)'

// 모니터 채널 한 줄 — 라벨 + 바 + 큰 발광 수치 (바이탈 모니터 readout 스타일)
function MonitorChannel({ label, value, color, danger }: { label: string; value: number; color: string; danger?: boolean }) {
  const c = danger ? '#ff6b4a' : color
  return (
    <div className="flex items-center gap-4">
      <span className="w-10 text-[15px] font-medium" style={{ color: c }}>{label}</span>
      <div className="relative flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: c, boxShadow: `0 0 10px ${c}` }}
        />
      </div>
      <span className="w-14 text-right font-mono text-[34px] leading-none font-bold tabular-nums" style={{ color: c, textShadow: `0 0 14px ${c}55` }}>
        {value}
      </span>
    </div>
  )
}

function StatusCard({
  trust, anxiety, rapport, turn, maxTurns,
  hiddenUnlocked, hiddenTotal, patientNumber, onClose,
}: {
  trust: number; anxiety: number; rapport: number
  turn: number; maxTurns: number
  hiddenUnlocked: number; hiddenTotal: number; patientNumber: number
  onClose: () => void
}) {
  return (
    <div className="relative w-[540px]">
      {/* 모니터 케이싱 (크림색 의료 플라스틱) */}
      <div
        className="rounded-[18px] p-4"
        style={{
          background: 'linear-gradient(155deg,#eef1f3,#d6dbdf)',
          boxShadow: '0 26px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.85)',
        }}
      >
        {/* 발광 화면 */}
        <div
          className="relative rounded-[10px] px-7 py-6"
          style={{
            background: '#06120c',
            backgroundImage: SCREEN_GRID,
            boxShadow: 'inset 0 0 0 2px #102a1d, inset 0 0 50px rgba(0,0,0,0.65)',
          }}
        >
          {/* 헤더 */}
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="font-mono text-lg font-semibold tracking-wide" style={{ color: '#8fbda5' }}>
              <span style={{ color: '#3dff7a' }}>●</span> 진료 기록
            </span>
            <span className="font-mono text-sm" style={{ color: '#5d7c6d' }}>No.{patientNumber} · {turn}/{maxTurns}</span>
          </div>

          {/* 장식용 ECG 라인 */}
          <svg viewBox="0 0 520 22" className="w-full h-5 mb-4" preserveAspectRatio="none" style={{ opacity: 0.55 }}>
            <path
              d="M0 11 H110 l5 0 l4 -8 l4 14 l4 -6 H250 l5 0 l4 -8 l4 14 l4 -6 H390 l5 0 l4 -8 l4 14 l4 -6 H520"
              fill="none" stroke="#3dff7a" strokeWidth="1.5"
            />
          </svg>

          {/* 채널 */}
          <div className="flex flex-col gap-5">
            <MonitorChannel label="신뢰" value={trust} color="#3dff7a" danger={trust <= 20} />
            <MonitorChannel label="불안" value={anxiety} color="#ffd24a" danger={anxiety >= 80} />
            <MonitorChannel label="라포" value={rapport} color="#39d9ff" />
          </div>

          {/* 구분선 */}
          <div className="my-5" style={{ borderTop: '1px solid rgba(120,180,150,0.18)' }} />

          {/* 확보 단서 readout */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm" style={{ color: '#7f9c8c' }}>확보한 단서</span>
            <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: '#d3e3d9' }}>
              {hiddenUnlocked} / {hiddenTotal}
            </span>
          </div>
        </div>

        {/* 케이싱 하단 — 브랜드 라벨 + 파란 노브 */}
        <div className="flex items-center justify-between px-1.5 pt-3">
          <span className="text-[10px] font-bold tracking-[0.22em]" style={{ color: '#9aa3a8' }}>VITAS · PT-100</span>
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#a8b0b5' }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#a8b0b5' }} />
            <span
              className="h-4 w-4 rounded-full"
              style={{ background: 'radial-gradient(circle at 35% 30%, #6aa9e8, #2f7fd6)', boxShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
            />
          </div>
        </div>
      </div>

      {/* 닫기 */}
      <button
        onClick={onClose}
        className="absolute -top-3 -right-3 h-8 w-8 rounded-full flex items-center justify-center text-sm shadow-lg"
        style={{ background: '#1a1e22', color: '#cfe8da' }}
      >
        ✕
      </button>
    </div>
  )
}

function ChartCard({
  disclosedFacts,
  onClose,
}: {
  disclosedFacts: { key: string; label: string; value: string }[]
  onClose: () => void
}) {
  return (
    <div
      className="relative w-[440px] rounded-2xl shadow-xl overflow-hidden"
      style={{ background: T.paper, border: `1px solid ${T.line}` }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-base leading-none transition-colors"
        style={{ color: T.faint }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = T.ink }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = T.faint }}
      >
        ✕
      </button>

      {/* Header */}
      <div className="flex items-baseline justify-between px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${T.line}` }}>
        <span className="text-xl font-bold" style={{ color: T.ink }}>환자 차트</span>
        <span className="text-sm" style={{ color: T.faint }}>소견 {disclosedFacts.length}</span>
      </div>

      {/* Body */}
      <div className="max-h-[440px] overflow-y-auto">
        {disclosedFacts.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: T.faint }}>
            아직 기록된 소견이 없습니다
          </div>
        ) : (
          <ul>
            {disclosedFacts.map((fact, i) => (
              <li
                key={fact.key}
                className="px-6 py-3"
                style={i < disclosedFacts.length - 1 ? { borderBottom: `1px solid ${T.line2}` } : undefined}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-xs font-mono shrink-0" style={{ color: T.faint }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <div className="font-bold text-sm leading-snug" style={{ color: T.ink }}>{fact.label}</div>
                    <div className="text-sm leading-snug mt-0.5" style={{ color: T.inkSoft }}>{fact.value}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
