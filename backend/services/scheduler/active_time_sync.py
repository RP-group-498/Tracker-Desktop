import schedule
import time
import requests
import logging
import os
import sys
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Fix Windows console encoding for emojis
if sys.platform == 'win32':
    os.system('chcp 65001 > nul 2>&1')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')

# Load environment variables from backend .env
load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

# Setup logging
log_file = 'scheduler.log'
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

# Configuration — FastAPI backend (configurable via .env)
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000/api/tasks")
USERS_TO_SYNC = os.getenv("SCHEDULER_USERS","124804d8-40e0-4f90-af05-eeea5c2d7550,user_001").split(",")
SCHEDULE_TIME = os.getenv("SCHEDULER_TIME", "21:09")


def allocate_user_tasks(student_id, active_time_id, start_date=None, days_ahead=90):
    """Triggers task allocation for a student based on their active time."""
    if start_date is None:
        start_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    url = f"{API_BASE_URL}/allocate/{student_id}"
    payload = {
        "active_time_user_id": active_time_id,
        "start_date": start_date,
        "days_ahead": days_ahead
    }

    logging.info(f"--- TRIGGERING TASK ALLOCATION FOR {student_id} ---")
    logging.info(f"Target URL: {url} | Payload: {payload}")

    try:
        response = requests.post(url, json=payload, timeout=60)

        if response.status_code == 200:
            data = response.json()
            allocated = data.get('allocated_tasks', 0)
            unallocated = data.get('unallocated_tasks', 0)
            logging.info(f"ALLOCATION SUCCESS: {student_id} | Allocated: {allocated}, Unallocated: {unallocated}")
            return True
        else:
            logging.error(f"ALLOCATION FAILED: {student_id} | Status: {response.status_code} | Reason: {response.text[:200]}")
            return False
    except Exception as e:
        logging.error(f"ALLOCATION ERROR: {str(e)}")
        return False


def fetch_active_time():
    """Fetches active time data for configured users."""
    logging.info(f"--- STARTING DAILY SYNC AT {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---")

    success_count = 0
    fail_count = 0

    for user_id in USERS_TO_SYNC:
        url = f"{API_BASE_URL}/active-time/user/{user_id}"
        logging.info(f"Attempting sync for {user_id} via {url}")

        try:
            response = requests.get(url, timeout=30)

            if response.status_code == 200:
                data = response.json()
                predictions = data.get('predictions', [])
                predictions_found = data.get('count', 0)
                logging.info(f"SUCCESS: {user_id} | Predictions synced: {predictions_found}")

                if predictions:
                    for p in predictions:
                        date = p.get('date', 'N/A')
                        day = p.get('day', 'N/A')
                        start = p.get('predictedActiveStart', 'N/A')
                        end = p.get('predictedActiveEnd', 'N/A')
                        mins = p.get('predictedAcademicMinutes', 0)
                        logging.info(f"  {date} ({day}): {start} - {end} | {mins} mins")

                success_count += 1

                # If 124804d8-40e0-4f90-af05-eeea5c2d7550 is synced, trigger allocation for student_123
                if user_id == "124804d8-40e0-4f90-af05-eeea5c2d7550":
                    allocate_user_tasks("student_123", "124804d8-40e0-4f90-af05-eeea5c2d7550")

            else:
                logging.warning(f"FAILED: {user_id} | Status: {response.status_code} | Reason: {response.text[:100]}")
                fail_count += 1

        except requests.exceptions.ConnectionError:
            logging.error(f"ERROR: Could not connect to API at {API_BASE_URL}. Is the backend running?")
            fail_count += 1
        except Exception as e:
            logging.error(f"ERROR: Unexpected error syncing {user_id}: {str(e)}")
            fail_count += 1

    logging.info(f"--- SYNC SUMMARY: {success_count} Succeeded, {fail_count} Failed ---")
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Sync Summary: {success_count} OK, {fail_count} Error(s). Check scheduler.log for details.")


import threading

_stop_event = threading.Event()
_scheduler_thread = None


def _run_loop():
    """Internal loop — runs inside background thread."""
    schedule.every().day.at(SCHEDULE_TIME).do(fetch_active_time)

    next_run = schedule.next_run()
    print(f"[Scheduler] Active Time Sync scheduled daily at {SCHEDULE_TIME}")
    print(f"[Scheduler] Next run: {next_run.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"[Scheduler] Monitoring users: {USERS_TO_SYNC}")
    print(f"[Scheduler] API target: {API_BASE_URL}")

    while not _stop_event.is_set():
        try:
            schedule.run_pending()
            _stop_event.wait(timeout=30)
        except Exception as e:
            logging.error(f"[Scheduler] Error: {str(e)}")
            print(f"[Scheduler] ERROR: {str(e)}")
            _stop_event.wait(timeout=60)

    schedule.clear()
    print("[Scheduler] Stopped.")
    logging.info("[Scheduler] Stopped.")


def start_scheduler():
    """Start scheduler in a background daemon thread (called by FastAPI lifespan)."""
    global _scheduler_thread
    _stop_event.clear()
    _scheduler_thread = threading.Thread(target=_run_loop, daemon=True, name="active-time-scheduler")
    _scheduler_thread.start()
    print(f"[Scheduler] Background scheduler started (thread: active-time-scheduler)")
    logging.info("[Scheduler] Background scheduler started.")


def stop_scheduler():
    """Stop the background scheduler thread."""
    _stop_event.set()
    if _scheduler_thread and _scheduler_thread.is_alive():
        _scheduler_thread.join(timeout=5)
    print("[Scheduler] Background scheduler stopped.")
    logging.info("[Scheduler] Background scheduler stopped.")


if __name__ == "__main__":
    # Standalone mode — blocking loop for manual testing
    logging.info(f"Scheduler initialized. Monitoring: {', '.join(USERS_TO_SYNC)}")
    logging.info(f"Daily task scheduled for: {SCHEDULE_TIME}")
    schedule.every().day.at(SCHEDULE_TIME).do(fetch_active_time)
    print(f"Active Time Scheduler is running...")
    print(f"   Target API: {API_BASE_URL}")
    print(f"   Daily Time: {SCHEDULE_TIME}")
    print(f"   Press Ctrl+C to stop.")
    while True:
        try:
            schedule.run_pending()
            time.sleep(30)
        except KeyboardInterrupt:
            logging.info("Scheduler stopped by user.")
            print("Scheduler stopped.")
            break
        except Exception as e:
            logging.error(f"Critical scheduler error: {str(e)}")
            time.sleep(60)
