# Asian skin textures

The six files in this directory come from the official MakeHuman
`makehuman_system_assets` pack. Four are unmodified; the two `old_*` textures
carry a colour correction described at the bottom of this file.

> **Note on the file extension.** These files are named `.png` but their actual
> content is WebP — that is how the upstream pack ships them, and browsers
> detect the format from the magic bytes rather than the name. Anything that
> rewrites them must save WebP, not PNG (see
> `tools/avatar_pipeline/neutralize_old_skin.py`).

- Source: https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
- Pack: `makehuman_system_assets_cc0.zip`
- Author: MakeHuman system assets
- License: CC0 1.0 / public domain dedication

The filenames in this project map to the upstream assets as follows:

| Project file | Upstream file |
| --- | --- |
| `asian_young_female.png` | `young_lightskinned_female_diffuse3.png` |
| `asian_middle_female.png` | `middleage_lightskinned_female_diffuse2.png` |
| `asian_old_female.png` | `old_lightskinned_female_diffuse2.png` |
| `asian_young_male.png` | `young_lightskinned_male_diffuse3.png` |
| `asian_middle_male.png` | `middleage_lightskinned_male_diffuse2.png` |
| `asian_old_male.png` | `old_lightskinned_male_diffuse2.png` |

## Modification: red cast removed from the two `old_*` textures

CC0 permits derivatives without attribution; this is recorded for our own
traceability, not as a licence obligation.

Measured on the albedo itself (not on a render), the upstream `old` textures sit
far warmer than the rest of the set — `asian_old_male` had an R/B ratio of 2.04
against 1.56 for `asian_middle_male`, so every elderly patient rendered
sunburnt. Skin colour is diagnostic information in this simulator (jaundice,
pallor, cyanosis), so the baseline has to be neutral before clinical colour
signals are layered on top.

Both textures were pulled back to R/G ≈ 1.34 and R/B ≈ 1.73 — still warmer than
the middle-age tier, but no longer sunburnt. The pristine upstream files are
kept in `tools/avatar_pipeline/assets/skin_original/`, and the correction is
reproducible via `tools/avatar_pipeline/neutralize_old_skin.py`.

`asian_old_female` was additionally re-encoded from PNG to WebP, matching the
other five. It was 4.65 MiB — fourteen times its peers — and is now 474 KiB.
