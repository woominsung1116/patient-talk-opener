# 아바타 리얼리티 고도화 — "블록 붙인 느낌" 제거 (2026-07-25)

관련: `2026-07-25-physical-exam-fidelity-spec.md`, `2026-07-25-exam-region-anchoring-addendum.md`
이 작업은 위 두 작업이 끝난 뒤에 착수한다 (`RealisticPatient.tsx` 충돌 방지).

---

## 0. 조사로 확인된 사실 (추측 아님 — 코드/에셋에서 실측)

| # | 사실 | 근거 |
|---|---|---|
| 1 | 비만 아바타의 배가 **임신 모프**로 만들어져 있다 | `upgrade_mpfb_morphs.py:120-122` `("stomach/stomach-pregnant-incr", 0.55)` |
| 2 | 비만 변형의 실제 부피 증가가 작다 — 몸통 깊이 0.393→0.424 (**+7.7%**) | `mh_f60.glb` vs `mh_f60_ob.glb` accessor min/max 실측 |
| 3 | 커스텀 의상이 **서브디비전을 굽지 않고** 내보내진다 | `build_grandma_casual_donor.py:78,183` `subdiv_levels=1` + `bake_subdiv=False` |
| 4 | 그 결과 의상이 몸보다 **30배 성긴다** — 튜닉 1,736 / 슬랙스 2,011 verts vs 몸 55,784 verts | GLB accessor count 실측 |
| 5 | 기본 제공 의상은 훨씬 조밀하다 — `Worn_out_sweater` 11,857 / `skirt_full_long` 12,672 verts | 동일 |
| 6 | Draco 내보내기에 **양자화 비트가 지정돼 있지 않다** (Blender 기본값 사용: position 14, normal 10) | `upgrade_mpfb_morphs.py:396-397` |

**진단**: 부드러운 고밀도 몸(55k) 위에 각진 저밀도 의상(1.7k)이 얹혀 있고, 배는 전신에 퍼진 지방이 아니라
한 곳에 튀어나온 임신형 돌출이다. 이 둘이 합쳐져 "블록을 붙인" 인상을 만든다.

**하지 말 것 — 이미 잘 돼 있는 것**: 재질/셰이딩은 손대지 마라.
`RealisticPatient.tsx:1022-1068`이 이미 GLB의 clearcoat/sheen을 0으로 죽이고, 피부 roughness를 나이에 따라
0.64~0.73으로 잡고, envMapIntensity·T존·미세요철·노화 거칠기를 셰이더로 넣고 있다. 원인은 재질이 아니라 **지오메트리**다.
(원본 GLB의 `AsianSkin`에 sheen이 붙어 있지만 런타임에서 제거되므로 문제가 아니다.)

---

## 1. 의상 밀도 — 최우선

`build_grandma_casual_donor.py`, `build_floral_dress_donor.py` 둘 다:

1. `bake_subdiv=True`로 바꿔 서브디비전을 **구운 채로** 내보낸다.
2. `subdiv_levels`를 1 → **2**로 올린다. 목표 밀도는 **기본 제공 의상과 같은 급(각 8,000~25,000 verts)**.
   - 결과가 25,000 verts를 크게 넘으면 level 1 + bake로 되돌리고, 그래도 각지면 level 2에서 데시메이트로 조절.
3. 내보내기 전 의상 메시에 **부드러운 셰이딩 + 정점 법선 재계산**을 적용한다
   (`polygon.use_smooth = True`는 이미 있음 — 여기에 더해 `bpy.ops.object.shade_smooth()` 와
   자동 스무스 각도를 두어 실루엣이 아니라 셰이딩 단절이 남지 않게).
4. 검증: 산출 GLB의 각 의상 메시 정점 수를 출력하고, 8,000 미만이면 **빌드를 실패시켜라**.
   (지금처럼 조용히 저밀도로 나가면 아무도 모른다)

> 의상은 이미 `mh_f60_ob` 실제 프로덕션 바디에 피팅되고 있다(`build_grandma_casual_donor.py:7`).
> 피팅 대상은 건드리지 마라 — 밀도만 문제다.

---

## 2. 비만 체형 — 임신 배 → 전신 분포 지방

`upgrade_mpfb_morphs.py`의 `body_targets(weight)` 중 `weight >= 0.8` 분기를 재작성한다.

**제거**: `("stomach/stomach-pregnant-incr", 0.55)`
임신 모프는 배꼽 위로 뚜렷한 경계를 가진 구형 돌출을 만든다. 60대 여성 복부비만의 형태가 아니다.

**대체 방향** (중심성 비만 = 배가 앞뒤로 깊어지고 허리가 사라지며, 얼굴·목·등·팔에도 함께 붙는다):

