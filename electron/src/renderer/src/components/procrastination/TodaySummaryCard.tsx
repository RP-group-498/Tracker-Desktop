import React from 'react';
import { BookOpen, Globe, BriefcaseBusiness, Repeat2 } from 'lucide-react';
import { Report } from './types';

interface Props {
  report: Report;
}

interface StatProps {
  icon: React.ReactNode;
  value: number;
  unit?: string;
  label: string;
  colorClass: string;
}

function Stat({ icon, value, unit, label, colorClass }: StatProps) {
  return (
    <div className="bg-white/60 border border-slate-200/60 rounded-xl p-4 flex flex-col items-center text-center gap-1 transition-all hover:bg-white/80">
      <div className={`mb-1 opacity-80 ${colorClass}`}>{icon}</div>
      <div className="flex items-baseline gap-0.5">
        <span className={`text-3xl font-black tracking-tight leading-none ${colorClass}`}>{value}</span>
        {unit && <span className="text-xs font-semibold text-slate-500">{unit}</span>}
      </div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

const TodaySummaryCard: React.FC<Props> = ({ report }) => {
  const at = report.activeTime;

  return (
    <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h3 className="text-base font-semibold text-slate-800 tracking-tight">Yesterday's Full-Day Summary</h3>
        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
          {report.date} · {at.day}
        </span>
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          icon={<BookOpen size={24} />} value={at.fullDayAcademicMinutes} unit="m"
          label="Academic" colorClass="text-green-500"
        />
        <Stat
          icon={<Globe size={24} />} value={at.fullDayNonAcademicMinutes} unit="m"
          label="Non-Academic" colorClass="text-red-500"
        />
        <Stat
          icon={<BriefcaseBusiness size={24} />} value={at.fullDayProductivityMinutes} unit="m"
          label="Productivity" colorClass="text-orange-500"
        />
        <Stat
          icon={<Repeat2 size={24} />} value={at.fullDayTotalAppSwitches}
          label="Total Switches" colorClass="text-indigo-500"
        />
      </div>
    </div>
  );
};

export default TodaySummaryCard;
