from datetime import datetime, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase


async def get_calibration_history(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    days: int = 14,
) -> list[dict]:
    """
    Return all active_time docs within a 14-calendar-day window anchored
    to the user's earliest date, sorted ascending (oldest first).
    Missing days are not filled — frontend handles gaps.
    """
    collection = motor_db["active_time"]

    # 1. Find the earliest date for this user
    first_doc = await collection.find_one(
        {"userId": user_id},
        {"date": 1, "_id": 0},
        sort=[("date", 1)],
    )

    if not first_doc:
        return []

    # 2. Build 14-day window from first date
    first_date_str = first_doc["date"]  # expected format: "YYYY-MM-DD"
    first_date = datetime.strptime(first_date_str, "%Y-%m-%d")
    end_date_str = (first_date + timedelta(days=days)).strftime("%Y-%m-%d")

    # 3. Query records within [first_date, first_date + 14 days)
    cursor = (
        collection
        .find(
            {
                "userId": user_id,
                "date": {"$gte": first_date_str, "$lt": end_date_str},
            },
            {"_id": 0},
        )
        .sort("date", 1)
    )

    return await cursor.to_list(length=days)