```python
if weight >= 0.8:
    return [
        # 복부 — 임신형 돌출 대신 '아래로 처지는' 지방 + 복벽 이완
        ("stomach/stomach-tone-decr", 0.85),        # 0.7 → 0.85 (복벽 이완이 핵심)
        ("stomach/stomach-navel-in-out-decr", 0.4), # 배꼽이 지방에 묻힘 (타깃명 확인 필요)
        # 몸통 — 깊이만 키우면 판자가 된다. 가로도 같이 키워 원통에 가깝게
        ("torso/torso-scale-depth-incr", 0.8),
        ("torso/torso-scale-horiz-incr", 0.7),      # 0.4 → 0.7 (깊이/가로 비 완화)
        ("torso/measure-waist-circ-incr", 1.0),
        ("torso/measure-bust-circ-incr", 0.6),
        ("torso/measure-underbust-circ-incr", 0.75),
        ("torso/torso-vshape-decr", 0.6),           # 허리 잘록함 제거 (타깃명 확인 필요)
        # 골반·엉덩이
        ("hip/hip-scale-horiz-incr", 0.65),
        ("hip/hip-scale-depth-incr", 0.6),
        ("buttocks/buttocks-volume-incr", 0.5),
        # 사지
        ("arms/l-upperarm-fat-incr", 0.85), ("arms/r-upperarm-fat-incr", 0.85),
        ("arms/l-lowerarm-fat-incr", 0.5),  ("arms/r-lowerarm-fat-incr", 0.5),
        ("legs/l-upperleg-fat-incr", 0.75), ("legs/r-upperleg-fat-incr", 0.75),
        ("legs/l-lowerleg-fat-incr", 0.4),  ("legs/r-lowerleg-fat-incr", 0.4),
        # 목·얼굴 — 이게 빠지면 "몸만 뚱뚱한 사람" 처럼 보인다
        ("neck/neck-scale-horiz-incr", 0.6),
        ("neck/neck-scale-depth-incr", 0.55),
        ("neck/neck-double-incr", 0.5),             # 이중턱 (타깃명 확인 필요)
        ("chin/chin-jaw-drop-incr", 0.3),           # (타깃명 확인 필요)
        ("cheek/l-cheek-volume-incr", 0.5), ("cheek/r-cheek-volume-incr", 0.5),
    ]
```

> ⚠️ **타깃 이름을 추측하지 마라.** MPFB에 실제로 존재하는 타깃만 써야 한다.
> `TargetService.target_full_path(leaf_name)`가 None이면 현재 코드는 **조용히 건너뛴다**(`:257`).
> 그래서 지금 몇 개가 실제로 적용됐는지 아무도 모른다.
>
> 반드시 할 것:
> 1. 빌드 전에 MPFB의 사용 가능한 타깃 목록을 덤프해 실제 이름을 확인하고, 위 목록을 실제 이름으로 교정하라.
> 2. `body_targets`의 누락 처리를 **경고가 아니라 오류**로 바꿔라. 요청한 타깃이 없으면 빌드가 실패해야 한다.
>    (선택적으로 `optional=True` 플래그를 가진 타깃만 건너뛰기 허용)
> 3. 최종 보고에 "요청한 N개 중 M개 적용, 미적용 목록"을 반드시 적어라.

**마름(`weight <= 0.2`) 분기**도 같은 원칙으로 점검한다 — 갈비뼈 노출·쇄골 돌출·볼 꺼짐이 있어야 마른 사람으로 읽힌다.

**검증 지표**: 재생성 후 `mh_f60_ob`의 몸통 깊이/키 비율이 현재 0.285에서 **0.33 이상**으로,
허리 둘레 대비 가슴 아래 둘레 비가 1.0 이상(허리가 사라짐)으로 나와야 한다.
`mh_f60`(정상)과 비교해 배만 튀어나온 게 아니라 팔·목·얼굴도 함께 굵어졌는지 수치로 보여라.

---

## 2.5 헤어 — 남성 3종이 텍스처 없이 불투명하게 나가고 있다 (최우선, 실측 확인됨)

전 아바타 헤어 메시를 조사한 결과:

```
mh_m30.glb   hair_05(2,604v, 텍스처 없음, alphaMode=OPAQUE)   ← 문제
mh_m40.glb   hair_05(2,604v, 텍스처 없음, alphaMode=OPAQUE)   ← 문제
mh_m60.glb   hair_05(2,604v, 텍스처 없음, alphaMode=OPAQUE)   ← 문제

mh_m20/m50   maxwell_hair_mh(765v, tex, BLEND)     정상
mh_m70       elvs_grumphair(9,522v, tex, BLEND)    정상
mh_f*        bob_*/ponytail01/long_alpha7 (tex, BLEND)  정상
```

