/**
 * TMT Context Builder
 * Fetches live signals from Component 1 and Component 4 via the backend
 * and builds a 7-element TMT-grounded context vector for the LinUCB bandit.
 *
 * Architecture:
 *   Layer 1: Raw behavioral signals (no composites)
 *   Layer 2: TMT proxy mapping (one clean proxy per TMT component)
 *   Layer 3: Context vector construction (7 elements, zero redundancy)
 *
 * Context vector layout (d = 7):
 *   [0] bias           = 1.0 (constant)
 *   [1] expectancy     = TMT E proxy (two-speed: 60% task_completion_rate + 40% recent focus)
 *                        (Bandura, 1977; Klassen et al., 2008)
 *   [2] value          = TMT V proxy (two-speed: objective importance × subjective engagement)
 *                        (Wigfield & Eccles, 2000; Blunt & Pychyl, 2000)
 *   [3] impulsiveness  = TMT I proxy (two-speed: max of daily ratio, 5-min switch rate, idle time)
 *                        (Steel, 2007)
 *   [4] delay          = TMT D proxy (two-speed: hyperbolic distance × progress deficit)
 *                        (Mazur, 1987; Steel, 2007; Carver & Scheier, 1998)
 *   [5] motivation     = TMT score: clamp((E*V) / (1 + I*D), 0, 1)
 *   [6] deficit_code   = dominant TMT deficit (ordinal: 0.0=E / 0.33=V / 0.67=I / 1.0=D)
 */

/**
 * Raw signals returned by the backend /context endpoint.
 * These are the direct database values before any TMT transformation.
 */
interface BackendContextSignals {
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
    sliding_window?: {
        app_switches_5min: number;
        non_academic_switches_10min: number;
        total_events_10min: number;
        seconds_since_last_academic: number | null;
        window_has_data: boolean;
    };
}

/**
 * TMT-grounded behavioral signals — one measurable input per concept.
 * No composite formulas. No arbitrary weights.
 */
interface RawBehavioralSignals {
    /** completed_tasks / (assigned_tasks + 1) — 0 if no tasks */
    task_completion_rate: number;
    /**
     * time_spent_on_task / assigned_time, capped at 2.0.
     * Default 0.5 if no active task or no estimate.
     */
    task_time_ratio: number;
    /** User-assigned task priority, normalized 0-1 */
    task_priority: number;
    /** Course grade weight, normalized 0-1 */
    grade_weight: number;
    /**
     * Hours remaining to nearest deadline.
     * Negative if overdue. Default 168 (1 week) if no deadline.
     */
    hours_to_deadline: number;
    /** non_academic_transitions / total_transitions (daily aggregate, slow component) */
    non_academic_ratio: number;
    /** total_transitions / 15 — per-minute switch frequency estimate */
    app_switch_frequency: number;

    // --- Fast components (sliding window, two-speed TMT) ---
    /** App switches in last 5 min, normalized to [0,1]. 10+ switches = 1.0 */
    app_switches_5min_normalized: number;
    /** Non-academic event ratio in last 10 minutes */
    non_academic_ratio_10min: number;
    /** Minutes since last academic activity (0 if no data) */
    minutes_since_last_academic: number;
    /** Whether sliding window data is available from backend */
    has_sliding_window: boolean;
    /** Whether the current task has a valid time estimate (assigned_time > 0) */
    has_time_estimate: boolean;
}

