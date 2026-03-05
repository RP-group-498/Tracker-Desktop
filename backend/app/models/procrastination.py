"""/models/procrastination.py"""
"""SQLAlchemy models for procrastination detection."""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, JSON

from app.core.database import Base


class UserCalibration(Base):
    """User study preferences for procrastination detection."""

    __tablename__ = "user_calibration"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(36), unique=True, index=True, nullable=False)
    focus_period = Column(String(20), default="morning")  # morning, afternoon, evening, night
    study_days = Column(JSON, nullable=True)  # e.g. ["Mon", "Tue", "Wed", "Thu", "Fri"]
    study_duration_hours = Column(Float, default=2.0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self) -> str:
        return f"<UserCalibration user={self.user_id} focus={self.focus_period}>"

