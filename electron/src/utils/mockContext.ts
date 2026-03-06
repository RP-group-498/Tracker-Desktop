/**
 * Mock Context Provider
 * Generates a 12-element context vector (all values normalized 0-1) for the LinUCB bandit.
 *
 * Context vector layout (d = 12):
 *   [0]  bias               = 1 (constant)
 *   [1]  expectancy         = completed_tasks / (assigned_tasks + 1)
 *   [2]  value              = 0.5*priority + 0.3*grade_weight + 0.2*value_time
 *   [3]  impulsiveness      = 0.5*switching_score + 0.5*non_academic_ratio
 *   [4]  delay              = hours_to_deadline / (1 + hours_to_deadline)
 *   [5]  overdue_flag       = 1 if deadline passed, else 0
 *   [6]  motivation         = (expectancy * value) / (1 + impulsiveness * delay)
 *   [7]  app_switch_rate    (normalized 0-1)
 *   [8]  tab_switch_rate    (normalized 0-1)
 *   [9]  non_academic_ratio = non_academic_transitions / (total_transitions + 1)
 *   [10] idle_ratio         (normalized 0-1)
 *   [11] deadline_urgency   = 1 - delay
 */

export type ScenarioKey = 'A' | 'B' | 'C';

export interface Scenario {
    label: string;
    description: string;
    expectancy: number;
    value: number;
    app_switch_rate: number;
    tab_switch_rate: number;
    non_academic_ratio: number;
    idle_ratio: number;
    hours_to_deadline: number;
    overdue_flag: number;
}

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
    A: {
        label: 'Scenario A — Low Urgency',
        description: 'Far deadline, low switching, low impulsiveness.',
        expectancy: 0.80,
        value: 0.60,
        app_switch_rate: 0.10,
        tab_switch_rate: 0.10,
        non_academic_ratio: 0.20,
        idle_ratio: 0.10,
        hours_to_deadline: 48,
        overdue_flag: 0,
    },
    B: {
        label: 'Scenario B — High Urgency',
        description: 'Near deadline, high impulsiveness.',
        expectancy: 0.50,
        value: 0.80,
        app_switch_rate: 0.70,
        tab_switch_rate: 0.60,
        non_academic_ratio: 0.70,
        idle_ratio: 0.30,
        hours_to_deadline: 0.5,
        overdue_flag: 0,
    },
    C: {
        label: 'Scenario C — Overdue',
        description: 'Deadline has passed, high urgency and impulsiveness.',
        expectancy: 0.30,
        value: 0.90,
        app_switch_rate: 0.80,
        tab_switch_rate: 0.70,
        non_academic_ratio: 0.80,
        idle_ratio: 0.50,
        hours_to_deadline: 0,
        overdue_flag: 1,
    },
};

let _currentScenario: ScenarioKey = 'A';

export function buildVector(s: Scenario): number[] {
    const bias = 1;
    const expectancy = s.expectancy;
    const value = s.value;

    const switching_score = (s.app_switch_rate + s.tab_switch_rate) / 2;
    const impulsiveness = 0.5 * switching_score + 0.5 * s.non_academic_ratio;

    const delay = s.overdue_flag === 1
        ? 0
        : s.hours_to_deadline / (1 + s.hours_to_deadline);

    const overdue_flag = s.overdue_flag;

    const motivation = (expectancy * value) / (1 + impulsiveness * delay);
    const motivation_clamped = Math.min(1, Math.max(0, motivation));

    const deadline_urgency = 1 - delay;

    return [
        bias,                    // [0]
        expectancy,              // [1]
        value,                   // [2]
        impulsiveness,           // [3]
        delay,                   // [4]
        overdue_flag,            // [5]
        motivation_clamped,      // [6]
        s.app_switch_rate,       // [7]
        s.tab_switch_rate,       // [8]
        s.non_academic_ratio,    // [9]
        s.idle_ratio,            // [10]
        deadline_urgency,        // [11]
    ];
}

export function setScenario(scenario: ScenarioKey): void {
    if (!SCENARIOS[scenario]) {
        console.warn(`[MockContext] Unknown scenario: ${scenario}`);
        return;
    }
    _currentScenario = scenario;
    console.log(`[MockContext] Scenario set to ${scenario}: ${SCENARIOS[scenario].label}`);
}

export function getCurrentScenario(): ScenarioKey {
    return _currentScenario;
}

export function getScenarioInfo(): { label: string; description: string } {
    const s = SCENARIOS[_currentScenario];
    return { label: s.label, description: s.description };
}

export function getMockContext(userId: string): number[] {
    const scenario = SCENARIOS[_currentScenario];
    const vector = buildVector(scenario);
    console.log(`[MockContext] user=${userId} scenario=${_currentScenario}`, vector);
    return vector;
}

export function getAllScenarios(): Record<ScenarioKey, { label: string; description: string }> {
    const result = {} as Record<ScenarioKey, { label: string; description: string }>;
    for (const key of Object.keys(SCENARIOS) as ScenarioKey[]) {
        result[key] = { label: SCENARIOS[key].label, description: SCENARIOS[key].description };
    }
    return result;
}
