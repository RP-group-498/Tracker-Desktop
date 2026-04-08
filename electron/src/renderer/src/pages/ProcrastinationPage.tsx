// /electron/src/renderer/src/pages/ProcrastinationPage.tsx

import React, { useEffect, useState } from 'react';
import '../styles/ProcrastinationPage.css';

import { CalibrationDay, Report, AnomalyAlert, DeadlineItem, HistoryDay, PatternResult } from '../components/procrastination/types';

import PatternNotification  from '../components/procrastination/PatternNotification';
import ScoreCard            from '../components/procrastination/ScoreCard';
import FeedbackCard         from '../components/procrastination/FeedbackCard';
import FocusPeriodSection   from '../components/procrastination/FocusPeriodSection';
import RecommendationsCard  from '../components/procrastination/RecommendationsCard';
import TodaySummaryCard     from '../components/procrastination/TodaySummaryCard';
import AnomalySection       from '../components/procrastination/AnomalySection';
import TrendChart           from '../components/procrastination/TrendChart';
import DeadlineCard         from '../components/procrastination/DeadlineCard';

// ── Component ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER = ['none', 'low', 'medium', 'warning', 'high', 'critical'];

const ProcrastinationPage: React.FC = () => {
  const [report,          setReport]          = useState<Report | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [anomalies,       setAnomalies]       = useState<AnomalyAlert[]>([]);
  const [deadlines,       setDeadlines]       = useState<DeadlineItem[]>([]);
  const [chartHistory,    setChartHistory]    = useState<HistoryDay[]>([]);
  const [daysSinceStart,  setDaysSinceStart]  = useState<number>(0);

  useEffect(() => {
    async function init() {
      try {
        const history = await (window as any).electronAPI.getCalibrationHistory(90) as CalibrationDay[];
        const validDays = (history ?? []).filter((d: CalibrationDay) => d.status !== 'no_logs');
        if (validDays.length > 0) {
          const sorted    = [...validDays].sort((a, b) => a.date.localeCompare(b.date));
          const firstDate = new Date(sorted[0].date + 'T00:00:00Z');
          const todayUtc  = new Date();
          todayUtc.setUTCHours(0, 0, 0, 0);
          const days = Math.floor((todayUtc.getTime() - firstDate.getTime()) / 86400000);
          setDaysSinceStart(days);
        }
      } catch { /* non-fatal */ }
      loadReport();
    }
    init();
  }, []);

  useEffect(() => {
    if (!report) return;
    loadSecondaryData();
  }, [report]);

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
      if (Array.isArray(historyData))    setChartHistory(historyData.slice().reverse());
    } catch { /* secondary data is non-fatal */ }
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
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

  // ── Derived values ─────────────────────────────────────────────────────────

  const at = report.activeTime;

  const totalTracked      = at.academicMinutes + at.nonAcademicMinutes;
  const academicPct       = totalTracked > 0
    ? Math.round((at.academicMinutes / totalTracked) * 100)
    : 0;
  const rawGoalPct        = at.expectedStudyMinutes > 0
    ? Math.round((at.fullDayAcademicMinutes / at.expectedStudyMinutes) * 100)
    : 0;
  const goalPct           = Math.min(rawGoalPct, 100);
  const goalMinsRemaining = Math.max(0, at.expectedStudyMinutes - at.fullDayAcademicMinutes);
  const dominantSeverity  = report.patterns.length > 0
    ? report.patterns.reduce<string>(
        (max, p) =>
          SEVERITY_ORDER.indexOf(p.severity) > SEVERITY_ORDER.indexOf(max) ? p.severity : max,
        'none'
      )
    : report.level ?? 'none';

  // If deadline_rushing is the dominant pattern but absent from patterns array, inject it
  const hasDeadlineRushing = report.patterns.some(p => p.type === 'deadline_rushing');
  const displayPatterns: PatternResult[] =
    report.dominantPattern === 'deadline_rushing' && !hasDeadlineRushing
      ? [
          {
            type: 'deadline_rushing',
            severity: report.level ?? 'high',
            evidence: 'You are falling behind on your study goal with deadlines approaching.',
            exit_strategy:
              'Break remaining work into 2–3 focused sessions today. Temporarily block non-academic apps during your study window.',
          },
          ...report.patterns,
        ]
      : report.patterns;

  // Only show notifications when past calibration phase
  const notificationPatterns = daysSinceStart >= 7 ? displayPatterns : [];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="procrastination-page">

      {/* Pattern Notifications — shown on page open when patterns are detected */}
      <PatternNotification patterns={notificationPatterns} />

      {/* Header */}
      <div className="page-header">
        <div className="page-header-center">
          <h1 className="page-title">Daily Summary</h1>
          <p className="page-date">{report.date} · {at.day}</p>
        </div>
        <button onClick={loadReport} className="recalculate-btn">Recalculate</button>
      </div>

      {/* 3-col dashboard grid */}
      <div className="dashboard-grid">
        <ScoreCard
          report={report}
          daysSinceStart={daysSinceStart}
          dominantSeverity={dominantSeverity}
        />
        <FeedbackCard
          activeTime={at}
          academicPct={academicPct}
          goalPct={goalPct}
          goalMinsRemaining={goalMinsRemaining}
          daysSinceStart={daysSinceStart}
        />
        <FocusPeriodSection
          activeTime={at}
          academicPct={academicPct}
        />
        <RecommendationsCard
          report={report}
          activeTime={at}
          daysSinceStart={daysSinceStart}
          chartHistory={chartHistory}
          patterns={displayPatterns}
        />
        <TodaySummaryCard report={report} />
      </div>

      {/* Below-grid sections */}
      <AnomalySection anomalies={anomalies} daysSinceStart={daysSinceStart} />
      <TrendChart chartHistory={chartHistory} daysSinceStart={daysSinceStart} />
      <DeadlineCard deadlines={deadlines} />

    </div>
  );
};

export default ProcrastinationPage;
