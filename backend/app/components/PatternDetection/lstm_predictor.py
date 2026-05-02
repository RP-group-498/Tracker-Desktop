"""
PatternDetection/lstm_predictor.py

LSTM-based next-day behavior predictor.

Input:  list of active_time dicts (last 7 days, from active_time collection).
Output: predicted next-day metrics dict.

Falls back to a moving-average heuristic when:
  - tensorflow/keras is not installed
  - history has fewer than 3 usable days
  - any exception during LSTM inference

No I/O, no database access, no side effects.
"""

from __future__ import annotations

from statistics import mean, mode
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MIN_HISTORY: int = 3       # minimum days needed to attempt EMA prediction

_DEFAULT_START = "09:00 AM"
_DEFAULT_END   = "05:00 PM"


# ---------------------------------------------------------------------------
# LSTMPredictor
# ---------------------------------------------------------------------------

class LSTMPredictor:
    """Predict next-day academic-time behavior from a short activity history.

    Features per day (3-dim):
        [fullDayAcademicMinutes, fullDayNonAcademicMinutes, fullDayTotalAppSwitches]

    The model is built and fit on-the-fly for each call — no saved weights.
    This is intentional: the history window is small (≤ 7 days) and we want
    the most recent trends to dominate without stale parameters from prior runs.

    Usage:
        predictor = LSTMPredictor()
        result = predictor.predict(history)
    """

    def predict(self, history: list[dict]) -> dict:
        """Predict next-day behavior.

        Args:
            history: List of active_time dicts (any order).
                     Relevant keys: date (str YYYY-MM-DD), fullDayAcademicMinutes,
                     fullDayNonAcademicMinutes, fullDayTotalAppSwitches,
                     activeStart, activeEnd.

        Returns:
            {
                "nextDayAcademicMinutes":       int,
                "predictedActiveStart":         str,   # "HH:MM AM/PM"
                "predictedActiveEnd":           str,   # "HH:MM AM/PM"
                "nextDayFocusProbability":      float, # 0.0–1.0
                "predictedProcrastinationLevel":str,   # "low"|"moderate"|"high"
            }
        """
        # Sort by date ascending and take last 7 days
        usable = sorted(
            [d for d in history if isinstance(d, dict) and d.get("date")],
            key=lambda d: d["date"],
        )[-7:]

        if len(usable) < _MIN_HISTORY:
            return self._heuristic(usable)

        try:
            return self._lstm(usable)
        except Exception:
            return self._heuristic(usable)

    # ------------------------------------------------------------------
    # LSTM path
    # ------------------------------------------------------------------

    def _lstm(self, history: list[dict]) -> dict:
        """Exponential moving average predictor (replaces TensorFlow LSTM).

        Uses EMA with alpha=0.3 — gives more weight to recent days.
        Same output format as before, no external dependencies.
        """
        alpha = 0.3

        academic_vals = [float(d.get("fullDayAcademicMinutes", 0))    for d in history]
        non_acad_vals = [float(d.get("fullDayNonAcademicMinutes", 0)) for d in history]
        starts        = [d.get("activeStart") for d in history if d.get("activeStart")]
        ends          = [d.get("activeEnd")   for d in history if d.get("activeEnd")]

        def ema(values: list[float]) -> float:
            s = values[0]
            for v in values[1:]:
                s = alpha * v + (1 - alpha) * s
            return s

        pred_academic = max(int(round(ema(academic_vals))), 0)
        pred_non_acad = max(ema(non_acad_vals), 0.0)
        focus_prob    = _focus_probability(pred_academic, pred_non_acad)
        level         = _level_from_focus(focus_prob)

        return {
            "nextDayAcademicMinutes":        pred_academic,
            "predictedActiveStart":          _most_common(starts, _DEFAULT_START),
            "predictedActiveEnd":            _most_common(ends,   _DEFAULT_END),
            "nextDayFocusProbability":       round(focus_prob, 4),
            "predictedProcrastinationLevel": level,
            "nextDayProcrastinationRisk":    round(1.0 - focus_prob, 4),
        }

    # ------------------------------------------------------------------
    # Heuristic fallback
    # ------------------------------------------------------------------

    def _heuristic(self, history: list[dict]) -> dict:
        """Moving-average heuristic used when LSTM is not possible."""
        if not history:
            return {
                "nextDayAcademicMinutes":        0,
                "predictedActiveStart":          _DEFAULT_START,
                "predictedActiveEnd":            _DEFAULT_END,
                "nextDayFocusProbability":       0.5,
                "predictedProcrastinationLevel": "moderate",
                "nextDayProcrastinationRisk":    0.5,
            }

        academic_vals = [float(d.get("fullDayAcademicMinutes", 0))    for d in history]
        non_acad_vals = [float(d.get("fullDayNonAcademicMinutes", 0)) for d in history]
        starts        = [d.get("activeStart") for d in history if d.get("activeStart")]
        ends          = [d.get("activeEnd")   for d in history if d.get("activeEnd")]

        avg_academic = mean(academic_vals)
        avg_non_acad = mean(non_acad_vals)
        focus_prob   = _focus_probability(avg_academic, avg_non_acad)
        level        = _level_from_focus(focus_prob)

        return {
            "nextDayAcademicMinutes":        max(int(round(avg_academic)), 0),
            "predictedActiveStart":          _most_common(starts, _DEFAULT_START),
            "predictedActiveEnd":            _most_common(ends,   _DEFAULT_END),
            "nextDayFocusProbability":       round(focus_prob, 4),
            "predictedProcrastinationLevel": level,
            "nextDayProcrastinationRisk":    round(1.0 - focus_prob, 4),
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _focus_probability(academic: float, non_academic: float) -> float:
    total = academic + non_academic
    if total < 1e-9:
        return 0.5
    return min(academic / total, 1.0)


def _level_from_focus(focus_prob: float) -> str:
    if focus_prob > 0.6:
        return "low"
    if focus_prob < 0.3:
        return "high"
    return "moderate"


def _most_common(values: list[Any], default: Any) -> Any:
    if not values:
        return default
    try:
        return mode(values)
    except Exception:
        return values[-1]
