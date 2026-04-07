# TMT-Driven Intervention System Redesign -- Claude Code Implementation Guide

## Purpose

This document is a complete implementation guide for redesigning the Smart Intervention Engine. The current system has three fundamental problems:

1. **Arbitrary composite formulas** with unjustifiable coefficients (e.g., `value = 0.5 * priority + 0.3 * grade_weight + 0.2 * time_ratio`)
2. **Redundant context features** (e.g., `delay` and `deadline_urgency = 1 - delay` are the same information)
3. **LinUCB insensitivity** to changing user behavior because the context vector lacks intervention history and the algorithm treats all past observations equally

The redesign replaces the current approach with a four-layer TMT-grounded architecture: raw behavioral measurement, single-proxy TMT mapping, relative deficit identification (no arbitrary thresholds), and deficit-weighted intervention selection via Discounted LinUCB.

Read this entire document before writing any code. Implement changes incrementally, verifying each step compiles/runs before proceeding.

---

## Architecture Overview

```
Layer 1: Behavioral Measurement (raw signals from tracker, no composites)
    |
    v
Layer 2: TMT Proxy Mapping (one clean proxy per TMT component)
    |
    v
Layer 3: Relative Deficit Identification (argmax, no thresholds)
    |
    v
Layer 4: Deficit-Weighted LinUCB Selection (alignment matrix + discounted bandit)
```

---

## PHASE 1: Remove Existing Logic

### Step 1.1: Remove old context vector construction

**File:** `electron/src/utils/contextBuilder.ts`

Remove the entire existing context vector construction logic. The current 12-element vector with these indices must be fully replaced:

```
REMOVE THESE (old indices 0-11):
[0] bias = 1
[1] expectancy = completed_tasks / (assigned_tasks + 1)
[2] value = 0.5 * priority + 0.3 * grade_weight + 0.2 * time_ratio    <-- arbitrary weights
[3] impulsiveness = 0.5 * app_switch_rate + 0.5 * non_academic_ratio
[4] delay = hours_to_deadline / (1 + hours_to_deadline)
[5] overdue_flag = 1 if deadline passed, else 0
[6] motivation = clamp((expectancy * value) / (1 + impulsiveness * delay), 0, 1)
[7] app_switch_rate = min(total_transitions / 100, 1.0)
[8] tab_switch_rate = 0 (placeholder)
[9] non_academic_ratio = non_academic_transitions / (total_transitions + 1)
[10] idle_ratio = 0 (placeholder)
[11] deadline_urgency = 1 - delay    <-- redundant with [4]
```

Do NOT delete the file. Clear the body of the main context-building function and leave it as a stub that returns an empty array. We will rebuild it in Phase 2.

### Step 1.2: Remove old trigger conditions

**File:** `electron/src/renderer/src/utils/triggerDetector.ts`

Remove the entire `shouldTrigger()` function body and all threshold constants:

```
REMOVE THESE RULES:
- non_academic_ratio > 0.35
- switching_score > 0.60
- deadline_urgency > 0.60 AND motivation < 0.40
- overdue_flag == 1
- idle_ratio > 0.40
```

Replace with a stub that returns `true` (we will implement the new trigger logic in Phase 3). Add a comment: `// Old threshold-based triggers removed. New TMT deficit-based trigger in Phase 3.`

### Step 1.3: Remove old action filtering by urgency

**File:** `electron/src/renderer/src/utils/triggerDetector.ts` or wherever action filtering lives

Remove the urgency-based hard filtering:

```
REMOVE THIS LOGIC:
- urgency >= 0.7: only FIVE_SECOND_RULE, POMODORO, REFRAME
- urgency 0.3-0.7: above + BREATHING
- urgency < 0.3: all five actions
```

This will be replaced by deficit-weighted soft filtering in Phase 4.

### Step 1.4: Update backend schema for new dimension

**File:** `backend/app/components/smart_intervention_engine/schemas.py`

Find the Pydantic model that validates the context vector (likely a `List[float]` with length validation). Change the expected length from 12 to 9. Add a comment block documenting the new indices (defined in Phase 2 below).

### Step 1.5: Handle dimension migration in bandit

**File:** `backend/app/components/smart_intervention_engine/bandit.py`

