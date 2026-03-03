"""Adaptive Time Estimator Component."""

import os
from pathlib import Path
from typing import Any, Dict, List

from app.components.base import ComponentBase


class AdaptiveTimeEstimatorComponent(ComponentBase):
    """
    ComponentBase plugin wrapping the AdaptiveTimeEstimator.

    Provides warm/cold-start time prediction for academic subtasks.
    """

    @property
    def name(self) -> str:
        return "adaptive_time_estimator"

    @property
    def version(self) -> str:
        return "1.0.0"

    @property
    def dependencies(self) -> List[str]:
        return []

    def initialize(self, config: Dict[str, Any]) -> None:
        """Initialize the estimator on startup."""
        self._initialized = False
        self.estimator = None

        model_path = str(Path("./data/models/sbert_model"))
        if "model_path" in config:
            model_path = config["model_path"]

        # Only initialize if MongoDB URI is configured
        if not os.getenv("TASKS_MONGODB_URI"):
            print("[AdaptiveTimeEstimator] TASKS_MONGODB_URI not set — component disabled.")
            self._initialized = True
            return

        try:
            from app.components.adaptive_time_estimator.estimator import AdaptiveTimeEstimator
            self.estimator = AdaptiveTimeEstimator(model_path=model_path)
            self._initialized = True
            print("[AdaptiveTimeEstimator] Component initialized successfully.")
        except Exception as e:
            print(f"[AdaptiveTimeEstimator] Initialization failed: {e}")
            self._initialized = True  # Mark initialized so startup doesn't crash

    def process(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Predict time for a subtask.

        Args:
            data: {subtask_text, user_id, ai_suggested_time}

        Returns:
            Prediction dictionary from AdaptiveTimeEstimator.predict_time()
        """
        if not self.estimator:
            raise RuntimeError("AdaptiveTimeEstimator not available.")

        return self.estimator.predict_time(
            subtask_text=data["subtask_text"],
            user_id=data["user_id"],
            ai_suggested_time=data.get("ai_suggested_time"),
        )

    def get_status(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "initialized": self._initialized,
            "type": "adaptive_time_estimator",
            "estimator_ready": self.estimator is not None,
        }
