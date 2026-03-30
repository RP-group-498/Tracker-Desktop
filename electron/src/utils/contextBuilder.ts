/**
 * TMT Context Builder
 * Fetches live signals from Component 1 and Component 4 via the backend
 * and builds a 9-element TMT-grounded context vector for the LinUCB bandit.
 *
 * Architecture:
 *   Layer 1: Raw behavioral signals (no composites)
 *   Layer 2: TMT proxy mapping (one clean proxy per TMT component)
 *   Layer 3: Context vector construction (9 elements, zero redundancy)
 *
 * Context vector layout (d = 9):
 *   [0] bias           = 1.0 (constant)
 *   [1] expectancy     = TMT E proxy (task_completion_rate)
 *                        Justification: Past task success predicts self-efficacy
 *                        (Bandura, 1977; Klassen et al., 2008)
 *   [2] value          = TMT V proxy (max(task_priority, grade_weight))
 *                        Justification: Task is valuable if it matters for ANY reason.
 *                        max() avoids arbitrary weighting (Wigfield & Eccles, 2000)
 *   [3] impulsiveness  = TMT I proxy (non_academic_ratio)
 *                        Justification: Off-task proportion directly measures impulse
 *                        susceptibility (Steel, 2007). Single signal, no composite.
 *   [4] delay          = TMT D proxy (hours_to_deadline normalized)
 *                        Justification: Hyperbolic normalization matches TMT's delay
 *                        discounting curve (Mazur, 1987; Steel, 2007)
 *   [5] motivation     = TMT score: clamp((E*V) / (1 + I*D), 0, 1)
 *   [6] deficit_code   = dominant TMT deficit (ordinal: 0.0=E / 0.33=V / 0.67=I / 1.0=D)
 *   [7] session_dur    = session duration normalized (0-1, caps at 4h = 240 min)
 *   [8] time_of_day    = current_hour / 24
 */

// Module-level session timer — tracks how long monitoring has been active
let sessionStartTime: number | null = null;

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
    /**
     * non_academic_transitions / (total_transitions + 1).
     * Note: daily total used as proxy for 15-min sliding window
     * (backend does not yet expose windowed activity data).
     */
    non_academic_ratio: number;
    /**
     * total_transitions / 15 — per-minute switch frequency estimate.
     * Note: approximation using daily total; 15 is a normalization constant.
     */
    app_switch_frequency: number;
    /** Minutes elapsed since monitoring session started */
    session_duration_minutes: number;
    /** Current hour of day, 0–23 */
    current_hour: number;
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
 * Initializes the session timer on first call.
 */
function toRawSignals(backend: BackendContextSignals): RawBehavioralSignals {
    // Initialize session timer on first call
    if (sessionStartTime === null) {
        sessionStartTime = Date.now();
        console.log('[ContextBuilder] Session timer started');
    }

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

    return {
        task_completion_rate,
        task_time_ratio,
        task_priority: backend.task_priority,
        grade_weight: backend.grade_weight_normalized,
        hours_to_deadline,
        non_academic_ratio: backend.non_academic_transitions / (backend.total_transitions + 1),
        app_switch_frequency: backend.total_transitions / 15,
        session_duration_minutes: (Date.now() - sessionStartTime!) / 60_000,
        current_hour: new Date().getHours(),
    };
}

/**
 * Compute the four TMT component proxies from raw behavioral signals.
 *
 * Rule: one signal per TMT component — no composite blends.
 * If blending seems necessary, add a new vector element instead.
 */
