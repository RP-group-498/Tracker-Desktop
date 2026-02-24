# Focus App Desktop - Developer Guide

This guide provides context for continuing development on the Focus App desktop application.

## Current Implementation Status

### Completed Features

| Feature | Status | Notes |
|---------|--------|-------|
| Electron App Shell | Done | System tray, window management |
| Python Backend | Done | FastAPI with async SQLite |
| Native Messaging Server | Done | HTTP bridge on port 8765 |
| Browser Extension Integration | Done | Receives activity batches |
| Desktop Activity Tracking | Done | Polls active window every 1 second |
| Rule-based Classification | Done | Browser domains + desktop apps |
| Unified Activity Schema | Done | Both sources use same endpoint |

### Pending Features

| Feature | Priority | Notes |
|---------|----------|-------|
| ML Classification | High | Replace stub with actual models |
| Renderer UI | Medium | Currently shows connection refused (dev server not running) |
| Database Migration | Low | Currently recreates on schema change |
| Procrastination Detection | Future | After classification is solid |

## Code Architecture

### Electron Main Process Services

```
index.ts
  ├── PythonBridge          # Spawns and communicates with Python backend
  ├── NativeMessagingServer # HTTP server for browser extension
  ├── DesktopActivityTracker # Polls active window, sends events
  └── TrayManager           # System tray icon and menu
```

### Service Initialization Order

1. `PythonBridge.start()` - Starts Python backend, waits for health check
2. `NativeMessagingServer.start()` - Starts HTTP server on port 8765
3. `DesktopActivityTracker.start()` - Loads active-win, begins polling
4. `TrayManager` - Creates system tray

### Data Flow

```
Browser Extension
       │
       │ POST /native-message (activity_batch)
       v
NativeMessagingServer ──────────────────────┐
       │                                    │
       │                                    │
Desktop Activity Tracker                    │
       │                                    │
       │ (both call PythonBridge)           │
       v                                    v
PythonBridge.submitActivityBatch([events])
       │
       │ POST /api/activity/batch
       v
Python Backend
       │
       ├── Classification Component
       │   └── _classify_desktop_app() or _classify_by_rules()
       │
       └── SQLite Database
           └── activity_events table
```

## Key Files

### Electron (TypeScript)

| File | Purpose |
|------|---------|
| `src/main/index.ts` | Main entry, coordinates all services |
| `src/main/desktop-activity-tracker.ts` | Polls active window, tracks duration, sends events |
| `src/main/python-bridge.ts` | HTTP client for Python backend |
| `src/main/native-messaging.ts` | HTTP server receiving browser extension messages |
| `vite.config.ts` | Build config - note `active-win` in externals |

### Python Backend

| File | Purpose |
|------|---------|
| `app/api/activity.py` | `/activity/batch` endpoint - handles both browser and desktop events |
| `app/models/activity.py` | SQLAlchemy model with `source`, `app_name`, `app_path`, `window_title` |
| `app/schemas/activity.py` | Pydantic schemas with desktop fields |
| `app/components/classification/component.py` | Classification with desktop app rules |

## Desktop Activity Tracker Details

### Location
`electron/src/main/desktop-activity-tracker.ts`

### Key Implementation Points

1. **Dynamic Import**: `active-win` is loaded dynamically to handle ESM/CJS interop
   ```typescript
   const module = await import('active-win');
   activeWin = module.default || module;
   ```

2. **Window Change Detection**: Compares window ID and process ID
   ```typescript
   const windowChanged = !this.currentWindow ||
       this.currentWindow.id !== newWindow.id ||
       this.currentWindow.owner.processId !== newWindow.owner.processId;
   ```

3. **Event Flushing**: Events are sent when:
   - User switches to a different application
   - Tracker is stopped (flushes current window)
   - Minimum duration threshold (1 second) is met

4. **Compatibility Fields**: Desktop events include browser-compatible fields:
   - `domain`: App name (lowercase, no .exe)
   - `url`: `app://appname/windowId`

### Console Logs to Expect

```
[DesktopTracker] start() called
[DesktopTracker] Loading active-win module...
[DesktopTracker] Module loaded: [ 'default', 'getOpenWindows', 'getOpenWindowsSync', 'sync' ]
[DesktopTracker] active-win ready, type: function
[DesktopTracker] Initial window: <AppName> - <WindowTitle>
[DesktopTracker] Desktop activity tracking started
[DesktopTracker] Window changed: <NewApp> - <NewTitle>
[DesktopTracker] Recorded: <PrevApp> (12345ms)
```

