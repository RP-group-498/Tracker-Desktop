"""Activity event endpoints."""

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.core.component_registry import ComponentRegistry
from app.models.activity import ActivityEvent, Classification
from app.schemas.activity import (
    ActivityEventResponse,
    ActivityBatchRequest,
    ActivityBatchResponse,
    ClassificationResult,
    IdleActivityRequest,
    IdleActivityResponse,
    ActivityStatsResponse
)
from app.api.deps import get_current_user

router = APIRouter()


@router.post("/batch", response_model=ActivityBatchResponse)
async def receive_activity_batch(
    batch: ActivityBatchRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Receive a batch of activity events from the browser extension.
    Stores events directly in MongoDB and classifies them.
    """
    received_ids: List[str] = []
    errors: List[str] = []

    registry = ComponentRegistry.get_instance()
    classifier = registry.get("classification")
    user_id = current_user.get("sub")

    for event_data in batch.events:
        try:
            # Check if event already exists (deduplication)
            existing = await db.activity_events.find_one({"event_id": event_data.event_id})
            if existing:
                received_ids.append(event_data.event_id)
                continue

            # Classify
            classification_data = None
            if classifier:
                try:
                    class_result = classifier.process({
                        "domain": event_data.domain,
                        "url": event_data.url,
                        "title": event_data.title,
                        "active_time": event_data.active_time,
                        "path": event_data.path,
                        "source": event_data.source,
                        "activity_type": event_data.activity_type,
                        "app_name": event_data.app_name,
                        "app_path": event_data.app_path,
                        "window_title": event_data.window_title,
                        "youtube_context": event_data.youtube_context.model_dump(by_alias=True) if event_data.youtube_context else None,
                        "google_context": event_data.google_context.model_dump(by_alias=True) if event_data.google_context else None,
                        "social_context": event_data.social_context.model_dump(by_alias=True) if event_data.social_context else None,
                    })

                    classification_data = Classification(
                        category=class_result["category"],
                        confidence=class_result["confidence"],
                        source=class_result["source"],
                        created_at=datetime.utcnow()
                    )
                except Exception as e:
                    errors.append(f"Classification error for {event_data.event_id}: {str(e)}")

            # Build context_data JSON
            context_data = {}
            if event_data.youtube_context:
                context_data["youtube"] = event_data.youtube_context.model_dump(by_alias=True)
            if event_data.google_context:
                context_data["google"] = event_data.google_context.model_dump(by_alias=True)
            if event_data.social_context:
                context_data["social"] = event_data.social_context.model_dump(by_alias=True)

            # Calculate active_time if it's 0 but we have start/end times
            active_time = event_data.active_time
            if not active_time and event_data.start_time and event_data.end_time:
                delta = event_data.end_time - event_data.start_time
                active_time = int(delta.total_seconds() * 1000)

            # Create activity event Pydantic model
            event = ActivityEvent(
                event_id=event_data.event_id,
                user_id=user_id,
                session_id=event_data.session_id,
                source=event_data.source,
                activity_type=event_data.activity_type,
                timestamp=event_data.timestamp,
                start_time=event_data.start_time,
                end_time=event_data.end_time,
                url=event_data.url,
                domain=event_data.domain,
                path=event_data.path,
                title=event_data.title,
                app_name=event_data.app_name,
                app_path=event_data.app_path,
                window_title=event_data.window_title,
                active_time=active_time,
                idle_time=event_data.idle_time,
                tab_id=event_data.tab_id,
                window_id=event_data.window_id,
                is_incognito=event_data.is_incognito,
                url_components=event_data.url_components.model_dump() if event_data.url_components else None,
                title_hints=event_data.title_hints.model_dump() if event_data.title_hints else None,
                engagement=event_data.engagement.model_dump() if event_data.engagement else None,
                context_data=context_data if context_data else None,
                classification=classification_data
            )

            # Insert into MongoDB
            await db.activity_events.insert_one(event.model_dump())
            received_ids.append(event_data.event_id)

        except Exception as e:
            errors.append(f"Error processing {event_data.event_id}: {str(e)}")

    return ActivityBatchResponse(
        success=len(errors) == 0,
        received_count=len(received_ids),
        received_ids=received_ids,
        errors=errors if errors else None,
    )


@router.get("", response_model=List[ActivityEventResponse])
async def get_recent_activity(
    limit: int = Query(50, ge=1, le=500),
    session_id: Optional[str] = None,
    domain: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get recent activity events."""
    query = {"user_id": current_user["sub"]}
    
    if session_id:
        query["session_id"] = session_id
    if domain:
        query["domain"] = {"$regex": domain, "$options": "i"}

    cursor = db.activity_events.find(query).sort("timestamp", -1).limit(limit)
    events = await cursor.to_list(length=limit)

    return [
        ActivityEventResponse(
            event_id=e["event_id"],
            domain=e["domain"],
            title=e.get("title", ""),
            active_time=e["active_time"],
            timestamp=e["timestamp"],
            classification=ClassificationResult(
                category=e["classification"]["category"],
                confidence=e["classification"]["confidence"],
                source=e["classification"]["source"],
            ) if e.get("classification") else None,
        )
        for e in events
    ]


@router.get("/current-session", response_model=Optional[ActivityEventResponse])
async def get_current_session(
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get the most recent active session activity."""
    event = await db.activity_events.find_one(
        {"user_id": current_user["sub"]}, 
        sort=[("timestamp", -1)]
    )

    if not event:
        return None

    return ActivityEventResponse(
        event_id=event["event_id"],
        domain=event["domain"],
        title=event.get("title", ""),
        active_time=event["active_time"],
        timestamp=event["timestamp"],
        classification=ClassificationResult(
            category=event["classification"]["category"],
            confidence=event["classification"]["confidence"],
            source=event["classification"]["source"],
        ) if event.get("classification") else None,
    )


@router.get("/stream", response_model=List[ActivityEventResponse])
async def get_event_stream(
    minutes: int = Query(30, ge=1),
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get event stream for the last X minutes."""
    time_threshold = datetime.utcnow() - timedelta(minutes=minutes)
    
    query = {
        "user_id": current_user["sub"],
        "timestamp": {"$gte": time_threshold}
    }
    
    cursor = db.activity_events.find(query).sort("timestamp", -1)
    events = await cursor.to_list(length=1000)

    return [
        ActivityEventResponse(
            event_id=e["event_id"],
            domain=e["domain"],
            title=e.get("title", ""),
            active_time=e["active_time"],
            timestamp=e["timestamp"],
            classification=ClassificationResult(
                category=e["classification"]["category"],
                confidence=e["classification"]["confidence"],
                source=e["classification"]["source"],
            ) if e.get("classification") else None,
        )
        for e in events
    ]


@router.get("/today", response_model=List[ActivityEventResponse])
async def get_today_activity(
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get all activity events for the current day (SLST timezone)."""
    now_utc = datetime.utcnow()
    # Calculate SLST time (+5:30)
    now_slst = now_utc + timedelta(hours=5, minutes=30)
    # Start of day in SLST
    start_of_day_slst = datetime(now_slst.year, now_slst.month, now_slst.day)
    # Convert start of day SLST back to UTC for querying
    start_of_day_utc = start_of_day_slst - timedelta(hours=5, minutes=30)
    
    query = {
        "user_id": current_user["sub"],
        "timestamp": {"$gte": start_of_day_utc}
    }
    
    cursor = db.activity_events.find(query).sort("timestamp", -1)
    events = await cursor.to_list(length=5000)

    return [
        ActivityEventResponse(
            event_id=e["event_id"],
            domain=e["domain"],
            title=e.get("title", ""),
            active_time=e["active_time"],
            timestamp=e["timestamp"],
            classification=ClassificationResult(
                category=e["classification"]["category"],
                confidence=e["classification"]["confidence"],
                source=e["classification"]["source"],
            ) if e.get("classification") else None,
        )
        for e in events
    ]


@router.get("/stats", response_model=ActivityStatsResponse)
async def get_activity_stats(
    session_id: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get activity statistics."""
    match_query = {"user_id": current_user["sub"]}
    if session_id:
        match_query["session_id"] = session_id

    pipeline = [
        {"$match": match_query},
        {"$group": {
            "_id": None,
            "total_events": {"$sum": 1},
            "total_active_time": {"$sum": "$active_time"},
            "total_idle_time": {"$sum": "$idle_time"}
        }}
    ]
    
    summary_cursor = db.activity_events.aggregate(pipeline)
    summary = await summary_cursor.to_list(length=1)
    
    if not summary:
        return {
            "total_events": 0,
            "total_active_time": 0,
            "total_idle_time": 0,
            "by_category": {},
        }
        
    stats = summary[0]
    
    # Category breakdown
    category_pipeline = [
        {"$match": match_query},
        {"$match": {"classification": {"$exists": True, "$ne": None}}},
        {"$group": {
            "_id": "$classification.category",
            "count": {"$sum": 1},
            "time": {"$sum": "$active_time"}
        }}
    ]
    
    cat_cursor = db.activity_events.aggregate(category_pipeline)
    cat_results = await cat_cursor.to_list(length=100)
    
    categories = {
        r["_id"]: {"count": r["count"], "time": r.get("time", 0)} 
        for r in cat_results if r["_id"]
    }

    return {
        "total_events": stats.get("total_events", 0),
        "total_active_time": stats.get("total_active_time", 0),
        "total_idle_time": stats.get("total_idle_time", 0),
        "by_category": categories,
    }


@router.get("/user", response_model=dict)
async def get_current_user_id(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get the current user ID for this machine."""
    return {"user_id": current_user["sub"]}


@router.post("/idle", response_model=IdleActivityResponse)
async def submit_idle_activity(
    data: IdleActivityRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Record what the user was doing during an idle period."""
    try:
        registry = ComponentRegistry.get_instance()
        classifier = registry.get("classification")

        class_result = None
        if classifier:
            class_result = classifier.classify_idle_activity(
                activity_id=data.activity_id,
                custom_label=data.custom_label,
            )

        user_id = current_user.get("sub")
        event_id = str(uuid.uuid4())
        activity_title = data.custom_label or data.activity_id or "idle"

        classification_data = None
        if class_result:
            classification_data = Classification(
                category=class_result["category"],
                confidence=class_result["confidence"],
                source=class_result["source"],
                created_at=datetime.utcnow(),
            )

        event = ActivityEvent(
            event_id=event_id,
            user_id=user_id,
            source="idle_report",
            activity_type="offline",
            timestamp=data.idle_end,
            start_time=data.idle_start,
            end_time=data.idle_end,
            url=f"idle://{data.activity_id or 'custom'}",
            domain="idle",
            path="",
            title=activity_title,
            app_name=None,
            app_path=None,
            window_title=activity_title,
            active_time=data.idle_duration_ms,
            idle_time=0,
            classification=classification_data
        )

        await db.activity_events.insert_one(event.model_dump())

        return IdleActivityResponse(
            success=True,
            event_id=event_id,
            category=class_result["category"] if class_result else None,
        )

    except Exception as e:
        return IdleActivityResponse(
            success=False,
            error=str(e),
        )

@router.get("/{event_id}", response_model=ActivityEventResponse)
async def get_activity_event(
    event_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get a specific activity event by ID."""
    event = await db.activity_events.find_one({"event_id": event_id, "user_id": current_user["sub"]})

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    return ActivityEventResponse(
        event_id=event["event_id"],
        domain=event["domain"],
        title=event.get("title", ""),
        active_time=event["active_time"],
        timestamp=event["timestamp"],
        classification=ClassificationResult(
            category=event["classification"]["category"],
            confidence=event["classification"]["confidence"],
            source=event["classification"]["source"],
        ) if event.get("classification") else None,
    )
