/**
 * Electron Main Process
 *
 * Entry point for the desktop application.
 * Handles app lifecycle, window management, and coordinates all services.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { PythonBridge } from './python-bridge';
import { NativeMessagingServer } from './native-messaging';
import { TrayManager } from './tray';
import { setupIpcHandlers } from './ipc-handlers';

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

// Global references
let mainWindow: BrowserWindow | null = null;
let pythonBridge: PythonBridge | null = null;
let nativeMessagingServer: NativeMessagingServer | null = null;
let trayManager: TrayManager | null = null;

// App state
interface AppState {
    pythonRunning: boolean;
    extensionConnected: boolean;
    currentSessionId: string | null;
    eventCount: number;
}

const appState: AppState = {
    pythonRunning: false,
    extensionConnected: false,
    currentSessionId: null,
    eventCount: 0,
};

/**
 * Create the main browser window
 */
function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 500,
        minWidth: 350,
        minHeight: 400,
        show: process.env.NODE_ENV === 'development', // Show in dev, hidden in production (tray)
        frame: true,
        resizable: true,
        skipTaskbar: false,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        icon: path.join(__dirname, '../../assets/icon.ico'),
    });

    // Load the renderer
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    // Hide instead of close
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * Initialize all services
 */
async function initializeServices(): Promise<void> {
    console.log('[Main] Initializing services...');

    // 1. Start Python backend (pythonBridge already created in app.on('ready'))
    pythonBridge!.on('started', () => {
        appState.pythonRunning = true;
        updateTrayAndWindow();
        console.log('[Main] Python backend started');
    });
    pythonBridge!.on('stopped', () => {
        appState.pythonRunning = false;
        updateTrayAndWindow();
        console.log('[Main] Python backend stopped');
    });
    pythonBridge!.on('error', (error) => {
        console.error('[Main] Python backend error:', error);
    });

    await pythonBridge!.start();

    // 2. Start Native Messaging server (nativeMessagingServer already created in app.on('ready'))
    nativeMessagingServer!.on('extensionConnected', () => {
        appState.extensionConnected = true;
        updateTrayAndWindow();
        console.log('[Main] Browser extension connected');
    });
    nativeMessagingServer!.on('extensionDisconnected', () => {
        appState.extensionConnected = false;
        updateTrayAndWindow();
        console.log('[Main] Browser extension disconnected');
    });
    nativeMessagingServer!.on('sessionCreated', (sessionId: string) => {
        appState.currentSessionId = sessionId;
        updateTrayAndWindow();
    });
    nativeMessagingServer!.on('eventsReceived', (count: number) => {
        appState.eventCount += count;
        updateTrayAndWindow();
    });

    await nativeMessagingServer!.start();

    // 3. Initialize system tray
    trayManager = new TrayManager(mainWindow!, appState);
    trayManager.on('show', () => mainWindow?.show());
    trayManager.on('quit', () => {
        app.isQuitting = true;
        app.quit();
    });
    trayManager.on('pauseTracking', () => {
        nativeMessagingServer?.sendCommand('pause');
    });
    trayManager.on('resumeTracking', () => {
        nativeMessagingServer?.sendCommand('resume');
    });

    console.log('[Main] All services initialized');
}

/**
 * Update tray icon and send state to renderer
 */
function updateTrayAndWindow(): void {
    trayManager?.updateState(appState);
    mainWindow?.webContents.send('state-change', appState);
}

/**
 * Cleanup on quit
 */
async function cleanup(): Promise<void> {
    console.log('[Main] Cleaning up...');

    if (nativeMessagingServer) {
        await nativeMessagingServer.stop();
    }

    if (pythonBridge) {
        await pythonBridge.stop();
    }

    trayManager?.destroy();
}

// App lifecycle events
app.on('ready', async () => {
    // Initialize services first (creates pythonBridge and nativeMessagingServer)
    // but don't wait for them to fully start yet
    pythonBridge = new PythonBridge();
    nativeMessagingServer = new NativeMessagingServer(pythonBridge);

    // Set up IPC handlers BEFORE creating window so they're ready when renderer loads
    setupIpcHandlers(ipcMain, () => appState, pythonBridge, nativeMessagingServer);

    // Now create window
    createWindow();

    // Start services in background
    await initializeServices();
});

app.on('second-instance', () => {
    // Focus the window if user tries to open another instance
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    // Don't quit on macOS unless explicitly quitting
    if (process.platform !== 'darwin') {
        // Keep running in tray
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    } else {
        mainWindow.show();
    }
});

app.on('before-quit', async () => {
    app.isQuitting = true;
    await cleanup();
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Main] Unhandled rejection:', reason);
});

// Extend app type for isQuitting flag
declare module 'electron' {
    interface App {
        isQuitting?: boolean;
    }
}
