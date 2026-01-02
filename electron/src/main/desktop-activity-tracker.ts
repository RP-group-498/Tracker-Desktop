/**
 * Desktop Activity Tracker
 *
 * Tracks active window/application usage on the desktop.
 * Polls every 1 second using the active-win package.
 */

import { EventEmitter } from 'events';
import { PythonBridge } from './python-bridge';
import { randomUUID } from 'crypto';

// Dynamic import for active-win (CommonJS module)
let activeWin: typeof import('active-win');

const POLL_INTERVAL = 1000; // 1 second
const MIN_ACTIVITY_DURATION = 1000; // Minimum 1 second to record

// Browser apps to skip (browser extension handles these)
const BROWSER_APPS = new Set([
    'chrome',
    'google chrome',
    'firefox',
    'mozilla firefox',
    'edge',
    'msedge',
    'microsoft edge',
    'brave',
    'brave browser',
    'opera',
    'safari',
    'vivaldi',
    'arc',
    'chromium',
]);

/**
 * Check if an app is a browser (should be skipped when browser extension is active)
 */
function isBrowserApp(appName: string): boolean {
    const normalized = appName.toLowerCase().replace(/\.exe$/i, '').trim();
    return BROWSER_APPS.has(normalized);
}

interface ActiveWindowInfo {
    title: string;
    id: number;
    owner: {
        name: string;
        processId: number;
        path: string;
    };
}

// Load active-win module
async function loadActiveWin(): Promise<void> {
    console.log('[DesktopTracker] Loading active-win module...');
    try {
        const module = await import('active-win');
        console.log('[DesktopTracker] Module loaded:', Object.keys(module));
        activeWin = module.default || module;
        console.log('[DesktopTracker] active-win ready, type:', typeof activeWin);
    } catch (error) {
        console.error('[DesktopTracker] Failed to load active-win module:', error);
        throw error;
    }
}

interface DesktopActivityEvent {
    eventId: string;
    sessionId: string | null;
    source: 'desktop';
    activityType: 'application';
    timestamp: string;
    startTime: string;
    endTime: string;
    // Application info
    appName: string;
    appPath: string;
    windowTitle: string;
    domain: string; // For compatibility with browser events (use app name)
    url: string; // For compatibility (use app:// protocol)
    path: string;
    title: string;
    // Timing
    activeTime: number; // Milliseconds
    idleTime: number;
    tabId: number;
    windowId: number;
    isIncognito: boolean;
}

export class DesktopActivityTracker extends EventEmitter {
    private pythonBridge: PythonBridge;
    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning = false;

    // Current window tracking
    private currentWindow: ActiveWindowInfo | null = null;
    private windowStartTime: Date | null = null;
    private currentSessionId: string | null = null;

    // Statistics
    private totalEventsTracked = 0;

    constructor(pythonBridge: PythonBridge) {
        super();
        this.pythonBridge = pythonBridge;
    }

