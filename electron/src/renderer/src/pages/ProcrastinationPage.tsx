// /electron/src/renderer/src/pages/ProcrastinationPage.tsx

import React, { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import '../styles/ProcrastinationPage.css';

Chart.register(...registerables);

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface CalibrationDay {
  date: string;
  day: string;
  status: string;
  activeStart: string | null;
  activeEnd: string | null;
  academicMinutes: number;
  nonAcademicMinutes: number;
  fullDayAcademicMinutes: number;
  fullDayNonAcademicMinutes: number;
  fullDayTotalAppSwitches: number;
  expectedStudyMinutes: number;
}

interface PatternResult {
  type: string;
  severity: string;
  evidence: string;
  exit_strategy?: string;
}

interface ActiveTimeInfo {
  activeStart: string | null;
  activeEnd: string | null;
  academicMinutes: number;
  nonAcademicMinutes: number;
  appSwitches: number;
  expectedStudyMinutes: number;
  status: string;
  day: string;
  fullDayAcademicMinutes: number;
  fullDayNonAcademicMinutes: number;
  fullDayProductivityMinutes: number;
  fullDayAcademicAppSwitches: number;
  fullDayNonAcademicAppSwitches: number;
  fullDayProductivityAppSwitches: number;
  fullDayTotalAppSwitches: number;
}

interface PredictionInfo {
  date: string;
  day: string;
  predictedActiveStart: string;
  predictedActiveEnd: string;
  predictedAcademicMinutes: number;
  nextDayProcrastinationRisk?: number;
}

interface Report {
  date: string;
  score: number;
  level: string;
  dominantPattern: string | null;
  patterns: PatternResult[];
  activeTime: ActiveTimeInfo;
  prediction: PredictionInfo | null;
  confidence?: number;
  focusProbability?: number;
}

interface AnomalyAlert {
  date: string;
  anomalyScore: number;
  score: number;
  dominantPattern: string | null;
  features?: Record<string, number>;
}

interface DeadlineItem {
  task_name: string;
  deadline: string;
  days_left: number;
  hours_left: number;
  day_label: string;
  priority: string;
}

interface HistoryDay {
  date: string;
  score: number;
  fullDayAcademicMinutes?: number;
  academicMinutes?: number;
  fullDayNonAcademicMinutes?: number;
  nonAcademicMinutes?: number;
  fullDayTotalAppSwitches?: number;
  expectedStudyMinutes?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColorClass(score: number): string {
  if (score < 3) return 'color-red';
  if (score < 6) return 'color-orange';
  if (score < 8) return 'color-yellow';
  return 'color-green';
}

function efficiencyClass(pct: number): string {
  if (pct >= 70) return 'efficiency-good';
  if (pct >= 40) return 'efficiency-medium';
  return 'efficiency-low';
}

function patternLabel(type: string): string {
  switch (type) {
    case 'frequent_task_switching': return 'Frequent Task Switching';
    case 'prolonged_inactivity':    return 'Prolonged Inactivity';
    case 'impulsive_browsing':      return 'Impulsive Browsing';
    case 'deadline_rushing':        return 'Deadline Rushing';
    case 'no_engagement':           return 'No Engagement';
    default: return type.replace(/_/g, ' ');
  }
}

function getAnomalyContext(a: AnomalyAlert): {
  label: string;
  explanation: string;
  type: 'high' | 'low' | 'unusual';
} {
  const score = a.score ?? 0;
  const pattern = a.dominantPattern;
  const f = a.features ?? {};

  if (pattern === 'no_procrastination' && score < 3) {
    return {
      label: 'Unusually Productive',
      explanation: `Your score (${score.toFixed(1)}/10) was well below your typical range — an unusually focused day that stood out statistically.`,
      type: 'low',
    };
  }

  if (pattern === 'no_procrastination' && score >= 3) {
    const highSwitch = (f['switch_rate'] ?? 0) > 0.5;
    const highIdle   = (f['idle_ratio']  ?? 0) > 0.4;
    const subLabel   = highSwitch ? 'High App-Switching'
                     : highIdle   ? 'Prolonged Inactivity'
                     : 'Atypical Behavior Pattern';
    return {
      label: subLabel,
      explanation: `Your score was ${score.toFixed(1)}/10 and your overall activity mix was statistically unusual — even though no single procrastination pattern dominated.`,
      type: 'unusual',
    };
  }

  const label = patternLabel(pattern ?? '');
  const scoreDesc = score >= 6 ? 'significantly above' : score >= 4 ? 'above' : 'near';
  return {
    label,
    explanation: `Your ${label.toLowerCase()} behavior was ${scoreDesc} your personal baseline on this day (score ${score.toFixed(1)}/10).`,
    type: score >= 5 ? 'high' : 'unusual',
  };
}

function severityClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'low':      return 'badge-low';
    case 'medium':   return 'badge-medium';
    case 'warning':  return 'badge-warning';
    case 'high':     return 'badge-high';
    case 'critical': return 'badge-critical';
    default:         return 'badge-default';
  }
}

