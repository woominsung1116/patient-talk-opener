# 배포 자산 라이선스 전수 감사 (2026-07-25)

`frontend/public/**` 의 모든 자산은 빌드 시 `frontend/dist/**` 로 복사되어 **URL 로 그대로 내려받을 수 있다.**
사용자가 세운 그래픽 조건은 **"무료 + 상업 이용 가능"** 이며 이건 취향이 아니라 제품 요건이다.

방법: GLB/GLTF 의 `asset.extras` / `asset.copyright` 에 박힌 **원본 메타데이터를 읽었다.**
추측하지 않았다 — 파일에 없으면 "메타데이터 없음"으로 남겼다.
Poly Haven 은 `api.polyhaven.com/info/<slug>` 로 이름·저자를 재대조했고, 라이선스 조항은 원문을 확인했다.
스캔 스크립트: `scratchpad/asset_fix/license_scan.py`, 원자료: `license_scan.json`.

---

## 0. 결론 먼저 — 조치가 필요한 것 2건

| | 자산 | 라이선스 | 크기 | dist 배포 | src 참조 |
|---|---|---|---|---|---|
| ❌ **1** | `avatars/carla.glb` `claudia.glb` `eric.glb` | **RenderPeople** | **50.2MB** | **되고 있음** | 참조됨 |
| ❌ **2** | `models/stethoscope*.glb` 3종 + `.backup` | **Sketchfab Standard** | 1.6MB | **되고 있음** | `_u2` 만 참조 |

두 건 모두 `female_hand.glb` 와 **같은 유형**이다: 라이선스가 "모델 파일 자체를 제3자가 내려받을 수 있게
두는 것"을 금지하는데, 웹 앱은 정확히 그렇게 하고 있다.

추가로 ⚠️ **CC-BY 표기 의무가 이행되지 않고 있다** (§4).

---

## 1. ❌ RenderPeople 아바타 — 가장 큰 노출

`carla.glb`(22.0MB) · `claudia.glb`(20.9MB) · `eric.glb`(6.1MB) = **50.2MB**

출처 근거는 코드다 — `frontend/src/three/avatarVariant.ts:26`:

```ts
const RENDERPEOPLE: ReadonlySet<string> = new Set<RPVariant>(['carla', 'eric', 'claudia'])
```

GLB 메타데이터에는 저자·라이선스가 없다(재가공되며 지워짐). 파일명·코드 주석("RenderPeople(포토리얼)")이 근거다.

**RenderPeople 이용약관 §4.3(b)** (원문 확인):

> 3D 데이터는 "must not be directly circulated" 이며,
> "making the 3D data available in a way that allows third parties to **easily download, extract,
> distribute, or otherwise access**" 하는 것을 금지한다.
> 또한 라이선시는 제3자 추출을 막도록 "according to the current state of technology" 저장해야 한다.

**판단: 위반이 명확하다.** `https://<host>/avatars/carla.glb` 로 22MB GLB 가 그대로 떨어진다.
약관은 단순히 재배포를 금지하는 데 그치지 않고 **추출 방지 조치를 적극적으로 요구**한다.
정적 파일 서빙은 그 요구의 정반대다.

배포 확인: `frontend/dist/avatars/` 에 3개 파일 모두 존재 (2026-07-25 15:53).

**참고 — 상업 이용 자체는 허용된다.** RenderPeople 무료 모델도 "free commercial use" 다.
문제는 상업성이 아니라 **재배포·추출 가능성**이다. 이 구분이 중요하다.

**대체 경로:** `mh_*`(MakeHuman/MPFB, CC0) 12종이 이미 있고 `TWELVE_READY = true` 다.
`valid_*`(MIT) 6종도 폴백으로 있다. 즉 **대체재가 이미 배포돼 있다.**

---

## 2. ❌ 청진기 4종 — Sketchfab Standard

파일에 박힌 메타데이터(추측 아님):

```
author : assetfactory (https://sketchfab.com/assetfactory)
license: SKETCHFAB Standard (https://sketchfab.com/licenses)
source : https://sketchfab.com/3d-models/stethoscope-7fbf6835f13346f589bf679afa606823
title  : Stethoscope
```

4개 파일 전부 동일한 메타데이터를 가진다: `stethoscope.glb` `stethoscope_u.glb`
`stethoscope_u2.glb` `stethoscope_full.glb.backup`.

