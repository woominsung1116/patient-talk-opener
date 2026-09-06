"""사용자 발화 의도 분석 — LLM 1차, 키워드 휴리스틱 폴백."""
from __future__ import annotations

import re
from typing import Any

from . import llm_service

INTENTS = [
    "ask_chief_complaint", "ask_onset", "ask_duration", "ask_severity",
    "ask_aggravating_factor", "ask_relieving_factor", "ask_diet", "ask_sleep",
    "ask_menstruation", "ask_bleeding", "ask_melena", "ask_pregnancy",
    "ask_medication", "ask_past_history", "ask_family_history", "ask_social_history",
    "ask_weight", "show_empathy", "give_premature_diagnosis", "order_test",
    "ask_red_flag", "greeting", "irrelevant_question",
    # ── 급성 통증 병력청취 확장 (요로결석 등) ──
    "ask_location", "ask_quality", "ask_pain_change", "ask_fever", "ask_urinary",
    "ask_trauma", "ask_prior_episode", "ask_surgery", "ask_nausea_vomiting",
    # ── PPI(환자의사관계) 신호용 ──
    "self_introduce", "ask_daily_impact", "ask_mood", "ask_concern",
    "ask_expectation", "ask_background", "summarize",
    # ── 단계 전환 / 진찰 중 지시·준비 ──
    "request_exam", "flex_knees", "explain_consent", "drape", "hand_hygiene",
    # 진찰 준비 자세·동작 지시 (prep chin_up / deep_breath / swallow / say_ah)
    "do_chin_up", "do_deep_breath", "do_swallow", "do_say_ah",
    # ── 진찰 도구 음성 활성화 (말로 청진/타진/촉진/CVA 시작) ──
    "do_auscultate", "do_percuss", "do_palpate", "do_cva",
    # ── 두경부 진찰 (결막·공막·갑상샘 시진/촉진·구강) ──
    "do_conjunctiva", "do_sclera", "do_thyroid_inspect", "do_thyroid", "do_oral",
    # ── 추가 술기 (손떨림·간촉진) / 흉부 청진 ──
    "do_tremor_check", "do_liver_palpate", "do_heart_auscultate", "do_lung_auscultate",
]

INTENT_TOPIC = {
    "ask_chief_complaint": "chief_complaint",
    "ask_onset": "onset_duration",
    "ask_duration": "onset_duration",
    "ask_severity": "severity",
    "ask_aggravating_factor": "aggravating",
    "ask_relieving_factor": "relieving",
    "ask_diet": "diet",
    "ask_sleep": "sleep",
    "ask_menstruation": "menstruation",
    "ask_bleeding": "bleeding",
    "ask_melena": "melena",
    "ask_pregnancy": "pregnancy",
    "ask_medication": "medication",
    "ask_past_history": "past_history",
    "ask_family_history": "family_history",
    "ask_social_history": "social_history",
    "ask_weight": "weight_loss",
    "show_empathy": "empathy",
    "give_premature_diagnosis": "diagnosis",
    "order_test": "test",
    "ask_red_flag": "red_flag",
    "greeting": "greeting",
    "irrelevant_question": "irrelevant",
    # 급성 통증 병력청취 확장
    "ask_location": "location",
    "ask_quality": "quality",
    "ask_pain_change": "pain_change",
    "ask_fever": "fever",
    "ask_urinary": "urinary",
    "ask_trauma": "trauma",
    "ask_prior_episode": "prior_episode",
    "ask_surgery": "surgery_history",
    "ask_nausea_vomiting": "nausea_vomiting",
    # PPI 신호용
    "self_introduce": "greeting",
    "ask_daily_impact": "daily_impact",
    "ask_mood": "mood",
    "ask_concern": "concern",
    "ask_expectation": "expectation",
    "ask_background": "background",
    "summarize": "summary",
    "request_exam": "exam_request",
    "flex_knees": "exam_command",
    "do_chin_up": "exam_command",
    "do_deep_breath": "exam_command",
    "do_swallow": "exam_command",
    "do_say_ah": "exam_command",
    "explain_consent": "exam_prep",
    "drape": "exam_prep",
    "hand_hygiene": "exam_prep",
    "do_auscultate": "exam_tool",
    "do_percuss": "exam_tool",
    "do_palpate": "exam_tool",
    "do_cva": "exam_tool",
    "do_conjunctiva": "exam_tool",
    "do_sclera": "exam_tool",
    "do_thyroid_inspect": "exam_tool",
    "do_thyroid": "exam_tool",
    "do_oral": "exam_tool",
    "do_tremor_check": "exam_tool",
    "do_liver_palpate": "exam_tool",
    "do_heart_auscultate": "exam_tool",
    "do_lung_auscultate": "exam_tool",
}

RED_FLAG_INTENTS = {
    "ask_melena", "ask_pregnancy", "ask_bleeding",
    "ask_trauma", "ask_fever", "ask_urinary",
}

