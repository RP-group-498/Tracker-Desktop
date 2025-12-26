"""Health check endpoint."""

from fastapi import APIRouter
from app.config import settings
from app.core.component_registry import ComponentRegistry

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Health check endpoint.

    Returns backend status, version, and component info.
    Used by Electron to verify backend is running.
    """
    registry = ComponentRegistry.get_instance()
    components = registry.get_all()

    return {
        "status": "healthy",
        "app": settings.app_name,
        "version": settings.app_version,
        "components": {
            name: {
                "version": comp.version,
                "initialized": comp.get_status().get("initialized", False)
            }
            for name, comp in components.items()
        },
        "component_count": len(components),
    }
