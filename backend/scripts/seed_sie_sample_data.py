"""
seed_sie_sample_data.py
-----------------------
Inserts sample data for user 'u123' into the two MongoDB databases
used by the Smart Intervention Engine context endpoint.

  DB 1 — focus_app_research   → active_time collection
  DB 2 — adaptive_time_estimation → completed_tasks collection

Run from the backend/ directory:

    python scripts/seed_sie_sample_data.py

The script is idempotent: it upserts the active_time document (keyed on
userId + date) and skips tasks that already exist for u123.
"""

import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ── Load .env ───────────────────────────────────────────────────────────────
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)
    print(f"Loaded env from {env_path}")
else:
    print(f"WARNING: .env not found at {env_path}. Relying on shell environment.")

from pymongo import MongoClient, UpdateOne

USER_ID = "u123"
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
DAY   = datetime.now(timezone.utc).strftime("%A")

# ── Connection strings ───────────────────────────────────────────────────────
C1_URI = os.getenv("MONGODB_URI", "")
C1_DB  = os.getenv("MONGODB_DATABASE", "focus_app_research")

C4_URI = os.getenv("TASKS_MONGODB_URI", "")
C4_DB  = os.getenv("TASKS_MONGODB_DATABASE", "adaptive_time_estimation")
C4_COL = os.getenv("TASKS_COLLECTION_TASKS", "completed_tasks")

if not C1_URI:
    sys.exit("ERROR: MONGODB_URI is not set in .env")
if not C4_URI:
    sys.exit("ERROR: TASKS_MONGODB_URI is not set in .env")


# ── Helper ───────────────────────────────────────────────────────────────────
def deadline(days_from_now: float) -> str:
    """Return an ISO-8601 deadline string offset from now."""
    dt = datetime.now(timezone.utc) + timedelta(days=days_from_now)
    return dt.isoformat()


# ════════════════════════════════════════════════════════════════════════════
# 1. focus_app_research  →  active_time
# ════════════════════════════════════════════════════════════════════════════
#
# Field reference (matches active_time.py output):
#
#   userId                      camelCase user identifier
#   date                        "YYYY-MM-DD"
#   day                         "Monday" … "Sunday"
#   status                      "ok" | "no_logs"
#   activeStart / activeEnd     "HH:MM AM/PM"  (focus-window bounds)
#   academicMinutes             focus-window academic time (min)
#   nonAcademicMinutes          focus-window non-academic time (min)
#   academicAppSwitches         focus-window academic switches
#   nonAcademicAppSwitches      focus-window non-academic switches
#   totalAppSwitches            focus-window total switches  ← used by SIE
#   totalAcademicMinutes        legacy alias for academicMinutes
#   fullDayAcademicMinutes      24-h academic minutes
#   fullDayProductivityMinutes  24-h productivity minutes
#   fullDayNonAcademicMinutes   24-h non-academic minutes
#   fullDayAcademicAppSwitches
#   fullDayProductivityAppSwitches
#   fullDayNonAcademicAppSwitches
#   fullDayTotalAppSwitches
#   expectedStudyMinutes        calibrated target study time (min)

ACTIVE_TIME_DOC = {
    "userId":                      USER_ID,
    "date":                        TODAY,
    "day":                         DAY,
    "status":                      "ok",
    "activeStart":                 "09:00 AM",
    "activeEnd":                   "11:30 AM",

    # Focus-window (e.g. morning study block)
    "academicMinutes":             75,
    "nonAcademicMinutes":          30,
    "academicAppSwitches":         12,
    "nonAcademicAppSwitches":      18,   # used as non_academic_transitions
    "totalAppSwitches":            30,   # used as total_transitions / app_switch_rate
    "totalAcademicMinutes":        75,   # legacy alias

    # Full-day (24-h) summary
    "fullDayAcademicMinutes":      110,
    "fullDayProductivityMinutes":  40,
    "fullDayNonAcademicMinutes":   60,
    "fullDayAcademicAppSwitches":  18,
    "fullDayProductivityAppSwitches": 8,
    "fullDayNonAcademicAppSwitches":  24,
    "fullDayTotalAppSwitches":     50,

    "expectedStudyMinutes":        120,
}


def seed_active_time():
    client = MongoClient(C1_URI)
    db     = client[C1_DB]
    col    = db["active_time"]

    result = col.update_one(
        {"userId": USER_ID, "date": TODAY},
        {"$set": ACTIVE_TIME_DOC},
        upsert=True,
    )
    action = "upserted" if result.upserted_id else "updated"
    print(f"[active_time]  {action} document for userId={USER_ID!r}  date={TODAY}")
    client.close()


