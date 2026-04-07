"""
backend/tests/test_pattern_detection_pipeline.py

Standalone script that exercises the pure-computation layers of the
PatternDetection ML pipeline without a database or async runtime.

Run from the repo root (with the backend venv activated):
    python backend/tests/test_pattern_detection_pipeline.py
"""

import os
import sys
from datetime import datetime, timezone
from pprint import pprint

# Allow imports from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.components.PatternDetection.types import BehaviorRecord
from app.components.PatternDetection.active_time import _detect_active_time_pure
from app.components.PatternDetection.feature_engineering import extract_features
from app.components.PatternDetection.hmm_detector import HMMDetector
from app.components.PatternDetection.xgb_classifier import XGBProcrastinationClassifier
from app.components.PatternDetection.procrast_patterns import _detect_patterns_pure
from app.components.PatternDetection.scoring import _calculate_score


# ---------------------------------------------------------------------------
# Synthetic data
# ---------------------------------------------------------------------------

def _make_records() -> list[BehaviorRecord]:
    """8 synthetic records spanning 08:00–10:15 UTC (inside morning focus window)."""
    today = datetime.now(timezone.utc).date()

    def dt(h: int, m: int) -> datetime:
        return datetime(today.year, today.month, today.day, h, m, tzinfo=timezone.utc)

    return [
        BehaviorRecord(dt(8,  0), dt(8, 30), "academic",     30.0, 0, "pycharm"),
        BehaviorRecord(dt(8, 30), dt(8, 45), "academic",     15.0, 1, "pycharm"),
        BehaviorRecord(dt(8, 45), dt(9,  0), "non-academic", 15.0, 1, "youtube"),
        BehaviorRecord(dt(9,  0), dt(9, 20), "academic",     20.0, 1, "pycharm"),
        BehaviorRecord(dt(9, 20), dt(9, 35), "productivity", 15.0, 1, "notion"),
        BehaviorRecord(dt(9, 35), dt(9, 40), "non-academic",  5.0, 1, "twitter"),
        BehaviorRecord(dt(9, 40), dt(10, 10), "academic",    30.0, 1, "pycharm"),
        BehaviorRecord(dt(10, 10), dt(10, 15), "non-academic", 5.0, 1, "reddit"),
    ]


CALIBRATION = {
    "focusPeriod": "morning",  # FOCUS_WINDOWS["morning"] = (6, 12)
    "studyDuration": 2.0,      # 2 h expected → 120 min
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    records = _make_records()
    today = datetime.now(timezone.utc).date()
    today_str = today.strftime("%Y-%m-%d")
    day_str = today.strftime("%A")

    # -----------------------------------------------------------------------
    print(f"\n=== BehaviorRecords ({len(records)}) ===")
    for r in records:
        print(
            f"  {r.session_start.strftime('%H:%M')}–{r.session_end.strftime('%H:%M')}"
            f"  {r.category:<14}  {r.time_spent_minutes:5.1f} min"
            f"  switches={r.app_switch_count}  app={r.app_name}"
        )

    # -----------------------------------------------------------------------
    active_time_doc = _detect_active_time_pure(records, CALIBRATION, today_str, day_str)
    print("\n=== Active Time Doc ===")
    pprint(active_time_doc)

    # -----------------------------------------------------------------------
    features = extract_features(records, active_time_doc, CALIBRATION)
    print("\n=== Extracted Features ===")
    pprint(features)

    # -----------------------------------------------------------------------
    hmm_result = HMMDetector().predict(records)
    print("\n=== HMM Result ===")
    pprint(hmm_result)

    # -----------------------------------------------------------------------
    xgb_result = XGBProcrastinationClassifier().predict(features)
    print("\n=== XGB Result ===")
    pprint(xgb_result)

    # -----------------------------------------------------------------------
    patterns = _detect_patterns_pure(active_time_doc, [], CALIBRATION, [])
    print("\n=== Patterns Detected ===")
    pprint(patterns)

    # -----------------------------------------------------------------------
    scoring = _calculate_score(patterns, hmm_result=hmm_result, xgb_result=xgb_result)
    print("\n=== Final Score ===")
    print(f"  score:          {scoring['score']}")
    print(f"  level:          {scoring['level']}")
    print(f"  dominantPattern:{scoring['dominantPattern']}")
    print()


if __name__ == "__main__":
    main()