SYSTEM_PROMPT = """너는 의학 문진 시뮬레이션의 질문 분석기다.
의대생(사용자)이 환자에게 한 말을 분석해서 JSON만 출력하라. 다른 텍스트는 출력하지 마라.

허용 intent 목록:
{intents}

판단 기준:
- empathy: 환자의 감정을 인정하거나(힘드셨겠어요), 조심스럽게 양해를 구하거나(불편하실 수 있는데), 안심시키는 표현이 있으면 true
- tone: gentle(부드러움) | neutral(중립) | cold(차가움/사무적) | pressuring(다그침/추궁)
- pressure: 다그치거나 추궁하거나 비난하는 어조면 true
- medical_relevance: 문진에 의학적으로 중요한 질문이면 high, 관련 있지만 부차적이면 medium, 무관하면 low
- is_premature_diagnosis: 충분한 문진 없이 "~병인 것 같네요" 식으로 진단을 단정하면 true
- give_premature_diagnosis: 환자에게 진단명을 단정적으로 말하는 발화
- greeting: 단순 인사/자기소개
- 두 가지 의도가 섞이면 의학적으로 더 중요한 쪽을 intent로 고른다 (공감+월경질문 → ask_menstruation, empathy=true)
- 인사와 질문이 섞이면 질문 쪽 intent를 고른다 ("안녕하세요, 어디가 불편하세요?" → ask_chief_complaint)
- 변 색깔/검은 변/흑색변 질문은 ask_bleeding이 아니라 ask_melena다
- request_exam: 환자를 침대(진찰대)로 보내거나 눕히려 하거나 신체진찰을 시작하려는 발화
  (예: "침대에 누우실까요", "침대로 가시죠", "진찰 좀 하겠습니다", "이제 진찰해볼게요")
- flex_knees: 진찰 중 무릎을 세우거나 굽히라는 지시 (예: "무릎 세워주세요", "무릎 굽혀주세요")
- explain_consent: 진찰 전 환자에게 설명하고 동의/양해를 구하는 발화 (예: "동의 구하겠습니다", "불편하실 수 있어요")
- drape: 진찰 부위만 노출하거나 가려주는 발화 (예: "가려드릴게요", "옷을 살짝 올리겠습니다")
- hand_hygiene: 손을 소독하거나 씻겠다는 발화 (예: "손소독하겠습니다", "손을 씻고 진찰할게요")
- 진찰 시행 선언과 자세·준비 지시가 한 문장에 섞이면(예: "청진하겠습니다, 그 전에 무릎 먼저 세워주세요",
  "촉진할게요 우선 무릎 굽혀주시겠어요") 지금 당장 해야 할 동작인 준비·자세 지시(flex_knees / drape 등)를
  intent로 고른다. '먼저', '그 전에', '우선'은 준비 지시가 선행함을 뜻한다.
  시행(do_auscultate / do_palpate 등)은 자세가 갖춰진 다음 발화("이제 청진할게요")에서 잡는다.
- do_auscultate: 청진을 시작/시행하는 발화 (예: "청진하겠습니다", "청진기 대보겠습니다")
- do_percuss: 타진(두드림)을 시작하는 발화 (예: "타진하겠습니다", "두드려 보겠습니다")
- do_palpate: 촉진(만짐)을 시작하는 발화 (예: "촉진하겠습니다", "만져 보겠습니다")
- do_cva: 늑골척추각(CVA) 압통 검사 발화 (예: "CVA 압통 보겠습니다", "옆구리를 두드려 보겠습니다")
- do_conjunctiva: **결막**(아래눈꺼풀 안쪽 붉은 점막)의 창백함을 보는 발화
  (예: "결막을 확인하겠습니다", "아래 눈꺼풀을 내려볼게요", "눈꺼풀 안쪽이 창백한지 볼게요")
- do_sclera: **공막**(눈 흰자위)의 황달을 보는 발화 (예: "공막을 볼게요", "흰자위가 노란지 확인할게요", "황달이 있는지 볼게요")
- ※ do_conjunctiva와 do_sclera는 **다른 술기**다. '결막/눈꺼풀 안쪽/창백'이면 do_conjunctiva,
  '공막/흰자위/황달/노랗다'면 do_sclera로 고른다. 어느 쪽인지 특정하지 않은 "눈 좀 볼게요"는 do_conjunctiva로 둔다.
- do_thyroid_inspect: 갑상샘을 **눈으로 보겠다**는 발화 (예: "갑상샘을 볼게요", "목을 보겠습니다", "갑상샘 시진하겠습니다")
- do_thyroid: 갑상샘(갑상선)을 **만지는** 발화 (예: "갑상샘을 만져보겠습니다", "목 앞쪽을 촉진할게요")
- do_chin_up: 턱을 들거나 고개를 젖히라는 지시 (예: "턱을 조금 들어주세요", "고개를 살짝 젖혀주세요")
  ※ 결막검사의 "위를 봐주세요"와 다르다. '턱'이나 '고개'가 나올 때만 do_chin_up이다.
- do_swallow: 침이나 물을 **삼키라는 지시** (예: "침을 한번 삼켜보세요", "꿀꺽 삼켜주세요", "물 한 모금 삼켜보세요")
  ※ 갑상샘 시진·촉진의 준비 동작이다. 만지겠다는 말(do_thyroid)과는 별개 항목이므로 섞지 마라.
- do_deep_breath: 크게/깊게 숨 쉬라는 지시 (예: "숨을 크게 쉬어보세요", "깊게 들이쉬세요", "입으로 숨 쉬어보세요")
- do_say_ah: 입을 벌린 상태에서 **"아—" 하고 소리를 내라는 지시** (예: "아— 해보세요", "아 하고 소리 내주세요")
  ※ 구강검사의 준비 동작이다. "입을 벌려보세요"처럼 진찰 개시 발화는 do_oral이다.
- do_tremor_check: 손떨림을 보려고 손을 뻗거나 펴게 하는 발화
  (예: "양손을 앞으로 뻗어보세요", "손가락을 펴보세요", "손이 떨리는지 볼게요")
- do_liver_palpate: 간을 촉진하는 발화 (예: "간을 만져보겠습니다", "갈비뼈 아래를 눌러볼게요", "간 촉진하겠습니다")
- do_heart_auscultate: 심장 청진 발화 (예: "심장 소리를 듣겠습니다", "심음을 들어볼게요", "심장을 청진하겠습니다")
- do_lung_auscultate: 폐(호흡음) 청진 발화 (예: "폐 소리를 듣겠습니다", "숨소리를 들어볼게요", "등에서 폐 청진할게요")
- ※ 그냥 "청진하겠습니다"처럼 부위가 없으면 do_auscultate(복부 청진)다. '심장/심음'이면 do_heart_auscultate,
  '폐/숨소리/호흡음'이면 do_lung_auscultate로 구분한다.
- do_oral: 구강(입안) 검사 발화 (예: "입을 벌려보세요", "아- 해보세요", "입안을 볼게요", "혀를 내밀어보세요")
- 발화가 직전 대화 주제의 연속(설득, 안심시키기, "진료에 필요해서요", "괜찮으니 말씀해주세요" 등)이면
  그 주제의 intent를 유지한다. 예: 직전에 생리 질문을 환자가 회피했는데 "힘드시겠지만 진료에 필요합니다"라고
  하면 intent는 ask_menstruation, empathy는 true다.

출력 형식 (JSON만):
{{
  "intent": "...",
  "empathy": true,
  "tone": "gentle",
  "pressure": false,
  "medical_relevance": "high",
  "is_sensitive_question": false,
  "is_premature_diagnosis": false
}}"""

