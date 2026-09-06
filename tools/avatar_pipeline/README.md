# MPFB facial-morph upgrade pipeline

This pipeline preserves each production avatar's photo-projected skin,
clothing, hair, accessories and rig while replacing its baked static body with
an identity-matched MPFB body containing real facial morph targets.

The vendored target packs are the official MakeHuman Community **Face Units
01** (52 ARKit-compatible face units) and **Visemes 02** (15 Meta-style
visemes). Their metadata declares the assets CC0. The original downloads are
kept in `vendor/`; extracted targets live in `assets/targets/` so Blender runs
offline and reproducibly.

Sources:

- https://static.makehumancommunity.org/assets/assetpacks/faceunits01.html
- https://static.makehumancommunity.org/assets/assetpacks/visemes02.html

`upgrade_mpfb_morphs.py` must be run through Blender with the MPFB extension
installed. It deliberately exports without applying the armature, which is
required for glTF morph targets to survive.

To stage and validate every production MPFB character:

```sh
python3 tools/avatar_pipeline/batch_upgrade.py
```

To re-check the exact files currently served by the application without
starting Blender:

```sh
python3 tools/avatar_pipeline/batch_upgrade.py --validate-only
```

High-density subdivision is enabled by default: the validator requires at
least 50,000 render vertices in the morph body. Use `--no-subdivide` only for
an explicit low-memory/mobile experiment.

`--draco-hq` is a rejected experiment kept for reproducibility. Raising Draco
quantization from Blender's defaults (position 14 / normal 10) to 16/16/14 was
supposed to remove shading stair-stepping on smooth curves. Measured on
`mh_f60_ob`: 875 of 682,000 rendered pixels differed by more than 4/255, all of
them on silhouette edges, while the file grew 12.27 MiB → 12.58 MiB. The same
test on the garment donor moved 190 pixels for a 40% file increase. Do not
enable it without new evidence.

`--morph-normals` is retained as an explicit cinematic experiment. With the
current restrained facial weights it produced no visible 900 px regression
gain while increasing a representative avatar from 11 MiB to 24.6 MiB, so it
is intentionally not the production default.

Add `--deploy` only after the staged set has passed validation. Deployment is
all-or-nothing: no production GLB is replaced until all 21 outputs contain the
required rig, textures and 67 target names.

After a successful staging run, deploy those exact already-validated files
without regenerating them:

```sh
python3 tools/avatar_pipeline/batch_upgrade.py --reuse-staged --deploy
```

## Obese older-patient everyday outfit

