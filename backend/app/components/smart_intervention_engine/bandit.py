"""
LinUCB Contextual Bandit — Disjoint model, per-user per-action parameters.

Algorithm (per arm a):
  A_a  : d×d matrix, initialized to I_d
  b_a  : d-vector, initialized to 0

  select:
    theta_a = A_a^{-1} b_a
    score_a = theta_a^T x + alpha * sqrt(x^T A_a^{-1} x)
    pick arm with highest score

  update on reward r:
    A_a += x x^T
    b_a += r x

Parameters are stored in MongoDB (bandit_models collection) and loaded/saved
by main.py on every request. This module is pure numpy — no db access.
"""

import numpy as np
from typing import List

# Must stay in sync with mockContext.ts (d = 12)
D = 12

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
        """Update parameters with one observed (context, reward) pair."""
        self.A += np.outer(x, x)
        self.b += reward * x
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
        arm = cls(d)
        arm.A = np.array(data["A"], dtype=float).reshape(d, d)
        arm.b = np.array(data["b"], dtype=float)
        arm.n_updates = int(data.get("n_updates", 0))
        return arm


def get_allowed_actions(x: List[float]) -> List[str]:
    """
    Filter the action set based on deadline_urgency (x[11]).

    urgency >= 0.7          → FIVE_SECOND_RULE, POMODORO, REFRAME
    0.3 <= urgency < 0.7    → FIVE_SECOND_RULE, POMODORO, REFRAME, BREATHING
    urgency < 0.3           → all five actions
    """
    urgency = float(x[11])
    if urgency >= 0.7:
        return ["FIVE_SECOND_RULE", "POMODORO", "REFRAME"]
    elif urgency >= 0.3:
        return ["FIVE_SECOND_RULE", "POMODORO", "REFRAME", "BREATHING"]
    else:
        return list(ACTIONS)


def select_action(
    arms: dict,          # {action: LinUCBArm}  pre-loaded arms for allowed actions
    x: np.ndarray,
    alpha: float,
) -> str:
    """
    Given a dict of pre-loaded arms and a context vector, return the action
    with the highest UCB score.
    """
    best_action: str = ""
    best_score: float = float("-inf")

    for action, arm in arms.items():
        s = arm.score(x, alpha)
        if s > best_score:
            best_score = s
            best_action = action

    return best_action
