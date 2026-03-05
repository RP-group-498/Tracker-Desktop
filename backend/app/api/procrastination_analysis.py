"""
/app/api/procrastination_analysis.py
MongoDB Analysis API endpoints.

Reads/writes exclusively via Motor (async MongoDB).
SQLite is never touched here.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.mongodb_sync import get_mongodb_sync
from app.services.user_manager import get_user_manager
from app.components.PatternDetection.procrastination_pipeline import run_analysis_pipeline

router = APIRouter()


def _get_motor_db():
    sync = get_mongodb_sync()
    if sync is None or (not sync.is_connected) or (sync._db is None):
        raise HTTPException(
            status_code=503,
            detail="MongoDB not connected — set MONGODB_URI in .env",
        )
    return sync._db


def _get_user_id() -> str:
    user_manager = get_user_manager()
    if not user_manager:
        raise HTTPException(status_code=500, detail="User manager not initialized")
    return user_manager.get_user_id()


# ── Calibration ───────────────────────────────────────────────────────────────

class CalibrationIn(BaseModel):
    focusPeriod: str = "morning"
    studyDuration: float = 2.0
    studyDays: list[str] = ["Mon", "Tue", "Wed", "Thu", "Fri"]


@router.post("/calibration")
async def save_calibration(data: CalibrationIn):
    """Save (or update) study preferences to MongoDB user_calibration."""
    motor_db = _get_motor_db()
    user_id = _get_user_id()
    doc = {
        "user_id": user_id,
        "focusPeriod": data.focusPeriod,
        "studyDuration": data.studyDuration,
        "studyDays": data.studyDays,
        "updatedAt": datetime.now(timezone.utc),
    }
    await motor_db["user_calibration"].update_one(
        {"user_id": user_id},
        {"$set": doc},
        upsert=True,
    )
    return doc


@router.get("/calibration")
async def get_calibration():
    """Get the current user's study preferences from MongoDB."""
    motor_db = _get_motor_db()
    user_id = _get_user_id()
    doc = await motor_db["user_calibration"].find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        return {
            "focusPeriod": "morning",
            "studyDuration": 2.0,
            "studyDays": ["Mon", "Tue", "Wed", "Thu", "Fri"],
        }
    return doc


# ── Pipeline ──────────────────────────────────────────────────────────────────

@router.post("/run")
async def run_pipeline(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: today UTC)"),
):
    """Run the full analysis pipeline for today (or a specific past date)."""
    motor_db = _get_motor_db()
    user_id = _get_user_id()

    target_date: Optional[datetime] = None
    if date:
        try:
            parsed = datetime.strptime(date, "%Y-%m-%d")
            target_date = parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid date format — use YYYY-MM-DD"
            )

    return await run_analysis_pipeline(motor_db, user_id, target_date=target_date)


# ── Read-back endpoints ───────────────────────────────────────────────────────

@router.get("/active-time")
async def get_active_time(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: today UTC)"),
):
    """Fetch stored active-time result for a given date."""
    motor_db = _get_motor_db()
    user_id = _get_user_id()
    date_str = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    doc = await motor_db["active_time"].find_one(
        {"userId": user_id, "date": date_str}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(
            status_code=404, detail=f"No active-time data found for {date_str}"
        )
    return doc


@router.get("/procrastination")
async def get_procrastination(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: today UTC)"),
):
    """Fetch stored procrastination result for a given date."""
    motor_db = _get_motor_db()
    user_id = _get_user_id()
    date_str = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    doc = await motor_db["procrastination_results"].find_one(
        {"userId": user_id, "date": date_str}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(
            status_code=404, detail=f"No procrastination data found for {date_str}"
        )
    return doc


@router.get("/predicted-active-time")
async def get_predicted_active_time(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: tomorrow UTC)"),
):
    """Fetch the stored predicted active time for tomorrow (or a specific date)."""
    from datetime import timedelta
    motor_db = _get_motor_db()
    user_id = _get_user_id()
    date_str = date or (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    doc = await motor_db["predicted_active_time"].find_one(
        {"userId": user_id, "date": date_str}, {"_id": 0}
    )
    if not doc:
        # Fallback: return the most recently stored prediction
        try:
            doc = await (
                motor_db["predicted_active_time"]
                .find({"userId": user_id}, {"_id": 0})
                .sort("date", -1)
                .limit(1)
                .next()
            )
        except StopAsyncIteration:
            doc = None
    if not doc:
        raise HTTPException(
            status_code=404,
            detail="No prediction available yet — run the analysis pipeline first",
        )
    return doc


@router.get("/history")
async def get_history(
    days: int = Query(7, description="Number of past days to return"),
):
    """Fetch the last N days of procrastination results."""
    motor_db = _get_motor_db()
    user_id = _get_user_id()
    cursor = (
        motor_db["procrastination_results"]
        .find({"userId": user_id}, {"_id": 0})
        .sort("date", -1)
        .limit(days)
    )
    return await cursor.to_list(length=None)


@router.get("/tasks")
async def get_tasks():
    """Return all tasks for the current user from MongoDB Task collection."""
    motor_db = _get_motor_db()
    user_id = _get_user_id()
    cursor = motor_db["Task"].find(
        {"userId": user_id},
        {"_id": 0, "task_name": 1, "name": 1, "deadline": 1, "priority": 1},
    )
    docs = await cursor.to_list(length=None)
    result = []
    for doc in docs:
        deadline = doc.get("deadline")
        result.append({
            "task_name": doc.get("task_name") or doc.get("name", "Unnamed task"),
            "deadline": deadline.isoformat() if isinstance(deadline, datetime) else deadline,
            "priority": doc.get("priority", "Medium"),
        })
    return result
