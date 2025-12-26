"""Session management endpoints."""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.activity import BrowserSession, ActivityEvent
from app.schemas.session import SessionCreate, SessionResponse, SessionUpdate

router = APIRouter()


@router.post("", response_model=SessionResponse)
async def create_session(
    session_data: SessionCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new browser tracking session.

    Called when the desktop app starts or when manually starting a new session.
    Returns session_id to be sent to the browser extension.
    """
    session_id = str(uuid.uuid4())

    new_session = BrowserSession(
        session_id=session_id,
        user_id=session_data.user_id,
        start_time=datetime.utcnow(),
        status="active",
    )

    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)

    return SessionResponse(
        session_id=new_session.session_id,
        user_id=new_session.user_id,
        start_time=new_session.start_time,
        end_time=new_session.end_time,
        status=new_session.status,
        activity_count=0,
    )


@router.get("/current", response_model=Optional[SessionResponse])
async def get_current_session(db: AsyncSession = Depends(get_db)):
    """Get the current active session, if any."""
    result = await db.execute(
        select(BrowserSession)
        .where(BrowserSession.status == "active")
        .order_by(BrowserSession.start_time.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()

    if not session:
        return None

    # Count activities
    count_result = await db.execute(
        select(func.count(ActivityEvent.id))
        .where(ActivityEvent.session_id == session.session_id)
    )
    activity_count = count_result.scalar() or 0

    return SessionResponse(
        session_id=session.session_id,
        user_id=session.user_id,
        start_time=session.start_time,
        end_time=session.end_time,
        status=session.status,
        activity_count=activity_count,
    )


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific session by ID."""
    result = await db.execute(
        select(BrowserSession).where(BrowserSession.session_id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Count activities
    count_result = await db.execute(
        select(func.count(ActivityEvent.id))
        .where(ActivityEvent.session_id == session.session_id)
    )
    activity_count = count_result.scalar() or 0

    return SessionResponse(
        session_id=session.session_id,
        user_id=session.user_id,
        start_time=session.start_time,
        end_time=session.end_time,
        status=session.status,
        activity_count=activity_count,
    )


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    update_data: SessionUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a session (e.g., pause, resume, end)."""
    result = await db.execute(
        select(BrowserSession).where(BrowserSession.session_id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if update_data.status:
        session.status = update_data.status

    if update_data.end_time:
        session.end_time = update_data.end_time
    elif update_data.status == "ended" and not session.end_time:
        session.end_time = datetime.utcnow()

    await db.commit()
    await db.refresh(session)

    # Count activities
    count_result = await db.execute(
        select(func.count(ActivityEvent.id))
        .where(ActivityEvent.session_id == session.session_id)
    )
    activity_count = count_result.scalar() or 0

    return SessionResponse(
        session_id=session.session_id,
        user_id=session.user_id,
        start_time=session.start_time,
        end_time=session.end_time,
        status=session.status,
        activity_count=activity_count,
    )


@router.post("/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """End a session."""
    result = await db.execute(
        select(BrowserSession).where(BrowserSession.session_id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = "ended"
    session.end_time = datetime.utcnow()

    await db.commit()
    await db.refresh(session)

    # Count activities
    count_result = await db.execute(
        select(func.count(ActivityEvent.id))
        .where(ActivityEvent.session_id == session.session_id)
    )
    activity_count = count_result.scalar() or 0

    return SessionResponse(
        session_id=session.session_id,
        user_id=session.user_id,
        start_time=session.start_time,
        end_time=session.end_time,
        status=session.status,
        activity_count=activity_count,
    )
