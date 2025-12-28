# Focus App Desktop

Desktop application for procrastination detection research. Integrates with the Focus App browser extension to track and classify browsing activity, **plus native desktop application tracking** using a multi-component ML pipeline.

## Architecture

```
┌─────────────────────┐    ┌─────────────────────────────────────────────────────┐
│  Browser Extension  │───>│                    Electron App                      │
│  (Chrome/Edge)      │    │  ┌─────────────────┐  ┌────────────────────────┐    │
└─────────────────────┘    │  │ Native Messaging │  │ Desktop Activity       │    │
         Native Messaging  │  │ Server (:8765)   │  │ Tracker (active-win)   │    │
                           │  └────────┬─────────┘  └───────────┬────────────┘    │
                           │           │                        │                  │
                           │           └────────────┬───────────┘                  │
                           │                        │                              │
                           │                        v                              │
                           │              ┌─────────────────┐                      │
                           │              │  Python Bridge  │                      │
                           │              └────────┬────────┘                      │
                           └───────────────────────┼──────────────────────────────┘
                                                   │ HTTP (:8001)
                                                   v
                           ┌───────────────────────────────────────────────────────┐
                           │                  Python Backend                        │
                           │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
                           │  │ Activity API │  │ Classification│  │   SQLite    │  │
                           │  │   /batch     │  │  Component    │  │   Database  │  │
                           │  └──────────────┘  └──────────────┘  └─────────────┘  │
                           └───────────────────────────────────────────────────────┘
```

### Data Sources

- **Browser Extension**: Captures browsing activity (URLs, titles, active time), sends via Native Messaging
- **Desktop Activity Tracker**: Captures active window info (app name, window title, duration) every 1 second
- **Native Messaging Server**: HTTP bridge for Chrome extension communication on port 8765
- **Electron App**: System tray application that coordinates all services
- **Python Backend**: FastAPI server with component plugin system for ML classification

## Prerequisites

- Node.js 18+
- Python 3.10+
- Chrome browser with the Focus App extension installed

## Quick Start

### 1. Install Dependencies

```bash
# Install Electron dependencies
cd electron
npm install

# Create Python virtual environment
cd ../backend
python -m venv venv

# Activate venv (Windows)
.\venv\Scripts\activate

# Install Python packages
pip install -r requirements.txt
```

### 2. Register Native Messaging Host

```bash
cd native-host

# Replace YOUR_EXTENSION_ID with your actual extension ID from chrome://extensions
node install.js YOUR_EXTENSION_ID
```

### 3. Run in Development

Open two terminal windows:

