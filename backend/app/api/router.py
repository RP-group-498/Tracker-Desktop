"""
api/router.py

API router aggregator."""

from fastapi import APIRouter

from .activity import router as activity_router
from .session import router as session_router
from .components import router as components_router
from .health import router as health_router
from .procrastination_analysis import router as mongodb_analysis_router

api_router = APIRouter()

api_router.include_router(health_router, tags=["health"])
api_router.include_router(session_router, prefix="/session", tags=["session"])
api_router.include_router(activity_router, prefix="/activity", tags=["activity"])
api_router.include_router(components_router, prefix="/components", tags=["components"])
# api_router.include_router(procrastination_router, prefix="/procrastination", tags=["procrastination"])
api_router.include_router(mongodb_analysis_router, prefix="/analysis", tags=["analysis"])
