# 부록 — 진찰 부위 좌표 정합 (2026-07-25)

본 스펙: `2026-07-25-physical-exam-fidelity-spec.md`
이 부록은 **그 작업이 끝난 뒤에** 이어서 적용한다.

---

## 1. 문제

청진·타진·촉진·CVA의 클릭 영역이 환자 몸과 미묘하게 어긋난다. 원인은 좌표가 **월드 절대값으로 하드코딩**되어 있기 때문이다.

```ts
// ClinicScene.tsx — 현재
quadrants: [
  { id: 'ruq', pos: [1.55, 0.93, -3.4] },   // 절대 월드 좌표
  ...
],
quadrantR: 0.07,                             // 반지름 7cm 고정
flanks: [[1.78, 0.88, -3.3], [1.78, 0.88, -3.72]],
flankR: 0.1,
```

`EXAM.patientPos`는 **발 기준점**이라, 배의 실제 위치는 아바타의 다리 길이 + 몸통 길이에 따라 달라진다.
그런데 이 프로젝트의 아바타 풀은:

- MPFB 12종(20~70대 남녀) + 체형 변형 `mh_f60_ob`(비만) / `mh_f30_thin`, `mh_f20_thin`(마름)
- VALID 6종, Rocketbox 3종, RenderPeople 3종

키·몸통 길이·체표 높이·몸통 폭이 전부 다르다. 특히 비만/마름 변형은 배 표면 높이가 수 cm 단위로 차이 난다.
고정 좌표 + 7cm 반경으로는 정합이 될 수 없다.

> 같은 실패를 두경부 진찰에서 이미 겪었고, `PATIENT_HEAD_WORLD`(머리 본 월드좌표를 매 프레임 export)로 해결했다.
> 복부·옆구리도 **같은 원리로 본(bone) 기준 상대 좌표**로 바꾼다.

---

## 2. 해법 — 본 기준 해부학적 프레임 + 체표 레이캐스트

### 2.1 `RealisticPatient.tsx` — 몸통 프레임 export

`PATIENT_HEAD_WORLD`와 같은 패턴으로, 모듈 스코프에 가변 객체를 두고 매 프레임 갱신한다.

```ts
/* 복부·옆구리 진찰 앵커 — 현재 환자의 몸통 본 월드 프레임.
   아바타별 키·몸통 길이·체형 차이를 자동 흡수한다. (고정 좌표는 어긋난다) */
export const PATIENT_TORSO = {
  pubis: new THREE.Vector3(),   // 골반(pelvis) 본 월드좌표 ≈ 두덩결합 높이
  xiphoid: new THREE.Vector3(), // 가슴(spine2) 본 월드좌표 ≈ 칼돌기 높이
  right: new THREE.Vector3(),   // 환자 기준 오른쪽 단위벡터 (월드)
  up: new THREE.Vector3(),      // 골반→가슴 (몸통 세로축) 단위벡터
  front: new THREE.Vector3(),   // 배 바깥쪽 법선 (앙와위면 대략 +y)
  halfWidth: 0.16,              // 몸통 반폭(m) — 좌우 넓적다리 본 간격에서 산출
  valid: false,                 // 본을 못 찾으면 false → 소비측이 기존 상수로 폴백
}
```

매 프레임 계산 (`headBone.getWorldPosition(PATIENT_HEAD_WORLD)` 하는 그 자리, `!embedded`일 때만):

```
pelvisBone = bones.pelvis, chestBone = bones.spine2 (없으면 bones.spine), lThigh = bones.lthigh, rThigh = bones.rthigh
셋 중 하나라도 없으면 valid = false 로 두고 return

pubis   ← pelvisBone.getWorldPosition
xiphoid ← chestBone.getWorldPosition
right   ← normalize(rThighWorld - lThighWorld)      // 환자의 오른쪽
up      ← normalize(xiphoid - pubis)                // 몸통 세로축
right   ← normalize(right - up * dot(right, up))    // up에 직교화 (그람-슈미트)
front   ← normalize(cross(right, up))               // 배가 향하는 쪽
halfWidth ← distance(lThighWorld, rThighWorld) * 0.62   // 넓적다리 간격 → 몸통 반폭 근사
valid   ← true
```

