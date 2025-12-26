/**
 * Windows Registry Installation Script for Native Messaging Host
 *
 * This script:
 * 1. Creates the host manifest JSON file
 * 2. Registers the host in the Windows Registry
 *
 * Registry location:
 * HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.focusapp.monitor
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOST_NAME = 'com.focusapp.monitor';
const MANIFEST_FILENAME = `${HOST_NAME}.json`;

// Paths
const scriptDir = __dirname;
const manifestPath = path.join(scriptDir, MANIFEST_FILENAME);
const hostScriptPath = path.join(scriptDir, 'native-host.js');

// Registry key
const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;

// Get the extension ID from command line or use placeholder
const extensionId = process.argv[2] || 'YOUR_EXTENSION_ID_HERE';

console.log('='.repeat(60));
console.log('Native Messaging Host Installation');
console.log('='.repeat(60));

// Step 1: Create the host manifest
console.log('\n[1/3] Creating host manifest...');

const manifest = {
    name: HOST_NAME,
    description: 'Focus App Native Messaging Host - Bridges browser extension to desktop app',
    // Use node.exe to run the script on Windows
    path: hostScriptPath.replace(/\\/g, '\\\\'), // Escape backslashes for JSON
    type: 'stdio',
    allowed_origins: [
        `chrome-extension://${extensionId}/`
    ]
};

// For Windows, we need to create a batch file or use node directly
// Creating a .bat wrapper is more reliable
const batPath = path.join(scriptDir, 'native-host.bat');
const batContent = `@echo off\r\nnode "%~dp0native-host.js"`;

fs.writeFileSync(batPath, batContent);
console.log(`   Created: ${batPath}`);

// Update manifest to point to .bat file
manifest.path = batPath;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`   Created: ${manifestPath}`);

// Step 2: Verify files exist
console.log('\n[2/3] Verifying files...');

if (!fs.existsSync(hostScriptPath)) {
    console.error(`   ERROR: native-host.js not found at ${hostScriptPath}`);
    process.exit(1);
}
console.log('   native-host.js: OK');
console.log('   native-host.bat: OK');
console.log('   manifest.json: OK');

// Step 3: Register in Windows Registry
console.log('\n[3/3] Registering in Windows Registry...');

try {
    // Create the registry key with the manifest path as the default value
    const regCommand = `reg add "${REG_KEY}" /ve /t REG_SZ /d "${manifestPath}" /f`;
    execSync(regCommand, { stdio: 'pipe' });
    console.log(`   Registered: ${REG_KEY}`);
} catch (error) {
    console.error(`   ERROR: Failed to create registry key`);
    console.error(`   ${error.message}`);
    console.log('\n   Try running this script as Administrator.');
    process.exit(1);
}

// Success!
console.log('\n' + '='.repeat(60));
console.log('Installation Complete!');
console.log('='.repeat(60));

console.log(`
Next steps:
1. Update the extension ID in the manifest if needed:
   File: ${manifestPath}
   Current: ${extensionId}

2. Reload your Chrome extension

3. Start the desktop application

To find your extension ID:
- Go to chrome://extensions/
- Enable "Developer mode"
- Look for the "ID" under your extension

To uninstall, run: node uninstall.js
`);
