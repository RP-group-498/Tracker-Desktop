// /electron/src/renderer/src/pages/ProcrastinationPage.tsx

import React, { useEffect, useState } from 'react';
import '../styles/ProcrastinationPage.css';

interface PatternResult {
  type: string;
  severity: string;
  evidence: string;
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
}

interface Report {
  date: string;
  score: number;
  level: string;
  dominantPattern: string | null;
  patterns: PatternResult[];
  activeTime: ActiveTimeInfo;
  prediction: PredictionInfo | null;
}

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

const ProcrastinationPage: React.FC = () => {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadReport(); }, []);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const data = await (window as any).electronAPI.getProcrastinationReport() as Report;
      setReport(data);
    } catch {
      setError('Failed to load report. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

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

  // Focus efficiency: academic / (academic + non-academic) within tracked time
  const totalTracked = at.academicMinutes + at.nonAcademicMinutes;
  const academicPct = totalTracked > 0 ? Math.round((at.academicMinutes / totalTracked) * 100) : 0;

  // Goal completion: academic / expectedStudyMinutes
const rawGoalPct =
  at.expectedStudyMinutes > 0
    ? Math.round((at.fullDayAcademicMinutes / at.expectedStudyMinutes) * 100)
    : 0;

      const goalPct = Math.min(rawGoalPct, 100);

      const goalMinsRemaining = Math.max(
        0,
        at.expectedStudyMinutes - at.fullDayAcademicMinutes
      );

  const dominantSeverity = report.patterns[0]?.severity ?? report.level ?? 'none';

  return (
    <div className="procrastination-page">

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">APDIS Daily Output</h1>
        <button onClick={loadReport} className="recalculate-btn">Recalculate</button>
      </div>

      {/* 3-col grid */}
      <div className="dashboard-grid">

        {/* SCORE CARD — col 1-2, row 1 */}
        <div className="card score-card">
          <p className="section-label score-label-center">User Procrastination Score</p>
          <div className="score-display">
            <span className={`big-number ${scoreColorClass(report.score)}`}>{report.score}</span>
            <span className="score-out-of">/10</span>
          </div>
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
                {report.dominantPattern ? patternLabel(report.dominantPattern) : 'None'}
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

        {/* PERSONALISED FEEDBACK — col 3, row 1 */}
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

        {/* ACADEMIC TIME — col 1, row 2 */}
        <div className="card academic-time-card">
          <p className="section-label">Academic Time</p>
          <div className="number-row">
            <span className="big-number color-dark">{at.academicMinutes}</span>
            <span className="unit-text">mins</span>
          </div>
        </div>

        {/* NON ACADEMIC TIME — col 2, row 2 */}
        <div className="card non-academic-card">
          <p className="section-label">Non Academic Time</p>
          <div className="number-row">
            <span className="big-number color-dark">{at.nonAcademicMinutes}</span>
            <span className="unit-text">mins</span>
          </div>
        </div>

        {/* RECOMMENDATIONS — col 3, rows 2-3 */}
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
                  <p className="pattern-evidence">{p.evidence}</p>
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
                </>
              ) : (
                <li>No predictive data is available for tomorrow yet. Maintain a consistent study routine.</li>
              )}
            </ul>
          </div>
        </div>

        {/* STUDY EFFICIENCY (focus efficiency) */}
        <div className="card efficiency-card">
          <p className="section-label">Study Efficiency</p>
          <div className="number-row">
            <span className={`big-number ${efficiencyClass(academicPct)}`}>{academicPct}</span>
            <span className={`efficiency-pct ${efficiencyClass(academicPct)}`}>%</span>
          </div>
        </div>

        {/* APP SWITCHES */}
        <div className="card app-switches-card">
          <p className="section-label">App Switches</p>
          <span className="big-number color-dark">{at.appSwitches}</span>
        </div>

        {/* TODAY SUMMARY — row 4, spans full width */}
        <div className="card today-summary-card">
          <p className="section-label">
            Today's Summary
            <span className="today-date-badge">{report.date} · {at.day}</span>
          </p>
          <div className="today-summary-grid">
            <div className="today-stat">
              <span className="today-stat-value color-green">{at.fullDayAcademicMinutes}</span>
              <span className="today-stat-unit">mins</span>
              <p className="today-stat-label">Academic (Full Day)</p>
              <p className="today-stat-sub">{at.fullDayAcademicAppSwitches} switches</p>
            </div>
            <div className="today-stat">
              <span className="today-stat-value color-red">{at.fullDayNonAcademicMinutes}</span>
              <span className="today-stat-unit">mins</span>
              <p className="today-stat-label">Non-Academic (Full Day)</p>
              <p className="today-stat-sub">{at.fullDayNonAcademicAppSwitches} switches</p>
            </div>
            <div className="today-stat">
              <span className="today-stat-value color-orange">{at.fullDayProductivityMinutes}</span>
              <span className="today-stat-unit">mins</span>
              <p className="today-stat-label">Productivity (Full Day)</p>
              <p className="today-stat-sub">{at.fullDayProductivityAppSwitches} switches</p>
            </div>
            <div className="today-stat">
              <span className="today-stat-value color-dark">{at.fullDayTotalAppSwitches}</span>
              <p className="today-stat-label">Total Switches (Full Day)</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ProcrastinationPage;