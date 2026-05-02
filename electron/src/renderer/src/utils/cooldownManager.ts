/**
 * Cooldown Manager — Step 07
 *
 * Manages runtime cooldown state for the intervention monitoring loop.
 *
 * Cooldown rules (from the SIE spec):
 *
 *   Minimum gap between interventions: 10 minutes
 *
 *   After No Intervention (bandit chose silence):
 *     - Global cooldown → 10 minutes
 *
 *   After Start:
 *     - Pomodoro → block until Pomodoro ends (25 min work + 5 min break = 30 min)
 *     - Other actions → 10 minute cooldown
 *
 *   After Not Now:
 *     - Global cooldown → 10 minutes
 *     - Same action cooldown → 15 minutes
 *
 *   After Skip:
 *     - Global cooldown → 10 minutes
 *     - Same action cooldown → 10 minutes
 */

const MIN_GAP_MS = 10 * 60 * 1000;           // 10 minutes
const POMODORO_FULL_MS = 30 * 60 * 1000;      // 25 min work + 5 min break
const START_COOLDOWN_MS = 10 * 60 * 1000;     // 10 minutes
const NOT_NOW_GLOBAL_MS = 10 * 60 * 1000;     // 10 minutes
const NOT_NOW_ACTION_MS = 15 * 60 * 1000;     // 15 minutes
const SKIP_GLOBAL_MS = 10 * 60 * 1000;        // 10 minutes
const SKIP_ACTION_MS = 10 * 60 * 1000;        // 10 minutes
const NO_INTERVENTION_GLOBAL_MS = 10 * 60 * 1000; // 10 minutes (trust bandit silence longer)

// Last-N shown buffer: prevents the bandit from repeating the same intervention
// back-to-back even after the per-action cooldown expires.
const RECENT_BUFFER_SIZE = 2;
const RECENT_BUFFER_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class CooldownManager {
    private globalCooldownUntil = 0;
    private actionCooldownUntil: Record<string, number> = {};
    private _activeIntervention: string | null = null;
    private lastInterventionTime = 0;
    private recentShown: Array<{ action: string; shownAt: number }> = [];

    /** Check if there is an active (in-progress) intervention. */
    hasActiveIntervention(): boolean {
        return this._activeIntervention !== null;
    }

    /** Get the name of the active intervention, or null. */
    getActiveIntervention(): string | null {
        return this._activeIntervention;
    }

    /** Mark an intervention as active (show it). */
    setActiveIntervention(action: string | null): void {
        this._activeIntervention = action;
        if (action !== null) {
            this.lastInterventionTime = Date.now();
        }
    }

    /** Is the global cooldown currently active? */
    isGlobalCooldownActive(): boolean {
        const now = Date.now();
        if (now < this.globalCooldownUntil) return true;
        if (this.lastInterventionTime > 0 && now - this.lastInterventionTime < MIN_GAP_MS) return true;
        return false;
    }

    /**
     * Record that an intervention was shown to the user.
     * Stored in a rolling buffer (last N actions, TTL 30 min) to discourage
     * the bandit from repeating the same action back-to-back.
     */
    recordShown(action: string): void {
        if (action === 'NO_INTERVENTION') return;
        this.recentShown.push({ action, shownAt: Date.now() });
        if (this.recentShown.length > RECENT_BUFFER_SIZE) {
            this.recentShown.shift();
        }
    }

    /** Return the list of recently shown actions (non-expired entries only). */
    getRecentShown(): string[] {
        const now = Date.now();
        return this.recentShown
            .filter(e => now - e.shownAt < RECENT_BUFFER_TTL_MS)
            .map(e => e.action);
    }

    /**
     * Filter out actions in per-action cooldown or in the recent-shown buffer.
     * Falls back to cooldown-only filter if recency filtering would leave no options,
     * so the loop never stalls due to the diversity check alone.
     */
    getAvailableActions(allowed: string[]): string[] {
        const now = Date.now();
        const cooldownFiltered = allowed.filter(action => {
            const until = this.actionCooldownUntil[action] ?? 0;
            return now >= until;
        });

        const recent = new Set(this.getRecentShown());
        const recencyFiltered = cooldownFiltered.filter(action => !recent.has(action));

        // If recency filtering would empty the list, fall back to cooldown-only
        return recencyFiltered.length > 0 ? recencyFiltered : cooldownFiltered;
    }

    /**
     * Apply cooldown rules based on the user's response to an intervention.
     * @param action  The bandit action that was shown (e.g. 'POMODORO')
     * @param response  The user's button press: 'start' | 'skip' | 'not_now'
     */
    applyCooldown(action: string, response: 'start' | 'skip' | 'not_now' | 'no_intervention'): void {
        const now = Date.now();
        this._activeIntervention = null;

        switch (response) {
            case 'no_intervention':
                // Short global cooldown — prevents bandit spam when it keeps choosing silence
                this.globalCooldownUntil = now + NO_INTERVENTION_GLOBAL_MS;
                break;

            case 'start':
                if (action === 'POMODORO') {
                    // Block until Pomodoro session ends (25 min work + 5 min break)
                    this.globalCooldownUntil = now + POMODORO_FULL_MS;
                    this.actionCooldownUntil[action] = now + POMODORO_FULL_MS;
                } else {
                    this.globalCooldownUntil = now + START_COOLDOWN_MS;
                    this.actionCooldownUntil[action] = now + START_COOLDOWN_MS;
                }
                break;

            case 'not_now':
                this.globalCooldownUntil = now + NOT_NOW_GLOBAL_MS;
                this.actionCooldownUntil[action] = now + NOT_NOW_ACTION_MS;
                break;

            case 'skip':
                this.globalCooldownUntil = now + SKIP_GLOBAL_MS;
                this.actionCooldownUntil[action] = now + SKIP_ACTION_MS;
                break;
        }

        console.log(
            `[CooldownManager] Applied cooldown: action=${action} response=${response}` +
            ` globalUntil=${new Date(this.globalCooldownUntil).toLocaleTimeString()}`,
        );
    }

    /** Reset all cooldowns (e.g. when monitoring is toggled off). */
    reset(): void {
        this.globalCooldownUntil = 0;
        this.actionCooldownUntil = {};
        this._activeIntervention = null;
        this.lastInterventionTime = 0;
        this.recentShown = [];
    }

    /** Get a summary of current state for debug/UI display. */
    getStatus(): {
        globalCooldownActive: boolean;
        activeIntervention: string | null;
        cooldownActions: string[];
    } {
        const now = Date.now();
        const cooldownActions = Object.entries(this.actionCooldownUntil)
            .filter(([, until]) => now < until)
            .map(([action]) => action);

        return {
            globalCooldownActive: this.isGlobalCooldownActive(),
            activeIntervention: this._activeIntervention,
            cooldownActions,
        };
    }
}
