# 신체진찰 충실도 개선 — 구현 계약 (2026-07-25)

이 문서는 **여러 에이전트가 병렬로 구현할 때 공유하는 단일 진실 원천**이다.
자기 담당 파일 밖은 절대 수정하지 말 것. 인터페이스는 아래 정의를 **글자 그대로** 따른다.

근거 원본: `신체진찰평가_2026 (1).xlsx` (공식 CPX 술기 평가표), `PPI_체크리스트.docx`.

---

## 0. 파일 소유권 (겹치면 충돌 — 반드시 지킬 것)

| 담당 | 소유 파일 (이 파일만 수정) |
|---|---|
| **A: 케이스 데이터** | `backend/app/cases/*.json` |
| **B: 백엔드 로직** | `backend/app/main.py`, `backend/app/services/scoring.py`, `backend/app/services/ppi_evaluator.py`, `backend/app/services/intent_analyzer.py` |
| **C: 프론트 상태** | `frontend/src/store.ts`, `frontend/src/types.ts` |
| **D: 3D 씬** | `frontend/src/three/ClinicScene.tsx` |
| **E: 아바타 시각소견** | `frontend/src/three/RealisticPatient.tsx` |
| **F: 진찰 HUD** | `frontend/src/components/ExamPanel.tsx` |

`scripts/validate_case.py`는 A 담당이 필요 시 수정한다.

---

## 1. 진찰 부위(region) 확장 — 모든 담당 공통 계약

### 1.1 region id (확정)

```ts
// frontend/src/store.ts (C가 정의, D가 import)
export type ExamRegion =
  | 'ruq' | 'luq' | 'rlq' | 'llq'   // 복부 4분면
  | 'flank_r' | 'flank_l'           // 양측 옆구리(CVA)
```

- `ruq` 우상복부, `luq` 좌상복부, `rlq` 우하복부, `llq` 좌하복부 — **환자 기준 좌우**(의사가 보는 화면 기준이 아님)
- `flank_r` 우측 갈비척추각, `flank_l` 좌측 갈비척추각

### 1.2 도구 ↔ 허용 부위

```ts
export const TOOL_REGIONS: Record<ExamToolId, ExamRegion[]> = {
  auscultation:   ['ruq', 'luq', 'rlq', 'llq'],
  percussion:     ['ruq', 'luq', 'rlq', 'llq'],
  palpation:      ['ruq', 'luq', 'rlq', 'llq'],
  cva_tenderness: ['flank_r', 'flank_l'],
}
```

### 1.3 부위별 유지 시간 (기존 일괄 6초 → 도구별)

```ts
// D가 ClinicScene.tsx에 정의. 근거: 공식 평가표 "복부청진 ④ 최소 5초 이상 시행"
export const HOLD_SECONDS: Record<ExamToolId, number> = {
  auscultation:   5.0,  // 청진만 5초 요건 있음
  percussion:     1.2,  // 타진은 두드리는 동작
  palpation:      1.5,
  cva_tenderness: 1.0,  // 두드림
}
```
기존 `const HOLD_SECONDS = 6`은 제거한다.

---

## 2. exam_item 스키마 확장 (A가 데이터, B가 서버, C가 타입)

`type: "exam_action"` 항목에 아래 **선택** 필드를 추가한다. 없으면 기존처럼 1회 시행으로 완료.

