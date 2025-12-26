# Focus App Desktop

Desktop application for procrastination detection research. Integrates with the browser extension to track and classify browsing activity.

## Architecture

```
Browser Extension <-> Native Messaging Host <-> Electron App <-> Python Backend <-> SQLite
```

- **Electron App**: System tray application with minimal UI
- **Python Backend**: FastAPI server with component plugin system
- **Native Messaging Host**: Node.js bridge for Chrome extension communication

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

## Component System

Components are pluggable ML modules. Currently implemented:

- **Classification** (stub): Basic rule-based domain classification

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
├── electron/           # Electron application
│   ├── src/
│   │   ├── main/       # Main process
│   │   ├── renderer/   # React UI
│   │   └── preload/    # IPC bridge
│   └── package.json
│
├── backend/            # Python FastAPI
│   ├── app/
│   │   ├── api/        # REST endpoints
│   │   ├── components/ # ML components
│   │   ├── core/       # Database, registry
│   │   ├── models/     # SQLAlchemy models
│   │   └── schemas/    # Pydantic schemas
│   └── requirements.txt
│
├── native-host/        # Chrome Native Messaging
│   ├── native-host.js
│   └── install.js
│
└── scripts/            # Development scripts
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