The obese older female uses a separately fitted floral long tunic and matte
charcoal female trousers. Both remain independently removable for examination:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/avatar_pipeline/build_grandma_casual_donor.py
```

Sources are vendored under `assets/clothes/janexx_old_female_sweater/` and
`assets/clothes/mindfront_female_trousers_1/`. Runtime removes legacy gloss and
drives the donor skeleton from the production patient's pose.

Garment subdivision is baked explicitly. MPFB only attaches a SUBSURF modifier
with `levels=0`, and the glTF export runs with `export_apply=False`, so an
unbaked modifier is silently discarded — that is how the tunic used to ship at
1,736 vertices against a 55,784-vertex body. `garment_density.py` derives the
level from the fitted base density, because a fixed level cannot serve both the
1,736-vertex tunic (needs level 2) and the 6,774-vertex dress (level 2 would
reach 104,000). A garment below 8,000 vertices now fails the build.

## Shared tables

`body_shape_targets.py` owns the obese/thin morph tables. The body build and
both garment donors import it: the donors must fit the *same* body the patient
ships with, and a copied list can drift without anything failing.

Missing MPFB targets are now errors, not warnings. Previously
`TargetService.target_full_path()` returning `None` only printed a line, so
nobody knew how many of the requested targets actually applied. Each run prints
`requested=N applied=M missing=0`.

## Hair

Three male avatars shipped a `culturalibre_hair_05` mesh with no texture and
`alphaMode=OPAQUE`. That asset is a solid shell, not alpha cards — its own
1024² texture is uniformly opaque — so it read as a knit cap. Avatars can name
a replacement MPFB hair asset in `characters.json`:

```json
{ "name": "mh_m30", "gender": 1, "age": 0.577, "weight": 0.50, "hair": "short04" }
```

The fitted hair is renamed to include `hair` in both the mesh and material name
because `RealisticPatient.tsx` classifies materials by that token. Pick assets
without `delete_verts` in their MHCLO: the build fails on hair that would punch
a hole in the scalp, since the physical exam needs the whole body.

**Never enable anisotropy on a hair material without UVs** — that produced NaN
tangents and a full-screen black frame. The replacement assets all carry UVs
and alpha textures, but the runtime guard stays.

### 2026-07-28 — 헤어 전면 교체 (라이선스 + 화질)

**모든 아바타가 이제 `hair` 를 명시한다.** 예전에는 지정하지 않은 아바타가
소스 GLB의 헤어를 그대로 통과시켰는데, 그 통과분은 **이전 압축 패스에서
1024² 로 줄어든 텍스처**였다. 그 해상도에서 가는 가닥이 고주파 잡티가 되어
`f60`·`f70` 이 수세미처럼 보였다(실측: 통과분 1024² (35,28,25) vs
재생성분 3600² (37,37,37)). 지정하면 원본 해상도로 다시 굽는다.

세 가지를 함께 고쳤다:

1. **라이선스** — `sonntag78_junglebook_hair`(f20_thin)와 `culturalibre_hair_02`
   (m40·boy)는 **AGPL3** 였고, `elvs_maxwell_hair`(m20·m50)는 로컬에 원본이
   없어 출처 불명이었다. 전부 CC0 로 교체했다. 자세한 내용은
   `frontend/public/avatars/CREDITS.md` §1.1.
2. **노멀맵** — `hair_material()` 이 diffuse 만 연결하고 있어서, `characters.json`
   으로 헤어를 지정하면 **기본 생성본보다 화질이 내려갔다**. 이제 mhmat 이
   선언한 `normalmapTexture` 를 연결하고, 선언은 없지만 폴더에 있는
   `<stem>_normal.png` 도 줍는다(`short02` 가 그 경우다).
3. **색** — `--hair-texture <asset>/<file>` 로 mhmat 의 diffuse 를 덮어쓴다.
   toigo 6종은 baked normal/spec 이 **바이트 단위로 동일**해 UV 레이아웃을
   공유하므로 `BlackHair.png` 를 서로 바꿔 써도 안전하다. `short02`·`short03`
   은 따뜻한 갈색(76,60,50)/(80,51,43)이라 `recolor_hair_black.py` 로 중성 흑발
   리컬러를 만들어 `assets/hair/` 에 두고 가리킨다 — 저장소 경로가 MPFB
   라이브러리보다 우선한다.

현재 배정:

| 아바타 | 헤어 | 비고 |
|---|---|---|
| `f20`, `f40` | `toigo_inverted_bob_with_bangs` | CC0 + normal/spec |
| `f30` | `toigo_curled_under_bob_with_bangs` | 요로결석 데모 |
| `f30_thin`, `girl` | `toigo_blunt_bob_with_bangs` | 갑상샘 데모(f30_thin) |
| `f50` | `toigo_blunt_bob` | |
| `f60`, `f60_ob`, `f20_thin` | `toigo_inverted_bob` | |
| `f70` | `toigo_curled_under_bob` | |
| `m20`, `m30`, `m40` | `short02` + 흑발 리컬러 | 유일한 노멀맵 보유 남성 헤어 |
| `m50`, `m70` | `short01` | 원래 중성 흑발 |
| `m60`, `boy` | `short04` | 원래 중성 흑발 |

여성 전원이 **앞머리 있는 단발** 계열인 이유: 앞머리 없는 에셋은 이마 위에
**밝은 두피 띠**를 남겨 가발을 뒤로 쓴 것처럼 보인다. 컷오프를 0.10~0.65 로
훑어도 그대로였다 — 알파가 아니라 헤어 캡이 이마까지 안 닿는 기하 문제다.
`ponytail01`(예전 f30·f30_thin)이 이 실패의 전형이었다: 정면에서 **탈모처럼**
보였다.

`short03` 는 여기서도 탈락했다. 앞머리가 **한쪽 눈을 완전히 가린다** — 표정과
눈을 읽어야 하는 진찰 시뮬레이터에서는 그 자체로 실격이다.

(아래는 그 이전 이력이다. 위 표가 현재 상태다.)

The adult men must not share a head. `mh_m60` and `mh_m70` first got
`culturalibre_hair_02` and `short02`, which fixed the knit-cap look but left
`m40`/`m60` and `m30`/`m70` as identical pairs — the six-man ladder had three
distinct hairs. The four hairs this pipeline fits are now distinct. `mh_m20` and
`mh_m50` still share `elvs_maxwell_hair` from their bake; only `mh_m20` is used
by an MVP case, so the pair was left alone.

`short03` was tried on `mh_m70` and rejected on the render: 48% mean saturation
puts it in the auburn family, and on the oldest man it reads as dyed pink-blond
with a sawtooth card fringe across the crown. `short01` replaced it — the README
had previously rejected `short01` on `mh_m60` for its skull-hugging shape and
knife-cut hairline, and that shape critique still stands, but at zero saturation
it is the only remaining neutral-dark male short cut, and a hard hairline is a
smaller defect than the wrong hair colour. `elvs_grumphair` (the old `mh_m70`
asset) had both problems.

### Long hair over a light shirt

`mh_f20` and `mh_f20_thin` shipped `punkduck_alpha7_long`, which hangs 42.7 cm
below the shirt's neckline — half of its vertices are over the torso. The cards
are large and semi-transparent, so over the white tucked t-shirt they render as
grey sheets across the chest and neckline, which is what the review logged as
"black smudges". `mh_f20` now wears a jaw-length blunt bob (4.2 cm drape) and
`mh_f20_thin` a shoulder-length layered cut (10.5 cm) so the two 20s patients do
not read as the same woman, and `hair_drape_over_upper()` gates the limit (see
below). This matters more than the men:
all adult female avatars wear `mh_f20`'s uniform at runtime
(`transplantAdultFemaleOutfit`), and two of the six MVP cases are 20s women.

Two rejected candidates, both caught only by rendering:

- `bob01` is the darkest alpha-card bob by texture average, but its atlas has
  auburn highlight streaks that land on the crown cards and read as dyed pink,
  and its longest front strand covers one eye. That last point disqualifies it
  outright for `mh_f20`: that avatar is the iron-deficiency-anaemia case, whose
  whole exam is **conjunctival inspection of both eyes**.
- `littleright_bobcut_hair` measures dark (luma 28) but at 95% saturation it
  renders bright rust.

Texture statistics alone do not predict the rendered colour — `toigo_blunt_bob`
averages luma 142 ("strawberry blond") and renders as a natural dark brown on
`mh_f50`. Judge hair on a render, and only on a correctly exposed one.

A textured alpha-card asset is only half the fix. The runtime silver-hair
shader in `RealisticPatient.tsx` used to quantise the hair UV into 228 columns
and repaint a fifth of them near-white, which on short hair — where one UV
column is wide — drew **hard-edged white stripes across the scalp**. That is
what made the two oldest men read as striped knit caps even after the mesh was
replaced. The cell count is now 1450 (one strand wide), the threshold is soft
and the blend strength is halved; overall greying is carried by the material
colour lerp, not by the streaks.

## Garment and hair layering

`garment_layers.py` owns the layer rules: which mesh is upper/lower/hair, the
waistband tuck, and the two measurements that gate a build. The build
(`upgrade_mpfb_morphs.py`) and the deployed-file measurement
(`measure_layers.py`) import the same module, because a copied rule drifts
silently — "the build passed but the shipped file is pierced".

The runtime does its own pass in `RealisticPatient.tsx`
(`tuckLowerGarmentWaist`), and the tokens and the 16 mm clearance here match it
so that fixing the asset makes the runtime pass a no-op. That runtime pass is
not enough on its own: it compares the *whole band's* maximum radius, so the
trouser hip (20 cm below the waist, outside the sweater by design) sets the
limit and the actual breach at the waistline survives. Measured on `mh_m60`:
21.8 mm before, 19.9 mm after. Slicing by height first — 2 cm slices, per
azimuth bin — drops every avatar in the set to a 0 mm breach.

Two build gates, both calibrated against the deployed set rather than guessed:

| gate | limit | worst measured |
|---|---|---|
| lower garment outside upper, within 14 cm of the waistline | 2 mm | `mh_m60` 13.1 mm before the tuck, 0 mm after |
| radial pull the tuck needed | 35 mm | `mh_f70` / `mh_oldf` 31 mm |
| fitted hair hanging below the neckline (only when `--hair` is given) | 12 cm | `punkduck_alpha7_long` 42.7 cm; `ponytail01` 10.2 cm passes |

The tuck is deliberately capped at 14 cm below the waistline. Correcting the
whole overlap instead squeezed `mh_f60`/`mh_f70`'s skirt 71 mm inward to follow
a knee-length tunic, which erases the silhouette; the reported defect is a band
at the waist, not a skirt flare at the hip.

The tuck is not quite idempotent, by construction. Inside the band the target is
absolute (`upper radius − 16 mm`), so a second run moves nothing there; but the
3 cm fade strip below the band gets a *fraction* of the correction each time, so
re-running keeps nibbling it. It converges — rebuilding `mh_m60` on top of its
own output pulled 7.4 mm where the first pass pulled 29.1 mm — and the limit is
the fully-corrected radius, which is what the band above it already has. Not
worth special-casing, but do not read a nonzero `waist_pull_max` on a rebuild as
a sign the previous run failed.

The tuck only runs when an avatar is rebuilt. As of this pass `mh_f20`,
`mh_f20_thin`, `mh_m20`, `mh_m60` and `mh_m70` are at 0 mm; the rest still carry
what they were baked with (`mh_oldm` 13.5 mm, `mh_f70` 15.0 mm, `mh_f60`
14.0 mm, `mh_f50` 5.3 mm, `mh_m50` 2.4 mm, `mh_m30` 11.3 mm). None of those is
an MVP avatar, and every adult female wears `mh_f20`'s uniform at runtime rather
than her own baked outfit, so the remaining numbers only show on the legacy men.
`python3 batch_upgrade.py --deploy` clears them all in one run.

A signed-distance test ("is this hair vertex inside the fabric?") was tried
first for the hair gate and rejected: it found 1 of 2,338 vertices on `mh_f20`,
because the long cards hang *outside* the shirt. What the eye objects to is the
area of torso the hair covers, not intersection — hence the drape measurement.

```sh
blender --background --python tools/avatar_pipeline/measure_layers.py -- \
  frontend/public/avatars/mh_m60.glb frontend/public/avatars/mh_f20.glb