```jsonc
{
  "id": "percussion",
  "type": "exam_action",
  "points": 6,

  // ── 신규 ──
  // 이 부위를 "전부" 시행해야 항목이 완료된다. 순서는 자유.
  "required_regions": ["ruq", "luq", "rlq", "llq"],

  // 얕게→깊게 2단계가 필요한 항목(촉진)만. 각 pass마다 required_regions를 전부 돌아야 한다.
  // 값은 반드시 이 순서: 얕게 먼저, 깊게 나중.
  "passes": ["light", "deep"],

  // 부위/패스별 소견·환자반응. 키 형식:
  //   passes 없음 → "<region>"          예: "flank_r"
  //   passes 있음 → "<pass>:<region>"   예: "deep:rlq"
  // 매칭되는 키가 없으면 항목 최상위 finding/reaction을 쓴다.
  "region_findings": {
    "flank_r": {
      "finding": "우측 갈비척추각 압통이 양성입니다.",
      "reaction": { "emotion": "hurt", "line": "악! 거기가 아파요.", "intensity": "strong" }
    },
    "flank_l": {
      "finding": "좌측 갈비척추각은 압통이 없습니다.",
      "reaction": { "emotion": "calm", "line": "이쪽은 괜찮아요.", "intensity": "none" }
    }
  },

  // 항목이 "완료"됐을 때 표시할 종합 소견 (기존 finding 필드가 이 역할)
  "finding": "양측 갈비척추각을 두드렸고, 우측에만 압통이 있습니다.",

  // 이 항목보다 나중에 해야 하는 항목들 (기존 필드, 이제 일반화해서 사용)
  "must_precede": ["palpation"],

  // 선택: 압통이 있는 부위. 설정되면 그 부위를 마지막에 진찰해야 한다
  // (공식 평가표 "아픈 부위는 가장 마지막에 타진/촉진").
  // 현재 케이스 중 복부 압통이 있는 케이스가 없어 아무 데도 설정하지 않는다. 로직만 준비.
  "tender_region": null
}
```

### 2.1 부분 진행 API (B 담당)

`POST /api/session/{id}/exam` 의 요청/응답을 확장한다. **기존 호출(region 없음)은 그대로 동작해야 한다.**

```python
class ExamRequest(BaseModel):
    action_id: str
    region: str | None = None   # 신규
    pass_: str | None = Field(None, alias="pass")  # 신규: "light" | "deep"
```

서버는 세션에 `exam_progress: dict[str, list[str]]` 를 둔다 (`action_id` → 이미 찍은 `"<pass>:<region>"` 또는 `"<region>"` 키 목록).

동작:
1. `required_regions`가 없는 항목 → 기존과 동일하게 즉시 `exam_log`에 기록하고 완료.
2. 있으면 해당 키를 `exam_progress[action_id]`에 (중복 없이) 추가한다.
3. 필요한 키를 **전부** 채웠을 때만 `exam_log`에 append 한다 (= 채점 대상).
4. 응답에 진행 상태를 실어 보낸다:

```jsonc
{
  "action_id": "cva_tenderness",
  "label": "갈비척추각(CVA) 압통",
  "finding": "우측 갈비척추각 압통이 양성입니다.",   // 이번에 찍은 부위의 소견
  "reaction": { ... },                              // 이번에 찍은 부위의 반응
  "complete": false,                                 // 항목 전체 완료 여부
  "progress": { "done": ["flank_r"], "remaining": ["flank_l"], "total": 2 },
  "current_pass": "light",        // passes 있는 항목만, 다음에 해야 할 pass. 없으면 null
  "exam_log": [...],
  "summary": { ... }
}
```

`complete: true`가 되는 호출에서는 `finding`을 항목 최상위 종합 소견으로 바꿔 보낸다.

### 2.2 순서 검증 일반화 (B 담당)

`_exam_summary`의 하드코딩된 `auscultation` 분기를 제거하고 `must_precede`를 일반적으로 해석한다.

```python
# 위반 목록을 구조화해서 반환 — 페널티 메시지를 정확하게 만들기 위함
order_violations: list[dict] = []   # [{"item": "auscultation", "before": "palpation", "kind": "wrong_order" | "skipped"}]
```

규칙 (exam_action 항목만 대상, `exam_log` 순서 기준):
- `kind="wrong_order"`: A에 `must_precede: [B]`가 있고, A와 B 둘 다 수행됐는데 B가 A보다 먼저 나옴.
- `kind="skipped"`: A에 `must_precede: [B]`가 있고, B는 수행됐는데 A는 수행되지 않음.

`order_ok = len(order_violations) == 0`. `summary`에 `order_violations`도 함께 넣는다.

### 2.3 페널티 메시지 (B 담당, scoring.py `_score_exam`)