    /**
     * Start tracking desktop activity
     */
    async start(): Promise<void> {
        console.log('[DesktopTracker] start() called');

        if (this.isRunning) {
            console.log('[DesktopTracker] Already running');
            return;
        }

        console.log('[DesktopTracker] Starting desktop activity tracking...');

        try {
            // Load active-win module
            await loadActiveWin();

            // Get initial active window
            const initialWindow = await activeWin();
            if (initialWindow) {
                // Skip if initial window is a browser
                if (isBrowserApp(initialWindow.owner.name)) {
                    console.log(`[DesktopTracker] Initial window is browser (${initialWindow.owner.name}) - skipping (handled by extension)`);
                } else {
                    this.currentWindow = {
                        title: initialWindow.title,
                        id: initialWindow.id,
                        owner: {
                            name: initialWindow.owner.name,
                            processId: initialWindow.owner.processId,
                            path: initialWindow.owner.path,
                        },
                    };
                    this.windowStartTime = new Date();
                    console.log(`[DesktopTracker] Initial window: ${this.currentWindow.owner.name} - ${this.currentWindow.title}`);
                }
            }

            // Start polling
            this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL);
            this.isRunning = true;
            this.emit('started');
            console.log('[DesktopTracker] Desktop activity tracking started');
        } catch (error) {
            console.error('[DesktopTracker] Failed to start:', error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Stop tracking desktop activity
     */
    async stop(): Promise<void> {
        console.log('[DesktopTracker] Stopping desktop activity tracking...');

        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        // Flush current window activity before stopping
        if (this.currentWindow && this.windowStartTime) {
            await this.flushCurrentWindow();
        }

        this.isRunning = false;
        this.emit('stopped');
        console.log('[DesktopTracker] Desktop activity tracking stopped');
    }

    /**
     * Set the current session ID
     */
    setSessionId(sessionId: string | null): void {
        this.currentSessionId = sessionId;
    }

    /**
     * Poll for active window changes
     */
    private async poll(): Promise<void> {
        try {
            const window = await activeWin();

            if (!window) {
                // No active window (screen locked, etc.)
                if (this.currentWindow) {
                    await this.flushCurrentWindow();
                    this.currentWindow = null;
                    this.windowStartTime = null;
                }
                return;
            }

            // Skip browser apps - browser extension handles these
            // This prevents duplicate data when both desktop tracker and browser extension are active
            if (isBrowserApp(window.owner.name)) {
                // Flush any previous non-browser window before switching to browser
                if (this.currentWindow && this.windowStartTime) {
                    await this.flushCurrentWindow();
                    this.currentWindow = null;
                    this.windowStartTime = null;
                    console.log(`[DesktopTracker] Switched to browser (${window.owner.name}) - skipping (handled by extension)`);
                }
                return;
            }

            const newWindow: ActiveWindowInfo = {
                title: window.title,
                id: window.id,
                owner: {
                    name: window.owner.name,
                    processId: window.owner.processId,
                    path: window.owner.path,
                },
            };

            // Check if window changed (different app or window ID)
            const windowChanged = !this.currentWindow ||
                this.currentWindow.id !== newWindow.id ||
                this.currentWindow.owner.processId !== newWindow.owner.processId;

            if (windowChanged) {
                // Flush previous window activity
                if (this.currentWindow && this.windowStartTime) {
                    await this.flushCurrentWindow();
                }

                // Start tracking new window
                this.currentWindow = newWindow;
                this.windowStartTime = new Date();
                console.log(`[DesktopTracker] Window changed: ${newWindow.owner.name} - ${newWindow.title}`);
            } else {
                // Update title if it changed within same window
                if (this.currentWindow && this.currentWindow.title !== newWindow.title) {
                    this.currentWindow.title = newWindow.title;
                }
            }
        } catch (error) {
            console.error('[DesktopTracker] Poll error:', error);
            this.emit('error', error);
        }
    }

    /**
     * Flush current window activity to backend
     */
    private async flushCurrentWindow(): Promise<void> {
        if (!this.currentWindow || !this.windowStartTime) {
            return;
        }

        const endTime = new Date();
        const duration = endTime.getTime() - this.windowStartTime.getTime();

        // Only record if duration meets minimum threshold
        if (duration < MIN_ACTIVITY_DURATION) {
            return;
        }

        const event = this.createActivityEvent(
            this.currentWindow,
            this.windowStartTime,
            endTime,
            duration
        );

        await this.sendActivity(event);
    }

    /**
     * Create a desktop activity event
     */
    private createActivityEvent(
        window: ActiveWindowInfo,
        startTime: Date,
        endTime: Date,
        duration: number
    ): DesktopActivityEvent {
        const appName = window.owner.name;
        const appPath = window.owner.path;

        return {
            eventId: randomUUID(),
            sessionId: this.currentSessionId,
            source: 'desktop',
            activityType: 'application',
            timestamp: new Date().toISOString(),
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            // Application info
            appName: appName,
            appPath: appPath,
            windowTitle: window.title,
            // Compatibility fields (map to browser event schema)
            domain: appName.toLowerCase().replace(/\.exe$/i, ''),
            url: `app://${appName.toLowerCase().replace(/\.exe$/i, '')}/${window.id}`,
            path: '',
            title: window.title,
            // Timing
            activeTime: duration,
            idleTime: 0,
            tabId: 0,
            windowId: window.id,
            isIncognito: false,
        };
    }

    /**
     * Send activity event to Python backend
     */
    private async sendActivity(event: DesktopActivityEvent): Promise<void> {
        try {
            const response = await this.pythonBridge.submitActivityBatch([event]);

            if (response.success) {
                this.totalEventsTracked++;
                this.emit('activityRecorded', event);
                console.log(`[DesktopTracker] Recorded: ${event.appName} (${event.activeTime}ms)`);
            } else {
                console.error('[DesktopTracker] Failed to send activity:', response.error);
                this.emit('error', new Error(response.error));
            }
        } catch (error) {
            console.error('[DesktopTracker] Error sending activity:', error);
            this.emit('error', error);
        }
    }

    /**
     * Get tracker status
     */
    getStatus(): { running: boolean; eventsTracked: number; currentApp: string | null } {
        return {
            running: this.isRunning,
            eventsTracked: this.totalEventsTracked,
            currentApp: this.currentWindow?.owner.name || null,
        };
    }

    /**
     * Check if tracker is running
     */
    getIsRunning(): boolean {
        return this.isRunning;
    }
}