```

## QA renders and measurements

```sh
blender --background --python tools/avatar_pipeline/render_body_qa.py -- \
  frontend/public/avatars/mh_f60_ob.glb /tmp/qa mh_f60_ob      # front/45°/side
blender --background --python tools/avatar_pipeline/measure_body_qa.py -- \
  frontend/public/avatars/mh_f60_ob.glb                        # per-bone girth
```

`render_morph_qa.py` frames the face and `render_garment_qa.py` a single
garment; neither can answer "does the belly look like a stuck-on ball", which
is only visible from the side. Both new tools skip the importer's
`glTF_not_exported` Icosphere — including that 2 m helper in the bounds framed
the camera on a sphere instead of the avatar.

```sh
blender --background --python tools/avatar_pipeline/render_hair_qa.py -- \
  frontend/public/avatars/mh_m60.glb /tmp/qa mh_m60           # head, 4 angles
blender --background --python tools/avatar_pipeline/render_hair_qa.py -- \
  frontend/public/avatars/mh_f20.glb /tmp/qa mh_f20 --waist   # neck to waist
```

`render_hair_qa.py` exists because the other two cannot see either hair defect.
"Does the back of the head read as a knit cap" and "does the hair cross the
shirt" only show from the side and the back, and in `render_body_qa.py`'s
full-body frame the head is under 100 px. Its lights are fixed rather than
camera-mounted so a before/after pair differs only by the geometry.

It renders at **−1.5 EV**, and that is not cosmetic. At the default exposure
this light rig blows out: a neutral 36/255 grey hair renders as bright silver
and skin renders pure white, which is enough to fail a perfectly good black bob
as "pink hair" — that nearly happened here. If you change the lights, re-derive
the exposure until the skin reads as skin before judging any hair colour.
`--exposure=<ev>` overrides it.
