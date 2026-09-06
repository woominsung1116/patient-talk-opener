# 3D 에셋 출처 및 라이선스 (`frontend/public/models/`)

이 폴더의 파일은 **빌드 시 `dist/models/` 로 그대로 복사되어 누구나 URL 로 내려받을 수 있다.**
따라서 "재배포 금지" 조건이 붙은 에셋은 여기에 두면 안 된다.

청진음·아바타 헤어/의상 출처는 별도 파일에 있다 → `frontend/public/sounds/exam/CREDITS.md`

---

## 1. 자체 제작 (라이선스 제약 없음 — 우리 저작물)

| 파일 | 설명 | 생성 스크립트 |
|---|---|---|
| `tongue_depressor.glb` | 설압자 (자작나무, 150×18×2mm) | `tools/props/build_props.py` + `tools/props/gen_wood_tex.py` |
| `penlight.glb` | 의료용 펜라이트 (전장 142mm, 지름 13mm) | `tools/props/build_props.py` |
| `hand_palm.glb` | 의사 손 — 편 손 (촉진 얕게/깊게) | `tools/props/make_doctor_hands.py` |
| `hand_grip_disc.glb` | 의사 손 — 검지·중지로 체스트피스를 끼워 누름 (청진) | 〃 |
| `hand_fist.glb` | 의사 손 — 주먹 (CVA 압통 타격) | 〃 |
| `hand_pinch.glb` | 의사 손 — 엄지·검지 집게 (설압자·펜라이트) | 〃 |
| `hand_two_finger.glb` | 의사 손 — 2·3지 신전 (갑상샘 촉진) | 〃 |

**외부 에셋을 쓰지 않고 절차 생성한 이유**는 §4 에 적었다.
두 파일 모두 Blender 로 절차 생성하며, 파라미터를 바꿔 언제든 재생성할 수 있다.

```bash
python3 tools/props/gen_wood_tex.py tools/props/textures            # 설압자 나뭇결 3종 재생성
blender --background --python tools/props/build_props.py -- tools/props/textures frontend/public/models
blender --background --python tools/props/render_props.py -- frontend/public/models <shot_dir>  # 육안 QA 렌더
python3 tools/props/inspect_glb.py frontend/public/models/penlight.glb          # 축·치수·재질 점검
```

> 재빌드는 **기하학적으로 동일하지만 바이트 단위로는 다를 수 있다.** 실측 확인 결과
> `penlight.glb` 는 해시까지 일치하고, `tongue_depressor.glb` 는 POSITION·NORMAL·TEXCOORD 가
> 전부 bit-identical 인데 ngon 삼각화 순서만 달라져 62개 삼각형의 인덱스 회전이 바뀐다
> (삼각형 집합과 감김 방향은 동일). 해시가 안 맞아도 정상이다.

### 좌표 규약 (연결 담당이 알아야 할 것)

`ClinicScene.tsx` 의 `OralExamRig` 는 **손끝 방향이 로컬 −Y**이고 도구가 그쪽으로 뻗는다.
두 에셋 모두 그 규약에 맞췄다 — **길이축 = glTF Y, 환자 쪽 = −Y.**

| | 원점 | bbox (m) | 비고 |
|---|---|---|---|
| `tongue_depressor.glb` | 스틱 **기하 중심** | X ±0.0090 / Y ±0.0750 / Z ±0.0010 | 기존 `boxGeometry(0.017, 0.115, 0.0022)` 를 대체. 다만 실물 길이라 **기존 박스(115mm)보다 35mm 길다** — 같은 위치에 그대로 놓으면 끝이 17.5mm 더 깊이 들어간다 |
| `penlight.glb` | **렌즈면** (렌즈가 y≈0, 몸통은 +Y) | X −0.0073…+0.0096 / Y −0.0008…+0.1412 / Z ±0.0073 | 빛은 −Y 로 나간다. 기존 `pointLight position={[0.01, -0.16, 0.01]}` 자리에 그대로 놓으면 광원과 렌즈가 일치한다 |

### 재질 이름 (파라미터 조정용)

