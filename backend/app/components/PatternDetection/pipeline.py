"""
PatternDetection/pipeline.py

Single async entry point for the procrastination detection pipeline.

Flow:
    MongoDB (parallel) → active_time_doc → STORE active_time
    → features → [HMM + XGB] → score → STORE procrastination_results
    → LSTM prediction → STORE predicted_active_time
    → return {active_time, procrastination, prediction}
"""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from .readers import (
    _fetch_behavior_records,
    _get_calibration,
    _get_active_time_history,
    _get_feature_history,
)
from .active_time import _detect_active_time_pure
from .feature_engineering import extract_features
from .hmm_detector import HMMDetector
from .xgb_classifier import XGBProcrastinationClassifier
from .scoring import _calculate_score
from .lstm_predictor import LSTMPredictor
from .isolation_forest import IsolationForestDetector
from .adaptive_trainer import maybe_retrain
from .procrast_patterns import _detect_patterns_pure
from .mongodb_tasks import get_near_deadline_tasks

# Sri Lanka timezone (UTC+5:30) — used for pipeline date cutoff
_LK = timezone(timedelta(hours=5, minutes=30))

# Module-level singletons — lazy model loading happens inside each class
_hmm  = HMMDetector()
_lstm = LSTMPredictor()

# Per-user XGB cache — keyed by user_id, loads per-user model when available
_xgb_cache: dict[str, XGBProcrastinationClassifier] = {}


def _get_xgb(user_id: str) -> XGBProcrastinationClassifier:
    """Return (or create) per-user XGB classifier instance."""
    if user_id not in _xgb_cache:
        _xgb_cache[user_id] = XGBProcrastinationClassifier(user_id=user_id)
    return _xgb_cache[user_id]


