# Data Collection and Classification System Architecture

This guide breaks down the core architecture of the data collection and classification component, explaining how data is gathered from the browser extension and desktop application, and how synchronization works across SQLite and MongoDB.

## 1. Data Collection & Synchronization (Browser Extension & Desktop App)
The system tracks digital behavior across two primary sources: the **browser extension** (for websites) and the **desktop application** (for native apps).

- **The Source:** 
  The browser extension listens to active tab events (URLs, tab focus changes) and timestamps them.
  The desktop application (Electron) listens to the OS window manager to track foreground applications (measuring window title, app name, and path).
- **The Sync Mechanism:**
  Both clients gather these activity events locally and dispatch them securely to the FastAPI backend via the `POST /api/activity/batch` endpoint.
- **The API Endpoint (`app/api/activity.py`):**
  When the backend receives the batch, it:
  1. Grabs an asynchronous write lock (`_db_write_lock`) down to the SQLite database (ensuring no concurrent write conflicts).
  2. Runs a deduplication check (`ActivityEvent.event_id`) so retries from the extension or desktop app don't create duplicate entries.
  3. Sends the raw data to the **Classification Component** to determine the context of the activity.

## 2. The 3-Layer Classification Engine (`classification/component.py`)
To accurately classify raw activities into meaningful buckets (`academic`, `productivity`, `neutral`, `non_academic`), the system uses a progressive 3-layer architecture balancing speed, cost, and accuracy.

### Layer 1: Rule-Based Classification (Fast & High Confidence)
- **Mechanism:** Exact substring or keyword matching.
- **Rules Origin:** Definitions are hardcoded lists at the top of `component.py` (e.g., `ACADEMIC_DOMAINS` containing `.edu` and `scholar.google`, and `DESKTOP_NON_ACADEMIC_APPS` containing `steam` and `netflix`).
- **Logic:** The module compares the URL/Domain or App Name/Window Title against the predefined sets. If a match is found, it immediately assigns a classification with a high confidence score (e.g., `whatsapp.com` -> `non_academic` with **0.85** confidence).
- **Condition:** If the confidence returned is `>= 0.80`, the process stops here, and the data is saved as "Source: rules".

### Layer 2: Zero-Shot ML Classification (Medium Confidence Fallback)
- **Mechanism:** Pre-Trained Natural Language Inference (NLI).
- **Tooling:** Uses the HuggingFace `facebook/bart-large-mnli` model, executed locally (`classification/ml_classifier.py`).
- **Logic:** If Layer 1 fails to find a match (resulting in a confidence below 0.80), the URL and Window Title are concatenated into a natural language string: `"Website: <domain> | Page: <title>"`.
- **Zero-Shot Engine:** The ML model evaluates this string against human-readable category descriptions (e.g., "academic research, studying...", "entertainment, social media...") without needing custom training data.
- **Condition:** If the model's confidence for any label exceeds the `confidence_threshold` (currently **0.55**), it is accepted. It is assigned "Source: model".

### Layer 3: The Gemini AI Batch Fallback (Low Confidence Catch-all)
- **Mechanism:** Large Language Model (LLM) API.
- **Logic:** If both Layer 1 and Layer 2 fail to accurately classify the activity with sufficient confidence (i.e. the ML model returns a score lower than 0.55), the classification is marked as **pending**.
- **The Placeholder:** In the database, the activity is temporarily saved with category `neutral`, confidence `0.40`, and source `pending_ai`.
- **Background Batching:** A background scheduler thread in FastAPI (`services/gemini_batch_worker.py`) awakens every interval (e.g. 1800s/30 mins). It scoops up all `pending_ai` records and sends them in a single batch to the Gemini API (`gemini-2.5-flash`). This limits expensive rate-limiting calls and updates the database asynchronously.

## 3. Database Sync Architecture (SQLite + MongoDB)
The application relies on a dual-database design ensuring local reliability with cloud accessibility for the research team.

- **Primary Store (SQLite):**
  Uses `aiosqlite`. All data and classifications are immediately committed to a local file (`./data/focusapp_v2.db`). This handles rapid writes, guarantees offline capabilities, and avoids cloud latency for the desktop dashboard.
- **Secondary Mirror (MongoDB):**
  A fire-and-forget mirroring system designed specifically so the research pipeline has access to user data.
- **How it syncs (`services/mongodb_sync.py`):**
  1. While looping through the `batch` of data received from the browser/desktop, the FastAPI endpoint structures a flat dictionary representing the document.
  2. Outside of the primary SQLite lock, the backend triggers an asynchronous background task: `asyncio.create_task(mongo_sync.sync_batch(mongo_documents))`.
  3. This executes `update_one` with `upsert=True` inside MongoDB Atlas. If the data is safely transmitted, the transaction is complete.
  4. **Resiliency:** If MongoDB is offline or the user disconnects from Wi-Fi, the sync fails. However, the `mongodb_sync.py` service maintains an internal `_retry_queue`. Every `RETRY_INTERVAL_SECONDS` (60s), a background loop attempts to resync failed documents without blocking the main application thread.

## 4. General Backend Architecture (FastAPI & Structure)
The backend is built utilizing **FastAPI**, creating a modern, asynchronous architecture optimal for I/O bound operations (like ML classification and database syncs).

### Core Folder Structure breakdown
- `app/api/`: Holds the route handlers. This defines the endpoints the frontend talks to.
  - `activity.py`: The crucial file handling `POST /batch` for incoming raw tracking data.
  - `tasks.py`: Managing user tasks.
- `app/components/`: Modular domain logic encapsulating major system features.
  - `classification/`: The 3-layer engine.
  - `PatternDetection/`: Analyzing behaviors.
  - `task_prioritization/`: Uses AI/MCDM to rank user duties.
- `app/core/`: Essential startup and infrastructure boilerplate (database connections, component registry).
- `app/models/`: SQLAlchemy ORM classes that map Python objects to SQLite tables.
- `app/services/`: Background, decoupled services.
  - `mongodb_sync.py`: The resilient queued sender for MongoDB.
  - `gemini_batch_worker.py`: Background thread polling for `pending_ai` rows.

### How FastAPI works here
1. **Entrypoint:** Initiated via `uvicorn app.main:app`. It spins up an event loop.
2. **Lifespan events:** As the app starts, it connects SQLite, starts the `MongoSyncService`, pre-loads models (Lazy or Eager based on config), and boots the background schedulers.
3. **Execution:** Endpoints use `async def` paired with `await` for I/O tasks (database query). However, note that heavy CPU-bounds tasks (like the zero-shot ML inference) are handled carefully, sometimes forcing lazy evaluation so they don't freeze the async event loop serving HTTP requests.
