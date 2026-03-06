/**
 * /main/ipc-intervention.ts
 * IPC Handlers — Smart Intervention Engine
 *
 * Registers all intervention-related IPC channels.
 * Call registerInterventionHandlers() from index.ts after pythonBridge is created.
 */

import { ipcMain, Notification, BrowserWindow, Tray } from 'electron';
import { PythonBridge } from './python-bridge';

export function registerInterventionHandlers(
    pythonBridge: PythonBridge,
    getMainWindow: () => BrowserWindow | null,
    getTray?: () => Tray | null,
): void {

    // ── API bridge handlers ────────────────────────────────────────────────

    ipcMain.handle('intervention:bandit-select', async (_event, req) => {
        const result = await pythonBridge.request('POST', '/intervention/bandit/select', req);
        if (!result.success) throw new Error(result.error ?? 'bandit-select failed');
        return result.data;
    });

    ipcMain.handle('intervention:bandit-update', async (_event, req) => {
        const result = await pythonBridge.request('POST', '/intervention/bandit/update', req);
        if (!result.success) throw new Error(result.error ?? 'bandit-update failed');
        return result.data;
    });

    ipcMain.handle('intervention:get-events', async (_event, userId: string) => {
        const result = await pythonBridge.request('GET', `/intervention/bandit/events?user_id=${userId}`);
        return result.data;
    });

    ipcMain.handle('intervention:log-motivation', async (_event, entry) => {
        const result = await pythonBridge.request('POST', '/intervention/motivation/log', entry);
        if (!result.success) throw new Error(result.error ?? 'log-motivation failed');
        return result.data;
    });

    ipcMain.handle('intervention:get-motivation-history', async (_event, userId: string, since?: number) => {
        const sinceParam = since ?? 3600;
        const result = await pythonBridge.request(
            'GET',
            `/intervention/motivation/history?user_id=${userId}&since=${sinceParam}`,
        );
        return result.data;
    });

    ipcMain.handle('intervention:get-user-goal', async () => {
        const result = await pythonBridge.request('GET', '/intervention/user/goal');
        return result.data;
    });

    ipcMain.handle('intervention:save-user-goal', async (_event, goal: string) => {
        const result = await pythonBridge.request('POST', '/intervention/user/goal', { life_goal: goal });
        if (!result.success) throw new Error(result.error ?? 'save-user-goal failed');
        return result.data;
    });

    ipcMain.handle('intervention:get-context', async (_event, userId: string) => {
        const result = await pythonBridge.request('GET', `/intervention/context/${userId}`);
        return result.data;
    });

    // ── OS Notification with action buttons ───────────────────────────────

    ipcMain.on('intervention:notify-actions', (_event, data: { title: string; body: string; strategy: string }) => {
        const mainWindow = getMainWindow();

        const notification = new Notification({
            title: data.title,
            body: data.body,
            actions: [
                { type: 'button', text: 'Start' },
                { type: 'button', text: 'Skip' },
                { type: 'button', text: 'Not Now' },
            ],
            closeButtonText: 'Not Now',
        });

        notification.on('action', (_e, index) => {
            const actionMap: Record<number, string> = { 0: 'start', 1: 'skip', 2: 'not_now' };
            const action = actionMap[index] ?? 'not_now';
            mainWindow?.webContents.send('notification-action-response', {
                strategy: data.strategy,
                action,
            });
        });

        notification.on('close', () => {
            // Dismissed without clicking a button — treat as "not_now"
            mainWindow?.webContents.send('notification-action-response', {
                strategy: data.strategy,
                action: 'not_now',
            });
        });

        notification.show();
    });

    // ── Tray timer (macOS menu bar label) ─────────────────────────────────

    ipcMain.on('intervention:tray-update', (_event, data: { label: string }) => {
        const tray = getTray?.();
        if (tray) {
            tray.setTitle(data.label);
        }
    });

    ipcMain.on('intervention:tray-clear', () => {
        const tray = getTray?.();
        if (tray) {
            tray.setTitle('');
        }
    });

    // ── Window visibility ─────────────────────────────────────────────────

    ipcMain.on('intervention:window-show', () => {
        const mainWindow = getMainWindow();
        mainWindow?.show();
        mainWindow?.focus();
    });
}
