/**
 * 환자 머리 위 말풍선 — 타자기 효과.
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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
    }, 35)
    return () => clearInterval(t)
  }, [text])

  return <p className="text-[17px] leading-relaxed text-ink">{text.slice(0, count)}</p>
}

export function SpeechBubble({ text, thinking }: { text: string; thinking: boolean }) {
  return (
    <AnimatePresence mode="wait">
      {(text || thinking) && (
        <motion.div
          key={thinking ? 'thinking' : text}
          initial={{ opacity: 0, y: 12, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className="bubble-tail relative max-w-md rounded-3xl border-2 border-clinic-200 bg-white px-6 py-4 shadow-[0_8px_20px_rgba(80,120,90,0.12)]"
        >
          {thinking ? (
            <span className="flex gap-1.5 py-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-2.5 w-2.5 rounded-full bg-clinic-300"
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
          ) : (
            <Typewriter key={text} text={text} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
