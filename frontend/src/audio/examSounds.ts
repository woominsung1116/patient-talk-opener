/**
 * 신체진찰 청진음 — 실제 임상 녹음(무료·상업 가능) 우선, 없으면 WebAudio 합성 폴백.
 *
 * 음원 출처 (public/sounds/exam/CREDITS.md 참고):
 *  - 장음(bowel):  freesound.org "borygmi" — CC0 (출처표기 불필요)
 *  - 심음/폐음:    HLS-CMDS (github.com/torabiy/hls-cmds) — CC BY 4.0 (출처표기 필요)
 *
 * 현재 게임의 '복부 청진(auscultation)'은 장음을 재생한다. 소견 텍스트(finding)에
 * '항진/감소'가 있으면 해당 변형을, 없으면 정상 장음을 재생한다.
 * heart/lung 라이브러리는 흉부 청진 부위가 추가될 때 바로 쓸 수 있게 미리 제공한다.
 */

import { duckRoomTone } from './roomTone'
import { audioContext, masterOut } from './sfx'

/* ── AudioContext ──
 * ⚠️ **여기서 `new AudioContext()` 를 따로 만들면 안 된다.** 종전에는 그렇게 해서
 *   진찰음이 게임의 나머지 소리와 **다른 컨텍스트**로 나갔고, 그 결과:
 *     · `sfx.ts` 의 `masterOut()`(마스터 볼륨 · 효과음 on/off)을 통째로 우회했다
 *     · `App.tsx` 의 첫 제스처 핸들러가 resume 하는 것은 `sfx.ts` 쪽 컨텍스트뿐이라,
 *       이쪽은 정지 상태로 남아 **버퍼를 재생해도 소리가 안 났다**
 *   (사용자 신고 2026-07-26: "타진음이 안 들려")
 * → 게임 전체가 쓰는 컨텍스트·마스터 게인을 그대로 빌려 쓴다. TTS(`tts.ts`)도 같은 방식이다. */
const ac = audioContext

/* ── 파일 존재 여부 사전 확인 (HEAD 요청, 결과 캐시) + 디코드 버퍼 캐시 ── */
const _fileOk = new Map<string, boolean>()
const _bufCache = new Map<string, AudioBuffer>()
function prefetch(path: string) {
  fetch(path, { method: 'HEAD' })
    .then((r) => _fileOk.set(path, r.ok))
    .catch(() => _fileOk.set(path, false))
}

/* 실제 음원 파일 경로 ── */
const SND = {
  bowel: {
    normal: '/sounds/exam/bowel/normal.mp3',
    hyperactive: '/sounds/exam/bowel/hyperactive.mp3',
    hypoactive: '/sounds/exam/bowel/hypoactive.mp3',
  },
  // 흉부 청진용 라이브러리 — 부위별 소견에 맞춰 재생 (부위 추가 시 사용)
  heart: {
    normal: '/sounds/exam/heart/normal.mp3',
    systolic_murmur: '/sounds/exam/heart/systolic_murmur.mp3',
    diastolic_murmur: '/sounds/exam/heart/diastolic_murmur.mp3',
    atrial_fibrillation: '/sounds/exam/heart/atrial_fibrillation.mp3',
    s3_gallop: '/sounds/exam/heart/s3_gallop.mp3',
    s4_gallop: '/sounds/exam/heart/s4_gallop.mp3',
    tachycardia: '/sounds/exam/heart/tachycardia.mp3',
    av_block: '/sounds/exam/heart/av_block.mp3',
  },
  lung: {
    normal: '/sounds/exam/lung/normal.mp3',
    wheezing: '/sounds/exam/lung/wheezing.mp3',
    fine_crackles: '/sounds/exam/lung/fine_crackles.mp3',
    coarse_crackles: '/sounds/exam/lung/coarse_crackles.mp3',
    rhonchi: '/sounds/exam/lung/rhonchi.mp3',
    pleural_rub: '/sounds/exam/lung/pleural_rub.mp3',
  },
  // 타진음 — 자체 합성(모달 합성). 공개된 CC 라이선스 임상 타진음 데이터셋이 없어서 직접 만들었다.
  // 생성 스크립트: tools/audio/gen_percussion.py (파라미터 = 기본주파수/감쇠시간/모드비)
  // 임상 특성 순서: 고창음 → 공명음 → 탁음 → 편평음 으로 갈수록 음정↑ 지속↓
  percussion: {
    tympany: '/sounds/exam/percussion/tympany.mp3',              // 고창음 — 공기 찬 장
    resonance: '/sounds/exam/percussion/resonance.mp3',          // 공명음 — 정상 폐
    hyperresonance: '/sounds/exam/percussion/hyperresonance.mp3',// 과공명음 — 폐기종·기흉
    dullness: '/sounds/exam/percussion/dullness.mp3',            // 탁음 — 간·비장·액체
    flatness: '/sounds/exam/percussion/flatness.mp3',            // 편평음 — 근육·뼈
  },
  // 기존 호환 경로 (bowel/normal 로 대체됨)
  auscultationLegacy: '/sounds/exam/auscultation.mp3',
} as const

