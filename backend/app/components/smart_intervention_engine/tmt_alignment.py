"""
TMT Alignment Matrix

Maps each intervention to the TMT components it targets.
Values represent alignment strength (0.0 = no alignment, 1.0 = strong alignment).

Research justification for each cell:

POMODORO:
  - Impulsiveness (0.8): Structured time blocks reduce distraction and postpone
    impulse-following (Biwer et al., 2023; Steel et al., 2018; Dizon et al., 2023)
  - Delay (0.7): Creates proximal sub-deadlines every 25 min, reducing temporal
    discounting (Ariely & Wertenbroch, 2002; Zhang & Ma, 2024; Steel, 2007)
  - Expectancy (0.3): Completing short intervals builds self-efficacy through
    mastery experience (Bandura & Schunk, 1981; Schunk, 1990)
  - Value (0.1): Minimal direct effect on perceived task importance

FIVE_SECOND_RULE:
  - Impulsiveness (0.7): Implementation intentions create strategic automaticity
    that overrides impulse (Gollwitzer, 1999; Gollwitzer & Sheeran, 2006;
    Brandstatter et al., 2001; Adriaanse et al., 2011)
  - Delay (0.5): Collapses delay between intention and action
    (Owens et al., 2008; Van Hooft et al., 2005; Sheeran & Webb, 2016)
  - Expectancy (0.3): Starting a task builds momentum and perceived capability
    (Mace et al., 1988; Klassen et al., 2008)
  - Value (0.1): No direct effect on task value

BREATHING:
  - Impulsiveness (0.6): Activates prefrontal executive control, improves
    inhibition and attention (Ma et al., 2017; Laborde et al., 2017;
    Zaccaro et al., 2018; Thayer et al., 2009)
  - Value (0.1): No direct effect on task value
  - Expectancy (0.1): Minimal direct effect
  - Delay (0.1): Minimal direct effect
  Note: Primary mechanism is through emotion regulation. Procrastination
  involves impulsive mood repair (Sirois & Pychyl, 2013; Tice et al., 2001).
  Breathing reduces negative affect that drives impulsive avoidance
  (Atalay & Pendy, 2020; Rad et al., 2023).

VISUALIZATION:
  - Expectancy (0.7): Imagining successful completion increases self-efficacy
    (Bandura, 1977; Maddux & Kleiman, 2021; Ruvolo & Markus, 1992;
    Beauchamp et al., 2002)
  - Value (0.5): Makes future rewards feel concrete and emotionally salient
    (Renner et al., 2019; Bar et al., 2022; Benoit et al., 2011)
  - Delay (0.4): Episodic future thinking reduces delay discounting
    (Peters & Buchel, 2010; Daniel et al., 2013; Ye et al., 2022 meta-analysis)
  - Impulsiveness (0.1): Minimal direct effect on impulse control

REFRAME:
  - Value (0.8): Connecting tasks to personal goals increases perceived value
    (Hulleman & Harackiewicz, 2009; Yeager et al., 2014; Harackiewicz &
    Priniski, 2018; Canning et al., 2018)
  - Expectancy (0.4): Changing negative self-talk improves self-efficacy
    (Bandura, 1993; Li et al., 2020; Waschle et al., 2014)
  - Impulsiveness (0.3): High-level construal reduces preference for
    immediate rewards (Fujita et al., 2006)
  - Delay (0.2): Minimal direct effect on temporal discounting
"""

import logging
import numpy as np

logger = logging.getLogger(__name__)

# Actions in fixed order — must match ACTIONS in bandit.py
ACTIONS = ["POMODORO", "FIVE_SECOND_RULE", "BREATHING", "VISUALIZATION", "REFRAME"]

# TMT Alignment Matrix: rows = actions, columns = [E, V, I, D]
# Each row encodes how strongly an intervention targets each TMT component.
# Values are grounded in the research literature cited in the module docstring.
TMT_ALIGNMENT = np.array([
    # Expectancy  Value  Impulsiveness  Delay
    [0.3,         0.1,   0.8,           0.7],   # POMODORO
    [0.3,         0.1,   0.7,           0.5],   # FIVE_SECOND_RULE
    [0.1,         0.1,   0.6,           0.1],   # BREATHING
    [0.7,         0.5,   0.1,           0.4],   # VISUALIZATION
    [0.4,         0.8,   0.3,           0.2],   # REFRAME
], dtype=float)


def compute_relevance_scores(
    deficit_E: float,
    deficit_V: float,
    deficit_I: float,
    deficit_D: float,
) -> dict:
    """
    Compute a relevance score for each intervention based on how well
    it matches the current TMT deficit profile.

    Uses a matrix-vector product: each intervention's alignment weights
    are dotted with the current deficit vector. Interventions that strongly
    target the user's dominant deficit receive higher scores.

    Args:
        deficit_E: 1.0 - expectancy (higher = more expectancy deficit)
        deficit_V: 1.0 - value (higher = more value deficit)
        deficit_I: impulsiveness value (higher = more impulsiveness deficit)
        deficit_D: delay value (higher = more delay deficit)

    Returns:
        Dict mapping action name to relevance score (higher = better match)
    """
    deficit_vector = np.array([deficit_E, deficit_V, deficit_I, deficit_D], dtype=float)

    # Matrix-vector product: scores[i] = sum(TMT_ALIGNMENT[i, j] * deficit_vector[j])
    scores = TMT_ALIGNMENT @ deficit_vector

    result = {action: float(score) for action, score in zip(ACTIONS, scores)}

    logger.debug(
        "Relevance scores computed: deficit=[E=%.3f, V=%.3f, I=%.3f, D=%.3f] scores=%s",
        deficit_E, deficit_V, deficit_I, deficit_D, result,
    )

    return result