# 폴백용 키워드 규칙 (LLM 불가 시에도 게임이 굴러가도록). 위에서부터 첫 매치 사용 → 구체적 규칙을 앞에.
_KEYWORD_RULES: list[tuple[str, list[str]]] = [
    # ── 진찰 중 자세 지시 — 무릎 세우기 (request_exam보다 먼저: '무릎'이 우선) ──
    ("flex_knees", ["무릎 세", "무릎을 세", "무릎 좀", "무릎 먼저 세", "무릎을 먼저 세", "무릎 굽", "무릎을 굽", "무릎 올려", "다리 세", "무릎 구부"]),
    # ── 진찰 준비 자세 — 턱 들기(갑상샘 시진) / 심호흡(폐 청진) ──
    # '턱'·'고개'로만 한정한다. 결막검사의 "위를 봐주세요"와 겹치면 안 된다(의학리뷰 #6과 같은 부류의 혼동).
    ("do_chin_up", ["턱을 들", "턱 들", "턱을 조금", "턱을 살짝", "턱을 위로", "턱 좀 들", "턱을 좀 들", "턱 한번 들",
                    "고개를 젖", "고개 젖", "고개를 뒤로", "고개를 들", "고개 들", "고개를 살짝 젖", "고개를 조금 젖"]),
    # 활용형 주의: "쉬어보"/"쉬어 보"/"쉬세요"가 각각 다르다.
    ("do_deep_breath", ["숨을 크게", "숨 크게", "크게 숨", "깊게 숨", "숨을 깊게", "깊이 숨", "숨을 깊이",
                        "심호흡", "깊게 들이", "깊이 들이", "크게 들이", "들이쉬", "들이 쉬", "들이마시",
                        "숨을 들이", "복식호흡", "숨을 쉬어", "숨 쉬어보", "숨 쉬어 보", "숨을 내쉬", "내쉬세요"]),
    # ── 손떨림검사 — 지시형 발화만 잡는다. "손떨림이 있으세요?" 같은 병력청취 질문을 뺏으면 안 된다 ──
    # 활용형 주의: "뻗어보"/"뻗어 보"/"뻗으세요"가 각각 다르다.
    ("do_tremor_check", ["손을 뻗", "손 뻗", "양손을 앞", "양손 앞", "두 손을 앞", "손을 앞으로", "팔을 앞으로",
                         "뻗어보", "뻗어 보", "뻗으세", "뻗어 주", "뻗어주",
                         "손을 펴", "손 펴", "손가락을 펴", "손가락 펴", "손바닥을 펴",
                         "손떨림을", "손 떨림을", "손떨림 검사", "떨림 검사", "떨림을 보", "떨림을 확인",
                         "떨리는지 보", "떨리는지 볼", "떨리는지 확인"]),
    # ── 진찰 도구 음성 (CVA는 '두드'가 타진과 겹쳐 먼저) ──
    ("do_cva", ["CVA", "cva", "늑골척추각", "갈비척추각", "옆구리를 두", "옆구리 두", "신장 타진", "등을 두"]),
    # ── 흉부 청진 — '청진'만 보는 do_auscultate(복부)보다 먼저 ──
    ("do_heart_auscultate", ["심음", "심장 소리", "심장소리", "심장을 청진", "심장 청진", "심장에 청진",
                             "심장을 들", "심장 좀 들", "심장을 한번 들", "심장 박동", "심박동", "심첨"]),
    ("do_lung_auscultate", ["폐음", "호흡음", "숨소리", "폐 소리", "폐소리", "허파",
                            "폐를 청진", "폐 청진", "폐를 들", "폐 좀 들", "폐야",
                            "흉부 청진", "흉부를 청진", "가슴 청진", "가슴을 청진", "등을 청진", "등 청진"]),
    # ── 간촉진 — '촉진/만져보'를 보는 do_palpate보다 먼저 ──
    # '간'은 '시간/인간'에도 들어가므로 반드시 촉진 동사와 붙은 형태만 쓴다.
    ("do_liver_palpate", ["간을 만져", "간 만져", "간을 촉진", "간 촉진", "간을 눌러", "간 눌러",
                          "간을 짚", "간이 만져지", "간을 좀 만져", "간연", "간 가장자리",
                          "갈비뼈 아래", "갈비뼈 밑", "갈비뼈 모서리", "늑골 아래", "늑골 밑", "늑골연"]),
    # ── 두경부 진찰 — 촉진("만져보")보다 구체적이므로 먼저 ──
    # [의학리뷰 #6] 결막과 공막은 평가표에서 별개 술기 행이다. 명시적 발화는 반드시 각자에게 간다.
    ("do_sclera", ["공막", "흰자위", "흰자", "황달", "눈이 노랗", "눈이 노란", "노란지", "노래졌", "황달기", "눈 흰 부분"]),
    # 활용형 주의: "보"와 "볼"은 다른 글자다 — "눈 좀 보겠습니다"와 "눈 좀 볼게요"가 각각 필요하다.
    ("do_conjunctiva", ["결막", "눈꺼풀", "아래 눈", "아랫눈", "위를 봐", "위를 쳐다", "위쪽을 봐", "위쪽을 쳐다",
                        "눈 좀 보", "눈 좀 볼", "눈을 좀 보", "눈을 좀 볼", "눈 한번 보", "눈 한번 볼",
                        "눈을 한번 보", "눈을 한번 볼", "눈 볼게", "눈을 볼", "눈 검사", "눈을 살펴"]),
    # 갑상샘 시진('본다')은 촉진('만진다')보다 먼저 — do_thyroid보다 앞에 둬야 '갑상샘'에 먼저 걸리지 않는다.
    ("do_thyroid_inspect", ["갑상샘을 보", "갑상샘 보", "갑상샘을 볼", "갑상샘 볼", "갑상샘을 좀 보", "갑상샘 좀 보",
                            "갑상샘을 한번 보", "갑상샘 시진", "갑상샘을 관찰", "갑상샘을 살펴",
                            "갑상선을 보", "갑상선 보", "갑상선을 볼", "갑상선 볼", "갑상선을 좀 보", "갑상선 좀 보",
                            "갑상선 시진", "갑상선을 관찰", "갑상선을 살펴",
                            # ⚠ 맨 '목'은 '손목/발목'과 겹친다("손목을 볼게요"가 갑상샘 시진이 되면 안 된다).
                            # 키워드는 부분문자열 매칭이라 앞 글자를 배제할 수 없으므로 여기엔 명확한 형태만 두고,
                            # "목을 보겠습니다" 류는 _CRITICAL_OVERRIDES의 lookbehind 정규식이 잡는다.
                            "목 앞을 보", "목 앞을 볼", "목 앞쪽을 보", "목 앞쪽을 볼", "목 앞을 관찰",
                            # 부사가 끼는 실제 발화 — "목 앞쪽을 좀 볼게요"가 촉진(do_thyroid)으로 새면
                            # 시진을 건너뛴 채 촉진만 한 것이 되어 must_precede 순서 위반 감점까지 물린다.
                            "목 앞을 좀 보", "목 앞을 좀 볼", "목 앞쪽을 좀 보", "목 앞쪽을 좀 볼",
                            "목 앞을 한번 보", "목 앞쪽을 한번 보", "목 앞쪽 좀 보", "목 앞쪽 좀 볼"]),
    # 삼킴은 갑상샘 시진·촉진의 **준비 동작(prep swallow)**이라 촉진(do_thyroid)보다 먼저 잡는다.
    # (평가표 시진③·촉진⑤ — 학생이 지시하지 않으면 삼킴 소견을 기록해선 안 된다)
    ("do_swallow", ["침을 삼", "침 삼", "물을 삼", "물 한 모금", "삼켜보", "삼켜 보", "삼켜볼", "삼켜 볼",
                    "삼키세", "삼켜 주", "삼켜주", "삼켜 보세", "삼킴", "꿀꺽"]),
    # ⚠ "목 앞을 만져보겠습니다" 가 여기서 안 걸리면 **아래 do_palpate('만져보')로 새고**,
    #   갑상샘 케이스에는 `palpation` 항목이 없어서 프론트가 진찰 전환을 통째로 포기한다
    #   — 화면에는 아무 일도 안 일어나고 이유도 안 보인다(리허설 2026-07-29에서 확인).
    #   '목 앞쪽'만 있고 '목 앞을'이 없던 것이 원인이었다. 촉진 동사와 짝지어 넓힌다.
    ("do_thyroid", ["갑상샘", "갑상선", "목 앞쪽", "목을 만져", "목 좀 만져", "목 촉진",
                    "목 앞을 만져", "목 앞 만져", "목 앞을 촉진", "목 앞 촉진",
                    "목 앞을 눌러", "목 앞을 짚", "목 앞을 좀 만져"]),
    # 구강검사 개시("입을 벌려보세요")가 발성 지시보다 먼저 — 한 문장에 섞이면 진찰 개시 쪽을 잡는다.
    ("do_oral", ["입을 벌", "입 벌", "입안", "입 안", "입속", "입 속", "구강", "혀를 내밀", "혀 내밀", "혀를 보", "설압자", "목구멍"]),
    # "아—" 발성 지시 (평가표 구강검사 ④) — prep say_ah
    ("do_say_ah", ["아 해보", "아- 해", "아— 해", "아~ 해", "아 하고", "아 소리", "아 라고", "아 발음", "발성"]),
    ("do_auscultate", ["청진"]),
    ("do_percuss", ["타진", "두드려", "두들겨", "두드리"]),
    ("do_palpate", ["촉진", "만져보", "만져볼", "만져 볼", "눌러보", "눌러볼", "눌러 볼", "짚어보", "짚어볼"]),
    # ── 진찰 준비 (가려주기·설명동의) — request_exam보다 먼저 (구체적 우선) ──
    ("hand_hygiene", ["손소독", "손 소독", "손을 소독", "손위생", "손을 씻", "손 씻", "손을 닦"]),
    # '가려'만 보면 "가려우세요?"(소양감 질문)를 진찰 준비로 오탐한다 →
    # 가리다(cover)의 활용형만 잡는다. 소양감은 '가려워/가려우~'라 아래 형태와 겹치지 않는다.
    ("drape", ["가려드리", "가려 드리", "가려드릴", "가려 드릴", "가려드려", "가려 드려",
               "가려줄", "가려 줄", "가려주", "가려 주", "가려놓", "가려 놓", "가려서",
               "가리고", "가리겠", "가릴게", "가릴까",
               "노출", "이불", "걷어", "드러내", "옷을 올", "옷 올", "옷을 걷", "옷 걷",
               # "옷을 살짝 올리겠습니다"처럼 부사가 끼는 실제 발화 — 정규식(옷.{0,6}올)과 눈높이를 맞춘다
               "옷을 살짝 올", "옷 살짝 올", "옷을 좀 올", "옷 좀 올"]),
    ("explain_consent", ["동의", "양해", "불편하실", "아프실 수", "진찰 전"]),
    # ── 단계 전환 — 진찰 권유 ──
    ("request_exam", ["누우", "눕", "침대", "진찰대", "진찰하겠", "진찰 좀", "진찰을 하", "진찰 한번", "진찰해", "검진하겠", "진찰 시작", "진찰을 시작"]),
    # ── 급성 통증 병력청취 (요로결석 등) — 구체적 규칙 우선 ──
    ("ask_urinary", ["소변", "배뇨", "혈뇨", "빈뇨", "오줌", "야간뇨", "절박뇨"]),
    ("ask_fever", ["열이", "발열", "오한", "미열", "춥거나", "몸살"]),
    ("ask_trauma", ["부딪", "다친", "외상", "넘어지", "삐끗", "맞은 적"]),
    ("ask_nausea_vomiting", ["메스", "구역", "토하", "구토", "울렁"]),
    ("ask_surgery", ["수술"]),
    ("ask_prior_episode", ["예전에도", "전에도", "비슷한 증상", "비슷한 적", "이런 적"]),
    ("ask_location", ["어느 부위", "어디쯤", "정확히 어디", "가리켜", "짚어", "어디가 아프"]),
    ("ask_quality", ["어떻게 아", "쑤시", "찌르", "쥐어짜", "타는 듯", "욱신", "뻐근", "칼로", "양상"]),
    ("ask_pain_change", ["자세", "움직일 때", "시간이 지나", "계속 아프", "간헐", "아프다가"]),
    # ── PPI 신호 ──
    ("self_introduce", ["학생의사", "제 이름", "담당 의", "저는 의사"]),
    ("summarize", ["그러니까", "정리하면", "정리해", "지금까지 말씀", "말씀을 정리"]),
    ("ask_daily_impact", ["생활하시는 데", "일상생활", "지장", "일하는 데", "생활에"]),
    ("ask_mood", ["기분은", "마음은", "우울하"]),
    ("ask_concern", ["걱정되는", "무슨 병", "원인이 뭐", "뭐라고 생각", "큰 병"]),
    ("ask_expectation", ["좋아졌으면", "바라는", "원하시는", "어떻게 해드리", "기대하"]),
    ("ask_background", ["입원 가능", "치료 가능", "검사 가능", "시간 되", "오실 수 있"]),
    # ── 기존 규칙 ──
    ("ask_menstruation", ["생리", "월경", "마지막 생리"]),
    ("ask_melena", ["변 색", "검은 변", "흑색변", "변이 검", "혈변", "대변"]),
    ("ask_pregnancy", ["임신"]),
    ("ask_bleeding", ["출혈", "피가", "코피"]),
    ("ask_diet", ["식사", "밥", "먹", "식욕", "음식"]),
    ("ask_sleep", ["잠", "수면", "주무"]),
    ("ask_medication", ["약", "복용", "영양제"]),
    ("ask_family_history", ["가족", "부모님", "어머니", "아버지", "유전"]),
    ("ask_past_history", ["병원", "과거", "예전에 아프", "진단받", "수술", "병력"]),
    # 수분 섭취는 생활력 문진의 일부다. 요로결석 기준 케이스의 hidden fact
    # (low_fluid_intake)가 이 인텐트로 열리는데 기존 키워드가 담배·술·직업뿐이라
    # "물 자주 드세요?" 류가 하나도 안 걸렸다.
    # ⚠ 맨 "물"은 넣지 마라 — 매칭이 단순 부분문자열이라 "약물"·"음식물"에 걸린다.
    #   규칙은 위에서부터 먼저 걸리는 것이 이기므로 오분류가 조용히 퍼진다.
    ("ask_social_history", ["담배", "흡연", "술", "음주", "직업", "수분", "커피", "카페인", "음료"]),
    ("ask_weight", ["체중", "몸무게", "살이 빠", "살이 쪘"]),
    ("ask_onset", ["언제부터", "시작", "처음"]),
    ("ask_duration", ["얼마나 됐", "기간", "며칠", "몇 주", "몇 달"]),
    ("ask_severity", ["얼마나 심", "심한가", "정도", "숨이 차", "두근", "계단"]),
    ("ask_aggravating_factor", ["심해지", "악화"]),
    ("ask_relieving_factor", ["나아지", "괜찮아지", "완화"]),
    ("ask_chief_complaint", ["어디가 불편", "어떻게 오셨", "무슨 일로", "어디가 아프"]),
    ("greeting", ["안녕", "반갑", "처음 뵙"]),
]

