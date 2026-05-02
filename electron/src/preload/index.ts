/**
 * /electron/src/preload/index.ts
 * Preload Script
 *
 * Exposes a secure API to the renderer process via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the exposed API
interface ElectronAPI {
    // State
    getState: () => Promise<AppState>;
    onStateChange: (callback: (state: AppState) => void) => void;

    // Backend
    getBackendStatus: () => Promise<BackendStatus>;
    restartBackend: () => Promise<{ success: boolean; error?: string }>;

    // Connection
    getConnectionStatus: () => Promise<ConnectionStatus>;

    // Session
    getCurrentSession: () => Promise<Session | null>;

    // Auth
    getAuthToken: () => Promise<{ token: string; user: any } | null>;
    onAuthSuccess: (callback: (authData: any) => void) => void;
    startOAuthLogin: () => Promise<void>;
    clearAuth: () => Promise<void>;

    // Activity
    getRecentActivity: (limit?: number) => Promise<Activity[]>;
    getCurrentActivitySession: () => Promise<Activity | null>;
    getEventStream: (minutes?: number) => Promise<Activity[]>;
    getActivityStats: () => Promise<ActivityStats>;

    // Components
    getComponentStatus: (name: string) => Promise<ComponentStatus>;

    // Commands
    sendCommand: (command: 'pause' | 'resume' | 'clear_local') => Promise<{ success: boolean }>;

    // Task Prioritizer
    openTaskPrioritizer: () => Promise<void>;
    openActiveTasksWindow: () => Promise<void>;
    onActiveTasksPoppedOut: (callback: (isPoppedOut: boolean) => void) => void;
    resizeActiveTasksWindow: (height: number) => void;

    // PDF / Task Analysis
    analyzePdf: (data: {
        pdfPath?: string;
        textContent?: string;
        deadline: string;
        credits: number;
        weight: number;
    }) => Promise<{ tasks: unknown[] }>;

    // Procrastination
    getProcrastinationReport: () => Promise<unknown>;
    getProcrastinationHistory: (days?: number) => Promise<unknown>;
    saveProcrastinationCalibration: (data: unknown) => Promise<unknown>;
    getProcrastinationCalibration: () => Promise<unknown>;
    addTask: (data: unknown) => Promise<unknown>;
    getTasks: () => Promise<unknown>;
    deleteTask: (taskId: number) => Promise<unknown>;
    getCalibrationHistory: (days?: number) => Promise<unknown>;

    // Procrastination — enhanced analysis
    getAnomalies: (days?: number) => Promise<unknown>;
    getBehaviorTrends: (days?: number) => Promise<unknown>;
    getTimeGapStats: () => Promise<unknown>;
    getDeadlines: () => Promise<unknown>;
    getModelStatus: () => Promise<unknown>;

    // Idle Activity Prompt
    submitIdleActivity: (data: {
        activityId: string | null;
        customLabel: string | null;
        idleDurationMs: number;
        idleStart: string;
        idleEnd: string;
    }) => Promise<unknown>;
    dismissIdlePrompt: () => Promise<unknown>;

    // Intervention popup (Windows custom popup windows)
    interventionPopupAction: (data: { strategy: string; action: string }) => void;
    onInterventionTimerUpdate: (callback: (label: string) => void) => void;
    onInterventionTimerClear: (callback: () => void) => void;

    // Intervention
    intervention: InterventionAPI;
}

interface SlidingWindow {
    app_switches_5min: number;
    non_academic_switches_10min: number;
    total_events_10min: number;
    seconds_since_last_academic: number | null;
    window_has_data: boolean;
}

interface ContextSignals {
    total_transitions: number;
    non_academic_transitions: number;
    completed_tasks_last_7_days: number;
    assigned_tasks_last_7_days: number;
    task_priority: number;
    grade_weight_normalized: number;
    time_spent_on_task: number;
    assigned_time: number;
    task_deadline_time: string | null;
    has_data: boolean;
    sliding_window?: SlidingWindow;
}

interface InterventionAPI {
    banditSelect: (req: { user_id: string; x: number[]; alpha?: number }) => Promise<{ action: string; allowed_actions: string[] }>;
    banditUpdate: (req: { user_id: string; x: number[]; action: string; reward: number; button: string; alpha?: number }) => Promise<{ status: string; n_updates: number }>;
    getEvents: () => Promise<unknown[]>;
    logMotivation: (entry: { user_id: string; motivation: number; scenario: string; context_vector?: number[] }) => Promise<void>;
    getMotivationHistory: (since?: number) => Promise<unknown[]>;
    getUserGoal: () => Promise<{ life_goal: string }>;
    saveUserGoal: (goal: string) => Promise<{ status: string }>;
    generateReframeText: (goal: string) => Promise<{ text: string }>;
    getContext: () => Promise<ContextSignals>;
    notifyActions: (data: { title: string; body: string; strategy: string }) => void;
    onNotificationResponse: (callback: (data: { strategy: string; action: string }) => void) => () => void;
    updateTrayTimer: (label: string) => void;
    clearTray: () => void;
    notify: (data: { title: string; body: string }) => void;
    showWindow: () => void;
    pomodoroStarted: () => void;
    pomodoroStopped: () => void;
    onPomodoroIdleResponse: (callback: (data: { action: string }) => void) => () => void;
}

// Additional API for intervention popup windows (used by intervention-notification.html)
interface ElectronPopupAPI {
    interventionPopupAction: (data: { strategy: string; action: string }) => void;
    onInterventionTimerUpdate: (callback: (label: string) => void) => void;
    onInterventionTimerClear: (callback: () => void) => void;
}

interface AppState {
    pythonRunning: boolean;
    extensionConnected: boolean;
    currentSessionId: string | null;
    eventCount: number;
}

interface BackendStatus {
    running: boolean;
    app?: string;
    version?: string;
    components?: Record<string, { version: string; initialized: boolean }>;
    error?: string;
}

interface ConnectionStatus {
    pythonRunning: boolean;
    extensionConnected: boolean;
    currentSession: { sessionId: string; userId?: string } | null;
}

interface Session {
    session_id: string;
    user_id?: string;
    start_time: string;
    end_time?: string;
    status: string;
    activity_count: number;
}

interface Activity {
    event_id: string;
    domain: string;
    title: string;
    active_time: number;
    timestamp: string;
    classification?: {
        category: string;
        confidence: number;
        source: string;
    };
}

interface ActivityStats {
    total_events: number;
    total_active_time: number;
    total_idle_time: number;
    by_category: Record<string, { count: number; time: number }>;
}

interface ComponentStatus {
    name: string;
    version: string;
    initialized: boolean;
    type: string;
    stats?: Record<string, unknown>;
}

// Expose the API
const electronAPI: ElectronAPI = {
    // State
    getState: () => ipcRenderer.invoke('get-state'),
    onStateChange: (callback) => {
        ipcRenderer.on('state-change', (_event, state) => callback(state));
    },

    // Backend
    getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
    restartBackend: () => ipcRenderer.invoke('restart-backend'),

    // Connection
    getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),

    // Session
    getCurrentSession: () => ipcRenderer.invoke('get-current-session'),

    // Auth
    getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
    onAuthSuccess: (callback) => {
        ipcRenderer.on('auth-success', (_event, authData) => callback(authData));
    },
    startOAuthLogin: () => ipcRenderer.invoke('start-oauth-login'),
    clearAuth: () => ipcRenderer.invoke('clear-auth'),

    // Activity
    getRecentActivity: (limit = 50) => ipcRenderer.invoke('get-recent-activity', limit),
    getCurrentActivitySession: () => ipcRenderer.invoke('get-current-activity-session'),
    getEventStream: (minutes = 30) => ipcRenderer.invoke('get-event-stream', minutes),
    getActivityStats: () => ipcRenderer.invoke('get-activity-stats'),

    // Components
    getComponentStatus: (name) => ipcRenderer.invoke('get-component-status', name),

    // Commands
    sendCommand: (command) => ipcRenderer.invoke('send-command', command),

    // Task Prioritizer
    openTaskPrioritizer: () => ipcRenderer.invoke('open-task-prioritizer'),
    openActiveTasksWindow: () => ipcRenderer.invoke('open-active-tasks-window'),
    onActiveTasksPoppedOut: (callback) => {
        ipcRenderer.on('active-tasks-popped-out', (_event, isPoppedOut) => callback(isPoppedOut));
    },
    resizeActiveTasksWindow: (height) => ipcRenderer.send('resize-active-tasks-window', height),

    // PDF / Task Analysis
    analyzePdf: (data) => ipcRenderer.invoke('analyze-pdf', data),

    // Procrastination
    getProcrastinationReport: () => ipcRenderer.invoke('procrastination:get-report'),
    getProcrastinationHistory: (days = 7) => ipcRenderer.invoke('procrastination:get-history', days),
    saveProcrastinationCalibration: (data) => ipcRenderer.invoke('procrastination:save-calibration', data),
    getProcrastinationCalibration: () => ipcRenderer.invoke('procrastination:get-calibration'),
    addTask: (data) => ipcRenderer.invoke('procrastination:add-task', data),
    getTasks: () => ipcRenderer.invoke('procrastination:get-tasks'),
    deleteTask: (taskId) => ipcRenderer.invoke('procrastination:delete-task', taskId),

    getCalibrationHistory: (days = 14) => ipcRenderer.invoke('calibration:get-history', days),

    // Procrastination — enhanced analysis
    getAnomalies: (days = 30) => ipcRenderer.invoke('procrastination:get-anomalies', days),
    getBehaviorTrends: (days = 14) => ipcRenderer.invoke('procrastination:get-behavior-trends', days),
    getTimeGapStats: () => ipcRenderer.invoke('procrastination:get-time-gap'),
    getDeadlines: () => ipcRenderer.invoke('procrastination:get-deadlines'),
    getModelStatus: () => ipcRenderer.invoke('procrastination:get-model-status'),

    // Idle Activity Prompt
    submitIdleActivity: (data) => ipcRenderer.invoke('submit-idle-activity', data),
    dismissIdlePrompt: () => ipcRenderer.invoke('dismiss-idle-prompt'),

    // Intervention popup (Windows custom popup windows)
    interventionPopupAction: (data) => ipcRenderer.send('intervention-popup:action', data),
    onInterventionTimerUpdate: (callback) => {
        ipcRenderer.on('intervention-popup:timer-update', (_event, label) => callback(label));
    },
    onInterventionTimerClear: (callback) => {
        ipcRenderer.on('intervention-popup:timer-clear', () => callback());
    },

    // Intervention
    intervention: {
        banditSelect: (req) => ipcRenderer.invoke('intervention:bandit-select', req),
        banditUpdate: (req) => ipcRenderer.invoke('intervention:bandit-update', req),
        getEvents: () => ipcRenderer.invoke('intervention:get-events'),
        logMotivation: (entry) => ipcRenderer.invoke('intervention:log-motivation', entry),
        getMotivationHistory: (since) => ipcRenderer.invoke('intervention:get-motivation-history', since),
        getUserGoal: () => ipcRenderer.invoke('intervention:get-user-goal'),
        saveUserGoal: (goal) => ipcRenderer.invoke('intervention:save-user-goal', goal),
        generateReframeText: (goal) => ipcRenderer.invoke('intervention:generate-reframe-text', goal),
        getContext: () => ipcRenderer.invoke('intervention:get-context'),
        notifyActions: (data) => ipcRenderer.send('intervention:notify-actions', data),
        onNotificationResponse: (callback) => {
            const listener = (_event: Electron.IpcRendererEvent, data: { strategy: string; action: string }) => callback(data);
            ipcRenderer.on('notification-action-response', listener);
            return () => ipcRenderer.removeListener('notification-action-response', listener);
        },
        updateTrayTimer: (label) => ipcRenderer.send('intervention:tray-update', { label }),
        clearTray: () => ipcRenderer.send('intervention:tray-clear'),
        notify: (data) => ipcRenderer.send('intervention:notify', data),
        showWindow: () => ipcRenderer.send('intervention:window-show'),
        pomodoroStarted: () => ipcRenderer.send('intervention:pomodoro-started'),
        pomodoroStopped: () => ipcRenderer.send('intervention:pomodoro-stopped'),
        onPomodoroIdleResponse: (callback) => {
            const listener = (_event: Electron.IpcRendererEvent, data: { action: string }) => callback(data);
            ipcRenderer.on('intervention:pomodoro-idle', listener);
            return () => ipcRenderer.removeListener('intervention:pomodoro-idle', listener);
        },
    },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for renderer
declare global {
    interface Window {
        electronAPI: ElectronAPI & { intervention: InterventionAPI } & ElectronPopupAPI;
    }
}
