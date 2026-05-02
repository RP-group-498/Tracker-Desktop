/**
 * Native Host Registrar
 *
 * Automatically registers the native messaging host with Chrome on every launch.
 * This replaces the manual `node install.js` step so packaged users never need
 * to touch a terminal.
 *
 * How Chrome finds the native host:
 *   Windows : Registry key HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>
 *             → points to the manifest JSON file path
 *   macOS   : File ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json
 *
 * The manifest JSON contains the absolute path to native-host.js (macOS) or
 * native-host.bat (Windows), which Chrome spawns directly via stdio.
 *
 * Running this on every launch is safe — writes are idempotent and the registry
 * add uses /f (force-overwrite), so paths stay correct after updates.
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

const HOST_NAME = 'com.focusapp.monitor';
const EXTENSION_ID = 'efbjcceabokihfhhhgfehbpleaaoaglm';

/**
 * Resolves the directory containing native-host.js.
 * - Packaged build  → <app>/Contents/Resources/native-host  (mac)
 *                     <app>/resources/native-host            (win)
 * - Development     → <repo root>/native-host
 */
function getNativeHostDir(): string {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'native-host');
    }
    // __dirname in compiled TS is: electron/dist/main
    // repo root is three levels up
    return path.join(__dirname, '../../../native-host');
}

/** Register with Chrome on Windows via HKCU registry (no admin required). */
async function registerWindows(manifestPath: string, nativeHostDir: string): Promise<void> {
    // Write the .bat wrapper next to native-host.js
    const batPath = path.join(nativeHostDir, 'native-host.bat');
    fs.writeFileSync(batPath, `@echo off\r\nnode "%~dp0native-host.js"\r\n`);

    const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    await new Promise<void>((resolve, reject) => {
        execFile(
            'reg',
            ['add', regKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
            (err) => (err ? reject(err) : resolve()),
        );
    });
}

/** Register with Chrome on macOS by writing the manifest to the known directory. */
async function registerMac(manifest: object): Promise<void> {
    const chromeHostsDir = path.join(
        process.env.HOME ?? app.getPath('home'),
        'Library/Application Support/Google/Chrome/NativeMessagingHosts',
    );
    fs.mkdirSync(chromeHostsDir, { recursive: true });

    const manifestPath = path.join(chromeHostsDir, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // native-host.js must be executable so Chrome can spawn it via the shebang
    const hostScriptPath = (manifest as { path: string }).path;
    if (fs.existsSync(hostScriptPath)) {
        fs.chmodSync(hostScriptPath, 0o755);
    }
}

/**
 * Register the native messaging host with Chrome.
 * Called once during app startup — safe to call on every launch.
 */
export async function registerNativeHost(): Promise<void> {
    try {
        const nativeHostDir = getNativeHostDir();

        if (!fs.existsSync(nativeHostDir)) {
            console.warn('[NativeHost] native-host directory not found at:', nativeHostDir);
            return;
        }

        const isWin = process.platform === 'win32';
        const hostScriptPath = isWin
            ? path.join(nativeHostDir, 'native-host.bat')  // bat written below
            : path.join(nativeHostDir, 'native-host.js');

        const manifest = {
            name: HOST_NAME,
            description: 'Focus App Native Messaging Host',
            path: hostScriptPath,
            type: 'stdio',
            allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
        };

        if (isWin) {
            const manifestPath = path.join(nativeHostDir, `${HOST_NAME}.json`);
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
            await registerWindows(manifestPath, nativeHostDir);
            console.log('[NativeHost] Registered with Chrome (Windows registry)');
        } else if (process.platform === 'darwin') {
            await registerMac(manifest);
            console.log('[NativeHost] Registered with Chrome (macOS)');
        } else {
            console.log('[NativeHost] Registration not implemented for this platform');
        }
    } catch (err) {
        // Non-fatal — the app still works without the extension
        console.error('[NativeHost] Registration failed (extension will not connect):', err);
    }
}
