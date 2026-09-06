/**
 * 케이스 인트로 — 실제 병원 '접수증/접수동의서' 양식 느낌.
 * 체크박스 폼 + 이중 프레임 + 클리닉 헤더 + 서명란. 종이/잉크 톤(슬레이트 임상 블루).
 */
import { motion } from 'framer-motion'
import { useGame } from '../store'
import { T } from '../ui/theme'
import { Settings } from './Settings'
import { sfxPop } from '../audio/sfx'
import { ClinicScene } from '../three/ClinicScene'
import { pickAvatarVariant } from '../three/avatarVariant'

export function IntroScreen() {
  const { session, beginPlay, reset } = useGame()
  if (!session) return null

  const p = session.patient
  const genderKo = p.gender === 'female' ? '여' : '남'
  const variant = pickAvatarVariant(p.name, p.gender, p.age, p.body_type)

  return (
    <div
      className="relative flex h-full items-center justify-center overflow-hidden p-4"
      style={{
        perspective: '1200px',
        // 3D 씬 로딩 전에도 까맣지 않게 따뜻한 진료실 톤 폴백
        background: 'radial-gradient(120% 95% at 50% 38%, #4a3a28 0%, #2a2018 60%, #1a130c 100%)',
      }}
    >
      {/* 실제 3D 진료실(빈 방)을 배경으로 — 인게임 세계 안에서 접수 */}
      <div className="absolute inset-0">
        <ClinicScene
          entering={false}
          onEnterComplete={() => {}}
          emotion="neutral"
          speaking={false}
          variant={variant}
          showPatient={false}
        />
      </div>
      {/* 폼 가독성용 어두운 웜 오버레이 + 비네팅 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(120% 95% at 50% 42%, rgba(18,12,5,0.22) 0%, rgba(12,8,3,0.72) 100%)' }}
      />

      {/* 뒤로가기 (메인으로) */}
      <button
        onClick={() => {
          sfxPop()
          reset()
        }}
        className="absolute top-4 left-4 z-40 flex items-center gap-1 rounded-full border px-4 py-1.5 text-sm shadow transition"
        style={{ background: T.paper, borderColor: T.line, color: T.inkSoft }}
      >
        ← 뒤로
      </button>

      {/* 설정 (볼륨/음성) */}
      <Settings showExit={false} />
      <motion.div
        // 손이 책상에서 접수증을 들어올리는 연출 (아래에서 위로, 살짝 기울었다 정면)
        initial={{ opacity: 0, scale: 0.82, rotateX: 26, y: 150 }}
        animate={{ opacity: 1, scale: 1, rotateX: 0, y: 0 }}
        transition={{ duration: 0.95, ease: [0.22, 0.61, 0.36, 1], delay: 0.5 }}
        className="relative w-full max-w-lg rounded-[6px] p-2.5"
        style={{
          background: T.slate,
          transformStyle: 'preserve-3d',
          transformOrigin: 'center bottom',
          boxShadow: '0 30px 70px rgba(8,5,2,0.6), 0 6px 18px rgba(8,5,2,0.4)',
        }}
      >

        {/* 안쪽 종이 + 가는 프레임 */}
        <div
          className="rounded-[3px] border px-7 py-6"
          style={{ background: T.paper, borderColor: 'rgba(255,255,255,0.5)' }}
        >
          {/* 타이틀 */}
          <h2
            className="font-display mt-1 text-center text-2xl tracking-[0.35em]"
            style={{ color: T.slate }}
          >
            진료 접수증
          </h2>
          <div className="mx-auto mt-3 h-[2px] w-full" style={{ background: T.slate, opacity: 0.85 }} />

          {/* 제시문 (한 줄) — 상세 증상은 노출하지 않는다 (시험: 학생이 직접 문진) */}
          <p className="mt-5 text-[15px] leading-relaxed" style={{ color: T.ink }}>
            {session.presentation ?? `${p.age}세 ${genderKo}자 ${p.name}씨가 내원하였다.`}
          </p>

          {/* 활력징후 */}
          {session.vitals && (
            <div className="mt-4 rounded-[3px] border px-4 py-3" style={{ borderColor: T.line }}>
              <div className="font-display text-[13px]" style={{ color: T.slate }}>&lt;활력징후&gt;</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13.5px]" style={{ color: T.ink }}>
                <span>혈압: {session.vitals.bp}</span>
                <span>맥박: {session.vitals.hr}</span>
                <span>호흡: {session.vitals.rr}</span>
                <span>체온: {session.vitals.temp}</span>
              </div>
            </div>
          )}

          {/* 응시자 지침 (표준 CPX) */}
          <div className="mt-4 text-[13.5px] leading-relaxed" style={{ color: T.ink }}>
            <p>응시자는</p>
            <ul className="mt-1 space-y-0.5 pl-1" style={{ color: T.inkSoft }}>
              <li>- 증상과 관련된 병력을 청취하고</li>
              <li>- 증상과 관련된 적절한 신체 진찰을 시행한 후,</li>
              <li>- 향후 진단 및 치료계획 등에 대해 환자와 논의하시오.</li>
            </ul>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={beginPlay}
            className="font-display mx-auto mt-6 block rounded-full px-10 py-2.5 text-[15px] shadow-md transition"
            style={{ background: T.slate, color: T.paper }}
          >
            진료실 들어가기
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}