export type HeartSound = keyof typeof SND.heart
export type LungSound = keyof typeof SND.lung
export type BowelVariant = keyof typeof SND.bowel
export type PercussionSound = keyof typeof SND.percussion

if (typeof window !== 'undefined') {
  ;[
    SND.bowel.normal, SND.bowel.hyperactive, SND.bowel.hypoactive,
    SND.percussion.tympany, SND.percussion.dullness, SND.auscultationLegacy,
  ].forEach(prefetch)
}

/** 파일 재생(디코드 캐시). 성공 true, 파일 없거나 실패면 false(폴백 유도). */
async function playFile(path: string, gain = 0.6): Promise<boolean> {
  if (_fileOk.get(path) === false) return false
  try {
    let buf = _bufCache.get(path)
    if (!buf) {
      const res = await fetch(path)
      if (!res.ok) { _fileOk.set(path, false); return false }
      buf = await ac().decodeAudioData(await res.arrayBuffer())
      _bufCache.set(path, buf)
      _fileOk.set(path, true)
    }
    const src = ac().createBufferSource()
    src.buffer = buf
    const g = ac().createGain()
    g.gain.value = gain
    src.connect(g); g.connect(masterOut())
    src.start()
    // 청진·타진하는 동안 룸톤을 거의 무음으로 — 임상적으로도 청진할 땐 조용히 한다.
    // (룸톤이 아직 시작 전이면 no-op) material-quality-spec §6.5(a)
    duckRoomTone(buf.duration * 1000 + 400)
    return true
  } catch {
    _fileOk.set(path, false)
    return false
  }
}

/* ── 소견 텍스트 → 장음 변형 매핑 ── */
function bowelVariantFromFinding(finding?: string | null): BowelVariant {
  const t = finding ?? ''
  if (/항진|증가|활발|과항진|hyperactive/i.test(t)) return 'hyperactive'
  if (/감소|저하|소실|없|미약|hypoactive/i.test(t)) return 'hypoactive'
  return 'normal'
}

/* ── WebAudio 합성 폴백 (파일 없을 때만) ── */
function synthAuscultation() {
  try {
    const a = ac()
    const dur = 1.25
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.04) / 1.02
      d[i] = last * 3.5
    }
    const src = a.createBufferSource()
    src.buffer = buf
    const lp = a.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 130; lp.Q.value = 0.8
    const g = a.createGain()
    const t = a.currentTime
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.52, t + 0.1)
    g.gain.setValueAtTime(0.52, t + dur - 0.3)
    g.gain.linearRampToValueAtTime(0, t + dur)
    src.connect(lp); lp.connect(g); g.connect(masterOut())
    src.start()
    duckRoomTone(dur * 1000 + 400)
  } catch { /* 오디오 컨텍스트 없으면 무시 */ }
}

function synthPercussion() {
  try {
    const a = ac()
    const t = a.currentTime
    const osc = a.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(220, t)
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.18)
    const g = a.createGain()
    g.gain.setValueAtTime(0.7, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    osc.connect(g); g.connect(masterOut())
    osc.start(t); osc.stop(t + 0.25)
    duckRoomTone(650)
  } catch { /* 오디오 컨텍스트 없으면 무시 */ }
}

/* ── 공개 API ── */

/** 복부 청진 — 장음 재생. 케이스가 region_findings.sound를 지정했으면 그것을 우선하고,
 *  없을 때만 소견 텍스트로 추정한다(텍스트 매칭은 문구를 다듬으면 조용히 깨진다). */
export function playAuscultation(finding?: string | null, sound?: string | null) {
  const variant = (sound && sound in SND.bowel ? sound : bowelVariantFromFinding(finding)) as BowelVariant
  void (async () => {
    if (await playFile(SND.bowel[variant])) return
    // 변형 파일이 없으면 정상 장음 → 레거시 경로 → 합성 순으로 폴백
    if (variant !== 'normal' && await playFile(SND.bowel.normal)) return
    if (await playFile(SND.auscultationLegacy)) return
    synthAuscultation()
  })()
}

