import React from 'react';
import { AnomalyAlert } from './types';
import { getAnomalyContext } from './helpers';

interface Props {
  anomalies: AnomalyAlert[];
  daysSinceStart: number;
}

const AnomalySection: React.FC<Props> = ({ anomalies, daysSinceStart }) => {
  if (daysSinceStart < 7) {
    return (
      <div className="card anomaly-card">
        <p className="section-label">Days You Studied Differently</p>
        <p className="chart-empty">
          Unlocks in {7 - daysSinceStart} more day{7 - daysSinceStart !== 1 ? 's' : ''}.
          Need 7 days to learn your baseline.
        </p>
      </div>
    );
  }

  if (anomalies.length === 0) return null;

  return (
    <div className="card anomaly-card">
      <p className="section-label">Days You Studied Differently</p>
      <p className="section-sub">
        Past days where habits deviated notably from your usual routine — more, less, or
        unusually distributed. Worth reviewing, but not always a problem.
      </p>
      <div className="anomaly-list">
        {anomalies.slice(0, 5).map((a, i) => {
          const ctx = getAnomalyContext(a);
          return (
            <div key={i} className={`anomaly-item anomaly-item--${ctx.type}`}>
              <div className="anomaly-header">
                <span className="anomaly-date">{a.date}</span>
                <span className={`anomaly-badge anomaly-badge--${ctx.type}`}>
                  {ctx.type === 'high' ? '↑ Much Higher' : ctx.type === 'low' ? '↓ Much Lower' : '≠ Unusual'}
                </span>
              </div>
              <div className="anomaly-label">{ctx.label}</div>
              <div className="anomaly-explanation">{ctx.explanation}</div>
              <div className="anomaly-score-row">
                <span className="anomaly-score">
                  Score that day: {a.score?.toFixed(1)} / 10
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AnomalySection;
