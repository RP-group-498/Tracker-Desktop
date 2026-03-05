import logging
from datetime import datetime, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase

from .types import BehaviorRecord
from .utils_datetime import _coerce_datetime

_logger = logging.getLogger(__name__)


async def _fetch_behavior_records(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    start_dt: datetime,
    end_dt: datetime,
) -> list[BehaviorRecord]:
    """Query activity_events for the given day.

    Two-pass strategy:
      Pass 1 — fast path: MongoDB datetime filter (works when BSON datetimes stored).
      Pass 2 — fallback: fetch all user docs, filter in Python after coercion
               (works when start_time is stored as ISO string).
    """
    # Pass 1 — fast path: BSON datetime range on start_time OR timestamp.
    primary_cursor = (
        motor_db["activity_events"]
        .find(
            {
                "user_id": user_id,
                "$or": [
                    {"start_time": {"$gte": start_dt, "$lt": end_dt}},
                    {
                        "start_time": {"$exists": False},
                        "timestamp":  {"$gte": start_dt, "$lt": end_dt},
                    },
                ],
            },
            {"_id": 0},
        )
        .sort("start_time", 1)
    )
    docs = await primary_cursor.to_list(length=None)

    # Pass 2 — fallback: fetch all user docs and filter in Python.
    if not docs:
        fallback_cursor = (
            motor_db["activity_events"]
            .find({"user_id": user_id}, {"_id": 0})
            .sort("start_time", 1)
        )
        all_docs = await fallback_cursor.to_list(length=None)
        docs = []
        for d in all_docs:
            raw_time = d.get("start_time") or d.get("timestamp")
            coerced = _coerce_datetime(raw_time)
            if coerced is not None and start_dt <= coerced < end_dt:
                docs.append(d)

    records: list[BehaviorRecord] = []
    prev_app: str | None = None

    for doc in docs:
        try:
            raw_cat = (doc.get("classification") or {}).get("category", "") or ""
            raw_cat = raw_cat.strip().lower()

            if raw_cat == "academic":
                category = "academic"
            elif raw_cat in ("productivity", "productive"):
                category = "productivity"
            else:
                category = "non-academic"

            raw_start = doc.get("start_time") or doc.get("timestamp")
            session_start = _coerce_datetime(raw_start)
            if session_start is None:
                _logger.warning(
                    "[Pipeline] Skipping doc — no parseable start_time or timestamp: "
                    "start_time=%r timestamp=%r",
                    doc.get("start_time"),
                    doc.get("timestamp"),
                )
                continue

            session_end = _coerce_datetime(doc.get("end_time"))
            if session_end is None:
                total = doc.get("active_time", 0) + doc.get("idle_time", 0)
                if total > 0:
                    total_ms = total * 1000 if total < 1000 else total
                    session_end = session_start + timedelta(milliseconds=total_ms)
                else:
                    _logger.warning(
                        "[Pipeline] Skipping doc — no end_time and zero active+idle: %r",
                        doc.get("event_id"),
                    )
                    continue

            time_spent_minutes = (session_end - session_start).total_seconds() / 60.0
            if time_spent_minutes <= 0:
                continue

            current_app = doc.get("app_name") or doc.get("domain") or ""
            app_switch_count = 1 if (prev_app is not None and current_app != prev_app) else 0
            prev_app = current_app

            records.append(
                BehaviorRecord(
                    session_start=session_start,
                    session_end=session_end,
                    category=category,
                    time_spent_minutes=time_spent_minutes,
                    app_switch_count=app_switch_count,
                    app_name=current_app,
                )
            )
        except Exception as exc:
            _logger.warning("[Pipeline] Warning: skipping malformed activity_events doc — %s", exc)
            continue

    return records


async def _get_calibration(motor_db: AsyncIOMotorDatabase, user_id: str) -> dict:
    """Return user_calibration doc or sensible defaults."""
    doc = await motor_db["user_calibration"].find_one({"user_id": user_id}, {"_id": 0})
    if doc:
        return doc
    return {
        "focusPeriod": "morning",
        "studyDuration": 2.0,
        "studyDays": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    }


async def _get_near_deadline_tasks(
    motor_db: AsyncIOMotorDatabase, user_id: str
) -> list[dict]:
    """Thin wrapper — delegates to shared mongodb_tasks helper."""
    from .mongodb_tasks import get_near_deadline_tasks
    return await get_near_deadline_tasks(motor_db, user_id)


async def _get_active_time_history(
    motor_db: AsyncIOMotorDatabase, user_id: str, n_days: int
) -> list[dict]:
    """Return last n_days active_time docs (for baseline calculations)."""
    cursor = (
        motor_db["active_time"]
        .find({"userId": user_id}, {"_id": 0})
        .sort("date", -1)
        .limit(n_days)
    )
    return await cursor.to_list(length=None)


async def _fetch_stored_prediction(
    motor_db: AsyncIOMotorDatabase, user_id: str
) -> "dict | None":
    """Return the most recently stored prediction for this user, or None."""
    try:
        doc = await (
            motor_db["predicted_active_time"]
            .find({"userId": user_id}, {"_id": 0})
            .sort("date", -1)
            .limit(1)
            .next()
        )
        return doc
    except StopAsyncIteration:
        return None