_EMPATHY_PAT = re.compile(
    r"(힘드|힘들|걱정|괜찮|불편하실|불편할|편하게|천천히|놀라|무서|두려|쉽지 않|"
    r"고생|애쓰|마음|이해해|괜찮아요|말하기 어려|조심스럽|미안|죄송)"
)
_PRESSURE_PAT = re.compile(r"(빨리 말|왜 말을|솔직히 말해|숨기지|거짓말|제대로 말|똑바로)")
_DIAGNOSIS_PAT = re.compile(r"(빈혈이네|빈혈입니다|확실해요|병이에요|진단(은|이)|.*인 것 같네요|틀림없)")
# 환자가 들으면 불안/충격을 느낄 만한 부정적·심각한 발언
_ALARMING_PAT = re.compile(
    r"(심각|위중|위험|큰 병|중병|암\b|악성|종양|응급|수술.{0,3}(해야|받아야|필요)|입원.{0,3}(해야|하셔야|필요)|"
    r"나쁜 소식|좋지 않|위독|생명|돌아가실|죽을|마비|불치|전이)"
)
# 환자를 안심시키는 긍정적·희망적 발언 (→ 안도/따뜻한 표정)
_REASSURING_PAT = re.compile(
    r"(좋아지실|좋아질|호전|나아지실|나아질|회복|괜찮아지실|괜찮아질|걱정 (안 하셔도|마|마세요|않으셔도)|"
    r"안심하셔도|크게 걱정|위험하지 않|심각하지 않|잘 (낫|치료|관리)|금방 (나|좋)|충분히 (치료|좋아))"
)
SENSITIVE_INTENTS = {"ask_menstruation", "ask_pregnancy", "ask_social_history"}

