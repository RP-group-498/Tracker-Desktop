"""
Adaptive Time Estimation System
Version: 1.0

Adapted from dynamic-task-prioritization-scheduling for Tracker-Desktop.
Uses TASKS_* env vars instead of generic MongoDB env vars to avoid collision.
"""

from pymongo import MongoClient
from sentence_transformers import SentenceTransformer
import numpy as np
import os
from datetime import datetime


class AdaptiveTimeEstimator:
    """
    Adaptive Time Estimation System
    Predicts task completion time using machine learning.
    """

    def __init__(self, model_path: str = 'data/models/sbert_model'):
        """
        Initialize the estimator.

        Args:
            model_path: Path to SBERT model folder
        """
        print("Initializing Adaptive Time Estimator...")

        # Connect to MongoDB using TASKS_* env vars
        self.client = MongoClient(os.getenv('TASKS_MONGODB_URI'))
        self.db = self.client[os.getenv('TASKS_MONGODB_DATABASE', 'research_task_db')]
        self.tasks = self.db[os.getenv('TASKS_COLLECTION_TASKS', 'tasks')]
        self.patterns = self.db[os.getenv('TASKS_COLLECTION_PATTERNS', 'patterns')]
        self.logs = self.db[os.getenv('TASKS_COLLECTION_TRAINING_LOGS', 'training_logs')]

        # Load SBERT model
        print("   Loading SBERT model...")
        self.model = SentenceTransformer(model_path)

        # Configuration
        self.threshold = 0.65
        self.top_k = 5

        print("Estimator ready!")

    def text_to_vector(self, text):
        """Convert text to vector using SBERT."""
        return self.model.encode(text).tolist()

    def cosine_similarity(self, v1, v2):
        """Calculate similarity between two vectors."""
        v1 = np.array(v1)
        v2 = np.array(v2)

        dot = np.dot(v1, v2)
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)

        if norm1 == 0 or norm2 == 0:
            return 0.0

        return float(dot / (norm1 * norm2))

    def find_similar_tasks(self, text, user_id, threshold=None):
        """Find similar tasks using k-NN."""
        if threshold is None:
            threshold = self.threshold

        new_vector = self.text_to_vector(text)

        completed = list(self.tasks.find({
            "user_id": user_id,
            "status": "completed",
            "estimates.actual_time": {"$ne": None}
        }))

        if not completed:
            return []

        results = []
        for task in completed:
            similarity = self.cosine_similarity(new_vector, task['sub_task']['vector'])

            if similarity >= threshold:
                results.append({
                    'task_description': task['sub_task']['description'],
                    'similarity': similarity,
                    'actual_time': task['estimates']['actual_time'],
                    'category': task['sub_task']['category']
                })

        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results[:self.top_k]

    def warm_start_prediction(self, similar_tasks):
        """Calculate weighted average from similar tasks."""
        if not similar_tasks:
            return None

        total_sim = sum(t['similarity'] for t in similar_tasks)
        weighted_sum = sum(
            (t['similarity'] / total_sim) * t['actual_time']
            for t in similar_tasks
        )

        return round(weighted_sum)

    def predict_time(self, subtask_text, user_id, ai_suggested_time):
        """
        Main prediction function.

        Args:
            subtask_text: Task description
            user_id: Student ID
            ai_suggested_time: AI-provided time suggestion for cold starts

        Returns:
            Dictionary with prediction details
        """
        similar = self.find_similar_tasks(subtask_text, user_id)

        if similar:
            time = self.warm_start_prediction(similar)
            return {
                'method': 'warm_start',
                'predicted_time': time,
                'confidence': 'HIGH',
                'similar_tasks': similar,
                'explanation': f"Based on {len(similar)} similar tasks"
            }
        else:
            return {
                'method': 'cold_start',
                'predicted_time': ai_suggested_time,
                'confidence': 'LOW',
                'similar_tasks': [],
                'explanation': "Based on AI suggestion"
            }

    def save_task(self, main_task, predictions, user_id):
        """Save tasks to database."""
        for pred in predictions:
            doc = {
                "user_id": user_id,
                "main_task": main_task,
                "sub_task": {
                    "description": pred['subtask_text'],
                    "vector": self.text_to_vector(pred['subtask_text']),
                    "category": pred.get('category', 'general'),
                    "position": pred['subtask_number']
                },
                "estimates": {
                    "prediction_method": pred['method'],
                    "system_estimate": pred['predicted_time'],
                    "user_estimate": pred.get('user_estimate', pred['predicted_time']),
                    "actual_time": None,
                    "confidence": pred['confidence']
                },
                "final_mcdm_score": main_task.get('final_mcdm_score'),
                "status": "scheduled",
                "created_date": datetime.now(),
                "time_allocation_date": pred.get('time_allocation_date', None)
            }

            self.tasks.insert_one(doc)

    def mark_complete(self, subtask_desc, user_id, actual_time):
        """Mark task as complete."""
        result = self.tasks.update_one(
            {
                "user_id": user_id,
                "sub_task.description": subtask_desc,
                "status": {"$in": ["scheduled", "in_progress", "paused"]}
            },
            {
                "$set": {
                    "estimates.actual_time": actual_time,
                    "status": "completed",
                    "completed_date": datetime.now()
                }
            }
        )
        return result.modified_count == 1

    def get_accuracy(self, user_id):
        """Get current model accuracy for this user."""
        latest = self.logs.find_one(
            {"user_id": user_id},
            sort=[("training_date", -1)]
        )

        if latest:
            return {
                "mae": latest['metrics']['mae'],
                "accuracy_5min": latest['metrics']['accuracy_within_5min'],
                "training_size": latest['training_size']
            }

        return None
