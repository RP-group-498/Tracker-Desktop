"""
Orchestrator: wires together readers, pure computation, and DB writes.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from .readers import (
    _fetch_behavior_records,
    _get_calibration,
    _get_near_deadline_tasks,
    _get_active_time_history,
    _fetch_stored_prediction,
)
from .active_time import _detect_active_time_pure
from .procrast_patterns import _detect_patterns_pure
from .scoring import _calculate_score
from .active_prediction import _compute_prediction_pure


async def run_analysis_pipeline(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    target_date: Optional[datetime] = None,
) -> dict:
    """Full analysis pipeline:

    1. Fetch behaviour records from activity_events
    2. Load calibration from user_calibration
    3. Load near-deadline tasks from Task
    4. Load active_time history for baselines
    5. Detect active time (sliding window)
    6. Detect patterns + calculate score
    7. Upsert active_time and procrastination_results
    8. Return combined result
    """
    now = target_date or datetime.now(timezone.utc)
    # Effective date rule: analyze yesterday before 11 PM UTC, today at/after 11 PM
    if target_date is None and now.hour < 23:
        now = now - timedelta(days=1)
    today = now.date()
    today_str = today.strftime("%Y-%m-%d")
    day_str = today.strftime("%A")

    start_dt = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    end_dt = start_dt + timedelta(days=1)

    # Fetch all inputs
    records = await _fetch_behavior_records(motor_db, user_id, start_dt, end_dt)
    calibration = await _get_calibration(motor_db, user_id)
    near_tasks = await _get_near_deadline_tasks(motor_db, user_id)
    history = await _get_active_time_history(motor_db, user_id, 7)

    # Compute
    active_time_doc = _detect_active_time_pure(records, calibration, today_str, day_str)
    patterns = _detect_patterns_pure(active_time_doc, history, calibration, near_tasks)
    scoring = _calculate_score(patterns)

    now_utc = datetime.now(timezone.utc)

    active_time_result = {
        **active_time_doc,
        "userId": user_id,
        "source": "active_time_detection",
        "updatedAt": now_utc,
    }

    procrastination_result = {
        "userId": user_id,
        "date": today_str,
        "score": scoring["score"],
        "level": scoring["level"],
        "dominantPattern": scoring["dominantPattern"],
        "patternsDetected": patterns,
        "source": "procrastination_ml_engine",
        "updatedAt": now_utc,
    }

    # Upsert active_time and procrastination_results
    await motor_db["active_time"].update_one(
        {"userId": user_id, "date": today_str},
        {"$set": active_time_result},
        upsert=True,
    )
    await motor_db["procrastination_results"].update_one(
        {"userId": user_id, "date": today_str},
        {"$set": procrastination_result},
        upsert=True,
    )

    # Compute and upsert next-day prediction
    pred_to_store = None
    prediction_doc = _compute_prediction_pure(history, today)
    if prediction_doc:
        pred_to_store = {**prediction_doc, "userId": user_id, "updatedAt": now_utc}
        await motor_db["predicted_active_time"].update_one(
            {"userId": user_id, "date": prediction_doc["date"]},
            {"$set": pred_to_store},
            upsert=True,
        )
    else:
        # Fallback: return the most recently stored prediction from MongoDB
        pred_to_store = await _fetch_stored_prediction(motor_db, user_id)

    return {
        "active_time": active_time_result,
        "procrastination": procrastination_result,
        "predicted_active_time": pred_to_store,
    }
