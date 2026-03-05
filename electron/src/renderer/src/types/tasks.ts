export type Priority = 'High' | 'Medium' | 'Low'
export type Status = 'scheduled' | 'in_progress' | 'paused' | 'completed' | 'failed'
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
export type Method = 'warm_start' | 'cold_start' | 'unknown'

export interface Subtask {
  name: string
  estimated_minutes: number
  ai_estimated_minutes?: number
  api_predicted_minutes?: number
  confidence?: Confidence
  method?: Method
  user_selected_minutes?: number | null
  category?: string
}

export interface MCDMCalculation {
  urgency_score: number
  impact_score: number
  difficulty_score: number
  final_weighted_score: number
}

export interface TaskData {
  task_name: string
  task_description: string
  priority: Priority
  metrics: { days_left: number; difficulty_rating: number; deadline: string; credits: number; percentage: number }
  mcdm_calculation: MCDMCalculation
  sub_tasks: Subtask[]
  total_estimated_time?: number
  weight?: number
}

export interface Task {
  id: string
  name: string
  description: string
  status: Status
  predicted_time: number
  user_estimate: number
  actual_time?: number
  confidence: Confidence
  method: Method
  time_allocation_date?: string
  created_date?: string
  completed_date?: string
  priority: Priority
  category?: string
  predictedActiveStart?: string
  predictedActiveEnd?: string
}

export interface TimerState {
  segmentStart: number | null
  accumulated: number
  isPaused: boolean
  timerInterval: ReturnType<typeof setInterval> | null
}
