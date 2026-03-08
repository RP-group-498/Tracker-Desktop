"""

/main.py
Focus App Backend - FastAPI Entry Point

This is the main entry point for the Python backend.
It initializes the database, loads components, and serves the REST API.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file BEFORE any other imports so all modules see the env vars.
# Resolve relative to this file → backend/.env
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core.database import init_db, close_db
from app.components import load_all_components
from app.api import api_router
from app.services.user_manager import init_user_manager
from app.services.mongodb_sync import init_mongodb_sync
from services.scheduler.active_time_sync import start_scheduler, stop_scheduler
from app.services.gemini_batch_worker import start_gemini_worker, stop_gemini_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    print(f"[Backend] Starting {settings.app_name} v{settings.app_version}")
    await init_db()
    load_all_components(settings.component_config)

    # Initialize user manager
    user_manager = init_user_manager(settings.data_dir)
    print(f"[Backend] User ID: {user_manager.get_user_id()}")

    # Initialize MongoDB sync if configured
    mongo_sync = None
    if settings.mongodb_uri and settings.mongodb_sync_enabled:
        mongo_sync = init_mongodb_sync()

        async def init_mongo():
            try:
                await mongo_sync.initialize(settings.mongodb_uri, settings.mongodb_database)
                print("[Backend] MongoDB sync enabled")
            except Exception as e:
                print("[MongoSync] Initialization failed:", e)

        asyncio.create_task(init_mongo())
    else:
        print("[Backend] MongoDB sync disabled (no URI configured or sync not enabled)")

    # Start background scheduler (daily active time sync + task allocation)
    start_scheduler()

    # Start Gemini Batch Worker
    start_gemini_worker()

    print("[Backend] Ready to accept connections")

    yield

    # Shutdown
    print("[Backend] Shutting down...")
    stop_gemini_worker()
    stop_scheduler()
    if mongo_sync:
        await mongo_sync.close()
    await close_db()
    print("[Backend] Goodbye!")


# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Backend API for procrastination detection desktop application",
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix=settings.api_prefix)


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint - basic info."""
    return {
        "app": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "health": f"{settings.api_prefix}/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