`penlight.glb` 는 텍스처 없이 **재질 파라미터만으로** 질감을 낸다
(`material-quality-spec.md` §2 의 "단색이 나쁜 게 아니라 PBR 파라미터가 안 잡혀서 나쁘다" 원칙).

| 재질 이름 | metalness | roughness | 대상 |
|---|---|---|---|
| `Penlight_Bezel_Chrome` | 1.0 | 0.11 | 헤드 베젤 (폴리시드 크롬) |
| `Penlight_Body_Aluminum` | 1.0 | 0.33 | 몸통 + 그립 링 6개 |
| `Penlight_Tailcap_Rubber` | 0.0 | 0.72 | 뒤쪽 푸시버튼 (검은 고무) |
| `Penlight_Reflector_Chrome` | 1.0 | 0.06 | 렌즈 안쪽 반사경 |
| `Penlight_Lens_Emissive` | 0.0 | 0.08 | 렌즈. `emissive #fff9e7`, **intensity 1.0 로 내보냈다** — 켜진 느낌은 연결 담당이 `emissiveIntensity` 로 올려라 |
| `Penlight_Clip_Steel` | 1.0 | 0.25 | 포켓 클립 |

> ⚠️ three.js 로 읽으면 몸통이 재질별로 쪼개져 **메시 이름이 `Penlight` / `Penlight_1` / `Penlight_2`** 가 된다.
> 메시 이름 대신 **재질 이름으로 찾아라.** (`Penlight_Reflector` / `Penlight_Lens` / `Penlight_Clip` 은 이름이 유지된다)

`tongue_depressor.glb` 는 재질 1개(`TongueDepressor_Birch`)에 baseColor / metallicRoughness / normal
텍스처가 들어 있다(PNG, 총 137KB). UV 는 결이 길이 방향으로 흐르도록 잡았다.
탄젠트는 넣지 않았다 — three.js 가 노멀맵 사용 시 화면 미분으로 생성한다(용량 절약).

> ⚠️ 이 메시에는 UV 가 있으므로 노멀맵이 정상 동작하지만,
> **`anisotropy` 는 설정하지 마라** (프로젝트 규칙: UV 없는 메시에서 탄젠트 NaN → 블랙아웃 전례).

### 1.1 의사 손 5종 (`hand_*.glb`) — MPFB/MakeHuman 기반 자체 생성, **CC0**

`doctor_arm.glb` 는 정적 메시라 손가락을 쥐게 할 수 없다(1인칭 스펙 §2.2b).
그래서 술기별로 필요한 손 모양을 **MPFB(MakeHuman) 리그를 포즈해서 구워냈다.**

```bash
blender --background --python tools/props/make_doctor_hands.py -- \
        --pose grip_disc --out frontend/public/models/hand_grip_disc.glb
# 포즈: palm / grip_disc / fist / pinch / two_finger
python3 tools/props/qa_hands.py frontend/public/models/hand_*.glb          # 배포 게이트 검사
blender --background --python tools/props/render_hands.py -- <src> <out>   # 포즈 육안 확인(손등/손바닥)
blender --background --python tools/props/check_hand_axes.py -- <glb> <out>  # 축 규약 육안 확인
blender --background --python tools/props/check_grip.py -- \
        frontend/public/models/hand_grip_disc.glb <out>/grip.png           # 청진 그립 검증
```

| 구성요소 | 출처 | 라이선스 |
|---|---|---|
| 바디 메시 + 리그 | MPFB2 (MakeHuman system asset, `game_engine` 리그) | **CC0** |
| 피부 텍스처 | MakeHuman `young_asian_male` 스킨 (`young_lightskinned_male_diffuse3.png`, 2048²) | **CC0** — `.mhmat` 헤더에 "explicitly released as CC0 in september 2020", 저작권자 Data Collection AB |
| 가운 소매·커프 | 실린더 + 토러스 절차 생성 | 우리 저작물 |

> 텍스처는 `doctor_arm.glb` 에서 뽑아 썼는데(`/tmp/doctorarm_tex0.png`),
> **MakeHuman 원본 파일과 픽셀 단위로 완전 동일함을 확인했다**(2048² 전체 최대 차이 0).
> 즉 §3.3 "출처 미상"인 `doctor_arm.glb` 의 라이선스 불확실성이 이 손들로 번지지 않는다.
> 팔과 손이 같은 텍스처를 쓰므로 손목에서 색이 끊기지도 않는다.

