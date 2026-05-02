import React, { useEffect, useState } from 'react';
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

const SEVERITY_ORDER = ['none', 'low', 'medium', 'warning', 'high', 'critical'];

const ProcrastinationPage: React.FC = () => {
  const [report,          setReport]          = useState<Report | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [anomalies,       setAnomalies]       = useState<AnomalyAlert[]>([]);
  const [deadlines,       setDeadlines]       = useState<DeadlineItem[]>([]);
  const [chartHistory,    setChartHistory]    = useState<HistoryDay[]>([]);
  const [daysSinceStart,  setDaysSinceStart]  = useState<number>(0);
  const [showAdvanced,    setShowAdvanced]    = useState(false);

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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500">Analysing activity...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-red-500 mb-4">{error || 'No report available.'}</p>
        <button onClick={loadReport} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">Retry</button>
      </div>
    );
  }

  const at = report.activeTime;
  const totalTracked      = at.academicMinutes + at.nonAcademicMinutes;
  const academicPct       = totalTracked > 0 ? Math.round((at.academicMinutes / totalTracked) * 100) : 0;
  const rawGoalPct        = at.expectedStudyMinutes > 0 ? Math.round((at.fullDayAcademicMinutes / at.expectedStudyMinutes) * 100) : 0;
  const goalPct           = Math.min(rawGoalPct, 100);
  const goalMinsRemaining = Math.max(0, at.expectedStudyMinutes - at.fullDayAcademicMinutes);
  const dominantSeverity  = report.patterns.length > 0 ? report.patterns.reduce<string>((max, p) => SEVERITY_ORDER.indexOf(p.severity) > SEVERITY_ORDER.indexOf(max) ? p.severity : max, 'none') : report.level ?? 'none';
  const hasDeadlineRushing = report.patterns.some(p => p.type === 'deadline_rushing');
  const displayPatterns: PatternResult[] = report.dominantPattern === 'deadline_rushing' && !hasDeadlineRushing
      ? [{ type: 'deadline_rushing', severity: report.level ?? 'high', evidence: 'You are falling behind on your study goal with deadlines approaching.', exit_strategy: 'Break remaining work into 2–3 focused sessions today. Temporarily block non-academic apps during your study window.' }, ...report.patterns]
      : report.patterns;
  const notificationPatterns = daysSinceStart >= 7 ? displayPatterns : [];

  return (
    <div className="p-2 space-y-4 sm:space-y-6 w-full">
      <PatternNotification patterns={notificationPatterns} />

      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">Daily Summary</h1>
          <p className="text-sm text-slate-500 font-medium">{report.date} · {at.day}</p>
        </div>
        <button onClick={loadReport} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
          Recalculate
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 animate-fade-in-up">
        <ScoreCard report={report} daysSinceStart={daysSinceStart} dominantSeverity={dominantSeverity} />
        <FeedbackCard activeTime={at} academicPct={academicPct} goalPct={goalPct} goalMinsRemaining={goalMinsRemaining} daysSinceStart={daysSinceStart} />
        <FocusPeriodSection activeTime={at} academicPct={academicPct} />
        <RecommendationsCard report={report} activeTime={at} daysSinceStart={daysSinceStart} chartHistory={chartHistory} patterns={displayPatterns} />
        <TodaySummaryCard report={report} />
      </div>

      <div className="mt-8 flex justify-center pb-8">
        <button 
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="px-5 py-2.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-xl transition-colors border border-purple-100"
        >
          {showAdvanced ? 'Hide Advanced Data' : 'View Advanced Data'}
        </button>
      </div>

      {showAdvanced && (
        <div className="animate-fade-in-up pb-8 space-y-4 sm:space-y-6">
          <AnomalySection anomalies={anomalies} daysSinceStart={daysSinceStart} />
          <TrendChart chartHistory={chartHistory} daysSinceStart={daysSinceStart} />
          <DeadlineCard deadlines={deadlines} />
        </div>
      )}
    </div>
  );
};

export default ProcrastinationPage;