> `front = cross(right, up)` 의 부호 검증: 선 자세에서 up=+y, right=+x 이면 cross = +z(정면). 맞다.
> 다만 아바타 골격에 따라 반대로 나올 수 있으니, **머리 본이 아니라 코/얼굴 방향으로 한 번 검산**하라.
> 검산법: `dot(front, normalize(PATIENT_HEAD_WORLD - pubis))` 가 아니라, 앙와위(누운 자세)에서 `front.y > 0` 이어야 한다.
> 음수면 `front.negate()`. 이 보정은 반드시 넣어라 (아바타별 골격 축이 다르다).

### 2.2 `RenderPeoplePatient.tsx` — 같은 프레임 export

RenderPeople 3종(carla/eric/claudia)도 `RealisticPatient`와 **동일한 `PATIENT_TORSO` 객체를 갱신**해야 한다.
`RealisticPatient.tsx`에서 export한 객체를 import해 채우는 방식으로 통일하라 (객체를 두 개 만들지 말 것).
RenderPeople 골격의 본 이름(hips/spine_02 등)에 맞춰 매핑한다. 본을 못 찾으면 `valid = false`.

### 2.3 `ClinicScene.tsx` — 부위 좌표를 프레임에서 유도

`EXAM.quadrants` / `EXAM.flanks`의 고정 좌표를 버리고, 매 프레임(또는 진찰 진입/포즈 변경 시 1회 계산 후 캐시) 유도한다.

**해부학적 기준** (공식 평가표: "칼돌기부터 두덩결합까지", "배꼽 중심으로 4구역"):

```
torsoLen = distance(pubis, xiphoid)
umbilicus = pubis + up * (torsoLen * 0.42)      // 배꼽은 두덩결합~칼돌기의 아래쪽 4할 근처
axialGap  = torsoLen * 0.16                     // 상/하복부 중심의 세로 간격
lateralGap = halfWidth * 0.55                   // 좌/우 중심의 가로 간격

center(quadrant) =
  umbilicus
  + up    * (상복부 ? +axialGap : -axialGap)
  + right * (환자 오른쪽 ? +lateralGap : -lateralGap)
```

- `ruq` = 상 + 오른쪽, `luq` = 상 + 왼쪽, `rlq` = 하 + 오른쪽, `llq` = 하 + 왼쪽
- **좌우는 `PATIENT_TORSO.right`(넓적다리 본에서 유도) 기준이라 자동으로 환자 기준이 된다.**

> ⚠️ **좌우를 뒤집지 마라 (2026-07-25 골격 실측으로 확정).**
> MPFB 골격 `thigh_r` = 모델공간 `x=-0.0889`, `thigh_l` = `x=+0.0889` → 모델공간 환자 오른쪽 = `-X`.
> `ExamPatient`의 `Rx(-90°)` → `Ry(+90°)` 변환은 `(x,y,z) → (-y, z, -x)`이므로
> 머리(모델 `+Y`) = 월드 `-x`, **환자 오른쪽 = 월드 `+z`**.
> 즉 `ruq`가 `z=-3.4`인 **기존 배치가 옳다.**
> 본 스펙 초판에 "환자 오른쪽은 `-z`"라고 적혀 있었으나 그것이 오류였다(`right = up × forward`로
> 계산해 부호가 뒤집혔음 — 올바른 식은 `right = forward × up`).
> 뒤집으면 요로결석 케이스의 **우측 CVA 압통이 좌측으로 가서 의학적으로 틀린 것을 가르치게 된다.**
> `PATIENT_TORSO.right`를 본에서 유도한 뒤, 그 방향이 현재 `ruq` 좌표 쪽을 가리키는지 **반드시 검산하고**
> 어긋나면 유도식을 의심하라 (라벨을 고치지 말 것).

**옆구리(CVA)** — 갈비척추각은 등 쪽, 12번 갈비뼈 아래, 척추 양옆:

```
cvaCenter(side) = pubis
  + up    * (torsoLen * 0.55)
  + right * (side === 'flank_r' ? +halfWidth * 0.5 : -halfWidth * 0.5)
  - front * (halfWidth * 0.45)        // 등 쪽으로
```

### 2.4 체표에 붙이기 — 레이캐스트로 실제 피부 높이 찾기

본 좌표는 **몸 속**이다. 클릭 구가 몸에 파묻히거나 떠 보이면 안 되므로, 각 중심을 실제 메시 표면으로 올린다.

```
origin = center + front * 0.45          // 몸 밖 45cm
ray    = Raycaster(origin, -front, 0, 0.9)
hit    = ray.intersectObject(환자 그룹, true) 중 첫 번째
surface = hit ? hit.point + front * 0.012 : center + front * (halfWidth * 0.85)   // 폴백
```