**Terminal 1 - Python Backend:**
```bash
cd backend
.\venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 - Electron App:**
```bash
cd electron
npm run dev
```

Or use the convenience script:
```powershell
.\scripts\dev.ps1
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/session` | POST | Create session |
| `/api/session/current` | GET | Get current session |
| `/api/activity/batch` | POST | Submit activity events |
| `/api/activity/recent` | GET | Get recent activities |
| `/api/components` | GET | List components |
| `/api/components/{name}/status` | GET | Get component status |

## Desktop Activity Tracking

The desktop activity tracker monitors which application window is currently active and tracks time spent in each application.

### How It Works

1. **Polling**: Every 1 second, uses `active-win` package to get the currently focused window
2. **Change Detection**: When the active window changes (different app or window ID), records the previous window's duration
3. **Event Submission**: Sends activity events to the Python backend via the same `/activity/batch` endpoint as browser events
4. **Classification**: Backend classifies desktop apps using rule-based patterns (80+ apps configured)

### Desktop Event Data Structure

```typescript
interface DesktopActivityEvent {
    eventId: string;
    sessionId: string | null;
    source: 'desktop';           // Distinguishes from 'browser' events
    activityType: 'application'; // vs 'webpage' for browser
    timestamp: string;
    startTime: string;
    endTime: string;
    appName: string;             // e.g., "Code", "chrome", "vlc"
    appPath: string;             // Full executable path
    windowTitle: string;         // Window title text
    activeTime: number;          // Duration in milliseconds
    // Compatibility fields for unified schema
    domain: string;              // App name (lowercase, no .exe)
    url: string;                 // app://appname/windowId
}
```

### Desktop App Classification Rules

| Category | Example Apps |
|----------|--------------|
| **productivity** | VS Code, PyCharm, Word, Excel, Figma, Terminal, Slack, Teams |
| **academic** | Zotero, Mendeley, MATLAB, RStudio, Jupyter, LaTeX editors |
| **non_academic** | Steam, VLC, Spotify, Netflix, Discord, Games |
| **neutral** | Browsers (classified by content), File Explorer, Settings |

## Component System

Components are pluggable ML modules. Currently implemented:

- **Classification** (stub): Rule-based classification for both browser domains AND desktop applications

Future components:
- Procrastination Detection
- Intervention System
- Task Breakdown

### Adding a New Component

1. Create folder: `backend/app/components/your_component/`
2. Implement `ComponentBase` interface in `component.py`
3. Define Pydantic schemas in `schemas.py`
4. Register in `backend/app/components/__init__.py`

## Project Structure

```
desktop-app/
├── electron/                    # Electron application
│   ├── src/
│   │   ├── main/
│   │   │   ├── index.ts                    # Main entry, service coordination
│   │   │   ├── python-bridge.ts            # HTTP client for Python backend
│   │   │   ├── native-messaging.ts         # Server for browser extension
│   │   │   ├── desktop-activity-tracker.ts # Desktop window tracking (NEW)
│   │   │   ├── tray.ts                     # System tray management
│   │   │   └── ipc-handlers.ts             # IPC communication
│   │   ├── renderer/            # React UI
│   │   └── preload/             # IPC bridge
│   ├── package.json
│   └── vite.config.ts           # Build config (active-win externalized)
│
├── backend/                     # Python FastAPI
│   ├── app/
│   │   ├── api/
│   │   │   └── activity.py      # Activity batch endpoint (handles both browser & desktop)
│   │   ├── components/
│   │   │   └── classification/
│   │   │       └── component.py # Classification with desktop app rules
│   │   ├── core/                # Database, registry
│   │   ├── models/
│   │   │   └── activity.py      # ActivityEvent model (source, app_name fields)
│   │   └── schemas/
│   │       └── activity.py      # Pydantic schemas (desktop fields)
│   └── requirements.txt
│
├── native-host/                 # Chrome Native Messaging
│   ├── native-host.js
│   └── install.js
│
└── scripts/                     # Development scripts
```

## Building for Production

```bash
# Bundle Python backend
cd backend
pip install pyinstaller
pyinstaller --onefile --add-data "data;data" app/main.py

# Build Electron app
cd ../electron
npm run build
npm run package
```

## Troubleshooting

### Extension not connecting

1. Check extension ID matches in `native-host/com.focusapp.monitor.json`
2. Verify registry key exists: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.focusapp.monitor`
3. Check native host logs: `native-host/native-host.log`

### Backend not starting

1. Ensure Python venv is activated
2. Check port 8000 is available
3. Verify all requirements are installed

### Electron not finding backend

1. Ensure backend is running on port 8000
2. Check health endpoint: `http://localhost:8000/api/health`

## Related Documentation

- `CLAUDE.md` - Developer guide for continuing development
- `../browser-extension/docs/classification_guide_md.md` - Classification system design guide
- `../browser-extension/README.md` - Browser extension documentation
- `../browser-extension/CLAUDE.md` - Browser extension developer guide

## Development Notes

### Key Dependencies

- **active-win** (^8.2.1): Native module for getting active window info. Must be marked as `external` in Vite config to avoid bundling issues.
- **cross-env**: Required for setting NODE_ENV in npm scripts on Windows

### Important Configuration

1. **Vite Config** (`vite.config.ts`): `active-win` must be in `external` array to load from node_modules at runtime
2. **Package.json**: `start` script uses `cross-env NODE_ENV=development` for correct path resolution
3. **TypeScript Config**: `noUnusedLocals` and `noUnusedParameters` set to `false` to allow underscore-prefixed unused params
