#procastination_pattern/procrast_patterns.py

from .constants import WEIGHTS, TASK_SWITCH_DEVIATION, INACTIVITY_THRESHOLD
from .active_time import _severity_from_ratio

_EXIT_STRATEGIES: dict[str, str] = {
    "frequent_task_switching": (
        "Close all non-academic apps before starting a study session. "
        "Use Pomodoro: 25 min focused work, then a scheduled break."
    ),
    "prolonged_inactivity": (
        "Start with just 5 minutes on the smallest task to reduce activation energy. "
        "Review your daily goal and pick one concrete next action."
    ),
    "no_engagement": (
        "Even on rest days, a 15-minute review keeps momentum. "
        "Consider scheduling a light study block for tomorrow."
    ),
    "impulsive_browsing": (
        "Apply the 5-second rule before opening non-academic apps. "
        "Set a 10-minute timer — if you still want to browse after, take a short break first."
    ),
    "deadline_rushing": (
        "Break remaining work into 2-3 focused sessions today. "
        "Temporarily block non-academic apps during your study window."
    ),
}


def _detect_patterns_pure(
    today_active: dict,
    history: list[dict],
    calibration: dict,
    near_tasks: list[dict],
) -> list[dict]:
    """Detect procrastination patterns from MongoDB-sourced data."""
    switching_patterns: list[dict] = []
    inactivity_patterns: list[dict] = []
    browsing_patterns: list[dict] = []
    deadline_patterns: list[dict] = []

    expected_minutes = calibration.get("studyDuration", 2.0) * 60
    has_activity = today_active.get("status") in ("ok", "ok_offwindow")

    # Pattern 1 — Frequent Task Switching
    today_switches = today_active.get("nonAcademicAppSwitches", 0)
    prev_vals = [r.get("nonAcademicAppSwitches", 0) for r in history[-7:]]
    if len(prev_vals) >= 3:
        baseline_sw = sum(prev_vals) / len(prev_vals)
        if baseline_sw > 0 and today_switches > baseline_sw * TASK_SWITCH_DEVIATION:
            intensity = min((today_switches / (baseline_sw * TASK_SWITCH_DEVIATION)) - 1.0, 1.0)
            switching_patterns.append(
                {
                    "type": "frequent_task_switching",
                    "severity": _severity_from_ratio(intensity),
                    "evidence": (
                        f"You made {today_switches} non-academic app switches today vs your "
                        f"{baseline_sw:.1f}-switch baseline "
                        f"(threshold: {baseline_sw * TASK_SWITCH_DEVIATION:.1f})."
                    ),
                    "exit_strategy": _EXIT_STRATEGIES["frequent_task_switching"],
                }
            )

    # Pattern 2 — Inactivity / No Engagement
    academic_in_window = today_active.get("academicMinutes", 0)
    full_day_academic  = today_active.get("fullDayAcademicMinutes", academic_in_window)
    # Trigger if focus-window academic < threshold OR full-day academic < expected
    if (academic_in_window < INACTIVITY_THRESHOLD * expected_minutes
            or full_day_academic < expected_minutes):
        study_days = calibration.get("studyDays", ["Mon", "Tue", "Wed", "Thu", "Fri"])
        is_working_day = today_active.get("day", "")[:3] in study_days
        if is_working_day:
            intensity = max(0.0, 1.0 - (full_day_academic / max(expected_minutes, 1)))
            ratio = full_day_academic / max(expected_minutes, 1)
            inactivity_patterns.append(
                {
                    "type": "prolonged_inactivity",
                    "severity": _severity_from_ratio(intensity),
                    "evidence": (
                        f"Academic time {full_day_academic}m vs expected {int(expected_minutes)}m "
                        f"({ratio:.0%} of goal). Daily goals not completed."
                    ),
                    "exit_strategy": _EXIT_STRATEGIES["prolonged_inactivity"],
                }
            )
        else:
            inactivity_patterns.append(
                {
                    "type": "no_engagement",
                    "severity": "low",
                    "evidence": "No academic activity recorded. Today is not a scheduled study day.",
                    "exit_strategy": _EXIT_STRATEGIES["no_engagement"],
                }
            )

    # Pattern 3 — Impulsive Browsing
    if has_activity:
        non_academic_in_window = today_active.get("nonAcademicMinutes", 0)
        baseline_vals = [
            r["nonAcademicMinutes"]
            for r in history[-7:]
            if r.get("nonAcademicMinutes", 0) > 0
        ]
        if baseline_vals:
            baseline_br = sum(baseline_vals) / len(baseline_vals)
            if baseline_br > 0 and non_academic_in_window >= 1.5 * baseline_br:
                ratio = non_academic_in_window / baseline_br
                intensity = min((ratio - 1) / 1.5, 1.0)
                browsing_patterns.append(
                    {
                        "type": "impulsive_browsing",
                        "severity": _severity_from_ratio(intensity),
                        "evidence": (
                            f"You spent {non_academic_in_window}m on non-academic activity during "
                            f"your study window, vs your {baseline_br:.1f}m baseline "
                            f"({ratio:.1f}× above normal)."
                        ),
                        "exit_strategy": _EXIT_STRATEGIES["impulsive_browsing"],
                    }
                )

    # Pattern 4 — Deadline Rushing
    # Condition: deadline ≤5 days AND academic >= expected AND non-academic > academic
    if near_tasks:
        nearest = min(near_tasks, key=lambda x: x["days_left"])
        days_left = nearest["days_left"]
        name = nearest.get("task_name", "Unnamed task")
        total_academic   = today_active.get("fullDayAcademicMinutes",
                           today_active.get("totalAcademicMinutes", 0))
        non_academic_total = today_active.get("fullDayNonAcademicMinutes",
                             today_active.get("nonAcademicMinutes", 0))
        if days_left <= 5 and total_academic >= expected_minutes and non_academic_total > total_academic:
            intensity = min(non_academic_total / max(total_academic, 1) - 1.0, 1.0)
            intensity = max(intensity, 0.0)
            deadline_patterns.append(
                {
                    "type": "deadline_rushing",
                    "severity": _severity_from_ratio(intensity),
                    "evidence": (
                        f'Task "{name}" is due in {days_left} day(s). '
                        f"Non-academic time ({non_academic_total}m) exceeded academic time "
                        f"({total_academic}m) despite meeting your study goal."
                    ),
                    "exit_strategy": _EXIT_STRATEGIES["deadline_rushing"],
                }
            )

    return switching_patterns + inactivity_patterns + browsing_patterns + deadline_patterns
