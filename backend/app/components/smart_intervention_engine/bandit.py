"""
LinUCB Contextual Bandit — Disjoint model, per-user per-action parameters.

Algorithm (per arm a):
  A_a  : d×d matrix, initialized to I_d
  b_a  : d-vector, initialized to 0

  select:
    theta_a = A_a^{-1} b_a
    score_a = theta_a^T x + alpha * sqrt(x^T A_a^{-1} x)
    pick arm with highest (deficit-weighted) score — see intervention.py

  update on reward r (discounted):
    A_a = GAMMA * A_a + x x^T
    b_a = GAMMA * b_a + r x

  GAMMA discounting: older observations are exponentially down-weighted so
  the model adapts to changing user behavior.
  GAMMA = 0.995 means ~60% weight remains after 100 updates.

Parameters are stored in MongoDB (bandit_models collection) and loaded/saved
by intervention.py on every request. This module is pure numpy — no db access.

Context vector (d = 9):
  [0] bias, [1] expectancy, [2] value, [3] impulsiveness, [4] delay,
  [5] motivation, [6] deficit_code, [7] session_dur, [8] time_of_day
"""

import logging
import numpy as np
from typing import List

logger = logging.getLogger(__name__)

# Context vector dimension — must stay in sync with contextBuilder.ts
D = 9

# Discount factor for non-stationary user behavior adaptation.
# Older observations are exponentially down-weighted before each update.
# 0.995 means ~60% weight remains after 100 updates (0.995^100 ≈ 0.606).
GAMMA = 0.995

# Regularization floor: prevents A matrix diagonal from dropping too low
# after repeated discounting, which would cause numerical instability.
MIN_DIAGONAL = 0.01

ACTIONS: List[str] = [
    "FIVE_SECOND_RULE",
    "POMODORO",
    "BREATHING",
    "VISUALIZATION",
    "REFRAME",
]


class LinUCBArm:
    """Single disjoint LinUCB arm for one (user_id, action) pair."""

    def __init__(self, d: int = D) -> None:
        self.d = d
        self.A = np.identity(d)   # d×d, init to I_d
        self.b = np.zeros(d)      # d,   init to 0
        self.n_updates: int = 0

    # ------------------------------------------------------------------
    # Core LinUCB operations
    # ------------------------------------------------------------------

    def score(self, x: np.ndarray, alpha: float) -> float:
        """
        UCB score: theta^T x + alpha * sqrt(x^T A^{-1} x)
        A higher score means this arm is a better candidate to select.
        """
        A_inv = np.linalg.inv(self.A)
        theta = A_inv @ self.b
        exploitation = float(theta @ x)
        exploration = alpha * float(np.sqrt(x @ A_inv @ x))
        return exploitation + exploration

    def update(self, x: np.ndarray, reward: float) -> None:
        """
        Discounted update with one observed (context, reward) pair.

        Applies gamma discounting BEFORE adding the new observation so that
        older data is down-weighted, allowing the model to adapt to changing
        user behavior (non-stationary bandit).
        """
        # Discount existing knowledge — older observations count less
        self.A = GAMMA * self.A + np.outer(x, x)
        self.b = GAMMA * self.b + reward * x

        # Regularization: prevent diagonal from dropping below MIN_DIAGONAL
        # after repeated discounting (which shrinks A toward zero)
        min_diag = float(np.min(np.diag(self.A)))
        if min_diag < MIN_DIAGONAL:
            self.A += MIN_DIAGONAL * np.eye(len(x))
            logger.debug(
                "Arm regularized: min_diagonal=%.6f was below threshold %.4f",
                min_diag, MIN_DIAGONAL,
            )

        self.n_updates += 1

    # ------------------------------------------------------------------
    # Serialization helpers (for MongoDB storage)
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "A": self.A.flatten().tolist(),   # d*d floats
            "b": self.b.tolist(),             # d floats
            "n_updates": self.n_updates,
        }

    @classmethod
    def from_dict(cls, data: dict, d: int = D) -> "LinUCBArm":
        """
        Deserialize from MongoDB document.

        Migration: if the stored A matrix has a dimension other than d (e.g.
        legacy 12×12 from the old context vector), reinitialize the arm from
        scratch rather than crashing. This allows the system to recover
        gracefully when upgrading from the old 12-element vector.
        """
        # Infer stored dimension from the flattened A array length
        stored_a = data.get("A", [])
        stored_dim = int(round(len(stored_a) ** 0.5)) if stored_a else 0

        if stored_dim != d:
            logger.warning(
                "Reinitialized arm for dimension mismatch "
                "(stored_dim=%d, expected_dim=%d) — starting fresh",
                stored_dim, d,
            )
            return cls(d)

        arm = cls(d)
        arm.A = np.array(data["A"], dtype=float).reshape(d, d)
        arm.b = np.array(data["b"], dtype=float)
        arm.n_updates = int(data.get("n_updates", 0))
        return arm


def select_action(
    arms: dict,          # {action: LinUCBArm}  pre-loaded arms for allowed actions
    x: np.ndarray,
    alpha: float,
) -> str:
    """
    Given a dict of pre-loaded arms and a context vector, return the action
    with the highest UCB score.

    Note: deficit-weighted scoring (ucb * (1 + relevance)) is applied in
    intervention.py before calling this, so arms here already receive
    relevance-adjusted scores via the weighted_arms wrapper pattern.
    """
    best_action: str = ""
    best_score: float = float("-inf")

    for action, arm in arms.items():
        s = arm.score(x, alpha)
        if s > best_score:
            best_score = s
            best_action = action

    return best_action
