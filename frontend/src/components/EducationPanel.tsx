/**
 * 환자교육 단계 — 진단 설명(근거) → 검사계획 → 치료 → 합병증 설명 후 최종 제출.
 * CPX 워크시트 18~23번. 제출 시 진단명 + education payload 를 함께 보낸다.
 */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useGame } from '../store'
import { T } from '../ui/theme'
import type { EducationItem } from '../types'

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative w-full rounded-xl border-2 px-3 py-2.5 text-left text-[13px] transition"
      style={on
        ? { borderColor: T.sage, background: `${T.sage}18`, color: T.ink, fontWeight: 700 }
        : { borderColor: T.line2, background: T.paper, color: T.ink }}
    >
      {label}
      {on && (
        <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full text-[12px]"
          style={{ background: T.sage, color: T.paper }}>✓</span>
      )}
    </button>
  )
}

export function EducationPanel() {
  const { session, submit } = useGame()
  const items: EducationItem[] = session?.education_items ?? []
  const [dx, setDx] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [testPlan, setTestPlan] = useState<string[]>([])
  const [treatment, setTreatment] = useState<string[]>([])
  const [complication, setComplication] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  const dxItem = useMemo(() => items.find((it) => it.kind === 'diagnosis_explanation'), [items])
  const testItems = items.filter((it) => it.kind === 'test_plan')
  const txItems = items.filter((it) => it.kind === 'treatment')
  const compItems = items.filter((it) => it.kind === 'complication')

  if (!session) return null

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const doSubmit = async () => {
    if (sending || !dx.trim()) return
    setSending(true)
    try {
      await submit([dx.trim()], [], {
        diagnosis_evidence: evidence,
        test_plan: testPlan,
        treatment,
        complication,
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-center overflow-y-auto nice-scroll py-6"
      style={{ background: 'rgba(16,20,24,0.62)', backdropFilter: 'blur(3px)' }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="mx-4 mb-6 h-fit w-full max-w-xl rounded-3xl p-6 shadow-2xl"
        style={{ background: T.paper, border: `3px solid ${T.line}` }}
      >
        <h2 className="font-display text-xl" style={{ color: T.ink }}>환자에게 설명하기</h2>
        <p className="mt-1 text-[13px]" style={{ color: T.inkSoft }}>
          진단과 앞으로의 계획을 환자에게 설명하듯 정리해 주세요.
        </p>

        {/* 진단명 */}
        <div className="mt-5">
          <h3 className="font-display text-sm" style={{ color: T.ink }}>진단명</h3>
          <input
            autoFocus value={dx} onChange={(e) => setDx(e.target.value)}
            placeholder="예: 요로결석"
            className="mt-2 w-full rounded-xl border-2 px-4 py-3 text-[16px] outline-none transition"
            style={{ borderColor: T.line, background: T.paperHi, color: T.ink }}
          />
        </div>

        {/* 진단 근거 */}
        {dxItem?.evidence_options && (
          <div className="mt-4">
            <h3 className="font-display text-sm" style={{ color: T.ink }}>진단 근거 <span className="text-[12px] font-normal" style={{ color: T.faint }}>(2개 이상 권장)</span></h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {dxItem.evidence_options.map((o) => (
                <Toggle key={o.id} label={o.label} on={evidence.includes(o.id)}
                  onClick={() => toggle(evidence, setEvidence, o.id)} />
              ))}
            </div>
          </div>
        )}

        {/* 검사계획 */}
        {testItems.length > 0 && (
          <div className="mt-4">
            <h3 className="font-display text-sm" style={{ color: T.ink }}>검사 계획</h3>
            <div className="mt-2 space-y-2">
              {testItems.map((it) => (
                <Toggle key={it.id} label={it.label} on={testPlan.includes(it.id)}
                  onClick={() => toggle(testPlan, setTestPlan, it.id)} />
              ))}
            </div>
          </div>
        )}

        {/* 치료 */}
        {txItems.length > 0 && (
          <div className="mt-4">
            <h3 className="font-display text-sm" style={{ color: T.ink }}>치료 계획</h3>
            <div className="mt-2 space-y-2">
              {txItems.map((it) => (
                <Toggle key={it.id} label={it.label} on={treatment.includes(it.id)}
                  onClick={() => toggle(treatment, setTreatment, it.id)} />
              ))}
            </div>
          </div>
        )}

        {/* 합병증 */}
        {compItems.length > 0 && (
          <div className="mt-4">
            <h3 className="font-display text-sm" style={{ color: T.ink }}>합병증·주의 설명</h3>
            <div className="mt-2 space-y-2">
              {compItems.map((it) => (
                <Toggle key={it.id} label={it.label} on={complication.includes(it.id)}
                  onClick={() => toggle(complication, setComplication, it.id)} />
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => void doSubmit()}
          disabled={!dx.trim() || sending}
          className="font-display mt-6 w-full rounded-full px-6 py-3 shadow-md transition"
          style={!dx.trim() || sending
            ? { background: T.line2, color: T.faint }
            : { background: T.ink, color: T.paper }}
        >
          {sending ? '채점 중...' : '진료 마치고 결과 보기'}
        </button>
      </motion.div>
    </div>
  )
}
