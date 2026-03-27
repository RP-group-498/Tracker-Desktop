"""
api/intervention.py

FastAPI router for the Smart Intervention Engine.
Ports all endpoints from component3/backend/main.py, using
settings.intervention_mongodb_uri instead of a hardcoded connection string.
"""

import asyncio
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user

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
async def get_user_goal(current_user: Dict[str, Any] = Depends(get_current_user)):
    db = _get_db()
    user = await db.User.find_one({"type": "settings", "user_id": current_user["sub"]})
    if user:
        return {"life_goal": user.get("life_goal", "")}
    return {"life_goal": ""}


@router.post("/user/goal")
async def set_user_goal(goal: UserGoal, current_user: Dict[str, Any] = Depends(get_current_user)):
    db = _get_db()
    await db.User.update_one(
        {"type": "settings", "user_id": current_user["sub"]},
        {"$set": {"life_goal": goal.life_goal}},
        upsert=True,
    )
    return {"status": "success"}


# ---------------------------------------------------------------------------
# Bandit endpoints
# ---------------------------------------------------------------------------


@router.post("/bandit/select", response_model=BanditSelectResponse)
async def bandit_select(req: BanditSelectRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Select the best intervention given the user's context vector."""
    if len(req.x) != 12:
        raise HTTPException(
            status_code=400, detail="Context vector must have exactly 12 elements."
        )

    allowed = get_allowed_actions(req.x)
    x = np.array(req.x, dtype=float)

    user_id = current_user["sub"]
    arms_list = await asyncio.gather(*[_load_arm(user_id, a) for a in allowed])
    arms = dict(zip(allowed, arms_list))

    print(f"[Bandit Select] User: {user_id}")
    print(f"[Bandit Select] Context Vector: {req.x}")
    print(f"[Bandit Select] Allowed Actions: {allowed}")

    action = select_action(arms, x, req.alpha)
    
    print(f"[Bandit Select] Selected Action: {action}")

    return BanditSelectResponse(action=action, allowed_actions=allowed)


@router.post("/bandit/update")
async def bandit_update(req: BanditUpdateRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Update the LinUCB model after observing a user reward."""
    if len(req.x) != 12:
        raise HTTPException(
            status_code=400, detail="Context vector must have exactly 12 elements."
        )

    if req.action not in ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")

    user_id = current_user["sub"]
    
    print(f"[Bandit Update] User: {user_id}, Action: {req.action}, Reward: {req.reward}")
    print(f"[Bandit Update] Context Vector: {req.x}")
    x = np.array(req.x, dtype=float)
    arm = await _load_arm(user_id, req.action)
    arm.update(x, req.reward)
    await _save_arm(user_id, req.action, arm)

    db = _get_db()
    await db.bandit_events.insert_one({
        "user_id": user_id,
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
async def bandit_events(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Return all logged bandit events for the current user (most recent first)."""
    db = _get_db()
    cursor = db.bandit_events.find(
        {"user_id": current_user["sub"]},
        {"_id": 0},
    ).sort("timestamp", -1).limit(100)
    return await cursor.to_list(length=100)


# ---------------------------------------------------------------------------
# Motivation history endpoints
# ---------------------------------------------------------------------------


@router.post("/motivation/log")
async def log_motivation(entry: MotivationLogEntry, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Store a motivation snapshot for the user."""
    db = _get_db()
    await db.motivation_logs.insert_one({
        "user_id": current_user["sub"],
        "motivation": entry.motivation,
        "scenario": entry.scenario,
        "timestamp": entry.timestamp if entry.timestamp is not None else time.time(),
    })
    return {"status": "ok"}


@router.get("/context")
async def get_context(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Fetch raw context signals for the current user from Component 1 and Component 4.
    """
    import motor.motor_asyncio
    user_id = current_user["sub"]

    _default = {
        "total_transitions": 0,
        "non_academic_transitions": 0,
        "completed_tasks_last_7_days": 0,
        "assigned_tasks_last_7_days": 0,
        "task_priority": 0.0,
        "grade_weight_normalized": 0.0,
        "time_spent_on_task": 0.0,
        "assigned_time": 0.0,
        "task_deadline_time": None,
        "recent_completion_boost": 0.0,
        "has_data": False,
    }

    result = dict(_default)

    # ── Component 1: focus_app_research / active_time ────────────────────────
    if settings.mongodb_uri:
        try:
            c1_client = motor.motor_asyncio.AsyncIOMotorClient(settings.mongodb_uri)
            c1_db = c1_client[settings.mongodb_database]
            today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            doc = await c1_db.active_time.find_one(
                {"userId": user_id, "date": today_str},
                {"_id": 0, "totalAppSwitches": 1, "nonAcademicAppSwitches": 1},
            )
            if doc:
                result["total_transitions"] = int(doc.get("totalAppSwitches", 0) or 0)
                result["non_academic_transitions"] = int(doc.get("nonAcademicAppSwitches", 0) or 0)
                result["has_data"] = True
        except Exception:
            pass

    # ── Component 4: adaptive_time_estimation / completed_tasks ─────────────
    if settings.tasks_mongodb_uri:
        try:
            c4_client = motor.motor_asyncio.AsyncIOMotorClient(settings.tasks_mongodb_uri)
            c4_db = c4_client[settings.tasks_mongodb_database]
            collection = c4_db[settings.tasks_collection_tasks]

            def _parse_deadline(d):
                if d is None:
                    return None
                if isinstance(d, datetime):
                    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
                if isinstance(d, str):
                    try:
                        dt = datetime.fromisoformat(d.replace("Z", "+00:00"))
                        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
                    except Exception:
                        return None
                return None

            from datetime import timedelta

            now = datetime.now(timezone.utc)
            seven_days_ago = now - timedelta(days=7)
            thirty_min_ago = now - timedelta(minutes=30)

            # Fetch tasks with date fields for proper 7-day filtering
            all_tasks = await collection.find(
                {"user_id": user_id},
                {"_id": 0, "status": 1, "deadline": 1,
                 "created_date": 1, "completed_date": 1},
            ).to_list(length=1000)

            # Count tasks created or completed in the last 7 days
            def _in_last_7_days(t):
                cd = t.get("created_date")
                if isinstance(cd, datetime):
                    return cd.replace(tzinfo=timezone.utc) >= seven_days_ago if cd.tzinfo is None else cd >= seven_days_ago
                return True  # include tasks without created_date for backward compat

            recent_tasks = [t for t in all_tasks if _in_last_7_days(t)]

            def _completed_recently(t):
                if t.get("status") != "completed":
                    return False
                cd = t.get("completed_date")
                if isinstance(cd, datetime):
                    cd_aware = cd.replace(tzinfo=timezone.utc) if cd.tzinfo is None else cd
                    return cd_aware >= seven_days_ago
                # Fallback: count completed tasks without completed_date
                return True

            result["completed_tasks_last_7_days"] = sum(
                1 for t in all_tasks if _completed_recently(t)
            )
            result["assigned_tasks_last_7_days"] = len(recent_tasks)

            # Completion boost: count tasks completed in the last 30 minutes
            recently_completed = sum(
                1 for t in all_tasks
                if t.get("status") == "completed"
                and isinstance(t.get("completed_date"), datetime)
                and (t["completed_date"].replace(tzinfo=timezone.utc)
                     if t["completed_date"].tzinfo is None
                     else t["completed_date"]) >= thirty_min_ago
            )
            # Each recent completion adds a 0.1 boost (capped at 0.3)
            result["recent_completion_boost"] = min(recently_completed * 0.1, 0.3)

            # Find current task: nearest upcoming (or most recently overdue) scheduled task
            scheduled_tasks = await collection.find(
                {"user_id": user_id, "status": "scheduled"},
                {
                    "_id": 0,
                    "priority": 1,
                    "weight": 1,
                    "credits": 1,
                    "estimates": 1,
                    "deadline": 1,
                },
            ).to_list(length=500)

            if scheduled_tasks:
                def _deadline_sort_key(t):
                    d = _parse_deadline(t.get("deadline"))
                    if d is None:
                        return (2, 0)
                    diff = (d - now).total_seconds()
                    if diff >= 0:
                        return (0, diff)   # upcoming: prefer nearest
                    return (1, -diff)      # overdue: prefer most recent

                current = sorted(scheduled_tasks, key=_deadline_sort_key)[0]

                priority_map = {"high": 1.0, "medium": 0.6, "low": 0.3}
                raw_priority = str(current.get("priority", "")).strip().lower()
                result["task_priority"] = priority_map.get(raw_priority, 0.3)

                raw_weight = current.get("weight") or current.get("credits") or 0
                try:
                    result["grade_weight_normalized"] = min(float(raw_weight) / 100.0, 1.0)
                except (TypeError, ValueError):
                    result["grade_weight_normalized"] = 0.0

                estimates = current.get("estimates") or {}
                result["time_spent_on_task"] = float(estimates.get("actual_time") or 0)
                user_est = estimates.get("user_estimate")
                sys_est = estimates.get("system_estimate")
                result["assigned_time"] = float(user_est if user_est else (sys_est or 0))

                deadline_dt = _parse_deadline(current.get("deadline"))
                result["task_deadline_time"] = deadline_dt.isoformat() if deadline_dt else None

                result["has_data"] = True
        except Exception:
            pass

    return result


@router.get("/motivation/history")
async def motivation_history(since: float = 3600.0, current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Return motivation snapshots within the last `since` seconds.
    Sorted oldest-first for left-to-right chart rendering.
    """
    db = _get_db()
    cutoff = time.time() - since
    cursor = db.motivation_logs.find(
        {"user_id": current_user["sub"], "timestamp": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("timestamp", 1).limit(500)
    return await cursor.to_list(length=500)


@router.post("/reframe-text")
async def generate_reframe_text(goal: UserGoal, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Generate a short reframing notification text using Gemini AI based on user goal."""
    try:
        import google.generativeai as genai
        # settings is available in the module scope
        if not settings.gemini_api_key:
            return {"text": f"I choose to do this because it helps me {goal.life_goal}."}
        
        genai.configure(api_key=settings.gemini_api_key)
        
        # Use a minimal prompt for short generation
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = f"Write a very short, encouraging, and highly personal 1-sentence notification reminding the user to reframe their task because it helps them achieve their life goal: '{goal.life_goal}'. Make it a first-person statement, e.g. 'I choose to do this because it helps me...'. Make it no more than 15 words."
        
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        # Remove markdown quotes or formatting if any
        text = text.replace('"', '').replace("'", '').replace('*', '').strip()
        
        return {"text": text}
    except Exception as e:
        print(f"[Intervention] AI Reframe Error: {e}")
        return {"text": f"I choose to do this because it helps me {goal.life_goal}."}
