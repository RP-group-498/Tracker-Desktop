"""Background worker for batch processing Gemini classifications."""

import asyncio
import logging
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session_maker
from app.models.activity import ActivityEvent, Classification
from app.components import ComponentRegistry
from app.services.mongodb_sync import get_mongodb_sync, MongoDBSyncService

logger = logging.getLogger(__name__)

# Batch size limit for Gemini API prompts
MAX_BATCH_SIZE = 50
# Interval between runs (seconds), e.g., 4 minutes
POLL_INTERVAL = 240


class GeminiBatchWorker:
    """Worker that periodically processes pending AI classifications."""

    def __init__(self):
        self._running = False
        self._task = None
        self._registry = ComponentRegistry.get_instance()

    def start(self):
        """Start the background worker."""
        if self._running:
            return
            
        self._running = True
        self._task = asyncio.create_task(self._process_loop())
        logger.info(f"[GeminiBatchWorker] Started with {POLL_INTERVAL}s interval")

    def stop(self):
        """Stop the background worker."""
        self._running = False
        if self._task:
            self._task.cancel()
        logger.info("[GeminiBatchWorker] Stopped")

    async def _process_loop(self):
        """Main processing loop."""
        while self._running:
            try:
                # Wait first to give the app time to start up
                await asyncio.sleep(POLL_INTERVAL)
                await self._process_pending_batch()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[GeminiBatchWorker] Error in process loop: {e}")
                # Wait a bit longer on error to prevent tight loops
                await asyncio.sleep(60)

    async def _process_pending_batch(self):
        """Process a single batch of pending classifications."""
        classifier = self._registry.get("classification")
        if not classifier:
            return

        gemini = classifier.get_gemini_classifier()
        if not gemini:
            return
            
        if not gemini._initialized:
            try:
                gemini.initialize()
            except Exception as e:
                logger.error(f"[GeminiBatchWorker] Failed to initialize Gemini classifier: {e}")
                
        if not gemini._initialized:
            logger.warning("[GeminiBatchWorker] Gemini not initialized, skipping batch")
            return

        async with async_session_maker() as db:
            # Find activities linked to pending_ai classifications
            query = (
                select(ActivityEvent)
                .join(Classification, ActivityEvent.classification_id == Classification.id)
                .where(Classification.source == "pending_ai")
                .limit(MAX_BATCH_SIZE)
            )
            
            result = await db.execute(query)
            pending_events = result.scalars().all()
            
            if not pending_events:
                return
                
            logger.info(f"[GeminiBatchWorker] Processing batch of {len(pending_events)} pending items")
            
            # Prepare items for Gemini
            items_to_classify = []
            for event in pending_events:
                items_to_classify.append({
                    "id": str(event.id),  # Use ActivityEvent ID to map back
                    "domain": event.domain,
                    "title": event.title or event.window_title or "",
                    "url": event.url
                })
                
            # Call Gemini
            try:
                batch_results = gemini.classify_batch(items_to_classify)
            except Exception as e:
                logger.error(f"[GeminiBatchWorker] API call failed: {e}")
                batch_results = None
                
            if not batch_results:
                logger.warning("[GeminiBatchWorker] Batch classification returned no results")
                return
                
            # Update database
            updated_events = []
            for event in pending_events:
                event_id_str = str(event.id)
                result_map = batch_results.get(event_id_str)
                
                if not result_map:
                    continue
                    
                # We need to fetch the actual classification record and update it
                class_record = await db.get(Classification, event.classification_id)
                if class_record:
                    class_record.category = result_map["category"]
                    class_record.confidence = result_map["confidence"]
                    class_record.source = "gemini"
                    # Add explanation to db if we wanted (not in schema currently)
                    updated_events.append((event, class_record))

            await db.commit()
            logger.info(f"[GeminiBatchWorker] Successfully updated {len(updated_events)} items")
            
            # Sync to MongoDB if necessary
            mongo_sync = get_mongodb_sync()
            if mongo_sync and updated_events:
                mongo_docs = []
                for event, class_record in updated_events:
                    class_dict = {
                        "category": class_record.category,
                        "confidence": class_record.confidence,
                        "source": class_record.source,
                    }
                    
                    # Basic mapping for mongo. Only updating classification for existing doc
                    # MongoDB sync currently relies on full doc insertion. Since we are updating, 
                    # we should send an update or re-sync the whole event.
                    # The current mongo sync creates the doc from scratch.
                    context_data = event.context_data or {}
                    
                    doc = MongoDBSyncService.build_document(
                        event_data={
                            "event_id": event.event_id,
                            "session_id": event.session_id,
                            "source": event.source,
                            "activity_type": event.activity_type,
                            "timestamp": event.timestamp,
                            "start_time": event.start_time,
                            "end_time": event.end_time,
                            "url": event.url,
                            "domain": event.domain,
                            "path": event.path,
                            "title": event.title,
                            "app_name": event.app_name,
                            "app_path": event.app_path,
                            "window_title": event.window_title,
                            "active_time": event.active_time,
                            "idle_time": event.idle_time,
                            "url_components": event.url_components,
                            "title_hints": event.title_hints,
                            "engagement": event.engagement,
                            "context_data": context_data,
                        },
                        classification=class_dict,
                        user_id=event.user_id or "",
                    )
                    mongo_docs.append(doc)
                
                asyncio.create_task(mongo_sync.sync_batch(mongo_docs))

# Global instance
_worker = GeminiBatchWorker()

def start_gemini_worker():
    """Start the global Gemini batch worker."""
    _worker.start()

def stop_gemini_worker():
    """Stop the global Gemini batch worker."""
    _worker.stop()
