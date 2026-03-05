"""
run_mongo_pipeline.py
Standalone runner — executes the full analysis pipeline for every user found
in MongoDB and writes results to:
  APDIS.active_time
  APDIS.procrastination_results
  APDIS.predicted_active_time

Usage:
  # From backend/ directory (with venv active):
  python run_mongo_pipeline.py

  # Single user:
  python run_mongo_pipeline.py --user <user_id>

  # Override target date (YYYY-MM-DD):
  python run_mongo_pipeline.py --date 2026-03-03

Environment variables (or .env file):
  MONGODB_URI       — Atlas connection string (required)
  MONGODB_DATABASE  — Database name (default: APDIS)
"""

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime, timezone

# Allow running from the backend/ directory directly.
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv

load_dotenv()  # picks up .env in cwd or backend/

from motor.motor_asyncio import AsyncIOMotorClient

from backend.app.components.Procastination.procrastination_pipeline import run_analysis_pipeline
from app.services.mongodb_sync import ensure_pipeline_indexes

_logger = logging.getLogger(__name__)

# ── defaults from env ──────────────────────────────────────────────────────────

MONGO_URI: str = os.environ.get("MONGODB_URI", "")
MONGO_DB: str = os.environ.get("MONGODB_DATABASE", "APDIS")


# ── helpers ────────────────────────────────────────────────────────────────────


async def _collect_user_ids(db) -> list[str]:
    """Union of user_ids from activity_events and user_calibration."""
    ids: set[str] = set()
    for coll_name, field in (
        ("activity_events", "user_id"),
        ("user_calibration", "user_id"),
    ):
        try:
            raw = await db[coll_name].distinct(field)
            ids.update(str(v) for v in raw if v)
        except Exception as exc:
            _logger.warning("[Runner] Could not list %s.%s: %s", coll_name, field, exc)
    return sorted(ids)


def _fmt_result(result: dict) -> str:
    """One-line summary of a pipeline result for the log."""
    at = result.get("active_time", {})
    pr = result.get("procrastination", {})
    pred = result.get("predicted_active_time")

    status = at.get("status", "?")
    if status == "ok":
        timing = f"{at.get('activeStart','?')}→{at.get('activeEnd','?')}"
        academic = f"acad={at.get('academicMinutes', 0)}m"
    else:
        timing = f"status={status}"
        academic = ""

    score = f"score={pr.get('score', 0):.1f} ({pr.get('level', '?')})"
    dominant = pr.get("dominantPattern") or "none"
    prediction = f"pred={pred['date']}" if pred else "pred=N/A"

    parts = [p for p in [timing, academic, score, f"dominant={dominant}", prediction] if p]
    return "  ".join(parts)


# ── core runner ────────────────────────────────────────────────────────────────


async def run_for_all_users(
    mongo_uri: str,
    db_name: str,
    user_filter: "str | None" = None,
    target_date: "datetime | None" = None,
) -> None:
    """Connect, ensure indexes, then run pipeline per user.

    Args:
        mongo_uri:    MongoDB Atlas connection string.
        db_name:      Database name (e.g. "APDIS").
        user_filter:  If set, only process this single user_id.
        target_date:  Override the effective analysis date (UTC-aware).
                      When None the pipeline applies the 23:00 UTC rule automatically.
    """
    client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=10_000)
    try:
        # Verify connectivity
        await client.admin.command("ping")
        _logger.info("[Runner] Connected to MongoDB  db=%s", db_name)
    except Exception as exc:
        _logger.error("[Runner] Cannot reach MongoDB: %s", exc)
        client.close()
        return

    db = client[db_name]

    try:
        # Step 1: ensure indexes (idempotent)
        _logger.info("[Runner] Ensuring pipeline indexes…")
        await ensure_pipeline_indexes(db)
        _logger.info("[Runner] Indexes ready.")

        # Step 2: discover users
        if user_filter:
            user_ids = [user_filter]
            _logger.info("[Runner] Single-user mode: %s", user_filter)
        else:
            user_ids = await _collect_user_ids(db)
            if not user_ids:
                _logger.warning("[Runner] No users found — nothing to process.")
                return
            _logger.info("[Runner] Found %d user(s): %s", len(user_ids), user_ids)

        # Step 3: run pipeline per user
        succeeded = 0
        failed = 0
        for user_id in user_ids:
            try:
                result = await run_analysis_pipeline(db, user_id, target_date=target_date)
                summary = _fmt_result(result)
                _logger.info("[Runner] OK  user=%-24s  %s", user_id, summary)
                succeeded += 1
            except Exception as exc:
                _logger.error(
                    "[Runner] FAIL user=%s — %s", user_id, exc, exc_info=True
                )
                failed += 1

        _logger.info(
            "[Runner] Done — %d succeeded, %d failed out of %d user(s).",
            succeeded,
            failed,
            len(user_ids),
        )

    finally:
        client.close()
        _logger.info("[Runner] MongoDB connection closed.")


# ── CLI entry point ────────────────────────────────────────────────────────────


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the MongoDB procrastination analysis pipeline for all users."
    )
    parser.add_argument(
        "--user",
        metavar="USER_ID",
        default=None,
        help="Process a single user_id instead of all users.",
    )
    parser.add_argument(
        "--date",
        metavar="YYYY-MM-DD",
        default=None,
        help=(
            "Override the target analysis date (UTC). "
            "When omitted the pipeline applies the 23:00-UTC effective-date rule."
        ),
    )
    parser.add_argument(
        "--uri",
        metavar="MONGODB_URI",
        default=MONGO_URI,
        help="MongoDB connection string (overrides MONGODB_URI env var).",
    )
    parser.add_argument(
        "--db",
        metavar="DB_NAME",
        default=MONGO_DB,
        help="Database name (overrides MONGODB_DATABASE env var).",
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    args = _parse_args()

    if not args.uri:
        _logger.error(
            "[Runner] MONGODB_URI is not set. "
            "Pass --uri or set the MONGODB_URI environment variable."
        )
        sys.exit(1)

    # Parse optional date override
    target_date: "datetime | None" = None
    if args.date:
        try:
            naive = datetime.strptime(args.date, "%Y-%m-%d")
            # Treat as end-of-day UTC so the effective-date rule sees it as "today"
            target_date = naive.replace(hour=23, minute=0, second=0, tzinfo=timezone.utc)
        except ValueError:
            _logger.error("[Runner] Invalid --date format, expected YYYY-MM-DD: %r", args.date)
            sys.exit(1)

    asyncio.run(
        run_for_all_users(
            mongo_uri=args.uri,
            db_name=args.db,
            user_filter=args.user,
            target_date=target_date,
        )
    )


if __name__ == "__main__":
    main()