# 키워드가 LLM보다 정확한 '구체적 진찰 지시'와, 그것에 자리를 내줘도 되는 '뭉뚱그린' 인텐트.
# LLM이 범용 인텐트로 뭉갰을 때만 키워드 인텐트로 승격한다 (질문형 발화는 ask_*라 건드리지 않는다).
_SPECIFIC_KW_INTENTS = {
    "do_thyroid_inspect", "do_thyroid", "do_conjunctiva", "do_sclera", "do_oral", "do_cva",
    "do_heart_auscultate", "do_lung_auscultate", "do_liver_palpate",
    "do_tremor_check", "do_chin_up", "do_deep_breath", "do_swallow", "do_say_ah",
    "hand_hygiene", "flex_knees",
}
# do_thyroid/do_conjunctiva/do_sclera는 '더 구체적인 이웃'(시진 vs 촉진, 결막 vs 공막)이 생기면서
# 승격 대상이자 승격 출발점이 됐다 — 양쪽 집합에 모두 들어간다. 같은 인텐트끼리는 위 조건에서 걸러진다.
_GENERIC_LLM_INTENTS = {
    "request_exam", "explain_consent", "drape", "irrelevant_question", "flex_knees",
    "do_palpate", "do_percuss", "do_auscultate",
    "do_thyroid", "do_conjunctiva", "do_sclera", "do_oral",
}
# 결막/공막을 명시적으로 지목한 발화 — 이런 말은 절대 반대쪽 술기로 가면 안 된다 (의학리뷰 #6).
_EYE_EXPLICIT_PAT = re.compile(r"결막|눈꺼풀|공막|흰자|황달|노랗|노란|노래")

