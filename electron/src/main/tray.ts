/**
 * System Tray Manager
 *
 * Manages the system tray icon and context menu.
 * Updates icon based on connection state.
 */

import { Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import path from 'path';
import { EventEmitter } from 'events';

interface AppState {
    pythonRunning: boolean;
    extensionConnected: boolean;
    currentSessionId: string | null;
    eventCount: number;
}

export class TrayManager extends EventEmitter {
    private tray: Tray | null = null;
    private _window: BrowserWindow;
    private state: AppState;
    private isPaused = false;

    constructor(window: BrowserWindow, initialState: AppState) {
        super();
        this._window = window;
        this.state = initialState;
        this.createTray();
    }

    /**
     * Create the system tray
     */
    private createTray(): void {
        const iconPath = this.getIconPath('disconnected');
        const icon = nativeImage.createFromPath(iconPath);

        this.tray = new Tray(icon);
        this.tray.setToolTip('Focus App - Initializing...');

        this.updateContextMenu();

        // Click to show window
        this.tray.on('click', () => {
            this.emit('show');
        });

        // Double-click to show window
        this.tray.on('double-click', () => {
            this.emit('show');
        });
    }

    /**
     * Get icon path based on state
     */
    private getIconPath(_state: 'connected' | 'disconnected' | 'error'): string {
        const assetsDir = path.join(__dirname, '../../assets');

        // For now, use same icon with different tooltip
        // TODO: Create actual tray icons
        return path.join(assetsDir, 'icon.ico');
    }

    /**
     * Update the context menu
     */
    private updateContextMenu(): void {
        const statusText = this.getStatusText();

        const contextMenu = Menu.buildFromTemplate([
            {
                label: statusText,
                enabled: false,
                icon: this.getStatusIcon(),
            },
            { type: 'separator' },
            {
                label: 'Open Dashboard',
                click: () => this.emit('show'),
            },
            { type: 'separator' },
            {
                label: this.isPaused ? 'Resume Tracking' : 'Pause Tracking',
                enabled: this.state.extensionConnected,
                click: () => {
                    this.isPaused = !this.isPaused;
                    this.emit(this.isPaused ? 'pauseTracking' : 'resumeTracking');
                    this.updateContextMenu();
                },
            },
            { type: 'separator' },
            {
                label: `Events: ${this.state.eventCount}`,
                enabled: false,
            },
            {
                label: this.state.currentSessionId
                    ? `Session: ${this.state.currentSessionId.substring(0, 8)}...`
                    : 'No active session',
                enabled: false,
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => this.emit('quit'),
            },
        ]);

        this.tray?.setContextMenu(contextMenu);
    }

    /**
     * Get status text for menu
     */
    private getStatusText(): string {
        if (!this.state.pythonRunning) {
            return 'Status: Backend Offline';
        }
        if (!this.state.extensionConnected) {
            return 'Status: Extension Disconnected';
        }
        if (this.isPaused) {
            return 'Status: Paused';
        }
        return 'Status: Tracking Active';
    }

    /**
     * Get status icon for menu (placeholder - returns undefined for now)
     */
    private getStatusIcon(): ReturnType<typeof nativeImage.createFromPath> | undefined {
        // TODO: Create small status indicator icons
        return undefined;
    }

    /**
     * Update state and refresh tray
     */
    updateState(newState: AppState): void {
        this.state = newState;

        // Update tooltip
        const tooltip = this.getStatusText().replace('Status: ', 'Focus App - ');
        this.tray?.setToolTip(tooltip);

        // Update context menu
        this.updateContextMenu();
    }

    /**
     * Destroy the tray
     */
    destroy(): void {
        if (this.tray) {
            this.tray.destroy();
            this.tray = null;
        }
    }
}
