"""
PatternDetection/adaptive_trainer.py

Per-user adaptive XGBoost training orchestrator.

After a user accumulates >= 7 days of procrastination_results, this module
trains a personal XGBClassifier on their own data and saves it as:
    xgb_model_{user_id}.json

The model is retrained every 7 days as more data accumulates.
Training labels come from classId stored in procrastination_results
(bootstrapped from the global model / heuristics — no manual labels needed).

No I/O other than MongoDB reads and model file writes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorDatabase

_logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

_MIN_DAYS_TO_TRAIN: int    = 7
_RETRAIN_INTERVAL_DAYS: int = 7
_MAX_TRAINING_DAYS: int    = 30
_MODEL_DIR: Path           = Path(__file__).parent

_FEATURE_NAMES: list[str] = [
    "total_events",
    "academic_event_ratio",
    "non_academic_event_ratio",
    "switch_count",
    "switch_rate",
    "avg_active_time",
    "idle_ratio",
    "burst_non_academic_count",
    "focus_ratio",
    "hour_of_day_entropy",
]


# ── Public API ─────────────────────────────────────────────────────────────────

async def maybe_retrain(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    today_str: str,
) -> dict:
    """Check conditions and retrain per-user XGB model if appropriate.

    Conditions (all must be true):
      1. User has >= _MIN_DAYS_TO_TRAIN days in procrastination_results
         (with stored feature vectors)
      2. Either: user model doesn't exist yet, OR >= _RETRAIN_INTERVAL_DAYS
         since last training

    Returns:
        {
            "retrained":   bool,
            "model_path":  str | None,
            "n_samples":   int,
            "reason":      str,
        }
    """
    try:
        n_days = await _count_user_days(motor_db, user_id)
        if n_days < _MIN_DAYS_TO_TRAIN:
            return {
                "retrained":  False,
                "model_path": None,
                "n_samples":  n_days,
                "reason":     f"only {n_days} days (need {_MIN_DAYS_TO_TRAIN})",
            }

        meta = await _get_model_meta(motor_db, user_id)
        user_model_path = _MODEL_DIR / f"xgb_model_{user_id}.json"
        model_exists = user_model_path.exists()

        # Check retrain interval
        last_trained = meta.get("lastTrainedAt")
        if model_exists and last_trained:
            if isinstance(last_trained, str):
                try:
                    last_trained = datetime.fromisoformat(last_trained)
                except Exception:
                    last_trained = None

            if last_trained:
                if last_trained.tzinfo is None:
                    last_trained = last_trained.replace(tzinfo=timezone.utc)
                days_since = (datetime.now(timezone.utc) - last_trained).days
                if days_since < _RETRAIN_INTERVAL_DAYS:
                    return {
                        "retrained":  False,
                        "model_path": str(user_model_path),
                        "n_samples":  n_days,
                        "reason":     f"retrained {days_since}d ago (interval={_RETRAIN_INTERVAL_DAYS}d)",
                    }

        # Load samples and train
        samples = await _load_training_samples(motor_db, user_id, _MAX_TRAINING_DAYS)
        if len(samples) < _MIN_DAYS_TO_TRAIN:
            return {
                "retrained":  False,
                "model_path": None,
                "n_samples":  len(samples),
                "reason":     f"only {len(samples)} samples with feature vectors stored",
            }

        model_path = train_user_model(samples, user_id)
        await _update_model_meta(motor_db, user_id, model_path, len(samples))

        _logger.info(
            "[AdaptiveTrainer] Trained user model for %s — %d samples → %s",
            user_id, len(samples), model_path,
        )
        return {
            "retrained":  True,
            "model_path": model_path,
            "n_samples":  len(samples),
            "reason":     "training successful",
        }

    except Exception as exc:
        _logger.warning("[AdaptiveTrainer] Error during maybe_retrain for %s: %s", user_id, exc)
        return {
            "retrained":  False,
            "model_path": None,
            "n_samples":  0,
            "reason":     f"error: {exc}",
        }


def train_user_model(samples: list[dict], user_id: str) -> str:
    """Train an XGBClassifier on user-specific samples and save to disk.

    Args:
        samples:  List of {"features": dict, "class_id": int}.
        user_id:  Used to construct the output file name.

    Returns:
        Absolute path to the saved model file.
    """
    try:
        import numpy as np
        import xgboost as xgb
    except ImportError as exc:
        raise RuntimeError(f"xgboost/numpy not installed: {exc}") from exc

    X = np.array(
        [[float(s["features"].get(f, 0.0)) for f in _FEATURE_NAMES] for s in samples],
        dtype=float,
    )
    y = np.array([int(s["class_id"]) for s in samples], dtype=int)

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="multi:softprob",
        num_class=5,
        eval_metric="mlogloss",
        use_label_encoder=False,
        verbosity=0,
    )
    model.fit(X, y)

    out_path = _MODEL_DIR / f"xgb_model_{user_id}.json"
    model.save_model(str(out_path))
    return str(out_path)


# ── Internal helpers ───────────────────────────────────────────────────────────

async def _count_user_days(motor_db: AsyncIOMotorDatabase, user_id: str) -> int:
    """Count days in procrastination_results that have feature vectors stored."""
    return await motor_db["procrastination_results"].count_documents(
        {"userId": user_id, "features": {"$exists": True}}
    )


async def _load_training_samples(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    max_days: int = _MAX_TRAINING_DAYS,
) -> list[dict]:
    """Load feature vectors + labels from procrastination_results.

    Returns list of {"features": dict, "class_id": int}.
    Only includes documents where "features" key is present.
    """
    cursor = (
        motor_db["procrastination_results"]
        .find(
            {"userId": user_id, "features": {"$exists": True}},
            {"_id": 0, "features": 1, "classId": 1},
        )
        .sort("date", -1)
        .limit(max_days)
    )
    docs = await cursor.to_list(length=None)

    samples = []
    for doc in docs:
        features = doc.get("features")
        class_id = doc.get("classId")
        if isinstance(features, dict) and isinstance(class_id, int):
            samples.append({"features": features, "class_id": class_id})

    return samples


async def _get_model_meta(motor_db: AsyncIOMotorDatabase, user_id: str) -> dict:
    """Fetch model_meta doc for user, or return empty defaults."""
    doc = await motor_db["model_meta"].find_one({"user_id": user_id}, {"_id": 0})
    return doc or {}


async def _update_model_meta(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    model_path: str,
    n_samples: int,
) -> None:
    """Upsert model_meta with training timestamp and metadata."""
    await motor_db["model_meta"].update_one(
        {"user_id": user_id},
        {"$set": {
            "user_id":        user_id,
            "lastTrainedAt":  datetime.now(timezone.utc),
            "modelPath":      model_path,
            "nSamples":       n_samples,
        }},
        upsert=True,
    )
