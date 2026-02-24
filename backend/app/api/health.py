"""Health check endpoint."""

from fastapi import APIRouter
from app.config import settings
from app.core.component_registry import ComponentRegistry
from app.services.user_manager import get_user_manager
from app.services.mongodb_sync import get_mongodb_sync

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Health check endpoint.

    Returns backend status, version, component info, MongoDB sync status,
    and the current user ID.
    Used by Electron to verify backend is running.
    """
    registry = ComponentRegistry.get_instance()
    components = registry.get_all()

    # MongoDB sync status
    mongo_sync = get_mongodb_sync()
    mongodb_status = {
        "enabled": settings.mongodb_sync_enabled,
        "connected": mongo_sync.is_connected if mongo_sync else False,
        "pending_retries": mongo_sync.pending_count if mongo_sync else 0,
    }

    # User ID
    user_manager = get_user_manager()
    user_id = user_manager.get_user_id() if user_manager else None

    return {
        "status": "healthy",
        "app": settings.app_name,
        "version": settings.app_version,
        "user_id": user_id,
        "mongodb_sync": mongodb_status,
        "components": {
            name: {
                "version": comp.version,
                "initialized": comp.get_status().get("initialized", False)
            }
            for name, comp in components.items()
        },
        "component_count": len(components),
    }