기존의 "복부 청진은 타진·촉진보다 먼저 시행해야 해요" 고정 문구를 버리고 `order_violations`로 생성한다.

- `wrong_order` → `"{A라벨}은(는) {B라벨}보다 먼저 시행해야 해요."`
- `skipped` → `"{B라벨}을(를) 하기 전에 {A라벨}을(를) 먼저 시행해야 해요. (시행하지 않았습니다)"`

배수는 위반 종류와 무관하게 기존대로 `ratio *= 0.9` 를 **한 번만** 적용한다.

`tender_region`이 설정된 항목에서 그 부위를 마지막에 찍지 않았으면
`ratio *= 0.95` + `"{라벨}은(는) 아픈 부위를 가장 마지막에 진찰해야 해요."`

---

## 3. 케이스 데이터 수정 (A 담당)

### 3.1 채점 미연결 5개 케이스에 `scoring_weights` 추가 — **최우선**

현재 `exam_items`는 있는데 `scoring_weights`가 없어 `_legacy_compute_scores`로 빠지며 신체진찰이 **0점 반영**되는 케이스:

- `iron_deficiency_anemia_01.json`
- `hyperthyroidism_01.json`
- `weightloss_supplement_thyrotoxicosis_01.json`
- `herbal_fulminant_hepatitis_01.json`
- `drug_induced_autoimmune_hepatitis_01.json`

각 케이스에 아래를 추가한다. 이들은 신체진찰 비중이 요로결석(30)보다 낮은 시진/촉진 위주라 **20점**으로 잡고, 환자교육 항목이 없으므로 `patient_education: 0`으로 두고 그 배점을 병력청취로 돌린다.

```json
"scoring_weights": {
  "history_taking": 55,
  "physical_exam": 20,
  "patient_education": 0,
  "ppi": 25
}
```

> B 담당 주의: `_compute_weighted`가 `patient_education: 0`에서도 안전해야 한다
> (`round(0 * ratio) == 0`이라 계산은 되지만, `_score_education`이 `education_items`가 비었을 때
> `edu_max = 1`로 나눠 0을 반환하는지 확인할 것). 리포트에서 배점 0인 영역은 F가 아니라
> `ReportScreen`이 담당이므로 **이번 작업 범위 밖** — 배점 0이어도 크래시만 없으면 된다.

### 3.2 `drape` 항목 추가 (PPI 6-3 영구 fail 방지)

위 5개 케이스 `exam_items`에 `drape`가 없어서 `ppi_evaluator`의 `6-3` 판정이 **영구 fail**이 된다
(서버가 404를 내므로 학생이 기록할 방법이 자체가 없음).

두경부/시진 위주 케이스는 노출이 필요 없으므로 **`drape`를 추가하는 대신 B 담당이 6-3을 `na` 처리**한다 (§4 참조).
따라서 A는 이 5개 케이스에 `drape`를 추가하지 **않는다**.

### 3.3 요로결석 케이스 `exam_items` 갱신

`acute_flank_pain_urolithiasis_01.json`:

| 항목 | 변경 |
|---|---|
| `auscultation` | `required_regions: ["ruq","luq","rlq","llq"]` 추가. `must_precede: ["percussion","palpation"]` 유지 |
| `percussion` | `required_regions: ["ruq","luq","rlq","llq"]` + `must_precede: ["palpation"]` 추가 (평가표 "촉진 전에 타진") |
| `palpation` | `required_regions: ["ruq","luq","rlq","llq"]` + `passes: ["light","deep"]` 추가. 라벨은 그대로 |
| `cva_tenderness` | `required_regions: ["flank_r","flank_l"]` + 아래 `region_findings` 추가 |

`cva_tenderness`의 `region_findings` (의학적으로 우측 요관결석 → 좌측은 음성이어야 함):