- three.js의 `SkinnedMesh.raycast`는 스키닝을 반영한다(`applyBoneTransform`). 본 애니메이션이 적용된 실제 자세로 맞는다.
- **레이캐스트는 매 프레임 하지 마라.** 비용이 크다. 아래 시점에만 재계산하고 결과를 `useRef`에 캐시한다:
  - `examMode` 진입 시
  - `examPose` 변경 시 (`lie` ↔ `lie_knees` ↔ `sit_edge`)
  - 환자 아바타(variant) 변경 시
  - 모델 로드 완료 후 (텍스처/스킨이 준비된 뒤 1회)
  계산 시점에 모델이 아직 준비 안 됐을 수 있으니, `valid === false`면 다음 프레임에 재시도하되 최대 60프레임까지만.
- 옷 메시(`CLOTHING`)에 맞으면 그것도 체표로 인정한다(옷 위에서 진찰하는 게 아니라, 시각적으로 붙기만 하면 된다).
  다만 이불/드레이프 메시가 있으면 제외하라 — `name`으로 걸러라.

### 2.5 클릭 반경도 체형에 비례

```
quadrantR = clamp(halfWidth * 0.42, 0.055, 0.105)
flankR    = clamp(halfWidth * 0.55, 0.075, 0.13)
```

고정 0.07/0.1을 버린다. 비만 아바타에서 4분면이 서로 겹치지 않는지 확인할 것
(겹치면 `lateralGap`/`axialGap`을 키우거나 반경 상한을 낮춰라).

> **[2026-07-25 캡처 확인 — 실제로 겹치고 있다]**
> `b2_regions/mh_f20_thin_lie_palp_markers.png`에서 복부 4분면이 **하나의 덩어리로 뭉쳐** 4개로 안 읽힌다.
> 마른 아바타는 노출된 배 폭이 좁아 특히 심하다.
>
> **부위 종류마다 반경 계수가 달라야 한다.** 지금은 복부 기준 하나로 전부 처리하고 있다:
>
> | 부위 | 해부학적 크기 | 반경 계수(대략) |
> |---|---|---|
> | 복부 4분면 | 사분면 하나 | `clamp(halfWidth * 0.42, 0.042, 0.075)` — 하한/상한 갱신, §4.6 |
> | 옆구리 CVA | 손바닥 크기 | `clamp(halfWidth * 0.5, 0.06, 0.11)` (구현 현행값) |
> | **심장 판막** | **갈비사이 한 칸** | **`halfWidth * 0.16`** ← 훨씬 작다 |
> | **폐야** | 12개가 흉곽에 들어간다 | **`halfWidth * 0.20`** |
> | **눈(결막·공막)** | 안구 | **머리폭 기준 소형** — 좌우 눈이 겹치면 좌우 구분이 무의미해진다 |
> | **갑상샘 좌·우엽** | 엄지 한 마디 | 소형 |
>
> **판정 기준은 캡처다.** 반경을 정하고 나서 "이웃 마커와 겹치는가"를 눈으로 확인하라.
> 겹치면 학생이 어느 부위를 찍는지 알 수 없어 부위 분리가 통째로 무의미해진다.

### 2.6 접촉 표시물도 같이 정합

`RegionMesh`가 호버/홀드 때 띄우는 청진기 체스트피스(`AuscultationRig`)와 손 GLB는 지금 구(sphere) 중심 기준 고정 오프셋(`y + 0.03` 등)으로 붙어 있다.
이제 중심이 체표에 올라왔으므로, **`front` 방향 오프셋**으로 바꿔라. 누운 자세든 앉은 자세(`sit_edge`)든 항상 피부에 수직으로 닿아야 한다.
`STETHO` 상수의 고정 회전값도 `front`/`right`로 만든 쿼터니언으로 대체한다
(두경부에서 쓴 `armQuat(setFromUnitVectors)` 패턴 재사용 — 손끝은 -Y, 소매는 +Y).

---

## 3. 검증 (반드시 시각으로 확인 — 코드만 보고 끝내지 마라)

`frontend/node_modules/.bin/playwright`와 `tools/shot_clinic.mjs`(기존 스크린샷 도구) 가 있다. 참고해 캡처하라.

1. **체형 극단 3종 교차 확인**: `mh_f60_ob`(비만), `mh_f20_thin`(마름), `mh_m70`(고령 남성)에서
   진찰 모드에 진입해 4분면 마커와 옆구리 마커가 **실제 배/옆구리 위에** 오는지 스크린샷으로 확인한다.
   (아바타 강제 지정은 `debugAvatarVariant` / URL `?av=` 로 가능하다 — `avatarVariant.ts` 참고)
