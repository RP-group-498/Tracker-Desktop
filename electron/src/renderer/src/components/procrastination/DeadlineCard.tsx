import React from 'react';
import { Zap } from 'lucide-react';
import { DeadlineItem } from './types';
import { deadlineBadgeClass } from './helpers';

interface Props {
  deadlines: DeadlineItem[];
}

const DeadlineCard: React.FC<Props> = ({ deadlines }) => {
  const urgentDeadlines = deadlines.filter(d => d.days_left <= 5);
  if (urgentDeadlines.length === 0) return null;

  return (
    <div className="card deadline-card deadline-card--urgent">
      <div className="deadline-header-row">
        <p className="section-label">Deadlines This Week</p>
        <span className="deadline-alert-badge">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Zap size={14} />
            {urgentDeadlines.length} Task{urgentDeadlines.length !== 1 ? 's' : ''} Due Soon
          </span>
        </span>
      </div>
      <p className="section-sub">These tasks are due within 5 days. Stay focused.</p>
      <div className="deadline-list">
        {urgentDeadlines.map((d, i) => (
          <div
            key={i}
            className={`deadline-item deadline-item--urgent priority-${d.priority.toLowerCase()}`}
          >
            <div className="deadline-info">
              <p className="deadline-name">{d.task_name}</p>
              {d.deadline && <p className="deadline-date">Due: {d.deadline}</p>}
            </div>
            <div className="deadline-badge-wrap">
              <span className={`badge ${deadlineBadgeClass(d.days_left)}`}>{d.day_label}</span>
              {d.hours_left > 0 && (
                <span className="deadline-hours">{d.hours_left}h left</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DeadlineCard;
