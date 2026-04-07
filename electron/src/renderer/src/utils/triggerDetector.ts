/**
 * Trigger Detector — TMT-Based
 *
 * Evaluates whether the current context vector indicates procrastination risk
 * and determines if an intervention should be triggered.
 *
 * Context vector layout (d = 9):
 *   [0] bias           [1] expectancy
 *   [2] value          [3] impulsiveness
 *   [4] delay          [5] motivation
 *   [6] deficit_code   [7] session_dur
 *   [8] time_of_day
 *
 * Old threshold-based triggers removed. New TMT deficit-based trigger replaces
 * the five old rules (non_academic_ratio > 0.35, switching_score > 0.60,
 * deadline_urgency > 0.60 AND motivation < 0.40, overdue_flag == 1, idle_ratio > 0.40)
 * with 2 conditions on TMT-meaningful constructs.
 *
 * Note: The 0.4 and 0.5 thresholds below are tunable hyperparameters, acknowledged
 * as such. The key improvement is 2 conditions on TMT constructs vs 5 conditions on
 * raw signals. These could be empirically optimized.
 */

/**
 * Evaluate whether the current context vector warrants an intervention.
 *
 * Trigger conditions (any one is sufficient):
 *
 *   Primary: motivation < 0.4
 *     TMT predicts procrastination when motivation drops below a task-engagement
 *     threshold. Single threshold on the composite TMT score replaces the old
 *     five independent raw-signal rules.
 *
 *   Secondary: impulsiveness > 0.5 AND motivation < 0.6
 *     Catches cases where E and V are moderate but the user is still frequently
 *     switching to distracting activities.
 */
export function shouldTrigger(vector: number[]): { triggered: boolean; reasons: string[] } {
    const motivation = vector[5];    // TMT motivation score
    const impulsiveness = vector[3]; // TMT I proxy

    const reasons: string[] = [];

    // Primary condition: low TMT motivation
    if (motivation < 0.4) {
        reasons.push(`motivation (${motivation.toFixed(2)}) < 0.40`);
    }

    // Secondary condition: high impulsiveness with moderate motivation
    if (impulsiveness > 0.5 && motivation < 0.6) {
        reasons.push(`impulsiveness (${impulsiveness.toFixed(2)}) > 0.50 with motivation (${motivation.toFixed(2)}) < 0.60`);
    }

    return { triggered: reasons.length > 0, reasons };
}
