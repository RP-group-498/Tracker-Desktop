"""
api/intervention.py

FastAPI router for the Smart Intervention Engine.
Ports all endpoints from component3/backend/main.py, using
settings.intervention_mongodb_uri instead of a hardcoded connection string.

Bandit architecture:
  - Context: 7-element TMT-grounded vector [bias, E, V, I, D, M, deficit_code]
  - Selection: Deficit-weighted LinUCB — ucb_score * (1 + relevance)
  - Update: Discounted LinUCB (GAMMA = 0.995) for non-stationary adaptation
  - Logging: Full TMT traceability per bandit event
"""

import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
import motor.motor_asyncio

from app.api.deps import get_current_user

from app.components.smart_intervention_engine.bandit import (
    LinUCBArm,
    select_action,
    ACTIONS,
    GAMMA,
)
from app.components.smart_intervention_engine.tmt_alignment import (
    compute_relevance_scores,
    ACTIONS as TMT_ACTIONS,
)
from app.components.smart_intervention_engine.schemas import (
    BanditSelectRequest,
    BanditSelectResponse,
    BanditUpdateRequest,
    MotivationLogEntry,
    UserGoal,
)
from app.components.PatternDetection.utils_datetime import get_effective_active_time_date, _coerce_datetime
from app.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# Deficit component labels for logging
_DEFICIT_LABELS = ["expectancy", "value", "impulsiveness", "delay"]

# ---------------------------------------------------------------------------
# MongoDB clients — created once and reused across requests
# ---------------------------------------------------------------------------

_client = None
_db = None
_c1_client = None
_c1_db = None
_c4_client = None
_c4_db = None


def _get_db():
    global _client, _db
    if _db is not None:
        return _db
    if not settings.intervention_mongodb_uri:
        raise HTTPException(
            status_code=503,
            detail="Intervention MongoDB URI not configured. Set INTERVENTION_MONGODB_URI in .env",
        )
    
    _client = motor.motor_asyncio.AsyncIOMotorClient(settings.intervention_mongodb_uri)
    _db = _client[settings.intervention_mongodb_database]
    return _db


def _get_c1_db():
    global _c1_client, _c1_db
    if _c1_db is not None:
        return _c1_db
    if not settings.mongodb_uri:
        return None
    _c1_client = motor.motor_asyncio.AsyncIOMotorClient(settings.mongodb_uri)
    _c1_db = _c1_client[settings.mongodb_database]
    return _c1_db


def _get_c4_db():
    global _c4_client, _c4_db
    if _c4_db is not None:
        return _c4_db
    if not settings.tasks_mongodb_uri:
        return None
    _c4_client = motor.motor_asyncio.AsyncIOMotorClient(settings.tasks_mongodb_uri)
    _c4_db = _c4_client[settings.tasks_mongodb_database]
    return _c4_db


# ---------------------------------------------------------------------------
# Sliding window helper for two-speed TMT
# ---------------------------------------------------------------------------


