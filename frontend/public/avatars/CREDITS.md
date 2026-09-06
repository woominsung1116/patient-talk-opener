# 아바타 에셋 출처 및 라이선스 (`frontend/public/avatars/`)

이 폴더의 파일은 **빌드 시 `dist/avatars/` 로 그대로 복사되어 누구나 URL 로 내려받을 수 있다.**
따라서 "모델 파일 재배포 금지" 조건이 붙은 에셋은 여기에 두면 안 된다.

> **이 문서가 없어서 사고가 났다.** `models/CREDITS.md` 는 `models/` 폴더만 다뤘고,
> `avatars/` 를 다루는 크레딧 문서가 없어서 **48MB 의 RenderPeople 아바타가 어떤 문서에도
> 잡히지 않은 채 배포되고 있었다**(2026-07-25 감사에서 발견, §5 참조).
> 새 아바타 계열을 추가하면 **반드시 여기에 한 줄 적어라.**

소품·텍스처는 `models/CREDITS.md`, 청진음·헤어/의상 상세는 `sounds/exam/CREDITS.md` 에 있다.

---

## 요약

| 계열 | 개수 | 라이선스 | 상업 이용 | 재배포 | 표기 의무 | 상태 |
|---|---|---|---|---|---|---|
| MakeHuman / MPFB | 21 | **CC0 1.0** | ✅ | ✅ | 불필요 | 사용 중 (주력) |
| VALID | 6 | **MIT** | ✅ | ✅ | 고지 유지 | 폴백 |
| Microsoft Rocketbox | 3 | **MIT** | ✅ | ✅ | 고지 유지 | 사용 중 |
| RenderPeople | 3 | **독점(재배포 금지)** | ✅ | ❌ | — | **배포 제외됨** |

---

## 1. MakeHuman / MPFB (CC0) — 주력 아바타

`mh_*.glb` 21종. `tools/avatar_pipeline/` 의 MPFB2 헤드리스 파이프라인으로 자동 생성한다.

| 파일 | 용도 |
|---|---|
| `mh_m20/30/40/50/60/70.glb`, `mh_f20/30/40/50/60/70.glb` | 20~70대 남녀 12종 (주력 풀) |
| `mh_f20_thin.glb`, `mh_f30_thin.glb`, `mh_f60_ob.glb` | 체형 변형 (마름/비만 — 진단 단서) |
| `mh_boy.glb`, `mh_girl.glb` | 아동 |
| `mh_youngm/youngf/oldm/oldf.glb` | 레거시 (12인 배포 전 폴백) |
| `mh_f60_ob_floral_dress.glb`, `mh_f60_ob_grandma_casual.glb` | 의상 변형 |

- **본체·스킨**: MakeHuman 시스템 에셋 (`makehuman_system_assets_cc0.zip`) — **CC0 1.0**
  - `skin/LICENSE.md` 에 upstream 파일명 매핑까지 적혀 있다
- **CC0 는 상업 이용·수정·재배포 자유이고 표기 의무가 없다.**

### ⚠️ 1.1 예외 — AGPL3 헤어가 배포되고 있었다 (2026-07-28 감사, 해소됨)

**MPFB 계열 전체를 CC0 로 적어 둔 위 표는 헤어에 대해 틀렸었다.** MPFB 헤어
라이브러리는 CC0·CC-BY·AGPL3 가 섞여 있고, 라이선스는 `.mhclo` 첫 줄들의
`# license` 주석에만 있다. 그래서 아무 검사에도 걸리지 않은 채 **AGPL3 헤어가
셋 실려 나가고 있었다**:

| 아바타 | 헤어 | 라이선스 | 조치 |
|---|---|---|---|
| `mh_f20_thin` | `sonntag78_junglebook_hair` | **AGPL3** | → `toigo_inverted_bob` (CC0) |
| `mh_m40` | `culturalibre_hair_02` | **AGPL3** | → `short02` (CC0) |
| `mh_boy` | `culturalibre_hair_02` | **AGPL3** | → `short03` (CC0) |
| `mh_m20`, `mh_m50` | `elvs_maxwell_hair` | **출처 불명** — 로컬 라이브러리에 원본이 없다 | → `short03` / `short01` (CC0) |

> AGPL3 는 네트워크로 제공하는 저작물에도 소스 공개 의무가 걸린다(§13).
> 상용 배포를 전제로 한 이 프로젝트에서는 **쓸 수 없다.**

**헤어를 바꾸거나 추가할 때 반드시 확인해라:**

```sh
grep -i "^# *license" ~/Library/Application\ Support/Blender/*/extensions/.user/\
user_default/mpfb/data/hair/<asset>/*.mhclo
```

