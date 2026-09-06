/**
 * 환자 음성 — 1순위: 백엔드 TTS(Gemini→edge-tts)를 WebAudio로 재생
 * (효과음용으로 이미 열린 AudioContext 공유 → 자동재생 정책에 안 막힘),
 * 폴백: 브라우저 SpeechSynthesis.
 */
import { audioContext, masterOut } from './sfx'
import type { Emotion } from '../types'

let currentSource: AudioBufferSourceNode | null = null
let currentUtterFinish: (() => void) | null = null

/* ── 실시간 립싱크: 재생 중인 음성의 진폭(RMS)을 입 벌림(0~1)으로 노출 ── */
let analyser: AnalyserNode | null = null
let mouthLevel = 0
let sampleRAF = 0

/**
 * Lightweight spectral features for facial co-articulation. These are not a
 * speech recognizer; they separate the broad acoustic shapes that matter on a
 * face: open vowels, rounded vowels, spread vowels, closures and fricatives.
 */
export interface MouthFeatures {
  level: number
  open: number
  round: number
  wide: number
  closed: number
  fricative: number
}

const mouthFeatures: MouthFeatures = {
  level: 0,
  open: 0,
  round: 0,
  wide: 0,
  closed: 1,
  fricative: 0,
}

export function getMouthLevel(): number {
  return mouthLevel
}

export function getMouthFeatures(): Readonly<MouthFeatures> {
  return mouthFeatures
}

function averageBand(data: Uint8Array, start: number, end: number): number {
  let sum = 0
  const safeEnd = Math.min(end, data.length)
  for (let i = start; i < safeEnd; i++) sum += data[i]
  return safeEnd > start ? sum / ((safeEnd - start) * 255) : 0
}

function startMouthSampling() {
  if (!analyser) return
  const buf = new Uint8Array(analyser.fftSize)
  const spectrum = new Uint8Array(analyser.frequencyBinCount)
  const loop = () => {
    if (!analyser) {
      mouthLevel = 0
      return
    }
    analyser.getByteTimeDomainData(buf)
    let s = 0
    for (let i = 0; i < buf.length; i++) {
      const x = (buf[i] - 128) / 128
      s += x * x
    }
    const rms = Math.sqrt(s / buf.length)
    const target = Math.min(1, rms * 4.2) // 게인
    mouthLevel += (target - mouthLevel) * 0.55 // 약간 스무딩

    // 48 kHz/512 FFT 기준 대략 190~1.1 kHz, 1.1~3.2 kHz,
    // 3.2~8 kHz. 비율로 정규화해 목소리 크기와 성별에 덜 민감하게 한다.
    analyser.getByteFrequencyData(spectrum)
    const low = averageBand(spectrum, 2, 12)
    const mid = averageBand(spectrum, 12, 35)
    const high = averageBand(spectrum, 35, 86)
    const spectralSum = low + mid + high + 1e-5
    const lowShare = low / spectralSum
    const midShare = mid / spectralSum
    const highShare = high / spectralSum
    const voiced = Math.min(1, mouthLevel * 2.6)
    const roundTarget = Math.max(0, Math.min(1, (lowShare - 0.37) * 3.7)) * voiced
    const wideTarget = Math.max(0, Math.min(1, (midShare + highShare * 0.45 - 0.34) * 3.0)) * voiced
    const fricativeTarget = Math.max(0, Math.min(1, (highShare - 0.18) * 4.6)) * voiced
    const closedTarget = Math.max(0, Math.min(1, (0.12 - mouthLevel) * 8.0))

    mouthFeatures.level += (mouthLevel - mouthFeatures.level) * 0.5
    mouthFeatures.open += (Math.min(1, mouthLevel * 1.9) - mouthFeatures.open) * 0.46
    mouthFeatures.round += (roundTarget - mouthFeatures.round) * 0.34
    mouthFeatures.wide += (wideTarget - mouthFeatures.wide) * 0.34
    mouthFeatures.closed += (closedTarget - mouthFeatures.closed) * 0.56
    mouthFeatures.fricative += (fricativeTarget - mouthFeatures.fricative) * 0.42
    sampleRAF = requestAnimationFrame(loop)
  }
  sampleRAF = requestAnimationFrame(loop)
}

function stopMouthSampling() {
  if (sampleRAF) cancelAnimationFrame(sampleRAF)
  sampleRAF = 0
  analyser = null
  mouthLevel = 0
  mouthFeatures.level = 0
  mouthFeatures.open = 0
  mouthFeatures.round = 0
  mouthFeatures.wide = 0
  mouthFeatures.closed = 1
  mouthFeatures.fricative = 0
}


/* ── 필러(추임새) — 응답 생성 동안 환자가 즉시 "음..." 하고 머뭇거리게 ── */
const FILLER_TEXTS = ['음...', '어... 그게...', '음... 그러니까...']
const fillerCache: Record<string, AudioBuffer[]> = {}

export async function prefetchFillers(gender: string): Promise<void> {
  if (fillerCache[gender]?.length) return
  fillerCache[gender] = []
  const ctx = audioContext()
  await Promise.all(
    FILLER_TEXTS.map(async (text) => {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, gender, emotion: 'guarded' }),
        })
        if (!res.ok) return
        const buf = await ctx.decodeAudioData(await res.arrayBuffer())
        fillerCache[gender].push(buf)
      } catch {
        /* 필러는 없어도 게임 진행에 지장 없음 */
      }
    }),
  )
}

/** 캐시된 필러를 즉시 재생 (다음 speak()가 자동으로 끊음) */
export function playFiller(gender: string): void {
  const buffers = fillerCache[gender]
  if (!buffers?.length) return
  stopSpeaking()
  const ctx = audioContext()
  const source = ctx.createBufferSource()
  source.buffer = buffers[Math.floor(Math.random() * buffers.length)]
  source.connect(masterOut())
  currentSource = source
  source.start()
}

export function stopSpeaking(): void {
  stopMouthSampling()
  if (currentSource) {
    try {
      currentSource.onended = null
      currentSource.stop()
    } catch {
      /* 이미 정지됨 */
    }
    currentSource = null
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  if (currentUtterFinish) {
    const f = currentUtterFinish
    currentUtterFinish = null
    f()
  }
}

export function speak(
  text: string,
  emotion: Emotion,
  options?: { gender?: string; age?: number; onStart?: () => void; onEnd?: () => void },
): void {
  stopSpeaking()
  let ended = false
  const finish = () => {
    if (ended) return
    ended = true
    stopMouthSampling()
    if (currentUtterFinish === finish) currentUtterFinish = null
    options?.onEnd?.()
  }
  currentUtterFinish = finish

  void (async () => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, gender: options?.gender ?? 'female', emotion, age: options?.age }),
      })
      if (!res.ok) throw new Error('tts failed')
      const data = await res.arrayBuffer()
      if (ended) return // 그 사이 중단됨
      const ctx = audioContext()
      const buffer = await ctx.decodeAudioData(data)
      if (ended) return
      const source = ctx.createBufferSource()
      source.buffer = buffer
      // 립싱크용 analyser를 거쳐 출력
      analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyser.connect(masterOut())
      // 일관된 목소리 유지 — playbackRate는 피치까지 바꿔 "목소리가 바뀐" 느낌을 주므로 1.0 고정
      source.playbackRate.value = 1.0
      currentSource = source
      source.onended = finish
      options?.onStart?.()
      source.start()
      startMouthSampling()
      setTimeout(finish, buffer.duration * 1000 + 4000) // 안전 타임아웃
    } catch {
      browserSpeak(text, emotion, options, finish)
    }
  })()
}

/* ── 폴백: 브라우저 TTS ── */
let koreanVoice: SpeechSynthesisVoice | null = null

function pickVoice(): SpeechSynthesisVoice | null {
  if (koreanVoice) return koreanVoice
  const voices = speechSynthesis.getVoices()
  const ko = voices.filter((v) => v.lang.startsWith('ko'))
  koreanVoice = ko.find((v) => /yuna|유나|female|여성/i.test(v.name)) ?? ko[0] ?? null
  return koreanVoice
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = () => {
    koreanVoice = null
    pickVoice()
  }
}

const EMOTION_TONE: Partial<Record<Emotion, { pitch: number; rate: number }>> = {
  anxious: { pitch: 1.18, rate: 1.04 },
  defensive: { pitch: 1.0, rate: 0.92 },
  hurt: { pitch: 1.05, rate: 0.85 },
  shocked: { pitch: 1.25, rate: 1.1 },
  warm: { pitch: 1.12, rate: 0.98 },
  relieved: { pitch: 1.1, rate: 0.97 },
  hesitant_relieved: { pitch: 1.08, rate: 0.88 },
  guarded: { pitch: 1.0, rate: 0.85 },
  annoyed: { pitch: 0.95, rate: 1.0 },
}

function browserSpeak(
  text: string,
  emotion: Emotion,
  options: { gender?: string; onStart?: () => void } | undefined,
  finish: () => void,
): void {
  if (typeof speechSynthesis === 'undefined') {
    finish()
    return
  }
  speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  const voice = pickVoice()
  if (voice) utter.voice = voice
  utter.lang = 'ko-KR'
  const tone = EMOTION_TONE[emotion] ?? { pitch: 1.08, rate: 0.95 }
  const genderShift = options?.gender === 'male' ? 0.72 : 1
  utter.pitch = tone.pitch * genderShift
  utter.rate = tone.rate
  utter.onstart = () => options?.onStart?.()
  utter.onend = finish
  utter.onerror = finish
  speechSynthesis.speak(utter)
  setTimeout(finish, Math.min(25000, 3000 + text.length * 200))
}
