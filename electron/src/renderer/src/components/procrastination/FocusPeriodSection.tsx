import React from 'react';
import { BookOpen, Globe, Zap, Repeat2 } from 'lucide-react';
import { ActiveTimeInfo } from './types';

interface Props {
  activeTime: ActiveTimeInfo;
  academicPct: number;
}

interface StatCardProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: number;
  unit?: string;
  barPct?: number;
  barColor?: string;
  valueColor?: string;
}

function StatCard({ icon, iconBg, iconColor, label, value, unit, barPct, barColor, valueColor }: StatCardProps) {
  return (
    <div className="bg-white/60 border border-slate-200/60 rounded-xl p-3 sm:p-4 flex items-center gap-3 sm:gap-4 transition-all hover:bg-white/80">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
        <div className="flex items-end gap-1">
          <span className={`text-2xl font-black leading-none tracking-tight ${valueColor ?? 'text-slate-900'}`}>
            {value}
          </span>
          {unit && <span className="text-xs font-semibold text-slate-500 mb-0.5">{unit}</span>}
        </div>
        {barPct !== undefined && (
          <div className="h-1 w-full bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor ?? 'bg-indigo-500'}`}
              style={{ width: `${Math.min(barPct, 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const FocusPeriodSection: React.FC<Props> = ({ activeTime: at, academicPct }) => {
  const effClass   = academicPct >= 70 ? 'good' : academicPct >= 40 ? 'medium' : 'low';
  const effColor   = effClass === 'good' ? 'text-green-600' : effClass === 'medium' ? 'text-yellow-500' : 'text-red-500';
  const effBarColor = effClass === 'good' ? 'bg-green-500' : effClass === 'medium' ? 'bg-yellow-500' : 'bg-red-500';

  const totalTracked = at.academicMinutes + at.nonAcademicMinutes;
  const nonAcadPct   = totalTracked > 0 ? Math.round((at.nonAcademicMinutes / totalTracked) * 100) : 0;
  const switchBarPct = Math.min(Math.round((at.appSwitches / 60) * 100), 100);

  return (
    <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800 tracking-tight">Focus Period Breakdown</h3>
        {at.activeStart && at.activeEnd && (
          <span className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide">
            {at.activeStart} – {at.activeEnd}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-2">
        <StatCard
          icon={<BookOpen size={20} />} iconBg="bg-green-100" iconColor="text-green-600"
          label="Academic Time" value={at.academicMinutes} unit="mins"
          barPct={academicPct} barColor="bg-green-500" valueColor="text-green-700"
        />
        <StatCard
          icon={<Globe size={20} />} iconBg="bg-red-100" iconColor="text-red-600"
          label="Non-Academic Time" value={at.nonAcademicMinutes} unit="mins"
          barPct={nonAcadPct} barColor="bg-red-500" valueColor="text-red-700"
        />
        <StatCard
          icon={<Zap size={20} />} iconBg="bg-indigo-100" iconColor="text-indigo-600"
          label="Study Efficiency" value={academicPct} unit="%"
          barPct={academicPct} barColor={effBarColor} valueColor={effColor}
        />
        <StatCard
          icon={<Repeat2 size={20} />} iconBg="bg-orange-100" iconColor="text-orange-600"
          label="App Switches" value={at.appSwitches}
          barPct={switchBarPct} barColor="bg-orange-500"
          valueColor={at.appSwitches > 30 ? 'text-red-600' : at.appSwitches > 15 ? 'text-orange-500' : 'text-slate-900'}
        />
      </div>
    </div>
  );
};

export default FocusPeriodSection;
