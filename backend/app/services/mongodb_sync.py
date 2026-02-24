"""MongoDB sync service for uploading activity data to Atlas.

This service mirrors every activity event written to SQLite into a
shared MongoDB Atlas instance so the research team can access the data
for the procrastination detection engine.

Design principles:
- SQLite remains the primary local store; MongoDB is an async mirror.
- If MongoDB is unreachable, data is still safely in SQLite.
- Failed syncs are queued and retried automatically.
- Writes are fire-and-forget — they never block the API response.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

# Module-level singleton
_mongodb_sync: "MongoDBSyncService | None" = None


class MongoDBSyncService:
    """Async service for syncing activity events to MongoDB Atlas."""

    COLLECTION_NAME = "activity_events"
    RETRY_INTERVAL_SECONDS = 60
    MAX_RETRY_BATCH = 100

    def __init__(self) -> None:
        self._client: AsyncIOMotorClient | None = None
        self._db: AsyncIOMotorDatabase | None = None
        self._connected: bool = False
        self._retry_queue: list[dict[str, Any]] = []
        self._retry_task: asyncio.Task | None = None

    async def initialize(self, uri: str, db_name: str) -> None:
        """Connect to MongoDB Atlas and set up indexes."""
        try:
            self._client = AsyncIOMotorClient(uri)
            # Verify connection with a ping
            await self._client.admin.command("ping")
            self._db = self._client[db_name]

            # Create indexes for efficient querying
            collection = self._db[self.COLLECTION_NAME]
            await collection.create_index("event_id", unique=True)
            await collection.create_index("user_id")
            await collection.create_index("timestamp")
            await collection.create_index("domain")
            await collection.create_index("source")
            await collection.create_index([("user_id", 1), ("timestamp", -1)])

            self._connected = True
            print(f"[MongoSync] Connected to MongoDB Atlas, database: {db_name}")

            # Start retry loop
            self._retry_task = asyncio.create_task(self._retry_loop())

        except Exception as e:
            print(f"[MongoSync] Failed to connect to MongoDB: {e}")
            self._connected = False

    @property
    def is_connected(self) -> bool:
        """Whether the service is currently connected to MongoDB."""
        return self._connected

    @property
    def pending_count(self) -> int:
        """Number of documents waiting in the retry queue."""
        return len(self._retry_queue)

    async def sync_activity_event(self, document: dict[str, Any]) -> bool:
        """Sync a single activity event document to MongoDB.

        Args:
            document: A fully formed MongoDB document (see build_document).

        Returns:
            True if the document was synced, False if it was queued for retry.
        """
        if not self._connected or self._db is None:
            self._retry_queue.append(document)
            return False

        try:
            collection = self._db[self.COLLECTION_NAME]
            await collection.update_one(
                {"event_id": document["event_id"]},
                {"$set": document},
                upsert=True,
            )
            return True

        except Exception as e:
            print(f"[MongoSync] Failed to sync event {document.get('event_id')}: {e}")
            self._retry_queue.append(document)
            return False

    async def sync_batch(self, documents: list[dict[str, Any]]) -> dict[str, Any]:
        """Sync a batch of activity event documents to MongoDB.

        Args:
            documents: List of fully formed MongoDB documents.

        Returns:
            Dict with 'synced' count and 'failed' count.
        """
        if not documents:
            return {"synced": 0, "failed": 0}

        if not self._connected or self._db is None:
            self._retry_queue.extend(documents)
            return {"synced": 0, "failed": len(documents)}

        synced = 0
        failed = 0

        try:
            collection = self._db[self.COLLECTION_NAME]
            from pymongo import UpdateOne

            operations = [
                UpdateOne(
                    {"event_id": doc["event_id"]},
                    {"$set": doc},
                    upsert=True,
                )
                for doc in documents
            ]

            result = await collection.bulk_write(operations, ordered=False)
            synced = result.upserted_count + result.modified_count
            failed = len(documents) - synced
            print(f"[MongoSync] Batch synced: {synced} succeeded, {failed} failed")

        except Exception as e:
            print(f"[MongoSync] Batch sync error: {e}")
            self._retry_queue.extend(documents)
            failed = len(documents)

        return {"synced": synced, "failed": failed}

    async def _retry_loop(self) -> None:
        """Background loop to retry failed syncs."""
        while True:
            await asyncio.sleep(self.RETRY_INTERVAL_SECONDS)

            if not self._retry_queue or not self._connected:
                continue

            # Take a batch from the queue
            batch = self._retry_queue[: self.MAX_RETRY_BATCH]
            self._retry_queue = self._retry_queue[self.MAX_RETRY_BATCH :]

            print(f"[MongoSync] Retrying {len(batch)} failed documents...")

            try:
                # Try to reconnect if needed
                if self._client:
                    await self._client.admin.command("ping")
                    self._connected = True
            except Exception:
                self._connected = False
                self._retry_queue = batch + self._retry_queue
                print("[MongoSync] Still disconnected, will retry later")
                continue

            result = await self.sync_batch(batch)
            if result["failed"] > 0:
                print(f"[MongoSync] {result['failed']} documents still failing")

    async def close(self) -> None:
        """Close the MongoDB connection."""
        if self._retry_task:
            self._retry_task.cancel()
            try:
                await self._retry_task
            except asyncio.CancelledError:
                pass

        if self._client:
            self._client.close()
            self._connected = False
            print("[MongoSync] Connection closed")

    @staticmethod
    def build_document(
        event_data: dict[str, Any],
        classification: dict[str, Any] | None,
        user_id: str,
    ) -> dict[str, Any]:
        """Build a MongoDB document from event data.

        This is a static helper that converts the incoming API data
        into the flat document format stored in MongoDB.

        Args:
            event_data: Dict of event fields (from Pydantic model).
            classification: Classification result dict or None.
            user_id: User identifier string.

        Returns:
            A dict ready for MongoDB insertion.
        """
        doc: dict[str, Any] = {
            "event_id": event_data["event_id"],
            "user_id": user_id,
            "session_id": event_data.get("session_id"),
            "source": event_data.get("source", "browser"),
            "activity_type": event_data.get("activity_type", "webpage"),
            "timestamp": event_data.get("timestamp"),
            "start_time": event_data.get("start_time"),
            "end_time": event_data.get("end_time"),
            "url": event_data.get("url", ""),
            "domain": event_data.get("domain", ""),
            "path": event_data.get("path", ""),
            "title": event_data.get("title", ""),
            # Desktop-specific
            "app_name": event_data.get("app_name"),
            "app_path": event_data.get("app_path"),
            "window_title": event_data.get("window_title"),
            # Time tracking
            "active_time": event_data.get("active_time", 0),
            "idle_time": event_data.get("idle_time", 0),
            # Classification (embedded)
            "classification": classification,
            # Enrichment data (embedded)
            "enrichment": {
                "url_components": event_data.get("url_components"),
                "title_hints": event_data.get("title_hints"),
                "engagement": event_data.get("engagement"),
                "context_data": event_data.get("context_data"),
            },
            "synced_at": datetime.now(timezone.utc),
        }
        return doc


def init_mongodb_sync() -> MongoDBSyncService:
    """Create and return a new MongoDBSyncService instance."""
    global _mongodb_sync
    _mongodb_sync = MongoDBSyncService()
    return _mongodb_sync


def get_mongodb_sync() -> "MongoDBSyncService | None":
    """Get the global MongoDB sync service instance."""
    return _mongodb_sync
