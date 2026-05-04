"""
Tasks API router — converted from Flask (dynamic-task-prioritization) to FastAPI.

All endpoints use sync def (not async def) so that pymongo (synchronous) works
without thread pool wrappers. FastAPI automatically runs sync handlers in a threadpool.

Prefix: /api/tasks  (registered in router.py)
"""

import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from bson.objectid import ObjectId
from typing import Dict, Any
from app.api.deps import get_current_user

router = APIRouter()

# ---------------------------------------------------------------------------
# APDIS connection — initialized once at module load, non-fatal if missing
# ---------------------------------------------------------------------------
_apdis_collection = None

try:
    from pymongo import MongoClient as _MongoClient
    _apdis_uri = os.getenv("APDIS_MONGODB_URI", "")
    _apdis_db_name = os.getenv("APDIS_DATABASE_NAME", "")
    _apdis_collection_name = os.getenv("APDIS_COLLECTION_ACTIVE_TIME", "")

    if _apdis_uri and _apdis_db_name and _apdis_collection_name:
        _apdis_client = _MongoClient(_apdis_uri, serverSelectionTimeoutMS=5000)
        _apdis_db = _apdis_client[_apdis_db_name]
        _apdis_collection = _apdis_db[_apdis_collection_name]
        print("[TasksAPI] APDIS database connected.")
    else:
        print("[TasksAPI] APDIS env vars not configured — active time endpoints disabled.")
except Exception as e:
    print(f"[TasksAPI] APDIS connection skipped: {e}")


def _get_estimator():
    """Retrieve the AdaptiveTimeEstimator instance from the component registry."""
    from app.core.component_registry import ComponentRegistry
    registry = ComponentRegistry.get_instance()
    component = registry.get("adaptive_time_estimator")
    if component is None or component.estimator is None:
        raise HTTPException(status_code=503, detail="AdaptiveTimeEstimator component not available.")
    return component.estimator


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    pdf_path: Optional[str] = None
    pdf_base64: Optional[str] = None
    text_content: Optional[str] = None
    deadline: str
    credits: int
    weight: int


class PredictRequest(BaseModel):
    subtask: str
    difficulty: Optional[int] = 3


class SubtaskItem(BaseModel):
    name: str
    ai_suggested_time: Optional[int] = None


class PredictBatchRequest(BaseModel):
    main_task: dict
    subtasks: list


class CompleteRequest(BaseModel):
    subtask: str
    actual_time: int
    task_id: Optional[str] = None
    completed_date: Optional[str] = None


class StartResumeRequest(BaseModel):
    subtask: str
    task_id: Optional[str] = None


class PauseRequest(BaseModel):
    subtask: str
    accumulated_time: int
    task_id: Optional[str] = None


class SaveTasksRequest(BaseModel):
    main_task: dict
    predictions: list