export function computeTMTProxies(signals: RawBehavioralSignals): TMTProxies {
    // Expectancy proxy: task_completion_rate
    // Justification: Past task success predicts self-efficacy (Bandura, 1977; Klassen et al., 2008)
    const E = clamp(signals.task_completion_rate, 0, 1);

    // Value proxy: max(task_priority, grade_weight)
    // Justification: A task is valuable if it matters for ANY reason.
    // max() avoids arbitrary weighting between two indicators of the same construct
    // (Wigfield & Eccles, 2000). Default 0.3 when no active task.
    const V_raw = Math.max(signals.task_priority, signals.grade_weight);
    const V = V_raw > 0 ? V_raw : 0.3;

    // Impulsiveness proxy: non_academic_ratio
    // Justification: Proportion of off-task time directly measures impulse susceptibility
    // (Steel, 2007). Single signal — app_switch_frequency measures the same construct
    // and blending would reintroduce arbitrary weights.
    const I = clamp(signals.non_academic_ratio, 0, 1);

    // Delay proxy: hyperbolic normalization of hours_to_deadline
    // Justification: Maps to TMT's delay discounting curve (Mazur, 1987; Steel, 2007)
    // D approaches 1.0 for far deadlines, 0.0 for imminent/overdue ones.
    const D = signals.hours_to_deadline <= 0
        ? 0.0   // overdue = no delay, deadline arrived
        : signals.hours_to_deadline / (1 + signals.hours_to_deadline);

    return { E, V, I, D };
}

/**
 * Build the 9-element TMT context vector.
 *
 * Every element is either a TMT component, a derived TMT quantity,
 * or a justified contextual factor. Zero redundancy.
 */
export function buildContextVector(proxies: TMTProxies, signals: RawBehavioralSignals): number[] {
    const { E, V, I, D } = proxies;

    // TMT motivation score: M = (E * V) / (1 + I * D)
    const M_clamped = clamp((E * V) / (1 + I * D), 0, 1);

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

    // Contextual features
    const session_norm = Math.min(signals.session_duration_minutes / 240, 1.0);
    const time_of_day = signals.current_hour / 24.0;

    const vector = [
        1.0,          // [0] bias
        E,            // [1] expectancy
        V,            // [2] value
        I,            // [3] impulsiveness
        D,            // [4] delay
        M_clamped,    // [5] motivation
        deficit_code, // [6] dominant deficit code
        session_norm, // [7] session duration
        time_of_day,  // [8] time of day
    ];

    const deficitLabels = ['expectancy', 'value', 'impulsiveness', 'delay'];
    const f = (n: number) => n.toFixed(3);

    console.log(
        '%c[ContextBuilder] TMT Proxies',
        'font-weight:bold;color:#6366f1',
        `\n  E (expectancy)    = ${f(E)}` +
        `\n  V (value)         = ${f(V)}` +
        `\n  I (impulsiveness) = ${f(I)}` +
        `\n  D (delay)         = ${f(D)}` +
        `\n  M (motivation)    = ${f(M_clamped)}` +
        `\n  Dominant deficit  → ${deficitLabels[dominantIndex].toUpperCase()} (${f(maxDeficit)})`,
    );

    console.log(
        '%c[ContextBuilder] Context Vector (d=9)',
        'font-weight:bold;color:#6366f1',
        `\n  [0] bias          = ${f(vector[0])}` +
        `\n  [1] expectancy    = ${f(vector[1])}` +
        `\n  [2] value         = ${f(vector[2])}` +
        `\n  [3] impulsiveness = ${f(vector[3])}` +
        `\n  [4] delay         = ${f(vector[4])}` +
        `\n  [5] motivation    = ${f(vector[5])}` +
        `\n  [6] deficit_code  = ${f(vector[6])}  (${deficitLabels[dominantIndex]})` +
        `\n  [7] session_dur   = ${f(vector[7])}` +
        `\n  [8] time_of_day   = ${f(vector[8])}`,
    );

    return vector;
}

/**
 * Fetch live context signals from the backend and return the 9-element TMT vector.
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

/**
 * Reset the session timer. Call when monitoring is stopped so that
 * session_duration_minutes resets correctly on next start.
 */
export function resetSessionTimer(): void {
    sessionStartTime = null;
    console.log('[ContextBuilder] Session timer reset');
}
