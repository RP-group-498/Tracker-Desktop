/**
 * Windows Registry Uninstallation Script for Native Messaging Host
 *
 * This script removes the registry entry for the native messaging host.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOST_NAME = 'com.focusapp.monitor';
const MANIFEST_FILENAME = `${HOST_NAME}.json`;

// Paths
const scriptDir = __dirname;
const manifestPath = path.join(scriptDir, MANIFEST_FILENAME);
const batPath = path.join(scriptDir, 'native-host.bat');

// Registry key
const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;

console.log('='.repeat(60));
console.log('Native Messaging Host Uninstallation');
console.log('='.repeat(60));

// Step 1: Remove registry entry
console.log('\n[1/2] Removing registry entry...');

try {
    execSync(`reg delete "${REG_KEY}" /f`, { stdio: 'pipe' });
    console.log(`   Removed: ${REG_KEY}`);
} catch (error) {
    if (error.message.includes('unable to find')) {
        console.log('   Registry key not found (already removed)');
    } else {
        console.error(`   WARNING: ${error.message}`);
    }
}

// Step 2: Remove generated files
console.log('\n[2/2] Removing generated files...');

if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath);
    console.log(`   Removed: ${manifestPath}`);
} else {
    console.log(`   Manifest not found (already removed)`);
}

if (fs.existsSync(batPath)) {
    fs.unlinkSync(batPath);
    console.log(`   Removed: ${batPath}`);
} else {
    console.log(`   Batch file not found (already removed)`);
}

console.log('\n' + '='.repeat(60));
console.log('Uninstallation Complete!');
console.log('='.repeat(60));
