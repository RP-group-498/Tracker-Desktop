/**
 * /main/intervention-popup.ts
 * Windows Intervention Popup Manager
 *
 * On Windows, Electron's Notification API doesn't support action buttons or
 * tray.setTitle(). This module provides custom BrowserWindow-based popups
 * as replacements:
 *   - Notification popup: frameless toast at bottom-right with Start/Skip/Not Now
 *   - Timer popup: tiny always-on-top widget showing Pomodoro countdown
 *
 * Both forward actions through the same IPC channel (notification-action-response)
 * so the renderer needs zero changes.
 */

import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';

export class InterventionPopup {
    private getMainWindow: () => BrowserWindow | null;
    private notificationWindow: BrowserWindow | null = null;
    private timerWindow: BrowserWindow | null = null;
    private timerReady = false;
    private pendingTimerLabel: string | null = null;
    private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
    private actionTaken = false;
    private currentStrategy = '';

    constructor(getMainWindow: () => BrowserWindow | null) {
        this.getMainWindow = getMainWindow;
        this.registerIpc();
    }

    /**
     * Show a notification popup with Start / Skip / Not Now buttons.
     */
    show(data: { title: string; body: string; strategy: string }): void {
        // Close any existing notification popup
        this.closeNotification();

        this.actionTaken = false;
        this.currentStrategy = data.strategy;

        const htmlPath = this.resolveHtmlPath();

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        this.notificationWindow = new BrowserWindow({
            width: 380,
            height: 190,
            x: width - 380 - 16,
            y: height - 190 - 16,
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            frame: false,
            transparent: false,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                nodeIntegration: false,
                contextIsolation: true,
            },
        });

        const query = new URLSearchParams({
            mode: 'notification',
            title: data.title,
            body: data.body,
            strategy: data.strategy,
        }).toString();

        this.notificationWindow.loadFile(htmlPath, { query: { mode: 'notification', title: data.title, body: data.body, strategy: data.strategy } });

        this.notificationWindow.once('ready-to-show', () => {
            this.notificationWindow?.showInactive();
        });

        this.notificationWindow.on('closed', () => {
            if (!this.actionTaken) {
                // Window closed without a button click — treat as not_now
                const mainWindow = this.getMainWindow();
                mainWindow?.webContents.send('notification-action-response', {
                    strategy: this.currentStrategy,
                    action: 'not_now',
                });
            }
            this.notificationWindow = null;
            if (this.autoDismissTimer) {
                clearTimeout(this.autoDismissTimer);
                this.autoDismissTimer = null;
            }
        });

        // Auto-dismiss after 15 seconds
        this.autoDismissTimer = setTimeout(() => {
            this.closeNotification();
        }, 15_000);
    }

    /**
     * Show or update the timer popup with a countdown label.
     * Uses ready-state buffering to prevent blinking on first show.
     */
    updateTimer(label: string): void {
        if (this.timerWindow && !this.timerWindow.isDestroyed()) {
            if (this.timerReady) {
                this.timerWindow.webContents.send('intervention-popup:timer-update', label);
            } else {
                this.pendingTimerLabel = label;
            }
            return;
        }

        this.timerReady = false;
        this.pendingTimerLabel = label;

        const htmlPath = this.resolveHtmlPath();
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        const win = new BrowserWindow({
            width: 160,
            height: 50,
            x: width - 160 - 16,
            y: height - 50 - 16,
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            frame: false,
            transparent: false,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                nodeIntegration: false,
                contextIsolation: true,
            },
        });

        this.timerWindow = win;

        win.loadFile(htmlPath, { query: { mode: 'timer', label } });

        win.once('ready-to-show', () => {
            win.showInactive();
            win.webContents.once('did-finish-load', () => {
                this.timerReady = true;
                if (this.pendingTimerLabel) {
                    win.webContents.send('intervention-popup:timer-update', this.pendingTimerLabel);
                    this.pendingTimerLabel = null;
                }
            });
        });

        win.on('closed', () => {
            // Only nullify if this is still the current timer window
            if (this.timerWindow === win) {
                this.timerWindow = null;
                this.timerReady = false;
            }
        });
    }

    /**
     * Close the timer popup.
     */
    clearTimer(): void {
        this.timerReady = false;
        this.pendingTimerLabel = null;
        if (this.timerWindow && !this.timerWindow.isDestroyed()) {
            this.timerWindow.close();
        }
        this.timerWindow = null;
    }

    /**
     * Show an "Are you there?" idle prompt popup (Windows only).
     */
    showIdlePrompt(): void {
        const htmlPath = this.resolveHtmlPath();
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        const win = new BrowserWindow({
            width: 300,
            height: 140,
            x: width - 300 - 16,
            y: height - 140 - 16,
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            frame: false,
            transparent: false,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                nodeIntegration: false,
                contextIsolation: true,
            },
        });

        win.loadFile(htmlPath, { query: { mode: 'idle_prompt' } });

        win.once('ready-to-show', () => {
            win.showInactive();
        });

        // Auto-dismiss after 15s — treat as stop
        const autoDismiss = setTimeout(() => {
            if (!win.isDestroyed()) {
                const mainWindow = this.getMainWindow();
                mainWindow?.webContents.send('intervention:pomodoro-idle', { action: 'stop' });
                win.close();
            }
        }, 15_000);

        win.on('closed', () => {
            clearTimeout(autoDismiss);
        });
    }

    /**
     * Register IPC handler for popup button clicks.
     */
    private registerIpc(): void {
        ipcMain.on('intervention-popup:action', (_event, data: { strategy: string; action: string }) => {
            if (data.strategy === 'idle_prompt') {
                // Route idle prompt responses to the pomodoro idle channel
                const mainWindow = this.getMainWindow();
                mainWindow?.webContents.send('intervention:pomodoro-idle', { action: data.action });
                if (data.action === 'continue') {
                    // Tell main process to reset idle check
                    ipcMain.emit('intervention:idle-continue');
                }
                return;
            }

            this.actionTaken = true;
            const mainWindow = this.getMainWindow();
            mainWindow?.webContents.send('notification-action-response', {
                strategy: data.strategy,
                action: data.action,
            });
            this.closeNotification();
        });
    }

    private closeNotification(): void {
        if (this.autoDismissTimer) {
            clearTimeout(this.autoDismissTimer);
            this.autoDismissTimer = null;
        }
        if (this.notificationWindow && !this.notificationWindow.isDestroyed()) {
            this.notificationWindow.close();
        }
    }

    private resolveHtmlPath(): string {
        const isDev = process.env.NODE_ENV === 'development';
        return isDev
            ? path.join(__dirname, '../../src/renderer/public/pages/intervention-notification.html')
            : path.join(__dirname, '../renderer/pages/intervention-notification.html');
    }
}
