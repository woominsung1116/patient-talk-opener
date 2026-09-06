/**
 * 타이틀 — 게임 메인 메뉴 (중앙 로고 + 중앙 메뉴 스택).
 * 배경: 밝은 낮의 진료실 복도를 떠다니는 카메라.
 */
import { lazy, Suspense, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '../store'
/* 타이틀 배경 3D 는 **장식**이라 첫 페인트를 붙잡을 이유가 없다.
   TitleScene 이 ClinicScene 의 Room/SafeEnvironment 를 쓰기 때문에 정적으로
   import 하면 진료실·환자 코드와 three.js 전부가 **첫 청크**로 딸려 온다.
   lazy 로 내려서 메뉴(시작·케이스·설정)가 먼저 뜨게 하고, 배경은 뒤따라
   채워지게 한다. fallback 은 씬의 평균색과 같은 배경이라 깜빡임이 없다. */
const TitleScene = lazy(async () => {
  const module = await import('../three/TitleScene')
  return { default: module.TitleScene }
})
const PatientAppearanceEditor = lazy(async () => {
  const module = await import('./PatientAppearanceEditor')
  return { default: module.PatientAppearanceEditor }
})
import { CaseLibrary } from './CaseLibrary'
import { Settings } from './Settings'
import { sfxPop } from '../audio/sfx'

type MenuView = 'main' | 'howto'

export function TitleScreen() {
  const { startShift, error, setError, resumable, session, resume } = useGame()
  const [view, setView] = useState<MenuView>('main')
  const [starting, setStarting] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showCreator, setShowCreator] = useState(false)

  const begin = async () => {
    if (starting) return
    sfxPop()
    setStarting(true)
    try {
      await startShift()
    } catch {
      setError('서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인해주세요.')
      setStarting(false)
    }
  }

  return (
    <div className="relative h-full overflow-hidden bg-[#c9d6d4]">
      <Suspense fallback={null}>
        <TitleScene />
      </Suspense>

      {/* 가독성용 미세 다크닝 */}
      <div className="pointer-events-none absolute inset-0 bg-black/25" />

      {/* ── 중앙 메뉴 레이어 ── */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {/* 로고 */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0 }}
          className="text-center select-none"
        >
          <div className="font-display text-[15px] tracking-[0.5em] text-emerald-100/80 drop-shadow">
            오늘도 진료실의 문이 열린다
          </div>
          <h1
            className="font-display mt-2 text-7xl text-white md:text-8xl"
            style={{ textShadow: '0 4px 24px rgba(0,0,0,0.55), 0 1px 0 rgba(0,0,0,0.4)' }}
          >
            환자 말문 열기
          </h1>
          <div className="mx-auto mt-4 h-px w-48 bg-white/30" />
        </motion.div>

        {/* 메뉴 스택 */}
        <div className="mt-12 flex min-h-44 flex-col items-center">
          <AnimatePresence mode="wait">
            {view === 'main' && (
              <motion.nav
                key="main"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex flex-col items-center gap-2"
              >
                <MenuItem
                  label={starting ? '첫 환자 접수 중...' : '근무 시작'}
                  primary
                  onClick={() => void begin()}
                />
                <MenuItem label="증례 선택" onClick={() => { sfxPop(); setShowLibrary(true) }} />
                <MenuItem label="교수자 환자 연출" onClick={() => { sfxPop(); setShowCreator(true) }} />
                <MenuItem label="게임 방법" onClick={() => { sfxPop(); setView('howto') }} />
                {resumable && session && (
                  <MenuItem label="이어하기" onClick={() => { sfxPop(); resume() }} />
                )}
              </motion.nav>
            )}

            {view === 'howto' && (
              <motion.div
                key="howto"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="max-w-lg overflow-hidden rounded-[6px] border shadow-[0_14px_40px_rgba(30,22,12,0.5)]"
                style={{ background: '#ffffff', borderColor: '#e2e6ea' }}
              >
                {/* 차트 헤더 */}
                <div
                  className="border-b px-5 py-2"
                  style={{ borderColor: '#eef1f3', background: 'rgba(241,243,245,0.7)' }}
                >
                  <span className="text-[10px] font-bold tracking-[0.22em]" style={{ color: '#98a0a8' }}>
                    게임 방법
                  </span>
                </div>
                <div className="space-y-3 px-7 py-5 text-[14px] leading-relaxed" style={{ color: '#5b626a' }}>
                  <p><b style={{ color: '#2f343a' }}>마이크 버튼(또는 스페이스바)을 꾹 눌러</b> 환자에게 말을 거세요.</p>
                  <p>공감하며 부드럽게 물으면 <b style={{ color: '#5b8c6e' }}>신뢰</b>가 오르고, 환자가 숨겨둔 이야기를 꺼냅니다.</p>
                  <p>다그치거나 성급히 단정하면 <b style={{ color: '#b07f45' }}>불안</b>이 치솟고, 신뢰를 잃으면 환자는 입을 닫습니다.</p>
                  <p>15턴 안에 문진을 마치고 <b style={{ color: '#2f343a' }}>진단과 검사를 제출</b>하면 채점됩니다.</p>
                  <p>환자는 무작위 순서로 배정되고, 진료가 끝나면 다음 환자가 들어옵니다.</p>
                </div>
                <div className="px-7 pb-5">
                  <button
                    onClick={() => { sfxPop(); setView('main') }}
                    className="font-display mx-auto block rounded-full border px-6 py-1.5 text-sm transition"
                    style={{ borderColor: '#e2e6ea', color: '#5b626a' }}
                  >
                    돌아가기
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {error && (
        <button
          onClick={() => setError(null)}
          className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded border border-rose-400/40 bg-black/70 px-5 py-2.5 text-sm text-rose-300 backdrop-blur"
        >
          {error}
        </button>
      )}

      {/* 증례 선택 → 카드 도감 */}
      <CaseLibrary open={showLibrary} onClose={() => setShowLibrary(false)} />

      <AnimatePresence>
        {showCreator && (
          <Suspense fallback={<div className="fixed inset-0 z-[100] grid place-items-center bg-[#f4f6f7] text-sm text-[#718089]">환자 연출 스튜디오를 여는 중…</div>}>
            <PatientAppearanceEditor onClose={() => setShowCreator(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* 우상단 설정 (메인에서도 소리/음성 조절) */}
      <Settings showExit={false} />
    </div>
  )
}

function MenuItem({
  label,
  primary,
  onClick,
}: {
  label: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`font-display group relative px-10 py-2.5 transition ${
        primary ? 'text-4xl text-white' : 'text-2xl text-white/70 hover:text-white'
      }`}
      style={{ textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}
    >
      <span className="absolute top-1/2 left-0 -translate-y-1/2 text-emerald-300 opacity-0 transition group-hover:opacity-100">
        ▸
      </span>
      {label}
      <span className="absolute top-1/2 right-0 -translate-y-1/2 text-emerald-300 opacity-0 transition group-hover:opacity-100">
        ◂
      </span>
    </motion.button>
  )
}
