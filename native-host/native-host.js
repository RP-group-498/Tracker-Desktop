/**
 * Native Messaging Host for Focus App
 *
 * This script handles communication between the Chrome extension and the desktop app.
 * It uses Chrome's Native Messaging protocol (length-prefixed JSON over stdio).
 *
 * Message Flow:
 * Browser Extension <-> Native Host (this script) <-> Electron App (via HTTP)
 *
 * Protocol:
 * - Messages are length-prefixed: 4-byte little-endian uint32 + JSON payload
 * - Input: stdin (from Chrome)
 * - Output: stdout (to Chrome)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const ELECTRON_HOST = '127.0.0.1';
const ELECTRON_PORT = 8765; // Electron's native messaging HTTP server
const LOG_FILE = path.join(__dirname, 'native-host.log');

// Logging
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, logMessage);
}

log('Native host started');

/**
 * Send a message to Chrome extension via stdout.
 * Format: 4-byte length (little-endian) + JSON string
 */
function sendMessage(message) {
    const json = JSON.stringify(message);
    const buffer = Buffer.alloc(4 + json.length);

    // Write length as 32-bit little-endian
    buffer.writeUInt32LE(json.length, 0);
    // Write JSON string
    buffer.write(json, 4);

    process.stdout.write(buffer);
    log(`Sent to extension: ${json.substring(0, 200)}...`);
}

/**
 * Forward a message to the Electron app via HTTP.
 */
function forwardToElectron(message) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(message);

        const options = {
            hostname: ELECTRON_HOST,
            port: ELECTRON_PORT,
            path: '/native-message',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 5000,
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response);
                } catch (e) {
                    resolve({ error: 'Invalid JSON response' });
                }
            });
        });

        req.on('error', (e) => {
            log(`Error forwarding to Electron: ${e.message}`);
            reject(e);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Handle incoming message from Chrome extension.
 */
async function handleMessage(message) {
    log(`Received from extension: ${JSON.stringify(message).substring(0, 200)}...`);

    try {
        // Forward to Electron app
        const response = await forwardToElectron(message);
        sendMessage(response);
    } catch (error) {
        log(`Error handling message: ${error.message}`);

        // Send error response based on message type
        if (message.type === 'connect') {
            sendMessage({
                type: 'error',
                error: 'Desktop app not running. Please start the Focus App.',
            });
        } else if (message.type === 'activity_batch') {
            // Don't send error for batches - extension will retry
            sendMessage({
                type: 'error',
                error: 'Failed to process activity batch',
            });
        } else if (message.type === 'heartbeat') {
            sendMessage({
                type: 'error',
                error: 'Desktop app not responding',
            });
        } else {
            sendMessage({
                type: 'error',
                error: error.message,
            });
        }
    }
}

// Read messages from stdin
let inputBuffer = Buffer.alloc(0);

process.stdin.on('readable', () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
        inputBuffer = Buffer.concat([inputBuffer, chunk]);

        // Try to parse complete messages
        while (inputBuffer.length >= 4) {
            // Read message length (4-byte little-endian)
            const messageLength = inputBuffer.readUInt32LE(0);

            // Check if we have the complete message
            if (inputBuffer.length < 4 + messageLength) {
                break; // Wait for more data
            }

            // Extract message
            const messageJson = inputBuffer.slice(4, 4 + messageLength).toString('utf8');

            // Remove processed bytes from buffer
            inputBuffer = inputBuffer.slice(4 + messageLength);

            // Parse and handle message
            try {
                const message = JSON.parse(messageJson);
                handleMessage(message);
            } catch (e) {
                log(`Failed to parse message: ${e.message}`);
                sendMessage({
                    type: 'error',
                    error: 'Invalid JSON message',
                });
            }
        }
    }
});

process.stdin.on('end', () => {
    log('stdin closed, exiting');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    log(`Uncaught exception: ${error.message}`);
    process.exit(1);
});

process.on('SIGTERM', () => {
    log('Received SIGTERM, exiting');
    process.exit(0);
});
