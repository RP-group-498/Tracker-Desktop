import React, { useState } from 'react';
import { ArrowLeftRight, MoonStar, Globe, AlarmClock, CircleAlert, Check } from 'lucide-react';
import { PatternResult } from './types';
import { patternLabel, SEVERITY_BORDER } from './helpers';

type NotifState = 'pending' | 'expanded' | 'dismissed';

interface Props {
  patterns: PatternResult[];
}

const PATTERN_ICON: Record<string, { icon: React.ReactNode; bg: string }> = {
  frequent_task_switching: { icon: <ArrowLeftRight size={16} />, bg: '#fff7ed' },
  prolonged_inactivity:   { icon: <MoonStar size={16} />, bg: '#f0fdf4' },
  impulsive_browsing:     { icon: <Globe size={16} />, bg: '#fef9c3' },
  deadline_rushing:       { icon: <AlarmClock size={16} />, bg: '#fef2f2' },
  no_engagement:          { icon: <CircleAlert size={16} />, bg: '#f1f5f9' },
};

const DEFAULT_ICON = { icon: <CircleAlert size={16} />, bg: '#fff7ed' };

const PatternNotification: React.FC<Props> = ({ patterns }) => {
  const [states, setStates] = useState<NotifState[]>(() =>
    patterns.map(() => 'pending')
  );

  const allDismissed = states.every(s => s === 'dismissed');
  if (patterns.length === 0 || allDismissed) return null;

  const handleOk      = (i: number) => setStates(p => p.map((s, j) => j === i ? 'expanded'  : s));
  const handleDismiss = (i: number) => setStates(p => p.map((s, j) => j === i ? 'dismissed' : s));

  return (
    <div className="flex flex-col gap-3 mb-6">
      {patterns.map((p, i) => {
        if (states[i] === 'dismissed') return null;

        const isExpanded  = states[i] === 'expanded';
        const borderColor = SEVERITY_BORDER[p.severity] ?? '#6366f1';
        const icon        = PATTERN_ICON[p.type] ?? DEFAULT_ICON;

        return (
          <div
            key={i}
            className="glass-card overflow-hidden transition-all duration-300"
            style={{ borderLeftWidth: '4px', borderLeftColor: borderColor }}
          >
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: icon.bg, color: borderColor }}>
                    {icon.icon}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800">{patternLabel(p.type)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                        p.severity === 'critical' ? 'bg-purple-100 text-purple-800 border-purple-200' :
                        p.severity === 'high' ? 'bg-red-100 text-red-800 border-red-200' :
                        p.severity === 'warning' ? 'bg-orange-100 text-orange-800 border-orange-200' :
                        p.severity === 'medium' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                        'bg-green-100 text-green-800 border-green-200'
                      }`}>
                        {p.severity}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isExpanded ? (
                    <button className="px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors" onClick={() => handleOk(i)}>
                      Show tip
                    </button>
                  ) : (
                    <button className="px-3 py-1.5 text-xs font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5" onClick={() => handleDismiss(i)}>
                      Got it <Check size={14} />
                    </button>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-600 pl-11">{p.evidence}</p>

              {isExpanded && p.exit_strategy && (
                <div className="mt-2 ml-11 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block mb-1">How to avoid this</span>
                  <p className="text-xs text-indigo-800 font-medium leading-relaxed">{p.exit_strategy}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PatternNotification;
