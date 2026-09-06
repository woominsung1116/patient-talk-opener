/**
 * 혼합 아바타 풀 — RenderPeople(포토리얼) + Rocketbox(실사) 두 종류를 섞는다.
 * 케이스별로 결정적(deterministic): 같은 환자 이름은 항상 같은 아바타를 받는다.
 */
import type { RPVariant } from './RenderPeoplePatient'
import type { CharacterVariant } from '../components/PatientCharacter'

/* VALID(Validated Avatar Library, MIT) 아시아 아바타 — /avatars/valid_*.glb. (폴백용) */
export type ValidVariant = 'af1' | 'af2' | 'af3' | 'am1' | 'am2' | 'am3'

/* MPFB(MakeHuman, CC0) 자동생성 아시아 아바타 — /avatars/mh_*.glb.
   20~70대 남녀 한 쌍씩 12종. 얼굴(눈·눈썹) + 헤어 + 옷(별도 CLOTHING 메시 → 배 노출 가능).
   game_engine 골격. 아동 아바타 없음 — 소아 케이스는 보호자(성인) 대리 문진으로 진행. */
export type MpfbVariant =
  | 'mh_boy' | 'mh_girl'  // 아동 (소아 직접 문진 케이스용)
  | 'mh_m20' | 'mh_f20' | 'mh_m30' | 'mh_f30' | 'mh_m40' | 'mh_f40'
  | 'mh_m50' | 'mh_f50' | 'mh_m60' | 'mh_f60' | 'mh_m70' | 'mh_f70'
  | 'mh_f60_ob' | 'mh_f30_thin' | 'mh_f20_thin'  // 체형 변형 (비만/마름 — 진단 단서)
  | 'mh_youngm' | 'mh_youngf' | 'mh_oldm' | 'mh_oldf'  // 임시 레거시 (12인 배포 전)

/* 아바타 시스템 variant 합집합 */
export type AvatarVariant = RPVariant | CharacterVariant | ValidVariant | MpfbVariant

const ROCKETBOX: ReadonlySet<string> = new Set<CharacterVariant>(['jieun', 'sujin', 'hyunwoo'])
const VALID: ReadonlySet<string> = new Set<ValidVariant>(['af1', 'af2', 'af3', 'am1', 'am2', 'am3'])
const RENDERPEOPLE: ReadonlySet<string> = new Set<RPVariant>(['carla', 'eric', 'claudia'])
export const MPFB_ALL: readonly MpfbVariant[] = [
  'mh_m20', 'mh_f20', 'mh_m30', 'mh_f30', 'mh_m40', 'mh_f40',
  'mh_m50', 'mh_f50', 'mh_m60', 'mh_f60', 'mh_m70', 'mh_f70',
]
const MPFB: ReadonlySet<string> = new Set<MpfbVariant>([...MPFB_ALL, 'mh_boy', 'mh_girl', 'mh_youngm', 'mh_youngf', 'mh_oldm', 'mh_oldf', 'mh_f60_ob', 'mh_f30_thin', 'mh_f20_thin'])

/* 생성돼 있는 체형 변형 — 케이스 patient.body_type('ob'|'thin')이 있고 해당 변형이 있으면 사용 */
const BODY_VARIANTS: ReadonlySet<string> = new Set(['mh_f60_ob', 'mh_f30_thin', 'mh_f20_thin'])

/* 12인 GLB 배포 완료 후 true로 — false면 기존 6종 파일로 폴백 */
const TWELVE_READY = true

export function isRocketbox(v: AvatarVariant): v is CharacterVariant {
  return ROCKETBOX.has(v)
}
export function isValid(v: AvatarVariant): v is ValidVariant {
  return VALID.has(v)
}
export function isMpfb(v: AvatarVariant): v is MpfbVariant {
  return MPFB.has(v)
}
/* 본 리그 기반 실사 아바타(RealisticPatient로 렌더) = Rocketbox/VALID/MPFB. */
export function usesBoneRig(v: AvatarVariant): v is CharacterVariant | ValidVariant | MpfbVariant {
  return isRocketbox(v) || isValid(v) || isMpfb(v)
}

/** 개발용 시각 회귀 테스트에서만 URL의 ?av= 값을 안전하게 아바타로 변환한다. */
export function debugAvatarVariant(value: string | null): AvatarVariant | null {
  if (!value) return null
  if (RENDERPEOPLE.has(value) || ROCKETBOX.has(value) || VALID.has(value) || MPFB.has(value)) {
    return value as AvatarVariant
  }
  return null
}

/* 환자 성별 + 나이 → 10년 단위 연령대 아바타 (20~70대 남녀쌍 12종).
   20세 미만은 20대로, 80세 이상은 70대로 클램프. */
export function pickAvatarVariant(_name: string, gender: string, age?: number, bodyType?: string | null): AvatarVariant {
  const a = age ?? 30
  const g = gender === 'male' ? 'm' : 'f'
  if (a <= 14) return g === 'm' ? 'mh_boy' : 'mh_girl'
  if (bodyType) {
    const decade0 = Math.min(70, Math.max(20, Math.floor(a / 10) * 10))
    const cand = `mh_${g}${decade0}_${bodyType}`
    if (BODY_VARIANTS.has(cand)) return cand as MpfbVariant
  }
  if (!TWELVE_READY) {
    if (a >= 60) return g === 'm' ? 'mh_oldm' : 'mh_oldf'
    return g === 'm' ? 'mh_youngm' : 'mh_youngf'
  }
  const decade = Math.min(70, Math.max(20, Math.floor(a / 10) * 10))
  return `mh_${g}${decade}` as MpfbVariant
}
