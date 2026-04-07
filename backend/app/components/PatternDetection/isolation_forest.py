"""
PatternDetection/isolation_forest.py

Anomaly detection on historical feature vectors using Isolation Forest.

Given the last 30 days of per-day feature vectors (from procrastination_results),
identifies days with unusually abnormal behavior patterns.

Falls back to a z-score heuristic when:
  - scikit-learn is not installed
  - fewer than _MIN_SAMPLES days available

No I/O, no database access, no side effects.
"""

from __future__ import annotations

_MIN_SAMPLES: int = 7
_CONTAMINATION: float = 0.1
_N_ESTIMATORS: int = 100
_RANDOM_STATE: int = 42
_ZSCORE_THRESHOLD: float = 2.5

# Must match feature_engineering._FEATURE_NAMES
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


class IsolationForestDetector:
    """Detect anomalous days from historical feature vectors.

    Usage:
        detector = IsolationForestDetector()
        result = detector.detect(feature_history)
        # result["is_anomalous"]["2026-03-20"] -> True/False
        # result["scores"]["2026-03-20"]       -> float (lower = more anomalous)
    """

    def detect(self, feature_history: list[dict]) -> dict:
        """Detect anomalies in daily feature vectors.

        Args:
            feature_history: List of dicts, each with:
                - "date":     str (YYYY-MM-DD)
                - "features": dict (10-key vector from extract_features)

        Returns:
            {
                "anomalous_dates": list[str],
                "scores":          dict[str, float],   # date -> score (lower = more anomalous)
                "is_anomalous":    dict[str, bool],
                "n_samples":       int,
                "available":       bool,
                "reason":          str | None,
            }
        """
        valid = [
            e for e in feature_history
            if isinstance(e, dict) and e.get("date") and isinstance(e.get("features"), dict)
        ]

        if len(valid) < _MIN_SAMPLES:
            return self._fallback(valid, reason=f"only {len(valid)} samples (need {_MIN_SAMPLES})")

        try:
            return self._isolation_forest(valid)
        except Exception as exc:
            return self._fallback(valid, reason=f"sklearn error: {exc}")

    # ------------------------------------------------------------------
    # Isolation Forest path
    # ------------------------------------------------------------------

    def _isolation_forest(self, history: list[dict]) -> dict:
        import numpy as np
        try:
            from sklearn.ensemble import IsolationForest
        except ImportError:
            return self._fallback(history, reason="scikit-learn not installed")

        dates = [e["date"] for e in history]
        X = np.array(
            [[float(e["features"].get(f, 0.0)) for f in _FEATURE_NAMES] for e in history],
            dtype=float,
        )

        clf = IsolationForest(
            n_estimators=_N_ESTIMATORS,
            contamination=_CONTAMINATION,
            random_state=_RANDOM_STATE,
        )
        clf.fit(X)

        raw_scores   = clf.decision_function(X)   # positive = normal, negative = anomalous
        sample_scores = clf.score_samples(X)      # 2^(-E(h(x))/c(n)), near 1 = normal, near 0 = anomalous
        predictions  = clf.predict(X)             # +1 = normal, -1 = anomalous

        scores_dict: dict[str, float] = {}
        anomaly_scores_normalized: dict[str, float] = {}
        is_anomalous: dict[str, bool] = {}
        anomalous_dates: list[str] = []

        for date, score, sample_score, pred in zip(dates, raw_scores, sample_scores, predictions):
            scores_dict[date] = round(float(score), 6)
            # Invert so higher = more anomalous (consistent with ScoreXGB and ScoreHMM)
            anomaly_scores_normalized[date] = round(1.0 - float(sample_score), 6)
            is_anom = bool(pred == -1)
            is_anomalous[date] = is_anom
            if is_anom:
                anomalous_dates.append(date)

        return {
            "anomalous_dates":          anomalous_dates,
            "scores":                   scores_dict,
            "anomaly_scores_normalized": anomaly_scores_normalized,
            "is_anomalous":             is_anomalous,
            "n_samples":                len(history),
            "available":                True,
            "reason":                   None,
        }

    # ------------------------------------------------------------------
    # Z-score fallback
    # ------------------------------------------------------------------

    def _fallback(self, history: list[dict], reason: str = "") -> dict:
        """Flag days where any feature is >2.5 std devs from the mean."""
        scores_dict: dict[str, float] = {}
        anomaly_scores_normalized: dict[str, float] = {}
        is_anomalous: dict[str, bool] = {}
        anomalous_dates: list[str] = []

        if not history:
            return {
                "anomalous_dates":           [],
                "scores":                    {},
                "anomaly_scores_normalized": {},
                "is_anomalous":              {},
                "n_samples":                 0,
                "available":                 False,
                "reason":                    reason or "no data",
            }

        # Compute per-feature mean and std
        feature_values: dict[str, list[float]] = {f: [] for f in _FEATURE_NAMES}
        for e in history:
            for f in _FEATURE_NAMES:
                feature_values[f].append(float(e["features"].get(f, 0.0)))

        means: dict[str, float] = {}
        stds: dict[str, float] = {}
        for f, vals in feature_values.items():
            n = len(vals)
            mu = sum(vals) / n
            variance = sum((v - mu) ** 2 for v in vals) / max(n - 1, 1)
            means[f] = mu
            stds[f] = variance ** 0.5

        for e in history:
            date = e["date"]
            max_z = 0.0
            for f in _FEATURE_NAMES:
                std = stds[f]
                if std < 1e-9:
                    continue
                z = abs(float(e["features"].get(f, 0.0)) - means[f]) / std
                if z > max_z:
                    max_z = z

            is_anom = max_z > _ZSCORE_THRESHOLD
            # Convert z-score to a score where lower = more anomalous (like IF)
            score = round(1.0 / (1.0 + max_z), 6)
            scores_dict[date] = score
            # Invert so higher = more anomalous (consistent with ScoreXGB and ScoreHMM)
            anomaly_scores_normalized[date] = round(1.0 - score, 6)
            is_anomalous[date] = is_anom
            if is_anom:
                anomalous_dates.append(date)

        return {
            "anomalous_dates":           anomalous_dates,
            "scores":                    scores_dict,
            "anomaly_scores_normalized": anomaly_scores_normalized,
            "is_anomalous":              is_anomalous,
            "n_samples":                 len(history),
            "available":                 False,
            "reason":                    reason,
        }
