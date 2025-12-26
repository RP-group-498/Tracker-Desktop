/**
 * IPC Handlers
 *
 * Sets up IPC communication between main and renderer processes.
 */

import { IpcMain } from 'electron';
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
            return {
                running: true,
                ...health.data,
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
}
