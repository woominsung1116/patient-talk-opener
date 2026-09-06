import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import { useGame } from '../store'
import type { AvatarAppearance, CaseSummary, ClinicalSkinRegion } from '../types'
import { pickAvatarVariant } from '../three/avatarVariant'
import { ClinicScene } from '../three/ClinicScene'

type PreviewView = 'room' | 'face' | 'eyes' | 'mouth' | 'neck' | 'hands' | 'legs' | 'skin'

const EMPTY_APPEARANCE: AvatarAppearance = {
  pain_level: 0,
  pain_colicky_period: null,
  guarding: 0,
  restlessness: 0,
  scleral_icterus: 0,
  skin_jaundice: 0,
  conjunctival_pallor: 0,
  cyanosis: 0,
  diaphoresis: 0,
  sclera_color: '#d9c775',
  skin_tint_color: '#d7b84a',
  conjunctiva_color: '#e8c4bd',
  goiter: false,
  atrophic_glossitis: false,
  finger_swelling_left: 0,
  finger_swelling_right: 0,
  leg_edema_left: 0,
  leg_edema_right: 0,
  rash_level: 0,
  rash_region: 'torso',
  rash_color: '#b94a55',
  bruise_level: 0,
  bruise_region: 'left_leg',
  bruise_color: '#59456f',
}

const PRESETS: { label: string; note: string; values: Partial<AvatarAppearance>; view: PreviewView }[] = [
  {
    label: '요로결석 산통',
    note: 'NRS 9–10 · 몸부림 · 복부 방어',
    view: 'room',
    values: { pain_level: 0.97, pain_colicky_period: 13, guarding: 0.9, restlessness: 1 },
  },
  {
    label: '급성 황달',
    note: '공막 우선 · 피부는 한 단계 약하게',
    view: 'eyes',
    values: { scleral_icterus: 0.86, skin_jaundice: 0.58 },
  },
  {
    label: '철결핍성 빈혈',
    note: '아래눈꺼풀 결막 창백 · 설염',
    view: 'eyes',
    values: { conjunctival_pallor: 0.9, atrophic_glossitis: true },
  },
  {
    label: '갑상샘 종대',
    note: '목 시진 · 연하 시 함께 움직임',
    view: 'neck',
    values: { goiter: true },
  },
  {
    label: '손가락 관절염',
    note: '양측 PIP·MCP 관절 주위 부종',
    view: 'hands',
    values: { finger_swelling_left: 0.82, finger_swelling_right: 0.74 },
  },
  {
    label: '일측 하지부종',
    note: '환자 왼쪽 종아리만 비대칭 부종',
    view: 'legs',
    values: { leg_edema_left: 0.92, leg_edema_right: 0 },
  },
  {
    label: '발진·반상출혈',
    note: '몸통 홍반성 발진 · 오른팔 멍',
    view: 'skin',
    values: {
      rash_level: 0.82,
      rash_region: 'torso',
      bruise_level: 0.68,
      bruise_region: 'right_arm',
    },
  },
]

const SKIN_REGIONS: { id: ClinicalSkinRegion; label: string }[] = [
  { id: 'face', label: '얼굴' },
  { id: 'torso', label: '몸통' },
  { id: 'left_arm', label: '왼팔' },
  { id: 'right_arm', label: '오른팔' },
  { id: 'left_leg', label: '왼다리' },
  { id: 'right_leg', label: '오른다리' },
]

const withAppearanceDefaults = (appearance?: AvatarAppearance): AvatarAppearance => ({
  ...EMPTY_APPEARANCE,
  ...(appearance ?? {}),
})

