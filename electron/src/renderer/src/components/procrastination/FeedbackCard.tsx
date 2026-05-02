import React from 'react';
import { ChartColumn, PartyPopper } from 'lucide-react';
import { ActiveTimeInfo } from './types';

interface Props {
  activeTime: ActiveTimeInfo;
  academicPct: number;
  goalPct: number;
  goalMinsRemaining: number;
  daysSinceStart: number;
}

function getGoalBarTailwind(pct: number): string {
  if (pct < 40) return 'bg-red-500';
  if (pct < 70) return 'bg-orange-500';
  return 'bg-green-500';
}

const FeedbackCard: React.FC<Props> = ({
  activeTime: at,
  academicPct,
  goalPct,
  goalMinsRemaining,
  daysSinceStart,
}) => {
  if (at.status === 'no_logs' && daysSinceStart === 0) {
    return (
      <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
        <h3 className="text-base font-semibold text-slate-800 tracking-tight">Personalised Feedback</h3>
        <div className="flex flex-col items-center justify-center py-6 text-center text-slate-500">
          <ChartColumn size={32} className="mb-2 opacity-50" />
          <p className="font-semibold text-slate-700">No activity yet today</p>
          <p className="text-xs mt-1">Keep the app running — feedback will appear once your first session is recorded.</p>
        </div>
      </div>
    );
  }

  const effColor = academicPct >= 70 ? 'text-green-600' : academicPct >= 40 ? 'text-orange-500' : 'text-red-500';

  return (
    <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
      <h3 className="text-base font-semibold text-slate-800 tracking-tight">Personalised Feedback</h3>

      {/* Goal bar */}
      {at.expectedStudyMinutes > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm font-semibold text-slate-800">
            <span>Goal Completion</span>
            <span className={effColor}>
              {Math.min(goalPct, 100)}%
            </span>
          </div>
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getGoalBarTailwind(goalPct)}`}
              style={{ width: `${Math.min(goalPct, 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {at.fullDayAcademicMinutes} / {at.expectedStudyMinutes} mins
            {goalMinsRemaining > 0
              ? ` — ${goalMinsRemaining} mins remaining`
              : ' — Goal met!'}
            {goalMinsRemaining <= 0 && <PartyPopper size={14} className="inline ml-1 mb-0.5" />}
          </p>
        </div>
      )}
    </div>
  );
};

export default FeedbackCard;
