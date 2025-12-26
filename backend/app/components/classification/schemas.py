"""Pydantic schemas for classification component."""

from pydantic import BaseModel
from typing import Optional, Literal


CategoryType = Literal["academic", "productivity", "neutral", "non_academic"]
SourceType = Literal["stub", "database", "rules", "model", "user", "api"]


class ClassificationInput(BaseModel):
    """Input schema for classification."""

    domain: str
    url: str = ""
    title: str = ""
    active_time: int = 0  # seconds
    path: str = ""

    # Optional context for better classification
    youtube_context: Optional[dict] = None
    google_context: Optional[dict] = None
    social_context: Optional[dict] = None


class ClassificationOutput(BaseModel):
    """Output schema for classification."""

    category: CategoryType
    confidence: float  # 0.0 to 1.0
    source: SourceType

    # Optional reasoning
    matched_rule: Optional[str] = None
    explanation: Optional[str] = None
