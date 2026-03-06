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

/**
 * Convert a context vector to a string hash.
 * Values are rounded to 2 decimal places for stability.
 */
export function hashContext(vector: number[]): string {
    return vector.map(v => v.toFixed(2)).join('|');
}

/**
 * Check if the given hash matches the last stored hash.
 * Returns true if the context is a duplicate (unchanged).
 */
export function isDuplicateContext(hash: string): boolean {
    return hash === lastContextHash;
}

/**
 * Update the stored hash. Should be called only when
 * an intervention is actually shown to the user.
 */
export function updateHash(hash: string): void {
    lastContextHash = hash;
}

/**
 * Reset the stored hash (e.g. when monitoring is toggled off).
 */
export function resetHash(): void {
    lastContextHash = '';
}
