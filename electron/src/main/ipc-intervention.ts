/**
 * /main/ipc-intervention.ts
 * IPC Handlers — Smart Intervention Engine
 *
 * Registers all intervention-related IPC channels.
 * Call registerInterventionHandlers() from index.ts after pythonBridge is created.
 *
 * On Windows, native Notification actions and tray.setTitle() are not supported.
 * This module uses InterventionPopup (custom BrowserWindow toasts) on Windows
 * and native Notification on macOS.
 */

import { ipcMain, Notification, BrowserWindow, Tray, dialog, powerMonitor } from 'electron';
import { PythonBridge } from './python-bridge';
import { InterventionPopup } from './intervention-popup';

const isMac = process.platform === 'darwin';

export function registerInterventionHandlers(
    pythonBridge: PythonBridge,
    getMainWindow: () => BrowserWindow | null,
    getTray?: () => Tray | null,
): void {

    // Create popup manager for all platforms
    const interventionPopup = new InterventionPopup(getMainWindow);

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

    ipcMain.handle('intervention:get-events', async () => {
        const result = await pythonBridge.request('GET', '/intervention/bandit/events');
        return result.data;
    });

    ipcMain.handle('intervention:log-motivation', async (_event, entry) => {
        const result = await pythonBridge.request('POST', '/intervention/motivation/log', entry);
        if (!result.success) throw new Error(result.error ?? 'log-motivation failed');
        return result.data;
    });

    ipcMain.handle('intervention:get-motivation-history', async (_event, since?: number) => {
        const sinceParam = since ?? 3600;
        const result = await pythonBridge.request(
            'GET',
            `/intervention/motivation/history?since=${sinceParam}`,
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

    ipcMain.handle('intervention:generate-reframe-text', async (_event, goal: string) => {
        const result = await pythonBridge.request('POST', '/intervention/reframe-text', { life_goal: goal });
        if (!result.success) throw new Error(result.error ?? 'generate-reframe-text failed');
        return result.data;
    });

    ipcMain.handle('intervention:get-context', async () => {
        const result = await pythonBridge.request('GET', '/intervention/context');
        if (!result.success) throw new Error(result.error ?? 'get-context failed');
        return result.data;
    });

    // ── OS Notification with action buttons ───────────────────────────────

    ipcMain.on('intervention:notify-actions', (_event, data: { title: string; body: string; strategy: string }) => {
        if (!isMac && interventionPopup) {
            // Windows: use custom popup window (native Notification has no action buttons)
            interventionPopup.show(data);
            return;
        }

        // macOS: use native Notification with action buttons
        const mainWindow = getMainWindow();

        const notification = new Notification({
            title: data.title,
            body: data.body,
            actions: [
                { type: 'button', text: 'Start' },
                { type: 'button', text: 'Skip' },
            ],
            closeButtonText: 'Not Now',
        });

        notification.on('action', (_e, index) => {
            const actionMap: Record<number, string> = { 0: 'start', 1: 'skip' };
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

    // ── Plain OS notification (no action buttons) ──────────────────────────
    ipcMain.on('intervention:notify', (_event, data: { title: string; body: string }) => {
        const notification = new Notification({
            title: data.title,
            body: data.body,
        });
        notification.show();
    });

    // ── Tray timer ────────────────────────────────────────────────────────

    ipcMain.on('intervention:tray-update', (_event, data: { label: string }) => {
        const tray = getTray?.();

        if (isMac) {
            // macOS: setTitle() renders text next to tray icon in menu bar
            if (tray) {
                tray.setTitle(data.label);
            }
        } else {
            // Windows: setTitle() is a no-op; use tooltip instead
            if (tray) {
                tray.setToolTip('Focus App - ' + data.label);
            }
        }
        interventionPopup.updateTimer(data.label); // All platforms
    });

    ipcMain.on('intervention:tray-clear', () => {
        const tray = getTray?.();

        if (isMac) {
            if (tray) {
                tray.setTitle('');
            }
        } else {
            if (tray) {
                tray.setToolTip('Focus App');
            }
        }
        interventionPopup.clearTimer(); // All platforms
    });

    // ── Window visibility ─────────────────────────────────────────────────

    ipcMain.on('intervention:window-show', () => {
        const mainWindow = getMainWindow();
        mainWindow?.show();
        mainWindow?.focus();
    });

    // ── Pomodoro idle detection ───────────────────────────────────────────

    let pomodoroIdleInterval: ReturnType<typeof setInterval> | null = null;
    let idlePromptShown = false;

    ipcMain.on('intervention:pomodoro-started', () => {
        idlePromptShown = false;
        if (pomodoroIdleInterval) clearInterval(pomodoroIdleInterval);

        pomodoroIdleInterval = setInterval(() => {
            const idleSeconds = powerMonitor.getSystemIdleTime();
            if (idleSeconds >= 300 && !idlePromptShown) {
                idlePromptShown = true;
                const mainWindow = getMainWindow();

                if (isMac) {
                    // macOS: use native dialog
                    dialog.showMessageBox({
                        type: 'question',
                        title: 'Are you there?',
                        message: 'You\'ve been idle for 5 minutes during your Pomodoro session.',
                        buttons: ['Yes, I\'m here', 'No, stop timer'],
                        defaultId: 0,
                    }).then(({ response }) => {
                        if (response === 0) {
                            // Continue — reset idle check
                            idlePromptShown = false;
                        } else {
                            // Stop
                            mainWindow?.webContents.send('intervention:pomodoro-idle', { action: 'stop' });
                        }
                    });

                    // Auto-dismiss after 15s by treating as stop
                    setTimeout(() => {
                        if (idlePromptShown) {
                            mainWindow?.webContents.send('intervention:pomodoro-idle', { action: 'stop' });
                            idlePromptShown = false;
                        }
                    }, 15_000);
                } else {
                    // Windows: use custom popup
                    interventionPopup?.showIdlePrompt();
                }
            }
        }, 10_000);
    });

    ipcMain.on('intervention:pomodoro-stopped', () => {
        if (pomodoroIdleInterval) {
            clearInterval(pomodoroIdleInterval);
            pomodoroIdleInterval = null;
        }
        idlePromptShown = false;
    });

    // Handle idle prompt continue action (reset idle check)
    ipcMain.on('intervention:idle-continue', () => {
        idlePromptShown = false;
    });
}
