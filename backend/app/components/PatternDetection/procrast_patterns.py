#procastination_pattern/procrast_patterns.py

from .constants import WEIGHTS, TASK_SWITCH_DEVIATION, INACTIVITY_THRESHOLD
from .active_time import _severity_from_ratio

import anthropic


# ─────────────────────────────────────────────
#  AI EXPLANATION ENGINE
# ─────────────────────────────────────────────

def _generate_ai_explanation(
    pattern_type: str,
    severity: str,
    evidence_data: dict,
) -> dict[str, str]:
    """
    Call Claude to generate personalized evidence + exit_strategy strings
    based on the user's actual metrics for this pattern.

    Returns:
        {
            "evidence":      <personalized observation string>,
            "exit_strategy": <personalized actionable advice string>,
        }
    Falls back to safe static strings if the API call fails.
    """

    # ── Build a compact, pattern-specific user-data summary ──────────────────
    data_summary_parts = []

    if pattern_type == "frequent_task_switching":
        data_summary_parts = [
            f"- Today's non-academic app switches: {evidence_data.get('today_switches', 'N/A')}",
            f"- User's 7-day average switches:     {evidence_data.get('baseline_sw', 0):.1f}",
            f"- Detection threshold (×{TASK_SWITCH_DEVIATION}):        "
            f"{evidence_data.get('baseline_sw', 0) * TASK_SWITCH_DEVIATION:.1f}",
            f"- Detected severity:                 {severity}",
        ]

    elif pattern_type == "prolonged_inactivity":
        data_summary_parts = [
            f"- Academic minutes in study window:  {evidence_data.get('academic_in_window', 0)}m",
            f"- Full-day academic minutes:         {evidence_data.get('full_day_academic', 0)}m",
            f"- Daily study goal:                  {evidence_data.get('expected_minutes', 0):.0f}m",
            f"- Focus threshold (window):          {evidence_data.get('focus_threshold', 0):.0f}m",
            f"- Detected severity:                 {severity}",
        ]

    elif pattern_type == "no_engagement":
        data_summary_parts = [
            "- Today is NOT a scheduled study day.",
            f"- Academic minutes recorded: {evidence_data.get('full_day_academic', 0)}m",
            f"- Detected severity: {severity}",
        ]

    elif pattern_type == "impulsive_browsing":
        data_summary_parts = [
            f"- Non-academic minutes in study window: {evidence_data.get('non_academic_in_window', 0)}m",
            f"- User's 7-day non-academic baseline:   {evidence_data.get('baseline_br', 0):.1f}m",
            f"- Ratio above baseline:                 {evidence_data.get('ratio', 1):.2f}×",
            f"- Detected severity:                    {severity}",
        ]

    elif pattern_type == "deadline_rushing":
        data_summary_parts = [
            f"- Task name:                '{evidence_data.get('task_name', 'Unnamed')}'",
            f"- Days until deadline:      {evidence_data.get('days_left', 'N/A')}",
            f"- Total academic minutes:   {evidence_data.get('total_academic', 0)}m",
            f"- Non-academic minutes:     {evidence_data.get('non_academic_total', 0)}m",
            f"- Daily study goal:         {evidence_data.get('expected_minutes', 0):.0f}m",
            f"- Sub-type:                 {evidence_data.get('subtype', 'behind_on_goal')}",
            f"- Detected severity:        {severity}",
        ]

    data_summary = "\n".join(data_summary_parts)

    # ── System prompt ─────────────────────────────────────────────────────────
    system_prompt = (
        "You are a concise, empathetic academic productivity coach embedded in a "
        "study-tracking app. Your job is to generate SHORT, personalized feedback "
        "for a detected procrastination pattern.\n\n"
        "Rules:\n"
        "1. 'evidence'      — 1–2 sentences. State what the data shows in plain English. "
        "   Use the exact numbers provided. Be direct, not alarming.\n"
        "2. 'exit_strategy' — 2–3 sentences. Give concrete, actionable advice tailored "
        "   to the severity and the numbers. Higher severity → more urgent tone.\n"
        "3. Never use markdown, bullet points, or headers — plain text only.\n"
        "4. Respond ONLY with a JSON object with keys 'evidence' and 'exit_strategy'. "
        "   No preamble, no explanation, no backticks.\n"
        "5. Keep both fields under 60 words each."
    )

    # ── User prompt ───────────────────────────────────────────────────────────
    human_prompt = (
        f"Pattern type : {pattern_type}\n"
        f"Severity     : {severity}\n\n"
        f"User metrics :\n{data_summary}\n\n"
        "Generate the JSON now."
    )

    # ── API call ──────────────────────────────────────────────────────────────
    try:
        client   = anthropic.Anthropic()
        response = client.messages.create(
            model      = "claude-sonnet-4-20250514",
            max_tokens = 300,
            system     = system_prompt,
            messages   = [{"role": "user", "content": human_prompt}],
        )
        import json
        raw  = response.content[0].text.strip()
        data = json.loads(raw)
        return {
            "evidence":      data.get("evidence",      _fallback_evidence(pattern_type)),
            "exit_strategy": data.get("exit_strategy", _fallback_exit(pattern_type)),
        }

    except Exception:
        # Graceful degradation — never crash the caller
        return {
            "evidence":      _fallback_evidence(pattern_type),
            "exit_strategy": _fallback_exit(pattern_type),
        }


