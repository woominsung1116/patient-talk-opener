/**
 * 효과음 — 외부 에셋 없이 WebAudio 신디사이저로 생성.
 */

let ctx: AudioContext | null = null

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

const ac = audioContext

/* ── 마스터 볼륨 — 효과음/TTS 모두 이 게인 노드를 거친다 ── */
let master: GainNode | null = null
let _volume = 1

export function masterOut(): GainNode {
  const c = ac()
  if (!master) {
    master = c.createGain()
    master.gain.value = _volume
    master.connect(c.destination)
  }
  return master
}

/** 0~1 마스터 볼륨 설정 (설정 메뉴에서 호출) */
export function setMasterVolume(v: number) {
  _volume = Math.max(0, Math.min(1, v))
  if (master) master.gain.value = _volume
}

// 효과음 on/off (BGM/음성과 별개)
let sfxOn = true
export function setSfxEnabled(on: boolean) {
  sfxOn = on
}
export function isSfxOn() {
  return sfxOn
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.12,
) {
  if (!sfxOn) return
  const c = ac()
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.value = freq
  g.gain.setValueAtTime(0, c.currentTime + start)
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur)
  o.connect(g).connect(masterOut())
  o.start(c.currentTime + start)
  o.stop(c.currentTime + start + dur + 0.05)
}

/** ✨ 단서 해금 — 반짝이는 상승 아르페지오 */
export function sfxUnlock() {
  try {
    tone(523, 0, 0.35)       // C5
    tone(659, 0.09, 0.35)    // E5
    tone(784, 0.18, 0.4)     // G5
    tone(1047, 0.27, 0.55, 'sine', 0.1) // C6
  } catch { /* 오디오 불가 환경 무시 */ }
}

/** 💗 신뢰도 상승 — 부드러운 핑 */
export function sfxTrustUp() {
  try {
    tone(880, 0, 0.18, 'sine', 0.05)
  } catch { /* noop */ }
}

/** 💔 신뢰도 하락 — 낮은 둔탁음 */
export function sfxTrustDown() {
  try {
    tone(196, 0, 0.25, 'triangle', 0.09)
    tone(147, 0.06, 0.3, 'triangle', 0.07)
  } catch { /* noop */ }
}

/** 🩺 등급 도장 쾅 */
export function sfxStamp() {
  if (!sfxOn) return
  try {
    const c = ac()
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'square'
    o.frequency.setValueAtTime(180, c.currentTime)
    o.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.15)
    g.gain.setValueAtTime(0.18, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.3)
    o.connect(g).connect(masterOut())
    o.start()
    o.stop(c.currentTime + 0.35)
  } catch { /* noop */ }
}

/** 🔘 버튼/녹음 시작 */
export function sfxPop() {
  try {
    tone(660, 0, 0.08, 'sine', 0.06)
  } catch { /* noop */ }
}

/** 🚪 똑똑 노크 */
export function sfxKnock() {
  try {
    tone(150, 0, 0.09, 'triangle', 0.22)
    tone(95, 0.005, 0.12, 'sine', 0.18)
    tone(150, 0.22, 0.09, 'triangle', 0.22)
    tone(95, 0.225, 0.12, 'sine', 0.18)
  } catch { /* noop */ }
}

/** 👣 발소리 (한 걸음) */
export function sfxStep(i = 0) {
  try {
    tone(75 + (i % 2) * 10, 0, 0.07, 'triangle', 0.07)
  } catch { /* noop */ }
}

/** 🚪 문 여닫는 소리 */
export function sfxDoor() {
  if (!sfxOn) return
  try {
    const c = ac() // 공유 컨텍스트 (매번 새로 만들면 Chrome 6개 제한에 걸림)
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(70, c.currentTime)
    o.frequency.linearRampToValueAtTime(110, c.currentTime + 0.4)
    g.gain.setValueAtTime(0.025, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.45)
    o.connect(g).connect(masterOut())
    o.start()
    o.stop(c.currentTime + 0.5)
  } catch { /* noop */ }
}