```json
"region_findings": {
  "flank_r": {
    "finding": "우측 갈비척추각에 압통이 있습니다.",
    "reaction": { "emotion": "hurt", "line": "악! 거기가 아파요.", "intensity": "strong" }
  },
  "flank_l": {
    "finding": "좌측 갈비척추각은 압통이 없습니다.",
    "reaction": { "emotion": "calm", "line": "이쪽은 괜찮아요.", "intensity": "none" }
  }
},
"finding": "양측 갈비척추각을 두드렸고, 우측에만 압통이 있습니다."
```

`palpation`의 pass별 소견:

```json
"region_findings": {
  "light:ruq": { "finding": "우상복부는 부드럽고 압통이 없습니다." },
  "light:luq": { "finding": "좌상복부는 부드럽고 압통이 없습니다." },
  "light:rlq": { "finding": "우하복부는 부드럽고 압통이 없습니다." },
  "light:llq": { "finding": "좌하복부는 부드럽고 압통이 없습니다." },
  "deep:ruq": { "finding": "우상복부 깊이 눌러도 압통이나 종괴가 없습니다." },
  "deep:luq": { "finding": "좌상복부 깊이 눌러도 압통이나 종괴가 없습니다." },
  "deep:rlq": { "finding": "우하복부 깊이 눌러도 압통이 없고 반발통도 없습니다." },
  "deep:llq": { "finding": "좌하복부 깊이 눌러도 압통이 없습니다." }
},
"finding": "복부는 전반적으로 부드럽고, 우하복부 압통이나 반발통은 없습니다."
```

`auscultation` / `percussion`도 부위별 소견을 넣되, 4분면이 모두 정상이므로 간결하게:
- 청진: `"ruq"~"llq"` 각각 `"이 부위 장음은 정상입니다."` 계열 (부위명 넣어 자연스럽게)
- 타진: 각 `"...는 정상 고창음입니다."` 계열

> ⚠️ **의학 정확성 규칙**: 소견은 반드시 케이스의 진단(우측 요관결석)과 모순되지 않아야 한다.
> 임의로 새 양성 소견(반발통, 종괴 등)을 만들어내지 말 것.

### 3.4 두경부 케이스 좌우/양측 (A 담당)

결막·공막·구강·갑상샘은 **클릭 부위 방식이 아니라 음성 지시 1회**로 시행되는 구조라 `required_regions`를 쓰지 않는다.
대신 공식 평가표가 요구하는 "양쪽 눈 관찰", "좌우 갑상샘 촉진"을 **소견 문구에 명시**한다.
이미 "양쪽 눈꺼풀결막이 창백합니다" 처럼 되어 있으면 그대로 두고, 한쪽만 언급된 문구가 있으면 양측 표현으로 고친다.

`hyperthyroidism_01`의 갑상샘 소견에 좌우 엽 표현을 보강한다 (예: "좌·우엽이 모두 미만성으로 커져 있고…").

### 3.5 `patient_profile.signs` 추가 (E 담당이 렌더링에 사용)

| 케이스 | 추가할 sign |
|---|---|
| `iron_deficiency_anemia_01` | `"pale_conjunctiva"`, `"atrophic_glossitis"` |
| `hyperthyroidism_01` | `"goiter"` |

기존 `jaundice`(간염 2케이스)는 그대로 둔다. `signs`가 없으면 빈 배열을 만들어 추가한다.

### 3.6 케이스 검증

수정 후 반드시 `uv run python scripts/validate_case.py` (또는 기존 실행 방식)로 17개 케이스 전부 통과시킬 것.
스키마 검증이 신규 필드를 거부하면 `validate_case.py`를 확장한다.

---

## 4. PPI 판정 수정 (B 담당, `ppi_evaluator.py`)

### 4.1 6-3 가려주기 — 노출이 필요 없는 케이스는 `na`

현재: `setr("6-3", "drape" in exam_order)` → drape 항목이 없는 케이스는 영구 fail.

수정: `evaluate()`에 `exam_item_ids: set[str] | None` 인자를 추가로 받아,
`"drape"`가 **케이스의 exam_items에 존재할 때만** pass/fail을 매기고, 없으면 `na`.

```python
setr("6-3", ("drape" in exam_order) if (exam_item_ids and "drape" in exam_item_ids) else None)
```

