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
                    "priority":  doc.get("priority", "Medium"),
                    "deadline":  str(deadline_date) if deadline_date else "",
                }
            )

    return near


async def get_user_deadlines(
    apdis_db: AsyncIOMotorDatabase,
    user_id: str,
    threshold_days: int = 3,
) -> list[dict]:
    """Fetch upcoming task deadlines for a specific user.

    Queries the completed_tasks collection in the adaptive_time_estimation
    database (apdis_db), filtered by user_id and excluding completed tasks.

    days_left is computed dynamically from main_task.deadline so it is
    always accurate regardless of when the document was created.

    Returns only tasks where 0 <= days_left <= threshold_days.

    Each returned dict has:
        task_name  (str)  main_task.name,     default "Unnamed task"
        deadline   (str)  main_task.deadline, default ""
        days_left  (int)  computed from deadline vs today
        priority   (str)  main_task.priority, default "Medium"
    """
    today = datetime.now(timezone.utc).date()

    cursor = apdis_db["completed_tasks"].find(
        {"user_id": user_id, "main_task.deadline": {"$exists": True, "$ne": None}},
        {"_id": 0, "main_task": 1},
    )
    docs = await cursor.to_list(length=None)

    seen_tasks: set[str] = set()
    result: list[dict] = []
    for doc in docs:
        main_task = doc.get("main_task") or {}
        task_name = main_task.get("name") or "Unnamed task"
        if task_name in seen_tasks:
            continue
        deadline_date = _parse_deadline(main_task.get("deadline"))
        if deadline_date is None:
            continue
        days_left = (deadline_date - today).days
        if days_left < 0 or days_left > threshold_days:
            continue
        seen_tasks.add(task_name)
        result.append({
            "task_name": task_name,
            "deadline":  main_task.get("deadline") or "",
            "days_left": days_left,
            "priority":  main_task.get("priority") or "Medium",
        })

    return result