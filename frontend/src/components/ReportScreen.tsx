/**
 * 결과 리포트 — 종이 진료차트 톤. 등급 도장 + 점수 바 + 교수 피드백.
 */
import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { sfxStamp } from '../audio/sfx'
import { useGame } from '../store'
import { T } from '../ui/theme'

const SCORE_LABELS: Record<string, string> = {
  history_taking: '병력청취',
  rapport: '라포 형성',
  red_flag: 'Red Flag 확인',
  clinical_reasoning: '감별진단',
  test_selection: '검사 선택',
  physical_exam: '신체진찰',
  patient_education: '환자교육',
  ppi: '환자의사관계(PPI)',
}

const GRADE_STYLE: Record<string, { color: string; msg: string }> = {
  S: { color: T.amber,  msg: '완벽한 문진이에요! 교수님도 감탄!' },
  A: { color: T.sage,   msg: '훌륭해요! 환자가 안심하고 돌아갔어요.' },
  B: { color: T.slate,  msg: '좋아요! 조금만 더 다듬으면 완벽해요.' },
  C: { color: T.faint,  msg: '아쉬워요. 놓친 단서를 복습해봐요.' },
  D: { color: T.danger, msg: '환자의 마음을 열지 못했어요. 다시 도전!' },
  F: { color: T.danger, msg: '진료라고 하기 어려워요... 게임 방법을 다시 읽어보세요.' },
}

