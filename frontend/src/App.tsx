import { lazy, Suspense, useEffect } from 'react'
import { useGame } from './store'
import { TitleScreen } from './components/TitleScreen'
import { startBgm, setBgmScene } from './audio/bgm'
import { startRoomTone, setRoomToneScene, setRoomToneLevel, roomToneLevelFor } from './audio/roomTone'
import { debugAvatarVariant } from './three/avatarVariant'

/* 진료실(ClinicScene 4,200줄 + RealisticPatient 6,500줄)과 그 의존인 three.js 는
   **타이틀 화면에 필요 없다.** 예전에는 IntroScreen 이 ClinicScene 을 정적으로
   import 해서 전부 첫 청크에 들어갔고, GameScreen 만 lazy 로 잘라 놔도
   엔트리가 2.2MB 였다. 셋 다 lazy 로 내려 첫 페인트를 가볍게 한다. */
const GameScreen = lazy(async () => {
  const module = await import('./components/GameScreen')
  return { default: module.GameScreen }
})

const IntroScreen = lazy(async () => {
  const module = await import('./components/IntroScreen')
  return { default: module.IntroScreen }
})

const ReportScreen = lazy(async () => {
  const module = await import('./components/ReportScreen')
  return { default: module.ReportScreen }
})

const AvatarLab = import.meta.env.DEV
  ? lazy(async () => {
      const module = await import('./three/AvatarLab')
      return { default: module.AvatarLab }
    })
  : null

export default function App() {
  const phase = useGame((s) => s.phase)
  // 진찰 도구를 들면 룸톤을 낮춘다 (청진 중에는 examSounds가 별도로 덕킹한다)
  const examToolActive = useGame((s) => !!s.examTool)
  const avatarLabVariant = import.meta.env.DEV
    ? debugAvatarVariant(new URLSearchParams(window.location.search).get('avatarLab'))
    : null

  // 자동재생 정책: 첫 사용자 제스처 후 BGM 시작
  useEffect(() => {
    const begin = () => {
      startBgm()
      startRoomTone()
    }
    window.addEventListener('pointerdown', begin, { once: true })
    window.addEventListener('keydown', begin, { once: true })
    return () => {
      window.removeEventListener('pointerdown', begin)
      window.removeEventListener('keydown', begin)
    }
  }, [])

  // 화면별 BGM 트랙 전환 (타이틀/결과 → 메인, 진료 관련 → 진료실)
  useEffect(() => {
    setBgmScene(phase === 'title' || phase === 'report' ? 'title' : 'clinic')
  }, [phase])

  /* 룸톤(환경음) — 진료실 안에 있을 때만 재생하고, 진찰 중에는 낮춘다.
     BGM과 별개 레이어다: BGM은 '음악', 룸톤은 '공간의 소리'(공조·형광등 험·복도 인기척).
     청진 중 무음화는 examSounds.ts가 duckRoomTone()으로 직접 처리한다. */
  useEffect(() => {
    setRoomToneScene(phase !== 'title' && phase !== 'report')
    setRoomToneLevel(roomToneLevelFor({ phase, examToolActive }))
  }, [phase, examToolActive])

  if (avatarLabVariant && AvatarLab) {
    return (
      <Suspense fallback={<div className="h-full bg-[#171a1e]" />}>
        <AvatarLab variant={avatarLabVariant} />
      </Suspense>
    )
  }

  return (
    <div className="h-full">
      {phase === 'title' && <TitleScreen />}
      {phase === 'intro' && (
        <Suspense fallback={<div className="h-full bg-[#0f1115]" />}>
          <IntroScreen />
        </Suspense>
      )}
      {(phase === 'entering' || phase === 'playing' || phase === 'exam' || phase === 'education') && (
        <Suspense fallback={<div className="h-full bg-[#0f1115]" />}>
          <GameScreen />
        </Suspense>
      )}
      {phase === 'report' && (
        <Suspense fallback={<div className="h-full bg-[#0f1115]" />}>
          <ReportScreen />
        </Suspense>
      )}
    </div>
  )
}
