/**
 * 룸톤(진료실 환경음) — `material-quality-spec.md` §6.5(a).
 *
 * 완전 무음인 3D 공간은 아무리 잘 만들어도 "게임"으로 읽힌다. 형광등 험 + 공조 저역을
 * 아주 낮게 깔고, 아주 가끔 먼 복도 소리를 흘려서 "여기는 계속 돌아가고 있는 건물"이라는
 * 신호를 준다. **있는 줄 모를 정도가 맞다.**
 *
 * 분위기 규칙: 진료실은 안심되고 평범해야 한다(환자가 긴장을 풀어야 문진이 성립한다).
 * 8번출구·당직근무류의 호러 장치 — 깜빡임, 불안한 정적, 문 앞에서 멈추는 발소리 — 는 쓰지 않는다.
 * 음원 합성 단계에서 이미 배제했다. `tools/audio/gen_ambience.py` 참고.
 *
 * ── 신호 경로 ──
 *   bed 소스 여러 개 ─(equal-power 크로스페이드)─┐
 *   간헐 이벤트 ─ StereoPanner ─────────────────┼→ levelGain → outGain → masterOut()
 *
 * masterOut()을 거치므로 **설정의 전체 볼륨 슬라이더가 룸톤에도 그대로 적용된다.**
 * 음소거 토글은 setRoomToneEnabled()로 연결한다(아래 "연결 계약" 참고).
 *
 * ── 다른 담당에게: 연결 계약 ──
 * 이 모듈은 store/three를 import하지 않는다. 아래 4곳만 이어주면 된다.
 *
 *   1) App.tsx 첫 제스처 핸들러 (startBgm 옆):   startRoomTone()
 *   2) App.tsx phase useEffect:
 *        setRoomToneScene(phase !== 'title' && phase !== 'report')
 *        setRoomToneLevel(roomToneLevelFor({ phase, examToolActive: !!examTool }))
 *   3) store.ts toggleSfx (효과음 토글):          setRoomToneEnabled(next)
 *      onRehydrateStorage:                        setRoomToneEnabled(state.sfxEnabled ?? true)
 *      → 룸톤은 음악이 아니라 환경음이므로 '효과음' 토글을 따르는 것이 자연스럽다.
 *        (두 토글 모두를 따르게 하려면 setRoomToneEnabled(sfxEnabled && musicEnabled))
 *   4) 청진 중 거의 무음:  이미 examSounds.ts가 재생 길이만큼 duckRoomTone()을 호출한다. 추가 작업 없음.
 */
import { audioContext, masterOut } from './sfx'

export type RoomToneLevel = 'normal' | 'quiet' | 'silent'

/* ── 튜닝 상수 (음량을 바꿀 일이 있으면 여기만 만지면 된다) ── */

/** 베드 게인. 음원 RMS가 -18.5dBFS이므로 최종 ≈ -38.5dBFS — 진료실 BGM(-35dBFS)보다 낮다. */
const BED_GAIN = 0.10
/**
 * 간헐 이벤트 기본 게인. 이벤트의 50ms 단구간 RMS 최대가 -10.8dBFS이므로
 * 최종 ≈ -30.8dBFS = 베드보다 +8.4dB. 눈치는 채되 대사를 방해하지 않는 자리다.
 * (더 낮추면 저역이 대부분인 베드에 묻혀서 아예 안 들린다 — 실측으로 확인했다)
 */
const EVENT_GAIN = 0.10

const LEVEL_GAIN: Record<RoomToneLevel, number> = {
  normal: 1.0,
  quiet: 0.34,   // 진찰 모드 — 청진음에 자리를 내준다 (-9dB)
  silent: 0.05,  // 청진 중 — '거의' 무음. 0으로 딱 끊으면 오디오가 죽은 것처럼 들린다 (-26dB)
}

/** 루프 크로스페이드 길이. mp3 인코더 패딩으로 생기는 이음매를 확실히 덮는다. */
const XFADE = 1.5
/** 몇 초 앞까지 미리 예약할지. 백그라운드 탭에서 타이머가 1분까지 throttle돼도 끊기지 않게 넉넉히. */
const SCHEDULE_AHEAD = 90

/** 간헐 이벤트 간격(초). 스펙 "30초 이상 간격, 드물게"보다 보수적으로 잡았다 — 과하면 산만하다. */
const EVENT_FIRST_DELAY: [number, number] = [45, 80]
const EVENT_INTERVAL: [number, number] = [55, 130]

const BED_URL = '/audio/ambience/room_tone.mp3'
const EVENT_URLS = [
  { url: '/audio/ambience/corridor_steps_a.mp3', kind: 'steps', weight: 4 },
  { url: '/audio/ambience/corridor_steps_b.mp3', kind: 'steps', weight: 3 },
  { url: '/audio/ambience/corridor_door_a.mp3', kind: 'door', weight: 2 },
  { url: '/audio/ambience/corridor_door_b.mp3', kind: 'door', weight: 2 },
] as const

