"""
PatternDetection/xgb_classifier.py

XGBoost-based multi-class procrastination classifier.

Loads a pre-trained XGBClassifier from xgb_model.json (same directory).
Given a flat feature dict produced by feature_engineering.extract_features(),
predicts one of five procrastination types.

Classes:
    0 — no_procrastination
    1 — frequent_task_switching
    2 — prolonged_inactivity
    3 — impulsive_browsing
    4 — deadline_rushing

When the model file is absent or xgboost is not installed, a lightweight
rule-based fallback returns the same dict structure transparently.

No I/O, no database access, no side effects.
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MODEL_PATH: Path = Path(__file__).parent / "xgb_model.json"
_MODEL_DIR:  Path = Path(__file__).parent

# Feature extraction order — must match keys produced by extract_features().
# XGBoost requires a consistent column order across predict calls.
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

# Class ID → human-readable label
_CLASS_LABELS: dict[int, str] = {
    0: "no_procrastination",
    1: "frequent_task_switching",
    2: "prolonged_inactivity",
    3: "impulsive_browsing",
    4: "deadline_rushing",
}


# ---------------------------------------------------------------------------
# XGBProcrastinationClassifier
# ---------------------------------------------------------------------------

class XGBProcrastinationClassifier:
    """Predict procrastination type from a feature dictionary.

    Features are produced by feature_engineering.extract_features() and
    passed directly to this class — no BehaviorRecord access here.

    The model is loaded lazily on the first predict() call. If the model
    file is missing or xgboost is not installed, all subsequent calls use
    a rule-based fallback transparently.

    Usage:
        classifier = XGBProcrastinationClassifier()
        result = classifier.predict(features)
        # result["class_id"]    -> 0–4
        # result["label"]       -> "no_procrastination" | "frequent_task_switching" | ...
        # result["probability"] -> probability of predicted class (0.0–1.0)
        # result["confidence"]  -> same as probability for multi-class output
    """

    def __init__(self, user_id: str | None = None) -> None:
        self._model = None            # Lazy-initialised XGBClassifier
        self._available: bool = True  # Set False on ImportError or missing file
        self._user_id = user_id       # If set, attempt per-user model first

    def reload(self) -> None:
        """Force model reload on next predict() call (e.g. after adaptive retraining)."""
        self._model = None
        self._available = True

    def _resolve_model_path(self) -> Path:
        """Return per-user model path if it exists, else fall back to global model."""
        if self._user_id:
            user_path = _MODEL_DIR / f"xgb_model_{self._user_id}.json"
            if user_path.exists():
                return user_path
        return _MODEL_PATH

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict(self, features: dict) -> dict:
        """Predict procrastination type from a feature dictionary.

        Args:
            features: Flat dict produced by feature_engineering.extract_features().
                      Expected keys: see _FEATURE_NAMES.
                      Missing keys default to 0.0 without error.

        Returns:
            Dict with keys:
                class_id     (int)   Predicted class 0–4.
                label        (str)   Human-readable class name.
                probability  (float) Probability of the predicted class (0.0–1.0).
                confidence   (float) Same as probability for multi-class output.

            Returns a rule-based fallback result when:
            - xgboost is not installed
            - xgb_model.json is missing or cannot be loaded
            - predict_proba raises any exception
        """
        if not self._available:
            return self._fallback(features)

        if self._model is None:
            self._initialize()
            if not self._available:
                return self._fallback(features)

        X = self._build_feature_vector(features)

        try:
            import numpy as np
            proba_vec   = self._model.predict_proba(X)[0]   # shape (5,)
            class_id    = int(np.argmax(proba_vec))
            probability = round(float(proba_vec[class_id]), 6)
        except Exception:
            return self._fallback(features)

        return {
            "class_id":    class_id,
            "label":       _CLASS_LABELS[class_id],
            "probability": probability,
            "confidence":  probability,
        }

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def _initialize(self) -> None:
        """Load XGBClassifier from xgb_model.json (lazy, called once).

        Heavy imports (xgboost, numpy) are deferred here so that importing
        this module has zero cost when xgboost is not installed.

        Sets self._available = False on any failure so that subsequent
        predict() calls route directly to the fallback without retrying.
        """
        try:
            import xgboost as xgb  # noqa: F401 — verified import
        except ImportError:
            self._available = False
            return

        model_path = self._resolve_model_path()
        if not model_path.exists():
            self._available = False
            return

        try:
            import xgboost as xgb  # noqa: F811
            model = xgb.XGBClassifier()
            model.load_model(str(model_path))
            self._model = model
        except Exception:
            self._available = False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_feature_vector(self, features: dict):
        """Convert feature dict to a numpy array of shape (1, n_features).

        Features are extracted in the fixed order defined by _FEATURE_NAMES.
        Keys absent from the dict default to 0.0.

        Returns:
            np.ndarray of dtype float64, shape (1, len(_FEATURE_NAMES)).
        """
        import numpy as np

        values = [float(features.get(name, 0.0)) for name in _FEATURE_NAMES]
        return np.array(values, dtype=float).reshape(1, -1)

    def _fallback(self, features: dict) -> dict:
        """Rule-based procrastination type estimate when the XGBoost model is unavailable.

        Applies the same priority-based heuristics used in train_xgb_model._label_samples():

            Priority (highest wins):
                4 — deadline_rushing        total_events > 80  AND  academic_ratio > 0.5
                1 — frequent_task_switching switch_rate > 1.2  AND  focus_ratio < 0.6
                3 — impulsive_browsing      non_academic > 0.5  AND  burst_count > 5
                2 — prolonged_inactivity    focus_ratio < 0.3  AND  idle_ratio > 0.5
                0 — no_procrastination      otherwise
        """
        focus_ratio  = float(features.get("focus_ratio", 0.0))
        switch_rate  = float(features.get("switch_rate", 0.0))
        non_academic = float(features.get("non_academic_event_ratio", 0.0))
        idle_ratio   = float(features.get("idle_ratio", 0.0))
        burst_count  = float(features.get("burst_non_academic_count", 0.0))
        total_events = float(features.get("total_events", 0.0))
        acad_ratio   = float(features.get("academic_event_ratio", 0.0))

        if focus_ratio < 0.3 and idle_ratio > 0.5:
            class_id, prob = 2, 0.75   # prolonged_inactivity
        elif non_academic > 0.5 and burst_count > 5:
            class_id, prob = 3, 0.70   # impulsive_browsing
        elif switch_rate > 1.2 and focus_ratio < 0.6:
            class_id, prob = 1, 0.70   # frequent_task_switching
        elif total_events > 80 and acad_ratio > 0.5:
            class_id, prob = 4, 0.65   # deadline_rushing
        else:
            class_id, prob = 0, 0.80   # no_procrastination

        return {
            "class_id":    class_id,
            "label":       _CLASS_LABELS[class_id],
            "probability": round(prob, 6),
            "confidence":  round(prob, 6),
        }