Add migration logic: when loading an existing arm from MongoDB (`bandit_models`), check the dimension of the stored `A` matrix. If it is 12x12 (old) or any size other than 9x9 (new), reinitialize that arm:
- Set `A` to 9x9 identity matrix
- Set `b` to 9-element zero vector
- Set `n_updates` to 0
- Log a warning: `"Reinitialized arm {action} for user {user_id}: dimension mismatch (was {old_dim}, now 9)"`

This ensures the system does not crash when encountering old model data.

---

## PHASE 2: Build New Context Vector (Layer 1 + Layer 2)

### Step 2.1: Define raw behavioral signals

These are the raw measurable inputs. Each one comes directly from your existing data sources with no composite formulas.

Create a new TypeScript interface in `electron/src/utils/contextBuilder.ts`:

```typescript
interface RawBehavioralSignals {
  // From task database
  task_completion_rate: number;    // completed_tasks / (assigned_tasks + 1)
  task_time_ratio: number;        // time_spent_on_task / estimated_time, capped at 2.0
  task_priority: number;          // user-assigned, normalized 0-1
  grade_weight: number;           // user-assigned, normalized 0-1
  hours_to_deadline: number;      // hours remaining, negative if overdue

  // From activity tracker (over last 15-minute sliding window)
  non_academic_ratio: number;     // non_academic_time / total_active_time
  app_switch_frequency: number;   // transitions per minute

  // Session context
  session_duration_minutes: number;  // minutes since monitoring started
  current_hour: number;              // 0-23
}
```

Implement the data collection for each signal. Use existing data sources:
- `task_completion_rate`: query from task database (same source as old `expectancy`)
- `task_time_ratio`: current task's spent time / estimated time. If no active task or no estimate, default to 0.5. Cap at 2.0.
- `task_priority` and `grade_weight`: from task database, already normalized 0-1
- `hours_to_deadline`: from task database. Use the nearest upcoming deadline. If no deadline, default to 168 (1 week).
- `non_academic_ratio`: from activity classifications over a 15-minute sliding window (not point-in-time)
- `app_switch_frequency`: count transitions in the last 15 minutes, divide by 15 to get per-minute rate
- `session_duration_minutes`: track when monitoring started, compute elapsed minutes
- `current_hour`: `new Date().getHours()`

### Step 2.2: Map to TMT proxy components

Create a function `computeTMTProxies(signals: RawBehavioralSignals)` that returns:

```typescript
interface TMTProxies {
  expectancy: number;     // 0-1, higher = more confident
  value: number;          // 0-1, higher = more important
  impulsiveness: number;  // 0-1, higher = more distracted
  delay: number;          // 0-1, higher = further from deadline
}
```

**Expectancy proxy:** Use `task_completion_rate` directly.
```
E = task_completion_rate
```
Justification: Past task success predicts self-efficacy (Bandura, 1977; Klassen et al., 2008). One signal, no composite.
Default if no tasks exist: 0.5

**Value proxy:** Use the maximum of priority and grade weight.
```
V = max(task_priority, grade_weight)
```
Justification: A task is valuable if it matters for ANY reason. Using max() avoids arbitrary weighting between two indicators of the same construct (Wigfield & Eccles, 2000).
Default if no active task: 0.3

**Impulsiveness proxy:** Use `non_academic_ratio` directly.
```
I = non_academic_ratio
```
Justification: Proportion of time on distracting activities directly measures susceptibility to off-task impulses (Steel, 2007). One signal, no composite. We use `non_academic_ratio` alone rather than blending with `app_switch_frequency` because both measure the same construct and blending would reintroduce arbitrary weights.
Default if no activity data: 0.0

**Delay proxy:** Normalize hours to deadline.
```
if hours_to_deadline <= 0:
    D = 0.0    // overdue = no delay, deadline arrived
else:
    D = hours_to_deadline / (1 + hours_to_deadline)
```
Justification: Hyperbolic normalization maps to TMT's delay discounting curve (Mazur, 1987; Steel, 2007). D approaches 1.0 for far deadlines, 0.0 for imminent/overdue ones.
Default if no deadline: 0.8

### Step 2.3: Compute TMT motivation score and build context vector

