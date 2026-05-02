import React from 'react';
import { Zap } from 'lucide-react';
import { DeadlineItem } from './types';

interface Props {
  deadlines: DeadlineItem[];
}

const DeadlineCard: React.FC<Props> = ({ deadlines }) => {
  const urgentDeadlines = deadlines.filter(d => d.days_left <= 5);
  if (urgentDeadlines.length === 0) return null;

  return (
    <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4 border-l-4 border-l-red-500">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800 tracking-tight">Deadlines This Week</h3>
        <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 border border-red-200 animate-[pulse_2s_ease-in-out_infinite]">
          <Zap size={14} />
          {urgentDeadlines.length} Task{urgentDeadlines.length !== 1 ? 's' : ''} Due Soon
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-[-8px]">These tasks are due within 5 days. Stay focused.</p>
      <div className="flex flex-col gap-3">
        {urgentDeadlines.map((d, i) => (
          <div
            key={i}
            className="bg-white/60 border border-slate-200/60 rounded-xl p-4 flex items-center justify-between transition-all hover:bg-white/80"
          >
            <div>
              <p className="text-sm font-bold text-slate-800">{d.task_name}</p>
              {d.deadline && <p className="text-xs font-medium text-slate-500 mt-0.5">Due: {d.deadline}</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold capitalize tracking-wide ${
                d.days_left === 0 ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                d.days_left <= 2 ? 'bg-red-100 text-red-800 border border-red-200' :
                d.days_left <= 5 ? 'bg-orange-100 text-orange-800 border border-orange-200' :
                'bg-yellow-100 text-yellow-800 border border-yellow-200'
              }`}>{d.day_label}</span>
              {d.hours_left > 0 && (
                <span className="text-[10px] font-bold text-slate-400">{d.hours_left}h left</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DeadlineCard;
