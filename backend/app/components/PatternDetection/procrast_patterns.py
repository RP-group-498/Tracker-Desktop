from .constants import WEIGHTS, TASK_SWITCH_DEVIATION, INACTIVITY_THRESHOLD
from .active_time import _severity_from_ratio


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
    has_activity = today_active.get("status") == "ok"

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
                }
            )

    # Pattern 2 — Inactivity / No Engagement
    academic_in_window = today_active.get("academicMinutes", 0)
    if academic_in_window < INACTIVITY_THRESHOLD * expected_minutes:
        total_academic = today_active.get("totalAcademicMinutes", 0)
        if total_academic < expected_minutes:
            study_days = calibration.get("studyDays", ["Mon", "Tue", "Wed", "Thu", "Fri"])
            is_working_day = today_active.get("day", "")[:3] in study_days
            if is_working_day:
                intensity = max(0.0, 1.0 - (academic_in_window / max(expected_minutes, 1)))
                ratio = academic_in_window / max(expected_minutes, 1)
                inactivity_patterns.append(
                    {
                        "type": "prolonged_inactivity",
                        "severity": _severity_from_ratio(intensity),
                        "evidence": (
                            f"Only {academic_in_window}m of academic work recorded in your focus "
                            f"window ({ratio:.0%} of expected {int(expected_minutes)}m)."
                        ),
                    }
                )
            else:
                inactivity_patterns.append(
                    {
                        "type": "no_engagement",
                        "severity": "low",
                        "evidence": "No academic activity recorded. Today is not a scheduled study day.",
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
                    }
                )

    # Pattern 4 — Deadline Rushing
    if near_tasks:
        nearest = min(near_tasks, key=lambda x: x["days_left"])
        days_left = nearest["days_left"]
        name = nearest.get("task_name", "Unnamed task")
        total_academic = today_active.get("totalAcademicMinutes", 0)
        if total_academic >= expected_minutes:
            inside_academic = today_active.get("academicMinutes", 0)
            outside_academic = total_academic - inside_academic
            if outside_academic > inside_academic:
                intensity = outside_academic / max(total_academic, 1)
                deadline_patterns.append(
                    {
                        "type": "deadline_rushing",
                        "severity": _severity_from_ratio(intensity),
                        "evidence": (
                            f'Task "{name}" is due in {days_left} day(s). '
                            f"{outside_academic}m of academic work was done outside your normal "
                            "study window, suggesting last-minute cramming."
                        ),
                    }
                )

    return switching_patterns + inactivity_patterns + browsing_patterns + deadline_patterns