CC0 로 확인된 것만 쓴다: `toigo_*` 6종(저작자 MRT), `culturalibre_hair_05/06`,
`faydaen_hair_1`, 그리고 MakeHuman 시스템 기본 헤어(`short01~04`, `bob01/02`,
`long01`, `ponytail01`, `braid01`, `afro01` — 시스템 에셋 팩과 함께 CC0).

### ⚠️ 1.2 예외 — CC-BY 가 섞인 의상 하나

`avatars/clothes/LICENSE.md` 기준:

| 에셋 | 라이선스 | 저작자 |
|---|---|---|
| `janexx_old_female_sweater` (Shirts 02) | CC0 | janexx |
| `mindfront_female_trousers_1` (Pants 02) | **CC BY 4.0** | **Mindfront** |
| `muted_floral.png` (Dress 01 파생) | CC0 | toigo |

**`mh_f60_ob_grandma_casual.glb` 에 Mindfront 바지가 들어 있고, 이 아바타는
`RealisticPatient.tsx:2921` 에서 실제로 사용된다.**

> ❗ **CC-BY 는 저작자 표시가 조건이다. 현재 앱 화면 어디에도 표기가 없다.**
> 소스 주석에만 있고 최종 사용자에게 보이지 않으므로 **요건 미충족 상태다.**
> UI 크레딧 화면에 아래를 넣어야 한다:
> > Trousers by Mindfront, licensed under CC BY 4.0.
> > https://static.makehumancommunity.org/assets/assetpacks/pants02.html

---

## 2. VALID (MIT) — 폴백 아시아 아바타

`valid_af1/af2/af3.glb`, `valid_am1/am2/am3.glb` 6종.

- **VALID: Validated Avatar Library for Inclusion and Diversity**
- **MIT 라이선스** — 상업 이용·수정·재배포 전부 허용
- `avatarVariant.ts:8` 이 폴백 경로로 분류한다

MIT 는 저작권 고지 유지를 요구한다. 이 문서가 그 역할을 한다.

---

## 3. Microsoft Rocketbox (MIT)

`hyunwoo.glb`, `jieun.glb`, `sujin.glb` 3종. `avatarVariant.ts:25` 의 `ROCKETBOX` 집합.

- **MIT 라이선스** — 상업 이용·재배포 허용. 웹 배포에 문제없다.
- 케이스 JSON 이 이 세 이름을 직접 지정한다.

### ⚠️ 3.1 결함 — 텍스처 참조가 깨져 있다

세 파일 모두 **내장 텍스처가 하나도 없고**, 대신 윈도우 절대경로를 그대로 참조한다:

```
D:\temp\Humans\with_opacity_version\f001\textures\f001_body_color.tga
D:\temp\Humans\without_opacity_version\m001\textures\m001_head_normal.tga
...
```

파일당 6~7개, 합계 20개 참조가 전부 존재하지 않는 경로다.
`RealisticPatient.tsx:355` 가 `/avatars/skin/asian_*.png` 를 별도로 입히기 때문에
화면에서 바로 티가 나지는 않는 것으로 보이지만, **자산 자체는 깨진 상태다.**

> 이번 압축 작업에서는 **손대지 않았다** — 텍스처 재인코딩 범위 밖이고,
> 스킨 오버라이드 로직과 얽혀 있어 함부로 지우면 회귀 위험이 있다.
> 파일 크기는 8~12MB 인데 **전부 모프타깃 데이터**라 압축 여지도 없다.

---

## 4. ❌ RenderPeople — 배포 경로에서 제외됨 (2026-07-25)

`carla.glb`(22.0MB) · `claudia.glb`(20.9MB) · `eric.glb`(6.1MB) = **48.2MB**

**→ `_unused_assets/renderpeople/` 로 이동했고 `dist/avatars/` 배포본도 삭제했다.**
파일을 지우진 않았다. 되돌리려면 `frontend/public/avatars/` 로 다시 옮기면 된다.

### 사유

**RenderPeople 이용약관 §4.3(b)** — 3D 데이터는 "must not be directly circulated" 이며,

> "making the 3D data available in a way that allows third parties to
> **easily download, extract, distribute, or otherwise access**" 하는 것을 금지한다.

또한 라이선시는 제3자 추출을 막도록 "according to the current state of technology"
저장해야 한다. **정적 파일 서빙은 그 요구의 정반대다** — `https://<host>/avatars/carla.glb`
로 22MB GLB 가 그대로 떨어졌다.

> **상업 이용 자체는 허용된다** (무료 모델도 "free commercial use").
> 문제는 상업성이 아니라 **재배포·추출 가능성**이다. 이 구분이 중요하다.

### 잃은 것이 없는 이유

