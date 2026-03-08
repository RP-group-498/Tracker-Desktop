"""Application configuration settings."""

from dotenv import load_dotenv
load_dotenv()  # Ensure .env is in os.environ before pydantic reads it

from pydantic_settings import BaseSettings
from pathlib import Path
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    app_name: str = "Focus App Backend"
    app_version: str = "1.0.0"
    debug: bool = False

    # Database
    database_url: str = "sqlite+aiosqlite:///./data/focusapp.db"

    # MongoDB (for research team sync)
    mongodb_uri: str = ""  # e.g. "mongodb+srv://user:pass@cluster.mongodb.net/"
    mongodb_database: str = "focus_app_research"
    mongodb_sync_enabled: bool = False  # Enable when URI is configured

    # User identification
    user_id: str = ""  # Auto-generated on first run if empty

    # API
    api_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:*", "http://127.0.0.1:*"]

    # Task Prioritization — Gemini API
    gemini_api_key: str = ""

    # Priority DB — auto-saved on every PDF analysis, write-once (research_task_db)
    priority_mongodb_uri: str = ""
    priority_mongodb_database: str = "research_task_db"
    priority_collection_tasks: str = "tasks"

    # Adaptive Time Estimation DB — saved only on "Save All Tasks" click
    tasks_mongodb_uri: str = ""
    tasks_mongodb_database: str = "adaptive_time_estimation"
    tasks_collection_tasks: str = "completed_tasks"
    tasks_collection_patterns: str = "patterns"
    tasks_collection_training_logs: str = "training_logs"

    # Smart Intervention Engine DB
    intervention_mongodb_uri: str = ""
    intervention_mongodb_database: str = "intervention_db"

    # APDIS MongoDB (active time predictions)
    apdis_mongodb_uri: str = ""
    apdis_database_name: str = ""
    apdis_collection_active_time: str = ""

    # Scheduler (active_time_sync — runs in background on startup)
    api_base_url: str = "http://localhost:8000/api/tasks"
    scheduler_time: str = "21:09"
    scheduler_users: str = "user_003,user_001"

    # Component configuration
    component_config: dict = {
        "classification": {
            "ml": {
                "enabled": True,  # Enable ML classification layer
                "model_type": "zero_shot",  # "zero_shot" or "embeddings"
                "lazy_loading": True,  # Load model on first use (faster startup)
                "zero_shot": {
                    "model_name": "facebook/bart-large-mnli",
                    "device": "cpu",  # "cpu" or "cuda" (if GPU available)
                    "confidence_threshold": 0.80,  # Minimum confidence for ML (below this → Gemini)
                },
            }
        },
        "task_prioritization": {
            "gemini_model": "gemini-2.5-flash",
            "mcdm_weights": {"urgency": 0.50, "impact": 0.30, "difficulty": 0.20}
        },
        "adaptive_time_estimator": {
            "threshold": 0.65,
            "top_k": 5
        }
    }

    # Paths
    data_dir: Path = Path("./data")
    models_dir: Path = Path("./data/models")
    raw_data_dir: Path = Path("./data/raw")
    outputs_dir: Path = Path("./data/outputs")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

# Ensure data directories exist
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.models_dir.mkdir(parents=True, exist_ok=True)
settings.raw_data_dir.mkdir(parents=True, exist_ok=True)
settings.outputs_dir.mkdir(parents=True, exist_ok=True)