2. **자세 전환**: `lie` → `lie_knees` → `sit_edge`로 바뀔 때 마커가 따라오는지.
   특히 `sit_edge`에서 CVA 마커가 **등 쪽**에 있는지.
3. **좌우 검산**: 화면에서 `flank_r` 마커를 클릭했을 때 나오는 소견이 "우측 …압통"인지.
   환자가 누워서 의사를 향해 있으므로, **화면상 왼쪽에 보이는 것이 환자의 오른쪽**일 수 있다. 헷갈리지 말 것.
4. **파묻힘/뜸 없음**: 청진기 체스트피스와 손이 피부에 닿아 보이는지(공중에 뜨거나 몸을 파고들지 않는지).
5. 회귀: `npm run build` 통과, 두경부(`sit`) 케이스 진찰이 이전과 동일하게 동작.

스크린샷은 `/private/tmp/claude-501/-Users-woominseong-Desktop----/6719fbd2-d125-4e36-b744-ea010e7e8d6f/scratchpad/` 아래에 저장하고, 최종 보고에 경로와 판단 근거를 적어라.
**"코드상 맞을 것"은 근거가 아니다. 캡처를 눈으로 보고 판단하라.**

---

## 4. 후속 수정 (2026-07-25, 육안 검증 실패분)

### 4.1 체표 판정 — "보이는 옷 표면"이 체표다 (가장 중요한 근본 원인)
초판 구현의 `liftToSkin`은 옷 히트를 **건너뛰고 그 밑의 피부**를 체표로 채택했다.
"걷어올린 옷은 클리핑으로 잘려 있어도 레이에는 맞는다"는 문제를 피하려던 것인데,
그 결과 **옷을 입은 부위에서 앵커가 천 아래(살)에 박혔다.**
→ 청진기·손이 옷 속에 파묻혀 손가락만 삐져나오고(항목3), 마커도 천 밑에 깔렸다.

이제 렌더러와 **같은 판정식**으로 옷 조각이 실제로 보이는지 검사한다
(`garmentVisibleAt`: material.clippingPlanes + clipIntersection).
- 잘려 나가 안 보이는 옷 → 없는 셈 치고 통과
- 보이는 옷 → **거기가 체표**

### 4.2 옆으로 쏜 레이는 팔을 맞는다 → 지배 본으로 거른다
누운 자세 옆구리는 `±right` 방향으로 레이를 쏘는데, 몸 옆에 놓인 팔이 먼저 맞았다.
메시 이름으로는 못 거른다(팔도 소매도 같은 메시의 일부다). 맞은 삼각형의
skinIndex/skinWeight에서 **지배 본 이름**을 뽑아 `arm|hand|finger|clavicle|…`이면 건너뛴다.
(이게 lie→lie_knees에서 flank_r이 14cm 튀던 원인)

### 4.3 복부 노출 범위 — 하의 허리선도 함께 내린다
상의만 걷어올리면 배꼽 아래(하복부 2분면)가 통째로 바지 위에 남는다.
공식 평가표의 노출 범위가 "칼돌기~두덩결합"이므로, `upper === 'raised'`일 때
하의에도 **아래를 향한 클리핑 평면**(`lowerWaistClipPlane`)을 걸어 허리밴드를 7~11cm 접어 내린다.
그래도 옷에 걸리는 부위는 `liftToSkin(slide)`가 배꼽 쪽으로 최대 `axialGap*0.8`까지
미끄러지며 드러난 맨살을 찾는다. `axialGapRatio`는 0.26 → 0.21.

### 4.4 접촉물 — doctor_arm.glb 실측치
- 에셋 원본은 사람 팔의 3배(소매 지름 0.19 m). `AuscultationRig`의 `scale 0.4 × 2.5 = 1.0`이
  화면을 덮던 "폭 30cm 회색 원뿔"의 정체였다. 팔은 `DOCTOR_ARM_SCALE 0.85`(손 길이 ≈15cm),
  소매만 반경 0.62배로 줄인다.
- 손끝 = 로컬 −Y, **손바닥 = 로컬 +Z**(정점 z 평균: 손목 0.001 → 손끝 0.021 = 손가락이 +Z로 굽는다),
  엄지 = −X → 이 팔은 **왼팔**이다. `handQuat(finger, palm)`이 이 축을 쓴다.
