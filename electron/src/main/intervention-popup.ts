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
     */
    updateTimer(label: string): void {
        if (this.timerWindow && !this.timerWindow.isDestroyed()) {
            this.timerWindow.webContents.send('intervention-popup:timer-update', label);
            return;
        }

        const htmlPath = this.resolveHtmlPath();
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        this.timerWindow = new BrowserWindow({
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

        this.timerWindow.loadFile(htmlPath, { query: { mode: 'timer', label } });

        this.timerWindow.once('ready-to-show', () => {
            this.timerWindow?.showInactive();
        });

        this.timerWindow.on('closed', () => {
            this.timerWindow = null;
        });
    }

    /**
     * Close the timer popup.
     */
    clearTimer(): void {
        if (this.timerWindow && !this.timerWindow.isDestroyed()) {
            this.timerWindow.close();
        }
        this.timerWindow = null;
    }

    /**
     * Register IPC handler for popup button clicks.
     */
    private registerIpc(): void {
        ipcMain.on('intervention-popup:action', (_event, data: { strategy: string; action: string }) => {
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