/** The four TMT component proxies */
interface TMTProxies {
    E: number;  // Expectancy: 0-1, higher = more confident
    V: number;  // Value: 0-1, higher = more important
    I: number;  // Impulsiveness: 0-1, higher = more distracted
    D: number;  // Delay: 0-1, higher = further from deadline
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

/**
 * Map backend signals to structured RawBehavioralSignals.
 */
function toRawSignals(backend: BackendContextSignals): RawBehavioralSignals {
    // hours_to_deadline: negative = overdue, default 168 (1 week) if no deadline
    let hours_to_deadline = 168;
    if (backend.task_deadline_time) {
        hours_to_deadline = (new Date(backend.task_deadline_time).getTime() - Date.now()) / 3_600_000;
    }

    // task_completion_rate: default 0.5 if no tasks have been assigned yet
    const task_completion_rate = backend.assigned_tasks_last_7_days === 0
        ? 0.5
        : backend.completed_tasks_last_7_days / backend.assigned_tasks_last_7_days;

    // task_time_ratio: default 0.5 if no active task or no time estimate
    const task_time_ratio = backend.assigned_time > 0
        ? Math.min(backend.time_spent_on_task / backend.assigned_time, 2.0)
        : 0.5;

    // --- Sliding window (two-speed TMT) ---
    const sw = backend.sliding_window;
    const hasWindow = sw?.window_has_data ?? false;

    // I_fast: 10+ app switches in 5 min = fully impulsive (1.0)
    const app_switches_5min_normalized = hasWindow
        ? clamp(sw!.app_switches_5min / 10, 0, 1)
        : 0;

    // E_fast input: non-academic ratio in recent 10-min window
    const non_academic_ratio_10min = hasWindow && sw!.total_events_10min > 0
        ? sw!.non_academic_switches_10min / sw!.total_events_10min
        : 0;

    // I_idle: minutes since last academic activity (capped at 30 by consumer)
    const minutes_since_last_academic = hasWindow && sw!.seconds_since_last_academic !== null
        ? sw!.seconds_since_last_academic / 60
        : 0;

    return {
        task_completion_rate,
        task_time_ratio,
        task_priority: backend.task_priority,
        grade_weight: backend.grade_weight_normalized,
        hours_to_deadline,
        non_academic_ratio: backend.total_transitions > 0
            ? backend.non_academic_transitions / backend.total_transitions
            : 0.0,
        app_switch_frequency: backend.total_transitions / 15,
        app_switches_5min_normalized,
        non_academic_ratio_10min,
        minutes_since_last_academic,
        has_sliding_window: hasWindow,
        has_time_estimate: backend.assigned_time > 0,
    };
}

/**
 * Compute the four TMT component proxies from raw behavioral signals.
 *
 * Two-speed TMT: All four components blend daily aggregates (slow) with
 * sliding-window or task-progress signals (fast) so the motivation score
 * reacts to real-time behavior.
 *
 * When sliding-window data is unavailable, falls back to slow-only
 * (identical to previous behavior).
 */
export function computeTMTProxies(signals: RawBehavioralSignals): TMTProxies {
    // === Expectancy: two-speed ===
    // E_slow: past task success predicts self-efficacy (Bandura, 1977)
    const E_slow = clamp(signals.task_completion_rate, 0, 1);
    let E: number;
    if (signals.has_sliding_window) {
        // E_fast: recent off-task activity lowers momentary self-efficacy
        const E_fast = clamp(1 - signals.non_academic_ratio_10min, 0, 1);
        E = clamp(0.6 * E_slow + 0.4 * E_fast, 0, 1);
    } else {
        E = E_slow;
    }

    // === Value: two-speed ===
    // V_slow: objective task importance (Wigfield & Eccles, 2000)
    const V_raw = Math.max(signals.task_priority, signals.grade_weight);
    const V_slow = V_raw > 0 ? V_raw : 0.5;
    let V: number;
    if (signals.has_sliding_window) {
        // V_fast: subjective value erosion from distraction behavior.
        // If the user keeps switching to non-academic apps, the task isn't
        // holding their attention — a behavioral signal of low perceived value
        // (Blunt & Pychyl, 2000; Steel, 2007 — task aversiveness).
        const V_fast = clamp(1 - signals.non_academic_ratio_10min, 0, 1);
        // Multiplicative blend: objective value × subjective engagement.
        // Floor at 65% — distraction can reduce perceived value by 35%, not zero it.
        V = V_slow * Math.max(V_fast, 0.65);
    } else {
        V = V_slow;
    }

    // === Impulsiveness: two-speed with max() ===
    // I_slow: daily off-task proportion (Steel, 2007)
    const I_slow = clamp(signals.non_academic_ratio, 0, 1);
    let I: number;
    if (signals.has_sliding_window) {
        // I_fast: rapid app switching in last 5 minutes
        const I_fast = signals.app_switches_5min_normalized;
        // I_idle: time since last academic activity (60+ min idle = 1.0)
        const I_idle = clamp(signals.minutes_since_last_academic / 60, 0, 1);
        // Worst-case wins — either sustained daily pattern, recent burst, or inactivity
        I = Math.max(I_slow, I_fast, I_idle);
    } else {
        I = I_slow;
    }

    // === Delay: two-speed ===
    // D_slow: temporal distance via hyperbolic discounting (Mazur, 1987; Steel, 2007)
    const D_slow = signals.hours_to_deadline <= 0
        ? 0.0   // overdue = no delay, deadline arrived
        : signals.hours_to_deadline / (1 + signals.hours_to_deadline);
    let D: number;
    if (signals.has_time_estimate) {
        // D_progress: progress deficit modifier (Carver & Scheier, 1998).
        // When time_spent_ratio approaches 2.0 (double the estimate),
        // the deadline feels imminent regardless of calendar time.
        // task_time_ratio is time_spent / assigned_time, capped at 2.0.
        const D_progress = clamp(1 - signals.task_time_ratio / 2, 0, 1);
        // Multiplicative: calendar distance × progress factor
        D = D_slow * D_progress;
    } else {
        D = D_slow;
    }

    return { E, V, I, D };
}

/**
 * Build the 7-element TMT context vector.
 *
 * Every element is either a TMT component or a derived TMT quantity.
 * Zero redundancy.
 */
export function buildContextVector(proxies: TMTProxies, signals: RawBehavioralSignals): number[] {
    const { E, V, I, D } = proxies;

    // TMT motivation score: M = (E * V) / (1 + I * D), with compressive scaling
    // Power scaling (M^0.7) expands the lower range where most real-world values
    // land, spreading scores across the full [0,1] range instead of clustering at ~0.1
    const M_raw = clamp((E * V) / (1 + I * D), 0, 1);
    const M_clamped = Math.pow(M_raw, 0.7);

    // Deficit scores: distance from ideal state (no absolute thresholds)
    const deficit_E = 1.0 - E;  // low completion = high expectancy deficit
    const deficit_V = 1.0 - V;  // low value = high value deficit
    const deficit_I = I;         // high impulsiveness = high impulsiveness deficit
    const deficit_D = D;         // high delay = high delay deficit

    // Dominant deficit: argmax (not threshold comparison)
    const deficits = [deficit_E, deficit_V, deficit_I, deficit_D];
    const maxDeficit = Math.max(...deficits);
    const dominantIndex = deficits.indexOf(maxDeficit);
    // Encode as normalized ordinal: 0.0=Expectancy, 0.33=Value, 0.67=Impulsiveness, 1.0=Delay
    const deficit_code = dominantIndex / 3.0;

    const vector = [
        1.0,          // [0] bias
        E,            // [1] expectancy
        V,            // [2] value
        I,            // [3] impulsiveness
        D,            // [4] delay
        M_clamped,    // [5] motivation
        deficit_code, // [6] dominant deficit code
    ];

    const deficitLabels = ['expectancy', 'value', 'impulsiveness', 'delay'];
    console.log(
        '[LinUCB] Context vector features:',
        {
            x0_bias: vector[0],
            x1_expectancy: Number(vector[1].toFixed(4)),
            x2_value: Number(vector[2].toFixed(4)),
            x3_impulsiveness: Number(vector[3].toFixed(4)),
            x4_delay: Number(vector[4].toFixed(4)),
            x5_motivation: Number(vector[5].toFixed(4)),
            x6_deficit_code: Number(vector[6].toFixed(4)),
            dominant_deficit: deficitLabels[dominantIndex],
        },
    );

    console.log('[LinUCB] Two-speed inputs:', {
        E_slow: Number(signals.task_completion_rate.toFixed(4)),
        E_fast_input: Number(signals.non_academic_ratio_10min.toFixed(4)),
        V_slow: Number(Math.max(signals.task_priority, signals.grade_weight).toFixed(4)),
        V_fast_input: Number(signals.non_academic_ratio_10min.toFixed(4)),
        I_slow: Number(signals.non_academic_ratio.toFixed(4)),
        I_fast: Number(signals.app_switches_5min_normalized.toFixed(4)),
        I_idle: Number(clamp(signals.minutes_since_last_academic / 60, 0, 1).toFixed(4)),
        D_slow_input: Number(signals.hours_to_deadline.toFixed(2)),
        D_progress_input: Number(signals.task_time_ratio.toFixed(4)),
        has_sliding_window: signals.has_sliding_window,
        has_time_estimate: signals.has_time_estimate,
    });

    return vector;
}

/**
 * Fetch live context signals from the backend and return the 7-element TMT vector.
 *
 * Pipeline: backend signals → RawBehavioralSignals → TMTProxies → context vector
 */
export async function getContext(): Promise<number[]> {
    try {
        const backend: BackendContextSignals | null = await window.electronAPI.intervention.getContext();
        if (!backend) {
            throw new Error('No context data available');
        }
        const signals = toRawSignals(backend);
        const proxies = computeTMTProxies(signals);
        return buildContextVector(proxies, signals);
    } catch (err) {
        console.error('[ContextBuilder] Failed to build context vector:', err);
        throw err;
    }
}

