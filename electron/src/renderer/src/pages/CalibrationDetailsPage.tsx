import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

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

function formatDateLabel(dateStr: string): [string, string] {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const dayAbbr = d.toLocaleDateString('en-US', { weekday: 'short' });
    return [dayAbbr, `${d.getMonth() + 1}/${d.getDate()}`];
  } catch {
    return [dateStr.slice(5), ''];
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
    ? withData.reduce((s, r) => s + (r.fullDayAcademicMinutes ?? 0), 0) / withData.length : 0;
  const goalMetDays = withData.filter(r => {
    const e = r.expectedStudyMinutes ?? 0;
    return e > 0 && (r.fullDayAcademicMinutes ?? 0) >= e * 0.7;
  }).length;
  const avgSwitches = withData.length > 0
    ? withData.reduce((s, r) => s + (r.fullDayTotalAppSwitches ?? 0), 0) / withData.length : 0;
  const best = withData.length > 0
    ? withData.reduce((b, r) => (r.fullDayAcademicMinutes ?? 0) > (b.fullDayAcademicMinutes ?? 0) ? r : b)
    : null;

  const cards = [
    { value: fmtMin(avgAcademic), label: 'Avg Academic Time', sub: 'per day', accent: 'text-emerald-500', iconBg: 'bg-emerald-500/10' },
    { value: `${goalMetDays}`, unit: `/${withData.length}`, label: 'Goal Met Days', sub: '≥ 70% target', accent: 'text-indigo-500', iconBg: 'bg-indigo-500/10' },
    { value: String(Math.round(avgSwitches)), label: 'Avg App Switches', sub: 'per day', accent: 'text-orange-500', iconBg: 'bg-orange-500/10' },
    { value: best ? best.day : '—', label: 'Best Day', sub: best ? `${fmtMin(best.fullDayAcademicMinutes)} academic` : 'no data', accent: 'text-blue-500', iconBg: 'bg-blue-500/10' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c, i) => (
        <div
          key={i}
          className="glass-card p-4 hover:scale-[1.01] transition-transform duration-200"
        >
          <div className={`text-2xl font-extrabold tracking-tight ${c.accent} flex items-end gap-1`}>
            {c.value}
            {c.unit && <span className="text-sm font-bold text-slate-400 mb-0.5">{c.unit}</span>}
          </div>
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mt-1.5">{c.label}</div>
          <div className="text-[10.5px] font-medium text-slate-400 mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [vis, setVis] = useState(false);
  return (
    <div
      className="relative flex flex-col flex-1 h-full"
      onMouseEnter={() => setVis(true)}
      onMouseLeave={() => setVis(false)}
    >
      {children}
      {vis && (
        <div className="absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10.5px] font-medium whitespace-pre py-1.5 px-2.5 rounded-lg pointer-events-none z-50 shadow-lg leading-relaxed">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-slate-800" />
        </div>
      )}
    </div>
  );
}

// ── Chart Shell ───────────────────────────────────────────────────────────────
const BARS_HEIGHT = 160;
const BARS_LABEL_H = 28;

function ChartShell({ title, legend, children, extra }: {
  title: string; legend: { color: string; label: string }[];
  children: React.ReactNode; extra?: React.ReactNode;
}) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3.5 gap-3 flex-wrap">
        <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider m-0">{title}</p>
        <div className="flex items-center gap-3 flex-wrap">
          {legend.map((l, i) => (
            <span key={i} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 whitespace-nowrap">
              <span className="w-2 h-2 rounded-sm inline-block shrink-0" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
          {extra}
        </div>
      </div>
      {children}
    </div>
  );
}

function BarsWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-end gap-1 relative" style={{ height: BARS_HEIGHT, paddingBottom: BARS_LABEL_H }}>
      {children}
    </div>
  );
}

function BarCol({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center h-full relative group">
      {children}
    </div>
  );
}

function BarArea({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 w-full flex items-end justify-center">
      {children}
    </div>
  );
}

function BarLabel({ day, date }: { day: string; date: string }) {
  return (
    <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center whitespace-nowrap" style={{ bottom: -(BARS_LABEL_H - 2) }}>
      <span className="text-[9px] font-bold text-slate-600 tracking-tight">{day}</span>
      <span className="text-[8.5px] font-medium text-slate-400">{date}</span>
    </div>
  );
}

function NoDataBar() {
  return (
    <div
      className="w-full h-full rounded opacity-60"
      style={{ background: 'repeating-linear-gradient(45deg,#f1f0fb,#f1f0fb 3px,#e8e6f5 3px,#e8e6f5 6px)' }}
    />
  );
}

// ── Chart 1: Stacked Time Breakdown ──────────────────────────────────────────
function TimeBreakdownChart({ records }: { records: CalibrationDayRecord[] }) {
  const maxTotal = Math.max(...records.map(r =>
    (r.fullDayAcademicMinutes ?? 0) + (r.fullDayProductivityMinutes ?? 0) + (r.fullDayNonAcademicMinutes ?? 0)
  ), 1);

  return (
    <ChartShell title="14-Day Time Breakdown" legend={[
      { color: '#22c55e', label: 'Academic' },
      { color: '#f97316', label: 'Productivity' },
      { color: '#ef4444', label: 'Non-academic' },
    ]}>
      <BarsWrap>
        {records.map((r, idx) => {
          const acad = r.fullDayAcademicMinutes ?? 0;
          const prod = r.fullDayProductivityMinutes ?? 0;
          const non = r.fullDayNonAcademicMinutes ?? 0;
          const total = acad + prod + non;
          const noData = r.status === 'no_logs' || total === 0;
          const tip = noData
            ? 'No data'
            : `Academic:     ${fmtMin(acad)}\nProductivity: ${fmtMin(prod)}\nNon-academic: ${fmtMin(non)}`;
          const [day, date] = formatDateLabel(r.date);

          return (
            <Tooltip key={r.date} content={tip}>
              <BarCol>
                <BarArea>
                  {noData ? <NoDataBar /> : (
                    <div className="w-full h-full flex flex-col justify-end rounded-t overflow-hidden">
                      {[
                        { h: (non / maxTotal) * 100, bg: '#ef4444' },
                        { h: (prod / maxTotal) * 100, bg: '#f97316' },
                        { h: (acad / maxTotal) * 100, bg: '#22c55e' },
                      ].map((seg, si) => (
                        <div
                          key={si}
                          className="w-full shrink-0 transition-all duration-500 group-hover:brightness-110"
                          style={{ height: `${seg.h}%`, background: seg.bg }}
                        />
                      ))}
                    </div>
                  )}
                </BarArea>
                <BarLabel day={day} date={date} />
              </BarCol>
            </Tooltip>
          );
        })}
      </BarsWrap>
    </ChartShell>
  );
}

// ── Daily Detail Table ────────────────────────────────────────────────────────
function DailyDetailTable({ records }: { records: CalibrationDayRecord[] }) {
  const headers = ['Date', 'Day', 'Academic', 'Productivity', 'Non-Academic', 'Switches', 'Active Window'];

  return (
    <div className="glass-card p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3.5">
        <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider m-0">Daily Detail</p>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100/80 border border-slate-200/60 rounded-md py-0.5 px-2">{records.length} days</span>
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {headers.map(h => (
                <th
                  key={h}
                  className="py-2 px-2.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider text-left whitespace-nowrap border-b-2 border-slate-100/60"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const noLogs = r.status === 'no_logs';
              const isLow = r.status === 'low';
              return (
                <tr
                  key={r.date}
                  className={`transition-colors hover:bg-indigo-50/40 ${noLogs ? 'opacity-40' : isLow ? 'opacity-70' : ''}`}
                >
                  <td className="py-2 px-2.5 font-bold text-slate-800 text-[11.5px] whitespace-nowrap border-b border-slate-50/80">{r.date}</td>
                  <td className="py-2 px-2.5 font-semibold text-slate-500 text-[11px] whitespace-nowrap border-b border-slate-50/80">{r.day}</td>
                  <td className="py-2 px-2.5 border-b border-slate-50/80">
                    <span className="inline-block py-0.5 px-2 rounded-md text-[11px] font-bold bg-emerald-100/80 text-emerald-700">{fmtMin(r.fullDayAcademicMinutes ?? 0)}</span>
                  </td>
                  <td className="py-2 px-2.5 border-b border-slate-50/80">
                    <span className="inline-block py-0.5 px-2 rounded-md text-[11px] font-bold bg-orange-100/80 text-orange-700">{fmtMin(r.fullDayProductivityMinutes ?? 0)}</span>
                  </td>
                  <td className="py-2 px-2.5 border-b border-slate-50/80">
                    <span className="inline-block py-0.5 px-2 rounded-md text-[11px] font-bold bg-red-100/80 text-red-700">{fmtMin(r.fullDayNonAcademicMinutes ?? 0)}</span>
                  </td>
                  <td className="py-2 px-2.5 font-bold text-blue-500 border-b border-slate-50/80">{r.fullDayTotalAppSwitches ?? 0}</td>
                  <td className="py-2 px-2.5 text-[11.5px] text-slate-500 whitespace-nowrap border-b border-slate-50/80">
                    {r.activeStart && r.activeEnd
                      ? `${r.activeStart} – ${r.activeEnd}`
                      : <span className="text-slate-300">—</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const CalibrationDetailsPage: React.FC = () => {
  const [records, setRecords] = useState<CalibrationDayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadHistory(); }, []);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const data = await (window as any).electronAPI.getCalibrationHistory(90) as CalibrationDayRecord[];
      // Show the first 14 days (calibration window), not the most recent 14
      const first14 = [...(data || [])]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 14);
      setRecords(first14);
    } catch {
      setError('Could not load calibration history. Is MongoDB connected?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-2 space-y-4 sm:space-y-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">
            Calibration Details
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            14-day activity breakdown from calibration phase
          </p>
        </div>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
        >
          <span className="flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </span>
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="glass-card flex flex-col items-center justify-center gap-3 py-16">
          <div className="w-7 h-7 border-[3px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-400 m-0">Loading history…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="glass-card flex flex-col items-center gap-3 p-5 border-red-200 bg-red-50/50">
          <p className="text-xs font-medium text-red-600 m-0 text-center">{error}</p>
          <button
            onClick={loadHistory}
            className="px-4 py-1.5 bg-red-500 text-white border-none rounded-lg text-xs font-semibold cursor-pointer hover:bg-red-600 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && records.length === 0 && (
        <div className="glass-card flex flex-col items-center gap-1.5 py-12 px-5">
          <p className="text-sm font-bold text-slate-700 m-0">No calibration data yet.</p>
          <p className="text-xs font-medium text-slate-400 m-0">Run the analysis pipeline to populate history.</p>
        </div>
      )}

      {/* Content */}
      {!loading && records.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 animate-fade-in-up">
          <SummaryCards records={records} />
          <TimeBreakdownChart records={records} />
          <DailyDetailTable records={records} />
        </div>
      )}
    </div>
  );
};

export default CalibrationDetailsPage;