
# Smart Intervention Engine — Implementation Plan (Electron + FastAPI + Per-User LinUCB)

## Goal

Implement a **per-user contextual bandit (LinUCB)** to suggest the best intervention (5-Second Rule / Pomodoro / Breathing / Visualization / Reframe) based on a **context vector** computed from:

- **Component 1 (Behavior Monitoring)** — live data from `focus_app_research.active_time`
- **Component 4 (Task Scheduling/Deadlines)** — live data from `adaptive_time_estimation.completed_tasks`
- **TMT feature proxies** computed from above signals

This plan extends the current working Electron app + FastAPI backend.

---

# Current Implementation Status (Done)

## Desktop app (Electron)

- Main window via `createWindow` in `index.js`
- UI loaded from `frontend/index.html`
- macOS tray/menu-bar via `createTray`
  - Show App
  - Quit
  - tray timer updates (`tray:update-timer`, `tray:clear`)
- `window:show` IPC restore/focus
- System notifications via `notify:intervention-actions`
  - Buttons: Start / Skip / Not now
  - Sends action result back (`notification-action-response`)
  - Auto-close fallback after 15s

## Frontend demo UI

- Intervention demo page (`frontend/index.html`) with 5 buttons:
  - 5-Second Rule
  - Pomodoro
  - Breathing
  - Visualization
  - Reframe

- Personalization section:
  - Load/save life goal via backend (`/user/goal`)

## Renderer logic (`frontend/renderer.js`)

- Logs intervention actions to backend (`/log`)
- Handles notification responses:
  - 5-second countdown and “Go” notification
  - Pomodoro timer (25 min) + break timer (5 min)
  - Breathing/Visualization modals
  - Reframe uses saved life goal

## Intervention modal module (`frontend/modules/interventionUI.js`)

- Generic modal + close helpers
- Guided breathing flow
- Guided visualization flow

## Backend API (FastAPI)

File: `backend/main.py`

- CORS enabled
- MongoDB (Motor) stores user goal

Endpoints:

- `GET /` → health check
- `GET /user/goal`
- `POST /user/goal`
- `GET /strategies`
- `POST /log`
- `GET /logs`

## Styling

`frontend/styles.css` includes:

- Glass-card theme
- Animated breathing modal
- Animated visualization modal
- Intervention modal/button styles

---

# What’s Missing (Next Development Steps)

1. ~~Context Vector Generator~~ — Done (real data from Component 1 + Component 4)
2. ~~LinUCB service in FastAPI~~ — Done
3. ~~Intervention suggestion flow in Electron~~ — Done
4. ~~Evaluation logging (bandit_events)~~ — Done
5. `idle_ratio` signal (pending confirmation from Component 1)
6. ~~Step 7 — Trigger-and-Cooldown Algorithm~~ — Done

---

# System Design (Target Flow)

1. Electron calls `GET /intervention/context/{user_id}` → fetches live signals from Component 1 + Component 4
2. Electron builds context vector `x_t` from real signals
3. Electron calls `POST /bandit/select`
4. FastAPI returns best intervention
5. Electron shows notification (Start / Skip / Not now)
6. Electron computes reward from user response
7. Electron calls `POST /bandit/update`
8. FastAPI updates model and logs event

---

# Step-by-Step Implementation Plan

## Step 1 — Real Context Provider (Done)

File: `electron/src/utils/contextBuilder.ts`

Functions:
- `buildVector(signals: ContextSignals): number[]` — computes the 12-element vector from live signals
- `getContext(userId: string): Promise<number[]>` — fetches signals from `GET /intervention/context/{user_id}` then calls `buildVector`

Backend endpoint: `GET /intervention/context/{user_id}` in `backend/app/api/intervention.py`
- Reads today's `active_time` document from `focus_app_research` DB (Component 1)
- Reads `completed_tasks` from `adaptive_time_estimation` DB (Component 4)
- Returns raw signal values; falls back to zeros if no data found

---

# Step 2 — Context Vector Definition

## Temporal Motivation Theory (TMT)

Motivation = (Expectancy × Value) / (1 + Impulsiveness × Delay)

### Expectancy

Expectancy = completed_tasks_last_7_days / (assigned_tasks_last_7_days + 1)

### Value

Value = 0.5 × task_priority  
      + 0.3 × grade_weight_normalized  
      + 0.2 × value_time

value_time = time_spent_on_task / assigned_time

### Impulsiveness

Impulsiveness = 0.5 × switching_score  
               + 0.5 × non_academic_ratio

switching_score = normalize(app_switch_rate + tab_switch_rate)

non_academic_ratio = non_academic_transitions / (total_transitions + 1)

### Delay

hours_to_deadline = max(0, (task_deadline_time - current_time)/3600)

Delay = hours_to_deadline / (1 + hours_to_deadline)

