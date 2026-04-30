/**
 * Python Backend Bridge
 *
 * Manages the Python FastAPI backend process and provides HTTP client for API calls.
 */

import { spawn, ChildProcess, execFile } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import http from 'http';
import net from 'net';

const PYTHON_PORT = 8001;
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
    private ownsProcess = false;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private restartAttempts = 0;
    private backendDir: string;
    private authToken: string | null = null;

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
            const reused = await this.ensureBackendAvailable();
            if (reused) {
                return;
            }
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

        if (this.process && this.ownsProcess) {
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
        this.ownsProcess = false;
        this.emit('stopped');
    }

    /**
     * Ensure backend is either already healthy on the port, or the port is free.
     *
     * This prevents restart loops when an orphaned uvicorn process is still
     * holding the port (common during dev hot reload / crashes).
     */
    private async ensureBackendAvailable(): Promise<boolean> {
        const portFree = await this.isPortFree(PYTHON_PORT);
        if (portFree) return false;

        // Port is taken: if the service is healthy, just reuse it.
        try {
            await this.healthCheck();
            console.log('[PythonBridge] Backend already running on port', PYTHON_PORT);
            this.isRunning = true;
            this.ownsProcess = false;
            this.startHealthCheck();
            this.restartAttempts = 0;
            this.emit('started');
            return true;
        } catch (err: any) {
            // Port is occupied by a non-healthy process — kill it and wait
            // for the port to be released before spawning a new one.
            await this.tryKillListenersOnPort(PYTHON_PORT);
            await this.waitForPortFree(PYTHON_PORT, 5000);
        }

        return false;
    }

    /**
     * Wait until a port is free, polling every 250ms up to the given timeout.
     * Throws if the port is still occupied after the deadline.
     */
    private async waitForPortFree(port: number, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.isPortFree(port)) return;
            await new Promise((r) => setTimeout(r, 250));
        }
        console.warn(`[PythonBridge] Port ${port} still occupied after ${timeoutMs}ms — will attempt spawn anyway`);
    }

    private isPortFree(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.unref();
            server.once('error', (e: any) => {
                resolve(e?.code !== 'EADDRINUSE');
            });
            server.listen({ host: '127.0.0.1', port }, () => {
                server.close(() => resolve(true));
            });
        });
    }

    private tryKillListenersOnPort(port: number): Promise<void> {
        if (process.platform === 'darwin' || process.platform === 'linux') {
            return new Promise((resolve) => {
                execFile('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], (error, stdout) => {
                    if (error || !stdout) return resolve();
                    const pids = stdout
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .map((s) => Number(s))
                        .filter((n) => Number.isFinite(n) && n > 0);
                    if (pids.length === 0) return resolve();

                    console.warn(`[PythonBridge] Port ${port} is in use; terminating listener PID(s): ${pids.join(', ')}`);
                    for (const pid of pids) {
                        try {
                            process.kill(pid, 'SIGTERM');
                        } catch {
                            // already gone
                        }
                    }

                    // After 1s, SIGKILL any that are still alive.
                    setTimeout(() => {
                        for (const pid of pids) {
                            try {
                                process.kill(pid, 0); // test if still alive
                                console.warn(`[PythonBridge] PID ${pid} did not exit after SIGTERM, sending SIGKILL`);
                                process.kill(pid, 'SIGKILL');
                            } catch {
                                // already gone
                            }
                        }
                        resolve();
                    }, 1000);
                });
            });
        }

        // Windows: leave as no-op for now.
        return Promise.resolve();
    }

    /**
     * Spawn the Python process
     */
    private spawnProcess(): Promise<void> {
        return new Promise((resolve, reject) => {
            let pythonPath: string;
            let args: string[];

            if (process.env.NODE_ENV === 'development') {
                // In development, use venv Python (platform-aware paths)
                if (process.platform === 'win32') {
                    pythonPath = path.join(this.backendDir, 'venv', 'Scripts', 'python.exe');
                } else {
                    pythonPath = path.join(this.backendDir, 'venv', 'bin', 'python');
                }
                args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PYTHON_PORT)];
            } else {
                // In production, use bundled executable
                const execName = process.platform === 'win32' ? 'main.exe' : 'main';
                pythonPath = path.join(this.backendDir, execName);
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
            this.ownsProcess = true;

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
    async request<T>(method: string, path: string, body?: unknown, timeout: number = 10000): Promise<ApiResponse<T>> {
        return new Promise((resolve) => {
            const postData = body ? JSON.stringify(body) : '';

            const headers: http.OutgoingHttpHeaders = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            };

            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const options: http.RequestOptions = {
                hostname: '127.0.0.1',
                port: PYTHON_PORT,
                path: `/api${path}`,
                method,
                headers,
                timeout,
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve({ success: true, data: parsed });
                        } else {
                            const detail = (parsed as any)?.detail ?? (parsed as any)?.error ?? JSON.stringify(parsed);
                            resolve({ success: false, error: `HTTP ${res.statusCode}: ${detail}` });
                        }
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
     * End a session (marks it as "ended" with an end_time)
     */
    async endSession(sessionId: string): Promise<ApiResponse<unknown>> {
        return this.request('POST', `/session/${sessionId}/end`);
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
     * Set the current authentication token
     */
    setAuthToken(token: string | null): void {
        this.authToken = token;
    }

    /**
     * Check if backend is running
     */
    getIsRunning(): boolean {
        return this.isRunning;
    }
}
