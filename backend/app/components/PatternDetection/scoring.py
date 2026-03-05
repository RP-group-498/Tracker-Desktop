from .constants import WEIGHTS, SEVERITY_MULTIPLIER


def _calculate_score(patterns: list[dict]) -> dict:
    """Convert detected patterns into a 0–10 score with level and dominant pattern."""
    score = 0.0
    dominant = None
    max_contribution = 0.0

    for p in patterns:
        weight = WEIGHTS.get(p["type"], 0.0)
        multiplier = SEVERITY_MULTIPLIER.get(p.get("severity", "low"), 0.3)
        contribution = weight * multiplier
        score += contribution
        if contribution > max_contribution:
            max_contribution = contribution
            dominant = p["type"]

    score = round(min(score, 10.0), 1)

    if score < 3:
        level = "Low Procrastination"
    elif score < 6:
        level = "Moderate Procrastination"
    elif score < 8:
        level = "Moderate-High Procrastination"
    else:
        level = "High Procrastination"

    return {"score": score, "level": level, "dominantPattern": dominant}