- `pickAvatarVariant()` 는 **`mh_*` 만 반환한다.** RenderPeople 은 개발용
  `debugAvatarVariant()`(`?av=carla`)로만 도달 가능했다.
- 케이스 JSON 은 Rocketbox 3종만 지정한다.
- 즉 **게임플레이에 전혀 쓰이지 않으면서 48MB 가 배포되고 있었다.**
- 잃는 것은 `?av=carla` 디버그 경로뿐이다.

출처 근거는 `frontend/src/three/avatarVariant.ts:26`:
```ts
const RENDERPEOPLE: ReadonlySet<string> = new Set<RPVariant>(['carla', 'eric', 'claudia'])
```
(GLB 메타데이터에는 저자·라이선스가 없다 — 재가공되며 지워졌다.)

---

## 5. 이 문서가 생긴 경위

2026-07-25 배포 자산 라이선스 전수 감사(`docs/specs/2026-07-25-asset-license-audit.md`)에서
RenderPeople 건이 드러났다. 근본 원인은 **`avatars/` 를 다루는 크레딧 문서가 없었다는 것**이다.
`models/CREDITS.md` 는 소품만 다뤘고, 아바타는 350MB 로 저장소에서 가장 큰 덩어리인데도
어떤 문서에도 출처가 적혀 있지 않았다.

**규칙: 아바타 계열을 추가하면 여기에 출처·라이선스·재배포 가부를 적어라.**
특히 **"완성물에 넣는 것은 되지만 파일 재배포는 안 된다"** 류(Sketchfab Standard,
RenderPeople, TurboSquid 등)는 웹 게임 구조상 **자동으로 위반**이 된다.

---

## 6. 텍스처 압축 (2026-07-25)

아바타의 **내장 텍스처만** 재인코딩했다.
지오메트리·모프타깃·본/노드/재질 이름은 한 톨도 건드리지 않았고, 32개 전부 프로그램으로 대조
검증했다 (`tools/props/verify_avatar_identity.py` — 모프타깃 이름·순서·가중치, 본 이름·순서·IBM,
노드 계층·TRS, 재질/메시 이름, 지오메트리·모프 데이터 해시, Draco bufferView 참조).

먼저 측정한 뒤 정책을 정했다. **내장 이미지 346장은 이미 전부 WebP 였고 지오메트리는 이미
Draco 압축 상태**라 포맷 변환으로 얻을 것이 없었다. 실제 레버는 해상도 하나뿐이었고,
이미지 144.5MB 중 `normal` 2048² 78장이 105.9MB(73%)로 압도적이었다.

| 대상 | 정책 | 근거 |
|---|---|---|
| 옷 normalTexture | 2048² → **512²** + near-lossless | 노멀맵은 노이즈성이라 손실 WebP 가 26dB 대로 무너진다. near-lossless 는 해상도와 무관하게 46dB 를 유지하므로 **코덱을 고정하고 해상도로만** 줄였다 |
| 옷 baseColor / MR | 2048² → 1024² + 손실(게이트 통과 시) | 사진성이라 손실이 잘 먹는다 |
| 헤어 diffuse | 2048² → 1024² + **near-lossless(nl60)** | hair2 교정본 주입 후 압축. 아래 ⚠️ 참조 |
| 헤어 normal / spec | 옷과 동일 기준 | hair2 가 손댄 적 없는 baked 맵이다 |
| **얼굴 계열** | **바이트 단위로 무변경 보존** | 아래 참조 |

> ⚠️ **헤어 diffuse 에 손실 WebP 를 쓰면 안 된다.** 크기만 보고 고르면 q85 가 이기는데,
> PSNR 게이트(이미지 전체 42dB)는 통과하면서 **가닥 고주파만 따로 깎는다.**
> 실측: q85 는 해상도 손실 위에 hf_rel 을 추가로 **−13.1%**(mh_f70) 깎지만
> nl60 은 **−0.4%** 다. 크기 차이는 장당 250KB 뿐이다.
> 가닥 대비가 hair2 교정의 결과물 자체라 여기서 아끼면 교정이 무의미해진다.
>
> ⚠️ **`mh_f20` 의 BlackHair 만 3600² 라 예외로 2048² 까지만 내린다.**
> 1024² 로 3.5배 줄이면 hf_rel 이 −45% 로 무너져 프로젝트 허용 기준선
> (`mh_f20_thin` 을 같은 방식으로 내렸을 때의 7.69%) 아래인 5.55% 가 된다.
> 2048² 면 7.89% 로 기준선을 넘는다. 비용은 +1MB.

