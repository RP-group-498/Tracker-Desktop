"""
Tasks API router — converted from Flask (dynamic-task-prioritization) to FastAPI.

All endpoints use sync def (not async def) so that pymongo (synchronous) works
without thread pool wrappers. FastAPI automatically runs sync handlers in a threadpool.

Prefix: /api/tasks  (registered in router.py)
"""

import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from bson.objectid import ObjectId

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
    text_content: Optional[str] = None
    deadline: str
    credits: int
    weight: int
    user_id: Optional[str] = "student_123"


class PredictRequest(BaseModel):
    subtask: str
    user_id: str
    difficulty: Optional[int] = 3


class SubtaskItem(BaseModel):
    name: str
    ai_suggested_time: Optional[int] = None


class PredictBatchRequest(BaseModel):
    user_id: str
    main_task: dict
    subtasks: list


class CompleteRequest(BaseModel):
    subtask: str
    user_id: str
    actual_time: int


class StartPauseResumeRequest(BaseModel):
    subtask: str
    user_id: str


class SaveTasksRequest(BaseModel):
    user_id: str
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
def analyze_task(req: AnalyzeRequest):
    """
    Analyze a PDF or text content and return MCDM task priority result.
    Replaces the Electron subprocess that previously called main.py --input.
    """
    from app.core.component_registry import ComponentRegistry
    registry = ComponentRegistry.get_instance()

    data = {
        "deadline": req.deadline,
        "credits": req.credits,
        "weight": req.weight,
        "user_id": req.user_id,
    }
    if req.pdf_path:
        data["pdf_path"] = req.pdf_path
    if req.text_content:
        data["text_content"] = req.text_content

    try:
        result = registry.call("task_prioritization", data)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict")
def predict(req: PredictRequest):
    """Predict time for a single subtask."""
    try:
        estimator = _get_estimator()
        prediction = estimator.predict_time(
            req.subtask,
            req.user_id,
            ai_suggested_time=None
        )
        prediction['timestamp'] = datetime.now().isoformat()
        return prediction
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict-batch")
def predict_batch(req: PredictBatchRequest):
    """Predict time for multiple subtasks at once."""
    try:
        estimator = _get_estimator()

        predictions = []
        total_time = 0

        for i, subtask_data in enumerate(req.subtasks, 1):
            subtask_text = subtask_data.get('name') if isinstance(subtask_data, dict) else subtask_data
            ai_suggested_time = subtask_data.get('ai_suggested_time') if isinstance(subtask_data, dict) else None

            if not subtask_text:
                continue

            pred = estimator.predict_time(subtask_text, req.user_id, ai_suggested_time)
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
def complete(req: CompleteRequest):
    """Mark a task as complete and record actual time."""
    try:
        estimator = _get_estimator()
        task_marked = estimator.mark_complete(req.subtask, req.user_id, req.actual_time)

        if task_marked:
            return {
                "status": "completed",
                "message": "Task marked as complete and model updated",
                "timestamp": datetime.now().isoformat()
            }
        else:
            raise HTTPException(status_code=404, detail="Task not found or not in scheduled status.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start-task")
def start_task(req: StartPauseResumeRequest):
    """Mark task as started (in_progress)."""
    try:
        estimator = _get_estimator()
        result = estimator.tasks.update_one(
            {
                "user_id": req.user_id,
                "sub_task.description": req.subtask,
                "status": "scheduled"
            },
            {"$set": {"status": "in_progress", "started_date": datetime.now()}}
        )

        if result.modified_count == 1:
            return {"status": "in_progress", "message": "Task started", "timestamp": datetime.now().isoformat()}
        else:
            raise HTTPException(status_code=404, detail="Task not found or already started/completed.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pause-task")
def pause_task(req: StartPauseResumeRequest):
    """Mark task as paused."""
    try:
        estimator = _get_estimator()
        result = estimator.tasks.update_one(
            {
                "user_id": req.user_id,
                "sub_task.description": req.subtask,
                "status": "in_progress"
            },
            {"$set": {"status": "paused"}}
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
def resume_task(req: StartPauseResumeRequest):
    """Mark task as resumed (back to in_progress)."""
    try:
        estimator = _get_estimator()
        result = estimator.tasks.update_one(
            {
                "user_id": req.user_id,
                "sub_task.description": req.subtask,
                "status": "paused"
            },
            {"$set": {"status": "in_progress"}}
        )

        if result.modified_count == 1:
            return {"status": "in_progress", "message": "Task resumed", "timestamp": datetime.now().isoformat()}
        else:
            raise HTTPException(status_code=404, detail="Task not found or not paused.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/accuracy/{user_id}")
def get_accuracy(user_id: str):
    """Get model accuracy for a specific user."""
    try:
        estimator = _get_estimator()
        accuracy = estimator.get_accuracy(user_id)

        if accuracy:
            return accuracy
        else:
            raise HTTPException(status_code=404, detail="No training data found for this user.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks/{user_id}")
def get_user_tasks(
    user_id: str,
    status: Optional[str] = Query(None),
    limit: Optional[int] = Query(None)
):
    """Get all tasks for a specific user."""
    try:
        estimator = _get_estimator()

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
                "predictedActiveEnd": task.get('predictedActiveEnd')
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


@router.post("/save-tasks")
def save_tasks(req: SaveTasksRequest):
    """Save tasks to database."""
    try:
        estimator = _get_estimator()
        estimator.save_task(req.main_task, req.predictions, req.user_id)

        return {
            "status": "saved",
            "task_count": len(req.predictions),
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/allocate/{user_id}")
def allocate_tasks(user_id: str, req: AllocateRequest):
    """Allocate tasks to days based on active time predictions."""
    if _apdis_collection is None:
        raise HTTPException(status_code=503, detail="APDIS database not configured.")

    try:
        estimator = _get_estimator()

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
        }).sort([("final_mcdm_score", -1)]))

        if not incomplete_tasks:
            return {"message": "No incomplete tasks found for this user", "user_id": user_id}

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
