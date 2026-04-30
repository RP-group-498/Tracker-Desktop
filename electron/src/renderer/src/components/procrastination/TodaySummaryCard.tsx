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
  color: string;
}

function Stat({ icon, value, unit, label, color }: StatProps) {
  return (
    <div className="today-stat">
      <div className="today-stat-icon">{icon}</div>
      <div>
        <span className="today-stat-value" style={{ color }}>{value}</span>
        {unit && <span className="today-stat-unit">{unit}</span>}
      </div>
      <p className="today-stat-label">{label}</p>
    </div>
  );
}

const TodaySummaryCard: React.FC<Props> = ({ report }) => {
  const at = report.activeTime;

  return (
    <div className="card today-summary-card">
      <p className="section-label">
        Yesterday's Full-Day Summary
        <span className="today-date-badge">{report.date} · {at.day}</span>
      </p>
      <div className="today-summary-grid">
        <Stat
          icon={<BookOpen size={18} />}
          value={at.fullDayAcademicMinutes}
          unit="m"
          label="Academic"
          color="#22c55e"
        />
        <Stat
          icon={<Globe size={18} />}
          value={at.fullDayNonAcademicMinutes}
          unit="m"
          label="Non-Academic"
          color="#ef4444"
        />
        <Stat
          icon={<BriefcaseBusiness size={18} />}
          value={at.fullDayProductivityMinutes}
          unit="m"
          label="Productivity"
          color="#f97316"
        />
        <Stat
          icon={<Repeat2 size={18} />}
          value={at.fullDayTotalAppSwitches}
          label="Total Switches"
          color="#6366f1"
        />
      </div>
    </div>
  );
};

export default TodaySummaryCard;