헤어 메시는 **알파로 잘라내는 카드(판) 구조**라 알파 텍스처가 있어야 머리카락으로 보인다.
`hair_05`만 텍스처가 없고 `OPAQUE`라서 판이 그대로 드러나 **니트 모자/블록처럼** 보인다.
사용자가 지적한 "블럭 붙인 느낌"의 직접적 원인 중 하나다.

> 참고: 과거 `mh_m40` 블랙스크린의 원인도 이 메시였다("UV 없는 헤어에 anisotropy → 탄젠트 NaN").
> 그때는 런타임에서 anisotropy를 끄는 것으로 증상만 막았고, 텍스처가 없다는 근본 원인은 남아 있다.

**할 일 (아래 중 택1, 렌더로 확인 후 결정):**
1. `hair_05`에 알파 텍스처와 UV를 부여하고 `alphaMode=BLEND`(+ `alphaCutoff` 또는 `MASK`)로 내보낸다.
   MPFB/MakeHuman 에셋 팩에 원본 텍스처가 있는지 `tools/avatar_pipeline/assets/` 와 vendor 경로를 먼저 뒤져라.
2. 원본 텍스처를 못 찾으면 **정상 동작하는 헤어로 교체**한다
   (`maxwell_hair_mh` 또는 `elvs_grumphair` — 둘 다 텍스처·BLEND 정상).
   단 `mh_m70`/`mh_oldm`이 이미 `elvs_grumphair`를 쓰므로, 40·60대에 백발 곱슬을 주면 나이가 안 맞는다.
   연령대에 맞는 것을 고르고, 세 아바타가 전부 같은 머리가 되지 않게 하라.

**검증**: 남성 4종(m20/m30/m40/m60)을 나란히 렌더해 머리가 판때기로 보이지 않는지 확인.
알파 정렬 아티팩트(뒤 카드가 앞으로 비침)가 생기면 `depthWrite`/`alphaTest` 조합을 조정하라.
**anisotropy는 절대 쓰지 마라** — 이 메시가 바로 블랙스크린을 냈던 그 메시다.

---

## 2.6 21개 전수 조사에서 추가 발견 (2026-07-25, 실측)

사용자 지시로 전 아바타를 훑은 결과. **§2.5 헤어 다음으로 이것들을 처리한다.**

### (a) `mh_m40.glb`에 Blender 기본 큐브가 남아 있다 — 최우선

```
mesh 'Cube'  정점 24  재질 'Material' (기본 회색 baseColorFactor 0.8/0.8/0.8, 텍스처 없음)
bbox -1,-1,-1 ~ 1,1,1  →  2m 정육면체
node 'Cube'  skin 없음  →  본을 안 따라가고 원점(발밑)에 고정
```

환자 키가 1.489m인데 2m 큐브가 원점에 박혀 있고, 런타임에 거르는 코드도 없다.
Blender 시작 씬의 기본 큐브를 지우지 않고 내보낸 것이다. **반드시 제거하라.**

- `upgrade_mpfb_morphs.py`는 시작 시 모든 오브젝트를 지우므로, 정상 경로로 재생성하면 사라진다.
  m40이 다른 경로(`--morph-normals` 실험 등)로 만들어졌을 가능성이 높다 — 그 경로를 찾아 같은 정리를 넣어라.
- 재생성 없이 급히 고칠 거면 GLB에서 해당 노드/메시/재질만 제거해도 된다.
- **재발 방지**: 배포 검증(`batch_upgrade.py --validate-only`)에
  "스킨 없는 메시" 또는 "이름이 Cube/Sphere/Plane 인 메시" 또는 "재질명이 정확히 'Material'인 것"이 있으면
  **실패시키는 체크를 추가하라.** 지금은 이런 게 들어가도 아무도 모른다.

### (b) 저밀도 의상 (곡면에서 각져 보임)

| 아바타 | 메시 | 정점 | 비고 |
|---|---|---|---|
| `mh_m20`, `mh_youngm` | `cargo_pants` | 1,177 | 다른 바지는 8,000~12,000. 혼자 7배 성김 |
| `mh_f30`, `mh_f30_thin` | `vnecktop` | 5,421 | 경계선 — 렌더로 확인 후 판단 |
| 전 아바타 | `crudelowsocks` | 312 | 바지·책상에 가려 거의 안 보임. **후순위, 무리하지 마라** |

§1의 서브디비전 굽기와 같은 방식으로 처리한다. 8,000 미만이면 빌드 실패시키는 규칙(§1-4)을
**케이스별로 예외를 두지 말고** 적용하되, 양말처럼 화면에 안 나오는 것은 예외 목록에 명시적으로 넣어라.

### (c) 정상 확인된 것 — 건드리지 마라

