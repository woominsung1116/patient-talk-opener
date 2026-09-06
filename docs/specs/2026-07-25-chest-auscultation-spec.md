# 흉부 진찰 (심장·폐 청진) — 구현 계약 (2026-07-25)

선행: `2026-07-25-physical-exam-fidelity-spec.md`(부위 시스템), `2026-07-25-exam-region-anchoring-addendum.md`(본 기준 앵커)
**이 두 작업이 끝난 뒤 착수한다.** 여기서 만드는 흉부 부위는 그 부위 시스템 위에 얹힌다.

근거: `신체진찰평가_2026 (1).xlsx` Sheet2 — 심장청진 / 흉부청진 / 흉부타진 항목.

---

## 1. 공식 평가표가 요구하는 것 (그대로 옮김)

**심장청진**
1. 앉은 자세에서 상의 노출
2. 심장 주변 위치 **4곳** 청진
   - 대동맥판 — 오른쪽 2번째 갈비사이
   - 폐동맥판 — 왼쪽 복장뼈옆 2번째 갈비사이
   - 삼첨판 — 왼쪽 5번째 갈비사이
   - 승모판 — 심장끝(심첨)
3. 한 군데서 **3초 이상** 청진

**흉부청진**
1. 앉은 자세에서 상의노출
2. **숨을 크게 쉬라고 말함**
3. 상·중·하 **6군데 이상** 청진
4. **좌우 대칭적으로**
5. **전면과 후면 모두**
6. 들숨과 날숨을 유도하여 끝까지 듣고 시행

**흉부타진** — 앉은 자세 / 상·중·하 6군데 이상 / 좌우 대칭 / 전면·후면 모두

---

## 2. region 확장

기존 `ExamRegion`(복부 4분면 + 옆구리 2)에 흉부를 추가한다.

```ts
export type ExamRegion =
  // 기존
  | 'ruq' | 'luq' | 'rlq' | 'llq' | 'flank_r' | 'flank_l'
  // 심장 판막 4곳
  | 'aortic' | 'pulmonic' | 'tricuspid' | 'mitral'
  // 폐야 — 전면 좌우 상·중·하 (6)
  | 'lung_ant_r_up' | 'lung_ant_r_mid' | 'lung_ant_r_low'
  | 'lung_ant_l_up' | 'lung_ant_l_mid' | 'lung_ant_l_low'
  // 폐야 — 후면 좌우 상·중·하 (6)
  | 'lung_post_r_up' | 'lung_post_r_mid' | 'lung_post_r_low'
  | 'lung_post_l_up' | 'lung_post_l_mid' | 'lung_post_l_low'
```

도구 추가:

```ts
export type ExamToolId =
  | 'auscultation' | 'percussion' | 'palpation' | 'cva_tenderness'   // 기존
  | 'heart_auscultation' | 'lung_auscultation' | 'chest_percussion'  // 신규

TOOL_REGIONS = {
  ...기존,
  heart_auscultation: ['aortic', 'pulmonic', 'tricuspid', 'mitral'],
  lung_auscultation:  [...전면 6, ...후면 6],
  chest_percussion:   [...전면 6, ...후면 6],
}

HOLD_SECONDS = {
  ...기존,
  heart_auscultation: 3.0,   // 평가표 "한 군데서 3초 이상"
  lung_auscultation:  3.0,
  chest_percussion:   1.2,
}
```

`REGION_LABEL`에 한글 라벨 추가 (대동맥판/폐동맥판/삼첨판/승모판, 우상폐야(전)/… 형식).

---

## 3. 3D 배치 — 본 기준 (고정 좌표 금지)

부록 스펙의 `PATIENT_TORSO`(pubis / xiphoid / right / up / front / halfWidth)를 그대로 쓴다.
흉부는 `xiphoid` 위쪽이므로 흉곽 상단 기준점이 하나 더 필요하다 — `PATIENT_TORSO`에 추가한다:

```ts
suprasternal: new THREE.Vector3(),  // 목아래(복장뼈 위끝) ≈ neck 본 살짝 아래
```
`bones.neck` 월드좌표에서 `up` 방향으로 소량 내린 지점으로 잡는다.

```
chestLen = distance(xiphoid, suprasternal)

// 갈비사이 근사 — 복장뼈 위끝(0)에서 칼돌기(1) 사이 비율
ics2 = suprasternal - up * (chestLen * 0.22)   // 2번째 갈비사이 근처
ics5 = suprasternal - up * (chestLen * 0.68)   // 5번째 갈비사이 근처

aortic    = ics2 + right * (halfWidth * 0.30)   // 환자 오른쪽 복장뼈옆
pulmonic  = ics2 - right * (halfWidth * 0.30)   // 환자 왼쪽 복장뼈옆
tricuspid = ics5 - right * (halfWidth * 0.18)   // 왼쪽 복장뼈 하연
mitral    = ics5 - right * (halfWidth * 0.62)   // 심첨 — 더 바깥·약간 아래
```