function goalBarClass(pct: number): string {
  if (pct < 40) return 'goal-bar-red';
  if (pct < 70) return 'goal-bar-orange';
  return 'goal-bar-green';
}

function deadlineBadgeClass(daysLeft: number): string {
  if (daysLeft === 0) return 'badge-critical';
  if (daysLeft <= 2)  return 'badge-high';
  if (daysLeft <= 5)  return 'badge-warning';
  return 'badge-medium';
}

// ── Component ──────────────────────────────────────────────────────────────────

const PERIODS = ['1d', '3d', '5d', '7d', '14d'] as const;
type Period = typeof PERIODS[number];

const PERIOD_DAYS: Record<Period, number> = {
  '1d': 1, '3d': 3, '5d': 5, '7d': 7, '14d': 14,
};

const ProcrastinationPage: React.FC = () => {
  const [report,           setReport]           = useState<Report | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState<string | null>(null);
  const [anomalies,        setAnomalies]        = useState<AnomalyAlert[]>([]);
  const [deadlines,        setDeadlines]        = useState<DeadlineItem[]>([]);
  const [selectedPeriod,   setSelectedPeriod]   = useState<Period>('7d');
  const [chartHistory,     setChartHistory]     = useState<HistoryDay[]>([]);
  const [calibrationDays,  setCalibrationDays]  = useState<CalibrationDay[]>([]);
  const [phase,            setPhase]            = useState<'loading' | 'early' | 'calibration' | 'active'>('loading');

  const chartCanvasRef   = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const history = await (window as any).electronAPI.getCalibrationHistory(90) as CalibrationDay[];
        const validDays = (history ?? []).filter((d: CalibrationDay) => d.status !== 'no_logs');
        setCalibrationDays(history ?? []);
        if (validDays.length === 0) {
          setPhase('early');
          setLoading(false);
          return;
        }
        // Phase is based on days since FIRST recorded day, not count of recent days
        const sorted = [...validDays].sort((a, b) => a.date.localeCompare(b.date));
        const firstDate = new Date(sorted[0].date + 'T00:00:00Z');
        const todayUtc = new Date();
        todayUtc.setUTCHours(0, 0, 0, 0);
        const daysSinceStart = Math.floor((todayUtc.getTime() - firstDate.getTime()) / 86400000);
        if (daysSinceStart < 7) {
          setPhase('early');
          setLoading(false);
        } else if (daysSinceStart < 14) {
          setPhase('calibration');
          setLoading(false);
        } else {
          setPhase('active');
          loadReport();
        }
      } catch {
        setPhase('active');
        loadReport();
      }
    }
    init();
  }, []);

  // Load secondary data after report is ready
  useEffect(() => {
    if (!report) return;
    loadSecondaryData();
  }, [report]);

  // Rebuild chart when period or history changes
  useEffect(() => {
    buildChart();
    return () => {
      chartInstanceRef.current?.destroy();
      chartInstanceRef.current = null;
    };
  }, [selectedPeriod, chartHistory]);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const data = await (window as any).electronAPI.getProcrastinationReport() as Report;
      setReport(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load report. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  async function loadSecondaryData() {
    try {
      const [anomalyData, deadlineData, historyData] = await Promise.all([
        (window as any).electronAPI.getAnomalies(30).catch(() => null),
        (window as any).electronAPI.getDeadlines().catch(() => null),
        (window as any).electronAPI.getProcrastinationHistory(14).catch(() => null),
      ]);

      if (anomalyData?.anomalous_days)   setAnomalies(anomalyData.anomalous_days);
      if (deadlineData?.deadlines)       setDeadlines(deadlineData.deadlines);
      if (Array.isArray(historyData))    setChartHistory(historyData.slice().reverse()); // oldest first
    } catch {
      // secondary data is non-fatal
    }
  }

  function buildChart() {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;

    chartInstanceRef.current?.destroy();
    chartInstanceRef.current = null;

    const n = PERIOD_DAYS[selectedPeriod];
    const window_data = chartHistory.slice(-n);

    if (window_data.length === 0) return;

    const labels = window_data.map(d => d.date.slice(5)); // MM-DD

    const academic     = window_data.map(d => d.fullDayAcademicMinutes    ?? d.academicMinutes    ?? 0);
    const nonAcademic  = window_data.map(d => d.fullDayNonAcademicMinutes ?? d.nonAcademicMinutes ?? 0);
    const scores       = window_data.map(d => d.score ?? 0);
    const appSwitches  = window_data.map(d => d.fullDayTotalAppSwitches ?? 0);
    const inactivity   = window_data.map(d =>
      Math.max(0, (d.expectedStudyMinutes ?? 0) - (d.fullDayAcademicMinutes ?? d.academicMinutes ?? 0))
    );

    chartInstanceRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Procrastination Score',
            data: scores,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            tension: 0.4,
            yAxisID: 'yScore',
            pointRadius: 3,
            fill: false,
          },
          {
            label: 'Academic Time (min)',
            data: academic,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.08)',
            tension: 0.4,
            yAxisID: 'yMins',
            pointRadius: 3,
            fill: false,
          },
          {
            label: 'Non-Academic Time (min)',
            data: nonAcademic,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.08)',
            tension: 0.4,
            yAxisID: 'yMins',
            pointRadius: 3,
            fill: false,
          },
          {
            label: 'App Switch Rate',
            data: appSwitches,
            borderColor: '#a855f7',
            backgroundColor: 'rgba(168,85,247,0.08)',
            tension: 0.4,
            yAxisID: 'yMins',
            pointRadius: 3,
            fill: false,
          },
          {
            label: 'Inactivity Time (min)',
            data: inactivity,
            borderColor: '#94a3b8',
            backgroundColor: 'rgba(148,163,184,0.08)',
            tension: 0.4,
            yAxisID: 'yMins',
            pointRadius: 3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 12 },
          },
          tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#cbd5e1' },
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { size: 10 } },
            grid:  { color: 'rgba(148,163,184,0.1)' },
          },
          yScore: {
            type: 'linear',
            position: 'left',
            min: 0,
            max: 10,
            ticks: { color: '#ef4444', font: { size: 10 } },
            grid: { color: 'rgba(148,163,184,0.1)' },
            title: { display: true, text: 'Score', color: '#ef4444', font: { size: 10 } },
          },
          yMins: {
            type: 'linear',
            position: 'right',
            min: 0,
            ticks: { color: '#94a3b8', font: { size: 10 } },
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Minutes / Count', color: '#94a3b8', font: { size: 10 } },
          },
        },
      },
    });
  }

  // ── Calibration phase views ──────────────────────────────────────────────────

  if (phase === 'early') {
    const validAll = calibrationDays.filter(d => d.status !== 'no_logs');
    const sortedAll = [...validAll].sort((a, b) => a.date.localeCompare(b.date));
    const firstD = sortedAll.length ? new Date(sortedAll[0].date + 'T00:00:00Z') : new Date();
    const nowUtc = new Date(); nowUtc.setUTCHours(0, 0, 0, 0);
    const dayNum = sortedAll.length ? Math.floor((nowUtc.getTime() - firstD.getTime()) / 86400000) : 0;
    const pct = Math.round((dayNum / 7) * 100);
    const today = validAll[0] ?? null; // most recent day (history sorted desc)
    const goalPct = today && today.expectedStudyMinutes > 0
      ? Math.min(100, Math.round((today.fullDayAcademicMinutes / today.expectedStudyMinutes) * 100))
      : 0;

    return (
      <div className="calibration-page">
        <div className="calibration-card">
          <p className="calibration-phase-label">Calibration Phase</p>
          <h1 className="calibration-title">We're Learning Your Habits</h1>
          <p className="calibration-subtitle">
            We are collecting your activity data and building your personal study baseline.
            Procrastination analysis unlocks after Day 7.
          </p>
          <div className="calibration-day-counter">Day {dayNum} of 7 — Building your baseline</div>
          <div className="calibration-progress-wrap">
            <div className="calibration-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="calibration-progress-label">{7 - dayNum} more day{7 - dayNum !== 1 ? 's' : ''} until initial analysis</p>

          {today && (
            <>
              <p className="calibration-section-label">Today's Activity</p>
              <div className="calibration-stat-grid">
                <div className="calibration-stat">
                  <span className="calibration-stat-value color-green">{today.fullDayAcademicMinutes}</span>
                  <span className="calibration-stat-unit">m</span>
                  <p className="calibration-stat-label">Academic</p>
                </div>
                <div className="calibration-stat">
                  <span className="calibration-stat-value color-red">{today.fullDayNonAcademicMinutes}</span>
                  <span className="calibration-stat-unit">m</span>
                  <p className="calibration-stat-label">Non-Academic</p>
                </div>
                <div className="calibration-stat">
                  <span className="calibration-stat-value color-dark">{today.fullDayTotalAppSwitches}</span>
                  <p className="calibration-stat-label">App Switches</p>
                </div>
                <div className="calibration-stat">
                  <span className={`calibration-stat-value ${goalPct >= 70 ? 'color-green' : goalPct >= 40 ? 'color-orange' : 'color-red'}`}>{goalPct}</span>
                  <span className="calibration-stat-unit">%</span>
                  <p className="calibration-stat-label">Goal</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'calibration') {
    const validAll = calibrationDays.filter(d => d.status !== 'no_logs');
    const sortedAll = [...validAll].sort((a, b) => a.date.localeCompare(b.date));
    const firstD = sortedAll.length ? new Date(sortedAll[0].date + 'T00:00:00Z') : new Date();
    const nowUtc = new Date(); nowUtc.setUTCHours(0, 0, 0, 0);
    const dayNum = sortedAll.length ? Math.floor((nowUtc.getTime() - firstD.getTime()) / 86400000) : 0;
    const pct = Math.round((dayNum / 14) * 100);
    const daysLeft = 14 - dayNum;
    const okDays = validAll; // used for averages and table

    const avgAcademic    = okDays.length ? Math.round(okDays.reduce((s, d) => s + d.fullDayAcademicMinutes, 0) / okDays.length) : 0;
    const avgNonAcademic = okDays.length ? Math.round(okDays.reduce((s, d) => s + d.fullDayNonAcademicMinutes, 0) / okDays.length) : 0;
    const avgSwitches    = okDays.length ? Math.round(okDays.reduce((s, d) => s + d.fullDayTotalAppSwitches, 0) / okDays.length) : 0;
    const avgGoal        = okDays.length
      ? Math.round(okDays.reduce((s, d) => s + (d.expectedStudyMinutes > 0 ? Math.min(100, (d.fullDayAcademicMinutes / d.expectedStudyMinutes) * 100) : 0), 0) / okDays.length)
      : 0;

    return (
      <div className="calibration-page">
        <div className="calibration-card">
          <p className="calibration-phase-label">Calibration Phase</p>
          <h1 className="calibration-title">Day {dayNum} of 14</h1>
          <div className="calibration-progress-wrap">
            <div className="calibration-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="calibration-progress-label">
            {daysLeft} more day{daysLeft !== 1 ? 's' : ''} until full procrastination analysis
          </p>

          <p className="calibration-section-label">Average over last {dayNum} day{dayNum !== 1 ? 's' : ''}</p>
          <div className="calibration-stat-grid">
            <div className="calibration-stat">
              <span className="calibration-stat-value color-green">{avgAcademic}</span>
              <span className="calibration-stat-unit">m</span>
              <p className="calibration-stat-label">Avg Academic</p>
            </div>
            <div className="calibration-stat">
              <span className="calibration-stat-value color-red">{avgNonAcademic}</span>
              <span className="calibration-stat-unit">m</span>
              <p className="calibration-stat-label">Avg Non-Academic</p>
            </div>
            <div className="calibration-stat">
              <span className="calibration-stat-value color-dark">{avgSwitches}</span>
              <p className="calibration-stat-label">Avg Switches</p>
            </div>
            <div className="calibration-stat">
              <span className={`calibration-stat-value ${avgGoal >= 70 ? 'color-green' : avgGoal >= 40 ? 'color-orange' : 'color-red'}`}>{avgGoal}</span>
              <span className="calibration-stat-unit">%</span>
              <p className="calibration-stat-label">Avg Goal</p>
            </div>
          </div>

          <p className="calibration-section-label">Daily Activity Log</p>
          <div className="calibration-table-wrap">
            <table className="calibration-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Active Window</th>
                  <th>Academic</th>
                  <th>Non-Academic</th>
                  <th>Goal</th>
                </tr>
              </thead>
              <tbody>
                {okDays.map((d, i) => {
                  const gp = d.expectedStudyMinutes > 0 ? Math.min(100, Math.round((d.fullDayAcademicMinutes / d.expectedStudyMinutes) * 100)) : 0;
                  const gpClass = gp >= 70 ? 'calibration-goal-good' : gp >= 40 ? 'calibration-goal-medium' : 'calibration-goal-low';
                  const window = d.activeStart && d.activeEnd ? `${d.activeStart} – ${d.activeEnd}` : '—';
                  return (
                    <tr key={i}>
                      <td>{d.date.slice(5)}</td>
                      <td>{d.day}</td>
                      <td>{window}</td>
                      <td><span className="color-green">{d.fullDayAcademicMinutes}m</span></td>
                      <td><span className="color-red">{d.fullDayNonAcademicMinutes}m</span></td>
                      <td><span className={gpClass}>{gp}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal loading / error states (for 'active' phase) ───────────────────────

  if (loading) {
    return (
      <div className="loading-state">
        <p className="loading-text">Analysing activity...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="error-state">
        <p className="error-text">{error || 'No report available.'}</p>
        <button onClick={loadReport} className="retry-btn">Retry</button>
      </div>
    );
  }

  const at = report.activeTime;

  const totalTracked = at.academicMinutes + at.nonAcademicMinutes;
  const academicPct  = totalTracked > 0 ? Math.round((at.academicMinutes / totalTracked) * 100) : 0;

  const rawGoalPct =
    at.expectedStudyMinutes > 0
      ? Math.round((at.fullDayAcademicMinutes / at.expectedStudyMinutes) * 100)
      : 0;
  const goalPct           = Math.min(rawGoalPct, 100);
  const goalMinsRemaining = Math.max(0, at.expectedStudyMinutes - at.fullDayAcademicMinutes);
  const SEVERITY_ORDER = ['none', 'low', 'medium', 'warning', 'high', 'critical'];
  const dominantSeverity = report.patterns.length > 0
    ? report.patterns.reduce<string>((max, p) =>
        SEVERITY_ORDER.indexOf(p.severity) > SEVERITY_ORDER.indexOf(max) ? p.severity : max,
        'none')
    : report.level ?? 'none';

  const riskScore = report.prediction?.nextDayProcrastinationRisk;

  return (
    <div className="procrastination-page">

      {/* Header */}
      <div className="page-header">
        <div className="page-header-center">
          <h1 className="page-title">Daily Summary</h1>
          <p className="page-date">{report.date} · {at.day}</p>
        </div>
        <button onClick={loadReport} className="recalculate-btn">Recalculate</button>
      </div>

      {/* 3-col grid */}
      <div className="dashboard-grid">

        {/* SCORE CARD */}
        <div className="card score-card">
          <p className="section-label score-label-center">User Procrastination Score</p>
          <div className="score-display">
            <span className={`big-number ${scoreColorClass(report.score)}`}>{report.score}</span>
            <span className="score-out-of">/10</span>
          </div>
          {((report.confidence ?? 0) > 0 || (report.focusProbability ?? 0) > 0) && (
            <p className="score-breakdown">
              ML confidence: {Math.round((report.confidence ?? 0) * 100)}% · Focus state: {Math.round((report.focusProbability ?? 0) * 100)}%
            </p>
          )}
          <div className="score-meta">
            <div className="score-meta-item">
              <p className="score-meta-label">Active Time Detected</p>
              <p className="score-meta-value">
                {at.activeStart && at.activeEnd ? `${at.activeStart} – ${at.activeEnd}` : '—'}
              </p>
            </div>
            <div className="score-meta-item">
              <p className="score-meta-label">Detected Patterns</p>
              <p className="score-meta-value">
                {report.patterns.length > 0
                  ? report.patterns.map(p => patternLabel(p.type)).join(', ')
                  : report.dominantPattern && report.dominantPattern !== 'no_procrastination'
                    ? patternLabel(report.dominantPattern)
                    : 'None'}
              </p>
            </div>
            <div className="score-meta-item">
              <p className="score-meta-label">Severity Level</p>
              <div className="score-meta-badge-wrap">
                <span className={`badge ${severityClass(dominantSeverity)}`}>{dominantSeverity}</span>
              </div>
            </div>
          </div>
        </div>

        {/* PERSONALISED FEEDBACK */}
        <div className="card feedback-card">
          <p className="section-label">Personalised Feedback</p>

          <div className="feedback-footer">
            <p className={`efficiency-text ${efficiencyClass(academicPct)}`}>
              {academicPct >= 70
                ? `Great efficiency! You spent ${academicPct}% of your tracked time on academic work (${at.academicMinutes} mins). Keep it up.`
                : academicPct >= 40
                  ? `Moderate efficiency — ${academicPct}% academic (${at.academicMinutes} mins). Try to reduce non-academic time (${at.nonAcademicMinutes} mins).`
                  : `Low efficiency — only ${academicPct}% academic (${at.academicMinutes} mins). Consider removing distractions.`}
            </p>
          </div>

          {at.expectedStudyMinutes > 0 && (
            <div className="goal-bar-wrap">
              <div className="goal-bar-label">
                <span>Goal Completion</span>
                <span>{Math.min(goalPct, 100)}%</span>
              </div>
              <div className="goal-bar-track">
                <div
                  className={`goal-bar-fill ${goalBarClass(goalPct)}`}
                  style={{ width: `${Math.min(goalPct, 100)}%` }}
                />
              </div>
              <p className="goal-bar-sub">
                {at.fullDayAcademicMinutes} / {at.expectedStudyMinutes} mins
                {goalMinsRemaining > 0 ? ` — ${goalMinsRemaining} mins remaining` : ' — Goal met!'}
              </p>
            </div>
          )}
        </div>

        {/* FOCUS PERIOD */}
        <div className="focus-period-section">
          <p className="focus-period-title">Progress in the Focus Period</p>
          <div className="focus-period-grid">

            <div className="card focus-card">
              <p className="section-label focus-section-label">Academic Time</p>
              <div className="focus-number-wrap">
                <span className="big-number color-dark">{at.academicMinutes}</span>
                <span className="unit-text">mins</span>
              </div>
            </div>

            <div className="card focus-card">
              <p className="section-label focus-section-label">Non Academic Time</p>
              <div className="focus-number-wrap">
                <span className="big-number color-dark">{at.nonAcademicMinutes}</span>
                <span className="unit-text">mins</span>
              </div>
            </div>

            <div className="card focus-card">
              <p className="section-label focus-section-label">Study Efficiency</p>
              <div className="focus-number-wrap">
                <span className={`big-number ${efficiencyClass(academicPct)}`}>{academicPct}</span>
                <span className={`efficiency-pct ${efficiencyClass(academicPct)}`}>%</span>
              </div>
            </div>

            <div className="card focus-card">
              <p className="section-label focus-section-label">App Switches</p>
              <div className="focus-number-wrap">
                <span className="big-number color-dark">{at.appSwitches}</span>
              </div>
            </div>

          </div>
        </div>

        {/* RECOMMENDATIONS — with exit strategies */}
        <div className="card recommendations-card">
          <p className="section-label">Recommendations</p>
          {report.patterns.length > 0 ? (
            <div className="pattern-list">
              {report.patterns.map((p, i) => (
                <div key={i} className="pattern-item">
                  <div className="pattern-header">
                    <span className={`badge badge-sm ${severityClass(p.severity)}`}>{p.severity}</span>
                    <span className="pattern-name">{patternLabel(p.type)}</span>
                  </div>
                  <p className="pattern-evidence"><strong>Why:</strong> {p.evidence}</p>
                  {p.exit_strategy && (
                    <p className="pattern-exit-strategy"><strong>How to exit:</strong> {p.exit_strategy}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="recommendations-good">No patterns — great work!</p>
          )}

          <div className="tomorrow-section">
            <p className="section-label tomorrow-label">Tomorrow's Recommendations</p>
            <ul className="tomorrow-list">
              {report.prediction ? (
                <>
                  <li>
                    Your peak productivity window tomorrow is predicted between{' '}
                    {report.prediction.predictedActiveStart} and {report.prediction.predictedActiveEnd}.
                    Schedule focused study during this period.
                  </li>
                  <li>
                    Aim to complete at least {report.prediction.predictedAcademicMinutes} minutes
                    of academic work to stay consistent.
                  </li>
                  {riskScore !== undefined && (() => {
                    const last7 = chartHistory.slice(-7);
                    const avgAcademic = last7.length > 0
                      ? Math.round(last7.reduce((s, d) => s + (d.fullDayAcademicMinutes ?? d.academicMinutes ?? 0), 0) / last7.length)
                      : 0;
                    const expected = at.expectedStudyMinutes;
                    const goalPctAvg = expected > 0 ? Math.round((avgAcademic / expected) * 100) : 0;
                    return (
                      <>
                        <li>
                          Tomorrow's procrastination risk:{' '}
                          <span className={
                            riskScore > 0.6 ? 'color-red' :
                            riskScore > 0.3 ? 'color-orange' : 'color-green'
                          }>
                            {Math.round(riskScore * 100)}%
                          </span>
                        </li>
                        {last7.length >= 3 && (
                          <li className="risk-why">
                            <em>Why:</em> Over the last {last7.length} days you averaged {avgAcademic}m of academic work
                            ({goalPctAvg}% of your {expected}m goal).
                            {riskScore > 0.6
                              ? ' Low recent completion rate suggests high risk tomorrow.'
                              : riskScore > 0.3
                                ? ' Moderate goal completion suggests some risk tomorrow.'
                                : ' Consistent goal completion keeps tomorrow\'s risk low.'}
                          </li>
                        )}
                      </>
                    );
                  })()}
                </>
              ) : (
                <li>No predictive data is available for tomorrow yet. Maintain a consistent study routine.</li>
              )}
            </ul>
          </div>
        </div>

        {/* TODAY SUMMARY */}
        <div className="card today-summary-card">
          <p className="section-label">
            Yesterday's Summary
            <span className="today-date-badge">{report.date} · {at.day}</span>
          </p>
          <div className="today-summary-grid">
            <div className="today-stat">
              <span className="today-stat-value color-green">{at.fullDayAcademicMinutes}</span>
              <span className="today-stat-unit">mins</span>
              <p className="today-stat-label">Academic (Full Day)</p>
            </div>
            <div className="today-stat">
              <span className="today-stat-value color-red">{at.fullDayNonAcademicMinutes}</span>
              <span className="today-stat-unit">mins</span>
              <p className="today-stat-label">Non-Academic (Full Day)</p>
            </div>
            <div className="today-stat">
              <span className="today-stat-value color-orange">{at.fullDayProductivityMinutes}</span>
              <span className="today-stat-unit">mins</span>
              <p className="today-stat-label">Productivity (Full Day)</p>
            </div>
            <div className="today-stat">
              <span className="today-stat-value color-dark">{at.fullDayTotalAppSwitches}</span>
              <p className="today-stat-label">Total Switches (Full Day)</p>
            </div>
          </div>
        </div>

      </div>{/* end dashboard-grid */}

      {/* ── ANOMALY ALERTS ─────────────────────────────────────────────── */}
      {anomalies.length > 0 && (
        <div className="card anomaly-card">
          <p className="section-label">⚠ Anomaly Alerts</p>
          <p className="section-sub">
            Days where your behavior patterns were statistically unusual compared to your personal baseline.
            Not just high-score days — any significant deviation (unusually high or low activity, abnormal switching patterns) triggers this alert.
          </p>
          <div className="anomaly-list">
            {anomalies.slice(0, 5).map((a, i) => {
              const ctx = getAnomalyContext(a);
              return (
                <div key={i} className={`anomaly-item anomaly-item--${ctx.type}`}>
                  <div className="anomaly-header">
                    <span className="anomaly-date">{a.date}</span>
                    <span className={`anomaly-badge anomaly-badge--${ctx.type}`}>
                      {ctx.type === 'high' ? 'High Deviation' : ctx.type === 'low' ? 'Unusually Low' : 'Anomalous'}
                    </span>
                  </div>
                  <div className="anomaly-label">{ctx.label}</div>
                  <div className="anomaly-explanation">{ctx.explanation}</div>
                  <div className="anomaly-score-row">
                    <span className="anomaly-score">Procrastination score: {a.score?.toFixed(1)} / 10</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TREND ANALYSIS CHART ───────────────────────────────────────── */}
      <div className="card trend-chart-card">
        <p className="section-label">Activity Trends</p>
        <div className="period-buttons">
          {PERIODS.map(p => (
            <button
              key={p}
              className={`period-btn ${selectedPeriod === p ? 'period-btn-active' : ''}`}
              onClick={() => setSelectedPeriod(p)}
            >
              {p === '1d' ? '1 Day' : p === '3d' ? '3 Days' : p === '5d' ? '5 Days' :
               p === '7d' ? '7 Days' : '14 Days'}
            </button>
          ))}
        </div>
        <div className="chart-container" style={{ position: 'relative', height: '260px' }}>
          {chartHistory.length === 0 ? (
            <p className="chart-empty">No history data yet. Run the pipeline for a few days first.</p>
          ) : (
            <canvas ref={chartCanvasRef} />
          )}
        </div>
      </div>

      {/* ── UPCOMING DEADLINES ────────────────────────────────────────── */}
      <div className="card deadline-card">
        <p className="section-label">Upcoming Deadlines</p>
        {deadlines.length === 0 ? (
          <p className="section-sub">No deadlines due in the next 14 days.</p>
        ) : (
          <div className="deadline-list">
            {deadlines.map((d, i) => (
              <div key={i} className={`deadline-item priority-${d.priority.toLowerCase()}`}>
                <div className="deadline-info">
                  <p className="deadline-name">{d.task_name}</p>
                  {d.deadline && <p className="deadline-date">{d.deadline}</p>}
                </div>
                <div className="deadline-badge-wrap">
                  <span className={`badge ${deadlineBadgeClass(d.days_left)}`}>{d.day_label}</span>
                  {d.hours_left > 0 && (
                    <span className="deadline-hours">{d.hours_left}h remaining</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default ProcrastinationPage;
