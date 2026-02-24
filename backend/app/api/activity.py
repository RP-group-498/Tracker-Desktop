"""Activity event endpoints."""

import asyncio
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.services.user_manager import get_user_manager
from app.services.mongodb_sync import get_mongodb_sync, MongoDBSyncService

from app.core.database import get_db
from app.core.component_registry import ComponentRegistry
from app.models.activity import ActivityEvent, Classification
from app.schemas.activity import (
    ActivityEventCreate,
    ActivityEventResponse,
    ActivityBatchRequest,
    ActivityBatchResponse,
    ClassificationResult,
)

router = APIRouter()


@router.post("/batch", response_model=ActivityBatchResponse)
async def receive_activity_batch(
    batch: ActivityBatchRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Receive a batch of activity events from the browser extension.

    Stores events in the database and classifies them.
    Returns list of received event IDs for acknowledgment.
    """
    received_ids: List[str] = []
    errors: List[str] = []
    mongo_documents: List[dict] = []  # Collect docs for MongoDB sync

    registry = ComponentRegistry.get_instance()
    classifier = registry.get("classification")

    # Get user ID from the user manager
    user_manager = get_user_manager()
    user_id = user_manager.get_user_id() if user_manager else None

    for event_data in batch.events:
        try:
            # Check if event already exists (deduplication)
            result = await db.execute(
                select(ActivityEvent).where(ActivityEvent.event_id == event_data.event_id)
            )
            existing = result.scalar_one_or_none()

            if existing:
                received_ids.append(event_data.event_id)
                continue

            # Create classification
            classification = None
            if classifier:
                try:
                    class_result = classifier.process({
                        "domain": event_data.domain,
                        "url": event_data.url,
                        "title": event_data.title,
                        "active_time": event_data.active_time,
                        "path": event_data.path,
                        # Source identification
                        "source": event_data.source,
                        "activity_type": event_data.activity_type,
                        # Desktop-specific fields
                        "app_name": event_data.app_name,
                        "app_path": event_data.app_path,
                        "window_title": event_data.window_title,
                        # Context (browser only)
                        "youtube_context": event_data.youtube_context.model_dump() if event_data.youtube_context else None,
                        "google_context": event_data.google_context.model_dump() if event_data.google_context else None,
                        "social_context": event_data.social_context.model_dump() if event_data.social_context else None,
                    })

                    classification = Classification(
                        category=class_result["category"],
                        confidence=class_result["confidence"],
                        source=class_result["source"],
                        created_at=datetime.utcnow(),
                    )
                    db.add(classification)
                    await db.flush()  # Get the ID

                except Exception as e:
                    errors.append(f"Classification error for {event_data.event_id}: {str(e)}")

            # Build context_data JSON
            context_data = {}
            if event_data.youtube_context:
                context_data["youtube"] = event_data.youtube_context.model_dump()
            if event_data.google_context:
                context_data["google"] = event_data.google_context.model_dump()
            if event_data.social_context:
                context_data["social"] = event_data.social_context.model_dump()

            # Create activity event
            event = ActivityEvent(
                event_id=event_data.event_id,
                user_id=user_id,
                session_id=event_data.session_id,
                # Source identification
                source=event_data.source,
                activity_type=event_data.activity_type,
                # Timestamps
                timestamp=event_data.timestamp,
                start_time=event_data.start_time,
                end_time=event_data.end_time,
                # URL/Domain info
                url=event_data.url,
                domain=event_data.domain,
                path=event_data.path,
                title=event_data.title,
                # Desktop-specific fields
                app_name=event_data.app_name,
                app_path=event_data.app_path,
                window_title=event_data.window_title,
                # Time tracking
                active_time=event_data.active_time,
                idle_time=event_data.idle_time,
                # Tab info
                tab_id=event_data.tab_id,
                window_id=event_data.window_id,
                is_incognito=event_data.is_incognito,
                # Enrichment data
                url_components=event_data.url_components.model_dump() if event_data.url_components else None,
                title_hints=event_data.title_hints.model_dump() if event_data.title_hints else None,
                engagement=event_data.engagement.model_dump() if event_data.engagement else None,
                context_data=context_data if context_data else None,
                classification_id=classification.id if classification else None,
            )

            db.add(event)
            received_ids.append(event_data.event_id)

            # Build MongoDB document for sync
            class_dict = None
            if classification:
                class_dict = {
                    "category": classification.category,
                    "confidence": classification.confidence,
                    "source": classification.source,
                }

            mongo_doc = MongoDBSyncService.build_document(
                event_data={
                    "event_id": event_data.event_id,
                    "session_id": event_data.session_id,
                    "source": event_data.source,
                    "activity_type": event_data.activity_type,
                    "timestamp": event_data.timestamp,
                    "start_time": event_data.start_time,
                    "end_time": event_data.end_time,
                    "url": event_data.url,
                    "domain": event_data.domain,
                    "path": event_data.path,
                    "title": event_data.title,
                    "app_name": event_data.app_name,
                    "app_path": event_data.app_path,
                    "window_title": event_data.window_title,
                    "active_time": event_data.active_time,
                    "idle_time": event_data.idle_time,
                    "url_components": event_data.url_components.model_dump() if event_data.url_components else None,
                    "title_hints": event_data.title_hints.model_dump() if event_data.title_hints else None,
                    "engagement": event_data.engagement.model_dump() if event_data.engagement else None,
                    "context_data": context_data if context_data else None,
                },
                classification=class_dict,
                user_id=user_id or "",
            )
            mongo_documents.append(mongo_doc)

        except Exception as e:
            errors.append(f"Error processing {event_data.event_id}: {str(e)}")

    await db.commit()

    # Sync to MongoDB in the background (fire-and-forget)
    mongo_sync = get_mongodb_sync()
    if mongo_sync and mongo_documents:
        asyncio.create_task(mongo_sync.sync_batch(mongo_documents))

    return ActivityBatchResponse(
        success=len(errors) == 0,
        received_count=len(received_ids),
        received_ids=received_ids,
        errors=errors if errors else None,
    )


@router.get("/recent", response_model=List[ActivityEventResponse])
async def get_recent_activity(
    limit: int = Query(50, ge=1, le=500),
    session_id: Optional[str] = None,
    domain: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get recent activity events.

    Optionally filter by session_id or domain.
    """
    query = select(ActivityEvent).options(selectinload(ActivityEvent.classification))

    if session_id:
        query = query.where(ActivityEvent.session_id == session_id)

    if domain:
        query = query.where(ActivityEvent.domain.contains(domain))

    query = query.order_by(ActivityEvent.timestamp.desc()).limit(limit)

    result = await db.execute(query)
    events = result.scalars().all()

    return [
        ActivityEventResponse(
            event_id=e.event_id,
            domain=e.domain,
            title=e.title or "",
            active_time=e.active_time,
            timestamp=e.timestamp,
            classification=ClassificationResult(
                category=e.classification.category,
                confidence=e.classification.confidence,
                source=e.classification.source,
            ) if e.classification else None,
        )
        for e in events
    ]


@router.get("/stats")
async def get_activity_stats(
    session_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get activity statistics."""
    query = select(
        func.count(ActivityEvent.id).label("total_events"),
        func.sum(ActivityEvent.active_time).label("total_active_time"),
        func.sum(ActivityEvent.idle_time).label("total_idle_time"),
    )

    if session_id:
        query = query.where(ActivityEvent.session_id == session_id)

    result = await db.execute(query)
    row = result.one()

    # Get category breakdown
    category_query = select(
        Classification.category,
        func.count(ActivityEvent.id).label("count"),
        func.sum(ActivityEvent.active_time).label("time"),
    ).join(ActivityEvent.classification).group_by(Classification.category)

    if session_id:
        category_query = category_query.where(ActivityEvent.session_id == session_id)

    category_result = await db.execute(category_query)
    categories = {r.category: {"count": r.count, "time": r.time or 0} for r in category_result}

    return {
        "total_events": row.total_events or 0,
        "total_active_time": row.total_active_time or 0,
        "total_idle_time": row.total_idle_time or 0,
        "by_category": categories,
    }


@router.get("/user-id")
async def get_current_user_id():
    """Get the current user ID for this machine."""
    user_manager = get_user_manager()
    if not user_manager:
        raise HTTPException(status_code=500, detail="User manager not initialized")
    return {"user_id": user_manager.get_user_id()}


@router.get("/{event_id}", response_model=ActivityEventResponse)
async def get_activity_event(
    event_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific activity event by ID."""
    result = await db.execute(
        select(ActivityEvent)
        .options(selectinload(ActivityEvent.classification))
        .where(ActivityEvent.event_id == event_id)
    )
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    return ActivityEventResponse(
        event_id=event.event_id,
        domain=event.domain,
        title=event.title or "",
        active_time=event.active_time,
        timestamp=event.timestamp,
        classification=ClassificationResult(
            category=event.classification.category,
            confidence=event.classification.confidence,
            source=event.classification.source,
        ) if event.classification else None,
    )
