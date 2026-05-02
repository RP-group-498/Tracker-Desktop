import React from 'react';
import { Report } from './types';
import { patternLabel } from './helpers';

interface Props {
  report: Report;
  daysSinceStart: number;
  dominantSeverity: string;
}

function getSeverityTailwind(severity: string) {
  switch (severity.toLowerCase()) {
    case 'low': return 'bg-green-100 text-green-800 border-green-200';
    case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'warning': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'high': return 'bg-red-100 text-red-800 border-red-200';
    case 'critical': return 'bg-purple-100 text-purple-800 border-purple-200';
    default: return 'bg-slate-100 text-slate-800 border-slate-200';
  }
}

// Circular SVG gauge
function ScoreGauge({ score }: { score: number }) {
  const R      = 48;
  const circ   = 2 * Math.PI * R;
  const ratio  = Math.min(score / 10, 1);
  const filled = circ * ratio;

  const gaugeColor =
    score < 3 ? '#ef4444' :
    score < 6 ? '#f97316' :
    score < 8 ? '#eab308' : '#22c55e';

  const gradId = `gauge-grad-${score}`;

  return (
    <svg viewBox="0 0 120 120" className="w-[130px] h-[130px] drop-shadow-md">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor={gaugeColor} />
          <stop offset="100%" stopColor={gaugeColor} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {/* Track */}
      <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="10" />
      {/* Fill */}
      <circle
        cx="60" cy="60" r={R}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        stroke={`url(#${gradId})`}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeDashoffset="0"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '60px 60px', transition: 'stroke-dasharray 0.8s cubic-bezier(0.34,1.56,0.64,1)' }}
      />
      {/* Score number */}
      <text x="60" y="57" textAnchor="middle" className="text-3xl font-black" fill={gaugeColor} dominantBaseline="middle">
        {score}
      </text>
      <text x="60" y="73" textAnchor="middle" className="text-[13px] font-bold fill-slate-400" dominantBaseline="middle">
        /10
      </text>
    </svg>
  );
}

const ScoreCard: React.FC<Props> = ({ report, daysSinceStart, dominantSeverity }) => {
  const at = report.activeTime;

  return (
    <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
      <h3 className="text-base font-semibold text-slate-800 tracking-tight">Procrastination Score</h3>

      <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-6">
        {/* Left: gauge (or pending dash) */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          {daysSinceStart < 7 ? (
            <div className="flex flex-col items-center justify-center py-2 w-[130px]">
              <span className="text-5xl font-bold text-slate-300 leading-none">—</span>
              <p className="text-xs text-slate-500 font-medium mt-2">Available after Day 7</p>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-3 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.min(Math.round((daysSinceStart / 7) * 100), 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Day {daysSinceStart} of 7</p>
            </div>
          ) : (
            <>
              <ScoreGauge score={report.score} />
              <span className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${getSeverityTailwind(dominantSeverity)}`}>
                {report.level ?? dominantSeverity}
              </span>
            </>
          )}
        </div>

        {/* Right: meta */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {((report.confidence ?? 0) > 0 || (report.focusProbability ?? 0) > 0) && (
            <p className="text-xs font-semibold text-slate-500 mb-3">
              Focus: {Math.round((report.focusProbability ?? 0) * 100)}%
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-200/60 pt-4 mt-auto">
            <div className="bg-white/60 border border-slate-200/60 rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Active Window</p>
              <p className="text-xs font-bold text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis">
                {at.activeStart && at.activeEnd ? `${at.activeStart}–${at.activeEnd}` : '—'}
              </p>
            </div>
            <div className="bg-white/60 border border-slate-200/60 rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Patterns</p>
              <p className="text-xs font-bold text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis">
                {daysSinceStart < 7
                  ? '—'
                  : report.patterns.length > 0
                    ? report.patterns.map(p => patternLabel(p.type)).join(', ')
                    : report.dominantPattern && report.dominantPattern !== 'no_procrastination'
                      ? patternLabel(report.dominantPattern)
                      : 'None'}
              </p>
            </div>
            <div className="bg-white/60 border border-slate-200/60 rounded-xl p-3 text-center flex flex-col items-center">
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Severity</p>
              {daysSinceStart < 7 ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">—</span>
              ) : (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize border ${getSeverityTailwind(dominantSeverity)}`}>
                  {dominantSeverity}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScoreCard;
