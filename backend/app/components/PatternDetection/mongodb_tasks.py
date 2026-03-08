"""
backend/app/components/PatternDetection/mongodb_tasks.py
"""

from datetime import datetime, timezone, date
from motor.motor_asyncio import AsyncIOMotorDatabase

DEADLINE_THRESHOLD = 5


def _parse_deadline(raw) -> date | None:
    if raw is None:
        return None

    if isinstance(raw, datetime):
        return raw.date()

    if isinstance(raw, str):
        try:
            # supports "2026-03-10"
            return datetime.fromisoformat(raw).date()
        except ValueError:
            return None

    return None


async def get_near_deadline_tasks(
    motor_db: AsyncIOMotorDatabase,
    threshold_days: int = DEADLINE_THRESHOLD,
) -> list[dict]:
    """
    Read tasks from research_task_db.tasks without requiring userId.

    Returns:
        [{task_name, days_left, priority}]
    """
    today = datetime.now(timezone.utc).date()

    cursor = motor_db["tasks"].find({})
    docs = await cursor.to_list(length=None)

    near: list[dict] = []

    for doc in docs:
        metrics = doc.get("metrics", {}) or {}

        # Prefer explicit days_left if already stored
        raw_days_left = metrics.get("days_left")
        deadline_date = _parse_deadline(metrics.get("deadline"))

        days_left = None
        if isinstance(raw_days_left, int):
            days_left = raw_days_left
        elif deadline_date is not None:
            days_left = (deadline_date - today).days

        if days_left is None:
            continue

        if 0 <= days_left <= threshold_days:
            near.append(
                {
                    "task_name": doc.get("task_name", "Unnamed task"),
                    "days_left": days_left,
                    "priority": doc.get("priority", "Medium"),
                }
            )

    return near