같은 원칙을 6-4에도 적용: 진찰 순서 규칙이 존재하는 케이스(= `must_precede`를 가진 항목이 있는 케이스)에서만 판정하고, 없으면 `na`.

`main.py`의 `_exam_summary`가 `exam_item_ids`를 summary에 실어 보내고, `scoring._compute_weighted`가 `ppi_evaluator.score(...)`에 전달한다.

### 4.2 6-2 사전 설명·동의 엄격화

현재 `store.ts`가 `request_exam`("침대에 누우실까요") 한 마디로 `explain_consent`를 자동 기록해 6-2가 사실상 무조건 pass다.
평가표는 "진찰 **목적·방법**과 **불편감**을 설명하고 **동의**"를 요구한다.

→ `explain_consent` 기록 자체는 유지하되(진행 흐름이 막히면 안 됨), **6-2 판정은 대화 내용으로 한다**:

```python
# 진찰 관련 발화 중 목적/방법/동의 신호가 실제로 있었는지
consent_ok = (
    "explain_consent" in exam_order
    and _any_text(dialogue, r"괜찮(으시)?겠|괜찮으세요|동의|해도 될까|봐도 될까|하겠습니다.{0,10}(괜찮|되)|불편하시면|아프실 수|조금 아플")
)
setr("6-2", consent_ok if exam_order is not None else None)
```

---

## 5. 프론트 상태 (C 담당, `store.ts` / `types.ts`)

### 5.1 타입
- `ExamRegion`을 §1.1대로 교체하고 `TOOL_REGIONS`(§1.2)를 export.
- `types.ts`의 `ExamItem`에 `required_regions?: string[]`, `passes?: ('light'|'deep')[]`, `region_findings?: Record<string, {finding?: string; reaction?: ExamReaction}>`, `tender_region?: string | null` 추가.
- `ExamSummary`에 `order_violations?: {item:string; before:string; kind:string}[]` 추가.

### 5.2 신규 상태
```ts
examProgress: Record<string, { done: string[]; remaining: string[]; total: number }>
examPass: 'light' | 'deep' | null   // 현재 촉진 단계
```

### 5.3 `examRegion(region)` 재작성
1. 도구 미선택 → 기존 힌트.
2. `TOOL_REGIONS[examTool]`에 `region`이 없으면 안내:
   - CVA 도구인데 복부 클릭 → `"CVA 압통은 옆구리/등 쪽을 두드려야 해요."`
   - 복부 도구인데 옆구리 클릭 → `"청진·타진·촉진은 복부에서 하세요."`
3. 이미 이번 항목에서 해당 `(pass, region)`을 찍었으면 무시.
4. **손위생 미시행이면 힌트만 띄우고 진행**(기존 동작 유지 — 채점에서 감점됨).
5. `api.examAction(sessionId, actionId, { region, pass })` 호출 → 응답의 `progress`/`current_pass`를 상태에 반영.
6. `complete: false`면 `examTool`을 **해제하지 않는다** (남은 부위를 계속 찍어야 함). `complete: true`일 때만 해제.
7. 남은 부위가 있으면 힌트: `"남은 부위: {remaining 라벨들}"`. pass가 `light`→`deep`으로 넘어가면 `"이제 같은 4분면을 깊게 촉진하세요."`

부위 한글 라벨 매핑도 C가 export 한다:
```ts
export const REGION_LABEL: Record<ExamRegion, string> = {
  ruq: '우상복부', luq: '좌상복부', rlq: '우하복부', llq: '좌하복부',
  flank_r: '우측 옆구리', flank_l: '좌측 옆구리',
}
```

### 5.4 `doHeadNeckExam` 손위생 힌트 추가
`examRegion`과 동일하게, `hand_hygiene` 항목이 케이스에 있는데 아직 안 했으면
`"진찰 전 손위생(손소독제)을 먼저 하는 것이 원칙이에요."` 힌트를 띄운다 (진행은 막지 않는다).