폐야(전면) — 좌우 각각 상/중/하를 흉곽 높이에 균등 분할:
```
lung_ant_{side}_{up|mid|low}
  = suprasternal - up * (chestLen * {0.18 | 0.45 | 0.75})
    ± right * (halfWidth * 0.55)
```
폐야(후면) — 같은 높이에서 `front`를 반대로:
```
lung_post_* = 같은 식이되 - front * (halfWidth * 0.9)
```

모든 중심은 부록 §2.4의 **레이캐스트로 체표에 올린다.** 후면 부위는 레이 방향이 `+front`(등 뒤에서 앞으로)임에 주의.

### ⚠️ [2026-07-25 캡처 확인] 실제 배치에서 발견된 문제 — 반드시 고칠 것

`b2_regions/mh_f20_thin_sitedge_heart_markers.png`를 눈으로 확인한 결과:

1. **마커 반경이 너무 크다.** 삼첨판·승모판이 거의 포개져 하나로 보인다.
   심장 판막은 갈비사이 한 칸 단위라 **복부 4분면보다 훨씬 작아야** 한다.
   판막 반경은 `halfWidth * 0.16` 수준(대략 1.5~2.5cm)으로 낮추고, **서로 겹치지 않는지 캡처로 확인**하라.
   폐야도 12개가 좁은 흉곽에 들어가므로 같은 검토가 필요하다.
2. **승모판이 너무 안쪽이다.** 승모판은 **심첨부** — 좌측 **쇄골중앙선** 5번 갈비사이다.
   삼첨판(좌측 복장뼈 하연) 바로 옆이 아니라 훨씬 바깥이어야 한다.
   위 유도식의 `halfWidth * 0.62`가 실제로 그만큼 벌어지는지 캡처로 검산하라 — 안 벌어지면 계수를 키워라.
3. 대동맥판·폐동맥판이 다소 높다. 2번째 갈비사이는 쇄골보다 확실히 아래다. `chestLen * 0.22`를 재검토하라.

**세 지적 모두 "코드상 맞다"로 넘기지 말고 캡처를 눈으로 보고 판단하라.**

---

## 4. 자세와 카메라

평가표가 심장·폐 청진 모두 **앉은 자세**를 요구한다. 부록 §6.3에서 만든 `examPose: 'sit_edge'`(진찰대 걸터앉기)를 재사용한다.

- 흉부 도구(`heart_auscultation`/`lung_auscultation`/`chest_percussion`)를 선택하면 `examPose`를 `'sit_edge'`로 전환.
- **후면 폐야를 클릭하려면 카메라가 환자 뒤로 가야 한다.** `CameraRig`에 흉부 진찰용 앞/뒤 전환을 넣어라:
  - 전면 부위가 남아 있으면 앞에서, 전면 6곳을 다 찍었으면 자동으로 뒤로 회전(또는 수동 전환 버튼/제스처).
  - 자동 전환 시 짧은 페이드나 부드러운 보간으로 넘겨 멀미를 줄여라.
- 상의 노출: 기존 `clinicalGarments`의 `upper: 'worn' → 'raised'` 메커니즘을 그대로 쓴다.
  흉부 진찰은 `raised`가 아니라 **탈의/올림 수준이 더 필요**하므로, 옷 메시가 가슴을 가리면 청진 부위가 안 보인다.
  기존 의복 슬롯 제어로 해결되는지 먼저 확인하고, 안 되면 그 사실을 보고하라 — **새 의복 에셋을 만들지는 마라.**

---

## 5. 심호흡 지시 (평가표 흉부청진 ②⑥)

새 인텐트 `do_deep_breath` 추가 — "숨을 크게 쉬어보세요", "깊게 들이쉬세요", "입으로 숨 쉬어보세요" 등.

- `intent_analyzer`에 키워드 + LLM 설명 + `merge_keyword_signals` 승격을 **3종 세트로** 추가한다
  (codex 엔진은 `turn_engine.combined_turn`이 `analyze()`를 우회하므로 공용 함수에 넣어야 양쪽에서 잡힌다 — 이전에 겪은 함정).
  한글 활용형 주의: "쉬어보"와 "쉬어 보"가 따로다.
- 케이스 `exam_items`에 `prep` 항목 `deep_breath` 추가. `lung_auscultation`에 `requires_prep: ["deep_breath"]`를 두고,
  심호흡 지시 없이 폐 청진을 하면 완료는 시키되 채점에서 감점(`ratio *= 0.9`) + 피드백
  `"폐 청진은 환자에게 크게 숨 쉬도록 안내하고 들숨·날숨을 모두 들어야 해요."`
- 3D 연출: `examGesture`에 `'deep_breath'` 추가 — 흉곽이 크게 오르내리는 호흡 애니메이션을 몇 초간.
  기존 호흡 모션의 진폭을 키우는 방식으로 처리하고, 새 본 애니메이션을 만들지 마라.

