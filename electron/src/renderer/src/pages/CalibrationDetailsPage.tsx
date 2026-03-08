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

// ── Inject keyframes + Poppins once ──────────────────────────────────────────
const STYLE_ID = 'cd-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');
    @keyframes cd-fadeUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
    @keyframes cd-barGrow { from{transform:scaleY(0)} to{transform:scaleY(1)} }
    @keyframes cd-spin    { to{transform:rotate(360deg)} }
    @keyframes cd-rowIn   { from{opacity:0;transform:translateX(-6px)} to{opacity:1;transform:translateX(0)} }
    .cd-fadeup     { animation: cd-fadeUp  0.38s ease both; }
    .cd-row-in     { animation: cd-rowIn   0.25s ease both; }
    .cd-bar-grow   { transform-origin:bottom; animation: cd-barGrow 0.55s cubic-bezier(0.4,0,0.2,1) both; }
    .cd-refresh-btn:hover:not(:disabled){ background:#eef2ff!important; border-color:#818cf8!important; transform:translateY(-1px)!important; box-shadow:0 3px 8px rgba(99,102,241,.15)!important; }
    .cd-sum-card:hover  { transform:translateY(-2px)!important; box-shadow:0 6px 18px rgba(0,0,0,.09)!important; }
    .cd-chart-card:hover{ box-shadow:0 2px 8px rgba(0,0,0,.07),0 8px 20px rgba(0,0,0,.05)!important; }
    .cd-tr:hover td     { background:#f5f3ff!important; }
    .cd-bar-col:hover .cd-bar-grow { filter:brightness(1.1); }
  `;
  document.head.appendChild(s);
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const FONT = "'Poppins', system-ui, sans-serif";

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [vis, setVis] = useState(false);
  return (
    <div
      style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}
      onMouseEnter={() => setVis(true)}
      onMouseLeave={() => setVis(false)}
    >
      {children}
      {vis && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)', background: '#1f2937', color: '#fff',
          fontFamily: FONT, fontSize: 10.5, fontWeight: 500, whiteSpace: 'pre',
          padding: '6px 10px', borderRadius: 8, pointerEvents: 'none',
          zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,.2)', lineHeight: 1.7,
        }}>
          {content}
          <div style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            border: '5px solid transparent', borderTopColor: '#1f2937',
          }} />
        </div>
      )}
    </div>
  );
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
    { value: fmtMin(avgAcademic), label: 'Avg Academic Time', sub: 'per day',           accent: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0' },
    { value: String(goalMetDays), unit: `/ ${withData.length}`, label: 'Goal Met Days', sub: '≥ 70% target', accent: '#6366f1', bg: '#eef2ff', border: '#c7d2fe' },
    { value: String(Math.round(avgSwitches)), label: 'Avg App Switches',  sub: 'per day', accent: '#f97316', bg: '#fff7ed', border: '#fed7aa' },
    { value: best ? best.day : '—', label: 'Best Day', sub: best ? `${fmtMin(best.fullDayAcademicMinutes)} academic` : 'no data', accent: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
      {cards.map((c, i) => (
        <div
          key={i}
          className="cd-sum-card cd-fadeup"
          style={{
            position: 'relative', borderRadius: 14, border: `1.5px solid ${c.border}`,
            padding: '16px 16px 14px', overflow: 'hidden', boxSizing: 'border-box',
            background: c.bg, boxShadow: '0 1px 4px rgba(0,0,0,.05)',
            transition: 'transform .2s, box-shadow .2s', fontFamily: FONT,
            animationDelay: `${i * 60}ms`,
          }}
        >
          {/* Left accent */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: c.accent, borderRadius: '14px 0 0 14px' }} />
          {/* Value */}
          <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.04em', marginBottom: 6, display: 'flex', alignItems: 'flex-end', gap: 3, color: c.accent, fontFamily: FONT }}>
            {c.value}
            {c.unit && <span style={{ fontSize: 14, fontWeight: 700, color: '#9ca3af', marginBottom: 2, fontFamily: FONT }}>{c.unit}</span>}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, fontFamily: FONT }}>{c.label}</div>
          <div style={{ fontSize: 10.5, fontWeight: 500, color: '#9ca3af', fontFamily: FONT }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Chart shell ───────────────────────────────────────────────────────────────
const BARS_HEIGHT = 160;
const BARS_LABEL_H = 28;

function ChartShell({ title, legend, children, delay = 0, extra }: {
  title: string; legend: { color: string; label: string }[];
  children: React.ReactNode; delay?: number; extra?: React.ReactNode;
}) {
  return (
    <div
      className="cd-chart-card cd-fadeup"
      style={{
        background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
        padding: '16px 18px 14px', boxSizing: 'border-box',
        boxShadow: '0 1px 4px rgba(0,0,0,.05),0 4px 12px rgba(0,0,0,.03)',
        transition: 'box-shadow .2s', fontFamily: FONT, animationDelay: `${delay}ms`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontFamily: FONT }}>{title}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {legend.map((l, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap', fontFamily: FONT }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color, flexShrink: 0, display: 'inline-block' }} />
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

// Shared bar wrapper
function BarsWrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: BARS_HEIGHT, paddingBottom: BARS_LABEL_H, position: 'relative' }}>
      {children}
    </div>
  );
}

function BarCol({ children, opacity = 1, delay = 0 }: { children: React.ReactNode; opacity?: number; delay?: number }) {
  return (
    <div className="cd-bar-col" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', position: 'relative', opacity, animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function BarArea({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      {children}
    </div>
  );
}

function BarLabel({ day, date }: { day: string; date: string }) {
  return (
    <div style={{ position: 'absolute', bottom: -(BARS_LABEL_H - 2), left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 9,   fontWeight: 700, color: '#374151', letterSpacing: '0.01em', fontFamily: FONT }}>{day}</span>
      <span style={{ fontSize: 8.5, fontWeight: 500, color: '#9ca3af', fontFamily: FONT }}>{date}</span>
    </div>
  );
}

function NoDataBar() {
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 4, opacity: 0.6,
      background: 'repeating-linear-gradient(45deg,#f9fafb,#f9fafb 3px,#f3f4f6 3px,#f3f4f6 6px)',
    }} />
  );
}

// ── Chart 1: Stacked Time Breakdown ──────────────────────────────────────────
function TimeBreakdownChart({ records }: { records: CalibrationDayRecord[] }) {
  const maxTotal = Math.max(...records.map(r =>
    (r.fullDayAcademicMinutes ?? 0) + (r.fullDayProductivityMinutes ?? 0) + (r.fullDayNonAcademicMinutes ?? 0)
  ), 1);

  return (
    <ChartShell title="14-Day Time Breakdown" delay={100} legend={[
      { color: '#22c55e', label: 'Academic' },
      { color: '#f97316', label: 'Productivity' },
      { color: '#ef4444', label: 'Non-academic' },
    ]}>
      <BarsWrap>
        {records.map((r, idx) => {
          const acad = r.fullDayAcademicMinutes ?? 0;
          const prod = r.fullDayProductivityMinutes ?? 0;
          const non  = r.fullDayNonAcademicMinutes ?? 0;
          const total = acad + prod + non;
          const noData = r.status === 'no_logs' || total === 0;
          const tip = noData
            ? 'No data'
            : `Academic:     ${fmtMin(acad)}\nProductivity: ${fmtMin(prod)}\nNon-academic: ${fmtMin(non)}`;
          const [day, date] = formatDateLabel(r.date);

          return (
            <Tooltip key={r.date} content={tip}>
              <BarCol opacity={r.status === 'low' ? 0.65 : 1} delay={idx * 20}>
                <BarArea>
                  {noData ? <NoDataBar /> : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>
                      {[
                        { h: (non  / maxTotal) * 100, bg: '#ef4444' },
                        { h: (prod / maxTotal) * 100, bg: '#f97316' },
                        { h: (acad / maxTotal) * 100, bg: '#22c55e' },
                      ].map((seg, si) => (
                        <div key={si} className="cd-bar-grow" style={{ height: `${seg.h}%`, background: seg.bg, width: '100%', flexShrink: 0, animationDelay: `${idx * 20 + si * 40}ms` }} />
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

// ── Chart 2: Goal Completion % ────────────────────────────────────────────────
function GoalCompletionChart({ records }: { records: CalibrationDayRecord[] }) {
  const innerH = BARS_HEIGHT - BARS_LABEL_H;
  return (
    <ChartShell title="Goal Completion (%)" delay={160} legend={[
      { color: '#22c55e', label: '≥ 70%' },
      { color: '#f97316', label: '≥ 40%' },
      { color: '#ef4444', label: '< 40%' },
    ]}>
      <div style={{ position: 'relative' }}>
        {/* Ref lines */}
        {[{ pct: 70, color: '#22c55e' }, { pct: 40, color: '#f97316' }].map(({ pct, color }) => (
          <div key={pct} style={{
            position: 'absolute', left: 0, right: 0,
            bottom: BARS_LABEL_H + (pct / 100) * innerH,
            height: 1, background: color, opacity: 0.22, pointerEvents: 'none', zIndex: 1,
          }} />
        ))}
        <BarsWrap>
          {records.map((r, idx) => {
            const expected = r.expectedStudyMinutes ?? 0;
            const actual   = r.fullDayAcademicMinutes ?? 0;
            const noData   = r.status === 'no_logs' || expected === 0;
            const pct      = noData ? 0 : Math.min((actual / expected) * 100, 100);
            const color    = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f97316' : '#ef4444';
            const tip      = noData ? 'No data' : `${Math.round(pct)}% of goal\n${fmtMin(actual)} / ${fmtMin(expected)}`;
            const [day, date] = formatDateLabel(r.date);

            return (
              <Tooltip key={r.date} content={tip}>
                <BarCol delay={idx * 20}>
                  <BarArea>
                    {noData ? <NoDataBar /> : (
                      <div className="cd-bar-grow" style={{ width: '100%', height: `${pct}%`, background: color, borderRadius: '4px 4px 0 0', animationDelay: `${idx * 20}ms` }} />
                    )}
                  </BarArea>
                  <BarLabel day={day} date={date} />
                </BarCol>
              </Tooltip>
            );
          })}
        </BarsWrap>
      </div>
    </ChartShell>
  );
}

// ── Chart 3: App Switches ─────────────────────────────────────────────────────
function AppSwitchesChart({ records }: { records: CalibrationDayRecord[] }) {
  const maxSwitches = Math.max(...records.map(r => r.fullDayTotalAppSwitches ?? 0), 1);

  return (
    <ChartShell title="App Switches — Distraction Pattern" delay={220} legend={[
      { color: '#3b82f6', label: 'Total switches per day' },
    ]}>
      <BarsWrap>
        {records.map((r, idx) => {
          const sw     = r.fullDayTotalAppSwitches ?? 0;
          const noData = r.status === 'no_logs';
          const pct    = noData ? 0 : (sw / maxSwitches) * 100;
          const tip    = noData ? 'No data' : `${sw} switches`;
          const [day, date] = formatDateLabel(r.date);

          return (
            <Tooltip key={r.date} content={tip}>
              <BarCol delay={idx * 20}>
                <BarArea>
                  {noData ? <NoDataBar /> : (
                    <div className="cd-bar-grow" style={{ width: '100%', height: `${pct}%`, background: '#3b82f6', borderRadius: '4px 4px 0 0', animationDelay: `${idx * 20}ms` }} />
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
  const TH_STYLE: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '2px solid #f3f4f6', fontFamily: FONT };
  const TD_STYLE: React.CSSProperties = { padding: '8px 10px', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle', borderBottom: '1px solid #f9fafb', fontFamily: FONT };
  const pill = (color: string, bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: bg, color, fontFamily: FONT });

  return (
    <div className="cd-chart-card cd-fadeup" style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: '16px 18px 6px', boxSizing: 'border-box', boxShadow: '0 1px 4px rgba(0,0,0,.05),0 4px 12px rgba(0,0,0,.03)', transition: 'box-shadow .2s', fontFamily: FONT, animationDelay: '280ms' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontFamily: FONT }}>Daily Detail</p>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 8px', fontFamily: FONT }}>{records.length} days</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: FONT }}>
          <thead>
            <tr>{headers.map(h => <th key={h} style={TH_STYLE}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {records.map((r, i) => {
              const noLogs = r.status === 'no_logs';
              const isLow  = r.status === 'low';
              return (
                <tr key={r.date} className="cd-tr cd-row-in" style={{ opacity: noLogs ? 0.4 : isLow ? 0.7 : 1, animationDelay: `${i * 18}ms` }}>
                  <td style={{ ...TD_STYLE, fontWeight: 700, color: '#111827', fontSize: 11.5 }}>{r.date}</td>
                  <td style={{ ...TD_STYLE, fontWeight: 600, color: '#6b7280', fontSize: 11 }}>{r.day}</td>
                  <td style={TD_STYLE}><span style={pill('#16a34a', '#dcfce7')}>{fmtMin(r.fullDayAcademicMinutes ?? 0)}</span></td>
                  <td style={TD_STYLE}><span style={pill('#ea580c', '#ffedd5')}>{fmtMin(r.fullDayProductivityMinutes ?? 0)}</span></td>
                  <td style={TD_STYLE}><span style={pill('#dc2626', '#fee2e2')}>{fmtMin(r.fullDayNonAcademicMinutes ?? 0)}</span></td>
                  <td style={{ ...TD_STYLE, fontWeight: 700, color: '#3b82f6' }}>{r.fullDayTotalAppSwitches ?? 0}</td>
                  <td style={{ ...TD_STYLE, fontSize: 11.5, color: '#6b7280' }}>
                    {r.activeStart && r.activeEnd ? `${r.activeStart} – ${r.activeEnd}` : <span style={{ color: '#d1d5db' }}>—</span>}
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
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => { loadHistory(); }, []);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const data = await (window as any).electronAPI.getCalibrationHistory(14) as CalibrationDayRecord[];
      setRecords(data || []);
    } catch {
      setError('Could not load calibration history. Is MongoDB connected?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: FONT, padding: '18px 20px 28px', background: '#f3f4f6', minHeight: '100vh', boxSizing: 'border-box' }}>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: '#4338ca', margin: '0 0 3px', letterSpacing: '-0.01em', fontFamily: FONT }}>
            Calibration Details
          </h1>
          <p style={{ fontSize: 11.5, color: '#9ca3af', fontWeight: 500, margin: 0, fontFamily: FONT }}>
            14-day activity breakdown from calibration phase
          </p>
        </div>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="cd-refresh-btn"
          style={{ padding: '6px 16px', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#4338ca', background: '#fff', border: '1.5px solid #e0e7ff', borderRadius: 8, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.06)', transition: 'all .15s' }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: 200 }}>
          <div style={{ width: 28, height: 28, border: '3px solid #e5e7eb', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'cd-spin 0.75s linear infinite' }} />
          <p style={{ fontSize: 13, fontWeight: 500, color: '#9ca3af', fontFamily: FONT, margin: 0 }}>Loading history…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 20, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12 }}>
          <p style={{ fontSize: 12.5, fontWeight: 500, color: '#dc2626', margin: 0, textAlign: 'center', fontFamily: FONT }}>{error}</p>
          <button onClick={loadHistory} style={{ padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontFamily: FONT, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && records.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '40px 20px' }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: 0, fontFamily: FONT }}>No calibration data yet.</p>
          <p style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af', margin: 0, fontFamily: FONT }}>Run the analysis pipeline to populate history.</p>
        </div>
      )}

      {/* Content */}
      {!loading && records.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SummaryCards records={records} />
          <TimeBreakdownChart records={records} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <GoalCompletionChart records={records} />
            <AppSwitchesChart records={records} />
          </div>
          <DailyDetailTable records={records} />
        </div>
      )}
    </div>
  );
};

export default CalibrationDetailsPage;