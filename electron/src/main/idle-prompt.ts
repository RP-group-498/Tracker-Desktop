/**
 * Idle Activity Prompt
 *
 * Shows a popup window when the user returns from being idle,
 * allowing them to label what they were doing offline.
 */

import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { EventEmitter } from 'events';
import { PythonBridge } from './python-bridge';
import { DesktopActivityTracker } from './desktop-activity-tracker';

// Only show prompt if user was idle for at least 2 minutes
const MIN_IDLE_DURATION_MS = 2 * 60 * 1000;

export class IdleActivityPrompt extends EventEmitter {
    private pythonBridge: PythonBridge;
    private tracker: DesktopActivityTracker;
    private promptWindow: BrowserWindow | null = null;
    private idleStartTime: Date | null = null;
    private isPromptOpen = false;

    constructor(pythonBridge: PythonBridge, tracker: DesktopActivityTracker) {
        super();
        this.pythonBridge = pythonBridge;
        this.tracker = tracker;
    }

    /**
     * Start listening for idle state changes
     */
    start(): void {
        this.tracker.on('idleStateChanged', (isIdle: boolean) => {
            if (isIdle) {
                // User became idle — record the start time
                this.idleStartTime = new Date();
                console.log('[IdlePrompt] User became idle');
            } else {
                // User returned from idle
                this.onUserReturned();
            }
        });

        this.registerIpcHandlers();
        console.log('[IdlePrompt] Listening for idle state changes');
    }

    /**
     * Handle user returning from idle
     */
    private onUserReturned(): void {
        if (!this.idleStartTime) return;

        const idleEnd = new Date();
        const idleDurationMs = idleEnd.getTime() - this.idleStartTime.getTime();

        console.log(`[IdlePrompt] User returned after ${Math.round(idleDurationMs / 1000)}s idle`);

        if (idleDurationMs < MIN_IDLE_DURATION_MS) {
            console.log('[IdlePrompt] Idle duration below threshold, skipping prompt');
            this.idleStartTime = null;
            return;
        }

        if (this.isPromptOpen) {
            console.log('[IdlePrompt] Prompt already open, skipping');
            this.idleStartTime = null;
            return;
        }

        this.showPrompt(idleDurationMs, this.idleStartTime, idleEnd);
        this.idleStartTime = null;
    }

    /**
     * Show the idle activity prompt window
     */
    private showPrompt(idleDurationMs: number, idleStart: Date, idleEnd: Date): void {
        const isDev = process.env.NODE_ENV === 'development';
        const htmlPath = isDev
            ? path.join(__dirname, '../../src/renderer/public/pages/idle-prompt.html')
            : path.join(__dirname, '../renderer/pages/idle-prompt.html');

        // Build query string with idle info
        const query = new URLSearchParams({
            idleDurationMs: String(idleDurationMs),
            idleStart: idleStart.toISOString(),
            idleEnd: idleEnd.toISOString(),
        }).toString();

        this.promptWindow = new BrowserWindow({
            width: 420,
            height: 520,
            resizable: false,
            minimizable: false,
            maximizable: false,
            alwaysOnTop: true,
            skipTaskbar: false,
            frame: true,
            title: 'Idle Activity',
            webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                nodeIntegration: false,
                contextIsolation: true,
            },
        });

        this.promptWindow.loadFile(htmlPath, { query: { idleDurationMs: String(idleDurationMs), idleStart: idleStart.toISOString(), idleEnd: idleEnd.toISOString() } });

        this.isPromptOpen = true;

        this.promptWindow.on('closed', () => {
            this.promptWindow = null;
            this.isPromptOpen = false;
        });

        console.log(`[IdlePrompt] Showing prompt (idle for ${Math.round(idleDurationMs / 1000)}s)`);
    }

    /**
     * Register IPC handlers for the prompt window
     */
    private registerIpcHandlers(): void {
        ipcMain.handle('submit-idle-activity', async (_event, data: {
            activityId: string | null;
            customLabel: string | null;
            idleDurationMs: number;
            idleStart: string;
            idleEnd: string;
        }) => {
            console.log('[IdlePrompt] Received idle activity submission:', data);

            try {
                const payload = {
                    activity_id: data.activityId,
                    custom_label: data.customLabel,
                    idle_duration_ms: data.idleDurationMs,
                    idle_start: data.idleStart,
                    idle_end: data.idleEnd,
                };

                const result = await this.pythonBridge.request('POST', '/activity/idle', payload);

                if (result.success) {
                    console.log('[IdlePrompt] Idle activity saved successfully');
                    this.emit('activitySubmitted', data);
                    // Signal main process to end old session and start a new one
                    this.emit('sessionRotate');
                } else {
                    console.error('[IdlePrompt] Failed to save idle activity:', result.error);
                }

                return result;
            } catch (error) {
                console.error('[IdlePrompt] Error submitting idle activity:', error);
                return { success: false, error: String(error) };
            }
        });

        ipcMain.handle('dismiss-idle-prompt', () => {
            console.log('[IdlePrompt] Prompt dismissed');
            if (this.promptWindow) {
                this.promptWindow.close();
            }
            return { success: true };
        });
    }

    /**
     * Close the prompt window if open
     */
    close(): void {
        if (this.promptWindow) {
            this.promptWindow.close();
            this.promptWindow = null;
        }
    }
}
