import React from 'react';
import { Report, ActiveTimeInfo, HistoryDay, PatternResult } from './types';
import { patternLabel, severityClass } from './helpers';

interface Props {
  report: Report;
  activeTime: ActiveTimeInfo;
  daysSinceStart: number;
  chartHistory: HistoryDay[];
  patterns?: PatternResult[];
}

const RecommendationsCard: React.FC<Props> = ({
  report,
  activeTime: at,
  daysSinceStart,
  chartHistory,
  patterns,
}) => {
  const displayPatterns = patterns ?? report.patterns;
  const riskScore = report.prediction?.nextDayProcrastinationRisk;

  return (
    <div className="card recommendations-card">
      <p className="section-label">Recommendations</p>

      {at.status === 'no_logs' && daysSinceStart === 0 ? (
        <div className="no-data-pending">
          <div className="no-data-pending-icon">💡</div>
          <p className="no-data-pending-text">No data yet</p>
          <p className="no-data-pending-sub">
            Patterns and recommendations will appear once activity is recorded.
          </p>
        </div>
      ) : displayPatterns.length > 0 ? (
        <div className="pattern-list">
          {displayPatterns.map((p, i) => (
            <div key={i} className="pattern-item">
              <div className="pattern-header">
                <span className={`badge badge-sm ${severityClass(p.severity)}`}>{p.severity}</span>
                <span className="pattern-name">{patternLabel(p.type)}</span>
              </div>
              <p className="pattern-evidence">{p.evidence}</p>
              {p.exit_strategy && (
                <p className="pattern-exit-strategy">{p.exit_strategy}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="recommendations-good">✓ No patterns detected — great work!</p>
      )}

      {daysSinceStart < 3 && (
        <p className="recommendations-notice">
          Switching and browsing patterns unlock in {3 - daysSinceStart} more
          day{3 - daysSinceStart !== 1 ? 's' : ''}.
        </p>
      )}

      {/* Tomorrow section */}
      <div className="tomorrow-section">
        <p className="section-label tomorrow-label">Tomorrow's Plan</p>

        {daysSinceStart < 7 ? (
          <div className="tomorrow-pending">
            <p className="tomorrow-pending-text">Predictions available after Day 7.</p>
            <p className="tomorrow-pending-sub">
              {7 - daysSinceStart} more day{7 - daysSinceStart !== 1 ? 's' : ''} until
              your model is ready.
            </p>
          </div>
        ) : (
          <ul className="tomorrow-list">
            {report.prediction ? (
              <>
                <li>
                  Peak window: {report.prediction.predictedActiveStart} –{' '}
                  {report.prediction.predictedActiveEnd}. Schedule focused study then.
                </li>
                {(() => {
                  const expected   = at.expectedStudyMinutes;
                  const targetMins = expected > 0
                    ? Math.max(report.prediction!.predictedAcademicMinutes, expected)
                    : report.prediction!.predictedAcademicMinutes;
                  return (
                    <li>Target at least {targetMins} mins of academic work.</li>
                  );
                })()}
                {riskScore !== undefined && (() => {
                  const last7       = chartHistory.slice(-7);
                  const avgAcademic = last7.length > 0
                    ? Math.round(last7.reduce((s, d) => s + (d.fullDayAcademicMinutes ?? d.academicMinutes ?? 0), 0) / last7.length)
                    : 0;
                  const expected    = at.expectedStudyMinutes;
                  const goalPctAvg  = expected > 0 ? Math.round((avgAcademic / expected) * 100) : 0;
                  const avgScore7d  = last7.length > 0
                    ? last7.reduce((s, d) => s + (d.score ?? 0), 0) / last7.length
                    : 0;
                  const adjustedRisk = last7.length >= 3
                    ? (riskScore * 0.3) + ((avgScore7d / 10) * 0.7)
                    : riskScore;
                  const riskColor = adjustedRisk > 0.6 ? '#ef4444'
                                  : adjustedRisk > 0.3 ? '#f97316'
                                  : '#22c55e';
                  const whyMessage =
                    goalPctAvg < 30 ? ' Build study consistency — you\'re well below your goal.'
                    : goalPctAvg < 60 ? ' Push a bit further each day.'
                    : adjustedRisk > 0.6 ? ' High recent procrastination suggests elevated risk.'
                    : adjustedRisk > 0.3 ? ' Stay focused — moderate risk.'
                    : ' Consistent habits keep risk low.';

                  return (
                    <>
                      <li>
                        Tomorrow's risk:{' '}
                        <strong style={{ color: riskColor }}>
                          {Math.round(adjustedRisk * 100)}%
                        </strong>
                      </li>
                      {last7.length >= 3 && (
                        <li className="risk-why">
                          Avg {avgAcademic}m / day ({goalPctAvg}% of {expected}m goal)
                          over {last7.length} days.{whyMessage}
                        </li>
                      )}
                    </>
                  );
                })()}
              </>
            ) : (
              <li>No prediction yet. Maintain a consistent routine.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
};

export default RecommendationsCard;