async def _fetch_sliding_window(c1_db, user_id: str, now_utc: datetime) -> dict:
    """Query activity_events for recent sliding-window behavioral signals.

    Returns metrics over the last 5–10 minutes that make the TMT motivation
    score reactive to real-time behavior (two-speed TMT).
    """
    window_10min = now_utc - timedelta(minutes=10)
    window_5min = now_utc - timedelta(minutes=5)

    # Fetch events from the last 10 minutes (reuses readers.py query pattern)
    docs_10min = await (
        c1_db["activity_events"]
        .find(
            {"user_id": user_id, "start_time": {"$gte": window_10min, "$lt": now_utc}},
            {"_id": 0, "start_time": 1, "app_name": 1, "domain": 1, "classification": 1},
        )
        .sort("start_time", 1)
        .to_list(length=500)
    )

    # Count app switches in the 5-minute window
    app_switches_5min = 0
    prev_app = None
    for doc in docs_10min:
        app_id = doc.get("app_name") or doc.get("domain") or ""
        raw_start = doc.get("start_time")
        start_dt = _coerce_datetime(raw_start)
        if start_dt and start_dt >= window_5min:
            if prev_app is not None and app_id != prev_app:
                app_switches_5min += 1
        prev_app = app_id

    # Count non-academic events in the 10-minute window
    non_academic_switches_10min = 0
    for doc in docs_10min:
        raw_cat = (doc.get("classification") or {}).get("category", "").strip().lower()
        if raw_cat not in ("academic", "productivity", "productive"):
            non_academic_switches_10min += 1

    # Find seconds since last academic activity
    last_academic_doc = await (
        c1_db["activity_events"]
        .find(
            {"user_id": user_id, "classification.category": "academic"},
            {"_id": 0, "start_time": 1},
        )
        .sort("start_time", -1)
        .limit(1)
        .to_list(length=1)
    )

    seconds_since_last_academic = None
    if last_academic_doc:
        last_acad_time = _coerce_datetime(last_academic_doc[0].get("start_time"))
        if last_acad_time:
            seconds_since_last_academic = (now_utc - last_acad_time).total_seconds()

    return {
        "app_switches_5min": app_switches_5min,
        "non_academic_switches_10min": non_academic_switches_10min,
        "total_events_10min": len(docs_10min),
        "seconds_since_last_academic": seconds_since_last_academic,
        "window_has_data": len(docs_10min) > 0,
    }


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


def _extract_tmt_components(x: List[float]) -> tuple:
    """
    Extract TMT proxy values and compute deficit scores from context vector.

    Returns (E, V, I, D, deficit_E, deficit_V, deficit_I, deficit_D, dominant_deficit)
    """
    E = x[1]
    V = x[2]
    I = x[3]
    D = x[4]

    deficit_E = 1.0 - E
    deficit_V = 1.0 - V
    deficit_I = I
    deficit_D = D

    deficits = [deficit_E, deficit_V, deficit_I, deficit_D]
    dominant_index = int(np.argmax(deficits))
    dominant_deficit = _DEFICIT_LABELS[dominant_index]

    return E, V, I, D, deficit_E, deficit_V, deficit_I, deficit_D, dominant_deficit


def _to_behavior_stage(motivation: float, impulsiveness: float) -> str:
    """
    Human-readable behavior stage for logs.
    Helps interpret motivation + distraction into a quick state label.
    """
    if motivation < 0.40:
        return "high-risk procrastination"
    if impulsiveness > 0.50 and motivation < 0.60:
        return "distraction-driven drift"
    if motivation < 0.70:
        return "fragile engagement"
    return "stable focus"


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
    """
    Select the best intervention using deficit-weighted LinUCB.

    Selection process:
      1. Extract TMT proxies from context vector
      2. Compute deficit scores (distance from ideal state)
      3. Compute relevance scores via TMT alignment matrix
      4. Compute LinUCB UCB scores for each action
      5. Weight: weighted_score = ucb_score * (1 + relevance)
         - When deficits are uniform, LinUCB personalization dominates
         - When deficits are skewed, relevance steers toward theory-grounded choices
         - (1 + relevance) ensures no action is completely zeroed out
      6. Return action with highest weighted score
    """
    if len(req.x) != 7:
        raise HTTPException(
            status_code=400, detail="Context vector must have exactly 7 elements."
        )

    user_id = current_user["sub"]
    x = np.array(req.x, dtype=float)

    # Extract TMT components and compute deficits
    E, V, I, D, deficit_E, deficit_V, deficit_I, deficit_D, dominant_deficit = _extract_tmt_components(req.x)

    # Compute relevance scores from TMT alignment matrix
    relevance = compute_relevance_scores(deficit_E, deficit_V, deficit_I, deficit_D)

    # Load all arms in parallel
    arms_list = await asyncio.gather(*[_load_arm(user_id, a) for a in TMT_ACTIONS])
    arms_map = dict(zip(TMT_ACTIONS, arms_list))

    # Deficit-weighted selection: UCB score * (1 + relevance)
    best_action = ""
    best_score = float("-inf")
    ucb_scores_dict: Dict[str, float] = {}
    weighted_scores_dict: Dict[str, float] = {}

    for action in TMT_ACTIONS:
        arm = arms_map[action]
        ucb_score = arm.score(x, req.alpha)
        weighted_score = ucb_score * (1.0 + relevance[action])
        ucb_scores_dict[action] = ucb_score
        weighted_scores_dict[action] = weighted_score
        if weighted_score > best_score:
            best_score = weighted_score
            best_action = action

    # Summarize ranking quality (winner vs runner-up) for explainability.
    ranking = sorted(weighted_scores_dict.items(), key=lambda kv: kv[1], reverse=True)
    second_action, second_score = (ranking[1] if len(ranking) > 1 else ("N/A", float("nan")))
    margin = float(best_score - second_score) if second_action != "N/A" else float("nan")
    motivation = float(req.x[5])
    behavior_stage = _to_behavior_stage(motivation, I)
    logger.info(
        "[Behavior Select] user=%s stage=%s dominant_deficit=%s "
        "M=%.3f I=%.3f E=%.3f V=%.3f D=%.3f "
        "selected=%s score=%.4f runner_up=%s score=%.4f margin=%.4f",
        user_id,
        behavior_stage,
        dominant_deficit,
        motivation,
        I,
        E,
        V,
        D,
        best_action,
        best_score,
        second_action,
        second_score,
        margin,
    )

    db = _get_db()
    await db.bandit_selections.insert_one({
        "user_id": user_id,
        "context": req.x,
        "selected_action": best_action,
        "alpha": req.alpha,
        "tmt_proxies": {"E": E, "V": V, "I": I, "D": D},
        "dominant_deficit": dominant_deficit,
        "relevance_scores": relevance,
        "ucb_scores": ucb_scores_dict,
        "weighted_scores": weighted_scores_dict,
        "timestamp": time.time(),
    })

    return BanditSelectResponse(action=best_action, allowed_actions=list(TMT_ACTIONS))


