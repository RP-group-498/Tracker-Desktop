"""
api/intervention.py

FastAPI router for the Smart Intervention Engine.
Ports all endpoints from component3/backend/main.py, using
settings.intervention_mongodb_uri instead of a hardcoded connection string.
"""

import asyncio
import time
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException

from app.components.smart_intervention_engine.bandit import (
    LinUCBArm,
    get_allowed_actions,
    select_action,
    ACTIONS,
)
from app.components.smart_intervention_engine.schemas import (
    BanditSelectRequest,
    BanditSelectResponse,
    BanditUpdateRequest,
    MotivationLogEntry,
    UserGoal,
)
from app.config import settings

router = APIRouter()

# ---------------------------------------------------------------------------
# MongoDB client — only created when a URI is configured
# ---------------------------------------------------------------------------

_client = None
_db = None


def _get_db():
    global _client, _db
    if _db is not None:
        return _db
    if not settings.intervention_mongodb_uri:
        raise HTTPException(
            status_code=503,
            detail="Intervention MongoDB URI not configured. Set INTERVENTION_MONGODB_URI in .env",
        )
    import motor.motor_asyncio
    _client = motor.motor_asyncio.AsyncIOMotorClient(settings.intervention_mongodb_uri)
    _db = _client[settings.intervention_mongodb_database]
    return _db


# ---------------------------------------------------------------------------
# Arm persistence helpers
# ---------------------------------------------------------------------------


async def _load_arm(user_id: str, action: str) -> LinUCBArm:
    db = _get_db()
    doc = await db.bandit_models.find_one(
        {"user_id": user_id, "action": action},
        {"_id": 0},
    )
    if doc:
        return LinUCBArm.from_dict(doc)
    return LinUCBArm()


async def _save_arm(user_id: str, action: str, arm: LinUCBArm) -> None:
    db = _get_db()
    payload = arm.to_dict()
    payload["user_id"] = user_id
    payload["action"] = action
    payload["updated_at"] = time.time()
    await db.bandit_models.update_one(
        {"user_id": user_id, "action": action},
        {"$set": payload},
        upsert=True,
    )


# ---------------------------------------------------------------------------
# User goal endpoints
# ---------------------------------------------------------------------------


@router.get("/user/goal")
async def get_user_goal():
    db = _get_db()
    user = await db.User.find_one({"type": "settings"})
    if user:
        return {"life_goal": user.get("life_goal", "")}
    return {"life_goal": ""}


@router.post("/user/goal")
async def set_user_goal(goal: UserGoal):
    db = _get_db()
    await db.User.update_one(
        {"type": "settings"},
        {"$set": {"life_goal": goal.life_goal}},
        upsert=True,
    )
    return {"status": "success"}


# ---------------------------------------------------------------------------
# Bandit endpoints
# ---------------------------------------------------------------------------


@router.post("/bandit/select", response_model=BanditSelectResponse)
async def bandit_select(req: BanditSelectRequest):
    """Select the best intervention given the user's context vector."""
    if len(req.x) != 12:
        raise HTTPException(
            status_code=400, detail="Context vector must have exactly 12 elements."
        )

    allowed = get_allowed_actions(req.x)
    x = np.array(req.x, dtype=float)

    arms_list = await asyncio.gather(*[_load_arm(req.user_id, a) for a in allowed])
    arms = dict(zip(allowed, arms_list))

    action = select_action(arms, x, req.alpha)
    return BanditSelectResponse(action=action, allowed_actions=allowed)


@router.post("/bandit/update")
async def bandit_update(req: BanditUpdateRequest):
    """Update the LinUCB model after observing a user reward."""
    if len(req.x) != 12:
        raise HTTPException(
            status_code=400, detail="Context vector must have exactly 12 elements."
        )

    if req.action not in ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")

    x = np.array(req.x, dtype=float)
    arm = await _load_arm(req.user_id, req.action)
    arm.update(x, req.reward)
    await _save_arm(req.user_id, req.action, arm)

    db = _get_db()
    await db.bandit_events.insert_one({
        "user_id": req.user_id,
        "context": req.x,
        "action": req.action,
        "reward": req.reward,
        "button": req.button,
        "alpha": req.alpha,
        "n_updates_after": arm.n_updates,
        "timestamp": time.time(),
    })

    return {"status": "ok", "n_updates": arm.n_updates}


@router.get("/bandit/events")
async def bandit_events(user_id: str):
    """Return all logged bandit events for a user (most recent first)."""
    db = _get_db()
    cursor = db.bandit_events.find(
        {"user_id": user_id},
        {"_id": 0},
    ).sort("timestamp", -1).limit(100)
    return await cursor.to_list(length=100)


# ---------------------------------------------------------------------------
# Motivation history endpoints
# ---------------------------------------------------------------------------


@router.post("/motivation/log")
async def log_motivation(entry: MotivationLogEntry):
    """Store a motivation snapshot for the user."""
    db = _get_db()
    await db.motivation_logs.insert_one({
        "user_id": entry.user_id,
        "motivation": entry.motivation,
        "scenario": entry.scenario,
        "timestamp": entry.timestamp if entry.timestamp is not None else time.time(),
    })
    return {"status": "ok"}


@router.get("/motivation/history")
async def motivation_history(user_id: str, since: float = 3600.0):
    """
    Return motivation snapshots within the last `since` seconds.
    Sorted oldest-first for left-to-right chart rendering.
    """
    db = _get_db()
    cutoff = time.time() - since
    cursor = db.motivation_logs.find(
        {"user_id": user_id, "timestamp": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("timestamp", 1).limit(500)
    return await cursor.to_list(length=500)