# ─────────────────────────────────────────────
#  STATIC FALLBACKS  (used if API fails)
# ─────────────────────────────────────────────

def _fallback_evidence(pattern_type: str) -> str:
    return {
        "frequent_task_switching": "You switched between non-academic apps more than usual today.",
        "prolonged_inactivity":    "Your academic activity was below your daily goal today.",
        "no_engagement":           "No academic activity was recorded today.",
        "impulsive_browsing":      "Non-academic app usage exceeded your normal baseline.",
        "deadline_rushing":        "A deadline is approaching and study time is insufficient.",
    }.get(pattern_type, "A procrastination pattern was detected.")


def _fallback_exit(pattern_type: str) -> str:
    return {
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
            "Break remaining work into 2–3 focused sessions today. "
            "Temporarily block non-academic apps during your study window."
        ),
    }.get(pattern_type, "Try to refocus on your academic goals.")


# ─────────────────────────────────────────────
#  MAIN DETECTION FUNCTION
# ─────────────────────────────────────────────

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
    has_activity     = today_active.get("status") in ("ok", "ok_offwindow")

    # ── Pattern 1 — Frequent Task Switching ──────────────────────────────────
    today_switches = today_active.get("nonAcademicAppSwitches", 0)
    prev_vals      = [r.get("nonAcademicAppSwitches", 0) for r in history[-7:]]

    if len(prev_vals) >= 3:
        baseline_sw = sum(prev_vals) / len(prev_vals)
        if baseline_sw > 0 and today_switches > baseline_sw * TASK_SWITCH_DEVIATION:
            intensity = min(
                (today_switches / (baseline_sw * TASK_SWITCH_DEVIATION)) - 1.0, 1.0
            )
            severity = _severity_from_ratio(intensity)

            # ── AI explanation ──
            ai = _generate_ai_explanation(
                pattern_type  = "frequent_task_switching",
                severity      = severity,
                evidence_data = {
                    "today_switches": today_switches,
                    "baseline_sw":    baseline_sw,
                },
            )

            switching_patterns.append(
                {
                    "type":          "frequent_task_switching",
                    "severity":      severity,
                    "evidence":      ai["evidence"],
                    "exit_strategy": ai["exit_strategy"],
                }
            )

    # ── Pattern 2 — Inactivity / No Engagement ───────────────────────────────
    academic_in_window = today_active.get("academicMinutes", 0)
    full_day_academic  = today_active.get("fullDayAcademicMinutes", academic_in_window)

    study_days     = calibration.get("studyDays", ["Mon", "Tue", "Wed", "Thu", "Fri"])
    is_working_day = today_active.get("day", "")[:3] in study_days

    if is_working_day:
        if full_day_academic >= expected_minutes:
            pass  # Daily goal met — no inactivity flag

        else:
            focus_threshold = INACTIVITY_THRESHOLD * expected_minutes

            # Case A — Low focus during study window
            if academic_in_window < focus_threshold:
                focus_ratio = academic_in_window / max(focus_threshold, 1)
                intensity   = max(0.0, 1.0 - focus_ratio)
                severity    = _severity_from_ratio(intensity)

                ai = _generate_ai_explanation(
                    pattern_type  = "prolonged_inactivity",
                    severity      = severity,
                    evidence_data = {
                        "academic_in_window": academic_in_window,
                        "full_day_academic":  full_day_academic,
                        "expected_minutes":   expected_minutes,
                        "focus_threshold":    focus_threshold,
                    },
                )

                inactivity_patterns.append(
                    {
                        "type":          "prolonged_inactivity",
                        "severity":      severity,
                        "evidence":      ai["evidence"],
                        "exit_strategy": ai["exit_strategy"],
                    }
                )

            # Case B — Did okay in window but missed daily goal
            else:
                ratio     = full_day_academic / max(expected_minutes, 1)
                intensity = max(0.0, 1.0 - ratio)
                severity  = _severity_from_ratio(intensity)

                ai = _generate_ai_explanation(
                    pattern_type  = "prolonged_inactivity",
                    severity      = severity,
                    evidence_data = {
                        "academic_in_window": academic_in_window,
                        "full_day_academic":  full_day_academic,
                        "expected_minutes":   expected_minutes,
                        "focus_threshold":    focus_threshold,
                    },
                )

                inactivity_patterns.append(
                    {
                        "type":          "prolonged_inactivity",
                        "severity":      severity,
                        "evidence":      ai["evidence"],
                        "exit_strategy": ai["exit_strategy"],
                    }
                )

    # Case C — Not a study day
    else:
        ai = _generate_ai_explanation(
            pattern_type  = "no_engagement",
            severity      = "low",
            evidence_data = {"full_day_academic": full_day_academic},
        )

        inactivity_patterns.append(
            {
                "type":          "no_engagement",
                "severity":      "low",
                "evidence":      ai["evidence"],
                "exit_strategy": ai["exit_strategy"],
            }
        )

    # ── Pattern 3 — Impulsive Browsing ───────────────────────────────────────
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
                ratio     = non_academic_in_window / baseline_br
                intensity = min((ratio - 1) / 1.5, 1.0)
                severity  = _severity_from_ratio(intensity)

                ai = _generate_ai_explanation(
                    pattern_type  = "impulsive_browsing",
                    severity      = severity,
                    evidence_data = {
                        "non_academic_in_window": non_academic_in_window,
                        "baseline_br":            baseline_br,
                        "ratio":                  ratio,
                    },
                )

                browsing_patterns.append(
                    {
                        "type":          "impulsive_browsing",
                        "severity":      severity,
                        "evidence":      ai["evidence"],
                        "exit_strategy": ai["exit_strategy"],
                    }
                )

    # ── Pattern 4 — Deadline Rushing ─────────────────────────────────────────
    if near_tasks:
        nearest  = min(near_tasks, key=lambda x: x["days_left"])
        days_left = nearest["days_left"]
        name      = nearest.get("task_name", "Unnamed task")

        total_academic     = today_active.get(
            "fullDayAcademicMinutes", today_active.get("totalAcademicMinutes", 0)
        )
        non_academic_total = today_active.get(
            "fullDayNonAcademicMinutes", today_active.get("nonAcademicMinutes", 0)
        )

        if days_left <= 5:
            behind_on_goal          = total_academic < expected_minutes
            distracted_despite_goal = (
                total_academic >= expected_minutes
                and non_academic_total > total_academic
            )

            if behind_on_goal:
                goal_gap  = max(expected_minutes - total_academic, 0)
                intensity = min(goal_gap / max(expected_minutes, 1), 1.0)
                severity  = _severity_from_ratio(intensity)

                ai = _generate_ai_explanation(
                    pattern_type  = "deadline_rushing",
                    severity      = severity,
                    evidence_data = {
                        "task_name":          name,
                        "days_left":          days_left,
                        "total_academic":     total_academic,
                        "non_academic_total": non_academic_total,
                        "expected_minutes":   expected_minutes,
                        "subtype":            "behind_on_goal",
                    },
                )

                deadline_patterns.append(
                    {
                        "type":          "deadline_rushing",
                        "severity":      severity,
                        "evidence":      ai["evidence"],
                        "exit_strategy": ai["exit_strategy"],
                    }
                )

            elif distracted_despite_goal:
                intensity = min(
                    max(non_academic_total / max(total_academic, 1) - 1.0, 0.0), 1.0
                )
                severity = _severity_from_ratio(intensity)

                ai = _generate_ai_explanation(
                    pattern_type  = "deadline_rushing",
                    severity      = severity,
                    evidence_data = {
                        "task_name":          name,
                        "days_left":          days_left,
                        "total_academic":     total_academic,
                        "non_academic_total": non_academic_total,
                        "expected_minutes":   expected_minutes,
                        "subtype":            "distracted_despite_goal",
                    },
                )

                deadline_patterns.append(
                    {
                        "type":          "deadline_rushing",
                        "severity":      severity,
                        "evidence":      ai["evidence"],
                        "exit_strategy": ai["exit_strategy"],
                    }
                )

    return switching_patterns + inactivity_patterns + browsing_patterns + deadline_patterns