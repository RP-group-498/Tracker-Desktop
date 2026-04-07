"""
PatternDetection/feature_engineering.py

Pure feature extraction from a list of BehaviorRecord objects.
Produces a flat numeric feature dictionary for use by downstream ML models
(HMM, XGBoost) in the procrastination detection pipeline.

No I/O, no database access, no side effects.
"""

import math

from .types import BehaviorRecord


def _safe_div(numerator: float, denominator: float) -> float:
    """Return numerator / denominator, or 0.0 if denominator is effectively zero."""
    return numerator / denominator if denominator > 1e-9 else 0.0


def _burst_non_academic_count(records: list[BehaviorRecord]) -> int:
    """Count consecutive runs of non-academic activity.

    A burst begins when a record's category is not "academic" and the
    previous record was "academic" (or this is the first record).
    "productivity" is treated as focus-breaking for this metric, matching
    the convention used in active_time.py for focus-window scoring.
    """
    bursts = 0
    in_burst = False
    for r in records:
        if r.category != "academic":
            if not in_burst:
                bursts += 1
                in_burst = True
        else:
            in_burst = False
    return bursts


def _hour_of_day_entropy(records: list[BehaviorRecord]) -> float:
    """Compute Shannon entropy (bits) of activity distributed across clock hours.

    Uses time_spent_minutes as the weight per record so longer sessions
    contribute proportionally more than brief ones.

    High entropy  → activity scattered across many hours (unfocused pattern).
    Low entropy   → activity concentrated in few hours (consistent pattern).

    Returns 0.0 when there is no activity to measure.
    """
    buckets: dict[int, float] = {}
    for r in records:
        hour = r.session_start.hour
        buckets[hour] = buckets.get(hour, 0.0) + r.time_spent_minutes

    total_minutes = sum(buckets.values())
    if total_minutes <= 1e-9:
        return 0.0

    entropy = 0.0
    for minutes in buckets.values():
        p = minutes / total_minutes
        if p > 0.0:
            entropy -= p * math.log2(p)

    return round(entropy, 6)


def extract_features(
    records: list[BehaviorRecord],
    active_time_doc: dict,
    calibration: dict,
) -> dict:
    """Extract a flat numeric feature dictionary from a day's activity records.

    Args:
        records:         Time-ordered list of BehaviorRecord objects for the day.
                         Fields used: session_start, session_end, category,
                         time_spent_minutes, app_switch_count.
        active_time_doc: Output of _detect_active_time_pure() for the same day.
                         Provides fullDayAcademicMinutes and expectedStudyMinutes.
        calibration:     User calibration document (from MongoDB user_calibration).
                         Provides studyDuration as fallback for expectedStudyMinutes.

    Returns:
        Flat dict with the following features (all numeric, JSON-safe):

        total_events            (int)   Number of activity records for the day.
        academic_event_ratio    (float) Fraction of records categorised "academic".
        non_academic_event_ratio(float) Fraction categorised strictly "non-academic"
                                        (excludes "productivity").
        switch_count            (int)   Total app switches across all records.
        switch_rate             (float) Switches per minute of active time.
        avg_active_time         (float) Mean time_spent_minutes per record.
        idle_ratio              (float) Fraction of the observed span that was idle,
                                        clamped to [0, 1].
        burst_non_academic_count(int)   Number of consecutive non-academic runs.
        focus_ratio             (float) Academic minutes / expected study minutes,
                                        clamped to [0, 1].
        hour_of_day_entropy     (float) Shannon entropy (bits) of time distribution
                                        across clock hours.

    Category labels produced by the classification pipeline:
        "academic"     — academic work
        "productivity" — productive but not strictly academic
        "non-academic" — distraction / leisure
    """
    total_events = len(records)

    if total_events == 0:
        return {
            "total_events": 0,
            "academic_event_ratio": 0.0,
            "non_academic_event_ratio": 0.0,
            "switch_count": 0,
            "switch_rate": 0.0,
            "avg_active_time": 0.0,
            "idle_ratio": 0.0,
            "burst_non_academic_count": 0,
            "focus_ratio": 0.0,
            "hour_of_day_entropy": 0.0,
        }

    # --- Event ratios --------------------------------------------------------
    # Use exact category strings from the classification pipeline (readers.py).
    academic_count = sum(1 for r in records if r.category == "academic")
    non_academic_count = sum(1 for r in records if r.category == "non-academic")

    academic_event_ratio = _safe_div(academic_count, total_events)
    non_academic_event_ratio = _safe_div(non_academic_count, total_events)

    # --- Switching -----------------------------------------------------------
    # app_switch_count is pre-computed in readers.py: 1 when app changed, else 0.
    switch_count = sum(r.app_switch_count for r in records)
    total_active_minutes = sum(r.time_spent_minutes for r in records)
    switch_rate = _safe_div(switch_count, total_active_minutes)

    # --- Average active time per event ---------------------------------------
    avg_active_time = _safe_div(total_active_minutes, total_events)

    # --- Idle ratio ----------------------------------------------------------
    # Observed span: first session_start → last session_end.
    # Idle = time within that span not accounted for by active records.
    span_minutes = (
        records[-1].session_end - records[0].session_start
    ).total_seconds() / 60.0
    idle_gap = max(span_minutes - total_active_minutes, 0.0)
    idle_ratio = min(_safe_div(idle_gap, span_minutes), 1.0)

    # --- Burst count ---------------------------------------------------------
    burst_count = _burst_non_academic_count(records)

    # --- Focus ratio ---------------------------------------------------------
    # Prefer pre-computed fullDayAcademicMinutes / expectedStudyMinutes from
    # active_time_doc (already computed by _detect_active_time_pure).
    # Fall back to calibration.studyDuration when active_time_doc lacks the field.
    academic_minutes = float(active_time_doc.get("fullDayAcademicMinutes") or 0)
    expected_minutes = float(active_time_doc.get("expectedStudyMinutes") or 0)
    if expected_minutes <= 0:
        expected_minutes = float(calibration.get("studyDuration") or 2.0) * 60.0
    focus_ratio = min(_safe_div(academic_minutes, expected_minutes), 1.0)

    # --- Hour-of-day entropy -------------------------------------------------
    entropy = _hour_of_day_entropy(records)

    return {
        "total_events": total_events,
        "academic_event_ratio": round(academic_event_ratio, 6),
        "non_academic_event_ratio": round(non_academic_event_ratio, 6),
        "switch_count": switch_count,
        "switch_rate": round(switch_rate, 6),
        "avg_active_time": round(avg_active_time, 6),
        "idle_ratio": round(idle_ratio, 6),
        "burst_non_academic_count": burst_count,
        "focus_ratio": round(focus_ratio, 6),
        "hour_of_day_entropy": entropy,
    }