/* ── 상태 ── */

let enabled = true          // 설정 토글
let sceneOn = false         // 진료실 안인가
let level: RoomToneLevel = 'normal'
let duckUntil = 0           // AudioContext 시각. 이 시각까지는 silent로 강제
let duckTimer: ReturnType<typeof setTimeout> | null = null

let bedGain: GainNode | null = null
let levelGain: GainNode | null = null
let outGain: GainNode | null = null
let running = false
let bedBuffer: AudioBuffer | null = null
let bedLoading: Promise<AudioBuffer | null> | null = null
let nextStartAt = 0
let live: AudioBufferSourceNode[] = []
let pumpTimer: ReturnType<typeof setInterval> | null = null
let eventTimer: ReturnType<typeof setTimeout> | null = null
let visibilityHooked = false
const eventBuffers = new Map<string, AudioBuffer | null>()

/* ── 유틸 ── */

function rnd(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0])
}

function rampTo(p: AudioParam, v: number, sec: number): void {
  const now = audioContext().currentTime
  const cur = p.value
  p.cancelScheduledValues(now)
  p.setValueAtTime(cur, now)
  p.linearRampToValueAtTime(v, now + sec)
}

/** equal-power 크로스페이드 커브. 상관 없는 두 노이즈를 섞을 때 중간이 -3dB로 꺼지지 않는다. */
function fadeCurve(up: boolean, steps = 65): Float32Array {
  const c = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const x = i / (steps - 1)
    c[i] = Math.cos(((up ? 1 - x : x) * Math.PI) / 2)
  }
  return c
}
const CURVE_IN = fadeCurve(true)
const CURVE_OUT = fadeCurve(false)

function ensureGraph(): { bed: GainNode; lvl: GainNode; out: GainNode } {
  const ctx = audioContext()
  if (!levelGain || !outGain || !bedGain) {
    outGain = ctx.createGain()
    outGain.gain.value = 0
    outGain.connect(masterOut())        // ← 전체 볼륨 슬라이더가 여기서 적용된다
    levelGain = ctx.createGain()
    levelGain.gain.value = LEVEL_GAIN[level]
    levelGain.connect(outGain)
    bedGain = ctx.createGain()          // 베드만 따로 — 간헐 이벤트는 자기 게인을 쓴다
    bedGain.gain.value = BED_GAIN
    bedGain.connect(levelGain)
  }
  return { bed: bedGain, lvl: levelGain, out: outGain }
}

async function decode(url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await audioContext().decodeAudioData(await res.arrayBuffer())
  } catch {
    return null
  }
}

/* ── 파일이 없을 때의 합성 폴백 ──
   에셋이 빠져도 조용히 아무 일도 안 일어나는 것보다, 최소한의 룸톤이라도 나는 편이 낫다.
   품질은 파일 쪽이 훨씬 낫다(주파수영역 합성 + 완전 순환 루프). 여기는 어디까지나 보험이다. */
function synthBed(): AudioBuffer {
  const ctx = audioContext()
  const sr = ctx.sampleRate
  const dur = 8
  const n = Math.floor(sr * dur)
  const buf = ctx.createBuffer(2, n, sr)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let brown = 0
    let mid = 0
    for (let i = 0; i < n; i++) {
      const t = i / sr
      // 공조 저역 — 브라운 노이즈
      brown = (brown + (Math.random() * 2 - 1) * 0.06) / 1.03
      // 디퓨저 중역 — 1극 저역통과한 화이트
      mid = mid * 0.86 + (Math.random() * 2 - 1) * 0.14
      // 형광등 험 120Hz + 배음 (8초에 정수 배 사이클이 들어간다)
      const hum =
        Math.sin(2 * Math.PI * 120 * t) * 0.30 +
        Math.sin(2 * Math.PI * 240 * t + 1.1) * 0.11 +
        Math.sin(2 * Math.PI * 360 * t + 2.3) * 0.06
      d[i] = brown * 6.0 + mid * 0.10 + hum * 0.16 + (Math.random() * 2 - 1) * 0.004
    }
  }
  return buf
}

async function getBed(): Promise<AudioBuffer | null> {
  if (bedBuffer) return bedBuffer
  if (!bedLoading) {
    bedLoading = decode(BED_URL).then((b) => {
      bedBuffer = b ?? synthBed()
      return bedBuffer
    })
  }
  return bedLoading
}

