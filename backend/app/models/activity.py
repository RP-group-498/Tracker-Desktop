"""SQLAlchemy models for activity tracking."""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, JSON, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class BrowserSession(Base):
    """Browser tracking session."""

    __tablename__ = "browser_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), unique=True, index=True, nullable=False)
    user_id = Column(String(36), nullable=True)
    start_time = Column(DateTime, nullable=False, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    status = Column(String(20), default="active")  # active, paused, ended

    # Relationships
    activities = relationship("ActivityEvent", back_populates="session", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<BrowserSession {self.session_id} ({self.status})>"


class Classification(Base):
    """Classification result for an activity."""

    __tablename__ = "classifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(50), nullable=False)  # academic, productivity, neutral, non_academic
    confidence = Column(Float, nullable=False)
    source = Column(String(50), nullable=False)  # stub, database, rules, model, user
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    activities = relationship("ActivityEvent", back_populates="classification")

    def __repr__(self) -> str:
        return f"<Classification {self.category} ({self.confidence:.2f})>"


class ActivityEvent(Base):
    """Browser activity event from the extension."""

    __tablename__ = "activity_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(String(36), unique=True, index=True, nullable=False)

    # Session reference
    session_id = Column(String(36), ForeignKey("browser_sessions.session_id"), nullable=True, index=True)

    # Timestamps
    timestamp = Column(DateTime, nullable=False, index=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)

    # URL info
    url = Column(Text, nullable=False)
    domain = Column(String(255), nullable=False, index=True)
    path = Column(String(1024), nullable=True)
    title = Column(String(512), nullable=True)

    # Time tracking
    active_time = Column(Integer, default=0)  # seconds
    idle_time = Column(Integer, default=0)  # seconds

    # Tab info
    tab_id = Column(Integer, nullable=True)
    window_id = Column(Integer, nullable=True)
    is_incognito = Column(Boolean, default=False)

    # Enrichment data (stored as JSON)
    url_components = Column(JSON, nullable=True)
    title_hints = Column(JSON, nullable=True)
    engagement = Column(JSON, nullable=True)
    context_data = Column(JSON, nullable=True)  # youtube, google, social context

    # Classification reference
    classification_id = Column(Integer, ForeignKey("classifications.id"), nullable=True)

    # Relationships
    session = relationship("BrowserSession", back_populates="activities")
    classification = relationship("Classification", back_populates="activities")

    def __repr__(self) -> str:
        return f"<ActivityEvent {self.event_id} ({self.domain})>"
