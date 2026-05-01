"""/models/procrastination.py"""
"""Pydantic models for procrastination detection."""

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class UserCalibration(BaseModel):
    """User study preferences for procrastination detection."""
    user_id: str
    focus_period: str = "morning"  # morning, afternoon, evening, night
    study_days: Optional[List[str]] = None  # e.g. ["Mon", "Tue", "Wed", "Thu", "Fri"]
    study_duration_hours: float = 2.0
    updated_at: datetime = Field(default_factory=datetime.utcnow)

