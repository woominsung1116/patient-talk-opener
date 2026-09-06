/**
 * 좌상단 HUD — '환자 진료 기록' 종이 차트 스타일.
 * 8번출구/당직근무처럼 사실적 무드에 맞춰 다이제틱(진료실 차트)·미니멀·음영 잉크 톤으로.
 * 알록달록 아이콘/네온 게이지를 버리고, 차분한 종이+잉크 + 얇은 지표선으로 표시.
 * 표시 전용 — store 필드(trust/anxiety/rapport/lastDelta/hiddenUnlocked 등) 그대로 사용.
 */
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '../store'

const ratio = (v: number) => Math.max(0, Math.min(1, (v || 0) / 100))

// 음영 잉크/임상 톤 (저채도) — 네온 배제
const ACCENT = {
  trust: '#5b8c6e', // 차분한 세이지
  anxiety: '#b07f45', // 바랜 앰버
  rapport: '#5a7790', // 흐린 슬레이트블루
}

/* ── 차트 한 줄: 라벨 + 얇은 지표선 + 수치 (+델타) ── */
function ChartRow({
  label,
  value,
  accent,
  danger,
  delta,
  deltaGood,
  turn,
}: {
  label: string
  value: number
  accent: string
  danger?: boolean
  delta?: number
  deltaGood?: boolean
  turn: number
}) {
  return (
    <div className="relative">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] tracking-wide text-[#5b626a]">{label}</span>
        <span
          className="font-display text-[12.5px] tabular-nums"
          style={{ color: danger ? '#a8543f' : accent }}
        >
          {value}
        </span>
      </div>
      {/* 지표선: 종이 위 얇은 임상 바 */}
      <div className="h-[3px] w-full rounded-sm bg-[#e2e6ea]">
        <motion.div
          className="h-full rounded-sm"
          style={{ background: danger ? '#a8543f' : accent }}
          animate={{ width: `${ratio(value) * 100}%`, opacity: danger ? [1, 0.5, 1] : 1 }}
          transition={
            danger
              ? { width: { type: 'spring', stiffness: 120, damping: 18 }, opacity: { duration: 1.3, repeat: Infinity } }
              : { type: 'spring', stiffness: 120, damping: 18 }
          }
        />
      </div>
      {delta !== undefined && (
        <DeltaBadge turn={turn} value={delta} good={!!deltaGood} />
      )}
    </div>
  )
}

export function StatusHUD() {
  const {
    trust,
    anxiety,
    rapport,
    turn,
    maxTurns,
    lastDelta,
    hiddenUnlocked,
    hiddenTotal,
    patientNumber,
  } = useGame()

  return (
    <div
      className="pointer-events-none absolute top-4 left-4 z-20 w-52 select-none"
      style={{ perspective: '1200px' }}
    >
      <div
        className="overflow-hidden rounded-[6px] border border-[#e2e6ea] backdrop-blur-[2px]"
        style={{
          // 종이가 책상 위에 비스듬히 놓인 듯 — 왼쪽 모서리가 앞으로, 오른쪽이 안으로
          transform: 'rotateY(15deg) rotateX(3deg)',
          transformOrigin: 'left center',
          // 위·왼쪽에서 빛을 받는 종이: 가까운 쪽 밝고 먼 쪽으로 음영
          background: 'linear-gradient(120deg, #ffffff 0%, #fbfcfc 55%, #eef1f2 100%)',
          // 바닥 그림자 + 근접 그림자로 입체감(공중 부유한 2D 패널 방지)
          boxShadow:
            '0 1px 0 rgba(255,255,255,0.95) inset, -2px 0 0 rgba(0,0,0,0.04) inset, 0 14px 26px -6px rgba(30,26,18,0.38), 0 34px 52px -18px rgba(30,26,18,0.34)',
        }}
      >
        {/* 차트 헤더 */}
        <div className="flex items-center justify-between border-b border-[#eef1f3] bg-[#f1f3f5]/70 px-3 py-1.5">
          <span className="text-[9.5px] font-bold tracking-[0.22em] text-[#98a0a8]">진료 기록</span>
          <span className="text-[10px] tabular-nums text-[#98a0a8]">
            No.{patientNumber} · {turn}/{maxTurns}
          </span>
        </div>

        {/* 지표 */}
        <div className="space-y-2.5 px-3 py-2.5">
          <ChartRow
            label="신뢰"
            value={trust}
            accent={ACCENT.trust}
            danger={trust <= 20}
            delta={lastDelta?.trust ?? 0}
            deltaGood
            turn={turn}
          />
          <ChartRow
            label="불안"
            value={anxiety}
            accent={ACCENT.anxiety}
            danger={anxiety >= 80}
            delta={lastDelta?.anxiety ?? 0}
            deltaGood={false}
            turn={turn}
          />
          <ChartRow label="라포" value={rapport} accent={ACCENT.rapport} turn={turn} />
        </div>

        {/* 확보한 단서 */}
        <div className="flex items-center justify-between border-t border-[#eef1f3] px-3 py-1.5 text-[10px] text-[#98a0a8]">
          <span className="tracking-wide">확보한 단서</span>
          <span className="font-display tabular-nums text-[#5b626a]">
            {hiddenUnlocked} / {hiddenTotal}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── 델타 피드백: 차트 여백에 살짝 떠오르는 가감 표시 (음영 톤) ── */
function DeltaBadge({ turn, value, good }: { turn: number; value: number; good: boolean }) {
  const positive = good ? value > 0 : value < 0
  return (
    <AnimatePresence>
      {value !== 0 && (
        <motion.span
          key={`${turn}-${value}`}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: -8 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="font-display absolute -top-0.5 right-0 text-[11px] tabular-nums"
          style={{ color: positive ? '#3f7a55' : '#a8543f' }}
        >
          {value > 0 ? '+' : ''}
          {value}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
