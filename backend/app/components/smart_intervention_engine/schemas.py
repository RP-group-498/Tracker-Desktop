"""Pydantic schemas for the Smart Intervention Engine API."""

from pydantic import BaseModel
from typing import List, Optional


class BanditSelectRequest(BaseModel):
    user_id: str
    # Context vector (9 elements):
    # [0] bias           - always 1.0
    # [1] expectancy     - TMT E proxy (task_completion_rate)
    # [2] value          - TMT V proxy (max(task_priority, grade_weight))
    # [3] impulsiveness  - TMT I proxy (non_academic_ratio)
    # [4] delay          - TMT D proxy (hours_to_deadline normalized)
    # [5] motivation     - TMT score: (E*V) / (1 + I*D)
    # [6] deficit_code   - dominant TMT deficit (ordinal: 0.0/0.33/0.67/1.0)
    # [7] session_dur    - session duration normalized (0-1, caps at 4h)
    # [8] time_of_day    - current hour / 24
    x: List[float]          # context vector, len == 9
    alpha: float = 1.0      # exploration parameter


class BanditSelectResponse(BaseModel):
    action: str
    allowed_actions: List[str]


class BanditUpdateRequest(BaseModel):
    user_id: str
    x: List[float]
    action: str
    reward: float           # Start=1.0, Not Now=0.4, Skip=0.2
    button: str             # "start" | "not_now" | "skip"
    alpha: float = 1.0


class MotivationLogEntry(BaseModel):
    user_id: str
    motivation: float        # x[5] from the context vector (TMT motivation score), range [0, 1]
    scenario: str            # 'A' | 'B' | 'C'
    timestamp: Optional[float] = None
    context_vector: Optional[List[float]] = None


class UserGoal(BaseModel):
    life_goal: str


class InterventionLog(BaseModel):
    strategy: str
    action: str
    timestamp: Optional[float] = None