# 청진 부위를 명시적으로 지목한 발화. 눈과 같은 원리다 —
# "심장 소리 들어볼게요"는 흉부, "배에 대볼게요"는 복부로 고정되어야 한다.
# 반대로 그냥 "청진하겠습니다"는 부위를 안 정한 것이므로, 케이스가 가진 청진 항목으로 보내야
# 복통 케이스에선 복부 4분면이, 흉부 케이스에선 심장 판막·폐야가 뜬다.
_AUSC_EXPLICIT_PAT = re.compile(
    r"심장|심음|심첨|판막|폐|허파|호흡음|숨소리|가슴|흉부"      # 흉부 지목
    r"|복부|배꼽|장음|아랫배|윗배|명치"                        # 복부 지목
    r"|배에|배를|배 "                                        # "배에 대볼게요" 류
)


def _fallback_analyze(text: str) -> dict[str, Any]:
    intent = "irrelevant_question"
    for cand, kws in _KEYWORD_RULES:
        if any(k in text for k in kws):
            intent = cand
            break
    empathy = bool(_EMPATHY_PAT.search(text))
    pressure = bool(_PRESSURE_PAT.search(text))
    premature = bool(_DIAGNOSIS_PAT.search(text))
    if intent == "irrelevant_question" and empathy:
        intent = "show_empathy"
    relevance = "high" if intent.startswith("ask_") and intent != "ask_chief_complaint" else (
        "medium" if intent in ("ask_chief_complaint", "show_empathy") else "low"
    )
    return {
        "intent": intent,
        "empathy": empathy,
        "tone": "pressuring" if pressure else ("gentle" if empathy else "neutral"),
        "pressure": pressure,
        "medical_relevance": relevance,
        "is_sensitive_question": intent in SENSITIVE_INTENTS,
        "is_premature_diagnosis": premature,
        "engine": "fallback",
    }


def _normalize(raw: dict[str, Any]) -> dict[str, Any]:
    intent = raw.get("intent", "irrelevant_question")
    if intent not in INTENTS:
        intent = "irrelevant_question"
    tone = raw.get("tone", "neutral")
    if tone not in ("gentle", "neutral", "cold", "pressuring"):
        tone = "neutral"
    relevance = raw.get("medical_relevance", "low")
    if relevance not in ("high", "medium", "low"):
        relevance = "low"
    return {
        "intent": intent,
        "empathy": bool(raw.get("empathy", False)),
        "tone": tone,
        "pressure": bool(raw.get("pressure", False)) or tone == "pressuring",
        "medical_relevance": relevance,
        "is_sensitive_question": bool(raw.get("is_sensitive_question", False))
        or intent in SENSITIVE_INTENTS,
        "is_premature_diagnosis": bool(raw.get("is_premature_diagnosis", False))
        or intent == "give_premature_diagnosis",
        "engine": "llm",
    }