- 부위 그룹은 "+Y=체표 법선, +Z=카메라의 접평면 투영"이라 **시선은 항상 로컬 (0, sinφ, cosφ)**
  (진찰 카메라 φ≈51°). 소매를 +Z로 뻗으면 시선과 나란해져 소매 통을 정면에서 들여다보게 된다.
  방위각을 +X쪽으로 ~62° 틀어 팔이 화면 옆에서 들어오게 한다.
- 파묻힘/뜸은 고정 오프셋 대신 `armLowestY()`(회전·스케일 적용한 손 bbox의 최저점)로 계산해
  피부 높이에 정확히 앉힌다. 깊은 촉진은 1.2cm 더 눌러 넣는다.
- `female_hand.glb`(텍스처 없는 백묵색 손, 손목 절단면)는 폐기하고 `PalpationRig`이
  청진과 같은 팔 에셋을 쓴다.

### 4.5 의상·헤어 관통 (RealisticPatient)
- `tuckLowerGarmentWaist`: 겉옷이 바깥일 때만(허리 아래 밴드 **평균 반경** 비교) 하의 허리
  정점을 방위각별로 상의 안쪽까지 당긴다. 셔츠를 넣어 입은 아바타(m40/f20)는 건드리지 않는다.
- `liftLongHairOverGarment`: 어깨선 아래·몸통 앞쪽으로 흘러내린 헤어 삼각형을 인덱스 버퍼에서
  빼고(머리를 어깨 뒤로 넘긴 형태), 남은 가닥은 몸통 축에서 2.2cm 바깥으로 밀어 상의 위에 얹는다.

---

## 5. 복부 4분면 재정합 (2026-07-25, 2차 육안 검증)

### 5.1 네 마커가 한 덩어리였던 이유 (숫자로 확인)

`b2_regions/*_lie_palp_markers.png`에서 사분면이 4개로 안 읽혔다. 원인은 셋이다.

**(1) 반경 하한이 §2.5 표를 무력화하고 있었다.**
`clamp(halfWidth * 0.42, 0.055, 0.105)` — `mh_f20_thin`은 `halfWidth 0.105`라 표대로면 0.044인데
하한 0.055에 걸려 25% 부풀려졌다. → **하한 0.042 / 상한 0.075** (§2.5 표에 반영했다).

**(2) `axialGapRatio 0.21`이 지름보다 좁았다.**
기준선은 본(pelvis↔spine_03)이라 22cm 남짓인데, 0.21이면 상·하 중심 간격이 9.3cm.
클릭 구 지름이 11cm이므로 상·하 사분면이 **실제로 겹쳤다**(가로 13cm는 원래 문제없었다).
→ **0.38**. 상복부 중심이 기준선의 0.80(갈비활 근처), 하복부가 0.04(두덩 위)에 떨어져
평가표의 "칼돌기~두덩결합을 배꼽으로 4등분"과도 맞는다.

**(3) 슬라이드 상한이 격자를 도로 뭉갰다.** `slideMax = axialGap * 0.9`는 옷을 피해 미끄러지다
네 마커를 배꼽 한 점으로 모을 수 있었다. → `max(0, axialGap - quadrantR * 1.15)`
(끝까지 미끄러져도 상·하 구 간격이 `2.3r` 이상 남는다).

검증 결과 (단위 m, `regions_qa/report_abdomen.json`):

| 아바타 | halfWidth | r | 상·하 간격 | 좌·우 간격 |
|---|---|---|---|---|
| `mh_f20_thin` | 0.105 | 0.044 | 0.136 (2r=0.088) | 0.130 |
| `mh_f60_ob` | 0.133 | 0.056 | 0.184 (2r=0.112) | 0.164 |
| `mh_m70` | 0.140 | 0.059 | 0.170 (2r=0.118) | 0.174 |

**배꼽 정합 검산** — 화면의 배꼽 오목과 4분면 무게중심의 차이: `mh_m70` 1.2cm, `mh_f60_ob` 1.8cm,
`mh_f20_thin` 4.4cm(발 쪽). 3종 중 2종이 맞으므로 `umbilicusRatio 0.42`는 그대로 둔다.

### 5.2 무릎 세운 자세에서 레이가 넓적다리를 맞는다

