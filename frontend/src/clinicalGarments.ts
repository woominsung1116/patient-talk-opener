export type UpperGarmentState = 'worn' | 'raised' | 'removed'
/**
 * 하의 상태.
 *  - `rolled`  : **바짓단**을 무릎까지 걷어올림 (다리 진찰용)
 *  - `lowered` : **허리선**을 두덩결합 위까지 접어 내림 (복부 진찰용) — 종전에 없던 상태.
 *    공식 평가표의 복부 노출 범위가 "칼돌기~두덩결합"인데 상의만 걷어올리면 배꼽 아래
 *    2분면(rlq·llq)이 통째로 바지 위에 남아, 마른 아바타에서 마커 안에 주머니·벨트고리가 보였다.
 *    3D는 이 값을 허리밴드 클리핑 평면(addendum §4.3 `lowerWaistClipPlane`)의 트리거로 쓴다.
 *  - `removed` : 벗음
 */
export type LowerGarmentState = 'worn' | 'rolled' | 'lowered' | 'removed'
export type RemovableGarmentState = 'worn' | 'removed'

export interface ClinicalGarments {
  upper: UpperGarmentState
  lower: LowerGarmentState
  socks: RemovableGarmentState
  shoes: RemovableGarmentState
  privacyDrape: boolean
}

export const DEFAULT_CLINICAL_GARMENTS: Readonly<ClinicalGarments> = Object.freeze({
  upper: 'worn',
  lower: 'worn',
  socks: 'worn',
  shoes: 'worn',
  privacyDrape: false,
})

export function freshClinicalGarments(): ClinicalGarments {
  return { ...DEFAULT_CLINICAL_GARMENTS }
}

/**
 * 진찰 발화에서 의복 명사와 동작을 직접 읽는다. LLM의 넓은 `drape` intent와
 * 별개로 슬롯을 보존하므로, 상의를 올린 뒤 양말만 벗기는 연속 지시도 안전하다.
 */
