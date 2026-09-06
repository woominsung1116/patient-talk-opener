/**
 * 신체진찰 HUD — 3D 진찰실을 가리지 않는 사이드/하단 패널.
 *
 * 이 패널에는 진찰 도구 버튼도 준비 버튼도 없다. 시험이므로 "무엇을 해야 하는지"를
 * 화면이 먼저 알려주지 않고, 학생이 환자에게 직접 말해야 진행되기 때문이다:
 *  - 준비/자세(설명·동의, 가려주기, 무릎 세우기, 턱 들기·삼킴·심호흡)는 발화 intent(store.applyTurn)가
 *    곧바로 시행으로 이어진다.
 *  - 진찰(복부·CVA·두경부·흉부)은 발화가 '도구 선택'(store.examTool)까지만 하고,
 *    실제 시행은 3D 환자 몸의 부위 메시(4분면 / 옆구리 / 눈 / 갑상샘 엽 / 구강 / 판막 / 폐야)를
 *    일정 시간 눌러야 일어난다.
 *  - 부위가 없는 시진만 예외다: 갑상샘 시진은 발화 즉시, 손떨림은 자세를 유지해야 시행된다
 *    (store.examSustainStart — 아래 '유지 중' 카드가 그 경과를 보여준다).
 *  - 손위생은 3D 손소독 펌프 클릭 또는 "손소독하겠습니다" 발화로 기록된다.
 *
 * 그래서 이 패널이 맡는 것은 (1) 완료 개수와 시행한 진찰 목록, (2) 부위를 나눠 찍는 항목의
 * 진행률, (3) 마이크와 '진찰 마치기' 버튼, (4) finding·안내 토스트뿐이다.
 * 데이터/채점 계약은 store(doExamAction/finishExam/examPose/examTool/examRegion)에 위임한다.
 */
import { motion, AnimatePresence } from 'framer-motion'
import { useGame, REGION_LABEL, HOLD_SECONDS } from '../store'
import { MicButton } from './MicButton'
import { T } from '../ui/theme'

/* 진행 키는 "<region>"(예: flank_r) 또는 "<pass>:<region>"(예: deep:rlq) 두 형태다. */
const REGION_TEXT = REGION_LABEL as Record<string, string>
const PASS_TEXT: Record<string, string> = { light: '얕게', deep: '깊게' }

/** 진행 키에서 부위 id만 떼어낸다 */
function regionOf(key: string): string {
  const i = key.indexOf(':')
  return i < 0 ? key : key.slice(i + 1)
}
/** 진행 키의 pass — 없으면 null */
function passOf(key: string): string | null {
  const i = key.indexOf(':')
  return i < 0 ? null : key.slice(0, i)
}

