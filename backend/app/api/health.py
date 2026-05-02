"""Health check endpoint."""

from fastapi import APIRouter
from app.config import settings
from app.core.component_registry import ComponentRegistry
from app.core.database import db_config
from app.api.deps import get_current_user
from fastapi import Depends
from typing import Dict, Any

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Health check endpoint.

    Returns backend status, version, component info, MongoDB status,
    and the current user ID.
    Used by Electron to verify backend is running.
    """
    registry = ComponentRegistry.get_instance()
    components = registry.get_all()

    # MongoDB status
    mongodb_status = {
        "connected": db_config.db is not None
    }

    # User ID
    user_id = None

    return {
        "status": "healthy",
        "app": settings.app_name,
        "version": settings.app_version,
        "user_id": user_id,
        "mongodb": mongodb_status,
        "components": {
            name: {
                "version": comp.version,
                "initialized": comp.get_status().get("initialized", False)
            }
            for name, comp in components.items()
        },
        "component_count": len(components),
    }