4분면을 §5.1(2)대로 벌리자 하복부 중심이 발 쪽으로 내려가, `lie_knees`에서 **세운 넓적다리가
아랫배 위를 가로지르며** 배로 쏜 레이를 먼저 맞았다 — 네 마커가 무릎 위 허공에 떴다.
§4.2의 `NON_TORSO_BONE`(팔 거르기)에 다리 본을 추가해 해결한다:
`arm|hand|finger|thumb|wrist|elbow|clavicle|shoulder|metacarp|palm|thigh|shin|calf|knee|leg|foot|toe`.
진찰 부위 중 다리에 있는 것은 없다. **`pelvis`/`spine`은 넣지 말 것** — 아랫배의 지배 본이다.

### 5.3 의료용 천(모디스티 레이어·프라이버시 드레이프)

`RealisticPatient`가 `mesh.userData.clinicalCloth = true`로 표시하는 메시는 진찰 내내 덮여 있어서,
§4.1대로 "보이는 천 = 체표"로 멈추면 네 부위가 전부 맨살을 찾아 미끄러지다 해부학적 위치를 잃는다.
→ `probeSurface`가 **통과**시켜 맨살 기준으로 자리를 잡되, 지나온 **가장 바깥 천면**을 기억해
(`SurfaceProbe.cover`) 최종 앵커를 그 위로 올린다(`settleAnchor`). 천 밑에 파묻히지 않는다.
`clinicalCloth` 검사는 `NON_SKIN_MESH` 이름 필터보다 **먼저** 해야 한다(드레이프 이름이 걸린다).

> **검증됨** — 모디스티 밴드가 들어온 뒤 `mh_f20_thin/sitedge_heart`를 다시 찍어 비교했다.
> 밴드 위쪽(맨 가슴)인 대동맥판·폐동맥판은 **0mm 이동**, 밴드가 덮는 삼첨판·승모판만
> 체표 바깥으로 7mm·17mm 밀렸다. 해부학적 위치는 그대로 두고 천 위로만 올라간다는 뜻이다.

### 5.4 진단 필드 `ExamAnchor.surface`

"마커가 왜 옷 위에 찍혔나"는 좌표만으로는 못 가린다 — 옷 메시가 `garmentSlot()` 이름표에
안 걸리면 맨살로 오인되기 때문이다. 레이가 실제로 맞은 메시 이름(옷이면 `이름:슬롯`)을
앵커에 기록해 `window.__examAnchors`로 내보낸다. 이 필드로 `mh_m70`의 상복부 2분면이
`CLOTHING:upper`(니트 스웨터) 위에 앉는다는 것을 즉시 확인했다 — **좌표가 아니라 노출 범위 문제**다.
`upper === 'raised'`의 절단 높이가 이 아바타에서 배꼽 위 3cm쯤에 머문다. `RealisticPatient` 쪽 과제.

### 5.5 남은 관찰 (이번 라운드에서 고치지 않음)

- **`mh_m70` 상복부 2분면이 니트 스웨터 위에 앉는다.** §5.4 참조. 슬라이드로는 못 피한다
  (피하려면 4분면이 다시 뭉친다). 상의 절단 높이를 올리는 쪽이 옳은 해법이다.
- **걸터앉은 자세 CVA 마커가 낮다.** `cvaHeightRatio 1.05`로 잡은 위치가 캡처에서는 셔츠 밑단·
  엉덩뼈능선 근처다. 실제 갈비척추각(T12~L1)보다 몇 cm 아래로 보인다. 이번 결함 목록에 없어
  손대지 않았다 — 고칠 거면 이 비율 하나만 올리고 다시 캡처하면 된다.
- **`eyeBones`가 비어 있는 것은 정상이다.** MPFB 골격에 눈 본이 없다(§2.1 주석과 동일).
  결막·공막은 `findFaceLandmarks`가 **실제 안구 메시의 바운딩 박스**에서 잡는다. 검산: 폴백식
  (`eyeRadius 0.024 × scale`)이면 반지름이 0.019~0.021이어야 하는데 실제 값은 아바타별로
  0.025/0.025/0.028이고 좌우 간격도 60~63mm로 제각각이다 → 메시 기반 경로가 돌고 있다.
- **누운 자세에서 `neck`/`supra`가 `[0,0,0]`인 것은 덤프 아티팩트다.** `NECK_POS`는 갑상샘 분기,
  `SUPRA`는 `buildChestAnchors`에서만 쓰이고, 둘 다 **쓰기 직전에 매번 새로 계산한다**
  (`SUPRA`는 빗장뼈 본 두 개의 중점). 흉부 경로가 이 값을 오래된 채로 읽을 위험은 없다.
