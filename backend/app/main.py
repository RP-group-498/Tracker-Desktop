"""
Focus App Backend - FastAPI Entry Point

This is the main entry point for the Python backend.
It initializes the database, loads components, and serves the REST API.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core.database import init_db, close_db
from app.components import load_all_components
from app.api import api_router
from app.services.user_manager import init_user_manager
from app.services.mongodb_sync import init_mongodb_sync


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
        await mongo_sync.initialize(settings.mongodb_uri, settings.mongodb_database)
        print("[Backend] MongoDB sync enabled")
    else:
        print("[Backend] MongoDB sync disabled (no URI configured or sync not enabled)")

    print("[Backend] Ready to accept connections")

    yield

    # Shutdown
    print("[Backend] Shutting down...")
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
