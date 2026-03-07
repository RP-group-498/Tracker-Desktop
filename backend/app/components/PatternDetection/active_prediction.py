#patternDetection/active_prediction.py

from datetime import datetime, timedelta

from .active_time import _minutes_to_time


def _compute_prediction_pure(history: list[dict], effective_date) -> "dict | None":
    """Next-day prediction from last 7 active_time docs with status=ok.
    Returns None if fewer than 3 valid days exist.
    """
    valid = [h for h in history if h.get("status") == "ok"]
    if len(valid) < 3:
        return None

    starts, durations, academic_mins = [], [], []
    fmt = "%I:%M %p"

    for doc in valid:
        s_str, e_str = doc.get("activeStart"), doc.get("activeEnd")
        if not s_str or not e_str:
            continue
        try:
            s = datetime.strptime(s_str, fmt)
            e = datetime.strptime(e_str, fmt)
            s_m = s.hour * 60 + s.minute
            e_m = e.hour * 60 + e.minute

            dur = e_m - s_m
            if dur <= 0:
                dur += 1440  # crossing midnight support

            starts.append(s_m)
            durations.append(dur)
            academic_mins.append(int(doc.get("academicMinutes", 0) or 0))

        except (ValueError, TypeError):
            continue

    if len(starts) < 3:
        return None

    avg_start = int(sum(starts) / len(starts))
    avg_duration = int(sum(durations) / len(durations))
    avg_end = avg_start + avg_duration

    next_date = effective_date + timedelta(days=1)
    return {
        "date": next_date.strftime("%Y-%m-%d"),
        "day": next_date.strftime("%A"),
        "predictedActiveStart": _minutes_to_time(avg_start),
        "predictedActiveEnd": _minutes_to_time(avg_end),
        "predictedAcademicMinutes": int(round(sum(academic_mins) / len(academic_mins))),
        "source": "7_day_behavior_prediction",
    }
