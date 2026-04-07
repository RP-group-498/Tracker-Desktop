"""
PatternDetection/hmm_detector.py

Hidden Markov Model detector for procrastination-related behavioral states.

Uses a GaussianHMM with pre-initialized domain-knowledge priors.
No training data is required — parameters are set manually and Viterbi
decoding is applied directly (no EM / fit() call).

Design rationale:
    Per-day record counts are typically 5–30. Fitting GaussianHMM via
    Baum-Welch EM on such small sequences is numerically unstable and
    produces non-deterministic state label assignments across calls.
    Pre-initialized priors with Viterbi decode are deterministic,
    reproducible, and interpretable.

No I/O, no database access, no side effects.
"""

from .types import BehaviorRecord

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_STATES: list[str] = ["focused", "mild_distraction", "heavy_distraction", "idle"]
_N_STATES: int = 4
_N_FEATURES: int = 3   # [time_spent_minutes, app_switch_count, category_numeric]
_MIN_RECORDS: int = 2  # hmmlearn decode requires at least 2 observations

# Category encoding — must match labels produced by classification pipeline (readers.py)
_CATEGORY_NUMERIC: dict[str, float] = {
    "academic":     0.0,
    "productivity": 1.0,
    "non-academic": 2.0,
}
_CATEGORY_UNKNOWN_DEFAULT: float = 1.0  # neutral fallback for unexpected labels


# ---------------------------------------------------------------------------
# HMMDetector
# ---------------------------------------------------------------------------

