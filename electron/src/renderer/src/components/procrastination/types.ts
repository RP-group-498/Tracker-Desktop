// Shared types for ProcrastinationPage components

export interface CalibrationDay {
  date: string;
  day: string;
  status: string;
  activeStart: string | null;
  activeEnd: string | null;
  academicMinutes: number;
  nonAcademicMinutes: number;
  fullDayAcademicMinutes: number;
  fullDayNonAcademicMinutes: number;
  fullDayTotalAppSwitches: number;
  expectedStudyMinutes: number;
}

export interface PatternResult {
  type: string;
  severity: string;
  evidence: string;
  exit_strategy?: string;
}

export interface ActiveTimeInfo {
  activeStart: string | null;
  activeEnd: string | null;
  academicMinutes: number;
  nonAcademicMinutes: number;
  appSwitches: number;
  expectedStudyMinutes: number;
  status: string;
  day: string;
  fullDayAcademicMinutes: number;
  fullDayNonAcademicMinutes: number;
  fullDayProductivityMinutes: number;
  fullDayAcademicAppSwitches: number;
  fullDayNonAcademicAppSwitches: number;
  fullDayProductivityAppSwitches: number;
  fullDayTotalAppSwitches: number;
}

export interface PredictionInfo {
  date: string;
  day: string;
  predictedActiveStart: string;
  predictedActiveEnd: string;
  predictedAcademicMinutes: number;
  nextDayProcrastinationRisk?: number;
}

export interface Report {
  date: string;
  score: number;
  level: string;
  dominantPattern: string | null;
  patterns: PatternResult[];
  activeTime: ActiveTimeInfo;
  prediction: PredictionInfo | null;
  confidence?: number;
  focusProbability?: number;
}

export interface AnomalyAlert {
  date: string;
  anomalyScore: number;
  score: number;
  dominantPattern: string | null;
  features?: Record<string, number>;
}

export interface DeadlineItem {
  task_name: string;
  deadline: string;
  days_left: number;
  hours_left: number;
  day_label: string;
  priority: string;
}

export interface HistoryDay {
  date: string;
  score: number;
  focusProbability?: number;
  confidence?: number;
  isAnomaly?: boolean;
  level?: string;
  dominantPattern?: string;
  fullDayAcademicMinutes?: number;
  academicMinutes?: number;
  expectedStudyMinutes?: number;
  fullDayNonAcademicMinutes?: number;
  nonAcademicMinutes?: number;
  fullDayTotalAppSwitches?: number;
}
