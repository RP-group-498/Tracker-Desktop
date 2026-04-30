import { AnomalyAlert } from './types';

export function scoreColorClass(score: number): string {
  if (score < 3) return 'color-red';
  if (score < 6) return 'color-orange';
  if (score < 8) return 'color-yellow';
  return 'color-green';
}

export function efficiencyClass(pct: number): string {
  if (pct >= 70) return 'efficiency-good';
  if (pct >= 40) return 'efficiency-medium';
  return 'efficiency-low';
}

export function patternLabel(type: string): string {
  switch (type) {
    case 'frequent_task_switching': return 'Frequent Task Switching';
    case 'prolonged_inactivity':    return 'Prolonged Inactivity';
    case 'impulsive_browsing':      return 'Impulsive Browsing';
    case 'deadline_rushing':        return 'Deadline Rushing';
    case 'no_engagement':           return 'No Engagement';
    default: return type.replace(/_/g, ' ');
  }
}

export function severityClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'low':      return 'badge-low';
    case 'medium':   return 'badge-medium';
    case 'warning':  return 'badge-warning';
    case 'high':     return 'badge-high';
    case 'critical': return 'badge-critical';
    default:         return 'badge-default';
  }
}

export function goalBarClass(pct: number): string {
  if (pct < 40) return 'goal-bar-red';
  if (pct < 70) return 'goal-bar-orange';
  return 'goal-bar-green';
}

export function deadlineBadgeClass(daysLeft: number): string {
  if (daysLeft === 0) return 'badge-critical';
  if (daysLeft <= 2)  return 'badge-high';
  if (daysLeft <= 5)  return 'badge-warning';
  return 'badge-medium';
}

export function getAnomalyContext(a: AnomalyAlert): {
  label: string;
  explanation: string;
  type: 'high' | 'low' | 'unusual';
} {
  const score   = a.score ?? 0;
  const pattern = a.dominantPattern;
  const f       = a.features ?? {};

  if (pattern === 'no_procrastination' && score < 3) {
    return {
      label: 'Unusually Productive',
      explanation: `Your score (${score.toFixed(1)}/10) was well below your typical range — an unusually focused day that stood out statistically.`,
      type: 'low',
    };
  }

  if (pattern === 'no_procrastination' && score >= 3) {
    const highSwitch = (f['switch_rate'] ?? 0) > 0.5;
    const highIdle   = (f['idle_ratio']  ?? 0) > 0.4;
    const subLabel   = highSwitch ? 'High App-Switching'
                     : highIdle   ? 'Prolonged Inactivity'
                     : 'Atypical Behavior Pattern';
    return {
      label: subLabel,
      explanation: `Your score was ${score.toFixed(1)}/10 and your overall activity mix was statistically unusual — even though no single procrastination pattern dominated.`,
      type: 'unusual',
    };
  }

  const label     = patternLabel(pattern ?? '');
  const scoreDesc = score >= 6 ? 'significantly above' : score >= 4 ? 'above' : 'near';
  return {
    label,
    explanation: `Your ${label.toLowerCase()} behavior was ${scoreDesc} your personal baseline on this day (score ${score.toFixed(1)}/10).`,
    type: score >= 5 ? 'high' : 'unusual',
  };
}

export const SEVERITY_BORDER: Record<string, string> = {
  low:      '#22c55e',
  medium:   '#eab308',
  warning:  '#f97316',
  high:     '#ef4444',
  critical: '#a855f7',
};
