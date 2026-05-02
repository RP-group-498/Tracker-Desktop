import React from 'react';
import { Lightbulb, CheckCircle2 } from 'lucide-react';
import { Report, ActiveTimeInfo, HistoryDay, PatternResult } from './types';
import { patternLabel } from './helpers';

interface Props {
  report: Report;
  activeTime: ActiveTimeInfo;
  daysSinceStart: number;
  chartHistory: HistoryDay[];
  patterns?: PatternResult[];
}

function getSeverityTailwind(severity: string) {
  switch (severity.toLowerCase()) {
    case 'low': return 'bg-green-100 text-green-800 border-green-200';
    case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'warning': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'high': return 'bg-red-100 text-red-800 border-red-200';
    case 'critical': return 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200';
    default: return 'bg-slate-100 text-slate-800 border-slate-200';
  }
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
    <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
      <h3 className="text-base font-semibold text-slate-800 tracking-tight">Recommendations</h3>

      {at.status === 'no_logs' && daysSinceStart === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center text-slate-500">
          <Lightbulb size={32} className="mb-2 opacity-50" />
          <p className="font-semibold text-slate-700">No data yet</p>
          <p className="text-xs mt-1">Patterns and recommendations will appear once activity is recorded.</p>
        </div>
      ) : displayPatterns.length > 0 ? (
        <div className="flex flex-col gap-3">
          {displayPatterns.map((p, i) => (
            <div key={i} className="bg-white/50 border border-slate-200/60 rounded-xl p-4 transition-all hover:bg-white/70">
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getSeverityTailwind(p.severity)}`}>
                  {p.severity}
                </span>
                <span className="font-semibold text-sm text-slate-800">{patternLabel(p.type)}</span>
              </div>
              <p className="text-xs text-slate-500 mb-2">{p.evidence}</p>
              {p.exit_strategy && (
                <div className="bg-indigo-50 text-indigo-700 px-3 py-2 rounded-lg text-xs font-medium border border-indigo-100">
                  {p.exit_strategy}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-green-50 text-green-700 px-4 py-3 rounded-xl border border-green-200 flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 size={16} />
          No patterns detected — great work!
        </div>
      )}

      {daysSinceStart < 3 && (
        <p className="text-xs text-slate-400 italic mt-2">
          Switching and browsing patterns unlock in {3 - daysSinceStart} more day{3 - daysSinceStart !== 1 ? 's' : ''}.
        </p>
      )}

      {/* Tomorrow section */}
      <div className="mt-4 pt-4 border-t border-slate-200/60">
        <h3 className="text-sm font-semibold text-slate-800 mb-3 tracking-tight">Tomorrow's Plan</h3>

        {daysSinceStart < 7 ? (
          <div className="text-sm text-slate-500">
            <p className="font-medium text-slate-700">Predictions available after Day 7.</p>
            <p className="text-xs mt-1 italic">{7 - daysSinceStart} more day{7 - daysSinceStart !== 1 ? 's' : ''} until your model is ready.</p>
          </div>
        ) : (
          <ul className="space-y-2 text-sm text-slate-600">
            {report.prediction ? (
              <>
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400 font-bold mt-[-2px]">›</span>
                  <span>Peak window: {report.prediction.predictedActiveStart} – {report.prediction.predictedActiveEnd}. Schedule focused study then.</span>
                </li>
                {(() => {
                  const expected   = at.expectedStudyMinutes;
                  const targetMins = expected > 0
                    ? Math.max(report.prediction!.predictedAcademicMinutes, expected)
                    : report.prediction!.predictedAcademicMinutes;
                  return (
                    <li className="flex items-start gap-2">
                      <span className="text-indigo-400 font-bold mt-[-2px]">›</span>
                      <span>Target at least {targetMins} mins of academic work.</span>
                    </li>
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
                      <li className="flex items-start gap-2">
                        <span className="text-indigo-400 font-bold mt-[-2px]">›</span>
                        <span>Tomorrow's risk: <strong style={{ color: riskColor }}>{Math.round(adjustedRisk * 100)}%</strong></span>
                      </li>
                      {last7.length >= 3 && (
                        <li className="flex items-start gap-2 text-xs text-slate-500 italic">
                          <span className="text-indigo-400 font-bold mt-[-2px]">›</span>
                          <span>Avg {avgAcademic}m / day ({goalPctAvg}% of {expected}m goal) over {last7.length} days.{whyMessage}</span>
                        </li>
                      )}
                    </>
                  );
                })()}
              </>
            ) : (
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 font-bold mt-[-2px]">›</span>
                <span>No prediction yet. Maintain a consistent routine.</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
};

export default RecommendationsCard;