# ════════════════════════════════════════════════════════════════════════════
# 2. adaptive_time_estimation  →  completed_tasks
# ════════════════════════════════════════════════════════════════════════════
#
# Field reference (matches estimator.py / AdaptiveTimeEstimator):
#
#   user_id          snake_case user identifier
#   status           "completed" | "scheduled"
#   priority         "High" | "Medium" | "Low"   ← string, NOT numeric
#   credits          course credit hours (numeric)
#   weight           assessment weight 0-100 (%)  ← SIE divides by 100
#   estimates
#     actual_time    minutes actually spent  (null for scheduled tasks)
#     system_estimate minutes predicted by model
#     user_estimate  minutes entered by user (null = user didn't override)
#   deadline         ISO-8601 string
#   sub_task
#     description    human-readable task description
#     vector         SBERT embedding (omitted in sample data — not needed by SIE)

TASKS = [
    # ── Completed tasks ──────────────────────────────────────────────────────
    {
        "user_id":  USER_ID,
        "status":   "completed",
        "priority": "High",
        "credits":  3,
        "weight":   40,       # 40% of final grade  →  grade_weight_normalized = 0.40
        "estimates": {
            "actual_time":      90,    # 90 min spent
            "system_estimate":  100,
            "user_estimate":    None,
        },
        "deadline": deadline(-5),      # was due 5 days ago
        "sub_task": {"description": "Complete literature review for research paper"},
    },
    {
        "user_id":  USER_ID,
        "status":   "completed",
        "priority": "Medium",
        "credits":  2,
        "weight":   20,
        "estimates": {
            "actual_time":      45,
            "system_estimate":  60,
            "user_estimate":    50,
        },
        "deadline": deadline(-3),
        "sub_task": {"description": "Submit lab report for Chemistry 201"},
    },
    {
        "user_id":  USER_ID,
        "status":   "completed",
        "priority": "Low",
        "credits":  1,
        "weight":   10,
        "estimates": {
            "actual_time":      30,
            "system_estimate":  40,
            "user_estimate":    None,
        },
        "deadline": deadline(-10),
        "sub_task": {"description": "Read chapter 5 of Introduction to Algorithms"},
    },
    {
        "user_id":  USER_ID,
        "status":   "completed",
        "priority": "High",
        "credits":  4,
        "weight":   50,
        "estimates": {
            "actual_time":      120,
            "system_estimate":  110,
            "user_estimate":    120,
        },
        "deadline": deadline(-1),
        "sub_task": {"description": "Finish programming assignment 3 — sorting algorithms"},
    },
    {
        "user_id":  USER_ID,
        "status":   "completed",
        "priority": "Medium",
        "credits":  3,
        "weight":   25,
        "estimates": {
            "actual_time":      60,
            "system_estimate":  75,
            "user_estimate":    None,
        },
        "deadline": deadline(-7),
        "sub_task": {"description": "Prepare presentation slides for group project"},
    },

    # ── Scheduled (upcoming) tasks ───────────────────────────────────────────
    {
        "user_id":  USER_ID,
        "status":   "scheduled",
        "priority": "High",
        "credits":  3,
        "weight":   35,
        "estimates": {
            "actual_time":      None,
            "system_estimate":  120,
            "user_estimate":    None,
        },
        "deadline": deadline(2),       # due in 2 days  ← nearest → chosen as current task
        "sub_task": {"description": "Write and submit research paper draft"},
    },
    {
        "user_id":  USER_ID,
        "status":   "scheduled",
        "priority": "Medium",
        "credits":  2,
        "weight":   20,
        "estimates": {
            "actual_time":      None,
            "system_estimate":  90,
            "user_estimate":    60,
        },
        "deadline": deadline(5),
        "sub_task": {"description": "Complete problem set 4 for Linear Algebra"},
    },
    {
        "user_id":  USER_ID,
        "status":   "scheduled",
        "priority": "Low",
        "credits":  1,
        "weight":   15,
        "estimates": {
            "actual_time":      None,
            "system_estimate":  45,
            "user_estimate":    None,
        },
        "deadline": deadline(10),
        "sub_task": {"description": "Optional reading: advanced data structures"},
    },
]


def seed_tasks():
    client = MongoClient(C4_URI)
    db     = client[C4_DB]
    col    = db[C4_COL]

    # Check how many tasks already exist for this user
    existing = col.count_documents({"user_id": USER_ID})
    if existing > 0:
        print(f"[completed_tasks] {existing} document(s) already exist for user_id={USER_ID!r}. Skipping insert.")
        print("  (Delete them manually first if you want a clean reseed.)")
        client.close()
        return

    result = col.insert_many(TASKS)
    print(f"[completed_tasks] Inserted {len(result.inserted_ids)} documents for user_id={USER_ID!r}")
    client.close()


# ════════════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print(f"\nSeeding sample data for user_id / userId = {USER_ID!r}\n")

    print("── DB 1: focus_app_research → active_time ──────────────────")
    seed_active_time()

    print("\n── DB 2: adaptive_time_estimation → completed_tasks ─────────")
    seed_tasks()

    print("\nDone. Call GET /intervention/context/u123 to verify.")