@router.post("/bandit/update")
async def bandit_update(req: BanditUpdateRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Update the discounted LinUCB model after observing a user reward."""
    if len(req.x) != 7:
        raise HTTPException(
            status_code=400, detail="Context vector must have exactly 7 elements."
        )

    if req.action not in ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")

    user_id = current_user["sub"]

    # Extract TMT components for logging and event storage
    E, V, I, D, deficit_E, deficit_V, deficit_I, deficit_D, dominant_deficit = _extract_tmt_components(req.x)
    relevance = compute_relevance_scores(deficit_E, deficit_V, deficit_I, deficit_D)

    x = np.array(req.x, dtype=float)
    arm = await _load_arm(user_id, req.action)

    # Snapshot parameters so logs can describe learning impact for this response.
    A_before = arm.A.copy()
    b_before = arm.b.copy()
    n_updates_before = arm.n_updates
    theta_before = np.linalg.inv(A_before) @ b_before
    expected_reward_before = float(theta_before @ x)

    arm.update(x, req.reward)

    A_after = arm.A
    b_after = arm.b
    n_updates_after = arm.n_updates
    theta_after = np.linalg.inv(A_after) @ b_after
    expected_reward_after = float(theta_after @ x)

    # Compact learning diagnostics (no large matrix dumps).
    delta_A_fro = float(np.linalg.norm(A_after - A_before, ord="fro"))
    delta_b_norm = float(np.linalg.norm(b_after - b_before))
    expected_reward_delta = expected_reward_after - expected_reward_before
    motivation = float(req.x[5])
    behavior_stage = _to_behavior_stage(motivation, I)
    logger.info(
        "[Behavior Update] user=%s action=%s response=%s reward=%.2f "
        "stage=%s dominant_deficit=%s M=%.3f I=%.3f "
        "expected_reward_for_state %.4f->%.4f (Δ=%.4f) "
        "model_shift Δ||A||F=%.6f Δ||b||=%.6f n_updates=%d->%d",
        user_id,
        req.action,
        req.button,
        req.reward,
        behavior_stage,
        dominant_deficit,
        motivation,
        I,
        expected_reward_before,
        expected_reward_after,
        expected_reward_delta,
        delta_A_fro,
        delta_b_norm,
        n_updates_before,
        n_updates_after,
    )
    await _save_arm(user_id, req.action, arm)

    db = _get_db()
    await db.bandit_events.insert_one({
        "user_id": user_id,
        "context": req.x,
        "action": req.action,
        "reward": req.reward,
        "button": req.button,
        "alpha": req.alpha,
        "gamma": GAMMA,
        "relevance_scores": relevance,
        "dominant_deficit": dominant_deficit,
        "tmt_proxies": {"E": E, "V": V, "I": I, "D": D},
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
    doc = {
        "user_id": current_user["sub"],
        "motivation": entry.motivation,
        "scenario": entry.scenario,
        "timestamp": entry.timestamp if entry.timestamp is not None else time.time(),
    }
    if entry.context_vector is not None:
        doc["context_vector"] = entry.context_vector
    await db.motivation_logs.insert_one(doc)
    return {"status": "ok"}


@router.get("/context")
async def get_context(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Fetch raw context signals for the current user from Component 1 and Component 4.

    Returns raw database values. The Electron frontend (contextBuilder.ts) transforms
    these into the 7-element TMT context vector — the backend is not responsible for
    vector construction.
    """
    user_id = current_user["sub"]
    logger.info("[Context] Building context for logged-in user_id=%s", user_id)

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
        "has_data": False,
        "sliding_window": {
            "app_switches_5min": 0,
            "non_academic_switches_10min": 0,
            "total_events_10min": 0,
            "seconds_since_last_academic": None,
            "window_has_data": False,
        },
    }

    result = dict(_default)

    # ── Component 1: focus_app_research / active_time ────────────────────────
    c1_db = _get_c1_db()
    if c1_db is not None:
        try:
            now_utc = datetime.now(timezone.utc)
            today_str, _, _ = get_effective_active_time_date(now_utc)
            lk_tz = timezone(timedelta(hours=5, minutes=30))
            now_lk = now_utc.astimezone(lk_tz)
            logger.info(
                "[Context] Querying Component 1 active_time for userId=%s effective_date=%s utc_now=%s local_now=%s",
                user_id,
                today_str,
                now_utc.isoformat(),
                now_lk.isoformat(),
            )
            projection = {
                "_id": 0,
                "date": 1,
                "userId": 1,
                "user_id": 1,
                "totalAppSwitches": 1,
                "nonAcademicAppSwitches": 1,
                # defensive alternatives in case upstream naming differs
                "total_app_switches": 1,
                "non_academic_app_switches": 1,
            }

            # Attempt order:
            # 1) exact match with canonical fields (userId + today's date)
            # 2) exact match with alternate user key (user_id + today's date)
            # 3) latest document for canonical key
            # 4) latest document for alternate key
            doc = await c1_db.active_time.find_one(
                {"userId": user_id, "date": today_str},
                projection,
            )
            source = "userId+date(today)"
            if not doc:
                doc = await c1_db.active_time.find_one(
                    {"user_id": user_id, "date": today_str},
                    projection,
                )
                source = "user_id+date(today)"
            if not doc:
                doc = await c1_db.active_time.find_one(
                    {"userId": user_id},
                    projection,
                    sort=[("date", -1)],
                )
                source = "latest userId"
            if not doc:
                doc = await c1_db.active_time.find_one(
                    {"user_id": user_id},
                    projection,
                    sort=[("date", -1)],
                )
                source = "latest user_id"

            if doc:
                total_switches = doc.get("totalAppSwitches", doc.get("total_app_switches", 0))
                non_acad_switches = doc.get("nonAcademicAppSwitches", doc.get("non_academic_app_switches", 0))
                result["total_transitions"] = int(total_switches or 0)
                result["non_academic_transitions"] = int(non_acad_switches or 0)
                result["has_data"] = True
                total = result["total_transitions"]
                impulsiveness_ratio = result["non_academic_transitions"] / total if total > 0 else 0.0
                logger.info(
                    "[Context] Component 1 hit for userId=%s via=%s doc_date=%s doc_userId=%s doc_user_id=%s totalAppSwitches=%s nonAcademicAppSwitches=%s impulsiveness_ratio=%.4f",
                    user_id,
                    source,
                    doc.get("date"),
                    doc.get("userId"),
                    doc.get("user_id"),
                    result["total_transitions"],
                    result["non_academic_transitions"],
                    impulsiveness_ratio,
                )
            else:
                logger.warning(
                    "[Context] No Component 1 active_time document found for userId=%s using attempts: userId/date, user_id/date, latest userId, latest user_id (today=%s)",
                    user_id,
                    today_str,
                )
        except Exception as e:
            logger.error("[Context] Failed to fetch Component 1 (activity) data: %s", e)
        # ── Sliding window (two-speed TMT) ────────────────────────────────
        try:
            sw = await _fetch_sliding_window(c1_db, user_id, now_utc)
            result["sliding_window"] = sw
            logger.info(
                "[Context] Sliding window: switches_5min=%d non_acad_10min=%d total_10min=%d since_acad=%s",
                sw["app_switches_5min"],
                sw["non_academic_switches_10min"],
                sw["total_events_10min"],
                sw["seconds_since_last_academic"],
            )
        except Exception as e:
            logger.error("[Context] Sliding window query failed: %s", e)
    else:
        logger.warning("[Context] Component 1 DB is not configured (settings.mongodb_uri is empty)")

    # ── Component 4: adaptive_time_estimation / completed_tasks ─────────────
    c4_db = _get_c4_db()
    if c4_db is not None:
        try:
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

            # Count all tasks for this user (no deadline filter — completed_tasks
            # collection lacks a created_at/completed_at field for date filtering)
            all_tasks = await collection.find(
                {"user_id": user_id},
                {"_id": 0, "status": 1, "deadline": 1},
            ).to_list(length=1000)

            result["completed_tasks_last_7_days"] = sum(
                1 for t in all_tasks if t.get("status") == "completed"
            )
            result["assigned_tasks_last_7_days"] = len(all_tasks)

            # Find current task: nearest upcoming (or most recently overdue) scheduled task
            now = datetime.now(timezone.utc)
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
        except Exception as e:
            logger.error("[Context] Failed to fetch Component 4 (tasks) data: %s", e)

    logger.info(
        "[Context] Final payload for user_id=%s: total_transitions=%s non_academic_transitions=%s has_data=%s",
        user_id,
        result["total_transitions"],
        result["non_academic_transitions"],
        result["has_data"],
    )
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


