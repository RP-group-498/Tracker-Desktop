"""API router aggregator."""

from fastapi import APIRouter

from .activity import router as activity_router
from .session import router as session_router
from .components import router as components_router
from .health import router as health_router

api_router = APIRouter()

api_router.include_router(health_router, tags=["health"])
api_router.include_router(session_router, prefix="/session", tags=["session"])
api_router.include_router(activity_router, prefix="/activity", tags=["activity"])
api_router.include_router(components_router, prefix="/components", tags=["components"])
