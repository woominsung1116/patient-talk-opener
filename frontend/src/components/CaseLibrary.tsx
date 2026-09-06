/**
 * 증례 도감 — 카드 형식으로 원하는 케이스를 직접 골라 진료.
 * 학습용이라 진단명(diagnosis_label)과 핵심 포인트(teaching_points)를 카드에서 펼쳐 볼 수 있다.
 * 종이 진료차트 톤(T) 통일.
 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGame } from '../store'
import { sfxPop } from '../audio/sfx'
import { T } from '../ui/theme'
import type { CaseSummary } from '../types'


export function CaseLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { cases, loadCases, startGame } = useGame()
  const [openCard, setOpenCard] = useState<string | null>(null)

  useEffect(() => {
    if (open && cases.length === 0) void loadCases()
  }, [open, cases.length, loadCases])

  const play = (c: CaseSummary) => {
    sfxPop()
    // 단일 증례 진료: 큐를 해당 케이스로 두고 시작
    useGame.setState({ queue: [c.case_id], patientIndex: 0, patientNumber: 1 })
    void startGame(c.case_id)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex flex-col"
          style={{ background: 'rgba(28,22,14,0.55)' }}
        >
          {/* 헤더 */}
          <div
            className="flex items-center justify-between border-b px-6 py-3"
            style={{ background: T.paper, borderColor: T.line }}
          >
            <div>
              <div className="text-[10px] font-bold tracking-[0.22em]" style={{ color: T.faint }}>
                증례 도감
              </div>
              <div className="font-display text-lg" style={{ color: T.ink }}>
                진료할 환자를 고르세요
              </div>
            </div>
            <button
              onClick={() => {
                sfxPop()
                onClose()
              }}
              className="font-display px-2 text-lg transition hover:opacity-60"
              style={{ color: T.inkSoft }}
            >
              닫기
            </button>
          </div>

          {/* 카드 그리드 */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cases.map((c) => {
                const expanded = openCard === c.case_id
                const dc = diffColor(c.difficulty) // 난이도 색: 초록→파랑→빨강
                return (
                  <motion.div
                    key={c.case_id}
                    layout
                    className="overflow-hidden rounded-[6px] border-2 shadow-md"
                    style={{ background: T.paper, borderColor: dc }}
                  >
                    {/* 차트 헤더 탭 (난이도 색으로만 구분) */}
                    <div className="px-4 py-2" style={{ background: dc }}>
                      <span className="font-display text-[14px]" style={{ color: T.paper }}>
                        {c.patient.name}
                        <span className="ml-1.5 text-[11px]" style={{ opacity: 0.8 }}>진료 차트</span>
                      </span>
                    </div>

                    {/* 차트 필드 (체크) */}
                    <div className="px-4 pt-2.5">
                      <CRow label="환자" value={`${c.patient.age}세 · ${c.patient.gender === 'male' ? '남' : '여'}`} accent={dc} />
                      {c.patient.occupation && <CRow label="직업" value={c.patient.occupation} accent={dc} />}
                      <CRow label="주호소" value={`“${c.chief_complaint || c.subtitle}”`} accent={dc} last />
                    </div>

                    <div className="px-4 pb-3 pt-2">
                      {/* 핵심 정보 펼치기 (학습용 — 진단명/포인트 노출) */}
                      <button
                        onClick={() => {
                          sfxPop()
                          setOpenCard(expanded ? null : c.case_id)
                        }}
                        className="mt-2.5 text-[11.5px] underline-offset-2 transition hover:underline"
                        style={{ color: T.slate }}
                      >
                        {expanded ? '핵심 정보 접기 ▴' : '핵심 정보 보기 ▾ (스포일러)'}
                      </button>

                      <AnimatePresence>
                        {expanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2 rounded-md border px-3 py-2" style={{ borderColor: T.line2, background: T.paperHi }}>
                              {c.diagnosis_label && (
                                <div className="mb-1.5 font-display text-[13px]" style={{ color: T.sage }}>
                                  {c.diagnosis_label}
                                </div>
                              )}
                              <ul className="space-y-1">
                                {(c.teaching_points ?? []).map((tp, i) => (
                                  <li key={i} className="flex gap-1.5 text-[12px] leading-snug" style={{ color: T.inkSoft }}>
                                    <span style={{ color: T.amber }}>·</span>
                                    <span>{tp}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button
                        onClick={() => play(c)}
                        className="font-display mt-3 w-full rounded-full py-2 text-sm shadow-sm transition"
                        style={{ background: T.ink, color: T.paper }}
                      >
                        이 환자 진료하기
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
            {cases.length === 0 && (
              <p className="mt-10 text-center text-sm" style={{ color: T.paper }}>
                증례를 불러오는 중...
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* 난이도 색 — 초록(쉬움) → 파랑(보통) → 빨강(어려움) */
function diffColor(level: number): string {
  return level >= 4 ? T.danger : level === 3 ? T.slate : T.sage
}

/* 차트 필드 한 줄 (체크 + 라벨 + 값) */
function CRow({
  label,
  value,
  accent = T.slate,
  last,
}: {
  label: string
  value: string
  accent?: string
  last?: boolean
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-1.5"
      style={last ? undefined : { borderBottom: `1px solid ${T.line2}` }}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" aria-hidden>
        <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke={accent} strokeWidth="2" />
        <path d="M8 12.3l3 3L16.5 9" fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-display shrink-0 text-[12px]" style={{ color: T.ink }}>{label}</span>
      <span className="ml-1 truncate text-[12px]" style={{ color: T.inkSoft }}>{value}</span>
    </div>
  )
}

