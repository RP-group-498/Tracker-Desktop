"""Pydantic schemas for activity events."""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime


class UrlComponents(BaseModel):
    """Parsed URL components from browser extension."""
    protocol: Optional[str] = None
    domain: Optional[str] = None
    subdomain: Optional[str] = None
    path: Optional[str] = None
    path_segments: Optional[List[str]] = Field(None, alias="pathSegments")
    query_params: Optional[Dict[str, str]] = Field(None, alias="queryParams")
    hash: Optional[str] = None

    class Config:
        populate_by_name = True


class TitleHints(BaseModel):
    """Title analysis hints from browser extension."""
    word_count: Optional[int] = Field(None, alias="wordCount")
    has_numbers: Optional[bool] = Field(None, alias="hasNumbers")
    possible_video: Optional[bool] = Field(None, alias="possibleVideo")
    possible_search: Optional[bool] = Field(None, alias="possibleSearch")
    possible_docs: Optional[bool] = Field(None, alias="possibleDocs")

    class Config:
        populate_by_name = True


class EngagementMetrics(BaseModel):
    """User engagement metrics."""
    active_time: Optional[int] = Field(None, alias="activeTime")
    idle_time: Optional[int] = Field(None, alias="idleTime")
    active_ratio: Optional[float] = Field(None, alias="activeRatio")
    was_engaged: Optional[bool] = Field(None, alias="wasEngaged")

    class Config:
        populate_by_name = True


class YouTubeContext(BaseModel):
    """YouTube-specific context."""
    is_video: Optional[bool] = Field(None, alias="isVideo")
    video_id: Optional[str] = Field(None, alias="videoId")
    is_playlist: Optional[bool] = Field(None, alias="isPlaylist")
    is_channel: Optional[bool] = Field(None, alias="isChannel")
    is_search: Optional[bool] = Field(None, alias="isSearch")
    search_query: Optional[str] = Field(None, alias="searchQuery")
    title_for_classification: Optional[str] = Field(None, alias="titleForClassification")

    class Config:
        populate_by_name = True


class GoogleContext(BaseModel):
    """Google services context."""
    service: Optional[str] = None
    is_search: Optional[bool] = Field(None, alias="isSearch")
    search_query: Optional[str] = Field(None, alias="searchQuery")
    is_scholar: Optional[bool] = Field(None, alias="isScholar")
    is_docs: Optional[bool] = Field(None, alias="isDocs")
    is_drive: Optional[bool] = Field(None, alias="isDrive")
    is_classroom: Optional[bool] = Field(None, alias="isClassroom")

    class Config:
        populate_by_name = True


class SocialContext(BaseModel):
    """Social media context."""
    platform: Optional[str] = None
    is_direct_content: Optional[bool] = Field(None, alias="isDirectContent")
    is_feed: Optional[bool] = Field(None, alias="isFeed")
    is_messaging: Optional[bool] = Field(None, alias="isMessaging")
    possible_academic: Optional[bool] = Field(None, alias="possibleAcademic")

    class Config:
        populate_by_name = True


class ActivityEventCreate(BaseModel):
    """Schema for incoming activity events from browser extension."""

    event_id: str = Field(..., alias="eventId")
    session_id: Optional[str] = Field(None, alias="sessionId")
    timestamp: datetime
    start_time: datetime = Field(..., alias="startTime")
    end_time: Optional[datetime] = Field(None, alias="endTime")
    url: str
    domain: str
    path: str = ""
    title: str = ""
    active_time: int = Field(0, alias="activeTime")
    idle_time: int = Field(0, alias="idleTime")
    tab_id: int = Field(..., alias="tabId")
    window_id: int = Field(..., alias="windowId")
    is_incognito: bool = Field(False, alias="isIncognito")

    # Optional enrichment data
    url_components: Optional[UrlComponents] = Field(None, alias="urlComponents")
    title_hints: Optional[TitleHints] = Field(None, alias="titleHints")
    engagement: Optional[EngagementMetrics] = None
    youtube_context: Optional[YouTubeContext] = Field(None, alias="youtubeContext")
    google_context: Optional[GoogleContext] = Field(None, alias="googleContext")
    social_context: Optional[SocialContext] = Field(None, alias="socialContext")

    class Config:
        populate_by_name = True


class ClassificationResult(BaseModel):
    """Classification result for an activity."""
    category: str
    confidence: float
    source: str


class ActivityEventResponse(BaseModel):
    """Response schema for activity events."""
    event_id: str
    domain: str
    title: str
    active_time: int
    timestamp: datetime
    classification: Optional[ClassificationResult] = None

    class Config:
        from_attributes = True


class ActivityBatchRequest(BaseModel):
    """Schema for activity batch from extension."""

    type: str = "activity_batch"
    events: List[ActivityEventCreate]
    extension_version: str = Field(..., alias="extensionVersion")
    timestamp: datetime

    class Config:
        populate_by_name = True


class ActivityBatchResponse(BaseModel):
    """Response to activity batch submission."""

    success: bool
    received_count: int
    received_ids: List[str]
    errors: Optional[List[str]] = None
