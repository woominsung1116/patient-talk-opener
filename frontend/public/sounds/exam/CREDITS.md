# 청진음 출처 및 라이선스

이 폴더의 청진음은 모두 **무료 + 상업적 사용 가능** 소스에서 가져왔습니다.

## 장음 (bowel/)
- **출처**: freesound.org 사용자 **borygmi** — https://freesound.org/people/borygmi/
- **라이선스**: **CC0 1.0 (퍼블릭 도메인)** — 상업 사용·수정·재배포 자유, 출처 표기 불필요
- 사용 파일 ID: 409857 (Angry guts), 414974·414975 (short gurgles)
- 게임에서: `normal`(짧은 gurgle 결합), `hyperactive`/`hypoactive`(Angry guts 구간 + 음량 조정)

## 심음 (heart/) · 폐음 (lung/)
- **출처**: **HLS-CMDS** — *Heart and Lung Sounds Dataset Recorded from a **Clinical Manikin**
  using Digital Stethoscope* (Y. Torabi et al., 535 녹음)
  - GitHub: https://github.com/torabiy/hls-cmds
  - UCI ML Repository: https://archive.ics.uci.edu/dataset/1202
  - Zenodo: https://zenodo.org/records/15376628
- **라이선스**: **CC BY 4.0** — 상업 사용 가능, **출처 표기 필요**
- ⚠️ **실제 환자 녹음이 아니라 임상 마네킹(시뮬레이터) 녹음이다.**
  의대생 실습도 같은 종류의 마네킹으로 하므로 교육용으로는 적합하지만,
  **"실제 환자 심음"으로 홍보하지 말 것.**
- **필수 출처 표기 문구** (앱 크레딧/약관에 포함할 것):
  > Heart and lung sounds from the HLS-CMDS dataset by Y. Torabi et al.,
  > licensed under CC BY 4.0. https://github.com/torabiy/hls-cmds

### 파일 ↔ 임상 유형 매핑
- heart/normal, systolic_murmur, diastolic_murmur, atrial_fibrillation,
  s3_gallop, s4_gallop, tachycardia, av_block
- lung/normal, wheezing, fine_crackles, coarse_crackles, rhonchi, pleural_rub

원본은 15초 WAV. 게임용으로 8초 트림 + 음량 정규화(loudnorm) + 페이드 처리하여 mp3(96kbps)로 변환.

## 타진음 (percussion/)
- **출처**: **자체 합성** — 외부 음원 없음. 라이선스 제약 없음(우리 저작물)
- **사유**: 심음·폐음과 달리 **공개된 CC 라이선스 임상 타진음 데이터셋이 존재하지 않는다.**
  PhysioNet·Zenodo 모두 심음/폐음만 제공한다(HLS-CMDS, CirCor DigiScope 등).
- **방법**: 모달 합성(modal synthesis) — 타격 트랜지언트 + 감쇠 공명 모드 합 + 조직 저역통과.
  생성 스크립트 `tools/audio/gen_percussion.py` (파라미터만 바꿔 재생성 가능).
  실제 술기대로 2회 연타로 렌더.
- **임상 특성 검증** (합성 결과 실측):

  | 파일 | 소견 | 최대주파수 | 스펙트럼 중심 | T20(감쇠) |
  |---|---|---|---|---|
  | `hyperresonance.mp3` | 과공명음 (폐기종·기흉) | 124 Hz | 217 Hz | 371 ms |
  | `tympany.mp3` | 고창음 (공기 찬 장) | 151 Hz | 252 Hz | 303 ms |
  | `resonance.mp3` | 공명음 (정상 폐) | 189 Hz | 280 Hz | 192 ms |
  | `dullness.mp3` | 탁음 (간·비장·액체) | 331 Hz | 396 Hz | 58 ms |
  | `flatness.mp3` | 편평음 (근육·뼈) | 456 Hz | 528 Hz | 29 ms |

  교과서적 순서(고창음 → 공명음 → 탁음 → 편평음으로 갈수록 **음정↑ 지속↓**)와 일치한다.

> 합성음이므로 실제 환자 타진음과 음색이 같지는 않다. 상대적 대비(고창음 vs 탁음)를
> 구분하는 학습에는 충분하지만, 절대적 음색 학습용으로 홍보하지 말 것.

---

# 환자 아바타 헤어 에셋 출처 (MakeHuman Community 헤어 팩)

아바타 본체·옷·스킨은 MakeHuman/MPFB 시스템 에셋(**CC0**, 표기 불필요).
헤어 중 일부는 **CC-BY → 크레딧 표기 필요** (앱 크레딧 화면에 포함할 것):

- **필수 표기 (CC-BY)**:
  > Hair assets "maxwell hair", "grump hair", "wavy bob" by **Elvaerwyn**,
  > "alpha7 long" by **punkduck** — MakeHuman Community asset packs, licensed under CC-BY.
  > http://www.makehumancommunity.org
- 표기 불필요 (CC0): "blunt bob with bangs" (MargaretToigo), "hair 02" (culturalibre)

# 환자 아바타 의상 에셋 출처 (MakeHuman Community 옷 팩)

- 표기 불필요 (CC0, shirts01/pants01/skirts01 팩): crude t-shirts (Elvaerwyn/Joel Palmius),
  polo shirt (namuhekam), tucked t-shirt·fisherman sweater·wool pants·harem pants·
  tiered skirt·long full skirt (MargaretToigo), cargo pants·jeans shorts (Cortu)
- **필수 표기 (CC-BY, shirts02/pants02 팩)**:
  > Clothing assets "old female sweater" by **janexx**, "jeans straight leg" by **Elvaerwyn**
  > — MakeHuman Community asset packs, licensed under CC-BY. http://www.makehumancommunity.org