class AllocateRequest(BaseModel):
    active_time_user_id: str
    start_date: Optional[str] = None
    days_ahead: Optional[int] = 7


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/analyze")
def analyze_task(req: AnalyzeRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Analyze a PDF or text content and return MCDM task priority result.
    Replaces the Electron subprocess that previously called main.py --input.
    """
    from app.core.component_registry import ComponentRegistry
    registry = ComponentRegistry.get_instance()
    user_id = current_user["sub"]

    data = {
        "deadline": req.deadline,
        "credits": req.credits,
        "weight": req.weight,
        "user_id": user_id,
    }
    if req.pdf_base64:
        # Electron sends the PDF as base64 because the backend is remote (Railway)
        # and cannot access local file paths on the user's machine.
        import base64
        data["pdf_bytes"] = base64.b64decode(req.pdf_base64)
    elif req.pdf_path:
        data["pdf_path"] = req.pdf_path
    if req.text_content:
        data["text_content"] = req.text_content

    try:
        result = registry.call("task_prioritization", data)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict")
def predict(req: PredictRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Predict time for a single subtask."""
    try:
        estimator = _get_estimator()
        prediction = estimator.predict_time(
            req.subtask,
            current_user["sub"],
            ai_suggested_time=None
        )
        prediction['timestamp'] = datetime.now().isoformat()
        return prediction
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict-batch")
def predict_batch(req: PredictBatchRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Predict time for multiple subtasks at once."""
    try:
        estimator = _get_estimator()
        user_id = current_user["sub"]

        predictions = []
        total_time = 0

        for i, subtask_data in enumerate(req.subtasks, 1):
            subtask_text = subtask_data.get('name') if isinstance(subtask_data, dict) else subtask_data
            ai_suggested_time = subtask_data.get('ai_suggested_time') if isinstance(subtask_data, dict) else None

            if not subtask_text:
                continue

            pred = estimator.predict_time(subtask_text, user_id, ai_suggested_time)
            pred['subtask_number'] = i
            pred['subtask_text'] = subtask_text
            predictions.append(pred)
            total_time += pred.get('predicted_time') or 0

        return {
            "predictions": predictions,
            "total_time": total_time,
            "task_count": len(req.subtasks),
            "average_time": total_time / len(req.subtasks) if req.subtasks else 0,
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/complete")
def complete(req: CompleteRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Mark a task as complete and record actual time."""
    try:
        estimator = _get_estimator()
        user_id = current_user["sub"]
        
        # Priority 1: Find by task_id
        if req.task_id:
            completed_time = datetime.fromisoformat(req.completed_date) if req.completed_date else datetime.now()
            result = estimator.tasks.update_one(
                {"_id": ObjectId(req.task_id), "user_id": user_id},
                {"$set": {"estimates.actual_time": req.actual_time, "status": "completed", "completed_date": completed_time}}
            )
            task_marked = result.modified_count == 1
        else:
            # Priority 2: Fallback to name-based (deprecated)
            task_marked = estimator.mark_complete(req.subtask, user_id, req.actual_time)

        if task_marked:
            return {
                "status": "completed",
                "message": "Task marked as complete",
                "timestamp": datetime.now().isoformat()
            }
        else:
            raise HTTPException(status_code=404, detail="Task not found or already completed.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start-task")
def start_task(req: StartResumeRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Mark task as started (in_progress)."""
    try:
        estimator = _get_estimator()
        user_id = current_user["sub"]
        
        query = {"user_id": user_id}
        if req.task_id:
            query["_id"] = ObjectId(req.task_id)
        else:
            query["sub_task.description"] = req.subtask
            query["status"] = "scheduled"

        result = estimator.tasks.update_one(
            query,
            {"$set": {"status": "in_progress", "started_date": datetime.now(), "accumulated_time": 0}}
        )

        if result.modified_count == 1:
            return {"status": "in_progress", "message": "Task started", "timestamp": datetime.now().isoformat()}
        else:
            raise HTTPException(status_code=404, detail="Task not found or already started.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pause-task")
def pause_task(req: PauseRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Mark task as paused and store accumulated time."""
    try:
        estimator = _get_estimator()
        user_id = current_user["sub"]

        query = {"user_id": user_id}
        if req.task_id:
            query["_id"] = ObjectId(req.task_id)
        else:
            query["sub_task.description"] = req.subtask
            query["status"] = "in_progress"

        result = estimator.tasks.update_one(
            query,
            {"$set": {"status": "paused", "accumulated_time": req.accumulated_time}, "$unset": {"started_date": ""}}
        )

        if result.modified_count == 1:
            return {"status": "paused", "message": "Task paused", "timestamp": datetime.now().isoformat()}
        else:
            raise HTTPException(status_code=404, detail="Task not found or not in_progress.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resume-task")
def resume_task(req: StartResumeRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Mark task as resumed (back to in_progress) and record new start date."""
    try:
        estimator = _get_estimator()
        user_id = current_user["sub"]

        query = {"user_id": user_id}
        if req.task_id:
            query["_id"] = ObjectId(req.task_id)
        else:
            query["sub_task.description"] = req.subtask
            query["status"] = "paused"

        result = estimator.tasks.update_one(
            query,
            {"$set": {"status": "in_progress", "started_date": datetime.now()}}
        )

        if result.modified_count == 1:
            return {"status": "in_progress", "message": "Task resumed", "timestamp": datetime.now().isoformat()}
        else:
            raise HTTPException(status_code=404, detail="Task not found or not paused.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/accuracy")
def get_accuracy(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get model accuracy for the current user."""
    try:
        estimator = _get_estimator()
        accuracy = estimator.get_accuracy(current_user["sub"])

        if accuracy:
            return accuracy
        else:
            raise HTTPException(status_code=404, detail="No training data found for this user.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks")
def get_user_tasks(
    status: Optional[str] = Query(None),
    limit: Optional[int] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get all tasks for a specific user."""
    try:
        estimator = _get_estimator()
        user_id = current_user["sub"]

        query = {"user_id": user_id}
        if status:
            query["status"] = status

        tasks_cursor = estimator.tasks.find(query).sort("created_date", -1)
        if limit:
            tasks_cursor = tasks_cursor.limit(limit)

        tasks = list(tasks_cursor)
        formatted_tasks = []
        total_estimated_time = 0

        for task in tasks:
            estimates = task.get('estimates', {})
            sub_task = task.get('sub_task', {})

            time_alloc = task.get('time_allocation_date')
            if time_alloc and isinstance(time_alloc, datetime):
                time_allocation_str = time_alloc.isoformat()
            else:
                time_allocation_str = time_alloc

            formatted_task = {
                "task_id": str(task['_id']),
                "main_task": task.get('main_task', {}),
                "subtask": sub_task.get('description', 'Unknown'),
                "subtask_position": sub_task.get('position', 1),
                "category": sub_task.get('category', 'general'),
                "predicted_time": estimates.get('system_estimate', 0),
                "user_estimate": estimates.get('user_estimate'),
                "actual_time": estimates.get('actual_time'),
                "confidence": estimates.get('confidence', 'UNKNOWN'),
                "method": estimates.get('prediction_method', 'unknown'),
                "status": task.get('status', 'scheduled'),
                "created_date": task.get('created_date', datetime.now()).isoformat(),
                "completed_date": task.get('completed_date', '').isoformat() if task.get('completed_date') else None,
                "time_allocation_date": time_allocation_str,
                "predictedActiveStart": task.get('predictedActiveStart'),
                "predictedActiveEnd": task.get('predictedActiveEnd'),
                "rescheduledActiveStart": task.get('rescheduledActiveStart'),
                "rescheduledActiveEnd": task.get('rescheduledActiveEnd'),
                "rescheduled_date": task.get('rescheduled_date'),
                "started_date": task.get('started_date', '').isoformat() if task.get('started_date') else None,
                "accumulated_time": task.get('accumulated_time', 0),
                "is_history": task.get('is_history', False),
                "rescheduled": task.get('rescheduled', False),
                "original_allocation_date": task.get('original_allocation_date').isoformat() if isinstance(task.get('original_allocation_date'), datetime) else task.get('original_allocation_date')
            }
            formatted_tasks.append(formatted_task)

            if task.get('status') != 'completed':
                total_estimated_time += estimates.get('system_estimate', 0)

        return {
            "user_id": user_id,
            "tasks": formatted_tasks,
            "task_count": len(formatted_tasks),
            "total_estimated_time": total_estimated_time,
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scheduled-summary")
def get_scheduled_summary(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Get a summary of scheduled tasks including suggested_date, subtask name, and deadline.
    Used for calendar view.
    """
    try:
        estimator = _get_estimator()
        user_id = current_user["sub"]

        # Query for only scheduled tasks for this user
        query = {"user_id": user_id, "status": "scheduled"}
        tasks_cursor = estimator.tasks.find(query).sort("suggested_date", 1)

        tasks = list(tasks_cursor)
        summary = []

        for task in tasks:
            sub_task = task.get('sub_task', {})
            main_task = task.get('main_task', {})

            # Format suggested_date
            suggested_date = task.get('suggested_date')
            if suggested_date and isinstance(suggested_date, datetime):
                suggested_date_str = suggested_date.isoformat()
            else:
                suggested_date_str = suggested_date

            summary.append({
                "subtask_name": sub_task.get('description', 'Unknown'),
                "suggested_date": suggested_date_str,
                "deadline": main_task.get('deadline', 'No Deadline'),
                "main_task": main_task.get('name', 'Unknown')
            })

        return {
            "user_id": user_id,
            "tasks": summary,
            "count": len(summary),
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/save-tasks")
def save_tasks(req: SaveTasksRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Save tasks to database."""
    try:
        estimator = _get_estimator()
        estimator.save_task(req.main_task, req.predictions, current_user["sub"])

        return {
            "status": "saved",
            "task_count": len(req.predictions),
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/allocate")
def allocate_tasks(req: AllocateRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Allocate tasks to days based on active time predictions."""
    if _apdis_collection is None:
        raise HTTPException(status_code=503, detail="APDIS database not configured.")

    try:
        estimator = _get_estimator()
        user_id = current_user["sub"]

        start_date = datetime.strptime(req.start_date, '%Y-%m-%d') if req.start_date else datetime.now()
        end_date = start_date + timedelta(days=req.days_ahead)

        active_times = list(_apdis_collection.find({
            "userId": req.active_time_user_id,
            "date": {
                "$gte": start_date.strftime('%Y-%m-%d'),
                "$lte": end_date.strftime('%Y-%m-%d')
            }
        }).sort("date", 1))

        if not active_times:
            raise HTTPException(
                status_code=404,
                detail=f"No active time predictions found for {req.active_time_user_id}"
            )

        incomplete_tasks = list(estimator.tasks.find({
            "user_id": user_id,
            "status": {"$ne": "completed"}
        }).sort([("final_mcdm_score", -1), ("sub_task.position", 1)]))

        if not incomplete_tasks:
            return {"message": "No incomplete tasks found for this user", "user_id": user_id}

        # --- Console log: show full sorted task order before allocation ---
        print("\n" + "="*60)
        print(f"[ALLOCATE] Starting allocation for user: {user_id}")
        print(f"[ALLOCATE] Total pending subtasks: {len(incomplete_tasks)}")
        print(f"[ALLOCATE] Sorted order (MCDM DESC → Position ASC):")
        for i, t in enumerate(incomplete_tasks, 1):
            main = t.get('main_task', {}).get('name', 'Unknown')
            sub = t.get('sub_task', {}).get('description', 'Unknown')
            pos = t.get('sub_task', {}).get('position', '?')
            score = t.get('final_mcdm_score', 0)
            est = t['estimates'].get('user_estimate') or t['estimates'].get('system_estimate', 0)
            print(f"  {i:2}. [MCDM={score}] [Pos={pos}] {main} → {sub} ({est} min)")
        print("="*60)

        task_allocation_map = {}
        allocations = []
        allocated_task_ids = []
        remaining_tasks = list(range(len(incomplete_tasks)))

        for active_time in active_times:
            date_str = active_time['date']
            available_minutes = active_time.get('predictedAcademicMinutes', 0)
            used_minutes = 0
            day_tasks = []
            tasks_to_remove = []

            for task_idx in remaining_tasks:
                task = incomplete_tasks[task_idx]
                estimated_time = task['estimates'].get('user_estimate') or task['estimates'].get('system_estimate', 0)

                if used_minutes + estimated_time <= available_minutes:
                    task_date = datetime.strptime(date_str, '%Y-%m-%d')
                    predicted_start = active_time.get('predictedActiveStart', '')
                    predicted_end = active_time.get('predictedActiveEnd', '')

                    # Console log: what is being allocated to this day
                    main = task.get('main_task', {}).get('name', 'Unknown')
                    sub = task.get('sub_task', {}).get('description', 'Unknown')
                    pos = task.get('sub_task', {}).get('position', '?')
                    score = task.get('final_mcdm_score', 0)
                    print(f"  [ALLOCATED] {date_str} | MCDM={score} Pos={pos} | {main} → {sub} ({estimated_time} min)")

                    estimator.tasks.update_one(
                        {"_id": task['_id']},
                        {"$set": {
                            "time_allocation_date": task_date,
                            "predictedActiveStart": predicted_start,
                            "predictedActiveEnd": predicted_end
                        }}
                    )

                    day_tasks.append({
                        "task_id": str(task['_id']),
                        "subtask": task['sub_task'].get('description', 'Unknown'),
                        "estimated_time": estimated_time,
                        "category": task['sub_task'].get('category', 'general'),
                        "final_mcdm_score": task.get('final_mcdm_score'),
                        "predictedActiveStart": predicted_start,
                        "predictedActiveEnd": predicted_end
                    })

                    allocated_task_ids.append(str(task['_id']))
                    task_allocation_map[str(task['_id'])] = date_str
                    used_minutes += estimated_time
                    tasks_to_remove.append(task_idx)

            for task_idx in reversed(tasks_to_remove):
                remaining_tasks.remove(task_idx)

            allocations.append({
                "date": date_str,
                "day": active_time.get('day', ''),
                "available_minutes": available_minutes,
                "used_minutes": used_minutes,
                "remaining_minutes": available_minutes - used_minutes,
                "active_window": f"{active_time.get('predictedActiveStart', '')} - {active_time.get('predictedActiveEnd', '')}",
                "tasks_count": len(day_tasks),
                "tasks": day_tasks
            })

        return {
            "user_id": user_id,
            "active_time_user_id": req.active_time_user_id,
            "allocated_tasks": len(allocated_task_ids),
            "unallocated_tasks": len(remaining_tasks),
            "allocations": allocations,
            "timestamp": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/allocate-internal/{user_id}")
def allocate_tasks_internal(user_id: str, req: AllocateRequest):
    """Internal endpoint for the background scheduler — no JWT auth required."""
    if _apdis_collection is None:
        raise HTTPException(status_code=503, detail="APDIS database not configured.")

    def parse_window_time(time_str, date_obj):
        if not time_str or not date_obj: return None
        try:
            t = datetime.strptime(time_str, "%I:%M %p")
            return date_obj.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
        except: return None

    try:
        estimator = _get_estimator()
        now = datetime.now()

        # --- AUTO-FAILURE GUARD ---
        # Mark tasks as failed if their window has passed and they aren't completed
        overdue_tasks = estimator.tasks.find({
            "user_id": user_id,
            "status": {"$in": ["scheduled", "in_progress", "paused"]},
            "time_allocation_date": {"$ne": None},
            "predictedActiveEnd": {"$ne": None}
        })
        
        fail_count = 0
        for task in overdue_tasks:
            end_time = parse_window_time(task['predictedActiveEnd'], task['time_allocation_date'])
            if end_time and now > end_time:
                estimator.tasks.update_one({"_id": task["_id"]}, {"$set": {"status": "failed"}})
                fail_count += 1
        
        if fail_count > 0:
            print(f" [GUARD] Auto-failed {fail_count} expired tasks for user {user_id}")
        # ---------------------------

        start_date = datetime.strptime(req.start_date, '%Y-%m-%d') if req.start_date else datetime.now()
        end_date = start_date + timedelta(days=req.days_ahead)

        active_times = list(_apdis_collection.find({
            "userId": req.active_time_user_id,
            "date": {
                "$gte": start_date.strftime('%Y-%m-%d'),
                "$lte": end_date.strftime('%Y-%m-%d')
            }
        }).sort("date", 1))

        if not active_times:
            raise HTTPException(
                status_code=404,
                detail=f"No active time predictions found for {req.active_time_user_id}"
            )

        incomplete_tasks = list(estimator.tasks.find({
            "user_id": user_id,
            "status": {"$ne": "completed"},
            "is_history": {"$ne": True}
        }).sort([("final_mcdm_score", -1), ("sub_task.position", 1)]))

        if not incomplete_tasks:
            print(f"\n[ALLOCATION] No incomplete tasks found for user: {user_id}")
            return {"message": "No incomplete tasks found for this user", "user_id": user_id}

        # --- VALIDATION & LOGGING ---
        print(f"\n{'='*70}")
        print(f" 🔥 TASK ALLOCATION INITIATED | User: {user_id}")
        print(f" 🎯 Primary Sort: MCDM Score (DESC) | Secondary: Position (ASC)")
        print(f"{'-'*70}")
        
        last_score = float('inf')
        last_pos = -1
        
        for i, t in enumerate(incomplete_tasks):
            score = t.get('final_mcdm_score', 0)
            pos = t.get('sub_task', {}).get('position', 0)
            name = t.get('sub_task', {}).get('description', 'Unnamed')
            
            # STRICT VALIDATION CHECK
            issue = False
            if score > last_score:
                issue = True
                print(f" [!] ERROR: Primary Sort Broken (Score {score} > {last_score})")
            elif score == last_score and pos < last_pos:
                issue = True
                print(f" [!] ERROR: Secondary Sort Broken (Pos {pos} < {last_pos} for same score)")
                
            if issue:
                print(f"     └─ Affected Task: {name} (Index {i})")
                
            last_score = score
            last_pos = pos
            
            print(f" {i+1:2}. [Score: {score:6.2f} | Pos: {pos:2}] {name}")
        print(f"{'='*70}\n")
        # ----------------------------

        allocations = []
        allocated_task_ids = []
        remaining_tasks = list(range(len(incomplete_tasks)))

        for active_time in active_times:
            date_str = active_time['date']
            available_minutes = active_time.get('predictedAcademicMinutes', 0)
            used_minutes = 0
            day_tasks = []
            tasks_to_remove = []

            for task_idx in remaining_tasks:
                task = incomplete_tasks[task_idx]
                estimated_time = task['estimates'].get('user_estimate') or task['estimates'].get('system_estimate', 0)

                if used_minutes + estimated_time <= available_minutes:
                    task_date = datetime.strptime(date_str, '%Y-%m-%d')
                    predicted_start = active_time.get('predictedActiveStart', '')
                    predicted_end = active_time.get('predictedActiveEnd', '')

                    update_fields = {
                        "time_allocation_date": task_date,
                        "status": "scheduled"
                    }                    # DUPLICATION-BASED RESCHEDULING LOGIC
                    if task.get('predictedActiveStart'):
                        # 1. Create a clone for the new slot
                        new_task = task.copy()
                        new_task.pop('_id', None) # Remove old ID to let MongoDB generate a new one
                        
                        # Preserve original allocation date
                        if task.get("time_allocation_date"):
                            new_task["original_allocation_date"] = task["time_allocation_date"]
                        
                        new_task["time_allocation_date"] = task_date
                        new_task["status"] = "scheduled"
                        new_task["rescheduled_date"] = date_str
                        new_task["rescheduledActiveStart"] = predicted_start
                        new_task["rescheduledActiveEnd"] = predicted_end
                        new_task["is_history"] = False # Ensure the new one is live
                        new_task["rescheduled"] = True # Tag as rescheduled
                        
                        # 2. Mark the original as history
                        estimator.tasks.update_one(
                            {"_id": task['_id']},
                            {"$set": {"is_history": True, "status": "failed"}}
                        )
                        
                        # 3. Insert the new clone
                        estimator.tasks.insert_one(new_task)
                        
                        print(f" [DUPLICATE-RESCHEDULE] '{task['sub_task'].get('description', 'Unknown')}' cloned to {date_str}")
                    else:
                        # First-time allocation: same as before
                        update_fields["predictedActiveStart"] = predicted_start
                        update_fields["predictedActiveEnd"] = predicted_end
                        estimator.tasks.update_one(
                            {"_id": task['_id']},
                            {"$set": update_fields}
                        )

                    print(f" [+] ALLOCATED: '{task['sub_task'].get('description', 'Unknown')}' to {date_str}")
                    print(f"     Window: {predicted_start} - {predicted_end} | Time: {estimated_time}m")
                    
                    day_tasks.append({
                        "task_id": str(task['_id']),
                        "subtask": task['sub_task'].get('description', 'Unknown'),
                        "estimated_time": estimated_time,
                    })

                    allocated_task_ids.append(str(task['_id']))
                    used_minutes += estimated_time
                    tasks_to_remove.append(task_idx)

            for task_idx in reversed(tasks_to_remove):
                remaining_tasks.remove(task_idx)

            allocations.append({
                "date": date_str,
                "available_minutes": available_minutes,
                "used_minutes": used_minutes,
                "tasks_count": len(day_tasks),
                "tasks": day_tasks
            })

        return {
            "user_id": user_id,
            "allocated_tasks": len(allocated_task_ids),
            "unallocated_tasks": len(remaining_tasks),
            "allocations": allocations,
            "timestamp": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active-time/debug")
def debug_active_time():
    """Debug endpoint to check APDIS database connection."""
    if _apdis_collection is None:
        raise HTTPException(status_code=503, detail="APDIS database not configured.")

    try:
        total_count = _apdis_collection.count_documents({})
        sample = list(_apdis_collection.find().limit(5))
        for doc in sample:
            doc['_id'] = str(doc['_id'])
        unique_users = _apdis_collection.distinct("userId")

        return {
            "database": os.getenv('APDIS_DATABASE_NAME'),
            "collection": os.getenv('APDIS_COLLECTION_ACTIVE_TIME'),
            "total_documents": total_count,
            "unique_users": unique_users,
            "sample_data": sample
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active-time/user/{user_id}")
def get_active_time_by_user(
    user_id: str,
    date: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    limit: Optional[int] = Query(None),
    sort: str = Query("date")
):
    """Get all active time predictions for a specific user."""
    if _apdis_collection is None:
        raise HTTPException(status_code=503, detail="APDIS database not configured.")

    try:
        query = {"userId": user_id}
        if date:
            query["date"] = date
        elif start_date:
            query["date"] = {"$gte": start_date}

        predictions_cursor = _apdis_collection.find(query).sort(sort, -1)
        if limit:
            predictions_cursor = predictions_cursor.limit(limit)

        predictions = list(predictions_cursor)
        total_minutes = 0
        for pred in predictions:
            pred['_id'] = str(pred['_id'])
            total_minutes += int(pred.get('predictedAcademicMinutes') or 0)

        return {
            "user_id": user_id,
            "predictions": predictions,
            "count": len(predictions),
            "total_predicted_minutes": total_minutes,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active-time/{id}")
def get_active_time_by_id(id: str):
    """Get active time prediction by ID."""
    if _apdis_collection is None:
        raise HTTPException(status_code=503, detail="APDIS database not configured.")

    try:
        object_id = ObjectId(id)
        result = _apdis_collection.find_one({"_id": object_id})

        if result:
            result['_id'] = str(result['_id'])
            return result
        else:
            raise HTTPException(status_code=404, detail=f"Active time prediction not found: {id}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