> **얼굴(피부·눈·치아·혀·눈썹·속눈썹)은 해상도 유지가 아니라 아예 손대지 않았다.**
> 얼굴 계열은 다 합쳐도 아바타당 0.6MB 라 줄여봐야 얻는 게 없는데(덩치는 옷 노멀맵이다),
> 안 건드리면 "결막 창백·공막 황달·혀 위축이 뭉개졌는가"를 렌더로 논쟁할 필요 없이
> **해시 동일**로 끝난다. 실제로 눈 근접 렌더가 원본과 **픽셀 단위로 완전히 동일**하다.

**결과: 배포 중인 GLB 21종 156.8MB(원본 32종 303.3MB), `skin/` 23.1MB → 6.8MB.**
도달 불가능한 아바타 11종을 `_unused_assets/avatars/` 로 뺀 뒤
**폴더 전체 350MB → 187MB**, 주력 `mh_*` 는 **1종당 평균 6.9MB**(최대 8.1MB).

> ⚠️ **1종당 7MB 이하 목표는 달성하지 못했다.** 18종 중 7종만 7MB 이하이고
> 나머지 11종은 7.0~8.1MB 다. 남은 것은 텍스처가 아니라 **모프타깃 3.7MB + Draco
> 지오메트리 1.5~2.3MB = 아바타당 5.2~6.0MB 의 바닥**이라 텍스처로는 더 못 줄인다.
> 옷 baseColor 를 512² 까지 내려봐도 0.2~0.4MB 밖에 못 줄이면서 옷 무늬가 눈에 띄게
> 뭉개져 채택하지 않았다. 더 줄이려면 모프타깃을 손대야 하는데 표정·시선·구강 진찰이
> 걸려 있어 금지 사항이다.
>
> 참고로 **헤어 가닥 보존을 택하면서 목표에서 더 멀어졌다** — 헤어를 손실 WebP 로
> 두면 평균 6.7MB(초과 10종)였지만 near-lossless 로 바꾸면서 6.9MB(초과 11종)가 됐다.
> 용량보다 진단·표현 품질이 우선이라는 판단이다.

### ⚠️ `skin/*.png` 는 사실 WebP 다 (확장자만 .png)

`RealisticPatient.tsx:355` 가 경로를 `/avatars/skin/asian_${tier}_${성별}.png` 로
**하드코딩**하고 있어서 파일명을 바꿀 수 없었다. 브라우저의 `<img>` 디코딩은 확장자가 아니라
**내용을 스니핑**하므로 `.png` 이름의 WebP 도 `THREE.TextureLoader` 가 정상적으로 읽는다
(실제로 테스트해서 2048×2048 로 디코드되는 것을 확인했다).

| 파일 | 이전 | 이후 | 품질 |
|---|---|---|---|
| `asian_young_female.png` | 3.70MB | 330K | q92 / 44.2dB |
| `asian_young_male.png` | 3.43MB | 370K | q92 / 44.1dB |
| `asian_middle_female.png` | 3.63MB | 324K | q92 / 44.2dB |
| `asian_middle_male.png` | 3.56MB | 419K | q92 / 44.0dB |
| `asian_old_male.png` | 4.28MB | 675K | q95 / 45.8dB |
| `asian_old_female.png` | 4.55MB | 804K | q97 / 44.3dB |

> **2026-08-02 갱신** — 노년 2장은 붉은 치우침을 걷어내면서 다시 인코딩했다
> (`tools/avatar_pipeline/neutralize_old_skin.py`, 사유는 `skin/LICENSE.md`).
> 그 김에 `asian_old_female` 도 WebP 로 넘겼다: 4.55MB → 804K.
> 예전에 "게이트 미통과"로 원본을 유지했던 건 q92 기준이었고, 품질을 올리면
> 넘어간다. 이제 **44dB 게이트가 스크립트 안에 들어 있어** 통과하는 가장 낮은
> 품질을 자동으로 고르고, 못 넘기면 예외를 던진다 — 다음 사람이 이 판단을
> 조용히 뒤집지 못하게 하려는 것이다(내가 한 번 그렇게 했다).

> 파일을 이미지 편집기로 열면 PNG 가 아니다. 갱신할 때는 `cwebp -q 92 -sharp_yuv` 로
> 다시 만들고 확장자를 `.png` 로 두면 된다. `src/` 경로를 고칠 수 있게 되면
> 정직하게 `.webp` 로 바꾸는 편이 낫다.

> ⚠️ 이 아바타들은 **KHR_draco_mesh_compression** 을 쓴다.
> Draco 는 확장 안에서 bufferView 를 **직접** 가리키므로, 일반적인 glTF 재패킹
> (참조 없는 bufferView 제거 + 인덱스 재매핑)을 하면 **지오메트리가 조용히 깨진다.**
> 반드시 bufferView 인덱스를 보존한 채 이미지 내용만 교체해라
> (`gltf_kit.save_glb(..., preserve_views=True)`).