export function ExamPanel() {
  const {
    examItems, examLog, lastFinding, examHint,
    examProgress, examPass, examTool, examSustainStart,
    finishExam,
    busy, examBusy,
  } = useGame()
  // 음성/입력 후 LLM·서버 처리 중이면 스피너로 피드백 (자세가 바로 안 바뀌어 보이는 어색함 방지)
  const processing = busy === 'thinking' || busy === 'transcribing' || examBusy

  const done = new Set(examLog.map((e) => e.action_id))
  const examActionsDone = examItems.filter((it) => it.type === 'exam_action' && done.has(it.id)).length
  const examActionsTotal = examItems.filter((it) => it.type === 'exam_action').length

  /*
   * 부분 진행 표시 — 지금 고른 도구가 부위를 나눠 찍는 항목일 때만 뜬다.
   * 진행 정보는 서버 응답(examProgress)에만 의존한다. 케이스의 required_regions를 미리 읽어
   * "0/4"를 먼저 띄우면 시행 전에 요구 부위 수를 알려주는 셈이라 시험 취지에 어긋나기 때문.
   */
  const toolProgress = examTool ? examProgress[examTool] : undefined
  const toolLabel = examTool ? examItems.find((it) => it.id === examTool)?.label ?? '' : ''
  const doneCount = toolProgress?.done.length ?? 0
  const totalCount = toolProgress?.total ?? 0
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  // 촉진처럼 pass가 있는 항목은 '지금 해야 할 pass'의 남은 부위만 보여준다.
  // (다음 pass까지 한꺼번에 늘어놓으면 앞으로 할 일 목록이 되어 버린다)
  const remainingKeys: string[] = toolProgress?.remaining ?? []
  const passFiltered = examPass ? remainingKeys.filter((k: string) => passOf(k) === examPass) : remainingKeys
  const remainingLabels = Array.from(
    new Set(
      (passFiltered.length > 0 ? passFiltered : remainingKeys).map((k: string) => REGION_TEXT[regionOf(k)] ?? regionOf(k)),
    ),
  )

  /*
   * 자세 유지형 시진(손떨림) — 부위가 없어 서버 progress가 오지 않는다.
   * 평가표가 "자세를 유지한 채 최소 10초 이상 관찰"을 요구하므로, 관찰이 진행 중임을 보여준다.
   * (3D 부위 메시의 press-hold 링과 같은 성격의 피드백이다. 남은 항목 목록은 여전히 노출하지 않는다)
   */
  const sustainSeconds = examTool ? HOLD_SECONDS[examTool] : 0
  const sustaining = examSustainStart !== null && !!examTool && sustainSeconds > 0

  return (
    // 루트는 클릭 통과(pointer-events-none) — 3D 클릭이 가능해야 한다. 패널만 pointer-events-auto.
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* ───── 좌측 진찰 패널 ───── */}
      <motion.aside
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="pointer-events-auto absolute top-4 left-4 bottom-4 flex w-[16.5rem] flex-col gap-3"
      >
        {/* 헤더 */}
        <div
          className="rounded-2xl px-4 py-3 shadow-xl backdrop-blur-sm"
          style={{ background: 'rgba(255,255,255,0.92)', border: `1px solid ${T.line}` }}
        >
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg" style={{ color: T.ink }}>신체진찰</h2>
            <span className="text-[12px]" style={{ color: T.inkSoft }}>
              진찰 {examActionsDone}/{examActionsTotal}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: T.faint }}>
            환자에게 직접 말해 준비·자세를 진행하고, 도구로 진찰하세요.
          </p>
        </div>

        {/* 스크롤 영역: 진행률 + 시행 기록 (※ 시험: 준비 단계 안내/체크리스트는 노출하지 않는다) */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto nice-scroll pr-0.5">
          {/* 진행 중인 진찰 — 이미 고른 도구의 진행률만 (무엇을 해야 하는지는 알려주지 않는다) */}
          <AnimatePresence initial={false}>
            {toolProgress && (
              <motion.div
                key={`exam-progress-${examTool}`}
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="overflow-hidden rounded-2xl p-3 shadow-lg backdrop-blur-sm"
                style={{ background: 'rgba(255,255,255,0.92)', border: `1px solid ${T.line2}` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-[13px] leading-tight" style={{ color: T.ink }}>
                    {toolLabel || '진행 중인 진찰'}
                  </h3>
                  <span className="shrink-0 text-[12px] font-bold tabular-nums" style={{ color: T.slate }}>
                    {doneCount}/{totalCount}
                  </span>
                </div>

                {/* 진행 막대 */}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: T.line2 }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: T.slate }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                  />
                </div>

                {/* 촉진처럼 얕게→깊게 2단계가 있는 항목만 현재 단계를 표시 */}
                {examPass && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11.5px]" style={{ color: T.inkSoft }}>
                    <span>지금 단계</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{ background: 'rgba(84,120,160,0.12)', color: T.slate }}
                    >
                      {PASS_TEXT[examPass] ?? examPass}
                    </span>
                  </div>
                )}

                {remainingLabels.length > 0 && (
                  <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: T.faint }}>
                    남은 부위 · {remainingLabels.join(' · ')}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 자세 유지형 시진 — 유지가 끊기면 시행되지 않으므로 진행 중임을 보여준다 */}
          <AnimatePresence initial={false}>
            {sustaining && (
              <motion.div
                key={`exam-sustain-${examSustainStart}`}
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="overflow-hidden rounded-2xl p-3 shadow-lg backdrop-blur-sm"
                style={{ background: 'rgba(255,255,255,0.92)', border: `1px solid ${T.line2}` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-[13px] leading-tight" style={{ color: T.ink }}>
                    {toolLabel || '진행 중인 진찰'}
                  </h3>
                  <span className="shrink-0 text-[12px] font-bold" style={{ color: T.slate }}>
                    자세 유지 중
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: T.line2 }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: T.slate }}
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: sustainSeconds, ease: 'linear' }}
                  />
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: T.faint }}>
                  자세가 유지되는 동안 관찰됩니다. 다른 진찰로 넘어가면 처음부터 다시 해야 해요.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 시행한 진찰 — 완료된 항목만 (부분 진행 중인 항목은 위 카드에만 보인다) */}
          <div className="rounded-2xl p-3 shadow-lg backdrop-blur-sm" style={{ background: 'rgba(255,255,255,0.92)', border: `1px solid ${T.line2}` }}>
            <h3 className="font-display text-[13px]" style={{ color: T.ink }}>시행한 진찰</h3>
            <ul className="mt-2 space-y-1.5 text-[12px]" style={{ color: T.inkSoft }}>
              {examLog.length === 0 && <li style={{ color: T.faint }}>아직 없음</li>}
              {examLog.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span style={{ color: T.sage }}>✓</span>
                  <span>{e.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </motion.aside>

      {/* ───── 우하단: 마이크 + 마치기 ───── */}
      <div className="pointer-events-auto absolute right-5 bottom-5 flex flex-col items-center gap-3">
        <MicButton />
        <button
          onClick={finishExam}
          className="font-display rounded-full px-5 py-2.5 text-sm shadow-md transition hover:brightness-105"
          style={{ background: T.ink, color: T.paper }}
        >
          진찰 마치고 설명하기 →
        </button>
      </div>

      {/* ───── 하단 중앙: 처리중 스피너 / finding / 안내 토스트 ───── */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <AnimatePresence>
          {processing && (
            <motion.div
              key="exam-loading"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2.5 rounded-full px-5 py-2.5 text-[13px] font-bold shadow-lg"
              style={{ background: T.ink, color: T.paper }}
            >
              <motion.span
                className="inline-block h-4 w-4 rounded-full border-2"
                style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }}
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
              />
              {busy === 'transcribing' ? '음성 인식 중…' : '환자가 반응하는 중…'}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {lastFinding && (
            <motion.div
              key={lastFinding}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-full px-5 py-2 text-[13px] font-bold shadow-lg"
              style={{ background: T.ink, color: T.paper }}
            >
              {lastFinding}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {examHint && (
            <motion.div
              key={examHint}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-[6px] border px-5 py-2.5 text-sm shadow-xl"
              style={{ background: T.paper, borderColor: T.amber, color: T.ink }}
            >
              {examHint}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