```typescript
function buildContextVector(proxies: TMTProxies, signals: RawBehavioralSignals): number[] {
  const M = (proxies.expectancy * proxies.value) /
            (1 + proxies.impulsiveness * proxies.delay);
  const M_clamped = Math.max(0, Math.min(1, M));

  // Deficit scores: how far each component is from ideal
  const deficit_E = 1.0 - proxies.expectancy;    // low completion = high deficit
  const deficit_V = 1.0 - proxies.value;          // low value = high deficit
  const deficit_I = proxies.impulsiveness;         // high impulsiveness = high deficit
  const deficit_D = proxies.delay;                 // high delay = high deficit

  // Dominant deficit (index: 0=E, 1=V, 2=I, 3=D)
  const deficits = [deficit_E, deficit_V, deficit_I, deficit_D];
  const max_deficit = Math.max(...deficits);
  const dominant_index = deficits.indexOf(max_deficit);
  // Encode as normalized ordinal: 0.0, 0.33, 0.67, 1.0
  const deficit_code = dominant_index / 3.0;

  // Contextual features
  const session_norm = Math.min(signals.session_duration_minutes / 240, 1.0);
  const time_of_day = signals.current_hour / 24.0;

  return [
    1.0,                    // [0] bias
    proxies.expectancy,     // [1] E proxy
    proxies.value,          // [2] V proxy
    proxies.impulsiveness,  // [3] I proxy
    proxies.delay,          // [4] D proxy
    M_clamped,              // [5] TMT motivation score
    deficit_code,           // [6] dominant deficit (ordinal encoded)
    session_norm,           // [7] session duration (fatigue proxy)
    time_of_day             // [8] time of day (circadian)
  ];
}
```

This produces a **9-element context vector** with zero redundancy. Every element is either a TMT component, a derived TMT quantity, or a justified contextual factor.

### Step 2.4: Update backend to accept 9-element vector

**File:** `backend/app/components/smart_intervention_engine/schemas.py`

Update the context field validation to expect exactly 9 elements. Add this documentation comment:

```python
# Context vector (9 elements):
# [0] bias           - always 1.0
# [1] expectancy     - TMT E proxy (task_completion_rate)
# [2] value          - TMT V proxy (max(task_priority, grade_weight))
# [3] impulsiveness  - TMT I proxy (non_academic_ratio)
# [4] delay          - TMT D proxy (hours_to_deadline normalized)
# [5] motivation     - TMT score: (E*V) / (1 + I*D)
# [6] deficit_code   - dominant TMT deficit (ordinal: 0.0/0.33/0.67/1.0)
# [7] session_dur    - session duration normalized (0-1, caps at 4h)
# [8] time_of_day    - current hour / 24
```

**File:** `backend/app/components/smart_intervention_engine/bandit.py`

Update the dimension constant: `d = 9`
Make sure the identity matrix initialization uses `np.eye(9)` and zero vector uses `np.zeros(9)`.

---

## PHASE 3: New Trigger Mechanism (Layer 3)

### Step 3.1: Replace threshold triggers with TMT-based trigger

**File:** `electron/src/renderer/src/utils/triggerDetector.ts`

The new trigger logic uses the TMT motivation score instead of multiple threshold rules. An intervention should fire when motivation is low enough that the user is likely procrastinating.

```typescript
function shouldTrigger(context: number[]): boolean {
  const motivation = context[5];    // TMT motivation score
  const impulsiveness = context[3]; // TMT I proxy

  // Trigger when motivation is low OR impulsiveness is notably high
  // relative to the user's own motivation level
  //
  // Primary condition: motivation below 0.4
  // This single threshold replaces the five old rules.
  // Justification: TMT predicts procrastination when motivation
  // drops below a task-engagement threshold. 0.4 is conservative
  // and acknowledged as a tunable hyperparameter.
  if (motivation < 0.4) return true;

  // Secondary condition: high impulsiveness even with moderate motivation
  // Catches cases where E and V are high but the user is still
  // switching to distractions frequently
  if (impulsiveness > 0.5 && motivation < 0.6) return true;

  return false;
}
```

**Important note for the paper:** Acknowledge that the 0.4 and 0.5 thresholds are tunable hyperparameters. The key improvement over the old system is that there are only 2 conditions on TMT-meaningful constructs instead of 5 conditions on raw signals. These thresholds could be optimized through empirical evaluation.

### Step 3.2: Keep existing cooldown and context hashing

The cooldown system (`cooldownManager.ts`) and duplicate suppression (`contextHasher.ts`) are sound mechanisms. Do NOT remove them. They remain as-is.

Update `contextHasher.ts` to hash a 9-element array instead of 12 (should work automatically if it hashes the array generically, but verify).