### 5.5 CVA 자세 게이트
`examTool`이 `cva_tenderness`로 설정될 때, 케이스에 복부 항목이 있어 `examPose`가 `'lie' | 'lie_knees'`라면
`examPose: 'sit_edge'`로 전환한다 (평가표 "갈비척추각압통 ① 앉은 자세").
다른 도구(청진/타진/촉진)가 선택되면 다시 `'lie_knees'`(무릎 세운 적 있으면) 또는 `'lie'`로 되돌린다.

`examPose` 타입: `'sit' | 'lie' | 'lie_knees' | 'sit_edge'`

### 5.6 `api.ts`
`examAction`이 `region`/`pass`를 선택 인자로 받도록 확장한다 (`api.ts`도 C 소유로 간주).

---

## 6. 3D 씬 (D 담당, `ClinicScene.tsx`)

### 6.1 `EXAM.quadrants` / `EXAM.flanks`를 region id와 연결
- 각 quadrant에 `region: 'ruq'|'luq'|'rlq'|'llq'`를 부여하고 `RegionMesh`에 그 값을 넘긴다.
- **좌우 (2026-07-25 골격 실측으로 확정 — 기존 라벨이 맞다. 뒤집지 마라):**
  MPFB 골격에서 `thigh_r`은 모델공간 `x=-0.0889`, `thigh_l`은 `x=+0.0889`
  → 모델공간 환자 오른쪽 = `-X`.
  `ExamPatient`의 변환 `Rx(-90°)` → `Ry(+90°)`를 적용하면 `(x,y,z) → (-y, z, -x)`이므로
  머리(모델 `+Y`) = 월드 `-x` ✓, **환자 오른쪽 = 월드 `+z`**.
  따라서 `ruq`가 `z=-3.4`(환자 중심 `-3.5`보다 `+z`쪽)인 현재 배치가 **옳다.**
  이 결론을 코드 주석으로 남겨 다음에 또 헷갈리지 않게 할 것.
- `EXAM.flanks`도 `flank_r`(환자 오른쪽) / `flank_l`로 각각 명시.

### 6.2 `RegionMesh`
- `region: ExamRegion` 단일 값을 받고, `active` 판정은 `TOOL_REGIONS[tool].includes(region)`로 한다.
- `HOLD_SECONDS[tool]`을 사용 (§1.3).
- 이미 완료된 `(pass, region)`은 시각적으로 구분 (예: 진행 디스크를 옅은 회색으로 채워 둠) — store의 `examProgress`를 읽어 판단.
- 촉진 `deep` pass일 때는 접촉 표시(손 GLB)를 조금 더 깊게 눌리는 연출(살짝 더 아래 y + 스케일)로 구분한다.

### 6.3 `sit_edge` 포즈
`examPose === 'sit_edge'`: 환자가 진찰대 **가장자리에 걸터앉은** 자세.
- `ExamPatient`에 분기 추가. `RealisticPatient`/`RenderPeoplePatient`의 기존 `pose="sit"`를 재사용하되,
  위치는 의자(`SEAT`)가 아니라 진찰대 옆(`EXAM` 침대 기준 좌표)으로 둔다.
- 이때 CVA 클릭 메시는 환자의 **등 쪽 좌우 갈비척추각**에 오도록 위치를 재계산한다.
- `CameraRig`에 `sit_edge` 분기를 추가해 의사가 환자 뒤에서 보는 앵글로 이동.
- 새 좌표는 `EXAM` 상수 객체 안에 `sitEdge: { patientPos, patientYawY, camPos, camLook, flanks: {...} }` 로 모아 둘 것.

### 6.4 청진음
`playAuscultation`은 지금 항목 완료 시 1회 재생된다 → **부위를 찍을 때마다** 재생되도록 D가 호출 위치를 확인.
(호출은 `store.ts`에 있으므로 C가 처리한다. D는 사운드 관련 수정 없음.)

---

## 7. 시각 소견 (E 담당, `RealisticPatient.tsx`)

