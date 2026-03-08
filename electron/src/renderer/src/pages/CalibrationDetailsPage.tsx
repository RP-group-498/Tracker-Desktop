import React, { useEffect, useState } from 'react';

interface CalibrationDayRecord {
  date: string;
  day: string;
  status: string;
  activeStart: string | null;
  activeEnd: string | null;
  academicMinutes: number;
  nonAcademicMinutes: number;
  totalAppSwitches: number;
  academicAppSwitches: number;
  nonAcademicAppSwitches: number;
  fullDayAcademicMinutes: number;
  fullDayNonAcademicMinutes: number;
  fullDayProductivityMinutes: number;
  fullDayAcademicAppSwitches: number;
  fullDayNonAcademicAppSwitches: number;
  fullDayProductivityAppSwitches: number;
  fullDayTotalAppSwitches: number;
  totalAcademicMinutes: number;
  expectedStudyMinutes: number;
}

function formatDateLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const dayAbbr = d.toLocaleDateString('en-US', { weekday: 'short' });
    return `${dayAbbr} ${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return dateStr.slice(5);
  }
}

function fmtMin(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ records }: { records: CalibrationDayRecord[] }) {
  const withData = records.filter(r => r.status !== 'no_logs');

  const avgAcademic = withData.length > 0
    ? withData.reduce((s, r) => s + (r.fullDayAcademicMinutes ?? 0), 0) / withData.length
    : 0;

  const goalMetDays = withData.filter(r => {
    const expected = r.expectedStudyMinutes ?? 0;
    return expected > 0 && (r.fullDayAcademicMinutes ?? 0) >= expected * 0.7;
  }).length;

  const avgSwitches = withData.length > 0
    ? withData.reduce((s, r) => s + (r.fullDayTotalAppSwitches ?? 0), 0) / withData.length
    : 0;

  const mostProductiveDay = withData.length > 0
    ? withData.reduce((best, r) =>
      (r.fullDayAcademicMinutes ?? 0) > (best.fullDayAcademicMinutes ?? 0) ? r : best
    )
    : null;

  return (
    <div className="calib-summary-grid">
      <div className="calib-summary-card">
        <div className="calib-summary-value">{fmtMin(avgAcademic)}</div>
        <div className="calib-summary-label">Avg Academic Time/day</div>
      </div>
      <div className="calib-summary-card">
        <div className="calib-summary-value">{goalMetDays}<span className="calib-summary-unit">/{withData.length} days</span></div>
        <div className="calib-summary-label">Goal Met Days (≥70%)</div>
      </div>
      <div className="calib-summary-card">
        <div className="calib-summary-value">{Math.round(avgSwitches)}</div>
        <div className="calib-summary-label">Avg App Switches/day</div>
      </div>
      <div className="calib-summary-card">
        <div className="calib-summary-value">{mostProductiveDay ? mostProductiveDay.day : '—'}</div>
        <div className="calib-summary-label">Most Productive Day</div>
      </div>
    </div>
  );
}

// ── Chart 1: Stacked Time Breakdown ──────────────────────────────────────────

function TimeBreakdownChart({ records }: { records: CalibrationDayRecord[] }) {
  const maxTotal = Math.max(
    ...records.map(r =>
      (r.fullDayAcademicMinutes ?? 0) +
      (r.fullDayProductivityMinutes ?? 0) +
      (r.fullDayNonAcademicMinutes ?? 0)
    ),
    1
  );

  return (
    <div className="calib-chart">
      <p className="calib-chart-title">14-Day Time Breakdown</p>
      <div className="calib-legend">
        <span className="calib-dot" style={{ background: '#22c55e' }} />Academic
        <span className="calib-dot" style={{ background: '#f97316', marginLeft: 10 }} />Productivity
        <span className="calib-dot" style={{ background: '#ef4444', marginLeft: 10 }} />Non-academic
      </div>
      <div className="calib-bars">
        {records.map(r => {
          const acad = r.fullDayAcademicMinutes ?? 0;
          const prod = r.fullDayProductivityMinutes ?? 0;
          const nonAcad = r.fullDayNonAcademicMinutes ?? 0;
          const total = acad + prod + nonAcad;
          const noData = r.status === 'no_logs' || total === 0;
          const isLow = r.status === 'low';

          return (
            <div key={r.date} className="calib-bar-col" style={{ opacity: isLow ? 0.75 : 1 }}>
              <div className="calib-bar-wrap">
                {noData ? (
                  <div className="calib-bar-empty" title="No data" />
                ) : (
                  <div className="calib-bar-stack" style={{ height: '100%' }}>
                    <div style={{ height: `${(nonAcad / maxTotal) * 100}%`, background: '#ef4444', width: '100%' }} />
                    <div style={{ height: `${(prod / maxTotal) * 100}%`, background: '#f97316', width: '100%' }} />
                    <div style={{ height: `${(acad / maxTotal) * 100}%`, background: '#22c55e', width: '100%' }} />
                  </div>
                )}
              </div>
              <div className="calib-bar-label" title={r.date}>{formatDateLabel(r.date)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Chart 2: Goal Completion % ────────────────────────────────────────────────

function GoalCompletionChart({ records }: { records: CalibrationDayRecord[] }) {
  return (
    <div className="calib-chart">
      <p className="calib-chart-title">Goal Completion (%)</p>
      <div className="calib-legend">
        <span className="calib-dot" style={{ background: '#22c55e' }} />≥70%
        <span className="calib-dot" style={{ background: '#f97316', marginLeft: 10 }} />≥40%
        <span className="calib-dot" style={{ background: '#ef4444', marginLeft: 10 }} />&lt;40%
      </div>
      <div className="calib-bars">
        {records.map(r => {
          const expected = r.expectedStudyMinutes ?? 0;
          const actual = r.fullDayAcademicMinutes ?? 0;
          const noData = r.status === 'no_logs' || expected === 0;
          const pct = noData ? 0 : Math.min((actual / expected) * 100, 100);
          const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f97316' : '#ef4444';

          return (
            <div key={r.date} className="calib-bar-col">
              <div className="calib-bar-wrap">
                {noData ? (
                  <div className="calib-bar-empty" />
                ) : (
                  <div className="calib-bar-fill-wrap">
                    <div
                      className="calib-bar-fill"
                      style={{ height: `${pct}%`, background: color }}
                      title={`${Math.round(pct)}%`}
                    />
                  </div>
                )}
              </div>
              <div className="calib-bar-label" title={r.date}>{formatDateLabel(r.date)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Chart 3: App Switches ─────────────────────────────────────────────────────

function AppSwitchesChart({ records }: { records: CalibrationDayRecord[] }) {
  const maxSwitches = Math.max(...records.map(r => r.fullDayTotalAppSwitches ?? 0), 1);

  return (
    <div className="calib-chart">
      <p className="calib-chart-title">App Switches (Distraction Pattern)</p>
      <div className="calib-legend">
        <span className="calib-dot" style={{ background: '#3b82f6' }} />Total app switches per day
      </div>
      <div className="calib-bars">
        {records.map(r => {
          const switches = r.fullDayTotalAppSwitches ?? 0;
          const noData = r.status === 'no_logs';
          const pct = noData ? 0 : (switches / maxSwitches) * 100;

          return (
            <div key={r.date} className="calib-bar-col">
              <div className="calib-bar-wrap">
                {noData ? (
                  <div className="calib-bar-empty" />
                ) : (
                  <div className="calib-bar-fill-wrap">
                    <div
                      className="calib-bar-fill"
                      style={{ height: `${pct}%`, background: '#3b82f6' }}
                      title={`${switches} switches`}
                    />
                  </div>
                )}
              </div>
              <div className="calib-bar-label" title={r.date}>{formatDateLabel(r.date)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Daily Detail Table ────────────────────────────────────────────────────────


function DailyDetailTable({ records }: { records: CalibrationDayRecord[] }) {
  return (
    <div className="calib-chart" style={{ overflowX: 'auto' }}>
      <p className="calib-chart-title">Daily Detail</p>
      <table className="calib-detail-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Academic</th>
            <th>Productivity</th>
            <th>Non-academic</th>
            <th>App Switches</th>
            <th>Active Window</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.date} className={r.status === 'no_logs' ? 'calib-row-no-logs' : r.status === 'low' ? 'calib-row-low' : ''}>
              <td>{r.date}</td>
              <td>{r.day}</td>
              <td>{fmtMin(r.fullDayAcademicMinutes ?? 0)}</td>
              <td>{fmtMin(r.fullDayProductivityMinutes ?? 0)}</td>
              <td>{fmtMin(r.fullDayNonAcademicMinutes ?? 0)}</td>
              <td>{r.fullDayTotalAppSwitches ?? 0}</td>
              <td>{r.activeStart && r.activeEnd ? `${r.activeStart} – ${r.activeEnd}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const CalibrationDetailsPage: React.FC = () => {
  const [records, setRecords] = useState<CalibrationDayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const data = await window.electronAPI.intervention.getCalibrationHistory(14) as CalibrationDayRecord[];
      setRecords(data || []);
    } catch {
      setError('Could not load calibration history. Is MongoDB connected?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Calibration Details</h2>
          <p className="text-xs text-gray-500">14-day activity breakdown from calibration phase</p>
        </div>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="px-3 py-1 text-xs bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <p className="text-xs text-gray-400">Loading history...</p>
      )}

      {error && (
        <p className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded">{error}</p>
      )}

      {!loading && !error && records.length === 0 && (
        <p className="text-xs text-gray-400">No calibration data yet. Run the analysis pipeline to populate history.</p>
      )}

      {!loading && records.length > 0 && (
        <>
          <SummaryCards records={records} />
          <TimeBreakdownChart records={records} />
          <GoalCompletionChart records={records} />
          <AppSwitchesChart records={records} />
          <DailyDetailTable records={records} />
        </>
      )}
    </div>
  );
};

export default CalibrationDetailsPage;