---

## PHASE 4: Deficit-Weighted Intervention Selection (Layer 4)

### Step 4.1: Define the TMT alignment matrix

This is the core mapping between interventions and TMT components. Each value represents how strongly an intervention targets a specific TMT component. These values are justified by the research literature cited below.

**File:** Create a new file `backend/app/components/smart_intervention_engine/tmt_alignment.py`

```python
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

import numpy as np

# Actions in fixed order
ACTIONS = ["POMODORO", "FIVE_SECOND_RULE", "BREATHING", "VISUALIZATION", "REFRAME"]

# TMT Alignment Matrix: rows = actions, columns = [E, V, I, D]
# Each row sums the alignment weights for that action across TMT components
TMT_ALIGNMENT = np.array([
    # Expectancy  Value  Impulsiveness  Delay
    [0.3,         0.1,   0.8,           0.7],   # POMODORO
    [0.3,         0.1,   0.7,           0.5],   # FIVE_SECOND_RULE
    [0.1,         0.1,   0.6,           0.1],   # BREATHING
    [0.7,         0.5,   0.1,           0.4],   # VISUALIZATION
    [0.4,         0.8,   0.3,           0.2],   # REFRAME
])


def compute_relevance_scores(deficit_E: float, deficit_V: float,
                              deficit_I: float, deficit_D: float) -> dict:
    """
    Compute a relevance score for each intervention based on how well
    it matches the current TMT deficit profile.

    Args:
        deficit_E: 1.0 - expectancy (higher = worse)
        deficit_V: 1.0 - value (higher = worse)
        deficit_I: impulsiveness (higher = worse)
        deficit_D: delay (higher = worse)

    Returns:
        Dict mapping action name to relevance score (higher = better match)
    """
    deficit_vector = np.array([deficit_E, deficit_V, deficit_I, deficit_D])

    # Matrix-vector product: each action gets a score based on how well
    # its TMT alignment matches the current deficit profile
    scores = TMT_ALIGNMENT @ deficit_vector

    return {action: float(score) for action, score in zip(ACTIONS, scores)}
```

### Step 4.2: Implement Discounted LinUCB

**File:** `backend/app/components/smart_intervention_engine/bandit.py`

Replace the standard LinUCB update with a discounted version. The key change is multiplying A and b by gamma before each update.

```python
# At the top of the file or in the class constructor
GAMMA = 0.995  # Discount factor for non-stationary behavior
                # Older observations are exponentially down-weighted
                # so the model adapts to changing user behavior.
                # 0.995 means ~60% weight remains after 100 updates.

MIN_DIAGONAL = 0.01  # Regularization floor to prevent matrix degeneration
```

In the update method, change from:

```python
# OLD (remove this):
A = A + x @ x.T
b = b + reward * x
```

To:

```python
# NEW (discounted update):
A = GAMMA * A + np.outer(x, x)
b = GAMMA * b + reward * x

# Regularization: prevent matrix degeneration from repeated discounting
if np.min(np.diag(A)) < MIN_DIAGONAL:
    A += MIN_DIAGONAL * np.eye(len(x))
```

### Step 4.3: Integrate relevance scores into selection

**File:** `backend/app/api/intervention.py` (or wherever the bandit select endpoint is)

Modify the bandit selection endpoint to:

1. Extract deficit scores from the context vector
2. Compute relevance scores using the TMT alignment matrix
3. Use relevance scores to weight the LinUCB UCB scores

```python
from app.components.smart_intervention_engine.tmt_alignment import (
    compute_relevance_scores, ACTIONS
)

# In the select endpoint handler:

def select_intervention(context: list[float], user_id: str, alpha: float = 0.5):
    """
    Select the best intervention using deficit-weighted LinUCB.

    The context vector is 9 elements:
    [0] bias, [1] E, [2] V, [3] I, [4] D, [5] M, [6] deficit_code,
    [7] session_dur, [8] time_of_day
    """
    x = np.array(context)

    # Extract TMT proxies from context
    E = context[1]
    V = context[2]
    I = context[3]
    D = context[4]

    # Compute deficit scores
    deficit_E = 1.0 - E
    deficit_V = 1.0 - V
    deficit_I = I
    deficit_D = D

    # Get TMT-based relevance scores for each intervention
    relevance = compute_relevance_scores(deficit_E, deficit_V, deficit_I, deficit_D)

    # Compute LinUCB scores for each action
    best_action = None
    best_score = -float('inf')

    for action in ACTIONS:
        # Skip actions on per-action cooldown (if cooldown info is available)
        # ... existing cooldown check logic ...

        # Load arm parameters from MongoDB
        arm = load_arm(user_id, action)  # returns A, b matrices
        A_inv = np.linalg.inv(arm.A)
        theta = A_inv @ arm.b

        # Standard LinUCB UCB score
        exploitation = float(theta @ x)
        exploration = alpha * float(np.sqrt(x @ A_inv @ x))
        ucb_score = exploitation + exploration

        # Weight by TMT relevance
        # This makes LinUCB favor interventions that target the user's
        # current TMT deficit, while still allowing personalization
        weighted_score = ucb_score * (1.0 + relevance[action])

        if weighted_score > best_score:
            best_score = weighted_score
            best_action = action

    return best_action
```