**좌표 규약 — `doctor_arm.glb` 와 동일하게 맞췄다.**

> **원점 = 손목, 손끝 = 로컬 −Y, 손바닥 법선 = 로컬 +Z, 오른손.**

`ClinicScene.tsx` 의 `handQuat(finger, palm)` 이 이 규약을 그대로 믿고 쓰므로
**팔 에셋을 손 에셋으로 바꿔도 자세 계산 코드를 손댈 필요가 없다.**
(MakeHuman 원본은 바디 월드 좌표에 있어서 손목이 `x=-0.445, y=0.978, z=0.177` 이다.
정렬 없이 쓰면 손이 환자에게서 1m 떨어진 곳에 뜬다. `--no-align` 으로 원좌표 버전도 뽑을 수 있다.)

생성기는 이 규약을 **추측하지 않고 두 번 검산한다**:
- 손바닥 법선 부호: 기하식(검지너클−새끼너클 × 손끝방향)과 실측(굽힘에 의한 손끝 변위)을 대조.
  실측값 일치도 +0.88 (5개 포즈 전부).
- 손 좌우: 정렬 후 검지너클−새끼너클의 x 부호. 오른손이면 음수여야 한다 (실측 −0.063~−0.065).
  ⚠ **엄지 끝으로 재면 안 된다** — 주먹·집게에서는 엄지가 손바닥을 가로질러 넘어가 정상인데도
  부호가 뒤집힌다(실제로 오판이 나서 이 기준으로 바꿨다).

나란히 나오는 `hand_*.anchors.json` 이 **glTF 축(Y-up), 정렬된 손 로컬 좌표**로 다음을 준다:

| 키 | 뜻 |
|---|---|
| `index_tip` / `middle_tip` / `thumb_tip` | 각 손끝(말절골 본 끝) |
| `grip_two_finger` | 검지끝·중지끝 중점 = **체스트피스가 끼는 자리** |
| `finger_gap_cm` | 검지끝↔중지끝 간격 (grip_disc = 2.01cm) |
| `pinch` | 검지끝·엄지끝 중점 = **설압자·펜라이트가 물리는 자리** |
| `pinch_gap_cm` | 검지끝↔엄지끝 간격 (pinch = 3.02cm) |
| `forearm_axis` | 아래팔 방향 단위벡터. 소매를 의사 팔로 잇는 방향 |
| `hand_bbox_min/max` | 손(소매 제외) bbox. 체표 안착 계산용 |
| `wrist` | 항상 (0,0,0) — 정렬 기준점 |
| `source_wrist` | 정렬 전 MakeHuman 월드 좌표(추적용) |

좌표는 **본 기준**이라 피부 표면은 그보다 5~9mm 바깥이다. 도구를 앵커에 그대로 놓으면
손가락에 살짝 파고든 것처럼 보이는데, 쥔 것으로 읽히므로 오히려 자연스럽다.

> ⚠ `hand_bbox` 로 "최저점을 체표에 앉히는" 방식은 **쓰지 마라.** 최저점이 손목이나 아래팔
> 그루터기라서 손바닥이 체표에서 뜬다(실제로 떴다). 술기별 접촉 지점(손바닥 한가운데 /
> 손끝 / 주먹 척측)을 앵커에서 만들어 그 점을 접촉점에 맞춰야 한다.
> 참고 구현: `frontend/lab/hands/main.ts` 의 `contactLocal()`.

**어트리뷰트 검사(배포 게이트).** 5개 파일 × 3개 프리미티브 전부:
NORMAL·TEXCOORD_0 존재, 길이 0 노멀 0개, POSITION/NORMAL/UV NaN 0개,
**축퇴 UV 삼각형 0개**. UV 생성/노멀 복구 도구(`gltf_gen_uv.py`, `gltf_fix_normals.py`)를 **쓸 필요가 없었다** —
Blender glTF 익스포터가 둘 다 정상적으로 내보낸다. 검사 스크립트는 `tools/props/qa_hands.py`.

