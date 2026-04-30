import React, { useState } from 'react';
import { ArrowLeftRight, MoonStar, Globe, AlarmClock, CircleAlert, Check } from 'lucide-react';
import { PatternResult } from './types';
import { patternLabel, severityClass, SEVERITY_BORDER } from './helpers';

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
    <div className="pattern-notification-stack">
      {patterns.map((p, i) => {
        if (states[i] === 'dismissed') return null;

        const isExpanded  = states[i] === 'expanded';
        const borderColor = SEVERITY_BORDER[p.severity] ?? '#6366f1';
        const icon        = PATTERN_ICON[p.type] ?? DEFAULT_ICON;

        return (
          <div
            key={i}
            className={`pattern-notification${isExpanded ? ' pattern-notification--expanded' : ''}`}
            style={{ borderLeftColor: borderColor }}
          >
            <div className="pattern-notif-header">
              {/* Icon + title */}
              <div className="pattern-notif-left">
                <div className="pattern-notif-icon" style={{ background: icon.bg }}>
                  {icon.icon}
                </div>
                <div className="pattern-notif-title-row">
                  <span className="pattern-notif-title">{patternLabel(p.type)}</span>
                  <div className="pattern-notif-badge-row">
                    <span className={`badge badge-sm ${severityClass(p.severity)}`}>
                      {p.severity}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="pattern-notif-actions">
                {!isExpanded ? (
                  <button className="pattern-notif-ok-btn" onClick={() => handleOk(i)}>
                    Show tip
                  </button>
                ) : (
                  <button className="pattern-notif-dismiss-btn" onClick={() => handleDismiss(i)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Got it <Check size={14} />
                    </span>
                  </button>
                )}
              </div>
            </div>

            <p className="pattern-notif-evidence">{p.evidence}</p>

            {isExpanded && p.exit_strategy && (
              <div className="pattern-notif-recommendation">
                <span className="pattern-notif-rec-label">How to avoid this</span>
                <p className="pattern-notif-rec-text">{p.exit_strategy}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PatternNotification;