**Why multiply instead of add:** Using `ucb_score * (1.0 + relevance)` ensures that:
- When all relevance scores are similar, LinUCB's learned preferences dominate (personalization)
- When deficits are skewed, relevance scores steer selection toward appropriate interventions (theory)
- The `1.0 +` ensures no action is completely zeroed out, preserving exploration

### Step 4.4: Store gamma and relevance in bandit_events

**File:** `backend/app/api/intervention.py`

When logging to `bandit_events` in MongoDB, add these fields:

```python
{
    "user_id": user_id,
    "context": context,          # now 9 elements
    "action": selected_action,
    "reward": reward,
    "button": button,
    "alpha": alpha,
    "gamma": GAMMA,
    "relevance_scores": relevance,          # dict of action -> score
    "dominant_deficit": dominant_deficit,    # "expectancy", "value", "impulsiveness", or "delay"
    "tmt_proxies": {"E": E, "V": V, "I": I, "D": D},
    "n_updates_after": n_updates,
    "timestamp": datetime.utcnow()
}
```

This gives you full traceability for every intervention decision. You can analyze which deficit types led to which interventions and their outcomes.

---

## PHASE 5: Wire Everything Together

### Step 5.1: Update the monitoring loop

**File:** `electron/src/renderer/src/utils/monitoringLoop.ts`

The monitoring loop should now follow this sequence every 60 seconds:

```
1. Is an intervention already active? --> YES --> skip
2. Is global cooldown active? --> YES --> skip
3. Collect raw behavioral signals (RawBehavioralSignals)
4. Compute TMT proxies (computeTMTProxies)
5. Build 9-element context vector (buildContextVector)
6. shouldTrigger(context)? --> NO --> skip
7. contextHash matches last shown? --> YES --> skip
8. Remove per-action cooldown violations from candidate list
9. POST /intervention/bandit/select with context
   (backend computes relevance, runs weighted LinUCB, returns action)
10. Show intervention (platform-specific)
```

Steps 1, 2, 7, 8, 10 are unchanged from the current system.
Steps 3, 4, 5, 6 are new.
Step 9 sends a shorter context (9 vs 12 elements) but the API contract is the same shape.

### Step 5.2: Update PythonBridge context endpoint

**File:** `electron/src/main/python-bridge.ts` and `backend/app/api/intervention.py`

The `GET /intervention/context` endpoint (if it exists) should be updated to return the new 9-element vector. If context is built entirely on the Electron side, ensure the Electron context builder is the sole source of truth and the backend simply consumes whatever vector it receives.

### Step 5.3: Verify reward flow

The reward flow is unchanged:
- User clicks Start --> reward = 1.0
- User clicks Not Now --> reward = 0.4
- User clicks Skip --> reward = 0.2

The `POST /intervention/bandit/update` endpoint receives the same (context, action, reward) tuple. The only change is:
- Context is 9 elements instead of 12
- The update applies gamma discounting before adding the new observation
- The event log includes additional TMT metadata

---

## PHASE 6: Code Cleanup

### Step 6.1: Remove dead code

After all phases are working, remove any remaining references to the old 12-element vector:

- Remove old constant definitions for the 12 indices
- Remove any utility functions that computed old composite features
- Remove any tests that assert 12-element vectors
- Remove the old urgency-based action filtering function entirely

### Step 6.2: Add code comments with citations

Add brief citation comments at key decision points so the codebase self-documents the theoretical grounding:

```typescript
// Expectancy proxy: task_completion_rate
// Justification: Past task success predicts self-efficacy
// (Bandura, 1977; Klassen et al., 2008)
const E = signals.task_completion_rate;
```

```python
# TMT alignment: POMODORO targets Impulsiveness (0.8)
# Justification: Structured time blocks reduce distraction
# (Biwer et al., 2023; Steel et al., 2018)
```

### Step 6.3: Update MongoDB indexes

If there are any MongoDB indexes on `bandit_events.context` that assume 12 elements, update or recreate them. The context field is now 9 elements.

---

## Summary of File Changes

### Files to MODIFY:

| File | Changes |
|---|---|
| `electron/src/utils/contextBuilder.ts` | Replace entire context construction with new 9-element TMT-based vector |
| `electron/src/renderer/src/utils/triggerDetector.ts` | Replace 5 threshold rules with 2 TMT-based conditions |
| `electron/src/renderer/src/utils/monitoringLoop.ts` | Update loop to use new context builder |
| `backend/app/components/smart_intervention_engine/schemas.py` | Change context length from 12 to 9, update docs |
| `backend/app/components/smart_intervention_engine/bandit.py` | Add gamma discounting, update dimension to 9, add migration logic |
| `backend/app/api/intervention.py` | Integrate relevance scoring into select, add TMT metadata to event logs |

### Files to CREATE:

| File | Purpose |
|---|---|
| `backend/app/components/smart_intervention_engine/tmt_alignment.py` | TMT alignment matrix and relevance score computation |

### Files UNCHANGED:

| File | Reason |
|---|---|
| `electron/src/renderer/src/utils/cooldownManager.ts` | Cooldown logic is sound, no changes needed |
| `electron/src/renderer/src/utils/contextHasher.ts` | Works generically on any array length |
| `electron/src/main/intervention-popup.ts` | UI delivery is independent of selection logic |
| `electron/src/renderer/src/context/InterventionContext.tsx` | State management unchanged |
| `electron/src/renderer/src/pages/SmartInterventionPage.tsx` | UI page unchanged |

---

## Verification Checklist

After implementation, verify all of the following:

- [ ] Context vector is exactly 9 elements: [bias, E, V, I, D, M, deficit_code, session_dur, time_of_day]
- [ ] No old 12-element references remain in the codebase
- [ ] No arbitrary composite weights exist (no 0.5/0.3/0.2 style formulas)
- [ ] Each TMT component uses exactly one behavioral proxy (no blended composites)
- [ ] TMT motivation score M = (E*V)/(1+I*D) is computed correctly
- [ ] Deficit scores are computed as distance from ideal (no absolute thresholds for deficit identification)
- [ ] Dominant deficit is found via argmax (not threshold comparison)
- [ ] TMT alignment matrix is defined with values matching the research citations
- [ ] Relevance scores correctly weight LinUCB UCB scores
- [ ] LinUCB update applies gamma discount BEFORE adding new observation
- [ ] Matrix regularization prevents diagonal values from dropping below 0.01
- [ ] Old 12x12 bandit_models are detected and reinitialized to 9x9
- [ ] Trigger conditions use TMT motivation score, not raw signal thresholds
- [ ] Old urgency-based action filtering is fully removed
- [ ] bandit_events documents include relevance_scores, dominant_deficit, and tmt_proxies
- [ ] All existing endpoints still respond correctly
- [ ] No TypeScript compilation errors
- [ ] No Python import or runtime errors
- [ ] Monitoring loop runs without crashes

---

## Important Constraints

1. **Do not break the reward flow.** The Start/Not Now/Skip buttons and their reward values (1.0/0.4/0.2) must continue working identically.
2. **Do not change the UI delivery mechanism.** How notifications appear (Electron notifications on macOS, custom popups on Windows) is unrelated to selection logic.
3. **Handle missing data gracefully.** Every TMT proxy has a documented default value for when data is unavailable. Use these defaults so the system works from day one before enough data accumulates.
4. **Keep the API contract shape.** Context is still a flat `List[float]`. Action is still a string. Reward is still a float. The backend does not need to know where context values came from.
5. **Preserve cooldown and hashing.** These mechanisms prevent over-intervention and are independent of the selection logic.
6. **One proxy per TMT component.** Do not reintroduce composite formulas. If you need a richer signal, add it as a separate context vector element, not as a weighted blend into an existing proxy.