export function inferClinicalGarments(
  speech: string,
  current: ClinicalGarments,
  pediatric: boolean,
): ClinicalGarments | null {
  const text = speech.replace(/\s+/g, '')
  if (!text) return null

  if (/(원래대로|처음대로|모든?옷.{0,8}(다시입|입어|착용)|전부.{0,8}(다시입|입어|착용))/.test(text)) {
    return freshClinicalGarments()
  }

  const next: ClinicalGarments = { ...current }
  let matched = false
  const removing = '(?:벗|빼|탈의|제거)'
  const upper = '(?:상의|셔츠|티셔츠|윗옷|겉옷|환자복|가운|옷)'
  const lower = '(?:바지|바짓단|하의|치마)'
  const socks = '(?:양말|스타킹)'
  const shoes = '(?:신발|구두|운동화|슬리퍼)'
  const anyGarment = `(?:${upper}|${lower}|${socks}|${shoes})`
  const anyAction = '(?:벗|빼|탈의|제거|다시입|입어|입혀|착용|내리|내려|덮|다시신|신어|신겨|걷|걷어|올리|올려|말아|들어)'

  const lastMatchIndex = (source: string, value: string): number => {
    let last = -1
    for (const match of value.matchAll(new RegExp(source, 'g'))) last = match.index
    return last
  }

  const matchesEitherOrder = (noun: string, action: string, distance = 9): boolean => {
    // 명사→동사 사이에 다른 동작이 끼면 뒤 동사는 다른 의복 절에 속한다.
    const forward = new RegExp(`${noun}(?<between>.{0,${distance}})${action}`, 'g')
    for (const match of text.matchAll(forward)) {
      if (!new RegExp(anyAction).test(match.groups?.between ?? '')) return true
    }

    // 동사→명사 어순은 동사 직전에 아직 처리되지 않은 다른 의복 명사가 없을 때만 허용한다.
    const reverse = new RegExp(`${action}.{0,${distance}}${noun}`, 'g')
    for (const match of text.matchAll(reverse)) {
      const prefix = text.slice(Math.max(0, match.index - distance * 2), match.index)
      if (lastMatchIndex(anyGarment, prefix) <= lastMatchIndex(anyAction, prefix)) return true
    }
    return false
  }

  // 슬롯별 복구를 먼저 적용해 “셔츠는 내리고 양말은 벗어주세요” 같은 복합 지시도 처리한다.
  const restoreUpper = matchesEitherOrder(upper, '(다시입|입어|입혀|착용|내리|내려|덮)')
  /* ⚠️ 상의와 하의는 **"내리다"의 의미가 정반대다.** 같은 동사 목록을 쓰면 안 된다.
   *   · 상의 "내려주세요"  = 걷어올린 옷을 **다시 덮는다** → 되돌리기
   *   · 하의 "내려주세요"  = 허리선을 **끌어내린다**   → 복부 노출 (되돌리기가 아니다!)
   * 종전에는 `내리|내려`가 하의 되돌리기에도 들어 있어
   * **"바지 좀 내려주세요"가 '바지를 도로 입혀라'로 해석**되고 있었다.
   * `올리|올려`도 되돌리기에 못 쓴다 — "바지 걷어올려주세요"(바짓단 `rolled`)와 충돌한다.
   * 그래서 하의 되돌리기는 **명시적 표현만** 인정한다. 전체 복원은 위쪽 "원래대로" 절이 담당한다. */
  const restoreLower = matchesEitherOrder(lower, '(다시입|입어|입혀|착용)')
  const restoreSocks = matchesEitherOrder(socks, '(다시신|신어|신겨|착용)')
  const restoreShoes = matchesEitherOrder(shoes, '(다시신|신어|신겨|착용)')
  if (restoreUpper) {
    next.upper = 'worn'
    matched = true
  }
  if (restoreLower) {
    next.lower = 'worn'
    matched = true
  }
  if (restoreSocks) {
    next.socks = 'worn'
    matched = true
  }
  if (restoreShoes) {
    next.shoes = 'worn'
    matched = true
  }

  if (!restoreShoes && matchesEitherOrder(shoes, removing)) {
    next.shoes = 'removed'
    matched = true
  }
  if (!restoreSocks && matchesEitherOrder(socks, removing)) {
    next.socks = 'removed'
    matched = true
  }

  /* 하의는 **두 방향**이 있고 서로 다른 진찰을 위한 것이다. 섞으면 안 된다.
   *  · `rolled`  — **바짓단**을 무릎까지 걷어**올림**. 다리·무릎 진찰용
   *  · `lowered` — **허리선**을 두덩결합 위까지 접어 **내림**. 복부 진찰용
   * 평가표의 복부 노출 범위가 "칼돌기~두덩결합"이라 상의만 올려서는 배꼽 아래 2분면이 바지에 남는다.
   * 종전에는 `lowered` 가 "배 좀 볼게요" 류(abdomenExposure)로만 도달했고
   * **"바지 좀 내려주세요" 같은 직접 지시에는 경로가 없었다.** 그걸 잇는다. */
  const waist = '(?:바지|하의|허리|허리선|바지춤|벨트)'
  const lowerLift = new RegExp(
    `${lower}.{0,9}(걷|걷어|올리|올려|말아)|무릎.{0,8}(보이|드러|노출)`,
  ).test(text)
  // "내려/낮춰/조금만내려" — 벗기는 게 아니라 허리선을 낮추라는 지시
  const waistDown = new RegExp(`${waist}.{0,9}(내리|내려|낮춰|낮추)`).test(text)
  // "바짓단 내려주세요" 는 걷어올린 것을 되돌리라는 뜻이다 — 허리선과 반대다
  const cuffDown = /(바짓단|바지단).{0,9}(내리|내려|펴)/.test(text)
  const lowerRemove = !restoreLower && matchesEitherOrder(lower, removing)
  if (cuffDown && current.lower === 'rolled') {
    next.lower = 'worn'
    matched = true
  } else if (lowerLift) {
    next.lower = 'rolled'
    matched = true
  } else if (!restoreLower && waistDown) {
    next.lower = 'lowered'
    matched = true
  } else if (lowerRemove) {
    next.lower = pediatric ? 'rolled' : 'removed'
    matched = true
  }

  const upperLift = new RegExp(
    `${upper}.{0,9}(걷|걷어|올리|올려|들어)|배.{0,8}(보이|드러|노출)`,
  ).test(text)
  const upperRemove = !restoreUpper && matchesEitherOrder(upper, removing)
  if (upperLift) {
    next.upper = 'raised'
    matched = true
  } else if (upperRemove) {
    next.upper = pediatric ? 'raised' : 'removed'
    matched = true
  }

  /* 드레이프/가리개는 학생이 **말해야** 덮인다 — 도구 선택·노출만으로 자동 켜지면
     CPX 채점 항목("가려주기/필요 부위만 노출")을 공짜로 통과시키는 셈이다.
     선언형("~겠습니다")과 요청형("~주세요") 모두 인정한다.
     ⚠ 이 플래그를 아래 "상·하의가 모두 돌아왔을 때 드레이프 끄기" 절보다 먼저 처리하면
       "가려드릴게요" 발화에서 upper/lower 가 worn 채로 남아 auto-off 가 바로 덮어써서
       privacyDrape 가 false 로 리셋되는 문제가 생긴다.
       drapeExplicit 플래그로 이 절이 이번 발화에서 실행됐는지 추적해 auto-off를 막는다. */
  let drapeExplicit = false
  if (/(천.{0,8}(덮|가리|씌)|시트.{0,8}(덮|가리)|가려드|가리개|드레이프|필요부위만|복부만노출)/.test(text)) {
    next.privacyDrape = true
    drapeExplicit = true
    matched = true
  }

  // **배**를 드러내라는 지시는 상의만으로 끝나지 않는다 — 공식 평가표의 복부 노출 범위가
  // "칼돌기~두덩결합"이라 하의 허리선도 함께 내려야 배꼽 아래 2분면이 바지 위에 남지 않는다.
  //  · 복부를 특정한 발화에서만 내린다. 흉부·갑상샘 케이스의 "상의 올려주세요"로 바지를 내리면
  //    하지 않은 노출이 생긴다(가슴만 필요한데 배까지 벗기는 셈).
  //  · 바짓단을 걷어올린 'rolled'이나 벗은 'removed'는 그대로 둔다.
  //  · "바지 다시 입혀주세요"였다면 학생의 명시 지시를 되돌리지 않는다.
  const abdomenExposure = /(배|복부|아랫배|하복부).{0,8}(보이|보겠|볼게|드러|노출|만져|진찰|눌러)/.test(text)
    || /복부만노출/.test(text)
  if (!restoreLower && abdomenExposure && next.lower === 'worn') {
    next.lower = 'lowered'
    if (next.upper === 'worn') next.upper = 'raised'
    matched = true
  }

  // 상·하의가 모두 돌아왔으면 노출용 드레이프는 거둔다. 단, 이번 발화에서 명시적으로
  // 드레이프를 켠 경우(drapeExplicit)는 그대로 둔다 — auto-off가 덮어쓰면 안 된다.
  if (!drapeExplicit && next.upper === 'worn' && next.lower === 'worn') next.privacyDrape = false
  return matched ? next : null
}
