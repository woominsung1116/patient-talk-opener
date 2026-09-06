/**
 * 우상단 설정 — 톱니 버튼 → 패널(전체 볼륨 / 환자 음성 / 게임 방법 / 메인으로).
 * HUD와 동일한 종이·잉크 톤. 소리 관련은 전부 여기로 모음.
 */
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGame } from '../store'
import { sfxPop } from '../audio/sfx'
import { T } from '../ui/theme'
import { Credits } from './Credits'

export function Settings({
  onShowOnboarding,
  showExit = true,
}: {
  onShowOnboarding?: () => void
  showExit?: boolean
}) {
  const { voiceEnabled, toggleVoice, volume, setVolume, goTitle, musicEnabled, toggleMusic, sfxEnabled, toggleSfx } = useGame()
  const [open, setOpen] = useState(false)
  const [credits, setCredits] = useState(false)
  const hasExtras = !!onShowOnboarding || showExit

  return (
    <div className="absolute top-4 right-4 z-40">
      {/* 톱니 버튼 */}
      <button
        onClick={() => {
          sfxPop()
          setOpen((o) => !o)
        }}
        title="설정"
        aria-label="설정"
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] shadow-sm transition hover:brightness-95"
        style={{ background: 'rgba(255,255,255,0.92)', borderColor: T.line, color: T.inkSoft }}
      >
        <GearGlyph />
        <span className="font-display">설정</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* 바깥 클릭 닫기 */}
            <div className="fixed inset-0 -z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 240, damping: 22 }}
              className="absolute right-0 mt-2 w-64 overflow-hidden rounded-[6px] border shadow-[0_14px_40px_rgba(30,22,12,0.4)]"
              style={{ background: T.paper, borderColor: T.line }}
            >
              <div
                className="border-b px-4 py-2 text-[10px] font-bold tracking-[0.22em]"
                style={{ borderColor: T.line2, background: T.header, color: T.faint }}
              >
                설정
              </div>

              <div className="space-y-4 px-4 py-4">
                {/* 전체 볼륨 */}
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-[12px]" style={{ color: T.inkSoft }}>전체 볼륨</span>
                    <span className="font-display text-[12px] tabular-nums" style={{ color: T.ink }}>
                      {Math.round(volume * 100)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(volume * 100)}
                    onChange={(e) => setVolume(Number(e.target.value) / 100)}
                    className="w-full accent-[#5b8c6e]"
                    style={{ accentColor: T.sage }}
                  />
                </div>

                {/* 환자 음성 */}
                <button
                  onClick={() => {
                    sfxPop()
                    toggleVoice()
                  }}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-[13px] transition"
                  style={{ borderColor: T.line2, color: T.inkSoft, background: voiceEnabled ? 'rgba(91,140,110,0.12)' : 'transparent' }}
                >
                  <span>환자 음성</span>
                  <span className="font-display" style={{ color: voiceEnabled ? T.sage : T.faint }}>
                    {voiceEnabled ? '켜짐' : '꺼짐'}
                  </span>
                </button>

                {/* 배경음악 */}
                <button
                  onClick={() => {
                    sfxPop()
                    toggleMusic()
                  }}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-[13px] transition"
                  style={{ borderColor: T.line2, color: T.inkSoft, background: musicEnabled ? 'rgba(91,140,110,0.12)' : 'transparent' }}
                >
                  <span>배경음악</span>
                  <span className="font-display" style={{ color: musicEnabled ? T.sage : T.faint }}>
                    {musicEnabled ? '켜짐' : '꺼짐'}
                  </span>
                </button>

                {/* 효과음 */}
                <button
                  onClick={() => {
                    toggleSfx()
                    sfxPop()
                  }}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-[13px] transition"
                  style={{ borderColor: T.line2, color: T.inkSoft, background: sfxEnabled ? 'rgba(91,140,110,0.12)' : 'transparent' }}
                >
                  <span>효과음</span>
                  <span className="font-display" style={{ color: sfxEnabled ? T.sage : T.faint }}>
                    {sfxEnabled ? '켜짐' : '꺼짐'}
                  </span>
                </button>

                <div className="h-px" style={{ background: T.line2 }} />

                {/* 출처·라이선스 — CC-BY 저작자 표기는 사용자에게 보이는 곳에 있어야 요건을 만족한다 */}
                <button
                  onClick={() => {
                    sfxPop()
                    setOpen(false)
                    setCredits(true)
                  }}
                  className="w-full rounded-md px-3 py-2 text-left text-[13px] transition hover:bg-[rgba(226,230,234,0.18)]"
                  style={{ color: T.inkSoft }}
                >
                  출처 및 라이선스
                </button>

                {hasExtras && <div className="h-px" style={{ background: T.line2 }} />}

                {/* 게임 방법 (게임 안에서만) */}
                {onShowOnboarding && (
                  <button
                    onClick={() => {
                      sfxPop()
                      setOpen(false)
                      onShowOnboarding()
                    }}
                    className="w-full rounded-md px-3 py-2 text-left text-[13px] transition hover:bg-[rgba(226,230,234,0.18)]"
                    style={{ color: T.inkSoft }}
                  >
                    게임 방법 다시 보기
                  </button>
                )}

                {/* 메인으로 (게임 안에서만) */}
                {showExit && (
                  <button
                    onClick={() => {
                      sfxPop()
                      setOpen(false)
                      goTitle()
                    }}
                    className="w-full rounded-md px-3 py-2 text-left text-[13px] transition hover:bg-[rgba(168,84,63,0.12)]"
                    style={{ color: T.danger }}
                  >
                    메인으로
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 패널이 닫혀도 유지되도록 AnimatePresence 바깥에 둔다 */}
      <Credits open={credits} onClose={() => setCredits(false)} />
    </div>
  )
}

function GearGlyph() {
  // 조절(슬라이더) 아이콘 — 설정/소리 조절을 직관적으로
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </g>
      <g fill="#ffffff" stroke="currentColor" strokeWidth="1.6">
        <circle cx="9" cy="7" r="2.1" />
        <circle cx="15" cy="12" r="2.1" />
        <circle cx="8" cy="17" r="2.1" />
      </g>
    </svg>
  )
}
