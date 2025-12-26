/**
 * Python Backend Bridge
 *
 * Manages the Python FastAPI backend process and provides HTTP client for API calls.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import http from 'http';

const PYTHON_PORT = 8000;
const HEALTH_CHECK_INTERVAL = 10000; // 10 seconds
const STARTUP_TIMEOUT = 30000; // 30 seconds
const MAX_RESTART_ATTEMPTS = 3;

interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

export class PythonBridge extends EventEmitter {
    private process: ChildProcess | null = null;
    private isRunning = false;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private restartAttempts = 0;
    private backendDir: string;

    constructor() {
        super();
        // In development, backend is relative to electron folder
        // __dirname in compiled code is: desktop-app/electron/dist/main
        // We need: desktop-app/backend
        // So go up 3 levels (dist -> electron -> desktop-app) then into backend
        if (process.env.NODE_ENV === 'development') {
            this.backendDir = path.join(__dirname, '../../../backend');
        } else {
            this.backendDir = path.join(process.resourcesPath, 'backend');
        }
    }

    /**
     * Start the Python backend process
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log('[PythonBridge] Already running');
            return;
        }

        console.log('[PythonBridge] Starting Python backend...');

        try {
            await this.spawnProcess();
            await this.waitForReady();
            this.startHealthCheck();
            this.isRunning = true;
            this.restartAttempts = 0;
            this.emit('started');
        } catch (error) {
            console.error('[PythonBridge] Failed to start:', error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Stop the Python backend process
     */
    async stop(): Promise<void> {
        console.log('[PythonBridge] Stopping Python backend...');

        this.stopHealthCheck();

        if (this.process) {
            this.process.kill('SIGTERM');

            // Force kill after timeout
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    if (this.process) {
                        this.process.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);

                this.process?.on('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });

            this.process = null;
        }

        this.isRunning = false;
        this.emit('stopped');
    }

    /**
     * Spawn the Python process
     */
    private spawnProcess(): Promise<void> {
        return new Promise((resolve, reject) => {
            let pythonPath: string;
            let args: string[];

            if (process.env.NODE_ENV === 'development') {
                // In development, use venv Python
                pythonPath = path.join(this.backendDir, 'venv', 'Scripts', 'python.exe');
                args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PYTHON_PORT)];
            } else {
                // In production, use bundled executable
                pythonPath = path.join(this.backendDir, 'main.exe');
                args = [];
            }

            console.log(`[PythonBridge] Spawning: ${pythonPath} ${args.join(' ')}`);

            this.process = spawn(pythonPath, args, {
                cwd: this.backendDir,
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: '1',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            this.process.stdout?.on('data', (data) => {
                console.log(`[Python] ${data.toString().trim()}`);
            });

            this.process.stderr?.on('data', (data) => {
                console.error(`[Python] ${data.toString().trim()}`);
            });

            this.process.on('error', (error) => {
                console.error('[PythonBridge] Process error:', error);
                reject(error);
            });

            this.process.on('exit', (code, signal) => {
                console.log(`[PythonBridge] Process exited with code ${code}, signal ${signal}`);
                this.isRunning = false;
                this.emit('stopped');

                // Auto-restart if unexpected exit
                if (code !== 0 && !signal && this.restartAttempts < MAX_RESTART_ATTEMPTS) {
                    this.restartAttempts++;
                    console.log(`[PythonBridge] Attempting restart ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS}`);
                    setTimeout(() => this.start(), 2000 * this.restartAttempts);
                }
            });

            // Resolve immediately, waitForReady will check actual availability
            resolve();
        });
    }

    /**
     * Wait for the backend to be ready (health check passes)
     */
    private waitForReady(): Promise<void> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const checkHealth = async () => {
                try {
                    await this.healthCheck();
                    resolve();
                } catch {
                    if (Date.now() - startTime > STARTUP_TIMEOUT) {
                        reject(new Error('Backend startup timeout'));
                    } else {
                        setTimeout(checkHealth, 500);
                    }
                }
            };

            checkHealth();
        });
    }

    /**
     * Perform a health check
     */
    private healthCheck(): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = http.get(`http://127.0.0.1:${PYTHON_PORT}/api/health`, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    reject(new Error(`Health check failed: ${res.statusCode}`));
                }
                res.resume(); // Consume response
            });

            req.on('error', reject);
            req.setTimeout(5000, () => {
                req.destroy();
                reject(new Error('Health check timeout'));
            });
        });
    }

    /**
     * Start periodic health checks
     */
    private startHealthCheck(): void {
        this.healthCheckTimer = setInterval(async () => {
            try {
                await this.healthCheck();
            } catch (error) {
                console.error('[PythonBridge] Health check failed:', error);
                this.emit('error', error);
            }
        }, HEALTH_CHECK_INTERVAL);
    }

    /**
     * Stop health checks
     */
    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    /**
     * Make an API request to the backend
     */
    async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
        return new Promise((resolve) => {
            const postData = body ? JSON.stringify(body) : '';

            const options: http.RequestOptions = {
                hostname: '127.0.0.1',
                port: PYTHON_PORT,
                path: `/api${path}`,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
                timeout: 10000,
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ success: true, data: parsed });
                    } catch {
                        resolve({ success: false, error: 'Invalid JSON response' });
                    }
                });
            });

            req.on('error', (error) => {
                resolve({ success: false, error: error.message });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: 'Request timeout' });
            });

            if (postData) {
                req.write(postData);
            }
            req.end();
        });
    }

    /**
     * Create a new session
     */
    async createSession(userId?: string): Promise<ApiResponse<{ session_id: string }>> {
        return this.request('POST', '/session', { user_id: userId });
    }

    /**
     * Get current session
     */
    async getCurrentSession(): Promise<ApiResponse<unknown>> {
        return this.request('GET', '/session/current');
    }

    /**
     * Submit activity batch
     */
    async submitActivityBatch(events: unknown[]): Promise<ApiResponse<{ received_ids: string[] }>> {
        return this.request('POST', '/activity/batch', {
            type: 'activity_batch',
            events,
            extensionVersion: '1.0.0',
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Get component status
     */
    async getComponentStatus(name: string): Promise<ApiResponse<unknown>> {
        return this.request('GET', `/components/${name}/status`);
    }

    /**
     * Check if backend is running
     */
    getIsRunning(): boolean {
        return this.isRunning;
    }
}
