
# Smart Intervention Engine — Implementation Plan (Electron + FastAPI + Per-User LinUCB)

## Goal

Implement a **per-user contextual bandit (LinUCB)** to suggest the best intervention (5-Second Rule / Pomodoro / Breathing / Visualization / Reframe) based on a **context vector** computed from:

- **Component 1 (Behavior Monitoring)** — not implemented yet → mock values for now
- **Component 4 (Task Scheduling/Deadlines)** — not implemented yet → mock values for now
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

1. Mock Context Vector Generator
2. LinUCB service in FastAPI
3. Intervention suggestion flow in Electron
4. Evaluation logging (bandit_events)

---

# System Design (Target Flow)

1. Electron builds context vector `x_t` (mock for now)
2. Electron calls `POST /bandit/select`
3. FastAPI returns best intervention
4. Electron shows notification (Start / Skip / Not now)
5. Electron computes reward from user response
6. Electron calls `POST /bandit/update`
7. FastAPI updates model and logs event

---

# Step-by-Step Implementation Plan

## Step 1 — Add Mock Context Provider

Create:

`frontend/modules/mockContext.js`

Function:

`getMockContext(userId): number[]`

Requirements:

- Fixed length vector (example d = 12)
- All values normalized to 0–1

### Mock Scenarios

**Scenario A — Low urgency**
- far deadline
- low switching
- low impulsiveness

**Scenario B — High urgency**
- near deadline
- high impulsiveness

**Scenario C — Overdue**
- overdue_flag = 1
- urgency high

Add dropdown in UI to switch scenarios.

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
11. idle_ratio
12. deadline_urgency = 1 - Delay

Values will later come from Component1 and Component4.

For now create a function to give mock values.

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

# Future Integration

## Component 1 — Behavior Monitoring

Will provide:

- app_switch_rate
- tab_switch_rate
- non_academic_transitions
- total_transitions
- idle_ratio

## Component 4 — Task Scheduling

Will provide:

- completed_tasks_last_7_days
- assigned_tasks_last_7_days
- task_priority
- grade_weight_normalized
- time_spent_on_task
- assigned_time
- task_deadline_time

Until then use mock context.

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
