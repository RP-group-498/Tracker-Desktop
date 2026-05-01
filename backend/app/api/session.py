"""Session management endpoints."""

import uuid
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.models.activity import BrowserSession
from app.schemas.session import SessionCreate, SessionResponse, SessionUpdate
from app.api.deps import get_current_user

router = APIRouter()


@router.post("", response_model=SessionResponse)
async def create_session(
    session_data: SessionCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Create a new browser tracking session."""
    session_id = str(uuid.uuid4())
    now = datetime.utcnow()

    new_session = BrowserSession(
        session_id=session_id,
        user_id=current_user["sub"],
        start_time=now,
        status="active",
    )

    await db.browser_sessions.insert_one(new_session.model_dump())

    return SessionResponse(
        session_id=new_session.session_id,
        user_id=new_session.user_id,
        start_time=new_session.start_time,
        end_time=new_session.end_time,
        status=new_session.status,
        activity_count=0,
    )


@router.get("/current", response_model=Optional[SessionResponse])
async def get_current_session(
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get the current active session, if any."""
    session = await db.browser_sessions.find_one(
        {"status": "active", "user_id": current_user["sub"]},
        sort=[("start_time", -1)]
    )

    if not session:
        return None

    # Count activities
    activity_count = await db.activity_events.count_documents(
        {"session_id": session["session_id"]}
    )

    return SessionResponse(
        session_id=session["session_id"],
        user_id=session.get("user_id"),
        start_time=session["start_time"],
        end_time=session.get("end_time"),
        status=session["status"],
        activity_count=activity_count,
    )


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get a specific session by ID."""
    session = await db.browser_sessions.find_one({
        "session_id": session_id,
        "user_id": current_user["sub"]
    })

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Count activities
    activity_count = await db.activity_events.count_documents(
        {"session_id": session_id}
    )

    return SessionResponse(
        session_id=session["session_id"],
        user_id=session.get("user_id"),
        start_time=session["start_time"],
        end_time=session.get("end_time"),
        status=session["status"],
        activity_count=activity_count,
    )


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    update_data: SessionUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Update a session (e.g., pause, resume, end)."""
    session = await db.browser_sessions.find_one({
        "session_id": session_id,
        "user_id": current_user["sub"]
    })

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    updates = {}
    if update_data.status:
        updates["status"] = update_data.status

    if update_data.end_time:
        updates["end_time"] = update_data.end_time
    elif update_data.status == "ended" and not session.get("end_time"):
        updates["end_time"] = datetime.utcnow()

    if updates:
        await db.browser_sessions.update_one(
            {"session_id": session_id},
            {"$set": updates}
        )
        # Refresh session
        session.update(updates)

    # Count activities
    activity_count = await db.activity_events.count_documents(
        {"session_id": session_id}
    )

    return SessionResponse(
        session_id=session["session_id"],
        user_id=session.get("user_id"),
        start_time=session["start_time"],
        end_time=session.get("end_time"),
        status=session["status"],
        activity_count=activity_count,
    )


@router.post("/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """End a session."""
    session = await db.browser_sessions.find_one({
        "session_id": session_id,
        "user_id": current_user["sub"]
    })

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    end_time = datetime.utcnow()
    await db.browser_sessions.update_one(
        {"session_id": session_id},
        {"$set": {"status": "ended", "end_time": end_time}}
    )

    # Count activities
    activity_count = await db.activity_events.count_documents(
        {"session_id": session_id}
    )

    return SessionResponse(
        session_id=session["session_id"],
        user_id=session.get("user_id"),
        start_time=session["start_time"],
        end_time=end_time,
        status="ended",
        activity_count=activity_count,
    )
