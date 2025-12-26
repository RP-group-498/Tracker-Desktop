"""Component management endpoints."""

from typing import Dict, Any

from fastapi import APIRouter, HTTPException

from app.core.component_registry import ComponentRegistry

router = APIRouter()


@router.get("")
async def list_components():
    """List all registered components and their status."""
    registry = ComponentRegistry.get_instance()
    return registry.get_all_status()


@router.get("/{name}/status")
async def get_component_status(name: str):
    """Get status of a specific component."""
    registry = ComponentRegistry.get_instance()
    component = registry.get(name)

    if not component:
        raise HTTPException(status_code=404, detail=f"Component '{name}' not found")

    return component.get_status()


@router.post("/{name}/process")
async def process_with_component(name: str, data: Dict[str, Any]):
    """
    Invoke a component's process method directly.

    Useful for testing or manual classification.
    """
    registry = ComponentRegistry.get_instance()
    component = registry.get(name)

    if not component:
        raise HTTPException(status_code=404, detail=f"Component '{name}' not found")

    try:
        result = component.process(data)
        return {"success": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