export function PatientAppearanceEditor({ onClose }: { onClose: () => void }) {
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<AvatarAppearance>(EMPTY_APPEARANCE)
  const [baseline, setBaseline] = useState<AvatarAppearance>(EMPTY_APPEARANCE)
  const [view, setView] = useState<PreviewView>('room')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previousExamState = useRef<Pick<ReturnType<typeof useGame.getState>, 'examPose' | 'examGesture' | 'examTool' | 'uiHold' | 'clinicalGarments'> | null>(null)

  useEffect(() => {
    void api.listCases().then((loaded) => {
      setCases(loaded)
      const first = loaded.find((item) => item.case_id.includes('urolithiasis')) ?? loaded[0]
      if (first) {
        const next = structuredClone(withAppearanceDefaults(first.patient.appearance))
        setSelectedId(first.case_id)
        setDraft(next)
        setBaseline(structuredClone(next))
        setView(next.scleral_icterus > 0 || next.conjunctival_pallor > 0 ? 'eyes' : 'room')
      }
    }).catch(() => setError('증례를 불러오지 못했습니다. 백엔드 연결을 확인해주세요.'))
  }, [])

  useEffect(() => {
    const current = useGame.getState()
    previousExamState.current = {
      examPose: current.examPose,
      examGesture: current.examGesture,
      examTool: current.examTool,
      uiHold: current.uiHold,
      clinicalGarments: current.clinicalGarments,
    }
    return () => {
      if (previousExamState.current) useGame.setState(previousExamState.current)
    }
  }, [])

  useEffect(() => {
    const gesture = view === 'eyes' ? 'eyes_up'
      : view === 'mouth' ? 'mouth_open'
        : view === 'neck' ? 'swallow'
          : view === 'hands' ? 'hands_out'
          : null
    const original = previousExamState.current?.clinicalGarments ?? useGame.getState().clinicalGarments
    const activeSkinRegion = draft.rash_level >= draft.bruise_level ? draft.rash_region : draft.bruise_region
    const showHands = view === 'hands'
    const showLegs = view === 'legs' || (view === 'skin' && activeSkinRegion.endsWith('_leg'))
    const showTorsoSkin = view === 'skin' && activeSkinRegion === 'torso'
    useGame.setState({
      examPose: showHands || showLegs || showTorsoSkin ? 'sit_edge' : 'sit',
      examGesture: gesture,
      examTool: view === 'hands' ? 'tremor_exam' : null,
      uiHold: true,
      clinicalGarments: showLegs
        ? { ...original, lower: 'rolled', socks: 'removed', shoes: 'removed', privacyDrape: false }
        : showTorsoSkin
          ? { ...original, upper: 'raised', privacyDrape: false }
          : { ...original },
    })
  }, [view, draft.rash_level, draft.rash_region, draft.bruise_level, draft.bruise_region])

  const selected = cases.find((item) => item.case_id === selectedId) ?? null
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const filtered = cases.filter((item) => {
    const text = `${item.patient.name} ${item.title} ${item.diagnosis_label ?? ''}`.toLowerCase()
    return text.includes(query.trim().toLowerCase())
  })
  const variant = selected
    ? pickAvatarVariant(
        selected.patient.name,
        selected.patient.gender,
        selected.patient.age,
        selected.patient.body_type,
      )
    : null

  function selectCase(item: CaseSummary, first = false) {
    if (!first && dirty && !window.confirm('저장하지 않은 변경사항을 버리고 다른 환자를 여시겠습니까?')) return
    const next = structuredClone(withAppearanceDefaults(item.patient.appearance))
    setSelectedId(item.case_id)
    setDraft(next)
    setBaseline(structuredClone(next))
    setSaved(false)
    setError(null)
    setView(next.scleral_icterus > 0 || next.conjunctival_pallor > 0 ? 'eyes' : 'room')
  }

  function patch(next: Partial<AvatarAppearance>) {
    setSaved(false)
    setDraft((current) => ({ ...current, ...next }))
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    patch(preset.values)
    setView(preset.view)
  }

  async function save() {
    if (!selected || saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await api.saveCaseAppearance(selected.case_id, draft)
      setDraft(result)
      setBaseline(structuredClone(result))
      setCases((items) => items.map((item) => item.case_id === selected.case_id
        ? { ...item, patient: { ...item.patient, appearance: result } }
        : item))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } catch {
      setError('저장하지 못했습니다. 백엔드가 실행 중인지 확인해주세요.')
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    if (dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 편집기를 닫을까요?')) return
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex flex-col bg-[#f4f6f7] text-[#27313a]"
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#dfe5e8] bg-white px-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#1b6f5a] text-white shadow-sm">
            <PatientGlyph />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[20px] tracking-tight">환자 연출 스튜디오</h1>
              <span className="rounded-full bg-[#e7f4ef] px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-[#27715e]">교수자 도구</span>
            </div>
            <p className="text-[11px] text-[#7b8790]">임상 소견과 행동을 조절하고 실제 진료실에서 바로 확인합니다.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="mr-2 text-[12px] text-[#a46b2c]">저장되지 않은 변경</span>}
          <button onClick={() => { setDraft(structuredClone(baseline)); setSaved(false) }} disabled={!dirty}
            className="rounded-lg border border-[#d9e0e4] px-4 py-2 text-[13px] disabled:opacity-35">되돌리기</button>
          <button onClick={() => void save()} disabled={!selected || saving || !dirty}
            className="min-w-24 rounded-lg bg-[#1b6f5a] px-4 py-2 text-[13px] font-bold text-white shadow-sm disabled:bg-[#aab7b3]">
            {saving ? '저장 중…' : saved ? '저장 완료' : '증례에 저장'}
          </button>
          <button onClick={close} aria-label="닫기" className="ml-1 grid h-9 w-9 place-items-center rounded-lg text-xl text-[#6f7a82] hover:bg-[#eef1f3]">×</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-[#dfe5e8] bg-white">
          <div className="border-b border-[#edf0f2] p-4">
            <label className="relative block">
              <span className="pointer-events-none absolute left-3 top-2.5 text-[#8b969e]">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="환자·진단 검색"
                className="w-full rounded-lg border border-[#dce3e6] bg-[#f8fafb] py-2 pl-8 pr-3 text-[13px] outline-none focus:border-[#57a28e]" />
            </label>
          </div>
          <div className="nice-scroll flex-1 overflow-y-auto p-2">
            <div className="px-2 pb-2 pt-1 text-[10px] font-bold tracking-[0.16em] text-[#95a0a7]">증례 {filtered.length}</div>
            {filtered.map((item) => {
              const active = item.case_id === selectedId
              return (
                <button key={item.case_id} onClick={() => selectCase(item)}
                  className={`mb-1 w-full rounded-xl border px-3 py-3 text-left transition ${active ? 'border-[#7ebba9] bg-[#eaf5f1]' : 'border-transparent hover:bg-[#f3f6f7]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-[14px] text-[#27313a]">{item.patient.name}</span>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-[#7c878e]">{item.patient.age}세 · {item.patient.gender === 'female' ? '여' : '남'}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#77838b]">{item.diagnosis_label || item.subtitle}</p>
                  <div className="mt-2 flex gap-1">
                    {(item.patient.appearance?.pain_level ?? 0) > 0.2 && <MiniTag color="red">통증</MiniTag>}
                    {(item.patient.appearance?.scleral_icterus ?? 0) > 0.1 && <MiniTag color="amber">황달</MiniTag>}
                    {(item.patient.appearance?.conjunctival_pallor ?? 0) > 0.1 && <MiniTag color="blue">결막</MiniTag>}
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-[#e8edef]">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#d7dfe2] bg-white px-4">
            <div>
              <span className="font-display text-[15px]">{selected?.patient.name ?? '환자 선택'}</span>
              {selected && <span className="ml-2 text-[11px] text-[#849099]">{selected.title}</span>}
            </div>
            <div className="flex rounded-lg bg-[#eef2f3] p-1">
              {([
                ['room', '진료실'], ['face', '얼굴'], ['eyes', '눈·결막'], ['mouth', '구강'], ['neck', '목'],
                ['hands', '손·관절'], ['legs', '다리'], ['skin', '피부'],
              ] as [PreviewView, string][]).map(([id, label]) => (
                <button key={id} onClick={() => setView(id)}
                  className={`rounded-md px-3 py-1.5 text-[11px] transition ${view === id ? 'bg-white font-bold text-[#1b6f5a] shadow-sm' : 'text-[#718089]'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[#283238]">
            {selected && variant ? (
              <ClinicScene
                entering={false}
                onEnterComplete={() => {}}
                emotion={draft.pain_level > 0.45 ? 'hurt' : 'neutral'}
                speaking={false}
                variant={variant}
                examMode={view !== 'room'}
                patientAge={selected.patient.age}
                patientIdentity={`creator-${selected.case_id}`}
                patientAppearance={draft}
                examPose={(view === 'hands' || view === 'legs' || (view === 'skin'
                  && ((draft.rash_level >= draft.bruise_level ? draft.rash_region : draft.bruise_region) === 'torso'
                    || (draft.rash_level >= draft.bruise_level ? draft.rash_region : draft.bruise_region).endsWith('_leg'))))
                  ? 'sit_edge'
                  : 'sit'}
                previewFocus={view === 'skin'
                  && (draft.rash_level >= draft.bruise_level ? draft.rash_region : draft.bruise_region) === 'face'
                  ? 'face'
                  : view}
              />
            ) : <div className="grid h-full place-items-center text-sm text-white/60">환자를 불러오는 중…</div>}
            <div className="pointer-events-none absolute bottom-4 left-4 rounded-xl border border-white/10 bg-[#142026]/75 px-3 py-2 text-[11px] text-white/80 backdrop-blur-md">
              <div className="font-bold text-white">실제 진료실 렌더</div>
              <div className="mt-0.5">학생이 보게 될 조명·카메라·자세로 미리보기 중</div>
            </div>
            {draft.pain_colicky_period && draft.pain_level > 0 && (
              <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-[#8f3f35]/90 px-3 py-1.5 text-[11px] text-white shadow-lg">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffd0c9]" /> 산통 파고 {draft.pain_colicky_period}초
              </div>
            )}
          </div>
        </main>

        <aside className="nice-scroll w-[390px] shrink-0 overflow-y-auto border-l border-[#dfe5e8] bg-white">
          <div className="border-b border-[#e7ecee] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold tracking-[0.16em] text-[#8c979e]">임상 프리셋</div>
                <div className="mt-0.5 text-[12px] text-[#5e6a72]">기존 설정 위에 필요한 소견만 추가합니다.</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button key={preset.label} onClick={() => applyPreset(preset)} className="rounded-xl border border-[#dde5e7] p-2.5 text-left hover:border-[#73ae9e] hover:bg-[#f3faf7]">
                  <div className="text-[12px] font-bold text-[#334048]">{preset.label}</div>
                  <div className="mt-1 text-[10px] leading-snug text-[#849098]">{preset.note}</div>
                </button>
              ))}
            </div>
          </div>

          <EditorSection title="통증과 행동" subtitle="얼굴과 전신 자세가 함께 바뀝니다." icon="⌁">
            <RangeControl label="통증 강도" value={draft.pain_level} onChange={(pain_level) => patch({ pain_level })} labels={['무통', '중등도', '극심']} danger />
            <div className="mb-4 flex items-center justify-between rounded-xl border border-[#e3e8ea] bg-[#f8fafb] px-3 py-2.5">
              <div><div className="text-[12px] font-bold">산통 파고</div><div className="text-[10px] text-[#839098]">주기적으로 몰려왔다 잦아듦</div></div>
              <Toggle checked={draft.pain_colicky_period !== null} onChange={(on) => patch({ pain_colicky_period: on ? 13 : null })} />
            </div>
            {draft.pain_colicky_period !== null && <RangeControl label="파고 주기" value={(draft.pain_colicky_period - 4) / 36} onChange={(v) => patch({ pain_colicky_period: Math.round(4 + v * 36) })} valueLabel={`${draft.pain_colicky_period}초`} />}
            <RangeControl label="방어 자세" value={draft.guarding} onChange={(guarding) => patch({ guarding })} labels={['이완', '웅크림', '강함']} />
            <RangeControl label="안절부절·몸부림" value={draft.restlessness} onChange={(restlessness) => patch({ restlessness })} labels={['정적', '불편', '심함']} />
          </EditorSection>

          <EditorSection title="눈과 피부색" subtitle="슬라이더는 정도, 색상은 미세조정입니다." icon="◉">
            <RangeControl label="공막 황달" value={draft.scleral_icterus} onChange={(scleral_icterus) => { patch({ scleral_icterus }); if (scleral_icterus > 0.05) setView('eyes') }} labels={['정상', '경도', '뚜렷']} color={draft.sclera_color} onColor={(sclera_color) => patch({ sclera_color })} />
            <RangeControl label="피부 황달" value={draft.skin_jaundice} onChange={(skin_jaundice) => patch({ skin_jaundice })} labels={['정상', '경도', '뚜렷']} color={draft.skin_tint_color} onColor={(skin_tint_color) => patch({ skin_tint_color })} />
            <RangeControl label="결막 창백" value={draft.conjunctival_pallor} onChange={(conjunctival_pallor) => { patch({ conjunctival_pallor }); if (conjunctival_pallor > 0.05) setView('eyes') }} labels={['정상', '창백', '심함']} color={draft.conjunctiva_color} onColor={(conjunctiva_color) => patch({ conjunctiva_color })} />
            <RangeControl label="청색증" value={draft.cyanosis} onChange={(cyanosis) => patch({ cyanosis })} labels={['없음', '경도', '뚜렷']} />
            <RangeControl label="발한" value={draft.diaphoresis} onChange={(diaphoresis) => patch({ diaphoresis })} labels={['건조', '촉촉', '식은땀']} />
          </EditorSection>

          <EditorSection title="국소 소견" subtitle="진찰 자세에서 구조적 소견을 확인합니다." icon="＋">
            <ToggleRow label="갑상샘 종대" note="목 시진·연하에서 확인" checked={draft.goiter} onChange={(goiter) => { patch({ goiter }); if (goiter) setView('neck') }} />
            <ToggleRow label="위축성 설염" note="구강검사에서 매끈한 혀" checked={draft.atrophic_glossitis} onChange={(atrophic_glossitis) => { patch({ atrophic_glossitis }); if (atrophic_glossitis) setView('mouth') }} />
          </EditorSection>

          <EditorSection title="관절·부종" subtitle="환자 기준 좌우를 독립적으로 조절합니다." icon="↔">
            <div className="mb-2 text-[10px] font-bold tracking-[0.12em] text-[#839098]">손가락 관절</div>
            <RangeControl label="왼손 손가락 부종" value={draft.finger_swelling_left} onChange={(finger_swelling_left) => { patch({ finger_swelling_left }); setView('hands') }} labels={['없음', '경도', '심함']} />
            <RangeControl label="오른손 손가락 부종" value={draft.finger_swelling_right} onChange={(finger_swelling_right) => { patch({ finger_swelling_right }); setView('hands') }} labels={['없음', '경도', '심함']} />
            <div className="mb-2 mt-1 text-[10px] font-bold tracking-[0.12em] text-[#839098]">하지 비대칭</div>
            <RangeControl label="왼쪽 다리 부종" value={draft.leg_edema_left} onChange={(leg_edema_left) => { patch({ leg_edema_left }); setView('legs') }} labels={['없음', '경도', '심함']} />
            <RangeControl label="오른쪽 다리 부종" value={draft.leg_edema_right} onChange={(leg_edema_right) => { patch({ leg_edema_right }); setView('legs') }} labels={['없음', '경도', '심함']} />
            <p className="-mt-1 text-[10px] leading-relaxed text-[#87939a]">바짓단·양말·신발을 걷은 진찰 화면에서 양쪽 종아리 윤곽을 비교합니다.</p>
          </EditorSection>

          <EditorSection title="피부 소견" subtitle="발진과 멍의 부위·강도·색을 각각 저장합니다." icon="◌">
            <RangeControl label="발진" value={draft.rash_level} onChange={(rash_level) => { patch({ rash_level }); setView('skin') }} labels={['없음', '산재', '뚜렷']} color={draft.rash_color} onColor={(rash_color) => patch({ rash_color })} />
            <RegionControl value={draft.rash_region} onChange={(rash_region) => { patch({ rash_region }); setView(rash_region.includes('leg') ? 'legs' : 'skin') }} />
            <div className="my-4 border-t border-[#edf0f2]" />
            <RangeControl label="멍·반상출혈" value={draft.bruise_level} onChange={(bruise_level) => { patch({ bruise_level }); setView('skin') }} labels={['없음', '경도', '뚜렷']} color={draft.bruise_color} onColor={(bruise_color) => patch({ bruise_color })} />
            <RegionControl value={draft.bruise_region} onChange={(bruise_region) => { patch({ bruise_region }); setView(bruise_region.includes('leg') ? 'legs' : 'skin') }} />
          </EditorSection>
          <div className="h-8" />
        </aside>
      </div>

      <AnimatePresence>
        {error && (
          <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={() => setError(null)}
            className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-xl bg-[#8f3f35] px-5 py-3 text-[12px] text-white shadow-xl">
            {error}
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function EditorSection({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: string; children: ReactNode }) {
  return (
    <section className="border-b border-[#e7ecee] p-4">
      <div className="mb-4 flex items-start gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#eaf4f1] text-[14px] text-[#28735f]">{icon}</span>
        <div><h2 className="text-[13px] font-bold">{title}</h2><p className="mt-0.5 text-[10px] text-[#87939a]">{subtitle}</p></div>
      </div>
      {children}
    </section>
  )
}

function RangeControl({ label, value, onChange, labels, valueLabel, danger, color, onColor }: {
  label: string
  value: number
  onChange: (value: number) => void
  labels?: [string, string, string]
  valueLabel?: string
  danger?: boolean
  color?: string
  onColor?: (color: string) => void
}) {
  const percent = Math.round(value * 100)
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-bold text-[#46535b]">{label}</span>
        <div className="flex items-center gap-2">
          {color && onColor && <input type="color" value={color} onChange={(event) => onColor(event.target.value)} title={`${label} 색상`} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" />}
          <span className={`min-w-11 rounded-md px-1.5 py-0.5 text-center text-[10px] font-bold tabular-nums ${danger && percent >= 75 ? 'bg-[#f8dfdb] text-[#a3463a]' : 'bg-[#eef2f3] text-[#637078]'}`}>{valueLabel ?? `${percent}%`}</span>
        </div>
      </div>
      <input type="range" min={0} max={100} value={percent} onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="clinical-range w-full" style={{ '--range-color': danger ? '#c95b4c' : color ?? '#2b8a70', '--range-value': `${percent}%` } as CSSProperties} />
      {labels && <div className="mt-1 flex justify-between text-[9px] text-[#97a1a7]"><span>{labels[0]}</span><span>{labels[1]}</span><span>{labels[2]}</span></div>}
    </div>
  )
}

function ToggleRow({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="mb-2 flex items-center justify-between rounded-xl border border-[#e3e8ea] px-3 py-2.5"><div><div className="text-[12px] font-bold">{label}</div><div className="text-[10px] text-[#849098]">{note}</div></div><Toggle checked={checked} onChange={onChange} /></div>
}

function RegionControl({ value, onChange }: { value: ClinicalSkinRegion; onChange: (value: ClinicalSkinRegion) => void }) {
  return (
    <div className="-mt-1 mb-2">
      <div className="mb-2 text-[10px] font-bold text-[#839098]">표시 부위</div>
      <div className="grid grid-cols-3 gap-1.5">
        {SKIN_REGIONS.map((region) => (
          <button key={region.id} type="button" onClick={() => onChange(region.id)}
            className={`rounded-lg border px-2 py-1.5 text-[10px] transition ${value === region.id ? 'border-[#63a893] bg-[#eaf5f1] font-bold text-[#226a57]' : 'border-[#e0e6e8] text-[#748088] hover:bg-[#f5f8f8]'}`}>
            {region.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-[#2b8a70]' : 'bg-[#c9d1d5]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} /></button>
}

function MiniTag({ children, color }: { children: ReactNode; color: 'red' | 'amber' | 'blue' }) {
  const cls = color === 'red' ? 'bg-[#f9e5e2] text-[#a14a3e]' : color === 'amber' ? 'bg-[#fbf0d8] text-[#96691e]' : 'bg-[#e4edf6] text-[#4b7193]'
  return <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${cls}`}>{children}</span>
}

function PatientGlyph() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="7" r="3" /><path d="M5.5 20c.5-5 2.6-7.3 6.5-7.3s6 2.3 6.5 7.3" /><path d="M9 17h6M12 14v6" /></svg>
}
