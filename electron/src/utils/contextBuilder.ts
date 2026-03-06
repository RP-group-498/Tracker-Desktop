/**
 * Real Context Builder
 * Fetches live signals from Component 1 and Component 4 via the backend
 * and builds a 12-element context vector (all values normalized 0-1) for the LinUCB bandit.
 *
 * Context vector layout (d = 12):
 *   [0]  bias               = 1 (constant)
 *   [1]  expectancy         = completed_tasks_last_7_days / (assigned_tasks_last_7_days + 1)
 *   [2]  value              = 0.5*task_priority + 0.3*grade_weight_normalized + 0.2*value_time
 *   [3]  impulsiveness      = 0.5*switching_score + 0.5*non_academic_ratio
 *   [4]  delay              = hours_to_deadline / (1 + hours_to_deadline)
 *   [5]  overdue_flag       = 1 if deadline passed, else 0
 *   [6]  motivation         = clamp((expectancy * value) / (1 + impulsiveness * delay), 0, 1)
 *   [7]  app_switch_rate    = min(total_transitions / 100, 1.0)
 *   [8]  tab_switch_rate    = 0.0 (not tracked separately)
 *   [9]  non_academic_ratio = non_academic_transitions / (total_transitions + 1)
 *   [10] idle_ratio         = 0.0 (not yet implemented)
 *   [11] deadline_urgency   = 1 - delay
 */

export interface ContextSignals {
    total_transitions: number;
    non_academic_transitions: number;
    completed_tasks_last_7_days: number;
    assigned_tasks_last_7_days: number;
    task_priority: number;
    grade_weight_normalized: number;
    time_spent_on_task: number;
    assigned_time: number;
    task_deadline_time: string | null;
    has_data: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

export function buildVector(signals: ContextSignals): number[] {
    const {
        total_transitions,
        non_academic_transitions,
        completed_tasks_last_7_days,
        assigned_tasks_last_7_days,
        task_priority,
        grade_weight_normalized,
        time_spent_on_task,
        assigned_time,
        task_deadline_time,
    } = signals;

    // Expectancy
    const expectancy = completed_tasks_last_7_days / (assigned_tasks_last_7_days + 1);

    // Value
    const value_time = assigned_time > 0
        ? clamp(time_spent_on_task / assigned_time, 0, 1)
        : 0;
    const value = clamp(
        0.5 * task_priority + 0.3 * grade_weight_normalized + 0.2 * value_time,
        0, 1,
    );

    // Impulsiveness
    const app_switch_rate = Math.min(total_transitions / 100, 1.0);
    const tab_switch_rate = 0.0;
    const non_academic_ratio = non_academic_transitions / (total_transitions + 1);
    const switching_score = (app_switch_rate + tab_switch_rate) / 2;
    const impulsiveness = clamp(0.5 * switching_score + 0.5 * non_academic_ratio, 0, 1);

    // Delay / deadline
    let hours_to_deadline = 0;
    let overdue_flag = 0;
    if (task_deadline_time) {
        const deadlineMs = new Date(task_deadline_time).getTime();
        const nowMs = Date.now();
        const diffHours = (deadlineMs - nowMs) / 3_600_000;
        if (diffHours < 0) {
            overdue_flag = 1;
            hours_to_deadline = 0;
        } else {
            hours_to_deadline = diffHours;
        }
    }
    const delay = overdue_flag === 1 ? 0 : hours_to_deadline / (1 + hours_to_deadline);
    const deadline_urgency = 1 - delay;

    // Motivation (TMT)
    const motivation = clamp((expectancy * value) / (1 + impulsiveness * delay), 0, 1);

    const idle_ratio = 0.0; // not yet implemented

    const vector = [
        1,                  // [0]  bias
        expectancy,         // [1]  expectancy
        value,              // [2]  value
        impulsiveness,      // [3]  impulsiveness
        delay,              // [4]  delay
        overdue_flag,       // [5]  overdue_flag
        motivation,         // [6]  motivation
        app_switch_rate,    // [7]  app_switch_rate
        tab_switch_rate,    // [8]  tab_switch_rate
        non_academic_ratio, // [9]  non_academic_ratio
        idle_ratio,         // [10] idle_ratio
        deadline_urgency,   // [11] deadline_urgency
    ];

    console.log('[ContextBuilder] signals:', signals);
    console.log('[ContextBuilder] vector:', vector);
    return vector;
}

export async function getContext(userId: string): Promise<number[]> {
    const signals: ContextSignals = await window.electronAPI.intervention.getContext(userId);
    return buildVector(signals);
}