export function ReportScreen() {
  const { report, session, reset, gameOver, nextPatient, patientNumber, replay } = useGame()

  useEffect(() => {
    const t = setTimeout(sfxStamp, 500)
    return () => clearTimeout(t)
  }, [])

  if (!report || !session) return null
  const grade = GRADE_STYLE[report.grade]

  return (
    <div
      className="nice-scroll flex h-full items-start justify-center overflow-y-auto py-8"
      style={{ background: `linear-gradient(to bottom, ${T.paper}, ${T.paperHi})` }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-4 w-full max-w-2xl rounded-3xl p-8 shadow-2xl"
        style={{
          background: T.paper,
          border: `3px solid ${T.line}`,
        }}
      >
        {/* 헤더 + 등급 도장 */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl" style={{ color: T.ink }}>문진 결과 리포트</h1>
            <p className="mt-1 text-sm" style={{ color: T.inkSoft }}>
              오늘 {patientNumber}번째 환자 · {session.title} · {report.turns_used}턴 사용
              {report.section_times && (
                <> · {Object.entries(report.section_times).map(([k, v]) => `${({ playing: '문진', exam: '진찰', education: '교육' } as Record<string, string>)[k] ?? k} ${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`).join(' / ')}</>
              )}
            </p>
            {gameOver === 'trust_collapsed' && (
              <p className="mt-1 text-sm font-bold" style={{ color: T.danger }}>
                환자가 마음을 닫아버렸어요...
              </p>
            )}
          </div>
          <motion.div
            initial={{ scale: 3, opacity: 0, rotate: -20 }}
            animate={{ scale: 1, opacity: 1, rotate: -12 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.4 }}
            className="font-display flex h-24 w-24 items-center justify-center rounded-full border-8 text-5xl"
            style={{ borderColor: grade.color, color: grade.color }}
          >
            {report.grade}
          </motion.div>
        </div>

        {/* 총점 */}
        <div
          className="mt-4 rounded-2xl p-4 text-center"
          style={{ background: T.paperHi, border: `1px solid ${T.line2}` }}
        >
          <span className="font-display text-4xl" style={{ color: T.ink }}>{report.final_score}</span>
          <span style={{ color: T.inkSoft }}> / 100</span>
          <p className="mt-1 text-sm font-bold" style={{ color: grade.color }}>
            {grade.msg}
          </p>
        </div>

        {/* 진단 결과 */}
        <div
          className="mt-4 rounded-2xl border-2 p-4"
          style={
            report.diagnosis_correct
              ? { borderColor: T.sage, background: `${T.sage}15` }
              : { borderColor: T.danger, background: `${T.danger}12` }
          }
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-sm" style={{ color: report.diagnosis_correct ? T.sage : T.danger }}>
              {report.diagnosis_correct ? '정답!' : '아쉬워요'}
            </span>
            <span className="text-sm" style={{ color: T.ink }}>
              정답 진단: <b>{report.correct_diagnosis.label}</b>
            </span>
          </div>
          {report.diagnosis_feedback && (
            <>
              {report.diagnosis_feedback.chosen.length > 0 && (
                <p className="mt-2 text-[13px]" style={{ color: T.inkSoft }}>
                  내가 고른 진단: {report.diagnosis_feedback.chosen.join(', ')}
                </p>
              )}
              <p className="mt-1 text-[13px] leading-snug" style={{ color: T.ink }}>
                {report.diagnosis_feedback.verdict}
              </p>
            </>
          )}
        </div>

        {/* 영역별 점수 */}
        <div className="mt-5 space-y-2.5">
          {Object.entries(report.scores).map(([key, val], i) => (
            <div key={key}>
              <div className="mb-0.5 flex justify-between text-[12px] font-bold" style={{ color: T.inkSoft }}>
                <span>{SCORE_LABELS[key] ?? key}</span>
                <span>
                  {val}/{report.max_scores[key]}
                </span>
              </div>
              <div className="h-3.5 overflow-hidden rounded-full" style={{ background: T.line2 }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(val / report.max_scores[key]) * 100}%` }}
                  transition={{ delay: 0.5 + i * 0.12, duration: 0.6, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(to right, ${T.sage}99, ${T.sage})` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* PPI(환자의사관계) 6영역 세부 — CPX 케이스 */}
        {report.ppi_detail && (
          <details className="mt-5 rounded-2xl p-4" style={{ border: `1px solid ${T.line2}`, background: T.paperHi }}>
            <summary className="font-display cursor-pointer text-sm" style={{ color: T.ink }}>
              환자의사관계(PPI) 세부 — {report.ppi_detail.raw}/{report.ppi_detail.measurable}항목 충족
              {report.ppi_detail.measurable < report.ppi_detail.total_items && (
                <span className="ml-1 text-[12px] font-normal" style={{ color: T.faint }}>
                  (게임에서 평가 가능한 {report.ppi_detail.measurable}항목 기준)
                </span>
              )}
            </summary>
            <div className="mt-3 space-y-2.5">
              {report.ppi_detail.categories.map((c) => (
                <div key={c.category}>
                  <div className="mb-0.5 flex justify-between text-[12px] font-bold" style={{ color: T.inkSoft }}>
                    <span>{c.category}. {c.label}</span>
                    <span>{c.got}/{c.measurable}{c.measurable < c.total ? ` (총 ${c.total})` : ''}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full" style={{ background: T.line2 }}>
                    <div className="h-full rounded-full"
                      style={{ width: `${c.measurable ? (c.got / c.measurable) * 100 : 0}%`, background: T.slate }} />
                  </div>
                </div>
              ))}
            </div>
            {/* 미충족 항목 + 구체적 피드백 멘트 (PPI_체크리스트_피드백 기준) */}
            {report.ppi_detail.items.some((it) => it.status === 'fail') && (
              <div className="mt-3">
                <h4 className="text-[12px] font-bold" style={{ color: T.inkSoft }}>이렇게 해보세요</h4>
                <ul className="mt-1.5 space-y-1.5">
                  {report.ppi_detail.items.filter((it) => it.status === 'fail').map((it) => (
                    <li key={it.id} className="rounded-xl px-3 py-2 text-[12.5px] leading-snug"
                      style={{ background: T.paper, border: `1px solid ${T.line2}`, color: T.ink }}>
                      <b style={{ color: T.danger }}>{it.label}</b>
                      {it.feedback ? <span style={{ color: T.inkSoft }}> — {it.feedback}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </details>
        )}

        {/* 신체진찰 감점 사유 */}
        {report.exam_detail && report.exam_detail.penalties.length > 0 && (
          <div className="mt-4 rounded-2xl p-4" style={{ border: `1px solid ${T.amber}60`, background: `${T.amber}0d` }}>
            <h3 className="font-display text-sm" style={{ color: T.amber }}>신체진찰 주의</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-snug" style={{ color: T.ink }}>
              {report.exam_detail.penalties.map((p, i) => <li key={i}>· {p}</li>)}
            </ul>
          </div>
        )}

        {/* 피드백 */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div
            className="rounded-2xl p-4"
            style={{ border: `1px solid ${T.sage}50`, background: `${T.sage}10` }}
          >
            <h3 className="font-display text-sm" style={{ color: T.sage }}>잘한 점</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-snug" style={{ color: T.ink }}>
              {report.feedback.good_points.map((p, i) => (
                <li key={i}>· {p}</li>
              ))}
            </ul>
          </div>
          <div
            className="rounded-2xl p-4"
            style={{ border: `1px solid ${T.danger}40`, background: `${T.danger}0d` }}
          >
            <h3 className="font-display text-sm" style={{ color: T.danger }}>놓친 점</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-snug" style={{ color: T.ink }}>
              {report.feedback.missed_points.map((p, i) => (
                <li key={i}>· {p}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* 신뢰를 얻은 결정적 순간 */}
        {report.trust_moments && report.trust_moments.length > 0 && (
          <div
            className="mt-4 rounded-2xl p-4"
            style={{ border: `1px solid ${T.line}`, background: T.paperHi }}
          >
            <h3 className="font-display text-sm" style={{ color: T.slate }}>신뢰를 얻은 말</h3>
            <ul className="mt-2 space-y-2">
              {report.trust_moments.map((m, i) => (
                <li
                  key={i}
                  className="rounded-xl p-3 shadow-sm"
                  style={{ background: T.paper, border: `1px solid ${T.line2}` }}
                >
                  <p className="text-[13px] italic leading-snug" style={{ color: T.ink }}>"{m.user_text}"</p>
                  <p className="mt-1 flex items-center gap-2 text-[12px]" style={{ color: T.inkSoft }}>
                    <span>{m.turn}턴</span>
                    {m.unlocked && (
                      <span
                        className="rounded-full px-2 py-0.5 font-bold"
                        style={{ background: `${T.amber}20`, color: T.amber }}
                      >
                        단서 해금
                      </span>
                    )}
                    {m.trust_delta > 0 && (
                      <span className="font-bold" style={{ color: T.sage }}>신뢰 +{m.trust_delta}</span>
                    )}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug" style={{ color: T.inkSoft }}>{m.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 놓친 핵심 단서 + 모범 질문 */}
        {report.missed_hidden_facts && report.missed_hidden_facts.length > 0 && (
          <div
            className="mt-4 rounded-2xl p-4"
            style={{ border: `1px solid ${T.amber}60`, background: `${T.amber}0d` }}
          >
            <h3 className="font-display text-sm" style={{ color: T.amber }}>놓친 핵심 단서, 이렇게 물어봤다면</h3>
            <p className="mt-1 text-[12px]" style={{ color: T.inkSoft }}>
              아래 단서들을 끝내 끌어내지 못했어요. 다음엔 이런 질문으로 다가가 보세요.
            </p>
            <ul className="mt-3 space-y-2.5">
              {report.missed_hidden_facts.map((f, i) => (
                <li
                  key={i}
                  className="rounded-xl p-3 shadow-sm"
                  style={{ background: T.paper, border: `1px solid ${T.line2}` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[13px]" style={{ color: T.ink }}>{f.label}</span>
                    {f.sensitive && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                        style={{ background: `${T.danger}18`, color: T.danger }}
                      >
                        민감한 주제
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-1.5 rounded-lg px-3 py-2 text-[13px] leading-snug"
                    style={{ background: T.paperHi, color: T.inkSoft }}
                  >
                    "{f.question}"
                  </p>
                  <p className="mt-1.5 text-[12px] leading-snug" style={{ color: T.inkSoft }}>
                    {f.tip}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 교수 총평 */}
        <div
          className="mt-4 rounded-2xl border-2 p-4"
          style={{ borderColor: T.line, background: T.paperHi }}
        >
          <h3 className="font-display text-sm" style={{ color: T.ink }}>교수님의 한마디</h3>
          <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: T.ink }}>
            {report.feedback.short_feedback}
          </p>
        </div>

        {/* 학습 포인트 */}
        <details
          className="mt-4 rounded-2xl p-4"
          style={{ border: `1px solid ${T.line2}` }}
        >
          <summary className="font-display cursor-pointer text-sm" style={{ color: T.ink }}>
            이 케이스의 학습 포인트
          </summary>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-snug" style={{ color: T.inkSoft }}>
            {report.teaching_points.map((p, i) => (
              <li key={i}>· {p}</li>
            ))}
          </ul>
        </details>

        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => void nextPatient()}
            className="font-display rounded-full px-8 py-3 shadow-lg transition"
            style={{ background: T.ink, color: T.paper }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.inkSoft)}
            onMouseLeave={(e) => (e.currentTarget.style.background = T.ink)}
          >
            다음 환자 받기
          </button>
          <button
            onClick={() => void replay()}
            className="font-display rounded-full px-6 py-3 shadow transition"
            style={{ border: `2px solid ${T.line}`, background: T.paper, color: T.inkSoft }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.paperHi)}
            onMouseLeave={(e) => (e.currentTarget.style.background = T.paper)}
          >
            다시 진료하기
          </button>
          <button
            onClick={reset}
            className="font-display rounded-full px-6 py-3 shadow transition"
            style={{
              border: `2px solid ${T.line}`,
              background: T.paper,
              color: T.inkSoft,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.paperHi)}
            onMouseLeave={(e) => (e.currentTarget.style.background = T.paper)}
          >
            퇴근하기
          </button>
        </div>
      </motion.div>
    </div>
  )
}

