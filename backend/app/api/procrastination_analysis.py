"""
/app/api/procrastination_analysis.py
MongoDB Analysis API endpoints.

Reads/writes exclusively via Motor (async MongoDB).
SQLite is never touched here.
"""

import asyncio
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.database import db_config
from app.api.deps import get_current_user
from fastapi import Depends
from typing import Dict, Any
from app.components.PatternDetection.pipeline import run_procrastination_pipeline as run_analysis_pipeline

router = APIRouter()


def _get_motor_db():
    if db_config.db is None:
        raise HTTPException(
            status_code=503,
            detail="MongoDB not connected.",
        )
    return db_config.db





# ── Calibration ───────────────────────────────────────────────────────────────

class CalibrationIn(BaseModel):
    focusPeriod: str = "morning"
    studyDuration: float = 2.0
    studyDays: list[str] = ["Mon", "Tue", "Wed", "Thu", "Fri"]


@router.post("/calibration")
async def save_calibration(
    data: CalibrationIn,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Save (or update) study preferences to MongoDB user_calibration."""
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")
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
async def get_calibration(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get the current user's study preferences from MongoDB."""
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")
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
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Run the full analysis pipeline for today (or a specific past date)."""
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")

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
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Fetch stored active-time result for a given date."""
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")
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
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Fetch stored procrastination result for a given date."""
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")
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
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Fetch the stored predicted active time for tomorrow (or a specific date)."""
    from datetime import timedelta
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")
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
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Fetch the last N days of procrastination results, merged with active_time data.

    The merged records include score/pattern fields from procrastination_results
    AND fullDayAcademicMinutes / fullDayNonAcademicMinutes / fullDayTotalAppSwitches /
    expectedStudyMinutes from active_time — all fields needed by the Activity Trends chart.
    """
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")

    # Fetch procrastination results
    pr_cursor = (
        motor_db["procrastination_results"]
        .find({"userId": user_id}, {"_id": 0})
        .sort("date", -1)
        .limit(days)
    )
    pr_docs = await pr_cursor.to_list(length=None)

    if not pr_docs:
        return []

    # Fetch matching active_time docs for the same dates
    dates = [d["date"] for d in pr_docs if d.get("date")]
    at_cursor = motor_db["active_time"].find(
        {"userId": user_id, "date": {"$in": dates}},
        {"_id": 0},
    )
    at_docs = await at_cursor.to_list(length=None)
    at_by_date = {d["date"]: d for d in at_docs if d.get("date")}

    # Merge: active_time fields supplement procrastination_results fields
    merged = []
    for pr in pr_docs:
        date = pr.get("date", "")
        at = at_by_date.get(date, {})
        merged.append({**pr, **at})

    return merged


@router.get("/calibration-history")
async def get_calibration_history(
    days: int = Query(14, description="Number of past days (default 14 = calibration window)"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Fetch last N days of active_time records for calibration phase graphs."""
    from app.components.PatternDetection.calibration_history import get_calibration_history as _get_hist
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")
    return await _get_hist(motor_db, user_id, days)


@router.get("/tasks")
async def get_tasks(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Return all tasks from rsearch_task_db tasks collection."""
    from app.components.PatternDetection.mongodb_tasks import _parse_deadline
    motor_db = _get_motor_db()
    cursor = motor_db["tasks"].find(
        {},
        {"_id": 0, "task_name": 1, "metrics": 1, "priority": 1},
    )
    docs = await cursor.to_list(length=None)
    result = []
    for doc in docs:
        metrics = doc.get("metrics") or {}
        deadline_date = _parse_deadline(metrics.get("deadline"))
        result.append({
            "task_name": doc.get("task_name", "Unnamed task"),
            "deadline": deadline_date.isoformat() if deadline_date else None,
            "priority": doc.get("priority", "Medium"),
        })
    return result


# ── Debug endpoint ────────────────────────────────────────────────────────────

@router.get("/debug-count")
async def debug_count(
    user_id: str = Query(..., description="user_id to query"),
):
    """Debug: count activity_events the pipeline can actually see for yesterday."""
    from datetime import timedelta
    motor_db = _get_motor_db()

    from app.components.PatternDetection.pipeline import _LK
    now_utc = datetime.now(timezone.utc)
    now_lk = now_utc.astimezone(_LK)
    if now_lk.hour < 23:
        now_utc = now_utc - timedelta(days=1)
    today = now_utc.date()
    start_dt = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    end_dt = start_dt + timedelta(days=1)

    total = await motor_db["activity_events"].count_documents({
        "user_id": user_id,
        "start_time": {"$gte": start_dt, "$lt": end_dt},
    })
    academic = await motor_db["activity_events"].count_documents({
        "user_id": user_id,
        "start_time": {"$gte": start_dt, "$lt": end_dt},
        "classification.category": "academic",
    })
    sample = await motor_db["activity_events"].find_one(
        {"user_id": user_id, "start_time": {"$gte": start_dt, "$lt": end_dt}},
        {"_id": 0, "start_time": 1, "classification": 1, "app_name": 1},
    )
    # Also run the actual pipeline fetch to see if it matches
    from app.components.PatternDetection.readers import _fetch_behavior_records
    records = await _fetch_behavior_records(motor_db, user_id, start_dt, end_dt)
    pipeline_academic = sum(1 for r in records if r.category == "academic")
    pipeline_non_academic = sum(1 for r in records if r.category == "non-academic")
    full_day_academic_mins = sum(r.time_spent_minutes for r in records if r.category == "academic")

    return {
        "user_id": user_id,
        "date": str(today),
        "start_dt": start_dt.isoformat(),
        "end_dt": end_dt.isoformat(),
        "total_events": total,
        "academic_events": academic,
        "sample": sample,
        "pipeline_record_count": len(records),
        "pipeline_academic_records": pipeline_academic,
        "pipeline_non_academic_records": pipeline_non_academic,
        "pipeline_full_day_academic_mins": round(full_day_academic_mins, 1),
    }


# ── New enhanced endpoints ─────────────────────────────────────────────────────

def _compute_day_label(days_left: int) -> str:
    if days_left == 0:
        return "Due Today"
    if days_left == 1:
        return "Due Tomorrow"
    return f"In {days_left} days"


@router.get("/anomalies")
async def get_anomalies(
    days: int = Query(30, description="Number of past days to scan"),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Return days flagged as anomalous by Isolation Forest."""
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")
    cursor = (
        motor_db["procrastination_results"]
        .find(
            {"userId": user_id, "isAnomaly": True},
            {"_id": 0, "date": 1, "anomalyScore": 1, "score": 1, "dominantPattern": 1, "features": 1},
        )
        .sort("date", -1)
        .limit(days)
    )
    docs = await cursor.to_list(length=None)
    total_cursor = (
        motor_db["procrastination_results"]
        .find({"userId": user_id}, {"_id": 1})
        .sort("date", -1)
        .limit(days)
    )
    total_docs = await total_cursor.to_list(length=None)
    total_days = len(total_docs)
    return {
        "anomalous_days": [
            {
                "date":           d.get("date"),
                "anomalyScore":   d.get("anomalyScore", 0.0),
                "score":          d.get("score", 0.0),
                "dominantPattern":d.get("dominantPattern"),
                "features":       d.get("features", {}),
            }
            for d in docs
        ],
        "total_days_analyzed": total_days,
        "anomaly_rate": round(len(docs) / max(total_days, 1), 3),
    }


@router.get("/behavior-trends")
async def get_behavior_trends(
    days: int = Query(14, description="Number of past days to analyze"),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Return behavior trend analysis over multiple time windows."""
    from app.components.PatternDetection.behavior_analyzer import analyze_behavior_trends
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")

    # Fetch procrastination_results
    pr_cursor = (
        motor_db["procrastination_results"]
        .find({"userId": user_id}, {"_id": 0})
        .sort("date", -1)
        .limit(days)
    )
    pr_docs = await pr_cursor.to_list(length=None)

    # Fetch active_time for the same window
    at_cursor = (
        motor_db["active_time"]
        .find({"userId": user_id}, {"_id": 0})
        .sort("date", -1)
        .limit(days)
    )
    at_docs = await at_cursor.to_list(length=None)

    # Join by date
    at_by_date = {d["date"]: d for d in at_docs if d.get("date")}
    merged = []
    for pr in pr_docs:
        date = pr.get("date", "")
        at = at_by_date.get(date, {})
        merged.append({**pr, **at})

    return analyze_behavior_trends(merged)


@router.get("/time-gap")
async def get_time_gap(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Return comparative stats for 1d, 3d, 5d, 7d, 14d windows."""
    from app.components.PatternDetection.behavior_analyzer import analyze_behavior_trends
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")

    # Fetch last 14 days of both collections
    pr_cursor = (
        motor_db["procrastination_results"]
        .find({"userId": user_id}, {"_id": 0})
        .sort("date", -1)
        .limit(14)
    )
    pr_docs = await pr_cursor.to_list(length=None)

    at_cursor = (
        motor_db["active_time"]
        .find({"userId": user_id}, {"_id": 0})
        .sort("date", -1)
        .limit(14)
    )
    at_docs = await at_cursor.to_list(length=None)

    at_by_date = {d["date"]: d for d in at_docs if d.get("date")}
    merged = []
    for pr in pr_docs:
        date = pr.get("date", "")
        at = at_by_date.get(date, {})
        merged.append({**pr, **at})

    trends = analyze_behavior_trends(merged)
    return {"periods": trends["period_stats"]}


@router.get("/deadlines")
async def get_deadlines(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Return upcoming task deadlines with day labels and hours remaining."""
    from datetime import timedelta
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.components.PatternDetection.mongodb_tasks import (
        get_near_deadline_tasks,
        get_user_deadlines,
        _parse_deadline,
    )
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")

    now = datetime.now(timezone.utc)
    today = now.date()

    # Build adaptive_time_estimation db handle for completed_tasks
    apdis_uri = os.getenv("TASKS_MONGODB_URI", "")
    apdis_db_name = os.getenv("TASKS_MONGODB_DATABASE", "")
    apdis_db = AsyncIOMotorClient(apdis_uri)[apdis_db_name] if (apdis_uri and apdis_db_name) else None

    async def _empty():
        return []

    # Combine tasks from both sources
    near_tasks, user_tasks = await asyncio.gather(
        get_near_deadline_tasks(motor_db, threshold_days=14),
        get_user_deadlines(apdis_db, user_id, threshold_days=14) if apdis_db is not None else _empty(),
    )

    # Deduplicate by task_name
    seen: set[str] = set()
    combined: list[dict] = []
    for t in (near_tasks + user_tasks):
        name = t.get("task_name", "")
        if name not in seen:
            seen.add(name)
            combined.append(t)

    result = []
    for t in sorted(combined, key=lambda x: x.get("days_left", 999)):
        days_left = t.get("days_left", 0)
        if days_left < 0:
            continue

        deadline_str = t.get("deadline", "")
        # Compute hours remaining
        hours_left = 0
        if deadline_str:
            dl = _parse_deadline(deadline_str)
            if dl:
                deadline_dt = datetime(dl.year, dl.month, dl.day, 23, 59, tzinfo=timezone.utc)
                diff = deadline_dt - now
                hours_left = max(int(diff.total_seconds() // 3600), 0)

        result.append({
            "task_name": t.get("task_name", "Unnamed task"),
            "deadline":  deadline_str,
            "days_left": days_left,
            "hours_left":hours_left,
            "day_label": _compute_day_label(days_left),
            "priority":  t.get("priority", "Medium"),
        })

    return {"deadlines": result}


@router.get("/model-status")
async def get_model_status(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Return per-user adaptive model training status."""
    from pathlib import Path
    motor_db = _get_motor_db()
    user_id = current_user.get("sub")

    meta = await motor_db["model_meta"].find_one({"user_id": user_id}, {"_id": 0})

    model_dir = Path(__file__).parent.parent / "components" / "PatternDetection"
    user_model_path = model_dir / f"xgb_model_{user_id}.json"
    global_model_path = model_dir / "xgb_model.json"

    has_user_model = user_model_path.exists()
    last_trained_at = None
    n_samples = 0
    days_until_retrain = 7

    if meta:
        last_trained_at = meta.get("lastTrainedAt")
        if isinstance(last_trained_at, datetime):
            last_trained_at = last_trained_at.isoformat()
        n_samples = meta.get("nSamples", 0)
        if last_trained_at:
            try:
                lt = datetime.fromisoformat(str(last_trained_at).replace("Z", "+00:00"))
                if lt.tzinfo is None:
                    lt = lt.replace(tzinfo=timezone.utc)
                days_since = (datetime.now(timezone.utc) - lt).days
                days_until_retrain = max(0, 7 - days_since)
            except Exception:
                pass

    # Count available days for training
    n_days = await motor_db["procrastination_results"].count_documents(
        {"userId": user_id, "features": {"$exists": True}}
    )

    return {
        "user_id":             user_id,
        "has_user_model":      has_user_model,
        "last_trained_at":     last_trained_at,
        "n_training_samples":  n_samples,
        "n_days_available":    n_days,
        "days_until_retrain":  days_until_retrain,
        "global_model_available": global_model_path.exists(),
        "min_days_to_train":   7,
    }