/* ── 루프 스케줄러 ──
   완전 순환 음원이지만 mp3 디코더가 인코더 지연/패딩을 얼마나 잘라내는지는 브라우저마다 다르다.
   source.loop=true에 맡기면 32초마다 미세한 틱이 생길 수 있어서, 소스를 겹쳐 띄우고
   equal-power로 교차시킨다. 예약은 AudioContext 시각 기준이라 타이머 throttle과 무관하게 정확하다. */
function scheduleIteration(buf: AudioBuffer, at: number): void {
  const ctx = audioContext()
  const { bed } = ensureGraph()
  const src = ctx.createBufferSource()
  src.buffer = buf
  const g = ctx.createGain()
  g.gain.value = 0
  // 커브가 끝나면 마지막 값(1)이 다음 이벤트까지 유지된다. 사이에 setValueAtTime을 끼우면
  // "커브 구간 [T, T+D] 안의 자동화"로 간주돼 NotSupportedError가 난다 — 넣지 말 것.
  g.gain.setValueCurveAtTime(CURVE_IN, at, XFADE)
  g.gain.setValueCurveAtTime(CURVE_OUT, at + buf.duration - XFADE, XFADE)
  src.connect(g)
  g.connect(bed)
  src.start(at)
  src.stop(at + buf.duration + 0.02)
  src.onended = () => {
    try { src.disconnect() } catch { /* noop */ }
    try { g.disconnect() } catch { /* noop */ }
    live = live.filter((s) => s !== src)
  }
  live.push(src)
}

function pump(): void {
  if (!running || !bedBuffer) return
  const ctx = audioContext()
  const step = bedBuffer.duration - XFADE
  if (nextStartAt < ctx.currentTime) nextStartAt = ctx.currentTime + 0.06
  const horizon = ctx.currentTime + SCHEDULE_AHEAD
  while (nextStartAt < horizon) {
    scheduleIteration(bedBuffer, nextStartAt)
    nextStartAt += step
  }
}

/* ── 간헐 이벤트 ── */

function pickEvent(): (typeof EVENT_URLS)[number] {
  const total = EVENT_URLS.reduce((s, e) => s + e.weight, 0)
  let r = Math.random() * total
  for (const e of EVENT_URLS) {
    r -= e.weight
    if (r <= 0) return e
  }
  return EVENT_URLS[0]
}

async function playEvent(): Promise<void> {
  const pick = pickEvent()
  if (!eventBuffers.has(pick.url)) eventBuffers.set(pick.url, await decode(pick.url))
  const buf = eventBuffers.get(pick.url)
  if (!buf || !running || effectiveLevel() !== 'normal') return

  const ctx = audioContext()
  const { lvl } = ensureGraph()
  const src = ctx.createBufferSource()
  src.buffer = buf
  const g = ctx.createGain()
  g.gain.value = EVENT_GAIN * (0.75 + Math.random() * 0.5)

  let tail: AudioNode = g
  try {
    const pan = ctx.createStereoPanner()
    const from = (Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.3)
    if (pick.kind === 'steps') {
      // 복도를 가로질러 **지나간다**. 좌→우(또는 우→좌)로 천천히 흐른다.
      pan.pan.setValueAtTime(from, ctx.currentTime)
      pan.pan.linearRampToValueAtTime(-from, ctx.currentTime + buf.duration)
    } else {
      pan.pan.value = from * 0.7
    }
    g.connect(pan)
    tail = pan
  } catch {
    /* StereoPanner 없는 브라우저 — 모노로 그냥 재생 */
  }
  src.connect(g)
  tail.connect(lvl)
  src.start()
  src.onended = () => {
    try { src.disconnect() } catch { /* noop */ }
    try { tail.disconnect() } catch { /* noop */ }
  }
}

function armEvent(first = false): void {
  if (eventTimer) clearTimeout(eventTimer)
  eventTimer = setTimeout(() => {
    eventTimer = null
    if (!running) return // 엔진이 멈춘 뒤 남은 타이머가 스스로 되살아나지 않게
    // 진찰 모드/청진 중에는 복도 소리를 내보내지 않는다. 집중을 깨고 임상적으로도 어색하다.
    if (effectiveLevel() === 'normal') void playEvent()
    armEvent()
  }, rnd(first ? EVENT_FIRST_DELAY : EVENT_INTERVAL) * 1000)
}

/* ── 레벨 적용 ── */

function effectiveLevel(): RoomToneLevel {
  if (duckUntil > audioContext().currentTime) return 'silent'
  return level
}

function applyLevel(sec = 0.6): void {
  if (!levelGain) return
  rampTo(levelGain.gain, LEVEL_GAIN[effectiveLevel()], sec)
}

function applyOut(): void {
  const { out } = ensureGraph()
  const want = enabled && sceneOn ? 1 : 0
  rampTo(out.gain, want, want ? 1.4 : 0.7)
  if (want) startEngine()
  else stopEngineSoon()
}

/* ── 엔진 시작/정지 ── */

