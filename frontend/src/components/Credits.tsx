/**
 * 출처 및 라이선스 화면.
 *
 * ⚠️ 이 화면은 장식이 아니라 **라이선스 의무 이행**이다.
 * CC-BY 계열 에셋은 저작자 표기가 **최종 사용자에게 보이는 곳**에 있어야 요건을 충족한다.
 * 소스 주석이나 저장소의 CREDITS.md 는 사용자에게 보이지 않으므로 요건을 만족하지 못한다.
 *
 * 아래 내용의 근거(단일 진실):
 *   - `public/sounds/exam/CREDITS.md`  — 청진음, MakeHuman 헤어·의상
 *   - `public/avatars/CREDITS.md`      — 아바타 4계열
 *   - `public/models/CREDITS.md`       — 소품·텍스처
 *   - `public/avatars/skin/LICENSE.md` — 피부 텍스처
 *   - `docs/specs/2026-07-25-asset-license-audit.md` — 전수 감사
 *
 * 에셋을 추가·교체하면 **위 문서를 먼저 갱신하고 여기에 반영**하라.
 * 확인되지 않은 라이선스를 추측해서 적지 마라 — 틀린 표기는 없는 것보다 나쁘다.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { T } from '../ui/theme'

interface Entry {
  /** 무엇에 쓰이는지 — 사용자가 이해할 수 있는 말로 */
  use: string
  /** 저작자 표기 문구 */
  credit: string
  license: string
  url?: string
}

/** CC-BY / MIT — **표기가 의무인 것**. 지우지 마라. */
const REQUIRED: Entry[] = [
  {
    use: '심음·폐음',
    credit: 'HLS-CMDS dataset — Y. Torabi et al.',
    license: 'CC BY 4.0',
    url: 'https://github.com/torabiy/hls-cmds',
  },
  {
    use: '환자 머리 모델',
    credit: '"maxwell hair", "grump hair", "wavy bob" — Elvaerwyn / "alpha7 long" — punkduck (MakeHuman Community)',
    license: 'CC BY',
    url: 'http://www.makehumancommunity.org',
  },
  {
    use: '환자 의상',
    credit: '"old female sweater" — janexx / "jeans straight leg" — Elvaerwyn (MakeHuman Community)',
    license: 'CC BY',
    url: 'http://www.makehumancommunity.org',
  },
  {
    use: '환자 의상 (바지)',
    credit: '"female trousers" — Mindfront (MakeHuman Community)',
    license: 'CC BY 4.0',
    url: 'http://www.makehumancommunity.org',
  },
  {
    use: '아바타 일부',
    credit: 'Microsoft Rocketbox Avatar Library',
    license: 'MIT',
    url: 'https://github.com/microsoft/Microsoft-Rocketbox',
  },
]

/** CC0 — 표기 의무는 없으나 감사의 뜻으로 남긴다. */
const COURTESY: Entry[] = [
  {
    use: '환자 아바타·피부',
    credit: 'MakeHuman / MPFB system assets',
    license: 'CC0 1.0',
    url: 'http://www.makehumancommunity.org',
  },
  {
    use: '진료실 소품',
    credit: 'Poly Haven',
    license: 'CC0 1.0',
    url: 'https://polyhaven.com',
  },
  {
    use: '재질 텍스처',
    credit: 'ambientCG',
    license: 'CC0 1.0',
    url: 'https://ambientcg.com',
  },
  { use: '장음(창자소리)', credit: 'freesound.org — borygmi', license: 'CC0 1.0' },
]

/** 자체 제작 — 참고용. */
const OWN = '타진음 · 환경음 · 설압자 · 펜라이트 · 진찰 손 5종은 자체 제작이다.'

export function Credits({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/45" />
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-[6px] border shadow-[0_18px_50px_rgba(30,22,12,0.5)]"
            style={{ background: T.paper, borderColor: T.line }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-2.5"
              style={{ borderColor: T.line2, background: T.header }}
            >
              <span className="text-[10px] font-bold tracking-[0.22em]" style={{ color: T.faint }}>
                출처 및 라이선스
              </span>
              <button
                onClick={onClose}
                aria-label="닫기"
                className="rounded px-2 py-0.5 text-[13px] transition hover:bg-[rgba(226,230,234,0.5)]"
                style={{ color: T.faint }}
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              <Section title="저작자 표기" note="아래 에셋은 라이선스상 출처 표기가 필요하다.">
                {REQUIRED.map((e) => (
                  <Row key={e.use + e.credit} entry={e} />
                ))}
              </Section>

              <Section title="퍼블릭 도메인 (CC0)" note="표기 의무는 없으나 감사의 뜻으로 남긴다.">
                {COURTESY.map((e) => (
                  <Row key={e.use + e.credit} entry={e} />
                ))}
              </Section>

              <p className="mt-5 text-[12px] leading-relaxed" style={{ color: T.faint }}>
                {OWN}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-6 last:mb-0">
      <div className="mb-1 text-[13px] font-semibold" style={{ color: T.ink }}>
        {title}
      </div>
      <div className="mb-3 text-[11px]" style={{ color: T.faint }}>
        {note}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Row({ entry }: { entry: Entry }) {
  return (
    <div className="border-l-2 pl-3" style={{ borderColor: T.line }}>
      <div className="flex items-baseline gap-2">
        <span className="text-[12px]" style={{ color: T.inkSoft }}>
          {entry.use}
        </span>
        <span className="font-display text-[10px] tracking-wider" style={{ color: T.slate }}>
          {entry.license}
        </span>
      </div>
      <div className="mt-0.5 text-[12px] leading-snug" style={{ color: T.ink }}>
        {entry.credit}
      </div>
      {entry.url && (
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-0.5 inline-block text-[11px] underline decoration-dotted underline-offset-2 transition hover:opacity-70"
          style={{ color: T.faint }}
        >
          {entry.url}
        </a>
      )}
    </div>
  )
}
