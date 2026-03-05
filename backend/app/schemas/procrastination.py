"""schemas/procrastination.py"""
"""Pydantic schemas for procrastination detection."""

from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field


class CalibrationCreate(BaseModel):
    focus_period: str = Field("morning", description="morning | afternoon | evening | night")
    study_days: List[str] = Field(default_factory=list, description='e.g. ["Mon","Tue"]')
    study_duration_hours: float = Field(2.0, ge=0.5, le=12.0)


class CalibrationResponse(BaseModel):
    user_id: str
    focus_period: str
    study_days: List[str]
    study_duration_hours: float
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PatternResult(BaseModel):
    type: str
    severity: str
    evidence: str


# class ActiveTimeInfo(BaseModel):
#     activeStart: Optional[str] = None
#     activeEnd: Optional[str] = None
#     academicMinutes: int
#     nonAcademicMinutes: int
#     appSwitches: int
#     expectedStudyMinutes: int
#     status: str

class ActiveTimeInfo(BaseModel):
    activeStart: Optional[str] = None
    activeEnd: Optional[str] = None

    # active-window (focus-window best slice)
    academicMinutes: int
    nonAcademicMinutes: int

    academicAppSwitches: int = 0
    nonAcademicAppSwitches: int = 0
    totalAppSwitches: int = 0

    expectedStudyMinutes: int
    status: str

    # ✅ NEW: full-day (24h) totals
    fullDayAcademicMinutes: int = 0
    fullDayNonAcademicMinutes: int = 0
    fullDayAcademicAppSwitches: int = 0
    fullDayNonAcademicAppSwitches: int = 0
    fullDayTotalAppSwitches: int = 0

    # Optional: academic - non-academic over full day
    fullDayNetAcademicMinutes: int = 0

class PredictionInfo(BaseModel):
    date: str
    day: str
    predictedActiveStart: str
    predictedActiveEnd: str
    predictedAcademicMinutes: int


class ProcrastinationReport(BaseModel):
    date: str
    score: float
    level: str
    dominantPattern: Optional[str] = None
    patterns: List[PatternResult]
    activeTime: ActiveTimeInfo
    prediction: Optional[PredictionInfo] = None
