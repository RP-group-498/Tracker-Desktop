/**
 * Cross-platform Native Messaging Host Installation Script
 *
 * Works on Windows and macOS. Run from anywhere — all paths are derived
 * from __dirname so they are always correct for the current machine.
 *
 * Usage:
 *   node install.js [EXTENSION_ID]
 *
 * Windows  → writes manifest JSON + native-host.bat, registers HKCU registry key
 * macOS    → writes manifest JSON to ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
 *
 * Registry location (Windows):
 *   HKCU\Software\Google\Chrome\NativeMessagingHosts\com.focusapp.monitor
 *
 * Manifest location (macOS):
 *   ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.focusapp.monitor.json
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST_NAME = 'com.focusapp.monitor';
const EXTENSION_ID = process.argv[2] || 'efbjcceabokihfhhhgfehbpleaaoaglm';

// All paths derived from __dirname — never hardcoded to a specific machine
const scriptDir = __dirname;
const hostScriptPath = path.join(scriptDir, 'native-host.js');
const batPath = path.join(scriptDir, 'native-host.bat');
const localManifestPath = path.join(scriptDir, `${HOST_NAME}.json`);

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

console.log('='.repeat(60));
console.log('Focus App — Native Messaging Host Installation');
console.log('='.repeat(60));
console.log(`Platform : ${process.platform}`);
console.log(`Host dir : ${scriptDir}`);
console.log(`Extension: ${EXTENSION_ID}`);

// ---------------------------------------------------------------------------
// Verify native-host.js exists before doing anything
// ---------------------------------------------------------------------------

if (!fs.existsSync(hostScriptPath)) {
    console.error(`\nERROR: native-host.js not found at:\n  ${hostScriptPath}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

if (isWindows) {
    console.log('\n[1/3] Creating .bat wrapper...');
    fs.writeFileSync(batPath, `@echo off\r\nnode "%~dp0native-host.js"\r\n`);
    console.log(`   Created: ${batPath}`);

    console.log('\n[2/3] Writing manifest JSON...');
    const manifest = {
        name: HOST_NAME,
        description: 'Focus App Native Messaging Host',
        path: batPath,          // Chrome spawns the .bat; bat calls node
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    };
    fs.writeFileSync(localManifestPath, JSON.stringify(manifest, null, 2));
    console.log(`   Created: ${localManifestPath}`);

    console.log('\n[3/3] Registering in Windows Registry (HKCU — no admin needed)...');
    const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    try {
        execSync(`reg add "${REG_KEY}" /ve /t REG_SZ /d "${localManifestPath}" /f`, { stdio: 'pipe' });
        console.log(`   Registered: ${REG_KEY}`);
    } catch (err) {
        console.error(`\nERROR: Failed to write registry key.\n${err.message}`);
        console.log('Try running this script as Administrator.');
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

else if (isMac) {
    console.log('\n[1/2] Writing manifest JSON to Chrome NativeMessagingHosts directory...');

    const chromeHostsDir = path.join(
        os.homedir(),
        'Library/Application Support/Google/Chrome/NativeMessagingHosts',
    );
    fs.mkdirSync(chromeHostsDir, { recursive: true });

    const macManifestPath = path.join(chromeHostsDir, `${HOST_NAME}.json`);
    const manifest = {
        name: HOST_NAME,
        description: 'Focus App Native Messaging Host',
        path: hostScriptPath,   // Chrome spawns native-host.js directly via shebang
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    };
    fs.writeFileSync(macManifestPath, JSON.stringify(manifest, null, 2));
    console.log(`   Created: ${macManifestPath}`);

    console.log('\n[2/2] Making native-host.js executable...');
    fs.chmodSync(hostScriptPath, 0o755);
    console.log(`   chmod 755: ${hostScriptPath}`);
}

// ---------------------------------------------------------------------------
// Unsupported platform
// ---------------------------------------------------------------------------

else {
    console.error(`\nERROR: Unsupported platform: ${process.platform}`);
    console.log('Supported platforms: win32, darwin');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('Installation complete!');
console.log('='.repeat(60));
console.log(`
Next steps:
  1. Start (or restart) the Focus App desktop application
  2. Reload your Chrome extension at chrome://extensions/

To uninstall:
  node uninstall.js
`);
