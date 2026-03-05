"""Task Prioritization Component — wraps the full MCDM analysis pipeline."""

import datetime
import json
import os
from pathlib import Path
from typing import Any, Dict, List

from app.components.base import ComponentBase


class TaskPrioritizationComponent(ComponentBase):
    """
    ComponentBase plugin for MCDM-based academic task prioritization.

    Accepts PDF or text input, runs Gemini extraction + ML difficulty prediction
    + MCDM scoring, and returns a full task JSON result.
    """

    @property
    def name(self) -> str:
        return "task_prioritization"

    @property
    def version(self) -> str:
        return "1.0.0"

    @property
    def dependencies(self) -> List[str]:
        return []

    def initialize(self, config: Dict[str, Any]) -> None:
        """Load models and prepare pipeline on startup."""
        self._initialized = False
        self._extractor = None
        self._predictor = None
        self._models_dir: Path = Path("./data/models")
        self._outputs_dir: Path = Path("./data/outputs")

        # Allow config overrides
        if "models_dir" in config:
            self._models_dir = Path(config["models_dir"])
        if "outputs_dir" in config:
            self._outputs_dir = Path(config["outputs_dir"])

        # Attempt to load sub-modules — failures are non-fatal
        try:
            from app.components.task_prioritization.pdf_extractor import GeminiPDFExtractor
            self._extractor = GeminiPDFExtractor()
        except Exception as e:
            print(f"[TaskPrioritization] Gemini extractor unavailable: {e}")

        try:
            from app.components.task_prioritization.difficulty_predictor import DifficultyPredictor
            self._predictor = DifficultyPredictor(self._models_dir)
        except Exception as e:
            print(f"[TaskPrioritization] Difficulty predictor unavailable: {e}")

        # Priority DB connection — auto-saves on every PDF analysis (research_task_db)
        # Uses PRIORITY_* vars, separate from TASKS_* (adaptive_time_estimation)
        self._mongodb_uri = os.getenv("PRIORITY_MONGODB_URI", "")
        self._mongodb_database = os.getenv("PRIORITY_MONGODB_DATABASE", "research_task_db")
        self._mongodb_collection = os.getenv("PRIORITY_COLLECTION_TASKS", "tasks")

        self._initialized = True
        print(f"[TaskPrioritization] Component initialized. Extractor: {'OK' if self._extractor else 'MISSING'}, Predictor: {'OK' if self._predictor else 'MISSING'}")

    def process(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run the full MCDM analysis pipeline.

        Args:
            data: {
                pdf_path?: str,
                text_content?: str,
                deadline: str (YYYY-MM-DD),
                credits: int,
                weight: int,
                user_id?: str
            }

        Returns:
            {tasks: [task_json]}
        """
        from app.components.task_prioritization.config import get_extraction_prompt
        from app.components.task_prioritization.mcdm_calculator import (
            calculate_urgency_score, calculate_impact_score,
            calculate_difficulty_score, calculate_final_score, get_priority_label
        )

        deadline_input = data["deadline"]
        credits = int(data["credits"])
        weight = int(data["weight"])

        deadline_date = datetime.datetime.strptime(deadline_input, "%Y-%m-%d").date()
        today = datetime.date.today()
        days_left = (deadline_date - today).days

        today_date_str = today.strftime("%Y-%m-%d")
        prompt = get_extraction_prompt(deadline_input, days_left, credits, weight, today_date_str)

        # Step 1: Extract content
        if not self._extractor:
            raise RuntimeError("Gemini extractor not available. Check GEMINI_API_KEY.")

        if data.get("text_content"):
            raw_json = self._extractor.analyze_text_content(data["text_content"], prompt)
        elif data.get("pdf_path"):
            raw_json = self._extractor.extract_text_from_pdf(data["pdf_path"], prompt)
        else:
            raise ValueError("Either pdf_path or text_content must be provided.")

        # Parse Gemini response
        cleaned = raw_json.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned.split("```json")[1].split("```")[0].strip()
        elif cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1].split("```")[0].strip()
        extracted_data = json.loads(cleaned)

        # Step 2: Difficulty prediction
        task_description = extracted_data.get("task_description", "")
        ai_suggested_difficulty = int(extracted_data.get("ai_suggested_difficulty", 3) or 3)

        if self._predictor:
            ml_difficulty, ml_confidence = self._predictor.predict_difficulty(task_description)
            difficulty_rating = ml_difficulty if ml_confidence >= 50 else ai_suggested_difficulty
        else:
            difficulty_rating = ai_suggested_difficulty

        # Step 3: MCDM calculation
        urgency_score = calculate_urgency_score(days_left)
        impact_score = calculate_impact_score(credits, weight)
        difficulty_score = calculate_difficulty_score(difficulty_rating)
        final_score = calculate_final_score(urgency_score, impact_score, difficulty_score)
        priority_label = get_priority_label(final_score)

        # Step 4: Build result
        import numpy as np

        def _to_native(obj):
            if isinstance(obj, (np.integer, np.floating)):
                return obj.item()
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            elif isinstance(obj, dict):
                return {k: _to_native(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [_to_native(i) for i in obj]
            return obj

        task_data = _to_native({
            "task_name": extracted_data.get("task_name", "Unknown Task"),
            "task_description": extracted_data.get("task_description", ""),
            "sub_tasks": extracted_data.get("sub_tasks", []),
            "context": extracted_data.get("context", ""),
            "ai_suggestions": {
                "ai_suggested_difficulty": ai_suggested_difficulty,
                "ai_suggested_time": float(extracted_data.get("ai_suggested_time") or 0),
            },
            "metrics": {
                "deadline": deadline_input,
                "days_left": int(days_left),
                "credits": int(credits),
                "percentage": int(weight),
                "difficulty_rating": int(difficulty_rating),
            },
            "mcdm_calculation": {
                "urgency_score": float(urgency_score),
                "impact_score": float(impact_score),
                "difficulty_score": float(difficulty_score),
                "final_weighted_score": float(round(final_score, 2)),
            },
            "priority": priority_label,
        })

        # Step 5: Save to outputs dir
        self._outputs_dir.mkdir(parents=True, exist_ok=True)
        output_file = self._outputs_dir / "mcdm_output.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump({"tasks": [task_data]}, f, indent=2, ensure_ascii=False)

        # Step 6: Save to MongoDB (non-fatal)
        if self._mongodb_uri:
            try:
                from pymongo import MongoClient
                client = MongoClient(self._mongodb_uri, serverSelectionTimeoutMS=5000)
                db = client[self._mongodb_database]
                collection = db[self._mongodb_collection]
                import copy
                doc = copy.deepcopy(task_data)
                doc["created_at"] = datetime.datetime.utcnow()
                doc["updated_at"] = datetime.datetime.utcnow()
                collection.insert_one(doc)
                client.close()
            except Exception as e:
                print(f"[TaskPrioritization] MongoDB save skipped: {e}")

        return {"tasks": [task_data]}

    def get_status(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "initialized": self._initialized,
            "type": "task_prioritization",
            "extractor_ready": self._extractor is not None,
            "predictor_ready": self._predictor is not None,
        }
