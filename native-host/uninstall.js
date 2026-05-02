/**
 * Cross-platform Native Messaging Host Uninstallation Script
 *
 * Windows : removes HKCU registry key, deletes manifest JSON and .bat wrapper
 * macOS   : removes manifest JSON from Chrome NativeMessagingHosts directory
 *
 * Usage:
 *   node uninstall.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST_NAME = 'com.focusapp.monitor';

const scriptDir = __dirname;
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

console.log('='.repeat(60));
console.log('Focus App — Native Messaging Host Uninstallation');
console.log('='.repeat(60));

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

if (isWindows) {
    const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;

    console.log('\n[1/2] Removing registry entry...');
    try {
        execSync(`reg delete "${REG_KEY}" /f`, { stdio: 'pipe' });
        console.log(`   Removed: ${REG_KEY}`);
    } catch (err) {
        if (err.message.includes('unable to find') || err.message.includes('The system was unable')) {
            console.log('   Registry key not found (already removed)');
        } else {
            console.warn(`   WARNING: ${err.message}`);
        }
    }

    console.log('\n[2/2] Removing generated files...');
    for (const file of [`${HOST_NAME}.json`, 'native-host.bat']) {
        const filePath = path.join(scriptDir, file);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`   Removed: ${filePath}`);
        } else {
            console.log(`   Not found (skipped): ${filePath}`);
        }
    }
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

else if (isMac) {
    const macManifestPath = path.join(
        os.homedir(),
        'Library/Application Support/Google/Chrome/NativeMessagingHosts',
        `${HOST_NAME}.json`,
    );

    console.log('\n[1/1] Removing manifest from Chrome NativeMessagingHosts...');
    if (fs.existsSync(macManifestPath)) {
        fs.unlinkSync(macManifestPath);
        console.log(`   Removed: ${macManifestPath}`);
    } else {
        console.log(`   Not found (already removed): ${macManifestPath}`);
    }
}

// ---------------------------------------------------------------------------
// Unsupported platform
// ---------------------------------------------------------------------------

else {
    console.error(`\nERROR: Unsupported platform: ${process.platform}`);
    process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('Uninstallation complete!');
console.log('='.repeat(60));
