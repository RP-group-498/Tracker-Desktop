"""Pydantic models for activity tracking."""

from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class Classification(BaseModel):
    """Classification result for an activity."""
    category: str = Field(..., description="academic, productivity, neutral, non_academic")
    confidence: float
    source: str = Field(..., description="stub, database, rules, model, user")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ActivityEvent(BaseModel):
    """Activity event from browser extension or desktop tracker."""
    event_id: str
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    source: str = "browser"  # browser, desktop
    activity_type: str = "webpage"  # webpage, application
    
    # Timestamps
    timestamp: datetime
    start_time: datetime
    end_time: Optional[datetime] = None

    # URL/Domain info (for browser events)
    url: str
    domain: str
    path: Optional[str] = None
    title: Optional[str] = None

    # Desktop-specific fields
    app_name: Optional[str] = None
    app_path: Optional[str] = None
    window_title: Optional[str] = None

    # Time tracking
    active_time: int = 0  # milliseconds
    idle_time: int = 0  # milliseconds

    # Tab info (for browser events)
    tab_id: Optional[int] = None
    window_id: Optional[int] = None
    is_incognito: bool = False

    # Enrichment data
    url_components: Optional[Dict[str, Any]] = None
    title_hints: Optional[Dict[str, Any]] = None
    engagement: Optional[Dict[str, Any]] = None
    context_data: Optional[Dict[str, Any]] = None

    # Embedded Classification
    classification: Optional[Classification] = None


class BrowserSession(BaseModel):
    """Browser tracking session."""
    session_id: str
    user_id: Optional[str] = None
    start_time: datetime = Field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    status: str = "active"  # active, paused, ended