let stopTimer: ReturnType<typeof setTimeout> | null = null

function startEngine(): void {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
  if (running) return
  running = true
  void getBed().then((buf) => {
    if (!running || !buf) return
    nextStartAt = audioContext().currentTime + 0.06
    pump()
    if (!pumpTimer) pumpTimer = setInterval(pump, 5000)
    armEvent(true)
  })
}

function stopEngineSoon(): void {
  if (!running || stopTimer) return
  // 페이드아웃이 끝난 뒤에 소스를 죽인다 (바로 죽이면 툭 끊긴다)
  stopTimer = setTimeout(() => {
    stopTimer = null
    running = false
    if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = null }
    if (eventTimer) { clearTimeout(eventTimer); eventTimer = null }
    for (const s of live) { try { s.stop() } catch { /* 이미 정지 */ } }
    live = []
    nextStartAt = 0
  }, 900)
}

/* ── 공개 API ── */

/**
 * 첫 사용자 제스처 이후에 호출한다(자동재생 정책). startBgm()과 같은 자리.
 * 실제 소리는 setRoomToneScene(true)가 불려야 난다.
 */
export function startRoomTone(): void {
  if (typeof window === 'undefined') return
  audioContext() // 제스처 도중 동기 resume — await 뒤로 미루면 막힌다
  ensureGraph()
  void getBed() // 미리 받아둔다 (첫 입장에서 늦게 들어오는 것 방지)
  applyOut()
  if (!visibilityHooked) {
    visibilityHooked = true
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pump() })
  }
}

/** 진료실 안/밖. 타이틀·결과 화면에서는 false — 룸톤은 진료실의 소리다. */
export function setRoomToneScene(inClinic: boolean): void {
  if (sceneOn === inClinic) return
  sceneOn = inClinic
  // startRoomTone() 전이면 상태만 기억한다. 여기서 그래프를 만들면 제스처 전에
  // AudioContext가 생겨 브라우저가 suspended로 잡아버린다.
  if (outGain) applyOut()
}

/**
 * 'normal' 평상시 · 'quiet' 진찰 모드 · 'silent' 청진 등 소리에 집중할 때.
 * quiet/silent 동안에는 복도 간헐음도 나가지 않는다.
 */
export function setRoomToneLevel(next: RoomToneLevel): void {
  if (level === next) return
  level = next
  applyLevel(next === 'normal' ? 0.9 : 0.6)
}

/** 청진 재생 동안만 거의 무음으로 낮췄다가 자동 복귀. 중첩 호출하면 더 긴 쪽으로 연장된다. */
export function duckRoomTone(ms: number): void {
  if (typeof window === 'undefined' || !levelGain) return
  const until = audioContext().currentTime + ms / 1000
  if (until <= duckUntil) return
  duckUntil = until
  applyLevel(0.25)
  if (duckTimer) clearTimeout(duckTimer)
  duckTimer = setTimeout(() => {
    duckTimer = null
    duckUntil = 0
    applyLevel(0.55)
  }, ms + 30)
}

/** 설정의 효과음/음소거 토글. 끄면 완전히 정지한다(볼륨 슬라이더는 masterOut이 알아서 처리). */
export function setRoomToneEnabled(on: boolean): void {
  if (enabled === on) return
  enabled = on
  // 설정 복원(onRehydrateStorage)은 제스처 전에 돌기 때문에 여기서 그래프를 만들면 안 된다.
  // startRoomTone()이 현재 enabled 값을 보고 시작한다.
  if (outGain) applyOut()
}

export function isRoomToneEnabled(): boolean {
  return enabled
}

/**
 * phase/진찰도구 상태 → 룸톤 레벨. store를 import하지 않으려고 순수 함수로 뺐다.
 * 청진 중 'silent'는 여기서 판단하지 않는다 — 재생 시점을 아는 examSounds가 duckRoomTone()으로 처리한다.
 */
export function roomToneLevelFor(opts: { phase: string; examToolActive?: boolean }): RoomToneLevel {
  // 진찰 모드거나 도구를 든 상태면 낮춘다. 실제 진료에서도 청진할 땐 조용히 한다.
  if (opts.phase === 'exam' || opts.examToolActive) return 'quiet'
  return 'normal'
}

/* 개발용 디버그 훅 — 콘솔에서 레벨을 직접 흔들어 볼 수 있다(프로덕션 동작 영향 없음) */
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  ;(window as unknown as Record<string, unknown>).__roomTone = {
    start: startRoomTone,
    scene: setRoomToneScene,
    level: setRoomToneLevel,
    duck: duckRoomTone,
    enabled: setRoomToneEnabled,
    state: () => ({ enabled, sceneOn, level, running, sources: live.length, gain: levelGain?.gain.value }),
  }
}
