/**
 * Context Hasher — Step 07
 *
 * Duplicate‑context suppression.
 * Prevents repeated intervention suggestions when the context vector
 * hasn't meaningfully changed between monitoring cycles.
 *
 * Algorithm:
 *   1. Round each context vector value to 2 decimal places
 *   2. Convert to a stable string hash
 *   3. Compare with the last stored hash
 *   4. Update hash only when an intervention is actually shown
 */

let lastContextHash = '';
let lastHashTime = 0;

/** Re-evaluate even with unchanged context after 5 minutes */
const MAX_HASH_AGE_MS = 5 * 60 * 1000;

/**
 * Convert a context vector to a string hash.
 * Values are rounded to 2 decimal places for stability.
 */
export function hashContext(vector: number[]): string {
    return vector.map(v => v.toFixed(2)).join('|');
}

/**
 * Check if the given hash matches the last stored hash.
 * Returns true if the context is a duplicate (unchanged AND fresh).
 * After MAX_HASH_AGE_MS, allows re-evaluation even with identical context
 * so the bandit can reconsider in stable states.
 */
export function isDuplicateContext(hash: string): boolean {
    if (hash !== lastContextHash) return false;
    return (Date.now() - lastHashTime) < MAX_HASH_AGE_MS;
}

/**
 * Update the stored hash. Should be called only when
 * an intervention is actually shown to the user.
 */
export function updateHash(hash: string): void {
    lastContextHash = hash;
    lastHashTime = Date.now();
}

/**
 * Reset the stored hash (e.g. when monitoring is toggled off).
 */
export function resetHash(): void {
    lastContextHash = '';
    lastHashTime = 0;
}
