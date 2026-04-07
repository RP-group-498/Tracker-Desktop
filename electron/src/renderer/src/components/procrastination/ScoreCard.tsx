import React from 'react';
import { Report } from './types';
import { scoreColorClass, severityClass, patternLabel } from './helpers';

interface Props {
  report: Report;
  daysSinceStart: number;
  dominantSeverity: string;
}

// Circular SVG gauge
function ScoreGauge({ score }: { score: number }) {
  const R      = 48;
  const circ   = 2 * Math.PI * R;
  const ratio  = Math.min(score / 10, 1);
  const filled = circ * ratio;

  const gaugeColor =
    score < 3 ? '#ef4444' :
    score < 6 ? '#f97316' :
    score < 8 ? '#eab308' : '#22c55e';

  const gradId = `gauge-grad-${score}`;

  return (
    <svg viewBox="0 0 120 120" className="score-gauge-svg">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor={gaugeColor} />
          <stop offset="100%" stopColor={gaugeColor} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {/* Track */}
      <circle cx="60" cy="60" r={R} className="score-gauge-bg" />
      {/* Fill */}
      <circle
        cx="60" cy="60" r={R}
        className="score-gauge-track"
        stroke={`url(#${gradId})`}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeDashoffset="0"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '60px 60px' }}
      />
      {/* Score number */}
      <text x="60" y="57" textAnchor="middle" className="score-gauge-number" fill={gaugeColor}>
        {score}
      </text>
      <text x="60" y="73" textAnchor="middle" className="score-gauge-denom">
        /10
      </text>
    </svg>
  );
}

const severityColors: Record<string, string> = {
  none:     '#6366f1',
  low:      '#22c55e',
  medium:   '#eab308',
  warning:  '#f97316',
  high:     '#ef4444',
  critical: '#a21caf',
};

const ScoreCard: React.FC<Props> = ({ report, daysSinceStart, dominantSeverity }) => {
  const at = report.activeTime;

  return (
    <div className="card score-card">
      <p className="section-label score-label-center">Procrastination Score</p>

      <div className="score-card-inner">
        {/* Left: gauge (or pending dash) */}
        <div className="score-gauge-wrap">
          {daysSinceStart < 7 ? (
            <>
              <div className="score-pending-wrap" style={{ width: 130 }}>
                <span className="score-pending-dash">—</span>
                <p className="score-pending-label">Available after Day 7</p>
                <div className="score-pending-bar-wrap">
                  <div
                    className="score-pending-bar"
                    style={{ width: `${Math.round((daysSinceStart / 7) * 100)}%` }}
                  />
                </div>
                <p className="score-pending-progress">Day {daysSinceStart} of 7</p>
              </div>
            </>
          ) : (
            <>
              <ScoreGauge score={report.score} />
              <span
                className="score-level-badge"
                style={{
                  background: severityColors[dominantSeverity] + '20',
                  color: severityColors[dominantSeverity],
                  border: `1px solid ${severityColors[dominantSeverity]}40`,
                }}
              >
                {report.level ?? dominantSeverity}
              </span>
            </>
          )}
        </div>

        {/* Right: meta */}
        <div className="score-right">
          {((report.confidence ?? 0) > 0 || (report.focusProbability ?? 0) > 0) && (
            <p className="score-breakdown">
              ML confidence: {Math.round((report.confidence ?? 0) * 100)}% ·
              Focus: {Math.round((report.focusProbability ?? 0) * 100)}%
            </p>
          )}

          <div className="score-meta">
            <div className="score-meta-item">
              <p className="score-meta-label">Active Window</p>
              <p className="score-meta-value">
                {at.activeStart && at.activeEnd
                  ? `${at.activeStart}–${at.activeEnd}`
                  : '—'}
              </p>
            </div>
            <div className="score-meta-item">
              <p className="score-meta-label">Patterns</p>
              <p className="score-meta-value">
                {daysSinceStart < 7
                  ? '—'
                  : report.patterns.length > 0
                    ? report.patterns.map(p => patternLabel(p.type)).join(', ')
                    : report.dominantPattern && report.dominantPattern !== 'no_procrastination'
                      ? patternLabel(report.dominantPattern)
                      : 'None'}
              </p>
            </div>
            <div className="score-meta-item">
              <p className="score-meta-label">Severity</p>
              <div className="score-meta-badge-wrap">
                {daysSinceStart < 7
                  ? <span className="badge badge-default">—</span>
                  : <span className={`badge ${severityClass(dominantSeverity)}`}>{dominantSeverity}</span>
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScoreCard;
