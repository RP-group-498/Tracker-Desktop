/**
 * Cooldown Manager — Step 07
 *
 * Manages runtime cooldown state for the intervention monitoring loop.
 *
 * Cooldown rules (from the SIE spec):
 *
 *   Minimum gap between interventions: 10 minutes
 *
 *   After Start:
 *     - Pomodoro → block until Pomodoro ends (25 min work + 5 min break = 30 min)
 *     - Other actions → 10 minute cooldown
 *
 *   After Not Now:
 *     - Global cooldown → 5 minutes
 *     - Same action cooldown → 15 minutes
 *
 *   After Skip:
 *     - Global cooldown → 5 minutes
 *     - Same action cooldown → 10 minutes
 */

const MIN_GAP_MS = 10 * 60 * 1000;           // 10 minutes
const POMODORO_FULL_MS = 30 * 60 * 1000;      // 25 min work + 5 min break
const START_COOLDOWN_MS = 10 * 60 * 1000;     // 10 minutes
const NOT_NOW_GLOBAL_MS = 5 * 60 * 1000;      // 5 minutes
const NOT_NOW_ACTION_MS = 15 * 60 * 1000;     // 15 minutes
const SKIP_GLOBAL_MS = 5 * 60 * 1000;         // 5 minutes
const SKIP_ACTION_MS = 10 * 60 * 1000;        // 10 minutes

export class CooldownManager {
    private globalCooldownUntil = 0;
    private actionCooldownUntil: Record<string, number> = {};
    private _activeIntervention: string | null = null;
    private lastInterventionTime = 0;

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

    /** Filter out actions that are currently in their per-action cooldown. */
    getAvailableActions(allowed: string[]): string[] {
        const now = Date.now();
        return allowed.filter(action => {
            const until = this.actionCooldownUntil[action] ?? 0;
            return now >= until;
        });
    }

    /**
     * Apply cooldown rules based on the user's response to an intervention.
     * @param action  The bandit action that was shown (e.g. 'POMODORO')
     * @param response  The user's button press: 'start' | 'skip' | 'not_now'
     */
    applyCooldown(action: string, response: 'start' | 'skip' | 'not_now'): void {
        const now = Date.now();
        this._activeIntervention = null;

        switch (response) {
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