@router.delete("/reset")
async def reset_intervention_data(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Delete all intervention data for this user (bandit models, events, selections, motivation logs)."""
    db = _get_db()
    user_id = current_user["sub"]
    results = {}
    for collection_name in ["bandit_models", "bandit_events", "bandit_selections", "motivation_logs"]:
        result = await db[collection_name].delete_many({"user_id": user_id})
        results[collection_name] = result.deleted_count
    return {"status": "reset", "deleted": results}


@router.post("/reframe-text")
async def generate_reframe_text(goal: UserGoal, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Generate a short reframing notification text using Gemini AI based on user goal."""
    try:
        import google.generativeai as genai
        if not settings.gemini_api_key:
            return {"text": f"I choose to do this because it helps me {goal.life_goal}."}

        genai.configure(api_key=settings.gemini_api_key)

        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = (
            f"Write a very short, encouraging, and highly personal 1-sentence notification "
            f"reminding the user to reframe their task because it helps them achieve their "
            f"life goal: '{goal.life_goal}'. Make it a first-person statement, e.g. "
            f"'I choose to do this because it helps me...'. Make it no more than 15 words."
        )

        response = model.generate_content(prompt)
        text = response.text.strip()

        # Remove markdown quotes or formatting if any
        text = text.replace('"', '').replace("'", '').replace('*', '').strip()

        return {"text": text}
    except Exception as e:
        logger.error("[Intervention] AI Reframe generation failed: %s", e)
        return {"text": f"I choose to do this because it helps me {goal.life_goal}."}
