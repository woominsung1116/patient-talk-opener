/**
 * 하단 접이식 대화 기록.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '../store'

export function DialogueLog() {
  const dialogue = useGame((s) => s.dialogue)
  const [open, setOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [dialogue, open])

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-20 w-80 select-none">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-display w-full rounded-t-2xl border-2 border-b-0 border-white/15 bg-black/55 px-4 py-2 text-left text-sm text-white/90 shadow-md backdrop-blur"
      >
        💬 대화 기록 {open ? '▾' : '▴'}
        <span className="ml-2 text-[11px] text-white/55">({dialogue.length})</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 280 }}
            exit={{ height: 0 }}
            className="nice-scroll overflow-y-auto rounded-b-2xl border-2 border-t-0 border-white/15 bg-black/55 shadow-md backdrop-blur"
          >
            <div className="space-y-2 p-3">
              {dialogue.map((d, i) => (
                <div key={i} className={`flex ${d.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${
                      d.speaker === 'user'
                        ? 'rounded-br-sm bg-clinic-500 text-white'
                        : 'rounded-bl-sm bg-warm-100 text-ink'
                    }`}
                  >
                    {d.text}
                    {d.unlocked && d.unlocked.length > 0 && (
                      <div className="mt-1 text-[11px] font-bold text-amber-500">
                        ✨ {d.unlocked.map((f) => f.label).join(', ')} 해금
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