/* ── 소견 텍스트 → 타진음 매핑 (임시 폴백) ──
   케이스 데이터가 region_findings에 "sound"를 명시하는 것이 원칙이다.
   텍스트 매칭은 소견 문구를 조금만 다듬어도 조용히 깨지므로 sound가 없을 때만 쓴다. */
function percussionFromFinding(finding?: string | null): PercussionSound {
  const t = finding ?? ''
  if (/편평음|flatness/i.test(t)) return 'flatness'
  if (/과공명|hyperresonan/i.test(t)) return 'hyperresonance'
  if (/탁음|둔탁|dull/i.test(t)) return 'dullness'   // '간 탁음'도 여기서 잡힌다
  if (/공명음|resonan/i.test(t)) return 'resonance'
  return 'tympany'                                    // 복부 기본값 = 고창음
}

/** 타진 — 부위 소견에 맞는 타진음 재생. 파일 없으면 합성 폴백.
 *  sound를 명시하면 그것을 쓰고, 없으면 finding 텍스트로 추정한다. */
export function playPercussion(sound?: string | null, finding?: string | null) {
  const key = (sound && sound in SND.percussion ? sound : percussionFromFinding(finding)) as PercussionSound
  void (async () => {
    if (await playFile(SND.percussion[key], 0.55)) return
    if (key !== 'tympany' && await playFile(SND.percussion.tympany, 0.55)) return
    synthPercussion()
  })()
}

/** 흉부 심장 청진. 서버가 케이스의 region_findings.sound를 그대로 보내므로 문자열을 받아 검증한다.
 *  (오타/미지정이면 조용히 normal로 폴백 — 소리가 아예 안 나는 것보다 낫다) */
export function playHeartSound(type?: string | null) {
  const key = (type && type in SND.heart ? type : 'normal') as HeartSound
  void playFile(SND.heart[key])
}

/** 흉부 폐 청진. 동작 원칙은 playHeartSound와 같다. */
export function playLungSound(type?: string | null) {
  const key = (type && type in SND.lung ? type : 'normal') as LungSound
  void playFile(SND.lung[key])
}

/** 삼킴(꿀꺽) — 갑상샘 촉진 중 "침 삼켜보세요" 지시에 환자가 삼키는 소리.
 *
 *  ⚠ 이 소리를 **대사로 넣지 마라.** 종전에는 케이스 `reaction.line` 이 "꿀꺽..." 으로 시작해서
 *    TTS 가 그걸 그대로 읽었다 — 환자가 의성어를 **말하는** 그림이 됐다(사용자 신고 2026-07-26).
 *    삼킴은 대사가 아니라 동작(목의 후두 융기 상하 이동)과 이 소리로 표현한다.
 *
 *  음원은 합성이다. 공개 CC 라이선스 삼킴 음원을 못 찾았고, 이 정도 짧은 소리는
 *  합성이 라이선스 걱정 없이 더 확실하다(타진음도 같은 이유로 자체 제작했다).
 *  구성: 저역 노이즈 버스트(인두 수축) + 짧은 상승 포먼트(후두 상승) 두 겹. */
export function playSwallow() {
  try {
    const a = ac()
    const t = a.currentTime
    const dur = 0.42
    // (1) 목젖이 오르내리며 나는 젖은 마찰음 — 대역 제한 노이즈
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.5) / 1.6
      d[i] = last
    }
    const src = a.createBufferSource()
    src.buffer = buf
    const bp = a.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(320, t)
    bp.frequency.exponentialRampToValueAtTime(880, t + 0.16)  // 후두가 올라가며 음이 오른다
    bp.frequency.exponentialRampToValueAtTime(260, t + dur)   // 다시 내려온다
    bp.Q.value = 3.2
    const g = a.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05)
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.2)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp); bp.connect(g); g.connect(masterOut())
    src.start(t); src.stop(t + dur)

    // (2) 삼킴 끝의 '꿀꺽' 하는 낮은 클릭 — 식도 상부가 열리는 순간
    const click = a.createOscillator()
    click.type = 'sine'
    click.frequency.setValueAtTime(150, t + 0.17)
    click.frequency.exponentialRampToValueAtTime(72, t + 0.29)
    const cg = a.createGain()
    cg.gain.setValueAtTime(0.0001, t + 0.17)
    cg.gain.exponentialRampToValueAtTime(0.34, t + 0.2)
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    click.connect(cg); cg.connect(masterOut())
    click.start(t + 0.17); click.stop(t + 0.32)
  } catch { /* 오디오 컨텍스트 없으면 무시 */ }
}
