"""
/core/database.py
MongoDB database connection and management.
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import AsyncGenerator
from app.config import settings

class DatabaseConfig:
    client: AsyncIOMotorClient = None
    db: AsyncIOMotorDatabase = None

db_config = DatabaseConfig()

async def init_db() -> None:
    """Initialize MongoDB connection."""
    if not settings.mongodb_uri:
        print("[Database] WARNING: MONGODB_URI not configured in .env")
        return
        
    db_config.client = AsyncIOMotorClient(settings.mongodb_uri)
    db_config.db = db_config.client[settings.mongodb_database]
    
    # Create indexes for frequently queried fields
    await db_config.db.activity_events.create_index("event_id", unique=True)
    await db_config.db.activity_events.create_index("user_id")
    await db_config.db.activity_events.create_index("timestamp")
    await db_config.db.browser_sessions.create_index("session_id", unique=True)
    
    print(f"[Database] Connected to MongoDB database: {settings.mongodb_database}")

async def close_db() -> None:
    """Close MongoDB connection."""
    if db_config.client:
        db_config.client.close()
        print("[Database] MongoDB connection closed")

async def get_db() -> AsyncGenerator[AsyncIOMotorDatabase, None]:
    """Dependency that provides the MongoDB database instance."""
    if db_config.db is None:
        raise Exception("Database is not initialized. Call init_db() first.")
    yield db_config.db
