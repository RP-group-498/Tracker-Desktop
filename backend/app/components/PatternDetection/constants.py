#procastination_pattern/constants.py
FOCUS_WINDOWS = {
    "morning":   (6,  12),
    "afternoon": (12, 16),
    "evening":   (16, 21),
    "night":     (21, 24),
}

WEIGHTS = {
    "frequent_task_switching": 3.0,
    "prolonged_inactivity":    2.5,
    "impulsive_browsing":      2.5,
    "deadline_rushing":        2.0,
    "no_engagement":           0.5,
}

SEVERITY_MULTIPLIER = {
    "low":     0.3,
    "medium":  0.6,
    "warning": 0.8,
    "high":    1.0,
}

DEADLINE_THRESHOLD = 5          # days
INACTIVITY_THRESHOLD = 0.5      # flag if academic_in_window < 50% of expected
TASK_SWITCH_DEVIATION = 1.5     # flag if today_switches > baseline × 1.5
