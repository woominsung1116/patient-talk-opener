/**
 * 환자 캐릭터 — 레이어드 SVG 일러스트.
 * 감정 상태에 따라 눈/눈썹/입/홍조/땀방울이 바뀌고,
 * 말할 때 입이 움직이며, 주기적으로 눈을 깜빡인다.
 * variant로 케이스별 외형(헤어/의상)이 달라진다.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { Emotion } from '../types'

export type CharacterVariant = 'jieun' | 'sujin' | 'hyunwoo'

interface Face {
  eye: 'open' | 'happy' | 'half' | 'wide' | 'down' | 'teary'
  pupilDx: number
  pupilDy: number
  brow: 'normal' | 'worried' | 'angry' | 'raised' | 'sad'
  mouth: 'small' | 'smile' | 'open-smile' | 'flat' | 'frown' | 'wavy' | 'open-o' | 'tight'
  blush: number
  sweat: boolean
  tear: boolean
  headTilt: number
  shock: boolean
}

const FACES: Record<Emotion, Face> = {
  neutral:           { eye: 'open',  pupilDx: 0,  pupilDy: 0, brow: 'normal',  mouth: 'small',      blush: 0.15, sweat: false, tear: false, headTilt: 0,  shock: false },
  anxious:           { eye: 'open',  pupilDx: 0,  pupilDy: 2, brow: 'worried', mouth: 'wavy',       blush: 0.1,  sweat: true,  tear: false, headTilt: -1, shock: false },
  defensive:         { eye: 'half',  pupilDx: -7, pupilDy: 0, brow: 'worried', mouth: 'tight',      blush: 0,    sweat: false, tear: false, headTilt: -2, shock: false },
  calm:              { eye: 'open',  pupilDx: 0,  pupilDy: 0, brow: 'normal',  mouth: 'smile',      blush: 0.25, sweat: false, tear: false, headTilt: 0,  shock: false },
  warm:              { eye: 'happy', pupilDx: 0,  pupilDy: 0, brow: 'raised',  mouth: 'open-smile', blush: 0.5,  sweat: false, tear: false, headTilt: 2,  shock: false },
  relieved:          { eye: 'happy', pupilDx: 0,  pupilDy: 0, brow: 'raised',  mouth: 'smile',      blush: 0.4,  sweat: false, tear: false, headTilt: 1,  shock: false },
  hesitant_relieved: { eye: 'down',  pupilDx: 0,  pupilDy: 5, brow: 'worried', mouth: 'smile',      blush: 0.55, sweat: false, tear: false, headTilt: -2, shock: false },
  guarded:           { eye: 'down',  pupilDx: -6, pupilDy: 4, brow: 'sad',     mouth: 'tight',      blush: 0.2,  sweat: true,  tear: false, headTilt: -3, shock: false },
  hurt:              { eye: 'teary', pupilDx: 0,  pupilDy: 2, brow: 'sad',     mouth: 'frown',      blush: 0.2,  sweat: false, tear: true,  headTilt: -2, shock: false },
  shocked:           { eye: 'wide',  pupilDx: 0,  pupilDy: 0, brow: 'raised',  mouth: 'open-o',     blush: 0,    sweat: true,  tear: false, headTilt: 1,  shock: true },
  annoyed:           { eye: 'half',  pupilDx: 5,  pupilDy: 0, brow: 'angry',   mouth: 'flat',       blush: 0,    sweat: false, tear: false, headTilt: 0,  shock: false },
  thinking:          { eye: 'open',  pupilDx: 6,  pupilDy: -4, brow: 'normal', mouth: 'small',      blush: 0.15, sweat: false, tear: false, headTilt: 2,  shock: false },
  speaking:          { eye: 'open',  pupilDx: 0,  pupilDy: 0, brow: 'normal',  mouth: 'open-o',     blush: 0.2,  sweat: false, tear: false, headTilt: 0,  shock: false },
}

const SKIN = '#ffe3d0'
const SKIN_SHADE = '#f7c9ae'

interface Style {
  hair: string
  hairLight: string
  outer: string
  outerLine: string
  inner: string
}

const STYLES: Record<CharacterVariant, Style> = {
  jieun:   { hair: '#5a4636', hairLight: '#7a6048', outer: '#e8b88a', outerLine: '#d9a572', inner: '#fdfaf4' },
  sujin:   { hair: '#2f2a33', hairLight: '#4d4554', outer: '#5b709c', outerLine: '#48597e', inner: '#fdfaf4' },
  hyunwoo: { hair: '#3b332c', hairLight: '#564a3e', outer: '#7da08a', outerLine: '#638a73', inner: '#f4f6fb' },
}

export function PatientCharacter({
  emotion,
  speaking,
  variant = 'jieun',
}: {
  emotion: Emotion
  speaking: boolean
  variant?: CharacterVariant
}) {
  const face = FACES[emotion] ?? FACES.neutral
  const style = STYLES[variant]
  const [blink, setBlink] = useState(false)
  const [mouthOpen, setMouthOpen] = useState(false)

  // 자연스러운 눈 깜빡임
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const loop = () => {
      timer = setTimeout(() => {
        if (!alive) return
        setBlink(true)
        setTimeout(() => alive && setBlink(false), 130)
        loop()
      }, 2200 + Math.random() * 2600)
    }
    loop()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  // 말하는 동안 입 개폐 (말하지 않을 때는 mouthOpen 값이 사용되지 않음)
  useEffect(() => {
    if (!speaking) return
    const t = setInterval(() => setMouthOpen((v) => !v), 160)
    return () => clearInterval(t)
  }, [speaking])

  const eye = blink ? 'closed' : face.eye
  const mouth = speaking ? (mouthOpen ? 'open-o' : 'small') : face.mouth

  return (
    <motion.svg
      viewBox="0 0 400 460"
      className="h-full w-auto drop-shadow-[0_12px_24px_rgba(60,90,70,0.18)]"
      animate={{ rotate: face.headTilt, y: [0, -5, 0] }}
      transition={{
        rotate: { duration: 0.5 },
        y: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      {/* ───── 몸통 ───── */}
      <g>
        <path d="M118 460 C118 370 142 332 200 330 C258 332 282 370 282 460 Z" fill={style.outer} />
        <path d="M168 460 C168 392 178 352 200 350 C222 352 232 392 232 460 Z" fill={style.inner} />
        <path
          d="M150 352 C162 340 180 334 200 334 C220 334 238 340 250 352 L236 372 C226 360 214 354 200 354 C186 354 174 360 164 372 Z"
          fill={style.outer}
          stroke={style.outerLine}
          strokeWidth="2"
        />
        {variant === 'hyunwoo' && (
          // 후드 끈
          <g stroke={style.outerLine} strokeWidth="4" strokeLinecap="round">
            <line x1="178" y1="372" x2="176" y2="408" />
            <line x1="222" y1="372" x2="224" y2="408" />
          </g>
        )}
        {/* 목 */}
        <path d="M184 300 L184 342 C184 352 216 352 216 342 L216 300 Z" fill={SKIN} />
        <path d="M184 300 L184 318 C194 326 206 326 216 318 L216 300 Z" fill={SKIN_SHADE} />
      </g>

      {/* ───── 뒷머리 ───── */}
      {variant === 'jieun' && (
        <path d="M110 200 C100 120 140 60 200 58 C260 60 300 120 290 200 C296 280 286 330 270 352 L256 310 L144 310 L130 352 C114 330 104 280 110 200 Z" fill={style.hair} />
      )}
      {variant === 'sujin' && (
        <path d="M112 200 C102 118 142 60 200 58 C258 60 298 118 288 200 C292 252 288 282 276 300 L262 272 L138 272 L124 300 C112 282 108 252 112 200 Z" fill={style.hair} />
      )}
      {variant === 'hyunwoo' && (
        <path d="M118 196 C110 112 148 58 200 56 C252 58 290 112 282 196 C284 222 282 240 276 252 L262 230 L138 230 L124 252 C118 240 116 222 118 196 Z" fill={style.hair} />
      )}

      {/* ───── 얼굴 ───── */}
      <g>
        <ellipse cx="200" cy="208" rx="86" ry="92" fill={SKIN} />
        <ellipse cx="116" cy="212" rx="12" ry="16" fill={SKIN} />
        <ellipse cx="284" cy="212" rx="12" ry="16" fill={SKIN} />

        {/* 홍조 */}
        <ellipse cx="146" cy="248" rx="16" ry="9" fill="#ff9d9d" opacity={face.blush} />
        <ellipse cx="254" cy="248" rx="16" ry="9" fill="#ff9d9d" opacity={face.blush} />

        {/* 눈썹 */}
        <Brows type={face.brow} color={style.hair} thick={variant === 'hyunwoo'} />

        {/* 눈 */}
        <Eyes type={eye} dx={face.pupilDx} dy={face.pupilDy} />

        {/* 눈물 */}
        {face.tear && (
          <g fill="#9fd4ff" opacity="0.9">
            <motion.path
              d="M150 228 q4 10 0 14 q-4 -4 0 -14"
              animate={{ y: [0, 6], opacity: [0.9, 0.4] }}
              transition={{ duration: 1.1, repeat: Infinity }}
            />
            <motion.path
              d="M250 228 q4 10 0 14 q-4 -4 0 -14"
              animate={{ y: [0, 6], opacity: [0.9, 0.4] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: 0.4 }}
            />
          </g>
        )}

        {/* 코 */}
        <path d="M198 240 q4 4 0 8" stroke={SKIN_SHADE} strokeWidth="3" strokeLinecap="round" fill="none" />

        {/* 입 */}
        <Mouth type={mouth} />
      </g>

      {/* ───── 앞머리 ───── */}
      {variant === 'jieun' && (
        <>
          {/* 둥근 물결 앞머리 */}
          <path
            d="M114 196 C110 110 150 66 200 64 C250 66 290 110 286 196
               Q280 172 264 162
               Q246 188 228 158
               Q210 184 192 158
               Q174 184 156 158
               Q136 176 114 196 Z"
            fill={style.hair}
          />
          <path d="M228 158 Q210 184 192 158 Q201 176 210 176 Q219 176 228 158 Z" fill={style.hairLight} opacity="0.35" />
          <path d="M114 192 C108 240 110 280 122 312 C132 314 138 308 140 296 C132 264 128 228 130 196 Z" fill={style.hair} />
          <path d="M286 192 C292 240 290 280 278 312 C268 314 262 308 260 296 C268 264 272 228 270 196 Z" fill={style.hair} />
        </>
      )}
      {variant === 'sujin' && (
        <>
          {/* 옆으로 넘긴 가르마 앞머리 */}
          <path
            d="M116 196 C112 108 152 64 200 62 C248 64 288 108 284 196
               Q280 164 266 152
               Q248 176 230 148
               C210 168 184 142 172 122
               C150 138 128 164 116 196 Z"
            fill={style.hair}
          />
          <path d="M230 148 C210 168 184 142 172 122 C186 138 208 156 230 148 Z" fill={style.hairLight} opacity="0.35" />
          {/* 옆머리 (턱선 단발) */}
          <path d="M116 192 C110 226 112 254 124 274 C134 276 140 270 142 260 C134 238 130 216 132 196 Z" fill={style.hair} />
          <path d="M284 192 C290 226 288 254 276 274 C266 276 260 270 258 260 C266 238 270 216 268 196 Z" fill={style.hair} />
          {/* 귀걸이 */}
          <circle cx="284" cy="232" r="3.5" fill="#f5c344" />
          <circle cx="116" cy="232" r="3.5" fill="#f5c344" />
        </>
      )}
      {variant === 'hyunwoo' && (
        <>
          {/* 짧은 남성 앞머리 — 이마가 더 드러나는 둥근 프린지 */}
          <path
            d="M118 192 C112 104 152 60 200 58 C248 60 288 104 282 192
               Q278 152 262 140
               Q244 162 226 136
               Q208 158 190 136
               Q172 160 154 140
               Q134 158 118 192 Z"
            fill={style.hair}
          />
          <path d="M226 136 Q208 158 190 136 Q199 152 208 152 Q217 152 226 136 Z" fill={style.hairLight} opacity="0.35" />
          {/* 짧은 구레나룻 */}
          <path d="M118 190 C114 206 114 220 118 232 C124 234 128 230 130 222 C126 210 124 200 126 192 Z" fill={style.hair} />
          <path d="M282 190 C286 206 286 220 282 232 C276 234 272 230 270 222 C274 210 276 200 274 192 Z" fill={style.hair} />
        </>
      )}

      {/* 땀방울 */}
      {face.sweat && (
        <motion.path
          d="M298 160 q10 16 0 24 q-10 -8 0 -24"
          fill="#aee0ff"
          stroke="#7fc4f5"
          strokeWidth="1.5"
          animate={{ y: [0, 4, 0], opacity: [0.9, 1, 0.9] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}
      {/* 충격선 */}
      {face.shock && (
        <g stroke="#7da9d8" strokeWidth="3" strokeLinecap="round" opacity="0.8">
          <line x1="92" y1="120" x2="100" y2="142" />
          <line x1="78" y1="142" x2="90" y2="158" />
          <line x1="308" y1="120" x2="300" y2="142" />
          <line x1="322" y1="142" x2="310" y2="158" />
        </g>
      )}
      {/* 짜증 표시 */}
      {emotion === 'annoyed' && (
        <g stroke="#e87d7d" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.85">
          <path d="M286 116 q8 -2 10 6" />
          <path d="M296 108 q8 -2 10 6" />
          <path d="M290 130 q8 -2 10 6" />
          <path d="M300 122 q8 -2 10 6" />
        </g>
      )}
    </motion.svg>
  )
}

function Brows({
  type,
  color,
  thick,
}: {
  type: Face['brow']
  color: string
  thick: boolean
}) {
  const w = thick ? 5 : 3.5
  const paths: Record<Face['brow'], [string, string]> = {
    normal:  ['M132 182 Q152 174 172 180', 'M228 180 Q248 174 268 182'],
    worried: ['M134 178 Q154 184 172 190', 'M228 190 Q246 184 266 178'],
    sad:     ['M136 176 Q156 186 172 194', 'M228 194 Q244 186 264 176'],
    angry:   ['M134 190 Q154 180 172 178', 'M228 178 Q246 180 266 190'],
    raised:  ['M132 174 Q152 166 172 172', 'M228 172 Q248 166 268 174'],
  }
  const [l, r] = paths[type]
  return (
    <g stroke={color} strokeWidth={w} strokeLinecap="round" fill="none">
      <path d={l} />
      <path d={r} />
    </g>
  )
}

function Eyes({
  type,
  dx,
  dy,
}: {
  type: 'open' | 'happy' | 'half' | 'wide' | 'down' | 'teary' | 'closed'
  dx: number
  dy: number
}) {
  if (type === 'closed') {
    return (
      <g stroke="#4a3b2e" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M136 218 Q152 226 168 218" />
        <path d="M232 218 Q248 226 264 218" />
      </g>
    )
  }
  if (type === 'happy') {
    return (
      <g stroke="#4a3b2e" strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M134 220 Q152 206 170 220" />
        <path d="M230 220 Q248 206 266 220" />
      </g>
    )
  }
  const ry = type === 'wide' ? 17 : type === 'half' ? 8 : type === 'down' ? 11 : 14
  const pupilR = type === 'wide' ? 7 : 11
  const lidDown = type === 'down' || type === 'half'
  return (
    <g>
      <ellipse cx="152" cy="216" rx="15" ry={ry} fill="white" stroke="#4a3b2e" strokeWidth="2" />
      <ellipse cx="248" cy="216" rx="15" ry={ry} fill="white" stroke="#4a3b2e" strokeWidth="2" />
      <g clipPath="url(#eyeL)">
        <circle cx={152 + dx} cy={216 + dy} r={pupilR} fill="#6b4f35" />
        <circle cx={152 + dx} cy={219 + dy} r={pupilR * 0.55} fill="#4a3322" />
        <circle cx={148 + dx} cy={211 + dy} r="3.6" fill="white" />
        <circle cx={156 + dx} cy={221 + dy} r="1.6" fill="white" opacity="0.85" />
      </g>
      <g clipPath="url(#eyeR)">
        <circle cx={248 + dx} cy={216 + dy} r={pupilR} fill="#6b4f35" />
        <circle cx={248 + dx} cy={219 + dy} r={pupilR * 0.55} fill="#4a3322" />
        <circle cx={244 + dx} cy={211 + dy} r="3.6" fill="white" />
        <circle cx={252 + dx} cy={221 + dy} r="1.6" fill="white" opacity="0.85" />
      </g>
      <defs>
        <clipPath id="eyeL">
          <ellipse cx="152" cy="216" rx="15" ry={ry} />
        </clipPath>
        <clipPath id="eyeR">
          <ellipse cx="248" cy="216" rx="15" ry={ry} />
        </clipPath>
      </defs>
      {type === 'teary' && (
        <g>
          <ellipse cx="152" cy="224" rx="11" ry="4" fill="#bfe5ff" opacity="0.8" />
          <ellipse cx="248" cy="224" rx="11" ry="4" fill="#bfe5ff" opacity="0.8" />
        </g>
      )}
      {lidDown && (
        <g fill={SKIN}>
          <path d={`M137 ${216 - ry} h30 v${ry * 0.55} h-30 Z`} />
          <path d={`M233 ${216 - ry} h30 v${ry * 0.55} h-30 Z`} />
        </g>
      )}
      {lidDown && (
        <g stroke="#4a3b2e" strokeWidth="3" strokeLinecap="round">
          <line x1="137" y1={216 - ry * 0.45} x2="167" y2={216 - ry * 0.45} />
          <line x1="233" y1={216 - ry * 0.45} x2="263" y2={216 - ry * 0.45} />
        </g>
      )}
    </g>
  )
}

function Mouth({ type }: { type: string }) {
  switch (type) {
    case 'smile':
      return <path d="M186 268 Q200 280 214 268" stroke="#c4685e" strokeWidth="4" strokeLinecap="round" fill="none" />
    case 'open-smile':
      return <path d="M184 264 Q200 286 216 264 Q200 272 184 264 Z" fill="#d96a5e" stroke="#b8554a" strokeWidth="2" />
    case 'flat':
      return <line x1="188" y1="270" x2="212" y2="270" stroke="#c4685e" strokeWidth="4" strokeLinecap="round" />
    case 'frown':
      return <path d="M186 274 Q200 262 214 274" stroke="#c4685e" strokeWidth="4" strokeLinecap="round" fill="none" />
    case 'wavy':
      return <path d="M186 270 Q193 264 200 270 Q207 276 214 270" stroke="#c4685e" strokeWidth="4" strokeLinecap="round" fill="none" />
    case 'open-o':
      return <ellipse cx="200" cy="270" rx="8" ry="10" fill="#d96a5e" stroke="#b8554a" strokeWidth="2" />
    case 'tight':
      return <path d="M190 270 Q200 273 210 270" stroke="#b8847a" strokeWidth="3.5" strokeLinecap="round" fill="none" />
    default:
      return <path d="M192 269 Q200 274 208 269" stroke="#c4685e" strokeWidth="4" strokeLinecap="round" fill="none" />
  }
}
