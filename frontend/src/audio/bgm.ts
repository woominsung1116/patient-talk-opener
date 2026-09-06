/**
 * 배경음악 — 화면별 트랙 전환(타이틀 ↔ 진료실), 루프 재생.
 * 마스터 게인(masterOut)을 거치므로 설정의 전체 볼륨 슬라이더로 같이 조절된다.
 * BGM은 대사/효과음보다 낮게(BGM_LEVEL) 아주 은은하게 깔린다.
 */
import { audioContext, masterOut } from './sfx'

export type BgmScene = 'title' | 'clinic'

const TRACKS: Record<BgmScene, string> = {
  title: '/audio/bgm.mp3',
  clinic: '/audio/bgm_clinic.mp3', // 없으면 title로 폴백
}
// 씬별 볼륨 — 진료실은 대사 밑에 아주 작게, 메인은 적당히 들리게
const LEVELS: Record<BgmScene, number> = { title: 0.42, clinic: 0.09 }

const buffers: Partial<Record<BgmScene, AudioBuffer>> = {}
const offsets: Partial<Record<BgmScene, number>> = {} // 트랙별 재생 위치(이어재생용)
let source: AudioBufferSourceNode | null = null
let gain: GainNode | null = null
let enabled = true
let current: BgmScene = 'title'
let playToken = 0
let startCtxTime = 0 // 현재 소스가 시작된 컨텍스트 시각
let playingScene: BgmScene | null = null

async function loadBuffer(scene: BgmScene): Promise<AudioBuffer | null> {
  if (buffers[scene]) return buffers[scene]!
  try {
    const ctx = audioContext()
    const res = await fetch(TRACKS[scene])
    if (!res.ok) return null
    const buf = await ctx.decodeAudioData(await res.arrayBuffer())
    buffers[scene] = buf
    return buf
  } catch {
    return null
  }
}

function stopSource() {
  // 현재 재생 위치를 트랙별로 저장 (다시 켜면 이어서 재생)
  if (source && playingScene) {
    const buf = buffers[playingScene]
    if (buf) {
      const elapsed = audioContext().currentTime - startCtxTime
      offsets[playingScene] = ((offsets[playingScene] ?? 0) + elapsed) % buf.duration
    }
  }
  if (source) {
    try { source.stop() } catch { /* 이미 정지 */ }
    source.disconnect()
    source = null
  }
  if (gain) { gain.disconnect(); gain = null }
  playingScene = null
}

async function playCurrent() {
  if (!enabled) return
  const token = ++playToken
  // 진료실 트랙이 없으면 타이틀로 폴백
  let buf = await loadBuffer(current)
  let sceneUsed = current
  if (!buf && current !== 'title') { buf = await loadBuffer('title'); sceneUsed = 'title' }
  if (!buf || token !== playToken || !enabled) return
  const ctx = audioContext()
  stopSource()
  gain = ctx.createGain()
  gain.gain.value = LEVELS[sceneUsed]
  gain.connect(masterOut())
  source = ctx.createBufferSource()
  source.buffer = buf
  source.loop = true
  source.connect(gain)
  const offset = (offsets[sceneUsed] ?? 0) % buf.duration
  source.start(0, offset) // 저장된 위치에서 이어재생
  startCtxTime = ctx.currentTime
  playingScene = sceneUsed
}

// 워치독 — 녹음(별도 AudioContext)·탭 전환 등으로 컨텍스트가 멈추면 되살려 BGM 유지
let watchdog: ReturnType<typeof setInterval> | null = null
function ensureWatchdog(): void {
  if (watchdog != null || typeof window === 'undefined') return
  watchdog = setInterval(() => {
    if (!enabled) return
    const ctx = audioContext()
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
    if (!source) void playCurrent() // 소스가 사라졌으면 이어서 다시 재생
  }, 1500)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && enabled) {
        const ctx = audioContext()
        if (ctx.state !== 'running') void ctx.resume().catch(() => {})
      }
    })
  }
}

/** 사용자 제스처 이후 호출 — 현재 씬의 BGM을 시작(자동재생 정책 회피). */
export function startBgm(): void {
  audioContext() // 제스처 도중 동기 resume — 안 그러면 await 뒤 resume이 막힘
  ensureWatchdog()
  void playCurrent()
}

/** 화면 전환 시 트랙 변경 (같은 씬이면 무시). */
export function setBgmScene(scene: BgmScene): void {
  if (scene === current && source) return
  current = scene
  if (enabled) { audioContext(); void playCurrent() }
}

/** 설정 토글. 켜면 현재 씬 재생, 끄면 정지. */
export function setBgmEnabled(on: boolean): void {
  enabled = on
  if (on) { audioContext(); void playCurrent() }
  else stopSource()
}

export function isBgmEnabled(): boolean {
  return enabled
}