몸통 메시 55,784 정점 + ARKit 모프 67개가 **21개 전부 일관**된다. 본체 지오메트리엔 결함이 없다.
체형 문제는 모프 값(§2)의 문제지 메시 품질 문제가 아니다.

---

## 3. Draco 양자화 명시

`upgrade_mpfb_morphs.py` / 두 의상 donor 스크립트의 export_kwargs에 명시적으로 추가:

```python
"export_draco_position_quantization": 16,   # 기본 14
"export_draco_normal_quantization": 16,     # 기본 10 — 부드러운 곡면의 셰이딩 계단현상 원인
"export_draco_texcoord_quantization": 14,
"export_draco_generic_quantization": 16,    # 모프 타깃 델타
```

- 이건 **가설**이다. 반드시 전/후 렌더를 비교해 실제로 좋아지는지 확인하라.
- 파일 크기 증가를 측정해서 보고하라. 아바타 1개가 20MB를 넘으면 normal만 16으로 두고 나머지는 되돌려라
  (현재 12MB 내외, `mh_m40`은 이미 24.5MB로 큰 편 — 이건 `--morph-normals`로 만들어진 예외다).
- 개선이 눈에 안 보이면 **되돌리고 그렇게 보고하라.** 크기만 키우는 변경은 하지 마라.

---

## 4. 렌더 QA — 전/후 비교가 이 작업의 핵심 산출물

기존 도구가 있다: `tools/avatar_pipeline/render_morph_qa.py`, `render_garment_qa.py`.

1. **먼저 현재 상태(before)를 캡처하라.** 최소: `mh_f60_ob`(비만), `mh_f20_thin`(마름), `mh_f60`(정상 대조).
   각각 정면·측면(45°). 측면이 중요하다 — 배 돌출 형태는 옆에서 봐야 보인다.
2. 수정 후 같은 앵글로 다시 캡처(after).
3. before/after를 나란히 놓고 판단하라. **"코드상 맞다"는 근거가 아니다.**
4. 캡처는 `/private/tmp/claude-501/-Users-woominseong-Desktop----/6719fbd2-d125-4e36-b744-ea010e7e8d6f/scratchpad/avatar_qa/` 아래 저장하고 최종 보고에 경로를 적어라.

판단 기준 (사람이 볼 때):
- 배가 **공을 붙인 것처럼 경계가 지지 않고**, 가슴 아래에서 골반까지 완만하게 이어지는가
- 의상 실루엣에 **각진 면(패싯)이 보이지 않는가** — 특히 배·엉덩이 같은 곡면
- 의상이 몸을 파고들거나 뜨지 않는가
- 비만 아바타의 **팔·목·얼굴**도 함께 굵은가 (몸통만 굵으면 붙인 티가 난다)

---

## 5. 배포와 캐시 무효화

1. `python3 tools/avatar_pipeline/batch_upgrade.py` 로 스테이징 → 검증 통과 확인
2. `python3 tools/avatar_pipeline/batch_upgrade.py --reuse-staged --deploy` 로 배포
   (배포는 all-or-nothing — 21개가 전부 검증을 통과해야 교체된다)
3. **`RealisticPatient.tsx`의 `AVATAR_VER`를 반드시 올려라.** URL 캐시버스팅(`?v11` 형태)이라
   안 올리면 브라우저가 옛 GLB를 계속 쓴다. (이 파일은 선행 작업이 끝난 뒤에 만져라)
4. `frontend`는 dist 서빙이므로 `npm run build`를 다시 돌려야 public 에셋이 dist로 복사된다.
5. 의상 GLB 경로가 바뀌면 `clinicalGarments.ts` / 의상 로딩부도 확인 (읽고 필요할 때만 수정)

---

## 6. 회귀 방지

- 21개 아바타 전부 `batch_upgrade.py --validate-only` 통과 (rig + 텍스처 + 67개 타깃명)
- ARKit 모프 67개가 살아 있어야 한다 — 표정·립싱크·두경부 진찰(`jawOpen` 등)이 여기 의존한다
- 진찰 단계에서 옷을 걷어올리는 기능(`clinicalGarments`: upper `worn`→`raised`, privacyDrape)이 여전히 동작해야 한다.
  의상 메시 이름이 바뀌면 이 매칭이 깨진다 — 이름을 바꾸지 마라
- `mh_m40` 블랙스크린 재발 주의: UV 없는 메시에 anisotropy 금지 (탄젠트 NaN → 화면 전체 검정)
- 얼굴은 사진 투영으로 만든 정체성이 있다(`photo-face-projection-v13`). 체형 모프가 얼굴 정체성을 망가뜨리지
  않는지 확인하라 — 볼/턱 타깃을 넣을 때 특히.
