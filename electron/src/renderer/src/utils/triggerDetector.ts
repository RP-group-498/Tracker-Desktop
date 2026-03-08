/**
 * Trigger Detector — Step 07
 *
 * Evaluates whether the current context vector indicates procrastination risk
 * and determines if an intervention should be triggered.
 *
 * Also provides urgency-based action filtering (from Step 5 spec).
 *
 * Context vector layout (d = 12):
 *   [0]  bias               [1]  expectancy
 *   [2]  value              [3]  impulsiveness
 *   [4]  delay              [5]  overdue_flag
 *   [6]  motivation         [7]  app_switch_rate
 *   [8]  tab_switch_rate    [9]  non_academic_ratio
 *   [10] idle_ratio         [11] deadline_urgency
 */

const ALL_ACTIONS = [
    'FIVE_SECOND_RULE',
    'POMODORO',
    'BREATHING',
    'VISUALIZATION',
    'REFRAME',
];

/**
 * Compute switching_score from the context vector.
 * switching_score = normalize(app_switch_rate + tab_switch_rate)
 * Since both are already normalized 0-1, we average them.
 */
function switchingScore(vector: number[]): number {
    return (vector[7] + vector[8]) / 2;
}

/**
 * Evaluate whether the current context vector warrants an intervention.
 *
 * Trigger conditions (any one is sufficient):
 *   - idle_ratio > 0.40          → SKIPPED (not yet confirmed)
 *   - non_academic_ratio > 0.35
 *   - switching_score > 0.60
 *   - (deadline_urgency > 0.60 AND motivation < 0.40)
 *   - overdue_flag == 1
 */
export function shouldTrigger(vector: number[]): { triggered: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // idle_ratio > 0.40 — NOT YET IMPLEMENTED
    // if (vector[10] > 0.40) reasons.push('idle_ratio > 0.40');

    if (vector[9] > 0.35) {
        reasons.push(`non_academic_ratio (${vector[9].toFixed(2)}) > 0.35`);
    }

    const sw = switchingScore(vector);
    if (sw > 0.60) {
        reasons.push(`switching_score (${sw.toFixed(2)}) > 0.60`);
    }

    if (vector[11] > 0.60 && vector[6] < 0.40) {
        reasons.push(
            `deadline_urgency (${vector[11].toFixed(2)}) > 0.60 AND motivation (${vector[6].toFixed(2)}) < 0.40`,
        );
    }

    if (vector[5] === 1) {
        reasons.push('overdue_flag = 1');
    }

    return { triggered: reasons.length > 0, reasons };
}

/**
 * Context-aware action filtering based on deadline urgency (Step 5 spec).
 *
 *   urgency >= 0.7  → FIVE_SECOND_RULE, POMODORO, REFRAME
 *   0.3 <= urgency < 0.7  → above + BREATHING
 *   urgency < 0.3  → all actions
 */
export function filterByUrgency(vector: number[]): string[] {
    const urgency = vector[11]; // deadline_urgency

    if (urgency >= 0.7) {
        return ['FIVE_SECOND_RULE', 'POMODORO', 'REFRAME'];
    }
    if (urgency >= 0.3) {
        return ['FIVE_SECOND_RULE', 'POMODORO', 'REFRAME', 'BREATHING'];
    }
    return [...ALL_ACTIONS];
}
