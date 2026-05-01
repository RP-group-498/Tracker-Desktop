"""Background worker for batch processing Gemini classifications."""

import asyncio
import logging
from datetime import datetime
from pymongo import UpdateOne

from app.core.database import db_config
from app.components import ComponentRegistry

logger = logging.getLogger(__name__)

# Batch size limit for Gemini API prompts
MAX_BATCH_SIZE = 50
# Interval between runs (seconds), e.g., 4 minutes
POLL_INTERVAL = 1800


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

        db = db_config.db
        if db is None:
            return

        # Find activities linked to pending_ai classifications
        cursor = db.activity_events.find({"classification.source": "pending_ai"}).limit(MAX_BATCH_SIZE)
        pending_events = await cursor.to_list(length=MAX_BATCH_SIZE)
        
        if not pending_events:
            return
            
        logger.info(f"[GeminiBatchWorker] Processing batch of {len(pending_events)} pending items")
        
        # Prepare items for Gemini
        items_to_classify = []
        for event in pending_events:
            items_to_classify.append({
                "id": event["event_id"],
                "domain": event.get("domain", ""),
                "title": event.get("title") or event.get("window_title") or "",
                "url": event.get("url", "")
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
        bulk_operations = []
        for event in pending_events:
            event_id = event["event_id"]
            result_map = batch_results.get(event_id)
            
            if not result_map:
                continue
                
            bulk_operations.append(
                UpdateOne(
                    {"event_id": event_id},
                    {"$set": {
                        "classification.category": result_map["category"],
                        "classification.confidence": result_map["confidence"],
                        "classification.source": "gemini"
                    }}
                )
            )

        if bulk_operations:
            await db.activity_events.bulk_write(bulk_operations)
            logger.info(f"[GeminiBatchWorker] Successfully updated {len(bulk_operations)} items directly in MongoDB")


# Global instance
_worker = GeminiBatchWorker()

def start_gemini_worker():
    """Start the global Gemini batch worker."""
    _worker.start()

def stop_gemini_worker():
    """Stop the global Gemini batch worker."""
    _worker.stop()
