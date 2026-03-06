"""Pydantic schemas for the Smart Intervention Engine API."""

from pydantic import BaseModel
from typing import List, Optional


class BanditSelectRequest(BaseModel):
    user_id: str
    x: List[float]          # context vector, len == 12
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
    motivation: float        # x[6] from the context vector, range [0, 1]
    scenario: str            # 'A' | 'B' | 'C'
    timestamp: Optional[float] = None


class UserGoal(BaseModel):
    life_goal: str


class InterventionLog(BaseModel):
    strategy: str
    action: str
    timestamp: Optional[float] = None