overdue_flag =
1 if deadline < now  
0 otherwise

---

# Context Vector Example (d = 12)

1. bias = 1
2. Expectancy
3. Value
4. Impulsiveness
5. Delay
6. overdue_flag
7. Motivation
8. app_switch_rate
9. tab_switch_rate
10. non_academic_ratio
11. idle_ratio (set to 0.0 — not yet finalized)
12. deadline_urgency = 1 - Delay

Values come from Component 1 (`focus_app_research.active_time`) and Component 4 (`adaptive_time_estimation.completed_tasks`).

---

# Step 3 — Implement LinUCB in FastAPI


## Actions

Use these exact IDs:

- FIVE_SECOND_RULE
- POMODORO
- BREATHING
- VISUALIZATION
- REFRAME

---

# MongoDB Collections

## bandit_models

Stores per-user parameters:

- user_id
- action
- A matrix (flattened)
- b vector
- n_updates
- timestamps

## bandit_events

Stores:

- user_id
- context vector
- chosen action
- reward
- button pressed
- timestamp

---

# API Endpoints

## POST /bandit/select

Request:

{
"user_id": "u123",
"x": [ ...context vector... ],
"alpha": 1.0
}

Response:

{
"action": "POMODORO"
}

---

## POST /bandit/update

Request:

{
"user_id": "u123",
"x": [ ...context vector... ],
"action": "POMODORO",
"reward": 0.4,
"button": "NOT_NOW"
}

Response:

{
"status": "ok"
}

---

# Reward Mapping (Phase 1)

Start → 1.0  
Skip → 0.2  
Not Now → 0.4

Later versions can add behavioral reward.

---

# Step 4 — Integrate Bandit into Electron

Modify `renderer.js`:

Add:

- `getContextVector()`
- `selectIntervention()` → calls `/bandit/select`
- `showSuggestedIntervention()`
- reward calculation
- `/bandit/update` request

Add button:

"Suggest Best Intervention"

---

# Step 5 — Context-Aware Action Filtering

Compute:

deadline_urgency = 1 - Delay

Rules:

urgency ≥ 0.7  
→ allow: FIVE_SECOND_RULE, POMODORO, REFRAME

0.3 ≤ urgency < 0.7  
→ allow: FIVE_SECOND_RULE, POMODORO, REFRAME, BREATHING

urgency < 0.3  
→ allow all actions

Optional:

Add cooldown if user clicks **Not Now**.

---

# Step 6 — Evaluation Logging

Ensure every decision logs:

- user_id
- action
- button pressed
- reward
- context vector
- timestamp
- alpha

Optional endpoint:

GET /bandit/events

---

# Step 7 — Trigger‑and‑Cooldown Algorithm

The contextual bandit **does not run continuously**.

Instead the Electron client runs a **periodic monitoring loop**.

The bandit answers:

"Which intervention is best now?"

The trigger layer answers:

"Should we intervene now?"

These responsibilities are separated.

---

## Monitoring Loop

Run every **60 seconds**.

At each cycle:

1. Collect Component 1 signals
2. Collect Component 4 task data
3. Build context vector
4. Evaluate procrastination risk
5. Check cooldown rules
6. If allowed → call `/bandit/select`
7. Show intervention
8. Capture response
9. Compute reward
10. Call `/bandit/update`

---

## Runtime State

Electron keeps:

activeIntervention  
globalCooldownUntil  
actionCooldownUntil[action]  
lastContextHash

Meaning

activeIntervention → currently running intervention

globalCooldownUntil → block all interventions until this time

actionCooldownUntil → block specific intervention temporarily

lastContextHash → prevents repeated suggestions when context unchanged

---

## Trigger Conditions

An intervention is triggered if any condition holds:

idle_ratio > 0.40

OR

non_academic_ratio > 0.35

OR

switching_score > 0.60

OR

(deadline_urgency > 0.60 AND motivation < 0.40)

OR

overdue_flag = 1

switching_score = normalize(app_switch_rate + tab_switch_rate)

---

## Cooldown Rules

Monitoring interval: **60 seconds**

Minimum gap between interventions: **10 minutes**

After **Start**

- Pomodoro → block until Pomodoro ends
- Other actions → 10 minute cooldown

After **Not Now**

- Global cooldown → 5 minutes
- Same action cooldown → 15 minutes

After **Skip**

- Global cooldown → 5 minutes
- Same action cooldown → 10 minutes

---

## Duplicate Context Suppression

To avoid repeated suggestions:

1. Round context vector values to 2 decimals
2. Convert to a hash string
3. Compare with previous hash

If unchanged → suppress intervention this cycle.

Update hash only when an intervention is shown.

---

# Pseudocode

Every 60 seconds:

if activeIntervention exists → return

if currentTime < globalCooldownUntil → return

