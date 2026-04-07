"""
scripts/backfill_pipeline.py

Backfill the procrastination analysis pipeline for the past N days using
real activity_events data already in MongoDB.

Populates:
  - active_time
  - procrastination_results
  - predicted_active_time

This is needed to seed baselines so pattern detection, LSTM prediction,
and Isolation Forest all have enough history to work correctly.

Usage (from backend/ directory with venv active):
    python scripts/backfill_pipeline.py --days 14
    python scripts/backfill_pipeline.py --days 14 --user-id <user_id>
    python scripts/backfill_pipeline.py --days 14 --force   # re-run even if results exist

Environment variables (or .env file):
    MONGODB_URI       — Atlas connection string (required)
    MONGODB_DATABASE  — Database name (default: APDIS)
"""

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime, timezone, timedelta

# Allow running from the backend/ directory directly.
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _backend_dir)

from dotenv import load_dotenv

load_dotenv(os.path.join(_backend_dir, ".env"))

from motor.motor_asyncio import AsyncIOMotorClient

from app.components.PatternDetection.pipeline import run_procrastination_pipeline

_logger = logging.getLogger(__name__)

MONGO_URI: str = os.environ.get("MONGODB_URI", "")
MONGO_DB: str = os.environ.get("MONGODB_DATABASE", "APDIS")


async def _collect_user_ids(db) -> list[str]:
    """Find all user IDs from activity_events and user_calibration."""
    ids: set[str] = set()
    for coll_name, field in (
        ("activity_events", "user_id"),
        ("user_calibration", "user_id"),
    ):
        try:
            raw = await db[coll_name].distinct(field)
            ids.update(str(v) for v in raw if v)
        except Exception as exc:
            _logger.warning("[Backfill] Could not list %s.%s: %s", coll_name, field, exc)
    return sorted(ids)


async def _already_has_result(db, user_id: str, date_str: str) -> bool:
    """Check if procrastination_results already exists for this user+date."""
    doc = await db["procrastination_results"].find_one(
        {"userId": user_id, "date": date_str}, {"_id": 1}
    )
    return doc is not None


async def backfill(
    mongo_uri: str,
    db_name: str,
    days: int = 14,
    user_id: str | None = None,
    force: bool = False,
) -> None:
    """Run the pipeline retroactively for the past N days.

    Args:
        mongo_uri:  MongoDB connection string.
        db_name:    Database name.
        days:       How many past days to backfill (default 14).
        user_id:    If set, only backfill this user. Otherwise auto-discovers all users.
        force:      If True, re-run even when results already exist.
    """
    client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=15_000)

    try:
        await client.admin.command("ping")
        print(f"[Backfill] Connected to MongoDB — db={db_name}")
    except Exception as exc:
        print(f"[Backfill] ERROR: Cannot reach MongoDB: {exc}")
        client.close()
        return

    db = client[db_name]

    # Resolve user(s)
    if user_id:
        user_ids = [user_id]
        print(f"[Backfill] Single-user mode: {user_id}")
    else:
        user_ids = await _collect_user_ids(db)
        if not user_ids:
            print("[Backfill] No users found — nothing to process.")
            client.close()
            return
        print(f"[Backfill] Found {len(user_ids)} user(s): {user_ids}")

    # Build date list: today-1 back to today-days (skip today — runs live)
    today = datetime.now(timezone.utc).date()
    dates = [today - timedelta(days=i) for i in range(1, days + 1)]
    dates.reverse()  # oldest first → baselines build up correctly

    print(f"[Backfill] Date range: {dates[0]} → {dates[-1]} ({len(dates)} days)\n")

    total_backfilled = 0
    total_skipped = 0
    total_errors = 0

    for uid in user_ids:
        print(f"[Backfill] ── User: {uid}")
        for d in dates:
            date_str = d.strftime("%Y-%m-%d")

            # Skip if already exists (unless --force)
            if not force and await _already_has_result(db, uid, date_str):
                print(f"  ↷ {date_str}  (already exists, skipping)")
                total_skipped += 1
                continue

            # Pass date at 23:00 UTC so pipeline treats it as "this day" (not yesterday)
            target_dt = datetime(d.year, d.month, d.day, 23, 0, 0, tzinfo=timezone.utc)

            try:
                result = await run_procrastination_pipeline(db, uid, target_date=target_dt)
                pr = result.get("procrastination", {})
                at = result.get("active_time", {})
                score = pr.get("score", 0)
                level = pr.get("level", "?")
                pattern = pr.get("dominantPattern") or "none"
                acad = at.get("fullDayAcademicMinutes", 0)
                status = at.get("status", "?")
                print(
                    f"  ✓ {date_str}  score={score:.1f} ({level})  "
                    f"pattern={pattern}  academic={acad}m  status={status}"
                )
                total_backfilled += 1
            except Exception as exc:
                print(f"  ✗ {date_str}  ERROR: {exc}")
                _logger.warning("[Backfill] Error on %s / %s: %s", uid, date_str, exc, exc_info=True)
                total_errors += 1

        print()

    client.close()
    print(
        f"[Backfill] Done — backfilled={total_backfilled}  "
        f"skipped={total_skipped}  errors={total_errors}"
    )
    if total_backfilled > 0:
        print(
            "[Backfill] Collections populated:\n"
            "  • active_time\n"
            "  • procrastination_results\n"
            "  • predicted_active_time\n"
            "[Backfill] Baselines ready — pattern detection, LSTM, and Isolation Forest "
            "will now work correctly."
        )


def main() -> None:
    logging.basicConfig(
        level=logging.WARNING,  # suppress INFO noise; print() handles progress
        format="%(asctime)s  %(levelname)-8s  %(message)s",
    )

    parser = argparse.ArgumentParser(
        description="Backfill procrastination pipeline for past N days using real activity data."
    )
    parser.add_argument(
        "--days",
        type=int,
        default=14,
        help="Number of past days to backfill (default: 14)",
    )
    parser.add_argument(
        "--user-id",
        metavar="USER_ID",
        default=None,
        help="Process a single user_id (default: all users found in MongoDB)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-run even if results already exist for a date",
    )
    parser.add_argument(
        "--uri",
        metavar="MONGODB_URI",
        default=MONGO_URI,
        help="MongoDB connection string (overrides MONGODB_URI env var)",
    )
    parser.add_argument(
        "--db",
        metavar="DB_NAME",
        default=MONGO_DB,
        help="Database name (overrides MONGODB_DATABASE env var)",
    )
    args = parser.parse_args()

    if not args.uri:
        print(
            "[Backfill] ERROR: MONGODB_URI is not set.\n"
            "  Pass --uri or set MONGODB_URI in your .env file."
        )
        sys.exit(1)

    asyncio.run(
        backfill(
            mongo_uri=args.uri,
            db_name=args.db,
            days=args.days,
            user_id=args.user_id,
            force=args.force,
        )
    )


if __name__ == "__main__":
    main()
