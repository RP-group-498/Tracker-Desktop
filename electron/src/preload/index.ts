/**
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

    // Activity
    getRecentActivity: (limit?: number) => Promise<Activity[]>;
    getActivityStats: () => Promise<ActivityStats>;

    // Components
    getComponentStatus: (name: string) => Promise<ComponentStatus>;

    // Commands
    sendCommand: (command: 'pause' | 'resume' | 'clear_local') => Promise<{ success: boolean }>;
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

    // Activity
    getRecentActivity: (limit = 50) => ipcRenderer.invoke('get-recent-activity', limit),
    getActivityStats: () => ipcRenderer.invoke('get-activity-stats'),

    // Components
    getComponentStatus: (name) => ipcRenderer.invoke('get-component-status', name),

    // Commands
    sendCommand: (command) => ipcRenderer.invoke('send-command', command),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for renderer
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