read Component1 data  
read Component4 data

x_t = buildContextVector()

if shouldTrigger(x_t) == false → return

contextHash = hash(x_t)

if contextHash == lastContextHash → return

allowedActions = filterByUrgency(x_t)

allowedActions = removeCooldownActions()

if allowedActions empty → return

selectedAction = POST /bandit/select

showIntervention(selectedAction)

response = wait for Start / Skip / Not Now

reward = computeReward(response)

POST /bandit/update

applyCooldowns()

lastContextHash = contextHash

---

# Responsibility Split

Electron Client

- monitoring loop
- context building
- trigger detection
- cooldown management
- notification display
- reward capture

FastAPI Backend

- LinUCB selection
- model update
- MongoDB persistence
- event logging

---

# Step 7 — Implementation Details (Done)

## New Files Created

### `electron/src/renderer/src/utils/triggerDetector.ts`

Exports:
- `shouldTrigger(vector)` — evaluates 5 trigger conditions (idle_ratio skipped)
- `filterByUrgency(vector)` — urgency-based action filtering

### `electron/src/renderer/src/utils/cooldownManager.ts`

Exports `CooldownManager` class:
- `hasActiveIntervention()` / `setActiveIntervention()`
- `isGlobalCooldownActive()`
- `getAvailableActions(allowed)` — removes per-action cooled-down actions
- `applyCooldown(action, response)` — applies Start/Skip/Not Now rules
- `reset()` / `getStatus()`

### `electron/src/renderer/src/utils/contextHasher.ts`

Exports:
- `hashContext(vector)` — rounds to 2 decimals, joins as string
- `isDuplicateContext(hash)` / `updateHash(hash)` / `resetHash()`

### `electron/src/renderer/src/utils/monitoringLoop.ts`

Exports `MonitoringLoop` class:
- `start()` — begins 60-second interval
- `stop()` — clears interval, resets cooldowns and hash
- `isRunning()`
- Takes callback hooks: `onSuggestIntervention`, `onLogMotivation`, `onStatusUpdate`

## Modified Files

### `SmartInterventionPage.tsx`

- Added Auto-Monitor toggle (ON/OFF) with real-time status indicator
- Wired notification responses to apply cooldowns via `CooldownManager`
- Cleans up monitoring loop on unmount

### `SmartInterventionPage.css`

- Added styles for `.sie-monitor-toggle`, `.sie-monitor-status`, `.sie-monitor-dot`

## Pending

- `idle_ratio` trigger condition is commented out (not yet confirmed)



# Data input details

## Component 1 — Behavior Monitoring

provide:

- app_switch_rate
- tab_switch_rate
(to get app_switch_rate and tab_switch_rate you can use totalAppSwitches from the focus_app_research db, active_time collection)

- non_academic_transitions
(to get non_academic_transitions you can use totalAppSwitches from the focus_app_research db, active_time collection)

- total_transitions
(to get total_transitions you can use totalAppSwitches from the focus_app_research db, active_time collection)

- idle_ratio
(Not yet confirmed)

## Component 4 — Task Scheduling

provide:

- completed_tasks_last_7_days
- assigned_tasks_last_7_days
(to get completed_tasks_last_7_days and assigned_tasks_last_7_days you can use status(completed, scheduled) from the 'adaptive_time_estimation' db, 'completed_tasks' collection. )

- task_priority
(For this use priority from the 'adaptive_time_estimation' db, 'completed_tasks' collection.)

- grade_weight_normalized
(For this use credits and weight from the 'adaptive_time_estimation' db, 'completed_tasks' collection.)

- time_spent_on_task
(For this use actual_time from the 'adaptive_time_estimation' db, 'completed_tasks' collection.)

- assigned_time
(For this use system_estimate and user_estimate from the 'adaptive_time_estimation' db, 'completed_tasks' collection. Sometimes user don't change the estimate time, then take system_estimate for this)

- task_deadline_time
(For this use deadline from the 'adaptive_time_estimation' db, 'completed_tasks' collection.)


---

# Running the System

## Backend

Install dependencies:

fastapi  
uvicorn  
motor  
numpy  
pydantic  

Run:

uvicorn backend.main:app --reload

## Electron

npm install

npm start

---

# Acceptance Criteria

When clicking **Suggest Best Intervention**:

- Context vector generated
- `/bandit/select` called
- Intervention shown
- Start / Skip / Not now captured
- `/bandit/update` sent
- Mongo model updated
- Event logged

Over time the model should adapt.

Example:

If user repeatedly presses **Not Now** for Visualization → it will be suggested less.

---

# Notes for Implementing AI Agent

- Feature vector length must remain constant.
- All features normalized 0–1.
- Use per-user LinUCB parameters.
- No heavy ML frameworks required.
- Focus on correctness and logging.
