import React from 'react';
import { AnomalyAlert } from './types';
import { getAnomalyContext } from './helpers';

interface Props {
  anomalies: AnomalyAlert[];
  daysSinceStart: number;
}

const AnomalySection: React.FC<Props> = ({ anomalies, daysSinceStart }) => {
  if (daysSinceStart < 7) {
    return (
      <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
        <h3 className="text-base font-semibold text-slate-800 tracking-tight">Days You Studied Differently</h3>
        <p className="text-sm text-slate-500 text-center py-6">
          Unlocks in {7 - daysSinceStart} more day{7 - daysSinceStart !== 1 ? 's' : ''}.
          Need 7 days to learn your baseline.
        </p>
      </div>
    );
  }

  if (anomalies.length === 0) return null;

  return (
    <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-800 tracking-tight mb-1">Days You Studied Differently</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Past days where habits deviated notably from your usual routine — more, less, or
          unusually distributed. Worth reviewing, but not always a problem.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {anomalies.slice(0, 5).map((a, i) => {
          const ctx = getAnomalyContext(a);
          return (
            <div key={i} className={`bg-white/60 border rounded-xl p-4 transition-all hover:bg-white/80 flex flex-col gap-2 ${
                ctx.type === 'high' ? 'border-l-4 border-l-red-500 border-slate-200/60' :
                ctx.type === 'low' ? 'border-l-4 border-l-green-500 border-slate-200/60' :
                'border-l-4 border-l-yellow-500 border-slate-200/60'
              }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-800">{a.date}</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  ctx.type === 'high' ? 'bg-red-100 text-red-800' :
                  ctx.type === 'low' ? 'bg-green-100 text-green-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {ctx.type === 'high' ? '↑ Much Higher' : ctx.type === 'low' ? '↓ Much Lower' : '≠ Unusual'}
                </span>
              </div>
              <div className="text-sm font-semibold text-slate-800">{ctx.label}</div>
              <div className="text-xs text-slate-500 leading-relaxed">{ctx.explanation}</div>
              <div className="mt-1">
                <span className="text-[11px] font-medium text-slate-400">
                  Score that day: {a.score?.toFixed(1)} / 10
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AnomalySection;
