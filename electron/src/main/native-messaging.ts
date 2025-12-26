/**
 * Native Messaging Server
 *
 * HTTP server that receives messages from the native messaging host
 * and forwards them to the Python backend.
 */

import http from 'http';
import { EventEmitter } from 'events';
import { PythonBridge } from './python-bridge';

const SERVER_PORT = 8765;

interface ExtensionMessage {
    type: 'connect' | 'activity_batch' | 'heartbeat';
    [key: string]: unknown;
}

interface SessionInfo {
    sessionId: string;
    userId?: string;
}

export class NativeMessagingServer extends EventEmitter {
    private server: http.Server | null = null;
    private pythonBridge: PythonBridge;
    private currentSession: SessionInfo | null = null;
    private lastHeartbeat: number = 0;
    private extensionConnected = false;
    private connectionTimeout: NodeJS.Timeout | null = null;

    constructor(pythonBridge: PythonBridge) {
        super();
        this.pythonBridge = pythonBridge;
    }

    /**
     * Start the HTTP server
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(this.handleRequest.bind(this));

            this.server.on('error', (error) => {
                console.error('[NativeMessaging] Server error:', error);
                reject(error);
            });

            this.server.listen(SERVER_PORT, '127.0.0.1', () => {
                console.log(`[NativeMessaging] Server listening on port ${SERVER_PORT}`);
                resolve();
            });
        });
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
            }

            if (this.server) {
                this.server.close(() => {
                    console.log('[NativeMessaging] Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Handle incoming HTTP request from native host
     */
    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (req.method !== 'POST' || req.url !== '/native-message') {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });

        req.on('end', async () => {
            try {
                const message: ExtensionMessage = JSON.parse(body);
                const response = await this.handleMessage(message);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));
            } catch (error) {
                console.error('[NativeMessaging] Error handling message:', error);
                res.writeHead(500);
                res.end(JSON.stringify({ type: 'error', error: String(error) }));
            }
        });
    }

    /**
     * Handle a message from the browser extension
     */
    private async handleMessage(message: ExtensionMessage): Promise<unknown> {
        console.log(`[NativeMessaging] Received: ${message.type}`);

        // Reset connection timeout
        this.resetConnectionTimeout();

        switch (message.type) {
            case 'connect':
                return this.handleConnect(message);

            case 'activity_batch':
                return this.handleActivityBatch(message);

            case 'heartbeat':
                return this.handleHeartbeat(message);

            default:
                return { type: 'error', error: `Unknown message type: ${message.type}` };
        }
    }

    /**
     * Handle connect message - create a new session
     */
    private async handleConnect(message: ExtensionMessage): Promise<unknown> {
        console.log('[NativeMessaging] Extension connecting...');

        // Create a new session in the backend
        const result = await this.pythonBridge.createSession();

        if (result.success && result.data) {
            const sessionId = (result.data as { session_id: string }).session_id;
            this.currentSession = { sessionId };

            // Mark as connected
            if (!this.extensionConnected) {
                this.extensionConnected = true;
                this.emit('extensionConnected');
            }

            this.emit('sessionCreated', sessionId);

            return {
                type: 'session',
                sessionId,
                status: 'active',
            };
        } else {
            return {
                type: 'error',
                error: result.error || 'Failed to create session',
            };
        }
    }

    /**
     * Handle activity batch - store events and send ACK
     */
    private async handleActivityBatch(message: ExtensionMessage): Promise<unknown> {
        const events = message.events as unknown[];
        if (!Array.isArray(events) || events.length === 0) {
            return { type: 'ack', receivedEventIds: [] };
        }

        console.log(`[NativeMessaging] Received ${events.length} events`);

        // Add session ID to events if we have one
        const eventsWithSession = events.map((event: unknown) => ({
            ...(event as Record<string, unknown>),
            sessionId: this.currentSession?.sessionId || null,
        }));

        // Forward to Python backend
        const result = await this.pythonBridge.submitActivityBatch(eventsWithSession);

        if (result.success && result.data) {
            const receivedIds = result.data.received_ids;
            this.emit('eventsReceived', receivedIds.length);

            return {
                type: 'ack',
                receivedEventIds: receivedIds,
            };
        } else {
            return {
                type: 'error',
                error: result.error || 'Failed to process activity batch',
            };
        }
    }

    /**
     * Handle heartbeat - just acknowledge
     */
    private async handleHeartbeat(_message: ExtensionMessage): Promise<unknown> {
        this.lastHeartbeat = Date.now();

        return {
            type: 'ack',
            timestamp: new Date().toISOString(),
            sessionId: this.currentSession?.sessionId,
        };
    }

    /**
     * Send a command to the extension (via native host response)
     */
    sendCommand(command: 'pause' | 'resume' | 'clear_local'): void {
        // Commands are sent as part of the next response
        // This is a limitation of the pull-based native messaging
        console.log(`[NativeMessaging] Queueing command: ${command}`);
        // TODO: Implement command queue for next response
    }

    /**
     * Reset the connection timeout
     */
    private resetConnectionTimeout(): void {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
        }

        // If no message received in 2 minutes, consider disconnected
        this.connectionTimeout = setTimeout(() => {
            if (this.extensionConnected) {
                this.extensionConnected = false;
                this.emit('extensionDisconnected');
            }
        }, 120000);
    }

    /**
     * Get current session info
     */
    getCurrentSession(): SessionInfo | null {
        return this.currentSession;
    }

    /**
     * Check if extension is connected
     */
    isExtensionConnected(): boolean {
        return this.extensionConnected;
    }
}
