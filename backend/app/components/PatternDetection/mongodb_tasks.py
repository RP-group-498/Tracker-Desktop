"""
backend/app/services/mongodb_tasks.py

Shared helper for reading tasks from MongoDB.
Used by both mongodb_analysis_pipeline.py and procrastination_service.py.
"""

from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

DEADLINE_THRESHOLD = 5  


async def get_near_deadline_tasks(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    threshold_days: int = DEADLINE_THRESHOLD,
) -> list[dict]:
    """Return Task docs whose deadline falls within the next threshold_days (computed live).

    Returns list of dicts: [{task_name, days_left, priority}]
    """
    today = datetime.now(timezone.utc).date()
    cursor = motor_db["Task"].find({"userId": user_id})
    docs = await cursor.to_list(length=None)

    near: list[dict] = []
    for doc in docs:
        deadline = doc.get("deadline")
        if not isinstance(deadline, datetime):
            continue
        days_left = (deadline.date() - today).days
        if 0 <= days_left <= threshold_days:
            near.append({
                "task_name": doc.get("task_name") or doc.get("name", "Unnamed task"),
                "days_left": days_left,
                "priority": doc.get("priority", "Medium"),
            })
    return near

