# Intervention Engine — Technical Reference

## Table of Contents

1. [Overview](#overview)
2. [The Context Vector — How Data Reaches the Matrix](#the-context-vector)
3. [LinUCB Algorithm — Core Math](#linucb-algorithm)
4. [TMT Alignment Matrix — Relevance Scoring](#tmt-alignment-matrix)
5. [Intervention Selection — End-to-End Calculation](#intervention-selection)
6. [How Real-Time the Values Get](#real-time-latency)
7. [How Previous User Actions Shape LinUCB](#user-feedback-loop)
8. [Anti-Fatigue Mechanisms](#anti-fatigue-mechanisms)
9. [Data Persistence — MongoDB Collections](#data-persistence)
10. [Full Data Flow Diagram](#data-flow-diagram)

---

## Overview

The intervention engine is a real-time adaptive system that decides when and which motivational nudge to show a user who is procrastinating. It runs continuously in the background of the Tracker Desktop Electron app, observing user behavior and personalizing its suggestions over time.

**Architecture:**
- **Electron frontend** (TypeScript) — tracks desktop activity, builds context, orchestrates monitoring
- **Python FastAPI backend** — hosts the LinUCB bandit model, serves context signals, persists learning state
- **MongoDB** — three separate databases storing activity events, arm parameters, and selection/update history

**Theoretical basis:** The engine is grounded in the **Temporal Motivation Theory (TMT)** model of procrastination:

```
Motivation = (Expectancy × Value) / (Impulsiveness × Delay)
```

Each intervention type is designed to address a specific TMT deficit. The engine learns which intervention works best for a given user in a given state.

**Six available actions:**
| Action | Description |
|--------|-------------|
| `NO_INTERVENTION` | Stay silent; no notification sent |
| `POMODORO` | Prompt a 25-minute timed focus session |
| `FIVE_SECOND_RULE` | Countdown technique to overcome initiation resistance |
| `BREATHING` | Guided breathing to regulate emotion/impulse |
| `VISUALIZATION` | Guided imagery of task completion |
| `REFRAME` | Cognitive reframe linking task to personal goals |

---

## The Context Vector

**File:** `electron/src/utils/contextBuilder.ts`  
**Backend signals source:** `GET /api/intervention/context`

Every 60 seconds the frontend fetches raw behavioral signals and transforms them into a **7-element numeric vector** `x` that represents the user's current motivational state. This vector is the input to the LinUCB bandit.

### Vector Layout

| Index | Name | Range | Description |
|-------|------|-------|-------------|
| 0 | bias | 1.0 (constant) | Always 1.0 — provides the intercept term |
| 1 | expectancy (E) | [0, 1] | Confidence the user can complete the task |
| 2 | value (V) | [0, 1] | Perceived importance of the task |
| 3 | impulsiveness (I) | [0, 1] | Tendency to switch away / get distracted |
| 4 | delay (D) | [0, 1] | Temporal distance to deadline (hyperbolic) |
| 5 | motivation (M) | [0, 1] | TMT composite score |
| 6 | deficit_code | {0.0, 0.33, 0.67, 1.0} | Dominant deficit indicator |

### Raw Signal Sources

The backend endpoint `/api/intervention/context` pulls from two component databases:

**Component 1 — Activity Database (`focus_app_research`):**
- `total_transitions` — total app switches today
- `non_academic_transitions` — off-task app switches today
- Sliding window (last 5–10 minutes):
  - `app_switches_5min` — rapid recent switching
  - `non_academic_switches_10min`, `total_events_10min`
  - `seconds_since_last_academic` — idle-from-academic time

**Component 4 — Task Database (`adaptive_time_estimation`):**
- `completed_tasks_last_7_days`, `assigned_tasks_last_7_days`
- `task_priority` (0–1), `grade_weight_normalized` (0–1)
- `time_spent_on_task`, `assigned_time` (hours)
- `task_deadline_time` (ISO datetime or null)

### Two-Speed TMT Blending

Each TMT proxy blends a **slow** signal (daily aggregates — stable but lagged) with a **fast** signal (5–10 min sliding window — reactive but noisy):

#### Expectancy (E) — Task Completion Confidence

```
E_slow = completed_tasks_7d / assigned_tasks_7d        # clamp [0, 1]

if sliding_window_available:
    E_fast = 1 - non_academic_ratio_10min
    E = 0.6 × E_slow + 0.4 × E_fast
else:
    idle_normalized = minutes_idle / 60                # clamp [0, 1]
    E = E_slow × (1 - 0.25 × idle_normalized)
```

#### Value (V) — Perceived Task Importance

```
V_slow = max(task_priority, grade_weight)              # default 0.5 if both zero

if sliding_window_available:
    V_fast = 1 - non_academic_ratio_10min
    V = V_slow × max(V_fast, 0.65)                    # multiplicative, 65% floor
else:
    V = V_slow × max(1 - 0.35 × idle_normalized, 0.65)
```

#### Impulsiveness (I) — Distraction Tendency

```
I_slow = non_academic_transitions / total_transitions  # daily off-task ratio
I_idle = minutes_since_last_academic / 60             # clamp [0, 1]

if sliding_window_available:
    I_fast = app_switches_5min / 10                   # clamp [0, 1]
    I = max(I_slow, I_fast, I_idle)                   # worst-case wins
else:
    I = max(I_slow, I_idle)
```

#### Delay (D) — Temporal Distance to Deadline

```
# Hyperbolic discounting of deadline distance:
hours_to_deadline = max(0, (deadline - now).total_hours)
D_slow = hours_to_deadline / (1 + hours_to_deadline)  # if overdue: 0.0
                                                        # if no deadline: uses 168h (1 week)

# Progress modifier:
task_time_ratio = time_spent / assigned_time           # capped at 2.0
D_progress = clamp(1 - task_time_ratio / 2, 0, 1)

D = D_slow × D_progress   (if has_time_estimate)
D = D_slow                 (fallback)
```

#### Motivation (M) — TMT Composite Score

```
M_raw   = clamp((E × V) / (1 + I × D), 0, 1)
M       = M_raw ^ 0.7     # power scaling expands distribution away from near-zero
```

The 0.7 exponent prevents motivation from clustering near 0 when E and V are individually decent.

#### Deficit Code — Dominant Weakness

```
deficit_E = 1.0 - E
deficit_V = 1.0 - V
deficit_I = I
deficit_D = D

dominant_index = argmax([deficit_E, deficit_V, deficit_I, deficit_D])
deficit_code   = dominant_index / 3.0    # → {0.0, 0.33, 0.67, 1.0}
```

Maps to: `0.0 = Expectancy`, `0.33 = Value`, `0.67 = Impulsiveness`, `1.0 = Delay`

---


## LinUCB Algorithm

**File:** `backend/app/components/smart_intervention_engine/bandit.py`

The engine uses the **Disjoint LinUCB** contextual bandit algorithm. Each arm (action) maintains its own independent parameter set, updated only when that action is selected and a reward is received.

### Per-Arm State

For each combination of `(user_id, action)`:

| Variable | Shape | Initial Value | Role |
|----------|-------|---------------|------|
| `A` | 7 × 7 | Identity matrix `I₇` | Gram matrix (accumulates context covariance) |
| `b` | 7 | Zero vector | Reward-weighted feature accumulator |
| `theta` | 7 | Computed: `A⁻¹b` | Estimated coefficient vector (not stored, computed on demand) |
| `n_updates` | int | 0 | Total number of times this arm has been updated |

`A` is stored in MongoDB as a flattened 49-element list and reshaped to (7,7) on load.

### Selection Formula (Exploitation + Exploration)

For context vector `x` and exploration parameter `alpha`:

```
theta_a    = A_a⁻¹ × b_a               # exploit: best estimate of true weights
ucb_bonus  = alpha × sqrt(xᵀ × A_a⁻¹ × x)  # explore: confidence radius

score_a    = theta_aᵀ × x + ucb_bonus
```

- **Exploitation term** (`theta_aᵀ × x`): Expected reward given the current model estimate.
- **Exploration term** (`alpha × sqrt(xᵀA⁻¹x)`): Uncertainty bonus — larger when the arm has been updated fewer times in contexts similar to `x`. This drives the system to try actions it hasn't observed well.
- `alpha = 1.0` by default (user-configurable). Higher alpha → more exploration of less-tested interventions.

### Update Rule — Discounted Learning

When a reward `r` is received for arm `a` in context `x`:

```
A_a ← GAMMA × A_a + x × xᵀ    (outer product: 7×7 rank-1 update)
b_a ← GAMMA × b_a + r × x

GAMMA = 0.995
```

The discount factor `GAMMA = 0.995` makes the model **non-stationary**: old observations lose weight exponentially. After 100 updates, roughly 60% of the original weight remains (`0.995^100 ≈ 0.606`). This allows the model to adapt as the user's behavior changes over days and weeks.

**Regularization guard:**

```python
if any(A[i,i] < MIN_DIAGONAL for i in range(d)):
    A += MIN_DIAGONAL × I    # MIN_DIAGONAL = 0.01
```

Prevents A from becoming numerically degenerate under repeated discounting, ensuring the matrix inversion `A⁻¹` stays stable.

---

## TMT Alignment Matrix

**File:** `backend/app/components/smart_intervention_engine/tmt_alignment.py`

The alignment matrix encodes how well each intervention targets each TMT deficit, based on psychological research.

### Matrix Definition (6 actions × 4 TMT components)

```
                 E      V      I      D
NO_INTERVENTION [0.0,   0.0,   0.0,   0.0]
POMODORO        [0.3,   0.1,   0.8,   0.7]
FIVE_SECOND_RULE[0.3,   0.1,   0.7,   0.5]
BREATHING       [0.1,   0.1,   0.6,   0.1]
VISUALIZATION   [0.7,   0.5,   0.1,   0.4]
REFRAME         [0.4,   0.8,   0.3,   0.2]
```

**Research rationale per action:**

| Action | Primary Target | Why |
|--------|---------------|-----|
| `POMODORO` | I (0.8), D (0.7) | Structured 25-min intervals reduce distraction; proximal sub-deadlines counter hyperbolic delay discounting |
| `FIVE_SECOND_RULE` | I (0.7), D (0.5) | Implementation intentions override impulse; countdown collapses the gap between intention and action |
| `BREATHING` | I (0.6) | Activates prefrontal executive control; addresses procrastination-as-mood-repair by reducing emotional arousal |
| `VISUALIZATION` | E (0.7), V (0.5) | Imagining completion raises self-efficacy; episodic future thinking makes future rewards emotionally concrete |
| `REFRAME` | V (0.8), E (0.4) | Connecting tasks to personal goals increases perceived value; challenging negative self-talk improves confidence |
| `NO_INTERVENTION` | None (all 0.0) | Represents silence; only wins when the LinUCB model has learned that the user doesn't need a nudge right now |

### Relevance Score Computation

```python
deficit_vector = [deficit_E, deficit_V, deficit_I, deficit_D]
relevance      = TMT_ALIGNMENT @ deficit_vector    # matrix-vector product → 6 scores
```

Each action's relevance score is the dot product of its alignment row with the user's current deficit vector. A high relevance score means the intervention is theoretically well-suited to what the user is struggling with right now.

---

## Intervention Selection

**File:** `backend/app/api/intervention.py`  
**Endpoint:** `POST /api/intervention/bandit/select`

Selection is a 6-step pipeline executed on every monitoring tick (when an intervention is warranted):

### Step 1 — Load All Arms

All 6 arms for the user are loaded from MongoDB in parallel. Arms that don't yet exist are initialized fresh (A=I, b=0).

### Step 2 — Compute TMT Deficits

```python
E, V, I, D = x[1], x[2], x[3], x[4]

deficit_E = 1.0 - E
deficit_V = 1.0 - V
deficit_I = I
deficit_D = D
```

### Step 3 — Compute Relevance Scores

```python
relevance = compute_relevance_scores(deficit_E, deficit_V, deficit_I, deficit_D)
# → {"NO_INTERVENTION": 0.0, "POMODORO": 0.75, "REFRAME": 0.62, ...}
```

### Step 4 — Compute Weighted Scores

For each action:

```python
ucb_score      = arm.score(x, alpha)               # LinUCB: exploit + explore
weighted_score = ucb_score × (1.0 + relevance[action])
```

The `(1.0 + relevance)` factor:
- When TMT deficits are uniform → the factor is similar across arms → LinUCB personalization dominates
- When one deficit is pronounced → factor steers selection toward theory-grounded choices
- No action is ever zeroed out; relevance only adjusts the margin

### Step 5 — Apply Recency Discount

```python
RECENCY_DISCOUNT = 0.30

if action in recent_actions and action != "NO_INTERVENTION":
    weighted_score *= (1.0 - RECENCY_DISCOUNT)    # 30% penalty
```

`recent_actions` is the list of the last 2 interventions shown (passed in from the frontend's cooldown manager). `NO_INTERVENTION` is always exempt — silence is never penalized.

### Step 6 — Select and Log

```python
selected_action = argmax(weighted_scores)
```

The full scoring trace is written to the `bandit_selections` MongoDB collection: context vector, all UCB scores, all relevance scores, all weighted scores, the winner, and the runner-up margin.

### Behavior Stage Classification

The endpoint also classifies the user's current behavioral state for logging:

```python
def behavior_stage(motivation, impulsiveness):
    if motivation < 0.40:                              return "high-risk procrastination"
    if impulsiveness > 0.50 and motivation < 0.60:    return "distraction-driven drift"
    if motivation < 0.70:                              return "fragile engagement"
    return "stable focus"
```

---

## Real-Time Latency

The system is event-driven with multiple loops running at different speeds:

| Stage | Interval | Component | Details |
|-------|----------|-----------|---------|
| Desktop activity poll | **1 second** | `desktop-activity-tracker.ts` | `active-win` captures active window; idle via `powerMonitor.getSystemIdleTime()` |
| Activity batch sync | **≤30 seconds** | `activity-sync.ts` | Buffered locally in `electron-store`, batch-uploaded to `/api/activity/batch` (max 50 events/request) |
| MongoDB write | **<100ms** | FastAPI backend | Deduplication by `event_id`, indexed on `user_id + timestamp` |
| Sliding window query | **<200ms** | `/api/intervention/context` | Queries last 5–10 min of `activity_events` on each monitoring tick |
| Monitoring loop tick | **60 seconds** | `monitoringLoop.ts` | Main evaluation cycle |
| Context hash check | **5 minutes** | `contextHasher.ts` | Skips re-evaluation if vector hasn't changed meaningfully in <5 min |
| Bandit select + update | **<200ms** | FastAPI | Loads arms, scores, writes selection log, updates arm on reward |

**Total observed latency: activity happens → intervention shown ≈ 60 seconds + ~500ms backend overhead**

The 60-second monitoring interval is the dominant delay. The sliding window ensures recent behavior (last 5–10 min) is reflected without waiting for the next daily aggregate computation.

### Context Duplicate Suppression

```typescript
const MAX_HASH_AGE_MS = 5 * 60 * 1000    // 5 minutes

// Context vector is hashed to 2 decimal places per element
// If hash matches previous hash AND it's <5 minutes old → skip this tick
// After 5 minutes → re-evaluate even with identical context
```

This prevents the engine from hammering the bandit with identical inputs during stable focus periods.

---

## User Feedback Loop

**Files:** `backend/app/api/intervention.py`, `electron/src/renderer/src/context/InterventionContext.tsx`  
**Endpoint:** `POST /api/intervention/bandit/update`

Every time the user responds to an intervention notification, a reward signal is computed and fed back into the LinUCB arm.

### Reward Mapping

| Button Clicked | Reward | Interpretation |
|----------------|--------|----------------|
| `start` | **1.0** | User accepted and began the technique — maximum positive signal |
| `no_intervention` | **0.5** | Bandit chose silence; neutral acknowledgment |
| `not_now` | **0.4** | User deferred — was open but not ready; mild negative |
| `skip` / `reject` | **0.2** | User dismissed — action was unwanted in this state |

### How the Arm Parameters Shift

When `arm.update(x, r)` is called:

```python
A_new = GAMMA × A_old + x × xᵀ
b_new = GAMMA × b_old + r × x
```

The update is logged with diagnostics:

```
[Behavior Update] user=X action=POMODORO response=not_now reward=0.4
  stage=fragile-engagement dominant_deficit=I
  expected_reward_for_state 0.312 → 0.298  (Δ = -0.014)
  model_shift Δ||A||F=0.043  Δ||b||=0.021  n_updates=14→15
```

- `Δ||A||F` (Frobenius norm change) — how much the covariance structure shifted
- `Δ||b||` — how much the reward accumulator moved
- `expected_reward_delta` negative → this context-action pair earned less than the model expected; the arm is down-weighted for similar future contexts

### Long-Term Personalization

Because `theta_a = A_a⁻¹ × b_a`, the exploitation score for arm `a` in context `x` is:

```
theta_aᵀ × x = (A_a⁻¹ × b_a)ᵀ × x
```

With each reward update, `b_a` accumulates `r × x` (the context weighted by reward). Actions that consistently earn high rewards in a particular context region have their `b_a` vector pulled in the direction of those context vectors, causing `theta_a` to assign higher scores to similar future contexts.

**Non-stationarity — adapting over time:**

```
GAMMA = 0.995
After  50 updates: ~78% of original weight remains (0.995^50 ≈ 0.778)
After 100 updates: ~61% remains (0.995^100 ≈ 0.606)
After 200 updates: ~37% remains (0.995^200 ≈ 0.368)
```

Old observations fade exponentially. If the user's behavior shifts (e.g., deadlines change, impulsiveness decreases), the model re-learns without requiring a hard reset.

### What Happens When Actions Are Repeatedly Skipped

Each `skip` (reward = 0.2) adds `0.2 × x` to `b_a` — a weak signal. Over many skips in similar contexts:

- `b_a` grows slowly in the direction of those contexts
- But competing arms with `start` responses (reward = 1.0) grow 5× faster
- `A_a` accumulates regardless (it tracks context frequency, not reward quality)
- Net effect: `theta_a` for the skipped arm yields lower `theta_aᵀ × x` scores in those contexts
- The exploration bonus `alpha × sqrt(xᵀA_a⁻¹x)` shrinks as the arm is updated more, reducing the chance it gets selected even for exploration

---

## Anti-Fatigue Mechanisms

**File:** `electron/src/renderer/src/utils/cooldownManager.ts`

The system uses **layered gating** to prevent intervention fatigue. Every gate must pass before a notification is shown.

### Gate 1 — Active Intervention Block

```typescript
if (hasActiveIntervention()) return    // concurrent intervention prevention
```

Only one intervention is ever shown at a time. A new tick cannot trigger a notification while one is already displayed and awaiting user response.

### Gate 2 — Global Cooldown

```typescript
const MIN_GAP_MS = 10 * 60 * 1000    // 10 minutes

isGlobalCooldownActive():
    now < globalCooldownUntil           // explicit cooldown set by response
    OR
    now - lastInterventionTime < MIN_GAP_MS  // minimum gap enforcement
```

Even if all other conditions are met, at least 10 minutes must pass between any two shown interventions.

### Gate 3 — Context Duplicate Check

```typescript
const MAX_HASH_AGE_MS = 5 * 60 * 1000

// Skip if context vector hasn't meaningfully changed in <5 minutes
```

Prevents re-triggering when the user is in a stable state.

### Gate 4 — Per-Action Cooldown (Response-Driven)

After the user responds, cooldowns are applied based on response type:

| Response | Global Cooldown | Per-Action Cooldown |
|----------|----------------|-------------------|
| `start` (non-Pomodoro) | 10 minutes | 10 minutes |
| `start` (Pomodoro) | **30 minutes** | **30 minutes** |
| `not_now` | 10 minutes | **15 minutes** |
| `skip` | 10 minutes | 10 minutes |
| `no_intervention` (bandit silence) | 10 minutes | — |

The Pomodoro 30-minute block covers the full 25-minute work session plus 5-minute break, preventing interruption during the technique.

The `not_now` per-action cooldown is longer than global (15 min vs 10 min) to specifically discourage repeating the same suggestion that was already deferred.

### Gate 5 — Recency Buffer

```typescript
const RECENT_BUFFER_SIZE = 2
const RECENT_BUFFER_TTL_MS = 30 * 60 * 1000    // 30 minutes

getAvailableActions(allowed):
    // Remove actions in per-action cooldown
    // Remove actions shown in last 30 minutes (max 2 tracked)
    // Fallback: if recency filter empties the list → use cooldown-only filter
    //           (ensures the loop never permanently stalls)
```

The fallback prevents a degenerate state where all actions are in the recent buffer and nothing can be selected — the system gracefully degrades to cooldown-only filtering.

### Gate 6 — Backend Recency Discount

Even after frontend filtering passes an action through, the backend applies a 30% score penalty:

```python
RECENCY_DISCOUNT = 0.30

if action in recent_actions and action != "NO_INTERVENTION":
    weighted_score *= 0.70
```

This is a soft discourage rather than a hard block — the action can still win if its LinUCB + relevance score is sufficiently higher than alternatives.

### Gate 7 — NO_INTERVENTION Arm

The `NO_INTERVENTION` arm is always available (never blocked by cooldowns, never discounted for recency). If the LinUCB model has learned through repeated experience that the user doesn't respond well to nudges in a given context, this arm wins and the system stays silent. This is the model's primary way of self-throttling based on learned user preference.

### Full Gating Sequence Per Tick

```
Every 60 seconds:
├─ Gate 1: Active intervention ongoing?         → YES: skip tick
├─ Gate 2: Global cooldown active?              → YES: skip tick
├─ Fetch context from /api/intervention/context
├─ Gate 3: Context unchanged in <5 min?         → YES: skip tick
├─ Gate 4+5: Filter actions
│   ├─ Remove per-action cooldown violations
│   ├─ Remove recently shown (last 2 / 30 min)
│   └─ Fallback to cooldown-only if empty
├─ POST /api/intervention/bandit/select
│   ├─ Gate 6: Apply 30% recency discount (backend)
│   └─ Gate 7: NO_INTERVENTION wins if model prefers silence
├─ If NO_INTERVENTION:
│   ├─ Send reward=0.5 to /bandit/update
│   ├─ Apply 10-min global cooldown
│   └─ Silent (no notification)
└─ Else:
    ├─ Show notification
    ├─ Await user response
    ├─ Compute reward
    ├─ POST /api/intervention/bandit/update
    └─ Apply response-specific cooldowns
```

### Summary Table — All Cooldown Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MONITORING_INTERVAL_MS` | 60,000 ms (1 min) | Tick frequency |
| `MIN_GAP_MS` | 600,000 ms (10 min) | Absolute minimum between any interventions |
| `POMODORO_FULL_MS` | 1,800,000 ms (30 min) | Block after Pomodoro started |
| `START_COOLDOWN_MS` | 600,000 ms (10 min) | Global + per-action cooldown after "Start" |
| `NOT_NOW_GLOBAL_MS` | 600,000 ms (10 min) | Global cooldown after "Not Now" |
| `NOT_NOW_ACTION_MS` | 900,000 ms (15 min) | Per-action cooldown after "Not Now" |
| `SKIP_GLOBAL_MS` | 600,000 ms (10 min) | Global cooldown after "Skip" |
| `SKIP_ACTION_MS` | 600,000 ms (10 min) | Per-action cooldown after "Skip" |
| `NO_INTERVENTION_GLOBAL_MS` | 600,000 ms (10 min) | Global cooldown after bandit silence |
| `RECENT_BUFFER_SIZE` | 2 | Number of recent actions tracked |
| `RECENT_BUFFER_TTL_MS` | 1,800,000 ms (30 min) | TTL for recent action buffer |
| `MAX_HASH_AGE_MS` | 300,000 ms (5 min) | Context duplicate suppression window |
| `RECENCY_DISCOUNT` | 0.30 | Backend score penalty for recently shown actions |
| `GAMMA` | 0.995 | LinUCB discount factor (non-stationarity) |

---

## Data Persistence

The system uses three MongoDB databases:

### `intervention_db`

**`bandit_models`** — Arm parameters (the learned model state)
```json
{
  "user_id": "string",
  "action": "POMODORO",
  "A": [49 floats],       // 7×7 matrix flattened row-major
  "b": [7 floats],
  "n_updates": 42,
  "updated_at": 1716000000.0
}
```
Upserted on every `/bandit/update` call. One document per `(user_id, action)` pair.

**`bandit_selections`** — Every selection decision (full trace)
```json
{
  "user_id": "string",
  "context": [7 floats],
  "selected_action": "POMODORO",
  "alpha": 1.0,
  "tmt_proxies": {"E": 0.65, "V": 0.50, "I": 0.35, "D": 0.45},
  "dominant_deficit": "I",
  "relevance_scores": {"POMODORO": 0.75, "REFRAME": 0.42, ...},
  "ucb_scores": {"POMODORO": 1.23, ...},
  "weighted_scores": {"POMODORO": 2.15, ...},
  "recent_actions": ["BREATHING"],
  "timestamp": 1716000000.0
}
```

**`bandit_events`** — Every reward update (learning trajectory)
```json
{
  "user_id": "string",
  "context": [7 floats],
  "action": "POMODORO",
  "reward": 1.0,
  "button": "start",
  "alpha": 1.0,
  "gamma": 0.995,
  "relevance_scores": {...},
  "dominant_deficit": "I",
  "tmt_proxies": {"E": 0.65, "V": 0.50, "I": 0.35, "D": 0.45},
  "n_updates_after": 43,
  "timestamp": 1716000000.0
}
```

**`motivation_logs`** — Per-tick motivation snapshots
```json
{
  "user_id": "string",
  "motivation": 0.38,
  "scenario": "live",
  "context_vector": [7 floats],
  "stale": false,
  "timestamp": 1716000000.0
}
```

### `focus_app_research`

**`activity_events`** — Raw desktop/browser activity, with embedded classification (`academic | productivity | neutral | non_academic`). Source for all sliding-window signals.

### `adaptive_time_estimation`

**`completed_tasks`** — Task records with deadlines, priorities, time estimates. Source for E, V, D proxy computation.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                       ELECTRON FRONTEND                             │
│                                                                     │
│  ┌─────────────────────┐      ┌──────────────────────────────────┐  │
│  │ Desktop Activity    │      │  MonitoringLoop (every 60s)      │  │
│  │ Tracker             │      │                                  │  │
│  │                     │      │  1. Gate: active intervention?   │  │
│  │ Poll active window  │      │  2. Gate: global cooldown?       │  │
│  │ every 1 second      │      │  3. GET /api/intervention/context│  │
│  │                     │      │  4. Gate: context unchanged?     │  │
│  │ Batch → sync every  │      │  5. Filter available actions     │  │
│  │ 30s to backend      │      │  6. POST /api/bandit/select ─────┼──┼───┐
│  └──────────┬──────────┘      │  7. Show notification or skip    │  │   │
│             │                 └──────────────────────────────────┘  │   │
│             │                          ▲              │             │   │
└─────────────┼──────────────────────────┼──────────────┼─────────────┘   │
              │ POST /api/activity/batch  │              │                  │
              ▼                          │              ▼                  │
┌────────────────────────────────────────────────────────────────────┐    │
│                       PYTHON FASTAPI BACKEND                        │    │
│                                                                     │    │
│  ┌─────────────────────┐   ┌────────────────────────────────────┐  │    │
│  │ /api/activity/batch │   │ /api/intervention/context          │  │    │
│  │                     │   │                                    │  │    │
│  │ Dedup by event_id   │   │ Query activity_events (10min win)  │  │    │
│  │ Classify activity   │   │ Query completed_tasks              │  │    │
│  │ Write to MongoDB    │   │ Return raw behavioral signals      │  │    │
│  └─────────────────────┘   └────────────────────────────────────┘  │◄───┘
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ /api/intervention/bandit/select                              │  │◄───────┐
│  │                                                              │  │        │
│  │ 1. Load 6 arms from bandit_models                           │  │        │
│  │ 2. Compute deficits: deficit_E/V/I/D from x[1:5]           │  │        │
│  │ 3. relevance = TMT_ALIGNMENT @ deficit_vector               │  │        │
│  │ 4. For each arm:                                            │  │        │
│  │      ucb  = theta_aᵀx + alpha×sqrt(xᵀA_a⁻¹x)             │  │        │
│  │      wt   = ucb × (1 + relevance[a])                       │  │        │
│  │      if a in recent: wt *= 0.70                             │  │        │
│  │ 5. selected = argmax(wt)                                    │  │        │
│  │ 6. Log to bandit_selections                                 │  │        │
│  └──────────────────────────────────────────────────────────────┘  │        │
│                                                                     │        │
│  ┌──────────────────────────────────────────────────────────────┐  │        │
│  │ /api/intervention/bandit/update                              │  │        │
│  │                                                              │  │        │
│  │ Input: action, reward, button, context x                    │  │        │
│  │                                                              │  │        │
│  │ 1. Load arm(user_id, action)                                │  │        │
│  │ 2. Snapshot A_before, b_before                              │  │        │
│  │ 3. A ← 0.995×A + x×xᵀ                                     │  │        │
│  │    b ← 0.995×b + reward×x                                  │  │        │
│  │ 4. Compute deltas and log diagnostics                       │  │        │
│  │ 5. Upsert arm to bandit_models                              │  │        │
│  │ 6. Insert to bandit_events                                  │  │        │
│  └──────────────────────────────────────────────────────────────┘  │        │
└────────────────────────────────────────────────────────────────────┘        │
                                                                               │
              ┌────────────────────────────────────────────┐                  │
              │           USER INTERACTION                  │                  │
              │                                             │                  │
              │  Notification shown with action buttons     │                  │
              │                                             │                  │
              │  User clicks:                               │                  │
              │    "Start"    → reward = 1.0               │                  │
              │    "Not Now"  → reward = 0.4               │                  │
              │    "Skip"     → reward = 0.2               │                  │
              │                                             │                  │
              │  Frontend:                                  │                  │
              │    POST /api/bandit/update ─────────────────┼──────────────────┘
              │    Apply cooldowns (10-30 min)              │
              └────────────────────────────────────────────┘
```

---

*Generated from source exploration of `backend/app/components/smart_intervention_engine/`, `backend/app/api/intervention.py`, `electron/src/utils/contextBuilder.ts`, `electron/src/renderer/src/utils/monitoringLoop.ts`, `electron/src/renderer/src/utils/cooldownManager.ts`, and `electron/src/renderer/src/context/InterventionContext.tsx`.*
