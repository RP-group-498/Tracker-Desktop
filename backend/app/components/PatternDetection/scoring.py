def _calculate_score(
    hmm_result: dict | None = None,
    xgb_result: dict | None = None,
    if_result:  dict | None = None,
    today_str:  str  | None = None,
) -> dict:
    """Compute a 0–10 procrastination score from ML signals only.

    Formula (weights normalized, w1+w2+w3 = 1.0):
        raw   = (xgb_probability * 0.5) + ((1 - hmm_focus_probability) * 0.3) + (if_anomaly * 0.2)
        score = min(raw * 10, 10.0)

    When a signal is absent its neutral default is used:
        xgb_result missing → xgb_prob   = 0.0
        hmm_result missing → hmm_focus  = 0.5  (neither focused nor distracted)
        if_result  missing → if_anomaly = 0.0  (no anomaly signal)

    Args:
        hmm_result: Output of HMMDetector.predict().
                    Used key: "focus_probability" (float, 0–1).
        xgb_result: Output of XGBProcrastinationClassifier.predict().
                    Used keys: "probability" (float, 0–1), "label" (str).
        if_result:  Output of IsolationForestDetector.detect().
                    Used key: "anomaly_scores_normalized" (dict[str, float], 0–1).
        today_str:  Date key (YYYY-MM-DD) to look up in if_result.

    Returns:
        Dict with keys:
            score          (float) Final 0–10 procrastination score.
            level          (str)   "low" | "moderate" | "high"
            dominantPattern(str|None) xgb_result["label"], or None if absent.
    """
    xgb_prob   = xgb_result["probability"]                                           if xgb_result is not None else 0.0
    hmm_focus  = hmm_result["focus_probability"]                                     if hmm_result is not None else 0.5
    if_anomaly = if_result["anomaly_scores_normalized"].get(today_str, 0.0)          if (if_result is not None and today_str) else 0.0

    raw   = (xgb_prob * 0.5) + ((1.0 - hmm_focus) * 0.3) + (if_anomaly * 0.2)
    score = round(min(raw * 10.0, 10.0), 1)

    if score < 4.0:
        level = "low"
    elif score < 7.0:
        level = "moderate"
    else:
        level = "high"

    dominant = xgb_result["label"] if xgb_result is not None else None

    return {"score": score, "level": level, "dominantPattern": dominant}
