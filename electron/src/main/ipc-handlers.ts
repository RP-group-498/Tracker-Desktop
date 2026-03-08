/**
 * IPC Handlers
 *
 * Sets up IPC communication between main and renderer processes.
 */

import { IpcMain, shell, app } from 'electron';
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
        const result = await pythonBridge.request('GET', `/activity/recent?limit=${limit}`);
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
        // 1. Open browser to the backend login route
        await shell.openExternal('http://localhost:8001/api/auth/login');

        // 2. Poll the backend until the token is ready
        // The backend `/auth/callback` sets a cookie or returns JSON, but since it's an external browser,
        // we might need the backend to store the token temporarily for this client, or expose a `/auth/token` polling endpoint.
        // For simplicity, let's assume the user manually pastes the token, or we implement a local callback server.

        // Wait, the plan says:
        // "The button will trigger the Electron main process to open a browser window to the backend's `/api/auth/login` endpoint, listen for the callback, and extract the resulting JWT."
        // We can do this by launching an Electron BrowserWindow instead of `shell.openExternal`.

        const authWindow = new (require('electron').BrowserWindow)({
            width: 800,
            height: 600,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        authWindow.loadURL('http://localhost:8001/api/auth/login');

        authWindow.webContents.on('will-redirect', (async (e: Electron.Event, url: string) => {
            if (url.includes('/api/auth/callback')) {
                // We don't prevent default here so it actually does the callback
            } else if (url.startsWith('focusapp://') || url.includes('localhost:5173') || url.includes('success')) {
                // Example of capturing via redirect
                e.preventDefault();
                // ...
            }
        }) as any);

        // Simpler approach for now: intercept when the navigation finishes on the callback page
        authWindow.webContents.on('did-finish-load', async () => {
            const url = authWindow.webContents.getURL();
            if (url.includes('/api/auth/callback') || url.includes('success')) {
                try {
                    // Extract text content which should be the token JSON
                    const result = await authWindow.webContents.executeJavaScript('document.body.innerText');
                    const data = JSON.parse(result);

                    if (data.access_token) {
                        // Save token locally
                        fs.writeFileSync(TOKEN_FILE, JSON.stringify(data));
                        pythonBridge.setAuthToken(data.access_token);

                        // Send to renderer
                        event.sender.send('auth-success', {
                            token: data.access_token,
                            user: data.user // Assuming backend returns user info too
                        });

                        authWindow.close();
                    }
                } catch (err) {
                    console.error('Failed to parse auth callback:', err);
                }
            }
        });
    });

    ipcMain.handle('get-auth-token', async () => {
        try {
            if (fs.existsSync(TOKEN_FILE)) {
                const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
                pythonBridge.setAuthToken(data.access_token);
                return data.access_token;
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

}
