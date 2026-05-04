"""
seed_intervention_time.py
-------------------------
Seeds active_time data for user '69f8589d5e05cc781de26497' 
from April 15, 2026 to May 4, 2026.

Working time is randomized between 4-5 hours (240-300 min) for past days.
Today (May 4) shows activity from 08:00 AM to 02:00 PM.
"""

import os
import random
from datetime import datetime, timezone, timedelta
from pathlib import Path
from pymongo import MongoClient

# --- Configuration ---
USER_ID = "69f8589d5e05cc781de26497"
START_DATE = datetime(2026, 4, 15, tzinfo=timezone.utc)
END_DATE = datetime(2026, 5, 4, tzinfo=timezone.utc)  # Today

# --- Load Environment ---
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)
    print(f"Loaded env from {env_path}")

MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "focus_app_research")

if not MONGODB_URI:
    raise ValueError("MONGODB_URI not found in environment or .env file.")

client = MongoClient(MONGODB_URI)
db = client[MONGODB_DATABASE]
active_time_col = db["active_time"]

def generate_daily_doc(date_dt, is_today=False):
    date_str = date_dt.strftime("%Y-%m-%d")
    day_name = date_dt.strftime("%A")
    
    if is_today:
        active_start = "08:00 AM"
        active_end = "02:00 PM"
        # 6 hours total window (360 min). Let's say 4.5 hours of focus time.
        academic_min = 270 
    else:
        # 4-5 hours randomized
        academic_min = random.randint(240, 300)
        start_hour = random.randint(8, 10)
        end_hour = start_hour + random.randint(4, 6)
        active_start = f"{start_hour:02d}:00 AM"
        active_end = f"{end_hour-12 if end_hour > 12 else end_hour:02d}:00 {'PM' if end_hour >= 12 else 'AM'}"

    non_academic_min = random.randint(20, 50)
    academic_switches = random.randint(10, 20)
    non_academic_switches = random.randint(15, 30)
    total_switches = academic_switches + non_academic_switches

    return {
        "userId": USER_ID,
        "date": date_str,
        "day": day_name,
        "status": "ok",
        "activeStart": active_start,
        "activeEnd": active_end,
        "academicMinutes": academic_min,
        "nonAcademicMinutes": non_academic_min,
        "academicAppSwitches": academic_switches,
        "nonAcademicAppSwitches": non_academic_switches,
        "totalAppSwitches": total_switches,
        "totalAcademicMinutes": academic_min,
        "fullDayAcademicMinutes": academic_min + random.randint(10, 30),
        "fullDayProductivityMinutes": random.randint(30, 60),
        "fullDayNonAcademicMinutes": non_academic_min + random.randint(20, 40),
        "fullDayAcademicAppSwitches": academic_switches + random.randint(2, 5),
        "fullDayProductivityAppSwitches": random.randint(5, 10),
        "fullDayNonAcademicAppSwitches": non_academic_switches + random.randint(5, 10),
        "fullDayTotalAppSwitches": total_switches + random.randint(10, 20),
        "expectedStudyMinutes": 240,
    }

def seed():
    current_date = START_DATE
    count = 0
    while current_date <= END_DATE:
        is_today = (current_date.date() == END_DATE.date())
        doc = generate_daily_doc(current_date, is_today)
        
        # Upsert by userId and date
        active_time_col.update_one(
            {"userId": USER_ID, "date": doc["date"]},
            {"$set": doc},
            upsert=True
        )
        count += 1
        current_date += timedelta(days=1)
    
    print(f"Successfully seeded {count} active_time documents for user {USER_ID}.")

if __name__ == "__main__":
    seed()
    client.close()