> ⚠️ 이 메시들도 **`anisotropy` 금지**. UV 는 있지만 손등·손바닥 UV 가 MakeHuman 아틀라스의
> 좁은 영역(u 0.01–0.55)에 몰려 있어 탄젠트 조건수가 나쁘다.

### 1.2 `gnm_oral_anatomy.glb` — Google GNM v3 기반, **Apache-2.0**

| 항목 | 내용 |
|---|---|
| 원본 | [Google GNM (Generative aNthropometric Model)](https://github.com/google/GNM) v3 `gnm_head.npz` |
| 라이선스 | Apache License 2.0 — 상업 이용·수정·재배포 가능 |
| 수정 내용 | 상악 치아+잇몸, 하악 치아+잇몸, 혀 semantic group만 추출. 구강검사용 개구 자세로 하악과 혀 위치 변경. 웹 실시간 렌더용 재질 적용. |
| 생성기 | `tools/props/build_gnm_oral_asset.py` |
| 라이선스 전문 | `GNM_APACHE_2.0.txt` |

생성본 GLB 오브젝트에도 `source`, `license`, `modified` 메타데이터를 넣었다.
원본 헤드·눈·피부는 배포하지 않고 구강 진찰에 필요한 3개 파트만 남겼다.

---

## 2. Poly Haven — CC0 (퍼블릭 도메인, 출처 표기 불필요)

아래 11개 소품은 **Poly Haven** 에셋이다. API(`api.polyhaven.com/info/<slug>`)로 전부 대조 확인했다.
**CC0 이므로 상업 사용·수정·재배포 자유이고 표기 의무가 없다.** 아래는 예의상 남기는 기록이다.

| 폴더 | Poly Haven 이름 | 저자 |
|---|---|---|
| `desk_lamp_arm_01/` | Desk Lamp Arm 01 | Yann Kervran, Kuutti Siitonen |
| `drawer_cabinet/` | Drawer Cabinet | Ulan Cabanilla |
| `GreenChair_01/` | Green Chair 01 | Kirill Sannikov |
| `metal_office_desk/` | Metal Office Desk | Ulan Cabanilla |
| `metal_trash_can/` | Metal Trash Can | GurJas Studios |
| `potted_plant_01/` | Potted Plant 01 | Rico Cilliers |
| `SchoolChair_01/` | School Chair 01 | Ethan Place |
| `Shelf_01/` | Shelf 01 | Gabriel Radić |
| `wall_clock/` | Wall Clock | PierreB3D |
| `wheelchair_01/` | Wheelchair 01 | Garreth Dean |
| `wooden_bookshelf_worn/` | Wooden Bookshelf Worn | Ulan Cabanilla |

`frontend/public/textures/` 의 PBR 세트도 같은 계열이다:
`brown_planks_05`, `marble_01`, `painted_plaster_wall` = **Poly Haven (CC0)**,
`OfficeCeiling001/005`, `Plaster001/003`, `Tiles074/101`, `WoodFloor043` = **ambientCG (CC0)**.

---

## 3. ⚠️ 라이선스 확인이 필요한 기존 에셋 (내가 만든 것 아님 — 판단은 담당자가)

GLB 내부 `asset.extras` 에 박혀 있는 원본 메타데이터를 읽은 결과다. 추측이 아니라 파일에 적힌 값이다.

### 3.1 `female_hand.glb` — **CC-BY-NC-4.0 (비상업)** → ✅ **2026-07-25 배포 경로에서 제외**

> **처리 완료.** `_unused_assets/female_hand.glb` 로 옮겼고 `frontend/dist/models/` 의 배포본도 지웠다.
> 파일을 삭제하진 않았다 — 되돌리려면 `frontend/public/models/` 로 다시 옮기면 된다.
> 근거: (1) NC 라이선스가 상업 이용 조건과 충돌 (2) `src/` 어디서도 참조하지 않음
> (`ClinicScene.tsx:272` 주석이 이미 폐기를 명시). 부수 효과로 `public/models/` 61MB → 30MB.
> 대체는 MPFB 기반 자체 제작 손(CC0 파이프라인) — **2026-07-25 배포 완료, §1.1 참조.**

아래는 제외 전 기록이다.


```
author : deep3dstudio (https://sketchfab.com/deep3dstudio)
license: CC-BY-NC-4.0
source : https://sketchfab.com/3d-models/female-hand-3e9b8ad1942048e3a267d92fb1124d46
```

**NC = NonCommercial.** 사용자가 세운 그래픽 조건("무료·상업 이용 가능")과 충돌한다.
이 파일은 촉진 손으로 쓰이고 `dist/models/female_hand.glb` 로 그대로 배포된다.
서비스를 유료화하거나 상업적으로 배포할 계획이 있으면 **교체 대상**이다.

### 3.2 청진기 4종 — **Sketchfab Standard License**

`stethoscope.glb`, `stethoscope_u.glb`, `stethoscope_u2.glb`, `stethoscope_full.glb.backup`

```
author : assetfactory (https://sketchfab.com/assetfactory)
license: SKETCHFAB Standard (https://sketchfab.com/licenses)
```

Sketchfab Standard 는 완성물에 넣는 것은 허용하지만 **모델 파일 자체의 재배포를 금지**한다.
웹 앱은 GLB 를 그대로 URL 로 노출하므로 이 조항에 걸릴 소지가 있다.
(`stethoscope_u.glb` · `stethoscope_full.glb.backup` 은 **코드에서 참조하지 않는데도 배포되고 있다** — 최소한 이 둘은 지워도 된다.)

### 3.3 출처 미상

`doctor_arm.glb`, `exam_bed.glb`, `iv_drip.glb`, `privacy_curtain.glb`, `vitals_monitor.glb`,
`hygiene_rig.glb`, `sanitizer_bottle.glb` 는 메타데이터에 저자·라이선스가 없다
(Blender / obj2gltf / glTF-Transform 로 재가공되면서 원본 정보가 지워졌다).
자체 제작이면 문제없고, 외려면 받아온 곳을 확인해 여기에 적어야 한다.

> **부분 해소 (2026-07-25):** `doctor_arm.glb` 의 **피부 텍스처**는 출처가 밝혀졌다.
> MakeHuman `young_asian_male` 스킨(`young_lightskinned_male_diffuse3.png`)과
> 2048² 전 픽셀이 완전히 동일하다(최대 차이 0). 그 에셋은 `.mhmat` 헤더에 **CC0** 로 명시돼 있다.
> 즉 팔 텍스처는 CC0 이고, 남은 불확실성은 **메시(형상)** 뿐이다.

---

## 4. 설압자·펜라이트를 외부 에셋 대신 절차 생성한 근거

`additional-exams-and-fixes-spec.md` §3 이 "적합한 에셋을 못 찾으면 억지로 받지 말고
절차 형상을 개선하라"고 허용한 항목이다. 후보를 실제로 조사한 결과는 다음과 같다.

**후보 (둘 다 Simon Pasi / Sketchfab):**

| 모델 | 라이선스 | 스펙 | 판단 |
|---|---|---|---|
| [Tongue Depressors](https://sketchfab.com/3d-models/tongue-depressors-d98366cb754c448aa392848c210bfef2) | **CC-BY 4.0** | 1.5k tris / 786 verts / 텍스처 없음 | 텍스처가 없어 지금의 단색 박스와 다를 게 없다. **표면**이 문제였지 형상이 아니었다 |
| [LED pen light](https://sketchfab.com/3d-models/led-pen-light-8f069eaf61cf43aabb020fa0feca0d1c) | **CC-BY 4.0** | 508 tris / 268 verts / 512px 텍스처 | 1인칭에서 카메라 20cm 앞까지 오는데 508 tris·512px 는 부족하다. 또 의료용이 아닌 일반 LED 라이트다 |

**받지 않은 이유 3가지:**

1. **다운로드 불가.** Sketchfab 다운로드는 로그인 토큰이 필요하다.
   익명 요청은 둘 다 `HTTP 401` 이고, 저장소에 Sketchfab 토큰이 없다.
   (`curl https://api.sketchfab.com/v3/models/<uid>/download` → 401)
2. **품질이 더 낫지 않다.** 설압자는 형상이 스타디움 판이라 사실상 절차 생성과 동일하고,
   부족한 건 나뭇결·모서리 베벨 같은 **표면**인데 후보 에셋엔 그게 없다.
   펜라이트는 폴리곤·텍스처 해상도가 1인칭 접사에 부족하다.
3. **CC-BY 는 앱 화면 표기 의무가 생긴다.** 자체 제작이면 그 의무가 없다.

**대신 넣은 것 (형상이 아니라 표면에 투자):**

- 설압자: 실물 치수(150×18×2mm), 양끝 반원(R9), **모서리 베벨 0.38mm/3세그먼트**(두께가 읽히는 하이라이트),
  자작나무 결 텍스처 3종. 결은 사인파가 아니라 **간격 자체를 노이즈로 흐트러뜨려** 생성했다
  (규칙적 사인파는 코듀로이/바코드처럼 보였다). 노멀 진폭은 샌딩면답게 극소로 잡았다.
- 펜라이트: 실물 치수(142mm×⌀13mm), 크롬 베젤 · 그립 링 6개 · **포켓 클립** · 테일 푸시버튼 ·
  렌즈 안쪽 반사경. 재질 6종으로 크롬/알루미늄/고무를 구분했다.
  1인칭 접사에서 실루엣이 각져 보여 원주 분할을 36 → **48** 로 올렸다.

**용량:** `tongue_depressor.glb` 172KB (지오메트리 35KB + 텍스처 137KB),
`penlight.glb` 98KB (텍스처 없음). 합계 **270KB** — 첫 로딩 약 50MB 대비 0.5%.

---

## 5. 텍스처 WebP 변환 (`frontend/public/textures/`)

`material-quality-spec.md` §6 지시로 JPG → WebP 를 병행 배치했다. **원본 JPG 는 지우지 않았다** —
연결 담당이 경로를 바꿀 때까지 공존한다.

- **KTX2 를 쓰지 않은 이유**: 코드베이스에 `KTX2Loader` 도 트랜스코더도 없다(`grep` 결과 0건).
  붙이려면 `frontend/src/` 를 고쳐야 하는데 그건 내 담당이 아니다. WebP 는 `THREE.TextureLoader` 가
  그대로 읽으므로 **로더 변경 없이 경로만 `.jpg` → `.webp` 로 바꾸면 된다.**
- **노멀맵에 손실 WebP 를 쓰지 않은 이유**: `cwebp` 손실 모드는 항상 YUV 4:2:0 크로마 서브샘플링을 한다.
  노멀맵은 방향을 R/G 에 담으므로 크로마가 뭉개지면 라이팅이 실제로 틀어진다.
  실측으로 `brown_planks_05_nor_gl_2k` 가 q95 에서도 **PSNR 33.6dB / 최대오차 114** 까지 무너졌다.
  그래서 노멀맵은 **near-lossless** 만 쓰고, 원본 대비 **최대 픽셀오차 ≤ 4/255**(법선 각도 약 1.8°)를
  통과한 것만 채택했다.
- **채택 못 한 3개** (기준을 통과하면서 JPG 보다 작은 후보가 없어 **JPG 유지**, `.webp` 생성 안 함):
  `brown_planks_05_nor_gl_2k`(무손실이 원본의 2.5배), `marble_01_nor_gl_2k`(3배),
  `Tiles101_color`(1K 인데 1.5B/px 인 초고비트레이트 원본이라 어떤 설정도 29dB 를 못 넘김).

**결과: 31.32MB → 15.51MB (49.5%, 15.81MB 절감).**

---

## 6. 앱 화면에 반드시 표기해야 하는 것 (CC-BY 계열)

이 폴더(`models/`)에서 새로 추가된 것 중에는 **없다** — 설압자·펜라이트는 자체 제작이다.
`sounds/exam/CREDITS.md` 에 있는 HLS-CMDS(심음·폐음) 및 MakeHuman 헤어/의상 CC-BY 표기는
그대로 유지해야 한다.
