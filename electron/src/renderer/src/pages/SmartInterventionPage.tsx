import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Chart, registerables } from 'chart.js';
import './SmartInterventionPage.css';
import {
    ScenarioKey,
    SCENARIOS,
    getMockContext,
    setScenario,
    getCurrentScenario,
    getScenarioInfo,
} from '../../../utils/mockContext';

Chart.register(...registerables);

const BANDIT_USER_ID = 'u123';

const ACTION_TO_STRATEGY: Record<string, string> = {
    FIVE_SECOND_RULE: '5_second_rule',
    POMODORO: 'pomodoro',
    BREATHING: 'breathing',
    VISUALIZATION: 'visualization',
    REFRAME: 'reframe',
};

const ACTION_NOTIFICATIONS: Record<string, { title: string; body: string | null }> = {
    FIVE_SECOND_RULE: { title: '5-Second Rule', body: 'Count down 5-4-3-2-1 and move!' },
    POMODORO: { title: 'Pomodoro Session', body: 'Ready to focus for 25 minutes?' },
    BREATHING: { title: 'Time for a Breath', body: 'Take a moment to calm your mind.' },
    VISUALIZATION: { title: 'Visualize Completion', body: 'Close your eyes and imagine finishing this task.' },
    REFRAME: { title: 'Reframe Your Perspective', body: null },
};

const SCENARIO_POINT_COLORS: Record<string, string> = {
    A: '#4ade80',
    B: '#fb923c',
    C: '#f87171',
};

const TIME_FILTERS = [
    { label: '1h', seconds: 3600 },
    { label: '3h', seconds: 10800 },
    { label: '6h', seconds: 21600 },
    { label: '1d', seconds: 86400 },
    { label: '3d', seconds: 259200 },
    { label: '1w', seconds: 604800 },
    { label: '1mo', seconds: 2592000 },
    { label: '3mo', seconds: 7776000 },
];

// ─── Breathing Modal ──────────────────────────────────────────────────────────

const BREATHING_STATES = [
    { text: 'Breathe In', instruction: 'Slowly inhale through your nose', duration: 4000 },
    { text: 'Hold', instruction: 'Hold your breath', duration: 2000 },
    { text: 'Breathe Out', instruction: 'Slowly exhale through your mouth', duration: 4000 },
    { text: 'Hold', instruction: 'Hold your breath', duration: 2000 },
];

const BreathingModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [breathText, setBreathText] = useState('Breathe In');
    const [breathInstruction, setBreathInstruction] = useState('Slowly inhale through your nose');
    const [cycleLabel, setCycleLabel] = useState('Cycle 1 of 3');
    const [done, setDone] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const stateRef = useRef(0);
    const cycleRef = useRef(0);
    const TOTAL_CYCLES = 3;

    const step = useCallback(() => {
        const state = BREATHING_STATES[stateRef.current];
        setBreathText(state.text);
        setBreathInstruction(state.instruction);
        stateRef.current++;
        if (stateRef.current >= BREATHING_STATES.length) {
            stateRef.current = 0;
            cycleRef.current++;
            if (cycleRef.current >= TOTAL_CYCLES) {
                setCycleLabel('Complete!');
                setDone(true);
                return;
            }
            setCycleLabel(`Cycle ${cycleRef.current + 1} of ${TOTAL_CYCLES}`);
        }
        timerRef.current = setTimeout(step, BREATHING_STATES[stateRef.current].duration);
    }, []);

    useEffect(() => {
        timerRef.current = setTimeout(step, BREATHING_STATES[0].duration);
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [step]);

    return (
        <div className="sie-breathing-modal">
            <div className="sie-breathing-container">
                <div className="sie-breathing-circle" />
                <div className="sie-breathing-text">{breathText}</div>
                <div className="sie-breathing-instruction">{breathInstruction}</div>
                <div className="sie-breathing-counter">{cycleLabel}</div>
                <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
                    {!done && (
                        <button className="sie-modal-btn" onClick={onClose}>Cancel</button>
                    )}
                    {done && (
                        <button className="sie-modal-btn" onClick={onClose}>Complete</button>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Visualization Modal ──────────────────────────────────────────────────────

const VisualizationModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [timeLeft, setTimeLeft] = useState(30);
    const [vizText, setVizText] = useState('Focus');
    const [vizInstruction, setVizInstruction] = useState('Imagine the exact steps to finish your task.');
    const [done, setDone] = useState(false);
    const particleContainerRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Generate particles
        if (particleContainerRef.current) {
            for (let i = 0; i < 50; i++) {
                const p = document.createElement('div');
                p.className = 'sie-viz-particle';
                p.style.left = Math.random() * 100 + '%';
                p.style.top = Math.random() * 100 + '%';
                const size = (Math.random() * 3 + 1) + 'px';
                p.style.width = size;
                p.style.height = size;
                p.style.animationDelay = (Math.random() * 5) + 's';
                particleContainerRef.current.appendChild(p);
            }
        }
    }, []);

    useEffect(() => {
        if (done) return;
        timerRef.current = setTimeout(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    setVizText('Well Done');
                    setVizInstruction('Hold onto that feeling of relief and satisfaction.');
                    setDone(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [timeLeft, done]);

    return (
        <div className="sie-viz-modal">
            <div className="sie-viz-background" ref={particleContainerRef} />
            <div className="sie-viz-container">
                <div className="sie-viz-portal">
                    <div className="sie-viz-text">{vizText}</div>
                </div>
                <div className="sie-viz-instruction">{vizInstruction}</div>
                <div className="sie-viz-counter">
                    {done ? 'Visualization Complete' : `${timeLeft}s remaining`}
                </div>
                <div className="sie-viz-actions">
                    {!done && <button className="sie-modal-btn" onClick={onClose}>Cancel</button>}
                    {done && <button className="sie-modal-btn" onClick={onClose}>Complete</button>}
                </div>
            </div>
        </div>
    );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

function formatTick(ts: number, sinceSeconds: number): string {
    const d = new Date(ts * 1000);
    if (sinceSeconds <= 21600) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return (
        d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
}

const SmartInterventionPage: React.FC = () => {
    const [scenario, setScenarioState] = useState<ScenarioKey>(getCurrentScenario());
    const [scenarioDesc, setScenarioDesc] = useState(getScenarioInfo().description);
    const [suggestStatus, setSuggestStatus] = useState('');
    const [suggestDisabled, setSuggestDisabled] = useState(false);
    const [lifeGoal, setLifeGoal] = useState('');
    const [filterSeconds, setFilterSeconds] = useState(3600);
    const [showBreathing, setShowBreathing] = useState(false);
    const [showVisualization, setShowVisualization] = useState(false);

    const chartCanvasRef = useRef<HTMLCanvasElement>(null);
    const chartInstanceRef = useRef<Chart | null>(null);
    const pendingBanditRef = useRef<{ action: string; vector: number[] } | null>(null);

    // Pomodoro / 5-second timer refs
    const pomodoroIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const breakIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const fiveSecIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // ── API helpers ───────────────────────────────────────────────────────

    const logMotivation = useCallback(async (vector: number[], sc: ScenarioKey) => {
        try {
            await window.electronAPI.intervention.logMotivation({
                user_id: BANDIT_USER_ID,
                motivation: vector[6],
                scenario: sc,
            });
        } catch (e) {
            console.warn('[Motivation] Log failed:', e);
        }
    }, []);

    const fetchAndRenderChart = useCallback(async (seconds: number) => {
        try {
            const data = (await window.electronAPI.intervention.getMotivationHistory(
                BANDIT_USER_ID,
                seconds,
            )) as Array<{ motivation: number; scenario: string; timestamp: number }>;

            const canvas = chartCanvasRef.current;
            if (!canvas) return;

            if (!data || data.length === 0) {
                if (chartInstanceRef.current) {
                    chartInstanceRef.current.destroy();
                    chartInstanceRef.current = null;
                }
                return;
            }

            const labels = data.map(d => formatTick(d.timestamp, seconds));
            const values = data.map(d => d.motivation);
            const pointColors = data.map(d => SCENARIO_POINT_COLORS[d.scenario] ?? '#667eea');

            if (chartInstanceRef.current) {
                const chart = chartInstanceRef.current;
                chart.data.labels = labels;
                chart.data.datasets[0].data = values;
                (chart.data.datasets[0] as any).pointBackgroundColor = pointColors;
                (chart.data.datasets[0] as any).pointBorderColor = pointColors;
                (chart.options.plugins!.tooltip as any).callbacks.label = (ctx: any) => {
                    const d = data[ctx.dataIndex];
                    return `Motivation: ${d.motivation.toFixed(3)}   Scenario ${d.scenario}`;
                };
                chart.update();
                return;
            }

            chartInstanceRef.current = new Chart(canvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Motivation',
                        data: values,
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.07)',
                        pointBackgroundColor: pointColors,
                        pointBorderColor: pointColors,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                    } as any],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx: any) => {
                                    const d = data[ctx.dataIndex];
                                    return `Motivation: ${d.motivation.toFixed(3)}   Scenario ${d.scenario}`;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(0,0,0,0.04)' },
                            ticks: { color: '#9ca3af', font: { size: 11 }, maxTicksLimit: 8 },
                        },
                        y: {
                            min: 0,
                            max: 1,
                            grid: { color: 'rgba(0,0,0,0.04)' },
                            ticks: {
                                color: '#9ca3af',
                                font: { size: 11 },
                                stepSize: 0.25,
                                callback: (v: any) => Number(v).toFixed(2),
                            },
                        },
                    },
                },
            });
        } catch (e) {
            console.warn('[Motivation] Chart refresh failed:', e);
        }
    }, []);

    // ── Timer helpers ─────────────────────────────────────────────────────

    const startFiveSecondCountdown = useCallback(() => {
        let timeLeft = 5;
        window.electronAPI.intervention.updateTrayTimer(`Go in ${timeLeft}...`);

        fiveSecIntervalRef.current = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                window.electronAPI.intervention.updateTrayTimer(`Go in ${timeLeft}...`);
            } else {
                clearInterval(fiveSecIntervalRef.current!);
                window.electronAPI.intervention.updateTrayTimer("Let's Go!");
                setTimeout(() => window.electronAPI.intervention.clearTray(), 3000);
            }
        }, 1000);
    }, []);

    const startBreakTimer = useCallback(() => {
        let timeLeft = 5 * 60;
        const update = () => {
            const m = Math.floor(timeLeft / 60);
            const s = timeLeft % 60;
            window.electronAPI.intervention.updateTrayTimer(`Break: ${m}:${s.toString().padStart(2, '0')}`);
        };
        update();
        breakIntervalRef.current = setInterval(() => {
            timeLeft--;
            update();
            if (timeLeft <= 0) {
                clearInterval(breakIntervalRef.current!);
                window.electronAPI.intervention.clearTray();
            }
        }, 1000);
    }, []);

    const startPomodoroTimer = useCallback(() => {
        let timeLeft = 25 * 60;
        const update = () => {
            const m = Math.floor(timeLeft / 60);
            const s = timeLeft % 60;
            window.electronAPI.intervention.updateTrayTimer(`${m}:${s.toString().padStart(2, '0')}`);
        };
        update();
        pomodoroIntervalRef.current = setInterval(() => {
            timeLeft--;
            update();
            if (timeLeft <= 0) {
                clearInterval(pomodoroIntervalRef.current!);
                window.electronAPI.intervention.clearTray();
                startBreakTimer();
            }
        }, 1000);
    }, [startBreakTimer]);

    // ── Bandit helpers ────────────────────────────────────────────────────

    const computeReward = (button: string): number => {
        if (button === 'start') return 1.0;
        if (button === 'not_now' || button === 'reject') return 0.4;
        return 0.2;
    };

    const sendBanditUpdate = useCallback(async (
        action: string,
        vector: number[],
        reward: number,
        button: string,
    ) => {
        try {
            const data = await window.electronAPI.intervention.banditUpdate({
                user_id: BANDIT_USER_ID,
                x: vector,
                action,
                reward,
                button,
                alpha: 1.0,
            });
            console.log(`[Bandit] Updated — action=${action} reward=${reward} n_updates=${(data as any)?.n_updates}`);
        } catch (err) {
            console.warn('[Bandit] Update error:', err);
        }
    }, []);

    const triggerBanditNotification = useCallback(async (action: string, vector: number[]) => {
        const strategy = ACTION_TO_STRATEGY[action];
        let { title, body } = ACTION_NOTIFICATIONS[action];

        if (action === 'REFRAME') {
            let goal = 'your goals';
            try {
                const data = await window.electronAPI.intervention.getUserGoal();
                if ((data as any)?.life_goal) goal = (data as any).life_goal;
            } catch (e) {
                console.warn('[Bandit] Could not fetch life goal for reframe:', e);
            }
            body = `I choose to do this because it helps me ${goal}.`;
        }

        pendingBanditRef.current = { action, vector };
        window.electronAPI.intervention.notifyActions({ title, body: body ?? '', strategy });
    }, []);

    const handleSuggest = useCallback(async () => {
        setSuggestDisabled(true);
        setSuggestStatus('Asking the model...');
        try {
            const vector = getMockContext(BANDIT_USER_ID);
            const sc = getCurrentScenario();

            // Log the motivation & refresh chart immediately
            await logMotivation(vector, sc);
            fetchAndRenderChart(filterSeconds);

            const result = await window.electronAPI.intervention.banditSelect({
                user_id: BANDIT_USER_ID,
                x: vector,
                alpha: 1.0,
            });
            const { action, allowed_actions } = result as { action: string; allowed_actions: string[] };
            setSuggestStatus(`[${sc}] Model chose: ${action} (from ${allowed_actions.join(', ')})`);
            await triggerBanditNotification(action, vector);
        } catch (err: any) {
            setSuggestStatus(`Error: ${err?.message ?? 'unknown error'}`);
        } finally {
            setSuggestDisabled(false);
        }
    }, [triggerBanditNotification, logMotivation, fetchAndRenderChart, filterSeconds]);

    // ── Demo button handlers ──────────────────────────────────────────────

    const handleDemoBtn = useCallback(async (intervention: string) => {
        if (intervention === 'pomodoro') {
            window.electronAPI.intervention.notifyActions({
                title: 'Pomodoro Session',
                body: 'Ready to focus for 25 minutes?',
                strategy: 'pomodoro',
            });
        } else if (intervention === '5_second_rule') {
            window.electronAPI.intervention.notifyActions({
                title: '5-Second Rule',
                body: 'Count down 5-4-3-2-1 and move!',
                strategy: '5_second_rule',
            });
        } else if (intervention === 'breathing') {
            window.electronAPI.intervention.notifyActions({
                title: 'Time for a Breath',
                body: 'Take a moment to calm your mind.',
                strategy: 'breathing',
            });
        } else if (intervention === 'visualization') {
            window.electronAPI.intervention.notifyActions({
                title: 'Visualize Completion',
                body: 'Close your eyes and imagine finishing this task.',
                strategy: 'visualization',
            });
        } else if (intervention === 'reframe') {
            let goal = 'your goals';
            try {
                const data = await window.electronAPI.intervention.getUserGoal();
                if ((data as any)?.life_goal) goal = (data as any).life_goal;
            } catch (e) {
                console.warn('Could not fetch life goal:', e);
            }
            window.electronAPI.intervention.notifyActions({
                title: 'Reframe Your Perspective',
                body: `I choose to do this because it helps me ${goal}.`,
                strategy: 'reframe',
            });
        }
    }, []);

    // ── Notification response handler ─────────────────────────────────────

    useEffect(() => {
        window.electronAPI.intervention.onNotificationResponse(async ({ strategy, action }) => {
            const logAction = action === 'reject' ? 'not_now' : action;

            if (pendingBanditRef.current && ACTION_TO_STRATEGY[pendingBanditRef.current.action] === strategy) {
                const reward = computeReward(logAction);
                await sendBanditUpdate(
                    pendingBanditRef.current.action,
                    pendingBanditRef.current.vector,
                    reward,
                    logAction,
                );
                pendingBanditRef.current = null;
                fetchAndRenderChart(filterSeconds);
            }

            if (strategy === 'pomodoro' && action === 'start') {
                startPomodoroTimer();
            } else if (strategy === '5_second_rule' && action === 'start') {
                startFiveSecondCountdown();
            } else if (strategy === 'breathing' && action === 'start') {
                window.electronAPI.intervention.showWindow();
                setShowBreathing(true);
            } else if (strategy === 'visualization' && action === 'start') {
                window.electronAPI.intervention.showWindow();
                setShowVisualization(true);
            }
        });
    }, [sendBanditUpdate, fetchAndRenderChart, filterSeconds, startPomodoroTimer, startFiveSecondCountdown]);

    // ── Mount: load goal + initial log + chart ────────────────────────────

    useEffect(() => {
        window.electronAPI.intervention.getUserGoal()
            .then(data => { if ((data as any)?.life_goal) setLifeGoal((data as any).life_goal); })
            .catch(() => { });

        const vector = getMockContext(BANDIT_USER_ID);
        logMotivation(vector, getCurrentScenario()).then(() => fetchAndRenderChart(filterSeconds));
    }, []);  // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-refresh chart every 30 seconds ───────────────────────────────

    useEffect(() => {
        const intervalId = setInterval(() => {
            fetchAndRenderChart(filterSeconds);
        }, 30_000);

        return () => clearInterval(intervalId);
    }, [filterSeconds, fetchAndRenderChart]);

    // ── Cleanup timers on unmount ─────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (pomodoroIntervalRef.current) clearInterval(pomodoroIntervalRef.current);
            if (breakIntervalRef.current) clearInterval(breakIntervalRef.current);
            if (fiveSecIntervalRef.current) clearInterval(fiveSecIntervalRef.current);
            if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null; }
        };
    }, []);

    // ── Scenario change ───────────────────────────────────────────────────

    const handleScenarioChange = async (sc: ScenarioKey) => {
        setScenario(sc);
        setScenarioState(sc);
        setScenarioDesc(getScenarioInfo().description);
        const vector = getMockContext(BANDIT_USER_ID);
        await logMotivation(vector, sc);
        fetchAndRenderChart(filterSeconds);
    };

    // ── Filter change ─────────────────────────────────────────────────────

    const handleFilterChange = (seconds: number) => {
        setFilterSeconds(seconds);
        fetchAndRenderChart(seconds);
    };

    // ── Save goal ─────────────────────────────────────────────────────────

    const handleSaveGoal = async () => {
        try {
            await window.electronAPI.intervention.saveUserGoal(lifeGoal);
            console.log('Goal saved');
        } catch (e) {
            console.error('Error saving goal:', e);
        }
    };

    return (
        <div className="sie-page p-4 space-y-4">
            {/* Demo buttons */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Try the Interventions</h3>
                <p className="text-xs text-gray-500 mb-3">Click any button to trigger an OS notification</p>
                <div className="sie-demo-buttons">
                    {[
                        { id: '5_second_rule', label: '5-Second Rule' },
                        { id: 'pomodoro', label: 'Pomodoro' },
                        { id: 'breathing', label: 'Breathing' },
                        { id: 'visualization', label: 'Visualization' },
                        { id: 'reframe', label: 'Reframe' },
                    ].map(btn => (
                        <button
                            key={btn.id}
                            className="sie-demo-btn"
                            onClick={() => handleDemoBtn(btn.id)}
                        >
                            <span>{btn.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Smart Intervention — LinUCB */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Smart Intervention — LinUCB</h3>
                <p className="text-xs text-gray-500 mb-3">Select a scenario to simulate a user state</p>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="block text-xs text-gray-500 mb-1">Context Scenario</label>
                        <select
                            className="sie-scenario-select"
                            value={scenario}
                            onChange={e => handleScenarioChange(e.target.value as ScenarioKey)}
                        >
                            {(Object.keys(SCENARIOS) as ScenarioKey[]).map(key => (
                                <option key={key} value={key}>{SCENARIOS[key].label}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ flex: 2, minWidth: 180 }}>
                        <label className="block text-xs text-gray-500 mb-1">Description</label>
                        <p className="text-xs text-gray-600" style={{ paddingTop: 10 }}>{scenarioDesc}</p>
                    </div>
                </div>

                <button
                    className="sie-intervention-btn"
                    disabled={suggestDisabled}
                    onClick={handleSuggest}
                >
                    Suggest Best Intervention
                </button>
                {suggestStatus && (
                    <p className="text-xs text-gray-400 text-center mt-1">{suggestStatus}</p>
                )}
            </div>

            {/* Motivation Over Time */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Motivation Over Time</h3>
                <p className="text-xs text-gray-500">Computed motivation score per context event</p>

                <div className="sie-time-filter-bar">
                    {TIME_FILTERS.map(f => (
                        <button
                            key={f.seconds}
                            className={`sie-time-filter-btn${filterSeconds === f.seconds ? ' active' : ''}`}
                            onClick={() => handleFilterChange(f.seconds)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                <div className="sie-chart-container">
                    <canvas ref={chartCanvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
                </div>

                <div className="sie-legend">
                    <span><span className="sie-legend-dot" style={{ background: '#4ade80' }} />Scenario A</span>
                    <span><span className="sie-legend-dot" style={{ background: '#fb923c' }} />Scenario B</span>
                    <span><span className="sie-legend-dot" style={{ background: '#f87171' }} />Scenario C</span>
                </div>
            </div>

            {/* Personalize */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Personalize</h3>
                <p className="text-xs text-gray-500">Set your life goal to personalize reframing</p>
                <div className="sie-goal-row">
                    <input
                        type="text"
                        className="sie-goal-input"
                        placeholder="e.g. Become a Doctor"
                        value={lifeGoal}
                        onChange={e => setLifeGoal(e.target.value)}
                    />
                    <button className="sie-save-btn" onClick={handleSaveGoal}>Save</button>
                </div>
            </div>

            {/* Modals */}
            {showBreathing && <BreathingModal onClose={() => setShowBreathing(false)} />}
            {showVisualization && <VisualizationModal onClose={() => setShowVisualization(false)} />}
        </div>
    );
};

export default SmartInterventionPage;