class HMMDetector:
    """Decode per-record behavioral states using a pre-initialized GaussianHMM.

    States (index → name):
        0  focused           Long academic sessions, few app switches.
        1  mild_distraction  Medium sessions, some switches, productive work.
        2  heavy_distraction Short sessions, many switches, non-academic.
        3  idle              Very short sessions, no switches, mixed category.

    Observation vector per BehaviorRecord (3 features):
        [time_spent_minutes, float(app_switch_count), category_numeric]

    Usage:
        detector = HMMDetector()
        result = detector.predict(records)
        # result["dominant_state"] -> "focused" | "mild_distraction" | ...
        # result["state_sequence"] -> ["focused", "mild_distraction", ...]
        # result["focus_probability"] -> 0.0 – 1.0
    """

    def __init__(self) -> None:
        self._model = None          # Lazy-initialized GaussianHMM
        self._available: bool = True  # Set False if hmmlearn is not installed

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict(self, records: list[BehaviorRecord]) -> dict:
        """Decode hidden states for a sequence of activity records.

        Args:
            records: Time-ordered list of BehaviorRecord objects for the day.
                     Fields used: time_spent_minutes, app_switch_count, category.

        Returns:
            Dict with keys:
                dominant_state   (str)        Most frequent decoded state.
                state_sequence   (list[str])  Per-record state labels.
                focus_probability(float)      Fraction of records in "focused" state.

            Returns a rule-based fallback result when:
            - len(records) < 2  (sparse data guard, HMM never touched)
            - hmmlearn is not installed
            - Viterbi decode raises any exception
        """
        # Guard 1: sparse data — return immediately, never touch the HMM
        if len(records) < _MIN_RECORDS:
            return self._fallback(records)

        # Guard 2: hmmlearn previously failed to import
        if not self._available:
            return self._fallback(records)

        # Lazy-initialize model on first real call
        if self._model is None:
            self._initialize()
            if not self._available:
                return self._fallback(records)

        obs = self._build_observations(records)

        try:
            _log_prob, state_indices = self._model.decode(obs, algorithm="viterbi")
        except Exception:
            return self._fallback(records)

        state_sequence = [_STATES[i] for i in state_indices]
        dominant_state = max(set(state_sequence), key=state_sequence.count)
        focus_probability = round(
            state_sequence.count("focused") / len(state_sequence), 6
        )

        return {
            "dominant_state":    dominant_state,
            "state_sequence":    state_sequence,
            "focus_probability": focus_probability,
        }

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def _initialize(self) -> None:
        """Build GaussianHMM with domain-knowledge priors.

        Heavy imports (numpy, hmmlearn) are deferred to here so that
        importing this module has zero cost when hmmlearn is not installed.

        Parameters are set manually; init_params="" and params="" prevent
        hmmlearn from auto-initializing or updating any parameters.
        Viterbi decode is called directly without a prior fit() call.
        """
        try:
            import numpy as np
            from hmmlearn.hmm import GaussianHMM
        except ImportError:
            self._available = False
            return

        import numpy as np  # noqa: F811 — re-import in local scope for numpy calls below

        model = GaussianHMM(
            n_components=_N_STATES,
            covariance_type="diag",
            n_iter=1,
            init_params="",   # do not auto-initialize any parameters
            params="",        # do not update any parameters (no EM)
        )

        # Start probabilities — prior: user more likely starts day focused
        model.startprob_ = np.array([0.40, 0.30, 0.20, 0.10])

        # Transition matrix [from_state × to_state]
        # Rows must sum to 1.0.
        model.transmat_ = np.array([
            #  focused  mild    heavy   idle
            [0.70,     0.20,   0.05,   0.05],  # focused
            [0.25,     0.50,   0.20,   0.05],  # mild_distraction
            [0.10,     0.25,   0.55,   0.10],  # heavy_distraction
            [0.20,     0.30,   0.20,   0.30],  # idle
        ])

        # Emission means: [time_spent_minutes, app_switch_count, category_numeric]
        model.means_ = np.array([
            [15.0,  0.1,  0.0],   # focused:           long academic sessions
            [ 8.0,  0.5,  1.0],   # mild_distraction:  medium productive sessions
            [ 3.0,  1.0,  2.0],   # heavy_distraction: short non-academic bursts
            [ 1.5,  0.0,  1.5],   # idle:              very short, mixed category
        ])

        # Diagonal covariances — shape (n_states, n_features) for "diag" type.
        # Larger variance on time_spent_minutes reflects high natural variability.
        model.covars_ = np.array([
            [25.0,  0.10,  0.50],  # focused
            [16.0,  0.25,  0.50],  # mild_distraction
            [ 4.0,  0.50,  0.50],  # heavy_distraction
            [ 1.0,  0.05,  1.00],  # idle
        ])

        self._model = model

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_observations(self, records: list[BehaviorRecord]):
        """Convert records to a numpy observation matrix of shape (n_samples, 3).

        Returns:
            np.ndarray of dtype float64, shape (len(records), 3).
            Each row: [time_spent_minutes, app_switch_count, category_numeric].
        """
        import numpy as np

        rows = []
        for r in records:
            cat_num = _CATEGORY_NUMERIC.get(r.category, _CATEGORY_UNKNOWN_DEFAULT)
            rows.append([
                float(r.time_spent_minutes),
                float(r.app_switch_count),
                cat_num,
            ])

        # Explicit reshape enforces (n_samples, 3) — required by hmmlearn
        return np.array(rows, dtype=float).reshape(-1, _N_FEATURES)

    def _fallback(self, records: list[BehaviorRecord]) -> dict:
        """Rule-based state assignment used when HMM decode is not possible.

        Maps the fraction of academic records to a dominant state:
            ≥ 0.6  →  focused
            ≥ 0.3  →  mild_distraction
            < 0.3  →  heavy_distraction
            empty  →  idle
        """
        if not records:
            return {
                "dominant_state":    "idle",
                "state_sequence":    [],
                "focus_probability": 0.0,
            }

        academic_count = sum(1 for r in records if r.category == "academic")
        ratio = academic_count / len(records)

        if ratio >= 0.6:
            dominant = "focused"
        elif ratio >= 0.3:
            dominant = "mild_distraction"
        else:
            dominant = "heavy_distraction"

        return {
            "dominant_state":    dominant,
            "state_sequence":    [dominant] * len(records),
            "focus_probability": round(ratio, 6),
        }
