import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Chart, registerables } from 'chart.js';
import './SmartInterventionPage.css';
import { getContext } from '../../../utils/contextBuilder';
import { useAuth } from '../context/AuthContext';
import { useInterventionContext } from '../context/InterventionContext';

Chart.register(...registerables);

const ACTION_TO_STRATEGY: Record<string, string> = {
    FIVE_SECOND_RULE: '5_second_rule',
    POMODORO: 'pomodoro',
    BREATHING: 'breathing',
    VISUALIZATION: 'visualization',
    REFRAME: 'reframe',
};

const INTERVENTION_COLORS: Record<string, string> = {
    FIVE_SECOND_RULE: '#f59e0b',
    POMODORO: '#ef4444',
    BREATHING: '#10b981',
    VISUALIZATION: '#8b5cf6',
    REFRAME: '#3b82f6',
};

const INTERVENTION_LABELS: Record<string, string> = {
    FIVE_SECOND_RULE: '5-Second Rule',
    POMODORO: 'Pomodoro',
    BREATHING: 'Breathing',
    VISUALIZATION: 'Visualization',
    REFRAME: 'Reframe',
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
    const { user } = useAuth();
    const userId = user?.id ?? '';
    const {
        monitorEnabled, monitorStatus, toggleMonitor,
        lastInterventionTs,
    } = useInterventionContext();

    const [suggestStatus, setSuggestStatus] = useState('');
    const [suggestDisabled, setSuggestDisabled] = useState(false);
    const [lifeGoal, setLifeGoal] = useState('');
    const [filterSeconds, setFilterSeconds] = useState(3600);

    const chartCanvasRef = useRef<HTMLCanvasElement>(null);
    const chartInstanceRef = useRef<Chart | null>(null);

    // ── API helpers ───────────────────────────────────────────────────────

    const logMotivation = useCallback(async (vector: number[], scenario: string = 'live') => {
        try {
            await window.electronAPI.intervention.logMotivation({
                user_id: userId,
                motivation: vector[6],
                scenario,
            });
        } catch (e) {
            console.warn('[Motivation] Log failed:', e);
        }
    }, [userId]);

    const fetchAndRenderChart = useCallback(async (seconds: number) => {
        try {
            const data = (await window.electronAPI.intervention.getMotivationHistory(
                userId,
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
            const pointColors = data.map(d =>
                d.scenario !== 'live' ? (INTERVENTION_COLORS[d.scenario] ?? '#667eea') : 'transparent'
            );
            const pointRadii = data.map(d => d.scenario !== 'live' ? 6 : 0);
            const pointHoverRadii = data.map(d => d.scenario !== 'live' ? 8 : 4);

            if (chartInstanceRef.current) {
                const chart = chartInstanceRef.current;
                chart.data.labels = labels;
                chart.data.datasets[0].data = values;
                (chart.data.datasets[0] as any).pointBackgroundColor = pointColors;
                (chart.data.datasets[0] as any).pointBorderColor = pointColors;
                (chart.data.datasets[0] as any).pointRadius = pointRadii;
                (chart.data.datasets[0] as any).pointHoverRadius = pointHoverRadii;
                (chart.options.plugins!.tooltip as any).callbacks.label = (ctx: any) => {
                    const d = data[ctx.dataIndex];
                    if (d.scenario === 'live') return `Motivation: ${d.motivation.toFixed(3)}`;
                    const label = INTERVENTION_LABELS[d.scenario] ?? d.scenario;
                    return `Motivation: ${d.motivation.toFixed(3)}  ▸ ${label}`;
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
                        pointRadius: pointRadii,
                        pointHoverRadius: pointHoverRadii,
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                    } as any],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'nearest',
                        intersect: false,
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx: any) => {
                                    const d = data[ctx.dataIndex];
                                    if (d.scenario === 'live') return `Motivation: ${d.motivation.toFixed(3)}`;
                                    const label = INTERVENTION_LABELS[d.scenario] ?? d.scenario;
                                    return `Motivation: ${d.motivation.toFixed(3)}  ▸ ${label}`;
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
    }, [userId]);

    // ── Suggest handler ───────────────────────────────────────────────────

    const handleSuggest = useCallback(async () => {
        setSuggestDisabled(true);
        setSuggestStatus('Fetching context...');
        try {
            const vector = await getContext(userId);
            await logMotivation(vector);

            setSuggestStatus('Asking the model...');
            const result = await window.electronAPI.intervention.banditSelect({
                user_id: userId,
                x: vector,
                alpha: 1.0,
            });
            const { action, allowed_actions } = result as { action: string; allowed_actions: string[] };
            setSuggestStatus(`Model chose: ${action} (from ${allowed_actions.join(', ')})`);

            await logMotivation(vector, action);
            fetchAndRenderChart(filterSeconds);

            // Trigger notification
            const strategy = ACTION_TO_STRATEGY[action];
            let title = action;
            let body = '';

            if (action === 'REFRAME') {
                let goal = 'your goals';
                try {
                    const data = await window.electronAPI.intervention.getUserGoal();
                    if ((data as any)?.life_goal) goal = (data as any).life_goal;
                } catch (e) {
                    console.warn('Could not fetch life goal:', e);
                }
                title = 'Reframe Your Perspective';
                body = `I choose to do this because it helps me ${goal}.`;
            } else {
                const notif: Record<string, { title: string; body: string }> = {
                    FIVE_SECOND_RULE: { title: '5-Second Rule', body: 'Count down 5-4-3-2-1 and move!' },
                    POMODORO: { title: 'Pomodoro Session', body: 'Ready to focus for 25 minutes?' },
                    BREATHING: { title: 'Time for a Breath', body: 'Take a moment to calm your mind.' },
                    VISUALIZATION: { title: 'Visualize Completion', body: 'Close your eyes and imagine finishing this task.' },
                };
                if (notif[action]) {
                    title = notif[action].title;
                    body = notif[action].body;
                }
            }

            window.electronAPI.intervention.notifyActions({ title, body, strategy });
        } catch (err: any) {
            setSuggestStatus(`Error: ${err?.message ?? 'unknown error'}`);
        } finally {
            setSuggestDisabled(false);
        }
    }, [logMotivation, fetchAndRenderChart, filterSeconds, userId]);

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

    // ── Mount: load goal + initial log + chart ────────────────────────────

    useEffect(() => {
        window.electronAPI.intervention.getUserGoal()
            .then(data => { if ((data as any)?.life_goal) setLifeGoal((data as any).life_goal); })
            .catch(() => { });

        getContext(userId)
            .then(vector => logMotivation(vector))
            .then(() => fetchAndRenderChart(filterSeconds))
            .catch(() => fetchAndRenderChart(filterSeconds));
    }, []);  // eslint-disable-line react-hooks/exhaustive-deps

    // ── Refresh chart when context signals an intervention happened ─────

    useEffect(() => {
        if (lastInterventionTs > 0) {
            fetchAndRenderChart(filterSeconds);
        }
    }, [lastInterventionTs, fetchAndRenderChart, filterSeconds]);

    // ── Auto-refresh chart every 30 seconds ───────────────────────────────

    useEffect(() => {
        const intervalId = setInterval(() => {
            fetchAndRenderChart(filterSeconds);
        }, 30_000);
        return () => clearInterval(intervalId);
    }, [filterSeconds, fetchAndRenderChart]);

    // ── Cleanup chart on unmount ──────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null; }
        };
    }, []);

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
                <p className="text-xs text-gray-500 mb-3">Context is built from live behavioral and task data</p>

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

            {/* Auto-Monitor — Trigger & Cooldown */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                        <h3 className="text-sm font-semibold text-gray-800" style={{ margin: 0 }}>Auto-Monitor</h3>
                        <p className="text-xs text-gray-500" style={{ margin: 0 }}>
                            Checks every 60s and triggers interventions automatically
                        </p>
                    </div>
                    <button
                        className={`sie-monitor-toggle ${monitorEnabled ? 'active' : ''}`}
                        onClick={toggleMonitor}
                    >
                        {monitorEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                <div className="sie-monitor-status">
                    <span className={`sie-monitor-dot ${monitorEnabled ? 'active' : ''}`} />
                    <span className="text-xs text-gray-500">{monitorStatus}</span>
                </div>
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
                    {Object.entries(INTERVENTION_COLORS).map(([key, color]) => (
                        <span key={key}>
                            <span className="sie-legend-dot" style={{ background: color }} />
                            {INTERVENTION_LABELS[key]}
                        </span>
                    ))}
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
        </div>
    );
};

export default SmartInterventionPage;