**Sketchfab Standard License 원문** (https://sketchfab.com/licenses 확인):

> you may not (b) sell, license, distribute or otherwise make available the Licensed Material as a
> stand-alone file (or group of files) **or in a way that allows third parties to use, download,
> extract or access the Licensed Material as a stand-alone file (or group of files)**

**판단: 위반이 명확하다.** CREDITS.md §3.2 는 "걸릴 소지가 있다"고 완곡하게 적었지만,
원문은 "third parties to ... download, extract or access ... as a stand-alone file" 을 직접 금지한다.
`/models/stethoscope_u2.glb` 는 바로 그 stand-alone file 이다. **소지가 아니라 해당한다.**

상업 이용 자체는 Standard 라이선스에서 금지되지 않는다(금지 목록은 포르노·불법·주류/담배/무기 홍보 등).
쟁점은 오직 **재배포/추출**이다.

배포 확인: `frontend/dist/models/` 에 4개 전부 존재.

**즉시 줄일 수 있는 부분:** `stethoscope.glb` · `stethoscope_u.glb` · `stethoscope_full.glb.backup`
**3개는 `src/` 에서 참조되지 않는다**(정확 경로 매칭으로 확인). 노출 면적을 1/4 로 줄일 수 있다.
`stethoscope_u2.glb` 만 `ClinicScene.tsx:271,2491` 에서 쓴다.

---

## 3. ✅ 안전 — 검증 완료

### 3.1 Poly Haven (CC0) — 소품 11종 + HDRI 4개 + 텍스처

`api.polyhaven.com/info/<slug>` 로 11개 전부 이름·저자가 CREDITS.md 기재와 **일치**함을 재확인했다.

| 폴더 | Poly Haven 이름 | 저자 | src 참조 |
|---|---|---|---|
| `desk_lamp_arm_01/` | Desk Lamp Arm 01 | Yann Kervran, Kuutti Siitonen | 참조 |
| `drawer_cabinet/` | Drawer Cabinet | Ulan Cabanilla | 참조 |
| `GreenChair_01/` | Green Chair 01 | Kirill Sannikov | 참조 |
| `metal_office_desk/` | Metal Office Desk | Ulan Cabanilla | 참조 |
| `metal_trash_can/` | Metal Trash Can | GurJas Studios | 참조 |
| `potted_plant_01/` | Potted Plant 01 | Rico Cilliers | 참조 |
| `wall_clock/` | Wall Clock | PierreB3D | 참조 |
| `wooden_bookshelf_worn/` | Wooden Bookshelf Worn | Ulan Cabanilla | 참조 |
| `SchoolChair_01/` | School Chair 01 | Ethan Place | **미참조** |
| `Shelf_01/` | Shelf 01 | Gabriel Radić | **미참조** |
| `wheelchair_01/` | Wheelchair 01 | Garreth Dean | **미참조** |

HDRI 도 동일 확인: `hospital_room`(Oliksiy Yakovlyev), `hospital_room_2`(Dimitrios Savva, Jarod Guest).

**Poly Haven 라이선스 원문** (https://polyhaven.com/license):

> "Our assets are all licensed as CC0, which is effectively Public Domain..."
> "You can use our assets for any purpose, including commercial work."
> "You do not need to give credit or attribution when using them (although it is appreciated)."
> "You can redistribute them, share them around, include them when sharing your own work,
> or even in a product you sell."

→ **상업·재배포·수정 전부 자유, 표기 의무 없음.** 예외 조항 없음.

> ⚠️ 한 가지 정직하게 짚어둔다: **GLB 파일 자체에는 라이선스 메타데이터가 없다.**
> CC0 판단은 파일이 아니라 Poly Haven 의 사이트 전역 정책 + API 이름/저자 대조에 근거한다.
> 대조가 11/11 일치하므로 신뢰도는 높지만, "파일에 적혀 있다"는 아니다.

`frontend/public/textures/` 도 같은 계열이다 — `brown_planks_05`, `marble_01`,
`painted_plaster_wall` = Poly Haven(CC0), `OfficeCeiling001/005`, `Plaster001/003`,
`Tiles074/101`, `WoodFloor043` = ambientCG(CC0). 둘 다 CC0 라 표기 의무 없음.

### 3.2 자체 제작

| 파일 | 근거 |
|---|---|
| `models/penlight.glb` | `tools/props/build_props.py` 로 절차 생성. 재생성 가능 |
| `models/tongue_depressor.glb` | 같음 + `gen_wood_tex.py` 텍스처 |

외부 에셋을 안 쓴 근거는 CREDITS.md §4 에 조사 기록까지 남아 있다(후보 2종이 CC-BY 라
표기 의무가 생기고 품질도 더 낫지 않아서 자체 제작). 타당하다.

### 3.3 MIT 아바타

| 자산 | 출처 | 근거 |
|---|---|---|
| `avatars/jieun.glb` `sujin.glb` `hyunwoo.glb` | **Microsoft Rocketbox** (MIT) | `avatarVariant.ts:25`, `RealisticPatient.tsx:2` |
| `avatars/valid_*.glb` 6종 | **VALID** (MIT) | `avatarVariant.ts:8` |

MIT 는 상업 이용·재배포·수정 전부 허용한다. **웹 배포에 문제없다.**
(MIT 는 저작권 고지 유지를 요구하지만 실무상 크레딧 문서로 충족된다 — §4 참조.)

### 3.4 MakeHuman / MPFB (CC0)

`avatars/mh_*.glb` 21종(약 250MB), `avatars/skin/*.png` 6종.
`avatars/skin/LICENSE.md` 가 upstream 파일명 매핑까지 적어 두었다 — `makehuman_system_assets_cc0.zip`,
**CC0 1.0**. 상업 이용 가능, 표기 불필요.

---

## 4. ⚠️ 조건부 — CC-BY 표기 의무가 **이행되지 않고 있다**

CC-BY 계열은 상업 이용이 가능하지만 **저작자 표시가 조건**이다. 표시하지 않으면 라이선스 위반이다.

| 자산 | 라이선스 | 표기 의무 대상 |
|---|---|---|
| `sounds/exam/heart/**`, `lung/**` (HLS-CMDS) | **CC BY 4.0** | Y. Torabi et al. |
| `avatars/mh_f60_ob_grandma_casual.glb` 의 바지 | **CC BY 4.0** | Mindfront (`mindfront_female_trousers_1`) |

**현재 상태: 앱 화면 어디에도 표기가 없다.**
`frontend/src/` 전체를 grep 한 결과 저작자 표기는 **소스 주석에만** 있다:

- `frontend/src/audio/examSounds.ts:6` — 주석
- `frontend/src/three/RealisticPatient.tsx:2` — 주석

주석은 최종 사용자에게 보이지 않으므로 CC-BY 의 표시 요건을 충족하지 못한다.
`sounds/exam/CREDITS.md` 자신이 이렇게 적어 두었다:

> **필수 출처 표기 문구** (앱 크레딧/약관에 **포함할 것**):
> > Heart and lung sounds from the HLS-CMDS dataset by Y. Torabi et al.,
> > licensed under CC BY 4.0. https://github.com/torabiy/hls-cmds

즉 **의무는 문서화돼 있으나 구현되지 않았다.** UI 에 크레딧 화면을 하나 추가하면 해결된다
(이건 `frontend/src/` 작업이라 내 담당 밖이다).

`avatars/clothes/LICENSE.md` 도 Mindfront 바지가 CC-BY 4.0 임을 적어 두었는데,
`mh_f60_ob_grandma_casual.glb` 는 `RealisticPatient.tsx:2921` 에서 **실제로 사용된다.**

---

## 5. ❓ 메타데이터 없음 — 출처 확인 필요

아래는 저자·라이선스 정보가 **파일에도 문서에도 없다.** 자체 제작이면 문제없지만,
외부에서 받아온 것이면 위 두 건과 같은 문제가 될 수 있다.

| 자산 | 크기 | src 참조 | 비고 |
|---|---|---|---|
| `models/doctor_arm.glb` | 3.9MB | **참조** | 촉진·타진·CVA 에 쓰이는 핵심 자산 |
| `models/hygiene_rig.glb` | 187K | **참조** | 손소독 |
| `models/exam_bed.glb` | 212K | 미참조 | 재설계 씬에서 투입 예정 |
| `models/iv_drip.glb` | 73K | 미참조 | 재설계 씬에서 투입 예정 |
| `models/vitals_monitor.glb` | 139K | 미참조 | |
| `models/privacy_curtain.glb` | 55K | 미참조 | |
| `models/sanitizer_bottle.glb` | 93K | 미참조 | |
| `patients/*.png` 11개 | 4.7MB | 일부 참조 | 2D 환자 렌더 |
| `scenes/*.png` 3개 | 3.8MB | 참조 | 배경 이미지 |

`doctor_arm.glb` 가 가장 중요하다 — **참조되고 있고 3.9MB 이며 출처를 모른다.**
`generator` 필드가 재가공 도구로 덮여 있어 원본 정보가 지워졌다.

> 이 항목들은 **위험하다고 단정하지 않는다.** 확인이 안 될 뿐이다.
> 만든 사람이 남아 있으면 출처를 CREDITS.md 에 적어 닫는 게 맞다.

---

## 6. CREDITS.md 와 실제 파일 대조 결과

| 항목 | CREDITS.md 기재 | 실측 | 일치 |
|---|---|---|---|
| Poly Haven 11종 이름·저자 | §2 표 | API 조회 | ✅ 11/11 |
| 청진기 라이선스 | §3.2 Sketchfab Standard | `asset.extras` | ✅ 일치 |
| `female_hand.glb` CC-BY-NC | §3.1 | (이미 격리됨) | ✅ 일치 |
| 출처 미상 7종 | §3.3 | `asset.extras` 비어 있음 | ✅ 일치 |
| **RenderPeople 아바타** | **누락** | `avatarVariant.ts:26` | ❌ **기재 없음** |
| 청진기 위험도 서술 | "걸릴 **소지**가 있다" | 원문은 직접 금지 | ⚠️ **과소 서술** |

**`models/CREDITS.md` 는 `models/` 만 다룬다.** `avatars/` 를 다루는 크레딧 문서가 없어서
50MB RenderPeople 이 어떤 크레딧 문서에도 잡히지 않았다. 이것이 이번 감사에서 이게 늦게 드러난 이유다.

→ 권고: `frontend/public/avatars/CREDITS.md` 를 만들어 4개 계열(RenderPeople / Rocketbox /
MakeHuman / VALID)의 출처와 라이선스를 적어라.

---

## 7. 처분 판단은 하지 않았다

지시대로 **자산을 옮기거나 지우지 않았다.** 아래는 참고용 선택지일 뿐 실행하지 않았다.

| 자산 | 참조 | 대체재 유무 |
|---|---|---|
| 청진기 3종(`_u2` 제외) | 미참조 | 불필요 — 그냥 안 쓰임 |
| `stethoscope_u2.glb` | **참조** | 없음. 교체하려면 CC0 청진기를 구하거나 절차 생성 |
| RenderPeople 3종 | **참조** | `mh_*`(CC0) 12종 · `valid_*`(MIT) 6종이 **이미 배포돼 있음** |

`avatars/**` 는 지시대로 **읽기만** 했다 — 얼굴 모프타깃 때문에 수정하지 않았다.

---

## 8. 방법의 한계 (정직하게)

- **CC0/MIT 판단 중 상당수는 파일이 아니라 문서·코드 주석에 근거한다.** Poly Haven·ambientCG·
  Rocketbox·VALID·MakeHuman 모두 GLB 안에 라이선스 필드가 없다. Poly Haven 만 API 로 교차검증했다.
- **RenderPeople 판단은 파일 메타데이터가 아니라 코드의 변수명·주석에 근거한다.** 다만
  `avatarVariant.ts` 가 명시적으로 세 이름을 RenderPeople 로 분류하고 있어 근거는 충분하다고 본다.
- **RenderPeople 무료 모델과 유료 모델의 약관이 동일한지는 확인하지 못했다.** 무료 모델 페이지가
  "same terms of use as the charged models" 라고 적고 있어 §4.3(b) 가 적용된다고 보았다.
  어느 경로로 받았는지(무료/유료)는 파일에서 알 수 없다.
- `patients/*.png` · `scenes/*.png` 는 출처 단서를 전혀 못 찾았다. 생성 방식(AI/직접 렌더)조차 불명이다.
- 법률 자문이 아니다. 라이선스 원문 인용과 그에 대한 기술적 사실(파일이 URL 로 노출되는가)의 대조다.
