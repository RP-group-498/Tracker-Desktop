/**
 * Monitoring Loop
 *
 * Orchestrates the 60-second periodic monitoring cycle.
 *
 * Each tick:
 *   1. Check active intervention → skip if busy
 *   2. Check global cooldown → skip if cooling
 *   3. Fetch context vector via getContext() (7-element TMT vector)
 *   4. Evaluate TMT trigger conditions → skip if no risk
 *   5. Hash context → skip if duplicate
 *   6. Remove per-action cooldown violations from candidate list → skip if empty
 *   7. Call /bandit/select (backend uses deficit-weighted LinUCB)
 *   8. Show notification via callback
 *
 * Response handling is delegated to the page via onSuggestIntervention callback.
 * Urgency-based action filtering removed — deficit-weighted selection handles this.
 */

import { getContext } from '../../../utils/contextBuilder';
import { shouldTrigger } from './triggerDetector';
import { CooldownManager } from './cooldownManager';
import { hashContext, isDuplicateContext, updateHash, resetHash } from './contextHasher';

// All available intervention actions — backend selects best via deficit-weighted LinUCB
const ALL_ACTIONS = ['FIVE_SECOND_RULE', 'POMODORO', 'BREATHING', 'VISUALIZATION', 'REFRAME'];

const MONITORING_INTERVAL_MS = 60_000; // 60 seconds

export interface MonitoringCallbacks {
    /** Called to request a bandit selection + show notification. */
    onSuggestIntervention: (vector: number[], allowedActions: string[]) => Promise<void>;
    /** Called to log motivation for each monitoring tick. */
    onLogMotivation: (vector: number[]) => void;
    /** Called with status messages for UI display. */
    onStatusUpdate: (status: string) => void;
}

export class MonitoringLoop {
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private _running = false;
    private cooldown: CooldownManager;
    private callbacks: MonitoringCallbacks;
    private userId: string;
    private tickCount = 0;

    constructor(cooldown: CooldownManager, callbacks: MonitoringCallbacks, userId: string) {
        this.cooldown = cooldown;
        this.callbacks = callbacks;
        this.userId = userId;
    }

    /** Start the monitoring loop (runs every 60 seconds). */
    start(): void {
        if (this._running) return;
        this._running = true;
        this.tickCount = 0;

        this.callbacks.onStatusUpdate('Monitoring active');

        // Run first tick immediately
        this.tick();

        // Then every 60 seconds
        this.intervalId = setInterval(() => this.tick(), MONITORING_INTERVAL_MS);
    }

    /** Stop the monitoring loop and reset state. */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this._running = false;
        this.cooldown.reset();
        resetHash();

        this.callbacks.onStatusUpdate('Monitoring stopped');
    }

    /** Check if the loop is currently running. */
    isRunning(): boolean {
        return this._running;
    }

    /** Get the cooldown manager (for external status queries). */
    getCooldownManager(): CooldownManager {
        return this.cooldown;
    }

    /** Single monitoring cycle tick. */
    private async tick(): Promise<void> {
        this.tickCount++;
        const tickId = this.tickCount;

        try {
            // 1. Check active intervention
            if (this.cooldown.hasActiveIntervention()) {
                return;
            }

            // 2. Check global cooldown
            if (this.cooldown.isGlobalCooldownActive()) {
                this.callbacks.onStatusUpdate('Cooldown active — waiting...');
                return;
            }

            // 3. Fetch context vector
            this.callbacks.onStatusUpdate('Fetching context...');
            const vector = await getContext();

            // Log motivation at every tick (motivation is now at vector[5])
            this.callbacks.onLogMotivation(vector);

            // 4. Evaluate TMT trigger conditions
            const { triggered } = shouldTrigger(vector);
            if (!triggered) {
                this.callbacks.onStatusUpdate('Monitoring — no risk detected');
                return;
            }

            // 5. Check for duplicate context
            const ctxHash = hashContext(vector);
            if (isDuplicateContext(ctxHash)) {
                this.callbacks.onStatusUpdate('Monitoring — context unchanged');
                return;
            }

            // 6. Remove per-action cooldown violations from all actions
            // (urgency-based filtering removed — deficit-weighted LinUCB handles selection)
            const available = this.cooldown.getAvailableActions(ALL_ACTIONS);
            if (available.length === 0) {
                this.callbacks.onStatusUpdate('All actions on cooldown');
                return;
            }

            this.callbacks.onStatusUpdate(`Risk detected! Suggesting intervention...`);

            // 7 & 8. Delegate bandit selection + notification to the page
            updateHash(ctxHash);
            await this.callbacks.onSuggestIntervention(vector, available);
        } catch (err) {
            const msg = (err as Error)?.message ?? 'unknown';
            if (msg === 'No context data available') {
                this.callbacks.onStatusUpdate('Monitoring — no active task');
            } else {
                console.error(`[MonitoringLoop] Tick #${tickId} error:`, err);
                this.callbacks.onStatusUpdate(`Error: ${msg}`);
            }
        }
    }
}
