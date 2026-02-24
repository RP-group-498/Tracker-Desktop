"""Application configuration settings."""

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

    # Component configuration
    component_config: dict = {}

    # Paths
    data_dir: Path = Path("./data")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

# Ensure data directory exists
settings.data_dir.mkdir(parents=True, exist_ok=True)