# 게임 핵심 의도는 LLM 분류가 틀려도 키워드로 강제 보정한다.
# 단계 전환(request_exam)·진찰 지시(flex_knees)는 게임 진행에 필수라 반드시 결정적으로 잡는다.
# ※ flex_knees가 request_exam보다 먼저 와야 한다('무릎' 우선; 첫 매치에서 break).
_CRITICAL_OVERRIDES: list[tuple[str, re.Pattern]] = [
    # '무릎'과 굽힘 동사 사이에 '먼저/좀/한번' 같은 부사가 끼어도 잡도록 간격을 넉넉히 둔다.
    ("flex_knees", re.compile(r"무릎.{0,12}(세|굽|구부|올려|들어)|다리.{0,10}(세워|세우|들어)")),
    # 키워드 목록과 같은 이유로 '가려' 단독 매칭을 버리고 가리다(cover) 활용형만 남긴다
    # ("가려우세요?" → drape 오탐 방지). '가려워/가려우'는 어느 대안에도 걸리지 않는다.
    ("drape", re.compile(
        r"가려\s?(드리|드릴|드려|주|줄|줍|놓|서)|가리(고|겠)|가릴(게|까|\s?거)|"
        r"노출|이불|걷어|드러내|옷.{0,6}(올|걷|벗|풀|내)|배.{0,6}(보여|드러|걷)"
    )),
    # 진찰 준비 자세 — 턱 들기 / 심호흡. '턱'·'고개'로 한정해 결막의 "위를 봐주세요"와 겹치지 않게 한다.
    ("do_chin_up", re.compile(r"(턱|고개).{0,8}(들|젖|올려|뒤로)")),
    ("do_deep_breath", re.compile(
        r"심호흡|복식호흡|숨.{0,4}(크게|깊게|깊이)|(크게|깊게|깊이).{0,4}(숨|들이)|들이\s?쉬|들이마시|숨을 쉬어|숨 쉬어\s?보"
    )),
    # 삼킴 지시(prep swallow) — 갑상샘 촉진(do_thyroid)보다 먼저. 지시형만 잡는다
    # ("음식을 삼키기 어렵나요?" 같은 연하곤란 병력청취를 뺏으면 안 된다).
    ("do_swallow", re.compile(
        r"(침|물|꿀꺽)\s?(을|를|한\s?모금)?\s?(한번\s?|좀\s?|살짝\s?|다시\s?)?삼|"
        r"삼켜\s?(보|주|봐|볼)|삼키세요|삼키시|삼킴"
    )),
    # "아—" 발성 지시(prep say_ah) — 구강검사 개시(do_oral)와 구분된다.
    ("do_say_ah", re.compile(r"아[\-—~]?\s?(해\s?보|하고|소리|라고|발음)|발성")),
    # 손떨림검사 — 지시형만. "손떨림 있으세요?" 같은 병력청취 질문은 잡지 않는다.
    ("do_tremor_check", re.compile(
        r"(손|양손|두 손|팔|손가락|손바닥).{0,8}(뻗|펴)|뻗어\s?(보|주)|뻗으세|"
        r"손\s?떨림을|(손\s?)?떨림\s?검사|떨림을\s?(보|확인)|떨리는지\s?(보|볼|확인)"
    )),
    # 진찰 도구 음성 (CVA는 '옆구리 두드림'에 '두드'가 있어 타진보다 먼저)
    ("do_cva", re.compile(r"CVA|cva|늑골척추각|갈비척추각|신장.{0,4}타진|(옆구리|등).{0,5}(두드|타진|쳐|침)")),
    # 흉부 청진 — '청진'만 보는 do_auscultate(복부)보다 반드시 먼저 와야 한다.
    ("do_heart_auscultate", re.compile(r"심음|심첨|심장\s?(소리|박동)|심박동|심장.{0,6}(청진|들어|들을|듣)")),
    ("do_lung_auscultate", re.compile(r"폐음|호흡음|숨소리|폐\s?소리|허파|폐야|폐.{0,6}(청진|들어|들을|듣)|(흉부|가슴|등).{0,4}청진")),
    # 간촉진 — '촉진/만져 보'를 보는 do_palpate보다 먼저. '간'은 '시간/인간'과 겹치므로 동사와 붙은 형태만.
    ("do_liver_palpate", re.compile(r"간(을|이|은)?\s{0,2}(촉진|만져|눌러|짚어)|(갈비뼈|늑골)\s?(아래|밑|모서리)|늑골연")),
    # 갑상샘 시진('본다')과 촉진('만진다')은 별개 항목이다. 시진을 먼저 잡는다.
    # '목'은 '손목/발목'과 겹치므로 lookbehind로 제외한다.
    # ⚠ ".{0,8}" 같은 느슨한 간격을 쓰면 "갑상샘을 만져보겠습니다"의 '보'에 걸려 촉진이 시진으로 둔갑한다.
    # 부사(좀/한번/먼저/살짝)는 여러 개가 겹칠 수 있고("목 앞쪽을 좀 한번 볼게요"),
    # '목' 뒤에는 '앞/앞쪽'이 붙는 경우가 많다("목 앞쪽을 좀 볼게요").
    # 시진 어휘(보/볼/봐/살펴/관찰/시진)로만 끝나므로 "목 앞쪽을 촉진할게요"·"갑상샘을 만져보겠습니다"는
    # 여기에 걸리지 않고 아래 do_palpate→승격 경로로 do_thyroid(촉진)에 남는다.
    ("do_thyroid_inspect", re.compile(
        r"갑상(샘|선)\s?(을|를)?\s?(좀\s?|한번\s?|먼저\s?|살짝\s?)*(보|볼|봐|살펴|관찰|시진)|"
        r"(?<!손)(?<!발)목\s?(앞쪽?)?\s?(을|를)?\s?(좀\s?|한번\s?|먼저\s?|살짝\s?)*(보|볼|봐|살펴|관찰)"
    )),
    # 갑상샘 **촉진** — 반드시 아래 do_palpate 보다 먼저. 종전에는 이 항목이 없어서
    # "갑상샘 촉진 한 번 해볼게요" 가 do_palpate(복부 촉진)로 잡혔고, 갑상항진증 케이스엔
    # 복부 촉진 항목이 없으니 `setExamTool` 이 거부해 **아무 일도 안 일어났다**(사용자 신고).
    # ⚠ 위치 기반 정규식으로는 부족하다 — "갑상샘에 문제가 있을 수도 있어서 촉진 한 번 해볼게요"
    #   처럼 명사와 동사가 15자 넘게 떨어지는 실제 발화가 있다. 그래서 **둘 다 존재**를 본다.
    # ⚠ 질문형은 뺀다. "갑상샘 만져본 적 있으세요?" 는 병력청취라 진찰로 전환하면 안 된다.
    # '목'은 '손목/발목'과 겹치므로 lookbehind 로 제외한다(do_thyroid_inspect 와 같은 이유).
    ("do_thyroid", re.compile(
        r"^(?!.*(적\s?있|있으세|있나요|있었|해\s?보셨|받아\s?보셨))"
        r"(?=.*(갑상(샘|선)|(?<!손)(?<!발)목\s?앞))(?=.*(촉진|만져|만지|눌러|짚어))"
    )),
    ("do_auscultate", re.compile(r"청진")),
    ("do_percuss", re.compile(r"타진|두드려|두들겨|두드리")),
    # ⚠ 어미를 `보` 로만 끊으면 **"만져 볼게요" 를 놓친다**('보'와 '볼'은 다른 글자다).
    #   한국어에서 제일 흔한 형태인데 종전 패턴이 못 잡아 복부 촉진이 발화로 안 걸렸다.
    #   '보'(만져 보겠습니다)·'볼'(만져 볼게요)·'봐'(만져 봐요) 세 활용을 모두 인정한다.
    ("do_palpate", re.compile(r"촉진|(만져|눌러|짚어)\s?(보|볼|봐)")),
    ("request_exam", re.compile(
        r"침대|진찰대|눕|누우|눕히|"
        r"진찰(을|를|\s)?\s*(좀|한번|시작|하|할|해|보)|"
        r"검진(을|를|\s)?\s*(좀|한번|시작|하|할|해|보)"
    )),
    ("explain_consent", re.compile(r"동의|양해|불편하실|아프실 수|진찰 전")),
    ("ask_melena", re.compile(r"(변|대변).{0,8}(검|색)|흑색변|검은\s*변")),
    ("ask_menstruation", re.compile(r"생리|월경")),
    ("ask_pregnancy", re.compile(r"임신")),
]


