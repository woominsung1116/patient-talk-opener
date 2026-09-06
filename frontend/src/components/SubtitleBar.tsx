/**
 * 하단 자막 바 — 종이 진료차트 톤 (반투명 종이 스트립 + 잉크 글씨).
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { T } from '../ui/theme'

function Typewriter({ text }: { text: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const t = setInterval(() => {
      setCount((c) => {
        if (c >= text.length) {
          clearInterval(t)
          return c
        }
        return c + 1
      })
    }, 30)
    return () => clearInterval(t)
  }, [text])
  return <span>{text.slice(0, count)}</span>
}

export function SubtitleBar({
  text,
  thinking,
  patientName,
}: {
  text: string
  thinking: boolean
  patientName: string
}) {
  return (
    <AnimatePresence mode="wait">
      {(text || thinking) && (
        <motion.div
          key={thinking ? 'thinking' : text}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-none absolute bottom-[12%] left-1/2 z-20 w-[min(760px,86vw)] -translate-x-1/2"
        >
          <div
            className="flex items-center gap-3 rounded-xl px-5 py-3.5 shadow-lg"
            style={{
              background: 'rgba(255,255,255,0.92)',
              border: `1px solid ${T.line}`,
              backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 16px rgba(76,74,67,0.18)',
            }}
          >
            {thinking ? (
              <span className="flex gap-1.5 py-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-2 w-2 rounded-full"
                    style={{ background: T.faint }}
                    animate={{ y: [0, -5, 0] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </span>
            ) : (
              <p
                className="text-[19px] leading-snug font-bold"
                style={{ color: T.ink, textShadow: '0 1px 2px rgba(255,255,255,0.6)' }}
              >
                <span className="mr-2" style={{ color: T.faint }}>
                  {patientName}
                </span>
                <Typewriter key={text} text={text} />
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
