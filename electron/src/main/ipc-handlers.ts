/**
 * IPC Handlers
 *
 * Sets up IPC communication between main and renderer processes.
 */

import { IpcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { PythonBridge } from './python-bridge';
import { NativeMessagingServer } from './native-messaging';

interface AppState {
    pythonRunning: boolean;
    extensionConnected: boolean;
    currentSessionId: string | null;
    eventCount: number;
}

export function setupIpcHandlers(
    ipcMain: IpcMain,
    getAppState: () => AppState,
    pythonBridge: PythonBridge,
    nativeMessaging: NativeMessagingServer
): void {
    // Get current app state
    ipcMain.handle('get-state', () => {
        return getAppState();
    });

    // Get backend status
    ipcMain.handle('get-backend-status', async () => {
        const isRunning = pythonBridge.getIsRunning();

        if (!isRunning) {
            return {
                running: false,
                error: 'Backend not running',
            };
        }

        try {
            const health = await pythonBridge.request('GET', '/health');
            const healthData = typeof health.data === 'object' && health.data !== null ? health.data : {};
            return {
                running: true,
                ...(healthData as Record<string, unknown>),
            };
        } catch (error) {
            return {
                running: false,
                error: String(error),
            };
        }
    });

    // Get connection status
    ipcMain.handle('get-connection-status', () => {
        return {
            pythonRunning: pythonBridge.getIsRunning(),
            extensionConnected: nativeMessaging.isExtensionConnected(),
            currentSession: nativeMessaging.getCurrentSession(),
        };
    });

    // Get current session
    ipcMain.handle('get-current-session', async () => {
        const result = await pythonBridge.getCurrentSession();
        return result.data;
    });

    // Get recent activity
    ipcMain.handle('get-recent-activity', async (_event, limit: number = 50) => {
        const result = await pythonBridge.request('GET', `/activity?limit=${limit}`);
        return result.data;
    });

    // Get current activity session (latest activity)
    ipcMain.handle('get-current-activity-session', async () => {
        const result = await pythonBridge.request('GET', '/activity/current-session');
        return result.data;
    });

    // Get event stream
    ipcMain.handle('get-event-stream', async (_event, minutes: number = 30) => {
        const result = await pythonBridge.request('GET', `/activity/stream?minutes=${minutes}`);
        return result.data;
    });

    // Get activity stats
    ipcMain.handle('get-activity-stats', async () => {
        const result = await pythonBridge.request('GET', '/activity/stats');
        return result.data;
    });

    // Get component status
    ipcMain.handle('get-component-status', async (_event, name: string) => {
        const result = await pythonBridge.getComponentStatus(name);
        return result.data;
    });

    // Send command to extension
    ipcMain.handle('send-command', (_event, command: 'pause' | 'resume' | 'clear_local') => {
        nativeMessaging.sendCommand(command);
        return { success: true };
    });

    // Restart Python backend
    ipcMain.handle('restart-backend', async () => {
        try {
            await pythonBridge.stop();
            await pythonBridge.start();
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    // Analyze PDF or text content via task prioritization component
    ipcMain.handle('analyze-pdf', async (_event, data: {
        pdfPath?: string;
        textContent?: string;
        deadline: string;
        credits: number;
        weight: number;
        userId?: string;
    }) => {
        // Map camelCase (frontend) → snake_case (FastAPI Pydantic model)
        const payload: Record<string, unknown> = {
            deadline: data.deadline,
            credits: data.credits,
            weight: data.weight,
        };
        if (data.pdfPath) payload.pdf_path = data.pdfPath;
        if (data.textContent) payload.text_content = data.textContent;
        if (data.userId) payload.user_id = data.userId;

        // Use a longer timeout (120s) — Gemini PDF analysis can take 15-30+ seconds
        const result = await pythonBridge.request('POST', '/tasks/analyze', payload, 120000);
        return result.data;
    });

    // --- Authentication ---

    const TOKEN_FILE = path.join(app.getPath('userData'), 'auth_token.json');

    ipcMain.handle('start-oauth-login', async (event) => {
        const BACKEND_PORT = 8000;
        const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

        const { BrowserWindow: AuthBrowserWindow } = require('electron');
        const authWindow = new AuthBrowserWindow({
            width: 800,
            height: 600,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            },
        });

        authWindow.loadURL(`${BACKEND_URL}/api/auth/login`);

        // The backend callback returns JSON: { access_token, token_type, user }
        // did-finish-load fires when the page is done — use executeJavaScript to read body text
        authWindow.webContents.on('did-finish-load', async () => {
            const url = authWindow.webContents.getURL();
            console.log('[Auth] did-finish-load URL:', url);

            if (url.includes('/api/auth/callback')) {
                try {
                    // Give the browser a tick to render the JSON body
                    await new Promise(resolve => setTimeout(resolve, 200));

                    const bodyText = await authWindow.webContents.executeJavaScript(
                        'document.body ? document.body.innerText : ""'
                    );
                    console.log('[Auth] Callback body:', bodyText.substring(0, 200));

                    const data = JSON.parse(bodyText);

                    if (data.access_token) {
                        // Persist token to disk
                        fs.writeFileSync(TOKEN_FILE, JSON.stringify(data));
                        // Set on pythonBridge so all subsequent requests are authenticated
                        pythonBridge.setAuthToken(data.access_token);

                        console.log('[Auth] Token saved and set on PythonBridge');

                        // Notify renderer
                        event.sender.send('auth-success', {
                            token: data.access_token,
                            user: data.user,
                        });

                        authWindow.close();
                    } else {
                        console.error('[Auth] No access_token in response:', data);
                    }
                } catch (err) {
                    console.error('[Auth] Failed to parse auth callback body:', err);
                }
            }
        });

        authWindow.on('closed', () => {
            console.log('[Auth] Auth window closed');
        });
    });

    ipcMain.handle('get-auth-token', async () => {
        try {
            if (fs.existsSync(TOKEN_FILE)) {
                const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
                pythonBridge.setAuthToken(data.access_token);
                return { token: data.access_token, user: data.user ?? null };
            }
        } catch (e) {
            console.error('Failed to read auth token', e);
        }
        return null;
    });

    ipcMain.handle('clear-auth', async () => {
        pythonBridge.setAuthToken(null);
        if (fs.existsSync(TOKEN_FILE)) {
            fs.unlinkSync(TOKEN_FILE);
        }
    });

    ipcMain.handle('get-auth-user-id', async () => {
        try {
            if (fs.existsSync(TOKEN_FILE)) {
                const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
                return data.user?.id ?? null;
            }
        } catch (e) {
            console.error('Failed to read auth user id', e);
        }
        return null;
    });

    let activeTasksWindowRef: any = null;

    ipcMain.handle('open-active-tasks-window', async (event) => {
        if (activeTasksWindowRef) {
            activeTasksWindowRef.focus();
            return;
        }

        const { BrowserWindow: ActiveTasksWindow } = require('electron');
        activeTasksWindowRef = new ActiveTasksWindow({
            width: 360,
            height: 480,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                nodeIntegration: false,
                contextIsolation: true,
            },
        });

        // Notify renderer that it's popped out
        event.sender.send('active-tasks-popped-out', true);

        activeTasksWindowRef.on('closed', () => {
            activeTasksWindowRef = null;
            // Notify renderer that it's closed
            try {
                event.sender.send('active-tasks-popped-out', false);
            } catch (e) {} // sender might be destroyed if app is closing
        });

        if (process.env.NODE_ENV === 'development') {
            activeTasksWindowRef.loadURL('http://localhost:5173?widget=active-tasks');
        } else {
            activeTasksWindowRef.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { widget: 'active-tasks' } });
        }
    });

    ipcMain.on('resize-active-tasks-window', (_event, height) => {
        if (activeTasksWindowRef) {
            const [width] = activeTasksWindowRef.getSize();
            activeTasksWindowRef.setSize(width, Math.min(height, 800));
        }
    });

}