def _apply_overrides(result: dict[str, Any], text: str) -> dict[str, Any]:
    for intent, pat in _CRITICAL_OVERRIDES:
        if result["intent"] != intent and pat.search(text):
            result["intent"] = intent
            result["is_sensitive_question"] = intent in SENSITIVE_INTENTS
            break
    return result


def merge_keyword_signals(result: dict[str, Any], text: str) -> dict[str, Any]:
    """키워드 규칙을 보조 신호로 병합 — LLM이 다른 인텐트로 분류해도 명백한 키워드 매칭은
    커버리지(asked_topics)에 반영되게 한다 (피드백 오탐 "물어봤는데 안 물었다" 방지).
    또한 구체적 진찰 지시("갑상샘 만져보겠습니다" 등)는 키워드가 더 정확하므로, LLM이 범용
    진찰 인텐트(request_exam/do_palpate 등)로 뭉뚱그렸을 때만 키워드 인텐트로 승격한다.
    (질문형 발화 "갑상샘 검사 받아본 적 있어요?"는 LLM이 ask_*로 분류하므로 건드리지 않음)"""
    kw_intent = None
    for cand, kws in _KEYWORD_RULES:
        if any(k in text for k in kws):
            kw_intent = cand
            break
    kw_topic = INTENT_TOPIC.get(kw_intent) if kw_intent else None
    result["secondary_topic"] = kw_topic if (kw_topic and kw_topic != result.get("topic")) else None
    if kw_intent in _SPECIFIC_KW_INTENTS and result["intent"] in _GENERIC_LLM_INTENTS and result["intent"] != kw_intent:
        result["intent"] = kw_intent
        result["topic"] = INTENT_TOPIC.get(kw_intent, result.get("topic"))
    # [의학리뷰 #6] "눈 좀 볼게요"처럼 결막·공막 중 무엇인지 특정하지 않은 발화는 do_conjunctiva로
    # 떨어지지만 그게 학생의 의도라는 보장이 없다. 프론트가 "케이스가 가진 눈 항목"으로 보내도 되는지를
    # 판단할 수 있게 모호 여부를 따로 실어 보낸다 (명시 발화는 절대 다른 항목으로 가면 안 된다).
    result["eye_target_ambiguous"] = bool(
        result["intent"] in ("do_conjunctiva", "do_sclera") and not _EYE_EXPLICIT_PAT.search(text)
    )
    # 청진도 같은 문제가 있다. "청진하겠습니다"는 do_auscultate(복부)로 떨어지는데,
    # 공황장애처럼 흉부 청진만 있는 케이스에서는 있지도 않은 복부 4분면이 떠서 학생이 막힌다.
    # 부위를 지목하지 않은 발화만 프론트가 "케이스가 가진 청진 항목"으로 돌릴 수 있게 표시한다.
    result["ausc_target_ambiguous"] = bool(
        result["intent"] in ("do_auscultate", "do_heart_auscultate", "do_lung_auscultate")
        and not _AUSC_EXPLICIT_PAT.search(text)
    )
    return result


async def analyze(text: str, history: str = "") -> dict[str, Any]:
    """발화 의도 분석. history는 최근 대화 (맥락 연속 판단용). LLM 실패 시 키워드 폴백."""
    result: dict[str, Any] | None = None
    user_prompt = (
        f"최근 대화:\n{history}\n\n이번 사용자 발화:\n\"{text}\"" if history else f'사용자 발화:\n"{text}"'
    )
    try:
        out = await llm_service.chat(
            SYSTEM_PROMPT.format(intents=", ".join(INTENTS)),
            user_prompt,
            json_mode=True,
            temperature=0.1,
            max_tokens=256,
        )
        raw = llm_service.extract_json(out)
        if raw:
            result = _normalize(raw)
    except Exception:
        pass
    if result is None:
        result = _fallback_analyze(text)
    result = _apply_overrides(result, text)
    result["topic"] = INTENT_TOPIC.get(result["intent"], "irrelevant")
    # 키워드 규칙을 보조 신호로 병합 — LLM이 다른 인텐트로 분류해도 명백한 키워드 매칭은
    # 커버리지(asked_topics)에 반영되게 한다 (피드백 오탐 "물어봤는데 안 물었다" 방지)
    merge_keyword_signals(result, text)
    result["is_red_flag_check"] = result["intent"] in RED_FLAG_INTENTS
    result["is_alarming"] = bool(_ALARMING_PAT.search(text))
    result["is_reassuring"] = bool(_REASSURING_PAT.search(text))
    return result
