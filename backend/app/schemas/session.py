"""Pydantic schemas for session management."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class SessionCreate(BaseModel):
    """Schema for creating a new session."""
    user_id: Optional[str] = Field(None, alias="userId")

    class Config:
        populate_by_name = True


class SessionResponse(BaseModel):
    """Response schema for session info."""
    session_id: str
    user_id: Optional[str] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str
    activity_count: int = 0

    class Config:
        from_attributes = True


class SessionUpdate(BaseModel):
    """Schema for updating session."""
    status: Optional[str] = None  # active, paused, ended
    end_time: Optional[datetime] = None


class SessionMessage(BaseModel):
    """Message sent to browser extension with session info."""
    type: str = "session"
    session_id: str = Field(..., alias="sessionId")
    user_id: Optional[str] = Field(None, alias="userId")
    status: str  # active, paused, ended

    class Config:
        populate_by_name = True
