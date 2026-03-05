"""MCDM (Multi-Criteria Decision Making) calculation utilities."""

from typing import Tuple


def calculate_urgency_score(days_left: int) -> int:
    """
    Calculate urgency score based on days remaining.

    Args:
        days_left: Number of days until deadline

    Returns:
        Urgency score (0-100)
    """
    if days_left <= 1:
        return 100
    elif days_left <= 3:
        return 80
    elif days_left <= 7:
        return 60
    elif days_left <= 14:
        return 40
    else:
        return 20


def calculate_impact_score(credits: int, weight_percentage: int) -> int:
    """
    Calculate impact score using hybrid logic.

    Args:
        credits: Module credits (1-4)
        weight_percentage: Assignment weight percentage

    Returns:
        Impact score (0-100)
    """
    raw_impact = credits * (weight_percentage / 100)

    if raw_impact >= 2.0:
        return 100  # Maximum Critical
    elif raw_impact >= 1.5:
        return 90   # Very High
    elif raw_impact >= 1.0:
        return 75   # High
    elif raw_impact >= 0.5:
        return 50   # Moderate
    elif raw_impact < 0.2:
        return 10   # Negligible
    else:
        return int(raw_impact * 50)  # Formula for in-between values


def calculate_difficulty_score(difficulty_rating: int) -> int:
    """
    Normalize difficulty rating to 0-100 scale.

    Args:
        difficulty_rating: Difficulty on 1-5 scale

    Returns:
        Normalized difficulty score (0-100)
    """
    return difficulty_rating * 20


def calculate_final_score(urgency: int, impact: int, difficulty: int) -> float:
    """
    Calculate final MCDM weighted score.

    Args:
        urgency: Urgency score (0-100)
        impact: Impact score (0-100)
        difficulty: Difficulty score (0-100)

    Returns:
        Final weighted score
    """
    return (urgency * 0.50) + (impact * 0.30) + (difficulty * 0.20)


def get_priority_label(final_score: float) -> str:
    """
    Assign priority label based on final score.

    Args:
        final_score: Final MCDM score

    Returns:
        Priority label: "High", "Medium", or "Low"
    """
    if final_score >= 70:
        return "High"
    elif final_score >= 40:
        return "Medium"
    else:
        return "Low"


def validate_mcdm_calculation(
    days_left: int,
    credits: int,
    weight_percentage: int,
    difficulty_rating: int
) -> Tuple[int, int, int, float, str]:
    """
    Validate MCDM calculation for given inputs.

    Args:
        days_left: Days until deadline
        credits: Module credits (1-4)
        weight_percentage: Assignment weight percentage
        difficulty_rating: Difficulty rating (1-5)

    Returns:
        Tuple of (urgency_score, impact_score, difficulty_score, final_score, priority_label)
    """
    urgency = calculate_urgency_score(days_left)
    impact = calculate_impact_score(credits, weight_percentage)
    difficulty = calculate_difficulty_score(difficulty_rating)
    final = calculate_final_score(urgency, impact, difficulty)
    priority = get_priority_label(final)

    return urgency, impact, difficulty, final, priority