---

## 6. 소견과 음원

음원은 이미 있다 (`public/sounds/exam/`): 심음 8종(normal / systolic_murmur / diastolic_murmur / s3_gallop / s4_gallop / atrial_fibrillation / tachycardia / av_block), 폐음 6종(normal / fine_crackles / coarse_crackles / wheezing / rhonchi / pleural_rub).

`examSounds.ts`에 `playHeart(finding)` / `playLung(finding)`를 추가한다. 기존 `playAuscultation`이 finding 텍스트로 변형을 고르는 방식을 따르되, **finding 문자열 매칭에 의존하지 말고** 케이스 데이터가 음원 종류를 명시하게 하라:

```jsonc
"region_findings": {
  "mitral": {
    "finding": "심첨부에서 수축기 잡음이 들립니다.",
    "sound": "systolic_murmur"          // ← 신규 필드. 파일명과 1:1
  }
}
```
`sound`가 없으면 `normal`을 재생한다. (문자열 매칭은 소견 문구를 조금만 고쳐도 조용히 깨진다)

**부위마다 다른 소리를 낼 수 있어야 한다** — 승모판에서만 잡음이 들리는 게 임상적으로 정상이다.
부위별 음원이 다르게 나오는지 반드시 실제로 확인하라.

---

## 7. 어느 케이스에 붙일 것인가

**새 흉통 케이스를 억지로 만들지 마라.** 기존 케이스 중 흉부 진찰이 임상적으로 **당연히 필요한** 것에 먼저 붙인다.

| 케이스 | 붙일 흉부 진찰 | 기대 소견 |
|---|---|---|
| `weightloss_supplement_thyrotoxicosis_01` | 심장 청진 | 빈맥(`tachycardia`) 또는 심방세동(`atrial_fibrillation`) — 갑상선중독증의 전형 |
| `panic_attack_01` | 심장 + 폐 청진 | **정상**. 심장·폐가 정상임을 확인하는 것이 공황장애 진단의 핵심 감별 과정 |
| `alcohol_withdrawal_tremor_01` | 심장 청진 | 빈맥 |
| `hyperthyroidism_01` | 심장 청진 (기존 갑상샘 촉진에 추가) | 빈맥 |

이 4개로 심음 정상/빈맥/심방세동이 모두 커버된다.
폐음 이상(천명·수포음)이 필요한 케이스가 없으면 **무리해서 만들지 말고**, 후속 케이스 확장(④) 때 호흡기 케이스를 새로 설계하면서 붙여라.

> ⚠️ 의학 정확성: 공황장애에서 심장·폐가 정상이라는 것은 **중요한 교육 포인트**다.
> "정상이라 시시하다"고 이상 소견을 지어내지 마라. 정상 소견을 확인하는 것도 진찰이다.

---

## 8. 출처 표기 (CC BY 4.0 — 법적 필수)

심음·폐음은 **HLS-CMDS, CC BY 4.0**이라 **사용자에게 보이는 출처 표기가 의무**다.
현재는 `public/sounds/exam/CREDITS.md`와 코드 주석에만 있고 **앱 화면 어디에도 없다.**

앱 내에 표기를 추가하라 — `Settings.tsx`나 타이틀 화면에 "출처/라이선스" 항목을 만들고 아래 문구를 넣는다:

```
Heart and lung sounds from the HLS-CMDS dataset by Y. Torabi et al.,
licensed under CC BY 4.0. https://github.com/torabiy/hls-cmds
```

같은 화면에 다른 에셋 출처도 함께 정리한다 (Microsoft Rocketbox MIT, Poly Haven CC0 HDRI, ambientCG CC0 텍스처, MakeHuman/MPFB CC0, freesound borygmi CC0 등 — `CREDITS.md`와 각 파일 주석에 흩어져 있는 것을 모을 것).

---

## 9. 완료 기준

- [ ] `npm run build` 통과
- [ ] 심장 4부위를 각각 3초씩 눌러야 `heart_auscultation`이 완료된다 (한 곳만으로는 미완료)
- [ ] 폐 청진은 전면 6 + 후면 6을 모두 찍어야 완료되고, 후면 진입 시 카메라가 환자 뒤로 간다
- [ ] 심호흡 지시 없이 폐 청진하면 채점에서 감점 + 해당 피드백 문구
- [ ] 부위마다 지정된 음원이 실제로 다르게 재생된다 (승모판만 잡음 등)
- [ ] 앉은 자세(`sit_edge`)에서 마커가 실제 가슴/등 위에 온다 — **비만·마름·고령 아바타 3종 스크린샷으로 확인**
- [ ] 앱 화면에 HLS-CMDS 출처 표기가 보인다
- [ ] 회귀: 복부·두경부 진찰이 기존과 동일하게 동작