async def run_procrastination_pipeline(
    motor_db: AsyncIOMotorDatabase,
    user_id: str,
    target_date: Optional[datetime] = None,
) -> dict:
    """Run the full procrastination detection pipeline for one user-day.

    Args:
        motor_db:    Async Motor database handle.
        user_id:     Target user identifier.
        target_date: UTC datetime to analyse. Defaults to yesterday when
                     called before 23:00 UTC, today at/after 23:00 UTC.

    Returns:
        {
            "active_time":     dict,  # _detect_active_time_pure output
            "procrastination": dict,  # ML classification + score
            "prediction":      dict,  # LSTM next-day prediction
        }

    Side effects:
        Upserts documents into three MongoDB collections:
            active_time, procrastination_results, predicted_active_time
    """
    # ------------------------------------------------------------------
    # STEP 1 — Resolve analysis date
    # ------------------------------------------------------------------
    now_utc = target_date or datetime.now(timezone.utc)
    if target_date is None:
        now_lk = now_utc.astimezone(_LK)
        if now_lk.hour < 23:          # LK 11 PM cutoff (UTC+5:30)
            now_utc = now_utc - timedelta(days=1)
    now = now_utc
    today         = now.date()
    today_str     = today.strftime("%Y-%m-%d")
    day_str       = today.strftime("%A")
    start_dt      = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    end_dt        = start_dt + timedelta(days=1)

    next_day_dt   = datetime(today.year, today.month, today.day) + timedelta(days=1)
    next_day_str  = next_day_dt.strftime("%Y-%m-%d")
    next_day_name = next_day_dt.strftime("%A")

    # ------------------------------------------------------------------
    # STEP 2 — MongoDB reads (parallel)
    # ------------------------------------------------------------------
    records, calibration = await asyncio.gather(
        _fetch_behavior_records(motor_db, user_id, start_dt, end_dt),
        _get_calibration(motor_db, user_id),
    )

    # ------------------------------------------------------------------
    # STEP 3 — Active time detection
    # ------------------------------------------------------------------
    active_time_doc = _detect_active_time_pure(
        records, calibration, today_str, day_str
    )

    # ------------------------------------------------------------------
    # STEP 4 — Store active_time to MongoDB
    # ------------------------------------------------------------------
    await motor_db["active_time"].update_one(
        {"userId": user_id, "date": today_str},
        {"$set": {
            **active_time_doc,
            "userId":    user_id,
            "source":    "active_time_detection",
            "updatedAt": datetime.utcnow(),
        }},
        upsert=True,
    )

    # ------------------------------------------------------------------
    # STEP 5 — Feature engineering
    # ------------------------------------------------------------------
    features = extract_features(records, active_time_doc, calibration)

    # ------------------------------------------------------------------
    # STEP 5.5 — Fetch feature history for Isolation Forest (last 30 days)
    # ------------------------------------------------------------------
    feature_history = await _get_feature_history(motor_db, user_id, days=30)

    # ------------------------------------------------------------------
    # STEP 6 — ML signals (independent, per-user XGB)
    # ------------------------------------------------------------------
    hmm_result = _hmm.predict(records)
    xgb_result = _get_xgb(user_id).predict(features)

    # ------------------------------------------------------------------
    # STEP 6.5 — Isolation Forest anomaly detection
    # ------------------------------------------------------------------
    if_detector = IsolationForestDetector()
    history_with_today = feature_history + [{"date": today_str, "features": features}]
    if_result   = if_detector.detect(history_with_today)
    is_anomaly  = if_result["is_anomalous"].get(today_str, False)
    anomaly_score = if_result["scores"].get(today_str, 0.0)

    # ------------------------------------------------------------------
    # STEP 7 — Score blending
    # ------------------------------------------------------------------
    score_result = _calculate_score(hmm_result, xgb_result, if_result, today_str)

    # ------------------------------------------------------------------
    # STEP 7.5 — Fetch 7-day active_time history (used for patterns + LSTM)
    # ------------------------------------------------------------------
    history = await _get_active_time_history(motor_db, user_id, 7)

    # ------------------------------------------------------------------
    # STEP 6.8 — Pattern detection
    # ------------------------------------------------------------------
    try:
        near_tasks = await get_near_deadline_tasks(motor_db, threshold_days=14)
        patterns = _detect_patterns_pure(active_time_doc, history, calibration, near_tasks)
    except Exception:
        patterns = []  # pattern detection is best-effort

    # ------------------------------------------------------------------
    # STEP 8 — Store procrastination_results to MongoDB
    #          (enhanced: includes isAnomaly, anomalyScore, features, patterns)
    # ------------------------------------------------------------------
    procrastination_doc = {
        "date":             today_str,
        "userId":           user_id,
        "dominantPattern":  xgb_result["label"],
        "classId":          xgb_result["class_id"],
        "score":            score_result["score"],
        "level":            score_result["level"],
        "confidence":       xgb_result["confidence"],
        "behaviorState":    hmm_result["dominant_state"],
        "focusProbability": hmm_result["focus_probability"],
        "isAnomaly":        is_anomaly,
        "anomalyScore":     anomaly_score,
        "features":         features,
        "patterns":         patterns,
        "source":           "procrastination_ml_engine",
        "updatedAt":        datetime.utcnow(),
    }
    await motor_db["procrastination_results"].update_one(
        {"userId": user_id, "date": today_str},
        {"$set": procrastination_doc},
        upsert=True,
    )

    # ------------------------------------------------------------------
    # STEP 9 — LSTM next-day prediction (reuses history from STEP 7.5)
    # ------------------------------------------------------------------
    lstm_result = _lstm.predict(history)

    # ------------------------------------------------------------------
    # STEP 10 — Store predicted_active_time to MongoDB
    # ------------------------------------------------------------------
    prediction_doc = {
        "date":                          next_day_str,
        "userId":                        user_id,
        "day":                           next_day_name,
        "predictedAcademicMinutes":      lstm_result["nextDayAcademicMinutes"],
        "predictedActiveStart":          lstm_result["predictedActiveStart"],
        "predictedActiveEnd":            lstm_result["predictedActiveEnd"],
        "predictedFocusProbability":     lstm_result["nextDayFocusProbability"],
        "predictedProcrastinationLevel": lstm_result["predictedProcrastinationLevel"],
        "nextDayProcrastinationRisk":    lstm_result.get("nextDayProcrastinationRisk", 0.5),
        "source":                        "lstm_behavior_prediction",
        "updatedAt":                     datetime.utcnow(),
    }
    await motor_db["predicted_active_time"].update_one(
        {"userId": user_id, "date": next_day_str},
        {"$set": prediction_doc},
        upsert=True,
    )

    # ------------------------------------------------------------------
    # STEP 10.5 — Adaptive retraining (per-user XGB model)
    # ------------------------------------------------------------------
    try:
        retrain_result = await maybe_retrain(motor_db, user_id, today_str)
        if retrain_result.get("retrained"):
            # Invalidate cache so next call loads the new model
            _xgb_cache.pop(user_id, None)
    except Exception:
        pass  # retraining is best-effort — never block the main result

    # ------------------------------------------------------------------
    # Return clean structured response (strip internal updatedAt)
    # ------------------------------------------------------------------
    return {
        "active_time": active_time_doc,
        "procrastination": {k: v for k, v in procrastination_doc.items() if k not in ("updatedAt", "features")},
        "prediction":      {k: v for k, v in prediction_doc.items()      if k != "updatedAt"},
    }
