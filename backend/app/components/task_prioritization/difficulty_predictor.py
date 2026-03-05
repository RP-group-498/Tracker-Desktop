"""ML-based difficulty prediction for assignment tasks using v2 model."""

import pickle
from pathlib import Path
from typing import Optional, Tuple


class DifficultyPredictor:
    """Predicts task difficulty using trained ML model (v2 - Sentence Transformers + XGBoost)."""

    def __init__(self, models_dir: Path):
        """
        Initialize the difficulty predictor by loading v2 ML model.

        Args:
            models_dir: Path to the models directory containing difficulty_predictor_v2.pkl
        """
        self.models_dir = models_dir
        self.sbert_model = None
        self.xgboost_classifier = None
        self.difficulty_map = None
        self.model_info = {}
        self.loaded = False

        try:
            self._load_model()
            self.loaded = True
            print("=" * 80)
            print("[OK] ML difficulty model v2 loaded successfully.")
            print(f"    Model Version: {self.model_info.get('model_version', 'Unknown')}")
            print(f"    Test Accuracy: {self.model_info.get('test_accuracy', 0):.2%}")
            print(f"    Train Accuracy: {self.model_info.get('train_accuracy', 0):.2%}")
            print(f"    Trained on: {self.model_info.get('trained_on', 'N/A')} samples")
            print("=" * 80)
        except Exception as e:
            print(f"Warning: Could not load ML model v2: {e}")
            print("Will use default difficulty estimation.")

    def _load_model(self):
        """Load the trained v2 model from pickle file."""
        model_path = self.models_dir / "difficulty_predictor_v2.pkl"

        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found: {model_path}")

        print(f"Loading v2 model from: {model_path}")
        with open(model_path, "rb") as f:
            model_dict = pickle.load(f)

        self.sbert_model = model_dict['sbert_model']
        self.xgboost_classifier = model_dict['xgboost_judge']

        self.difficulty_map = model_dict.get('difficulty_map', {0: 'Easy', 1: 'Medium', 2: 'Hard'})

        self.class_to_score = {
            0: 1,  # Easy = 1
            1: 3,  # Medium = 3
            2: 5   # Hard = 5
        }

        self.model_info = {
            'model_version': model_dict.get('model_version', 'v2'),
            'test_accuracy': model_dict.get('test_accuracy', 0.0),
            'train_accuracy': model_dict.get('train_accuracy', 0.0),
            'trained_on': model_dict.get('trained_on', 'N/A'),
            'dataset_info': model_dict.get('dataset_info', {})
        }

    def predict_difficulty(self, task_description: str, fallback: int = 3) -> Tuple[int, float]:
        """
        Predict difficulty rating from task description text using v2 model.

        Args:
            task_description: The text description of the task
            fallback: Default difficulty if model not loaded (1-5)

        Returns:
            Tuple of (difficulty_rating (1-5), confidence_percentage (0-100))
        """
        if not self.loaded or not task_description.strip():
            print(f"  > Using fallback difficulty: {fallback}")
            return fallback, 0.0

        try:
            embeddings = self.sbert_model.encode([task_description])

            prediction_class = self.xgboost_classifier.predict(embeddings)[0]
            probabilities = self.xgboost_classifier.predict_proba(embeddings)[0]

            difficulty_label = self.difficulty_map.get(prediction_class, 'Medium')
            difficulty_score = self.class_to_score.get(prediction_class, fallback)
            confidence = max(probabilities) * 100

            print(f"\nDifficulty Prediction: {difficulty_label} (Score: {difficulty_score}/5), Confidence: {confidence:.1f}%")

            return difficulty_score, float(confidence)

        except Exception as e:
            print(f"Error during prediction: {e}")
            return fallback, 0.0
