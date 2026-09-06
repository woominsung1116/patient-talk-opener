"""세션 저장소 — MVP는 인메모리 + 종료 시 JSON 로그 덤프."""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

_sessions: dict[str, dict[str, Any]] = {}


def create(case: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    session = {
        "session_id": f"sess_{uuid.uuid4().hex[:10]}",
        "case_id": case["case_id"],
        "current_turn": 0,
        "status": "in_progress",  # in_progress | submitted | failed_trust | timeout
        "started_at": time.time(),
        "ended_at": None,
        "state": state,
        "dialogue": [],
        # 신체진찰 단계 기록 (CPX 케이스). exam_order = 수행 순서, performed = 집합 표현
        "exam_log": [],          # [{"action_id","label","finding","at_turn"}]
        # 환자교육 제출 (submit 시 채움)
        "education": None,       # {"diagnosis_evidence":[...],"test_plan":[...],"treatment":[...],"complication":[...]}
    }
    _sessions[session["session_id"]] = session
    return session


def get(session_id: str) -> dict[str, Any] | None:
    return _sessions.get(session_id)


def finish(session: dict[str, Any], status: str) -> None:
    session["status"] = status
    session["ended_at"] = time.time()
    try:
        path = LOG_DIR / f"{session['session_id']}.json"
        path.write_text(json.dumps(session, ensure_ascii=False, indent=2, default=str))
    except Exception:
        pass
