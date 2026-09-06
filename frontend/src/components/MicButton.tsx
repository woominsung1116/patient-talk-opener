/**
 * 꾹 누르고 말하기 버튼 + 텍스트 입력 폴백.
 * 스페이스바 홀드로도 녹음 가능 (push-to-talk).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { WavRecorder } from '../audio/recorder'
import { sfxPop } from '../audio/sfx'
import { api } from '../api'
import { useGame } from '../store'

const HOLD_THRESHOLD_MS = 350 // 이보다 짧게 누르면 토글 모드

export function MicButton() {
  const { busy, setBusy, sendText, setError, setMicLevel, micLevel, gameOver } = useGame()
  const recorderRef = useRef<WavRecorder | null>(null)
  const levelTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pressAt = useRef(0)
  const releasedEarly = useRef(false) // 마이크 준비 전에 손을 뗀 경우 → 토글 모드
  const [textMode, setTextMode] = useState(false)
  const [toggleMode, setToggleMode] = useState(false)
  const [draft, setDraft] = useState('')
  const recording = busy === 'recording'
  const disabled = busy === 'transcribing' || busy === 'thinking' || gameOver !== null

  const startRecording = useCallback(async () => {
    if (disabled || recorderRef.current) return
    try {
      const rec = new WavRecorder()
      await rec.start()
      // 권한 대화상자 등 비동기 대기 중에 다른 작업이 시작됐으면 취소
      const nowBusy = useGame.getState().busy
      if (nowBusy === 'thinking' || nowBusy === 'transcribing') {
        await rec.stop()
        return
      }
      recorderRef.current = rec
      sfxPop()
      setBusy('recording')
      levelTimer.current = setInterval(() => setMicLevel(rec.level), 80)
      if (releasedEarly.current) {
        // 마이크가 켜지기 전에 이미 손을 뗐다 → 짧은 클릭 = 토글 모드
        releasedEarly.current = false
        setToggleMode(true)
      }
    } catch {
      setError('마이크를 사용할 수 없어요. 브라우저 권한을 확인해주세요.')
      setTextMode(true)
    }
  }, [disabled, setBusy, setError, setMicLevel])

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current
    if (!rec) return
    recorderRef.current = null
    setToggleMode(false)
    if (levelTimer.current) clearInterval(levelTimer.current)
    setMicLevel(0)
    setBusy('transcribing')
    try {
      const wav = await rec.stop()
      if (wav.size < 13000) {
        // 0.4초 미만 녹음 — 안내 후 종료
        setError('너무 짧았어요. 버튼을 누른 채 말하거나, 짧게 눌러 녹음을 켠 뒤 말이 끝나면 다시 눌러주세요.')
        setBusy('idle')
        return
      }
      const text = await api.transcribe(wav)
      if (!text.trim()) {
        setError('말소리를 알아듣지 못했어요. 다시 말해주세요.')
        setBusy('idle')
        return
      }
      await sendText(text)
    } catch {
      setError('음성 인식에 실패했어요. 아래 입력창으로도 질문할 수 있어요.')
      setBusy('idle')
      setTextMode(true)
    }
  }, [sendText, setBusy, setError, setMicLevel])

  /* 누름 시작: 녹음 중(토글 대기)이면 전송, 아니면 녹음 시작 */
  const onPress = useCallback(() => {
    if (recorderRef.current) {
      void stopRecording()
      return
    }
    pressAt.current = Date.now()
    releasedEarly.current = false
    void startRecording()
  }, [startRecording, stopRecording])

  /* 누름 해제: 길게 눌렀으면 전송(푸시투토크), 짧게 눌렀으면 토글 모드 유지 */
  const onRelease = useCallback(() => {
    if (!recorderRef.current) {
      // 마이크 준비 중에 손을 뗌 — 준비 완료 시 토글 모드로 전환
      releasedEarly.current = true
      return
    }
    if (Date.now() - pressAt.current >= HOLD_THRESHOLD_MS) {
      void stopRecording()
    } else {
      setToggleMode(true) // 계속 듣는 중 — 다시 누르면 전송
    }
  }, [stopRecording])

  // 스페이스바 — 동일한 홀드/토글 하이브리드
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      e.preventDefault()
      onPress()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      e.preventDefault()
      onRelease()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [onPress, onRelease])

  // Unmount cleanup: stop mic stream + interval to prevent leaked MediaStream/CPU
  useEffect(() => {
    return () => {
      if (levelTimer.current) clearInterval(levelTimer.current)
      const rec = recorderRef.current
      recorderRef.current = null
      if (rec) void rec.stop().catch(() => {})
    }
  }, [])

  // Stop recorder when the game ends so the mic LED turns off
  useEffect(() => {
    if (gameOver && recorderRef.current) {
      const rec = recorderRef.current
      recorderRef.current = null
      if (levelTimer.current) clearInterval(levelTimer.current)
      setMicLevel(0)
      void rec.stop().catch(() => {})
    }
  }, [gameOver, setMicLevel])

  const submitDraft = async () => {
    const t = draft.trim()
    if (!t || disabled) return
    setDraft('')
    await sendText(t)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* 마이크 버튼 — 진료실 톤의 절제된 푸시투토크 */}
      <div className="relative">
        {recording && (
          <motion.div
            className="absolute inset-0 rounded-full bg-[#a4524a]"
            animate={{ scale: 1 + micLevel * 0.8, opacity: 0.28 }}
            transition={{ duration: 0.1 }}
          />
        )}
        <motion.button
          whileTap={{ scale: 0.94 }}
          disabled={disabled}
          onPointerDown={(e) => {
            e.preventDefault()
            onPress()
          }}
          onPointerUp={onRelease}
          onPointerLeave={() => {
            // 홀드 중에 버튼 밖으로 나가면 전송 (토글 모드는 유지)
            if (recording && !toggleMode && Date.now() - pressAt.current >= HOLD_THRESHOLD_MS) {
              void stopRecording()
            }
          }}
          className={`font-display relative flex h-20 w-20 flex-col items-center justify-center rounded-full border shadow-lg transition-colors select-none ${
            recording
              ? 'border-[#c98f87] bg-[#a4524a] text-[#f6ece9]'
              : disabled
                ? 'border-[#d8cdb4] bg-[#cfc7b6] text-[#8a8270]'
                : 'border-[#cdbf9f] bg-[#4c4a43] text-[#f1ead8] hover:bg-[#3b3933]'
          }`}
        >
          <span className="leading-none">
            {recording ? (
              <motion.svg
                viewBox="0 0 24 24"
                className="h-8 w-8"
                aria-hidden
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <circle cx="12" cy="12" r="6" fill="#fff" />
              </motion.svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                <path d="M6 11a6 6 0 0 0 12 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M12 17v3M9 20h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span className="mt-1 text-[11px] leading-tight whitespace-pre-line">
            {busy === 'transcribing'
              ? '인식 중...'
              : recording
                ? toggleMode
                  ? '다시 누르면\n전송'
                  : '듣는 중'
                : '눌러서\n말하기'}
          </span>
        </motion.button>
      </div>
      <p className="text-[11px] font-bold text-ink-soft/70">
        {recording ? '말이 끝나면 한 번 더 누르세요' : '꾹 눌러도, 짧게 눌러도 돼요 (스페이스바 가능)'}
      </p>

      {/* 텍스트 폴백 */}
      {textMode ? (
        <div className="flex w-80 gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitDraft()}
            placeholder="환자에게 할 말을 입력하세요..."
            className="flex-1 rounded-full border-2 border-clinic-200 bg-white px-4 py-2 text-sm outline-none focus:border-clinic-500"
          />
          <button
            onClick={() => void submitDraft()}
            disabled={disabled}
            className="font-display rounded-full bg-clinic-500 px-4 text-sm text-white hover:bg-clinic-700 disabled:bg-gray-200"
          >
            전송
          </button>
        </div>
      ) : (
        <button
          onClick={() => setTextMode(true)}
          className="text-[11px] text-ink-soft/60 underline hover:text-ink-soft"
        >
          키보드로 입력할래요
        </button>
      )}
    </div>
  )
}
