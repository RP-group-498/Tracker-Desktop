"""
PatternDetection/behavior_analyzer.py

Pure computation of behavior trend statistics over multiple time windows.

Given joined procrastination_results + active_time history, computes
per-period stats (1d, 3d, 5d, 7d, 14d) and overall trend direction.

No I/O, no database access, no side effects.
"""

from __future__ import annotations

from typing import Any


# ── Public API ─────────────────────────────────────────────────────────────────

def analyze_behavior_trends(history: list[dict]) -> dict:
    """Compute trend statistics from joined history docs.

    Args:
        history: List of dicts (newest-first or any order) where each doc is a
                 procrastination_results doc merged with its active_time doc:
                 {
                     date, score, level, dominantPattern, classId,
                     isAnomaly (optional),
                     academicMinutes, nonAcademicMinutes, expectedStudyMinutes,
                     fullDayAcademicMinutes, fullDayNonAcademicMinutes,
                 }

    Returns:
        {
            "period_stats": {
                "1d":  PeriodStat,
                "3d":  PeriodStat,
                "5d":  PeriodStat,
                "7d":  PeriodStat,
                "14d": PeriodStat,
            },
            "pattern_trend":  PatternTrend,
            "score_trend":    str,   # "improving" | "stable" | "worsening"
        }

    PeriodStat:
        days, avg_score, dominant_pattern, avg_academic_minutes,
        avg_non_academic_minutes, academic_trend, non_academic_trend,
        n_anomalous_days, samples
    """
    # Sort ascending by date
    sorted_hist = sorted(
        [h for h in history if isinstance(h, dict) and h.get("date")],
        key=lambda h: h["date"],
    )

    period_stats = {}
    for label, n in [("1d", 1), ("3d", 3), ("5d", 5), ("7d", 7), ("14d", 14)]:
        window = sorted_hist[-n:]
        period_stats[label] = _compute_period_stat(window, n)

    pattern_trend = _compute_pattern_trend(sorted_hist)
    score_trend   = _compute_score_trend(sorted_hist)

    return {
        "period_stats": period_stats,
        "pattern_trend": pattern_trend,
        "score_trend":   score_trend,
    }


# ── Internal helpers ───────────────────────────────────────────────────────────

def _compute_period_stat(window: list[dict], days: int) -> dict:
    if not window:
        return {
            "days":                    days,
            "avg_score":               0.0,
            "dominant_pattern":        None,
            "avg_academic_minutes":    0.0,
            "avg_non_academic_minutes":0.0,
            "academic_trend":          "stable",
            "non_academic_trend":      "stable",
            "n_anomalous_days":        0,
            "samples":                 0,
        }

    scores        = [float(h.get("score", 0)) for h in window]
    academic      = [float(h.get("fullDayAcademicMinutes", h.get("academicMinutes", 0))) for h in window]
    non_academic  = [float(h.get("fullDayNonAcademicMinutes", h.get("nonAcademicMinutes", 0))) for h in window]
    anomalous     = sum(1 for h in window if h.get("isAnomaly") is True)

    # Dominant pattern = most frequent non-None pattern
    patterns = [h.get("dominantPattern") for h in window if h.get("dominantPattern")]
    dominant = _most_frequent(patterns)

    return {
        "days":                    days,
        "avg_score":               round(sum(scores) / len(scores), 2) if scores else 0.0,
        "dominant_pattern":        dominant,
        "avg_academic_minutes":    round(sum(academic) / len(academic), 1) if academic else 0.0,
        "avg_non_academic_minutes":round(sum(non_academic) / len(non_academic), 1) if non_academic else 0.0,
        "academic_trend":          _trend_direction(academic),
        "non_academic_trend":      _trend_direction(non_academic),
        "n_anomalous_days":        anomalous,
        "samples":                 len(window),
    }


def _compute_pattern_trend(history: list[dict]) -> dict:
    """Count pattern occurrences over last 14 days and detect shifts."""
    window = history[-14:]
    counts: dict[str, int] = {}
    for h in window:
        p = h.get("dominantPattern")
        if p:
            counts[p] = counts.get(p, 0) + 1

    most_frequent = max(counts, key=lambda k: counts[k]) if counts else None

    # Detect shift: compare dominant in last 7d vs prior 7d
    prior_7  = history[-14:-7]
    recent_7 = history[-7:]
    dominant_prior  = _most_frequent([h.get("dominantPattern") for h in prior_7  if h.get("dominantPattern")])
    dominant_recent = _most_frequent([h.get("dominantPattern") for h in recent_7 if h.get("dominantPattern")])
    is_changing = (dominant_prior is not None and dominant_recent is not None
                   and dominant_prior != dominant_recent)

    return {
        "pattern_counts": counts,
        "most_frequent":  most_frequent,
        "is_changing":    is_changing,
    }


def _compute_score_trend(history: list[dict]) -> str:
    """Compare avg score in last 7 days vs prior 7 days."""
    if len(history) < 4:
        return "stable"

    recent = history[-7:]
    prior  = history[-14:-7]

    if not prior:
        return "stable"

    avg_recent = sum(float(h.get("score", 0)) for h in recent) / len(recent)
    avg_prior  = sum(float(h.get("score", 0)) for h in prior)  / len(prior)

    diff = avg_recent - avg_prior
    if diff < -0.5:
        return "improving"
    if diff > 0.5:
        return "worsening"
    return "stable"


def _trend_direction(values: list[float]) -> str:
    """Simple linear regression slope sign on a list of values."""
    n = len(values)
    if n < 2:
        return "stable"

    # Least-squares slope
    xs = list(range(n))
    x_mean = sum(xs) / n
    y_mean = sum(values) / n
    num = sum((xs[i] - x_mean) * (values[i] - y_mean) for i in range(n))
    den = sum((xs[i] - x_mean) ** 2 for i in range(n))

    if den < 1e-9:
        return "stable"

    slope = num / den
    # Use a threshold relative to mean to avoid flagging noise
    threshold = max(abs(y_mean) * 0.05, 1.0)
    if slope > threshold:
        return "up"
    if slope < -threshold:
        return "down"
    return "stable"


def _most_frequent(values: list[Any]) -> Any:
    """Return the most frequent non-None value, or None."""
    filtered = [v for v in values if v is not None]
    if not filtered:
        return None
    return max(set(filtered), key=filtered.count)
