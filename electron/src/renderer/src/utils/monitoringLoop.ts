/**
 * Monitoring Loop — Step 07
 *
 * Orchestrates the 60-second periodic monitoring cycle.
 *
 * Each tick:
 *   1. Check active intervention → skip if busy
 *   2. Check global cooldown → skip if cooling
 *   3. Fetch context vector via getContext()
 *   4. Evaluate trigger conditions → skip if no risk
 *   5. Hash context → skip if duplicate
 *   6. Filter actions by urgency + cooldown → skip if empty
 *   7. Call /bandit/select
 *   8. Show notification via callback
 *
 * Response handling is delegated to the page via onInterventionShown / onNeedBanditSelect
 * callbacks.
 */

import { getContext } from '../../../utils/contextBuilder';
import { shouldTrigger, filterByUrgency } from './triggerDetector';
import { CooldownManager } from './cooldownManager';
import { hashContext, isDuplicateContext, updateHash, resetHash } from './contextHasher';

const MONITORING_INTERVAL_MS = 60_000; // 60 seconds
const BANDIT_USER_ID = 'u123';

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
    private tickCount = 0;

    constructor(cooldown: CooldownManager, callbacks: MonitoringCallbacks) {
        this.cooldown = cooldown;
        this.callbacks = callbacks;
    }

    /** Start the monitoring loop (runs every 60 seconds). */
    start(): void {
        if (this._running) return;
        this._running = true;
        this.tickCount = 0;

        console.log('[MonitoringLoop] Started — checking every 60s');
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

        console.log('[MonitoringLoop] Stopped');
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
                console.log(`[MonitoringLoop] Tick #${tickId}: Skipped — active intervention: ${this.cooldown.getActiveIntervention()}`);
                return;
            }

            // 2. Check global cooldown
            if (this.cooldown.isGlobalCooldownActive()) {
                console.log(`[MonitoringLoop] Tick #${tickId}: Skipped — global cooldown active`);
                this.callbacks.onStatusUpdate('Cooldown active — waiting...');
                return;
            }

            // 3. Fetch context vector
            console.log(`[MonitoringLoop] Tick #${tickId}: Fetching context...`);
            this.callbacks.onStatusUpdate('Fetching context...');
            const vector = await getContext(BANDIT_USER_ID);

            // Log motivation at every tick
            this.callbacks.onLogMotivation(vector);

            // 4. Evaluate trigger conditions
            const { triggered, reasons } = shouldTrigger(vector);
            if (!triggered) {
                console.log(`[MonitoringLoop] Tick #${tickId}: No trigger — context is fine`);
                this.callbacks.onStatusUpdate('Monitoring — no risk detected');
                return;
            }
            console.log(`[MonitoringLoop] Tick #${tickId}: Triggered — ${reasons.join('; ')}`);

            // 5. Check for duplicate context
            const ctxHash = hashContext(vector);
            if (isDuplicateContext(ctxHash)) {
                console.log(`[MonitoringLoop] Tick #${tickId}: Skipped — duplicate context`);
                this.callbacks.onStatusUpdate('Monitoring — context unchanged');
                return;
            }

            // 6. Filter actions by urgency, then remove cooled-down ones
            const urgencyFiltered = filterByUrgency(vector);
            const available = this.cooldown.getAvailableActions(urgencyFiltered);
            if (available.length === 0) {
                console.log(`[MonitoringLoop] Tick #${tickId}: Skipped — no available actions after cooldown filter`);
                this.callbacks.onStatusUpdate('All actions on cooldown');
                return;
            }

            console.log(`[MonitoringLoop] Tick #${tickId}: Available actions: ${available.join(', ')}`);
            this.callbacks.onStatusUpdate(`Risk detected! Suggesting intervention...`);

            // 7 & 8. Delegate bandit selection + notification to the page
            updateHash(ctxHash);
            await this.callbacks.onSuggestIntervention(vector, available);
        } catch (err) {
            console.warn(`[MonitoringLoop] Tick #${tickId} error:`, err);
            this.callbacks.onStatusUpdate(`Error: ${(err as Error)?.message ?? 'unknown'}`);
        }
    }
}