## Classification Component

### Location
`backend/app/components/classification/component.py`

### Desktop App Rule Sets

```python
DESKTOP_PRODUCTIVITY_APPS = {
    "code", "vscode", "pycharm", "intellij", "webstorm",
    "word", "excel", "powerpoint", "notion", "obsidian",
    "figma", "photoshop", "terminal", "cmd", "powershell",
    "slack", "teams", "zoom", ...
}

DESKTOP_ACADEMIC_APPS = {
    "zotero", "mendeley", "endnote",
    "matlab", "mathematica", "rstudio", "jupyter",
    "texstudio", "overleaf", ...
}

DESKTOP_NON_ACADEMIC_APPS = {
    "steam", "epicgameslauncher", "discord",
    "vlc", "spotify", "netflix",
    "minecraft", "valorant", ...
}

DESKTOP_NEUTRAL_APPS = {
    "chrome", "firefox", "edge", "explorer", "finder", ...
}
```

### Classification Logic

```python
def process(self, data):
    source = data.get("source", "browser")

    if source == "desktop":
        app_name = data.get("app_name", "").lower()
        window_title = data.get("window_title", "").lower()
        category, confidence, matched_rule = self._classify_desktop_app(app_name, window_title)
    else:
        # Browser classification using domain/URL rules
        category, confidence, matched_rule = self._classify_by_rules(domain, url, title)
```

## Common Issues & Solutions

### Issue: "Cannot find module 'mock-aws-s3'"

**Cause**: Vite tries to bundle `active-win` dependencies that aren't needed at runtime.

**Solution**: Mark `active-win` as external in `vite.config.ts`:
```typescript
rollupOptions: {
    external: ['electron', 'active-win'],
}
```

### Issue: Python backend path not found

**Cause**: `NODE_ENV` not set, so app uses production paths.

**Solution**: Use `cross-env` in package.json:
```json
"start": "cross-env NODE_ENV=development electron ."
```

### Issue: Port 8765 already in use

**Cause**: Previous instance didn't close properly.

**Solution**: Kill electron processes:
```bash
taskkill //F //IM electron.exe
```

### Issue: TypeScript build errors

**Cause**: Strict unused variable checks.

**Solution**: Set in `tsconfig.json`:
```json
"noUnusedLocals": false,
"noUnusedParameters": false
```

## Development Commands

```bash
# Build Electron app
cd electron && npm run build

# Start in development mode
cd electron && npm start

# Run Python backend separately (for debugging)
cd backend
.\venv\Scripts\activate
uvicorn app.main:app --reload --port 8001
```

## Next Steps for Development

### Priority 1: ML Classification
- Replace rule-based stub with actual ML models
- See `browser-extension/docs/classification_guide_md.md` for architecture design
- Consider: Homepage2Vec, DistilBERT, local LLM via Ollama

### Priority 2: Fix Renderer UI
- Currently fails to load `http://localhost:3000/` because dev server isn't running
- Either run `npm run dev` for hot reload, or load built files in production mode

### Priority 3: Database Improvements
- Add proper migrations (Alembic)
- Add indexes for common queries
- Consider retention policies for old data

### Priority 4: Testing
- Add unit tests for classification rules
- Integration tests for activity tracking flow
- End-to-end tests for full pipeline

## Database Schema

### activity_events table

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key |
| event_id | VARCHAR(36) | Unique event identifier |
| session_id | VARCHAR(36) | Session reference |
| source | VARCHAR(20) | 'browser' or 'desktop' |
| activity_type | VARCHAR(20) | 'webpage' or 'application' |
| timestamp | DATETIME | Event timestamp |
| url | TEXT | URL or app:// URI |
| domain | VARCHAR(255) | Domain or app name |
| title | VARCHAR(512) | Page or window title |
| app_name | VARCHAR(255) | Application name (desktop only) |
| app_path | TEXT | Executable path (desktop only) |
| window_title | VARCHAR(512) | Window title (desktop only) |
| active_time | INTEGER | Duration in milliseconds |
| classification_id | INTEGER | FK to classifications table |

### classifications table

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key |
| category | VARCHAR(50) | academic, productivity, neutral, non_academic |
| confidence | FLOAT | 0.0 to 1.0 |
| source | VARCHAR(50) | 'stub', 'rules', 'model', 'user' |