기존 `jaundice` 틴트 패턴(2228~2242행 근처)을 확장한다. **모두 `patient.signs` 기반**이며,
해당 `examGesture`가 활성일 때만 보이게 해 평상시 얼굴을 망가뜨리지 않는다.

| sign | 연출 | 표시 조건 |
|---|---|---|
| `jaundice` | (기존) 눈 재질 `#d9c775` 틴트 | 상시 |
| `pale_conjunctiva` | 아래눈꺼풀을 내렸을 때 드러나는 **결막 띠** 메시를 양안에 추가. 정상 `#e07a72`(붉은 분홍) / 창백 `#e8c4bd` | `examGesture === 'eyes_up'` |
| `goiter` | 목 앞(반지연골 아래)에 **부드러운 타원체 융기** 메시. 피부색과 맞추고 `swallow` 제스처 때 함께 위로 2~3cm 이동 | `examGesture === 'swallow'` 또는 상시(경미하게) |
| `atrophic_glossitis` | 입 벌렸을 때 보이는 **혀 평면** 메시. 정상 `#c9615e` + 미세 요철 / 위축 `#d9a8a0` 매끈 | `examGesture === 'mouth_open'` |

구현 규칙 (과거 실패 사례 반영 — 반드시 지킬 것):
- 위치는 **`PATIENT_HEAD_WORLD`(RealisticPatient가 매 프레임 export하는 머리 본 월드좌표) 기준 상대 오프셋**으로 잡는다. 절대 좌표 금지 — 아바타마다 키가 달라 어긋난다.
- 재질에 **`anisotropy`를 쓰지 말 것** (UV 없는 메시에 걸면 탄젠트 NaN → Bloom/N8AO가 화면 전체를 검게 만든 전례가 있다).
- `MeshStandardMaterial` 기본으로, `depthWrite`는 켜 둔다.
- sign이 없는 케이스에서는 메시 자체를 렌더하지 않는다(정상 상태를 굳이 그리지 않음) — 단 `pale_conjunctiva`의 "정상" 색은 **다른 케이스와 비교 학습**을 위해 필요하므로, `eyes_up` 제스처 중에는 sign 유무와 관계없이 결막 띠를 렌더하고 색만 바꾼다.

---

## 8. 진찰 HUD (F 담당, `ExamPanel.tsx`)

1. **낡은 주석 수정**: 파일 상단 주석이 "도구를 고른 뒤", "아래 준비 버튼으로"라고 하는데 실제로는 도구/준비 버튼이 없고 전부 음성·텍스트 지시다. 현재 구조를 정확히 기술하도록 다시 쓴다.
2. **부분 진행 표시 추가**: 현재 도구가 선택돼 있고 `examProgress[tool]`이 있으면,
   `"복부 타진 2/4"` 같은 진행 표시와 남은 부위 라벨을 좌측 패널에 보여준다.
   촉진이면 현재 pass(`얕게`/`깊게`)도 같이 표시.
   ※ 시험이므로 **무엇을 해야 하는지 알려주는 체크리스트는 여전히 노출하지 않는다.** 이미 고른 도구의 진행률만 보여준다.
3. `시행한 진찰` 목록은 완료된 항목만(기존 `examLog`) 유지.

---

## 9. 완료 기준 (검증 담당이 확인)

- [ ] `cd frontend && npm run build` 통과 (tsc -b 포함)
- [ ] 17개 케이스 `validate_case.py` 통과
- [ ] E2E: 철결핍 케이스에서 **진찰 전부 시행 점수 > 진찰 미시행 점수**
- [ ] E2E: 요로결석에서 4분면 중 1곳만 찍으면 해당 항목이 `exam_log`에 **안 들어감**
- [ ] E2E: `flank_l`만 찍으면 "좌측 …압통이 없습니다" 소견이 나오고 항목 미완료
- [ ] E2E: 타진을 촉진보다 나중에 하면 `order_violations`에 잡히고 페널티 문구가 정확함
- [ ] E2E: 두경부 케이스 PPI에서 6-3이 `na`
- [ ] 기존 회귀: `exam_items`가 없는 11개 케이스는 이전과 동일하게 동작
