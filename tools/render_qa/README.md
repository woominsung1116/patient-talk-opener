# 렌더 QA 프로브

시각 문제는 **렌더로 판정한다.** 간접 지표(평균 밝기, bbox 폭, 삼각형 수)는 이 프로젝트에서
반복적으로 사람을 속였다 — 회전 진폭을 4배 올려도 가슴은 안 움직였고, 알파 컷오프를
0.10~0.65로 훑어도 얼룩은 그대로였다. 둘 다 캡처를 눈으로 보고서야 원인이 잡혔다.

## 공통 주의

**`--use-gl=angle --use-angle=metal` 없이 헤드리스로 띄우면 WebGL 컨텍스트가 죽어
아바타가 아예 안 뜬다.** 모든 스크립트에 이미 들어 있다. 새 프로브를 만들 때도 반드시 넣어라.
"아바타가 안 뜬다 / 컨텍스트를 잃었다"는 대부분 제품 문제가 아니라 이 플래그 누락이다.

playwright 는 `frontend/node_modules` 에만 있어서 스크립트가 절대경로로 import 한다.

## 목록

| 스크립트 | 용도 |
|---|---|
| `rehearsal.mjs` | **시연 전체 리허설** — 문진→진찰→교육→리포트를 UI로 통과시키고 콘솔/네트워크 오류를 모은다 |
| `breath_probe.mjs` | 한 호흡 주기를 여러 프레임 찍는다. 정지 이미지로는 호흡을 판정할 수 없어 **프레임 차분**으로 본다 |
| `face_shot.mjs` | AvatarLab 얼굴/전신 캡처. `label=쿼리스트링` 형태로 여러 장 |
| `clinic_shot.mjs` | **실제 진료실 씬** 캡처. AvatarLab 은 자체 antialias 캔버스라 헤어 경계가 다르게 보인다 |
| `hair_ab.mjs` | 배포본 vs 스테이징 GLB A/B 렌더 |
| `hair_sweep.mjs` | `?hairAlpha=` 알파 컷오프 격자 스윕 |
| `offline_test.mjs` | **외부 도메인 전부 차단** 후 아바타가 뜨는지 — 시연장 인터넷 없는 상황 검증 |
| `glb_hair3.mjs` | GLB 안 헤어 재질·삼각형·노멀맵 유무 감사 |
| `glb_dump.mjs` | GLB 전체 메시/재질/텍스처 덤프 |
| `extract_tex.mjs` | GLB 안 텍스처 추출(EXT_texture_webp 대응) |

## 개발용 URL 파라미터 (DEV 빌드에서만)

프로덕션 번들에서는 전부 제거된다(`import.meta.env.DEV` 게이트).

| 파라미터 | 용도 |
|---|---|
| `?avatarLab=mh_f30&view=face\|body\|exam&freeze=1` | 아바타 단독 렌더 |
| `?asset=/avatars/....glb` | 다른 GLB 를 물려서 A/B |
| `?hideKind=hair,skin,fabric,medical` | 재질 종류별로 숨겨 **원인 이분법** |
| `?hairAlpha=0.15` `?hairGrey=0.38` `?hairDebug=noSheen\|noAniso\|noNormal\|flat` | 헤어 튜닝 |
| `?skinTzone=0.25` | 피부 T존 유분 |
| `?breathBelly=0` | 복식호흡 진폭 A/B |
| `?nopost=1` `?noshadow=1` `?tonemap=aces\|agx\|neutral` `?exposure=` | 진료실 렌더 파이프라인 |
