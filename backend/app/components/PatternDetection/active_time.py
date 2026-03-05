from datetime import datetime

from .constants import FOCUS_WINDOWS
from .types import BehaviorRecord


def _minutes_to_time(m: int) -> str:
    """Convert total-minutes-from-midnight to a 12-hour clock string."""
    h = (m // 60) % 24
    mins = m % 60
    return datetime(2000, 1, 1, h, mins).strftime("%I:%M %p")


def _severity_from_ratio(r: float) -> str:
    if r < 0.3:
        return "low"
    elif r < 0.6:
        return "medium"
    elif r < 0.8:
        return "warning"
    else:
        return "high"


def _detect_active_time_pure(
    records: list[BehaviorRecord],
    calibration: dict,
    today_str: str,
    day_str: str,
) -> dict:
    """Sliding-window active time detection.

    - Focus-window fields:
        academicMinutes / nonAcademicMinutes (+ switches)
      NOTE: "productivity" is NOT counted as "academic".
      (Productivity inside the focus window is currently counted under non-academic
       unless you later add separate focus-window productivity fields.)

    - Full-day (24h) summary fields:
        fullDayAcademicMinutes / fullDayProductivityMinutes / fullDayNonAcademicMinutes
        + full-day switches for each bucket
    """
    focus = calibration.get("focusPeriod", "morning")
    expected_hours = calibration.get("studyDuration", 2.0)
    expected_min = int(expected_hours * 60)
    start_h, end_h = FOCUS_WINDOWS.get(focus, (6, 12))

    # Full-day totals (24h) computed from ALL records (3 buckets)
    full_day_academic = sum(r.time_spent_minutes for r in records if r.category == "academic")
    full_day_productivity = sum(r.time_spent_minutes for r in records if r.category == "productivity")
    full_day_non_academic = sum(r.time_spent_minutes for r in records if r.category == "non-academic")

    full_day_acad_switches = sum(r.app_switch_count for r in records if r.category == "academic")
    full_day_prod_switches = sum(r.app_switch_count for r in records if r.category == "productivity")
    full_day_non_acad_switches = sum(r.app_switch_count for r in records if r.category == "non-academic")
    full_day_total_switches = sum(r.app_switch_count for r in records)

    def no_logs(reason: str) -> dict:
        return {
            "date": today_str,
            "day": day_str,
            "status": "no_logs",
            "activeStart": None,
            "activeEnd": None,
            "academicMinutes": 0,
            "nonAcademicMinutes": 0,
            "academicAppSwitches": 0,
            "nonAcademicAppSwitches": 0,
            "totalAppSwitches": 0,

            # (keep if other code expects it)
            "totalAcademicMinutes": 0,

            # Full-day summary (24h)
            "fullDayAcademicMinutes": 0,
            "fullDayProductivityMinutes": 0,
            "fullDayNonAcademicMinutes": 0,
            "fullDayAcademicAppSwitches": 0,
            "fullDayProductivityAppSwitches": 0,
            "fullDayNonAcademicAppSwitches": 0,
            "fullDayTotalAppSwitches": 0,

            "expectedStudyMinutes": expected_min,
            "reason": reason,
        }

    if not records:
        return no_logs("No activity found for this date")

    window_records = [r for r in records if start_h <= r.session_start.hour < end_h]
    if not window_records:
        out = no_logs("Logs exist but none inside focus window")

        # still include full-day totals
        out["fullDayAcademicMinutes"] = int(round(full_day_academic))
        out["fullDayProductivityMinutes"] = int(round(full_day_productivity))
        out["fullDayNonAcademicMinutes"] = int(round(full_day_non_academic))
        out["fullDayAcademicAppSwitches"] = int(full_day_acad_switches)
        out["fullDayProductivityAppSwitches"] = int(full_day_prod_switches)
        out["fullDayNonAcademicAppSwitches"] = int(full_day_non_acad_switches)
        out["fullDayTotalAppSwitches"] = int(full_day_total_switches)

        # keep legacy field consistent with "academic only"
        out["totalAcademicMinutes"] = int(round(full_day_academic))
        return out

    window_min = float(expected_min)
    window_max = float(expected_min + 60)

    best_score = -1.0
    best_start = None
    best_end = None
    best_academic = 0.0
    best_non_academic = 0.0
    best_acad_switches = 0
    best_non_acad_switches = 0
    best_total_switches = 0

    # Sliding window: maximize (academic - non-academic)
    # NOTE: productivity is not academic; by default we treat it as non-academic
    # for the purpose of finding the "best study window".
    for i in range(len(window_records)):
        start_time = window_records[i].session_start
        academic = 0.0
        non_academic = 0.0
        acad_sw = 0
        non_acad_sw = 0
        total_sw = 0

        for j in range(i, len(window_records)):
            row = window_records[j]
            end_time = row.session_end
            duration = (end_time - start_time).total_seconds() / 60.0

            if duration > window_max:
                break

            if row.category == "academic":
                academic += row.time_spent_minutes
                acad_sw += row.app_switch_count
            else:
                # non-academic + productivity bucket for focus-window scoring
                non_academic += row.time_spent_minutes
                non_acad_sw += row.app_switch_count

            total_sw += row.app_switch_count
            score = academic - non_academic

            if duration >= window_min and score > best_score:
                best_score = score
                best_start = start_time
                best_end = end_time
                best_academic = academic
                best_non_academic = non_academic
                best_acad_switches = acad_sw
                best_non_acad_switches = non_acad_sw
                best_total_switches = total_sw

    # Fallback: no window met minimum duration — use whole focus period totals
    if best_start is None:
        best_academic = sum(r.time_spent_minutes for r in window_records if r.category == "academic")
        # treat productivity as non-academic for this summary (see note above)
        best_non_academic = sum(r.time_spent_minutes for r in window_records if r.category != "academic")

        best_acad_switches = sum(r.app_switch_count for r in window_records if r.category == "academic")
        best_non_acad_switches = sum(r.app_switch_count for r in window_records if r.category != "academic")
        best_total_switches = sum(r.app_switch_count for r in window_records)

        best_start = window_records[0].session_start
        best_end = window_records[-1].session_end

    return {
        "date": today_str,
        "day": day_str,
        "status": "ok",
        "activeStart": best_start.strftime("%I:%M %p"),
        "activeEnd": best_end.strftime("%I:%M %p"),

        # Focus-window totals
        "academicMinutes": int(round(best_academic)),
        "nonAcademicMinutes": int(round(best_non_academic)),
        "academicAppSwitches": int(best_acad_switches),
        "nonAcademicAppSwitches": int(best_non_acad_switches),
        "totalAppSwitches": int(best_total_switches),

        # Full-day summary (24h)
        "fullDayAcademicMinutes": int(round(full_day_academic)),
        "fullDayProductivityMinutes": int(round(full_day_productivity)),
        "fullDayNonAcademicMinutes": int(round(full_day_non_academic)),
        "fullDayAcademicAppSwitches": int(full_day_acad_switches),
        "fullDayProductivityAppSwitches": int(full_day_prod_switches),
        "fullDayNonAcademicAppSwitches": int(full_day_non_acad_switches),
        "fullDayTotalAppSwitches": int(full_day_total_switches),

        # legacy: now strictly academic-only full day
        "totalAcademicMinutes": int(round(full_day_academic)),

        "expectedStudyMinutes": expected_min,
    }
