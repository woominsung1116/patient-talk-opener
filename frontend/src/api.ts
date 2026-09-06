import type {
  AvatarAppearance,
  CaseSummary,
  EducationPayload,
  ExamActionResult,
  Report,
  SessionStart,
  TurnResult,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${body}`)
  }
  return res.json()
}

export const api = {
  health: () =>
    request<{ ok: boolean; llm: boolean; stt_loaded: boolean }>('/api/health'),

  listCases: () => request<CaseSummary[]>('/api/cases'),

  saveCaseAppearance: (caseId: string, appearance: AvatarAppearance) =>
    request<AvatarAppearance>(`/api/cases/${caseId}/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appearance),
    }),

  startSession: (caseId: string) =>
    request<SessionStart>('/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: caseId }),
    }),

  sendTurn: (sessionId: string, userText: string) =>
    request<TurnResult>(`/api/session/${sessionId}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_text: userText }),
    }),

  transcribe: async (wav: Blob): Promise<string> => {
    const form = new FormData()
    form.append('audio', wav, 'speech.wav')
    const res = await request<{ text: string }>('/api/audio/transcribe', {
      method: 'POST',
      body: form,
    })
    return res.text
  },

  /**
   * 신체진찰 행위 1건 기록 → 이번 부위의 finding + 누적 요약.
   * region/pass는 부위별로 나눠 찍는 항목(복부 4분면·양측 CVA·촉진 2단계)에서만 보낸다.
   * 빈 값이면 키 자체를 실어 보내지 않는다 — region 없는 기존 호출은 서버에서 종전과 똑같이 처리된다.
   */
  examAction: (
    sessionId: string,
    actionId: string,
    opts?: { region?: string | null; pass?: 'light' | 'deep' | null },
  ) =>
    request<ExamActionResult>(`/api/session/${sessionId}/exam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_id: actionId,
        ...(opts?.region ? { region: opts.region } : {}),
        ...(opts?.pass ? { pass: opts.pass } : {}),
      }),
    }),

  submit: (
    sessionId: string,
    diagnosis: string[],
    tests: string[],
    education?: EducationPayload | null,
    sectionTimes?: Record<string, number> | null,
  ) =>
    request<Report>(`/api/session/${sessionId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagnosis, tests, education: education ?? null, section_times: sectionTimes ?? null }),
    }),

  /** 토킹헤드 영상(음성 포함) 생성 → objectURL. 모델 미설치/실패 시 throw → 호출측에서 TTS 폴백 */
  talk: async (
    text: string,
    gender: string,
    age: number,
    emotion: string,
  ): Promise<string> => {
    const res = await fetch('/api/talk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gender, age, emotion }),
    })
    if (!res.ok) throw new Error(`talk ${res.status}`)
    return URL.createObjectURL(await res.blob())
  },
}
