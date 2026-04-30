import React from 'react';
import { BookOpen, Globe, Zap, Repeat2 } from 'lucide-react';
import { ActiveTimeInfo } from './types';
import { efficiencyClass } from './helpers';

interface Props {
  activeTime: ActiveTimeInfo;
  academicPct: number;
}

interface StatCardProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number;
  unit?: string;
  barPct?: number;
  barClass?: string;
  valueColor?: string;
}

function StatCard({ icon, iconBg, label, value, unit, barPct, barClass, valueColor }: StatCardProps) {
  return (
    <div className="focus-card">
      <div className="focus-card-icon" style={{ background: iconBg }}>
        {icon}
      </div>
      <div className="focus-card-body">
        <p className="focus-section-label">{label}</p>
        <div className="focus-number-wrap">
          <span className="focus-big-num" style={{ color: valueColor ?? '#0f172a' }}>
            {value}
          </span>
          {unit && <span className="focus-unit">{unit}</span>}
        </div>
        {barPct !== undefined && (
          <div className="focus-bar-wrap">
            <div
              className={`focus-bar-fill ${barClass ?? 'focus-bar-indigo'}`}
              style={{ width: `${Math.min(barPct, 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const FocusPeriodSection: React.FC<Props> = ({ activeTime: at, academicPct }) => {
  const effClass   = efficiencyClass(academicPct);
  const effColor   = effClass === 'efficiency-good' ? '#22c55e'
                   : effClass === 'efficiency-medium' ? '#eab308'
                   : '#ef4444';

  const totalTracked = at.academicMinutes + at.nonAcademicMinutes;
  const nonAcadPct   = totalTracked > 0
    ? Math.round((at.nonAcademicMinutes / totalTracked) * 100)
    : 0;

  // Normalise switches to 0-100 for mini bar (cap at 60 as "full")
  const switchBarPct = Math.min(Math.round((at.appSwitches / 60) * 100), 100);

  return (
    <div className="focus-period-section">
      <div className="focus-period-header">
        <p className="focus-period-title">Focus Period Breakdown</p>
        {at.activeStart && at.activeEnd && (
          <span className="focus-period-badge">
            {at.activeStart} – {at.activeEnd}
          </span>
        )}
      </div>

      <div className="focus-period-grid">
        <StatCard
          icon={<BookOpen size={18} />}
          iconBg="#dcfce7"
          label="Academic Time"
          value={at.academicMinutes}
          unit="mins"
          barPct={academicPct}
          barClass="focus-bar-green"
          valueColor="#15803d"
        />
        <StatCard
          icon={<Globe size={18} />}
          iconBg="#fee2e2"
          label="Non-Academic Time"
          value={at.nonAcademicMinutes}
          unit="mins"
          barPct={nonAcadPct}
          barClass="focus-bar-red"
          valueColor="#b91c1c"
        />
        <StatCard
          icon={<Zap size={18} />}
          iconBg="#e0e7ff"
          label="Study Efficiency"
          value={academicPct}
          unit="%"
          barPct={academicPct}
          barClass={
            effClass === 'efficiency-good'   ? 'focus-bar-green'  :
            effClass === 'efficiency-medium' ? 'focus-bar-orange' :
            'focus-bar-red'
          }
          valueColor={effColor}
        />
        <StatCard
          icon={<Repeat2 size={18} />}
          iconBg="#fff7ed"
          label="App Switches"
          value={at.appSwitches}
          barPct={switchBarPct}
          barClass="focus-bar-orange"
          valueColor={at.appSwitches > 30 ? '#b91c1c' : at.appSwitches > 15 ? '#f97316' : '#0f172a'}
        />
      </div>
    </div>
  );
};

export default FocusPeriodSection;
