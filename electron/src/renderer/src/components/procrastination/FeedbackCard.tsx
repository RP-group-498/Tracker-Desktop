import React from 'react';
import { ActiveTimeInfo } from './types';
import { efficiencyClass, goalBarClass } from './helpers';

interface Props {
  activeTime: ActiveTimeInfo;
  academicPct: number;
  goalPct: number;
  goalMinsRemaining: number;
  daysSinceStart: number;
}

const EFFICIENCY_COLOR: Record<string, string> = {
  'efficiency-good':   '#22c55e',
  'efficiency-medium': '#eab308',
  'efficiency-low':    '#ef4444',
};

const FeedbackCard: React.FC<Props> = ({
  activeTime: at,
  academicPct,
  goalPct,
  goalMinsRemaining,
  daysSinceStart,
}) => {
  const effClass = efficiencyClass(academicPct);
  const effColor = EFFICIENCY_COLOR[effClass] ?? '#6366f1';

  if (at.status === 'no_logs' && daysSinceStart === 0) {
    return (
      <div className="card feedback-card">
        <p className="section-label">Personalised Feedback</p>
        <div className="no-data-pending">
          <div className="no-data-pending-icon">📊</div>
          <p className="no-data-pending-text">No activity yet today</p>
          <p className="no-data-pending-sub">
            Keep the app running — feedback will appear once your first session is recorded.
          </p>
        </div>
      </div>
    );
  }

  const effDesc =
    academicPct >= 70
      ? `${academicPct}% of tracked time on academic work.`
      : academicPct >= 40
        ? `${academicPct}% academic. ${at.nonAcademicMinutes}m non-academic.`
        : `Only ${academicPct}% academic. Remove distractions.`;

  return (
    <div className="card feedback-card">
      <p className="section-label">Personalised Feedback</p>

      {/* Goal bar */}
      {at.expectedStudyMinutes > 0 && (
        <div className="goal-bar-wrap">
          <div className="goal-bar-label">
            <span>Goal Completion</span>
            <span className="goal-bar-pct" style={{ color: effColor }}>
              {Math.min(goalPct, 100)}%
            </span>
          </div>
          <div className="goal-bar-track">
            <div
              className={`goal-bar-fill ${goalBarClass(goalPct)}`}
              style={{ width: `${Math.min(goalPct, 100)}%` }}
            />
          </div>
          <p className="goal-bar-sub">
            {at.fullDayAcademicMinutes} / {at.expectedStudyMinutes} mins
            {goalMinsRemaining > 0
              ? ` — ${goalMinsRemaining} mins remaining`
              : ' — Goal met! 🎉'}
          </p>
        </div>
      )}
    </div>
  );
};

export default FeedbackCard;
