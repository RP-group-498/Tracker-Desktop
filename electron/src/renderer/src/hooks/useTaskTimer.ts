import { useRef, useCallback } from 'react'
import { TimerState } from '../types/tasks'

export function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function useTaskTimer(
  taskTimers: React.MutableRefObject<Record<string, TimerState>>,
  onTick: (taskId: string) => void
) {
  const startTimer = useCallback((taskId: string) => {
    const existing = taskTimers.current[taskId]
    const accumulated = existing ? existing.accumulated : 0
    const interval = setInterval(() => onTick(taskId), 1000)
    taskTimers.current[taskId] = {
      segmentStart: Date.now(),
      accumulated,
      isPaused: false,
      timerInterval: interval,
    }
    return interval
  }, [taskTimers, onTick])

  const pauseTimer = useCallback((taskId: string) => {
    const timer = taskTimers.current[taskId]
    if (!timer || timer.isPaused || timer.segmentStart === null) return
    timer.accumulated += Math.floor((Date.now() - timer.segmentStart) / 1000)
    timer.isPaused = true
    if (timer.timerInterval) clearInterval(timer.timerInterval)
    timer.timerInterval = null
    timer.segmentStart = null
  }, [taskTimers])

  const resumeTimer = useCallback((taskId: string, onTickFn: (id: string) => void) => {
    const timer = taskTimers.current[taskId]
    if (!timer || !timer.isPaused) return
    const interval = setInterval(() => onTickFn(taskId), 1000)
    timer.segmentStart = Date.now()
    timer.isPaused = false
    timer.timerInterval = interval
  }, [taskTimers])

  const stopTimer = useCallback((taskId: string) => {
    const timer = taskTimers.current[taskId]
    if (!timer) return 0
    const totalSeconds = timer.isPaused
      ? timer.accumulated
      : timer.accumulated + Math.floor((Date.now() - (timer.segmentStart ?? Date.now())) / 1000)
    if (timer.timerInterval) clearInterval(timer.timerInterval)
    delete taskTimers.current[taskId]
    return totalSeconds
  }, [taskTimers])

  const getElapsed = useCallback((taskId: string): number => {
    const timer = taskTimers.current[taskId]
    if (!timer) return 0
    if (timer.isPaused || timer.segmentStart === null) return timer.accumulated
    return timer.accumulated + Math.floor((Date.now() - timer.segmentStart) / 1000)
  }, [taskTimers])

  return { startTimer, pauseTimer, resumeTimer, stopTimer, getElapsed }
}
