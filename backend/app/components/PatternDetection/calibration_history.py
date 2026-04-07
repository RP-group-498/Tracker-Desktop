"""
PatternDetection/calibration_history.py

Returns last N days of stored active_time docs for calibration-phase graphs.
Thin wrapper over readers._get_active_time_history.
"""

import logging
from motor.motor_asyncio import AsyncIOMotorDatabase

from .readers import _get_active_time_history
from .pipeline import run_procrastination_pipeline

_logger = logging.getLogger(__name__)

async def get_calibration_history(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    days: int = 14,
) -> list[dict]:
    """Fetch the last `days` active_time documents for a user (newest first)."""
    # Break UI calibration deadlock: force pipeline execution to calculate and store
    # `active_time` and ML results into MongoDB before returning history payload.
    try:
        await run_procrastination_pipeline(motor_db, user_id)
    except Exception as exc:
        _logger.error("[PatternDetection] Calibration-triggered pipeline run failed: %s", exc)
        
    return await _get_active_time_history(motor_db, user_id, days)
