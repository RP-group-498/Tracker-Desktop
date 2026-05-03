import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Task, TimerState, ScheduledSummaryTask } from '../types/tasks'
import { formatElapsed } from '../hooks/useTaskTimer'
import { useAuth } from '../context/AuthContext'
import '../styles/pages.css'
import '../styles/time-estimator.css'

const API_BASE_URL = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'}/api/tasks`

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatTime(minutes: number): string {
  if (!minutes || minutes === 0) return '0m'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function parseActiveTime(timeStr: string, dateStr: string): Date | null {
  if (!timeStr || !dateStr) return null
  const date = new Date(dateStr)
  const [time, period] = timeStr.split(' ')
  const [hoursStr, minutesStr] = time.split(':')
  let hour24 = parseInt(hoursStr)
  const minutes = parseInt(minutesStr)
  if (period === 'PM' && hour24 !== 12) hour24 += 12
  if (period === 'AM' && hour24 === 12) hour24 = 0
  date.setHours(hour24, minutes, 0, 0)
  return date
}

function getStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    scheduled: '<span class="status-badge scheduled">Scheduled</span>',
    in_progress: '<span class="status-badge in-progress">In Progress</span>',
    completed: '<span class="status-badge completed">Completed</span>',
    failed: '<span class="status-badge failed">Failed - Time Expired</span>',
    paused: '<span class="status-badge in-progress">Paused</span>',
  }
  return badges[status] || '<span class="status-badge">Unknown</span>'
}

interface TimeEstimatorProps {
  embedded?: boolean
}

const TimeEstimator: React.FC<TimeEstimatorProps> = ({ embedded = false }) => {
  const { token, user } = useAuth()
  const authHeaders: Record<string, string> = token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
  const [currentDate, setCurrentDate] = useState(new Date())
  const [tasks, setTasks] = useState<Task[]>([])
  const [scheduledSummaryTasks, setScheduledSummaryTasks] = useState<ScheduledSummaryTask[]>([])
  const [currentFilter, setCurrentFilter] = useState<string>('all')
  const [modalDate, setModalDate] = useState<string | null>(null)
  const [modalTasks, setModalTasks] = useState<Task[]>([])
  const [modalSummaryTasks, setModalSummaryTasks] = useState<ScheduledSummaryTask[]>([])
  const [showManualLogModal, setShowManualLogModal] = useState(false)
  const [manualLogTaskId, setManualLogTaskId] = useState<string>('')
  const [manualLogActualTime, setManualLogActualTime] = useState<number>(0)
  const [manualLogCompletedDate, setManualLogCompletedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  )
  const [taskSearchQuery, setTaskSearchQuery] = useState('')
  const [timerTick, setTimerTick] = useState(0)
  const [availableTime, setAvailableTime] = useState<string>('-')
  const [notification, setNotification] = useState<{ message: string; type: string } | null>(null)
  const [mainTaskFilter, setMainTaskFilter] = useState<string>('All')
  const [isWidgetMinimized, setIsWidgetMinimized] = useState(false)
  const [isPoppedOut, setIsPoppedOut] = useState(false)
  const taskTimersRef = useRef<Record<string, TimerState>>({})

  // Compute unique main tasks for filtering
  const uniqueMainTasks = useMemo(() => {
    const names = tasks
      .map(t => t.description)
      .filter((n): n is string => !!n && n.trim() !== '')
    return ['All', ...Array.from(new Set(names))]
  }, [tasks])

  const showNotification = useCallback((message: string, type: string) => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 5000)
  }, [])

  const getTaskValidationStatus = useCallback((task: Task) => {
    if (task.status === 'completed') return { isValid: true, message: 'Completed' }
    if (task.status === 'failed') return { isValid: false, message: 'Window Expired' }
    if (task.status === 'paused') return { isValid: true, message: 'Paused' }
    if (task.status === 'in_progress') return { isValid: true, message: 'In Progress' }

    const activeStart = task.rescheduledActiveStart || task.predictedActiveStart;
    const activeEnd = task.rescheduledActiveEnd || task.predictedActiveEnd;
    const targetDate = task.rescheduled_date || task.time_allocation_date;

    if (!targetDate || !activeStart || !activeEnd) {
      return { isValid: false, message: 'No time window allocated' }
    }

    const now = new Date()
    const startTime = parseActiveTime(activeStart, targetDate)
    const endTime = parseActiveTime(activeEnd, targetDate)

    if (startTime && now < startTime) {
      return { isValid: false, message: `Starts at ${activeStart}` }
    }
    if (endTime && now > endTime) {
      return { isValid: false, message: 'Active window expired' }
    }
    return { isValid: true, message: 'Ready to start' }
  }, [])

  const getElapsed = useCallback((taskId: string): number => {
    const timer = taskTimersRef.current[taskId]
    if (!timer) return 0
    if (timer.isPaused || timer.segmentStart === null) return timer.accumulated
    return timer.accumulated + Math.floor((Date.now() - timer.segmentStart) / 1000)
  }, [])

  const loadTasksFromAPI = useCallback(async (silent = false) => {
    try {
      if (!silent) console.log('Fetching tasks from API...')

      // Fetch both endpoints in parallel
      const [tasksResponse, summaryResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/tasks`, { headers: authHeaders }),
        fetch(`${API_BASE_URL}/scheduled-summary`, { headers: authHeaders }),
      ])

      if (!tasksResponse.ok) throw new Error(`Tasks API error! status: ${tasksResponse.status}`)
      if (!summaryResponse.ok && !silent) console.warn('Scheduled summary API not available')

      const data = await tasksResponse.json()
      const summaryData = summaryResponse.ok ? await summaryResponse.json() : { tasks: [] }

      // Store scheduled summary tasks
      setScheduledSummaryTasks(summaryData.tasks || [])

      const loaded: Task[] = data.tasks.map((task: Record<string, unknown>) => {
        let priority: 'High' | 'Medium' | 'Low' = 'Medium'
        const mainTask = task.main_task as Record<string, unknown> | undefined
        if (mainTask?.difficulty) {
          const d = mainTask.difficulty as number
          if (d >= 4) priority = 'High'
          else if (d <= 2) priority = 'Low'
        }
        return {
          id: task.task_id as string,
          name: (task.subtask as string) || 'Unnamed Task',
          description: mainTask ? (mainTask.name as string) : '',
          category: (task.category as string) || 'general',
          predicted_time: (task.predicted_time as number) || 0,
          user_estimate: task.user_estimate as number,
          actual_time: task.actual_time as number | undefined,
          status: (task.status as Task['status']) || 'scheduled',
          time_allocation_date: task.time_allocation_date as string | undefined,
          created_date: task.created_date as string | undefined,
          completed_date: task.completed_date as string | undefined,
          confidence: (task.confidence as Task['confidence']) || 'UNKNOWN',
          method: (task.method as Task['method']) || 'unknown',
          priority,
          predictedActiveStart: task.predictedActiveStart as string | undefined,
          predictedActiveEnd: task.predictedActiveEnd as string | undefined,
          rescheduledActiveStart: task.rescheduledActiveStart as string | undefined,
          rescheduledActiveEnd: task.rescheduledActiveEnd as string | undefined,
          rescheduled_date: task.rescheduled_date as string | undefined,
          // Extract the new persistent timer fields from API
          started_date: task.started_date as string | undefined,
          accumulated_time: (task.accumulated_time as number) || 0,
          is_history: !!task.is_history,
          rescheduled: !!task.rescheduled,
          original_allocation_date: task.original_allocation_date as string | undefined,
        }
      })

      // Sync timers
      loaded.forEach(task => {
        const tAny = task as any; // Ignore TS warnings if Task interface lacks these fields
        if (task.status === 'in_progress' && !taskTimersRef.current[task.id]) {
          const interval = setInterval(() => setTimerTick(t => t + 1), 1000)
          const sysStart = tAny.started_date ? new Date(tAny.started_date).getTime() : Date.now()
          const sysAcc = tAny.accumulated_time || 0

          taskTimersRef.current[task.id] = {
            segmentStart: sysStart, accumulated: sysAcc, isPaused: false, timerInterval: interval,
          }
        } else if (task.status === 'paused' && !taskTimersRef.current[task.id]) {
          const sysAcc = tAny.accumulated_time || 0
          taskTimersRef.current[task.id] = {
            segmentStart: null, accumulated: sysAcc, isPaused: true, timerInterval: null,
          }
        } else if (task.status === 'completed' && taskTimersRef.current[task.id]) {
          const timer = taskTimersRef.current[task.id]
          if (timer.timerInterval) clearInterval(timer.timerInterval)
          delete taskTimersRef.current[task.id]
        }
      })

      setTasks(loaded)
    } catch (error) {
      console.error('Failed to load tasks from API:', error)
      if (!silent) showNotification('Failed to load tasks. Make sure the API is running at ' + API_BASE_URL, 'error')
    }
  }, [showNotification, token])

  // Initial load + polling
  useEffect(() => {
    loadTasksFromAPI()
    const interval = setInterval(() => loadTasksFromAPI(true), 5000)
    return () => clearInterval(interval)
  }, [loadTasksFromAPI])

  // Listen for active tasks popped out status
  useEffect(() => {
    if (window.electronAPI.onActiveTasksPoppedOut) {
      window.electronAPI.onActiveTasksPoppedOut(setIsPoppedOut)
    }
  }, [])

  // Available time
  useEffect(() => {
    if (!user?.id) return
    const todayStr = new Date().toISOString().split('T')[0]
    fetch(`${API_BASE_URL}/active-time/user/${user.id}?date=${todayStr}`)
      .then(r => r.json())
      .then(data => setAvailableTime(formatTime(data.total_predicted_minutes || 0)))
      .catch(() => setAvailableTime('Unavailable'))
  }, [user?.id])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(taskTimersRef.current).forEach(t => {
        if (t.timerInterval) clearInterval(t.timerInterval)
      })
    }
  }, [])

  async function startTask(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) { showNotification('Task not found.', 'error'); return }

    const validation = getTaskValidationStatus(task)
    if (!validation.isValid) {
      showNotification(`Cannot start task: ${validation.message}`, 'error')
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/start-task`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ subtask: task.name, task_id: taskId }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)

      const interval = setInterval(() => setTimerTick(t => t + 1), 1000)
      taskTimersRef.current[task.id] = {
        segmentStart: Date.now(), accumulated: 0, isPaused: false, timerInterval: interval,
      }

      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'in_progress' } : t))
      setModalTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'in_progress' } : t))
      showNotification('Task started! Timer is running.', 'success')
    } catch (error) {
      console.error('Error starting task:', error)
      showNotification(`Error: ${(error as Error).message}`, 'error')
    }
  }

  async function pauseTask(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const timer = taskTimersRef.current[task.id]
    if (!timer || timer.isPaused) return

    timer.accumulated += Math.floor((Date.now() - (timer.segmentStart ?? Date.now())) / 1000)
    timer.isPaused = true
    if (timer.timerInterval) clearInterval(timer.timerInterval)
    timer.timerInterval = null
    timer.segmentStart = null

    try {
      await fetch(`${API_BASE_URL}/pause-task`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ subtask: task.name, task_id: taskId, accumulated_time: timer.accumulated }),
      })
    } catch (error) { console.error('Error updating pause status:', error) }

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'paused' } : t))
    setModalTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'paused' } : t))
    showNotification('Task paused.', 'info')
  }

  async function resumeTask(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const timer = taskTimersRef.current[task.id]
    if (!timer || !timer.isPaused) return

    const validation = getTaskValidationStatus(task)
    if (!validation.isValid) {
      showNotification(`Cannot resume task: ${validation.message}`, 'error')
      return
    }

    const interval = setInterval(() => setTimerTick(t => t + 1), 1000)
    timer.segmentStart = Date.now()
    timer.isPaused = false
    timer.timerInterval = interval

    try {
      await fetch(`${API_BASE_URL}/resume-task`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ subtask: task.name, task_id: taskId }),
      })
    } catch (error) { console.error('Error updating resume status:', error) }

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'in_progress' } : t))
    setModalTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'in_progress' } : t))
    showNotification('Task resumed.', 'info')
  }

  async function markTaskComplete(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) { showNotification('Task not found.', 'error'); return }

    const timer = taskTimersRef.current[task.id]
    if (!timer) {
      showNotification('You must start the task before completing it.', 'error')
      return
    }

    const totalSeconds = timer.isPaused
      ? timer.accumulated
      : timer.accumulated + Math.floor((Date.now() - (timer.segmentStart ?? Date.now())) / 1000)
    const actualTimeMinutes = Math.max(1, Math.round(totalSeconds / 60))
    const estimatedTime = task.user_estimate || task.predicted_time || 0

    try {
      const response = await fetch(`${API_BASE_URL}/complete`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ subtask: task.name, task_id: taskId, actual_time: actualTimeMinutes }),
      })
      const result = await response.json()

      if (response.ok) {
        showNotification(`Task completed! Actual time: ${actualTimeMinutes} min (Estimated: ${estimatedTime} min)`, 'success')
        if (timer.timerInterval) clearInterval(timer.timerInterval)
        delete taskTimersRef.current[task.id]
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'completed', actual_time: actualTimeMinutes } : t))
        setModalTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'completed', actual_time: actualTimeMinutes } : t))
        await loadTasksFromAPI()
      } else {
        throw new Error(result.message || result.detail || 'Failed to mark task complete')
      }
    } catch (error) {
      console.error('Error marking task complete:', error)
      showNotification(`Error: ${(error as Error).message}`, 'error')
    }
  }

  async function markTaskCompleteManual() {
    if (!manualLogTaskId) { showNotification('Please select a task.', 'error'); return; }
    const task = tasks.find((t) => t.id === manualLogTaskId);
    if (!task) { showNotification('Task not found.', 'error'); return; }

    const actualTimeMinutes = manualLogActualTime > 0 ? manualLogActualTime : 1;

    try {
      const response = await fetch(`${API_BASE_URL}/complete`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          subtask: task.name,
          task_id: manualLogTaskId,
          actual_time: actualTimeMinutes,
          completed_date: new Date(manualLogCompletedDate).toISOString(),
        }),
      });
      const result = await response.json();

      if (response.ok) {
        showNotification(`Task manually completed! Logged time: ${actualTimeMinutes} min`, 'success');
        setShowManualLogModal(false);
        setManualLogTaskId('');
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: 'completed', actual_time: actualTimeMinutes } : t))
        );
        setModalTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: 'completed', actual_time: actualTimeMinutes } : t))
        );
        await loadTasksFromAPI();
      } else {
        throw new Error(result.message || result.detail || 'Failed to mark task complete manually');
      }
    } catch (error) {
      console.error('Error marking task manually:', error);
      showNotification(`Error: ${(error as Error).message}`, 'error');
    }
  }

  const [modalDeadlines, setModalDeadlines] = useState<ScheduledSummaryTask[]>([])

  function showTasksForDate(dateStr: string, tasksForDay: Task[], summaryForDay: ScheduledSummaryTask[] = [], deadlinesForDay: ScheduledSummaryTask[] = []) {
    setModalDate(dateStr)
    setModalTasks(tasksForDay)
    setModalSummaryTasks(summaryForDay)
    setModalDeadlines(deadlinesForDay)
  }

  // Calendar computation
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const today = new Date()

  type CalDay = { day: number; year: number; month: number; isOtherMonth: boolean; isToday: boolean; dateStr: string; tasksForDay: Task[]; summaryForDay: ScheduledSummaryTask[]; deadlinesForDay: ScheduledSummaryTask[] }
  const calendarDays: CalDay[] = []

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const m = month - 1
    const y = m < 0 ? year - 1 : year
    const realMonth = ((m % 12) + 12) % 12
    const dateStr = `${y}-${String(realMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    calendarDays.push({ day: d, year: y, month: realMonth, isOtherMonth: true, isToday: false, dateStr, tasksForDay: [], summaryForDay: [], deadlinesForDay: [] })
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
    let tasksForDay = tasks.filter(t => t.time_allocation_date && t.time_allocation_date.split('T')[0] === dateStr)
    let summaryForDay = scheduledSummaryTasks.filter(s => s.suggested_date && s.suggested_date.split('T')[0] === dateStr)
    let deadlinesForDay = scheduledSummaryTasks.filter(s => s.deadline && s.deadline.split('T')[0] === dateStr)

    if (mainTaskFilter !== 'All') {
      tasksForDay = tasksForDay.filter(t => t.description === mainTaskFilter)
      summaryForDay = summaryForDay.filter(s => s.main_task === mainTaskFilter)
      deadlinesForDay = deadlinesForDay.filter(s => s.main_task === mainTaskFilter)
    }

    calendarDays.push({ day, year, month, isOtherMonth: false, isToday, dateStr, tasksForDay, summaryForDay, deadlinesForDay })
  }

  const remaining = 42 - calendarDays.length
  for (let day = 1; day <= remaining; day++) {
    const m = month + 1
    const y = m > 11 ? year + 1 : year
    const realMonth = m % 12
    const dateStr = `${y}-${String(realMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    calendarDays.push({ day, year: y, month: realMonth, isOtherMonth: true, isToday: false, dateStr, tasksForDay: [], summaryForDay: [], deadlinesForDay: [] })
  }

  // Stats
  const incompleteTasks = tasks.filter(t => t.status !== 'completed')
  const high = incompleteTasks.filter(t => t.priority === 'High').length
  const medium = incompleteTasks.filter(t => t.priority === 'Medium').length
  const low = incompleteTasks.filter(t => t.priority === 'Low').length

  const todayStr = new Date().toISOString().split('T')[0]
  const todaysTasks = tasks.filter(t => t.time_allocation_date && t.time_allocation_date.split('T')[0] === todayStr)
  const todaysLoggedTime = todaysTasks.reduce((sum, t) => sum + (t.actual_time || 0), 0)

  // Filtered todo list - only show non-completed, non-failed, non-historical tasks
  let filteredTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed' && !t.is_history)
  if (currentFilter !== 'all') filteredTasks = filteredTasks.filter(t => t.priority === currentFilter)
  if (taskSearchQuery.trim() !== '') {
    filteredTasks = filteredTasks.filter(t =>
      t.name.toLowerCase().includes(taskSearchQuery.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(taskSearchQuery.toLowerCase()))
    )
  }
  filteredTasks = [...filteredTasks].sort((a, b) => {
    if (!a.time_allocation_date) return 1
    if (!b.time_allocation_date) return -1
    return new Date(a.time_allocation_date).getTime() - new Date(b.time_allocation_date).getTime()
  })

  // Modal task renderer
  function renderModalTask(task: Task) {
    const timer = taskTimersRef.current[task.id]
    const elapsed = getElapsed(task.id)
    const isFailed = task.status === 'failed'
    const isCompleted = task.status === 'completed'
    const estimatedTime = task.user_estimate || task.predicted_time
    const validation = getTaskValidationStatus(task)
    const isRescheduled = !!(task.rescheduled || (task.rescheduledActiveStart && task.rescheduledActiveEnd))

    const priorityBorder = task.priority === 'High' ? 'border-l-red-400' : task.priority === 'Low' ? 'border-l-emerald-400' : 'border-l-orange-400'

    return (
      <div key={task.id} className={`glass-card p-4 border-l-4 ${priorityBorder} ${isFailed ? 'opacity-60' : ''}`} data-task-id={task.id}>
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-sm font-bold text-slate-800 truncate ${isFailed ? 'line-through' : ''}`}>{task.name}</span>
            {isRescheduled && (
              <span className="text-[10px] font-extrabold bg-orange-100 text-orange-800 px-2 py-0.5 rounded border border-orange-200 uppercase shrink-0">
                Re-Scheduled
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Timer */}
            {timer && timer.isPaused && <span className="text-xs font-semibold text-amber-500" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(elapsed)}</span>}
            {timer && !timer.isPaused && <span className="text-xs font-semibold text-emerald-500" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(elapsed)}</span>}

            {/* Buttons */}
            {isCompleted ? (
              <span className="px-2.5 py-1 text-[10px] font-bold text-white bg-emerald-500 rounded-lg">✓ Completed</span>
            ) : isFailed ? (
              <span className="px-2.5 py-1 text-[10px] font-bold text-white bg-red-500 rounded-lg">✗ Failed</span>
            ) : !timer ? (
              <button onClick={(e) => { e.stopPropagation(); startTask(task.id) }} disabled={!validation.isValid} className="px-2.5 py-1 text-[10px] font-bold text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">▶ Start</button>
            ) : timer.isPaused ? (
              <>
                <button onClick={(e) => { e.stopPropagation(); resumeTask(task.id) }} className="px-2.5 py-1 text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors">▶ Resume</button>
                <button onClick={(e) => { e.stopPropagation(); markTaskComplete(task.id) }} className="px-2.5 py-1 text-[10px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors">✓ Done</button>
              </>
            ) : (
              <>
                <button onClick={(e) => { e.stopPropagation(); pauseTask(task.id) }} className="px-2.5 py-1 text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors">Pause</button>
                <button onClick={(e) => { e.stopPropagation(); markTaskComplete(task.id) }} className="px-2.5 py-1 text-[10px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors">✓ Done</button>
              </>
            )}
          </div>
        </div>

        {task.description && <p className="text-xs text-slate-500 mb-3"><span className="font-semibold text-slate-700">Main Task:</span> {task.description}</p>}

        {/* Meta grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50/60 border border-slate-100/60 rounded-xl p-3.5 mt-1">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category</span>
            <span className="text-xs font-semibold text-slate-700 capitalize">{task.category || 'General'}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Estimated Time</span>
            <span className="text-sm font-extrabold text-indigo-500">{formatTime(estimatedTime)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {isRescheduled ? 'Original Window' : 'Active Window'}
            </span>
            <span className={`text-xs font-bold ${isRescheduled ? 'text-red-400 line-through' : 'text-slate-600'}`}>
              {isRescheduled && task.original_allocation_date ? `${new Date(task.original_allocation_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ` : ''}
              {task.predictedActiveStart} - {task.predictedActiveEnd}
            </span>
          </div>
          {isRescheduled && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Rescheduled Window</span>
              <span className="text-xs font-bold text-indigo-600">{task.rescheduledActiveStart} - {task.rescheduledActiveEnd}</span>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status</span>
            <span className={`text-xs font-bold ${validation.isValid ? 'text-emerald-500' : 'text-red-500'}`}>
              {isRescheduled && !isCompleted && !isFailed ? 'Rescheduled' : validation.message}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Estimation Mode</span>
            <span className="text-xs font-semibold text-slate-600 capitalize">
              {task.method === 'cold_start' ? 'Cold Start' : task.method === 'warm_start' ? 'Warm Start' : task.method.replace('_', ' ')}
            </span>
          </div>
          {task.actual_time && (
            <div className="flex flex-col gap-1 col-span-full border-t border-dashed border-slate-200/60 pt-3 mt-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Completed Time</span>
              <span className="text-lg font-extrabold text-emerald-500">{formatTime(task.actual_time)}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const activeTaskIds = Object.keys(taskTimersRef.current)
  const activeTasks = tasks.filter(t => activeTaskIds.includes(t.id))

  return (
    <div className="w-full h-full">
      {!embedded && (
        <nav className="navbar">
          <div className="nav-brand" />
          <div className="nav-links">
            <span className="nav-link">PDF Analysis</span>
            <span className="nav-link active">Time Estimator</span>
          </div>
        </nav>
      )}

      {notification && (
        <div style={{
          position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999,
          padding: '0.75rem 1.25rem', borderRadius: '8px', fontWeight: 500,
          backgroundColor: notification.type === 'error' ? '#ef4444' :
            notification.type === 'success' ? '#10b981' :
              notification.type === 'info' ? '#3b82f6' : '#6c757d',
          color: 'white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          animation: 'modalSlideIn 0.3s ease'
        }}>
          {notification.message}
        </div>
      )}
      <div className="main-content">
        {/* Global Active Task Widget — Moved to top section */}
        {activeTasks.length > 0 && !isPoppedOut && (
          <div className="w-full flex flex-col glass-card overflow-hidden animate-fade-in-up mb-6 shadow-sm">
            {/* Widget Header */}
            <div className="flex justify-between items-center px-6 py-3.5 border-b border-slate-200/60 bg-white/40">
              <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                Currently Active Tasks ({activeTasks.length})
              </span>
              <div className="flex items-center gap-4">
                <span className="text-xs font-semibold text-slate-500 bg-slate-100/80 px-2.5 py-1 rounded-lg">
                  {activeTasks.filter(t => !taskTimersRef.current[t.id]?.isPaused).length} running &middot; {activeTasks.filter(t => taskTimersRef.current[t.id]?.isPaused).length} paused
                </span>
                <div className="flex items-center gap-2 border-l border-slate-200/60 pl-4 ml-1">
                  <button 
                    onClick={() => window.electronAPI.openActiveTasksWindow()}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                    title="Pop out to new window"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  </button>
                  <button 
                    onClick={() => setIsWidgetMinimized(!isWidgetMinimized)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all"
                    title={isWidgetMinimized ? "Expand" : "Minimize"}
                  >
                    {isWidgetMinimized ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Task Rows */}
            {!isWidgetMinimized && (
              <div className="max-h-[300px] overflow-y-auto flex flex-col">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0">
                  {activeTasks.map((task, idx) => {
                    const timer = taskTimersRef.current[task.id]
                    if (!timer) return null
                    const isRunning = !timer.isPaused
                    return (
                      <div 
                        key={task.id} 
                        className={`px-6 py-4 flex flex-col gap-3 transition-colors border-b border-r border-slate-100/60 ${isRunning ? 'bg-white/80' : 'bg-slate-50/60'}`}
                      >
                        {/* Task name + status dot */}
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isRunning ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)] animate-pulse' : 'bg-amber-500'
                          }`} />
                          <span className="font-bold text-slate-800 text-sm truncate flex-1" title={task.name}>
                            {task.name}
                          </span>
                        </div>

                        {/* Timer + Buttons */}
                        <div className="flex justify-between items-center bg-slate-100/40 p-2 rounded-xl border border-slate-200/20">
                          <span className="text-xl font-black text-slate-700 tracking-tighter" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatElapsed(getElapsed(task.id))}
                          </span>
                          <div className="flex gap-1.5">
                            {timer.isPaused ? (
                              <button 
                                onClick={() => resumeTask(task.id)} 
                                className="p-2 text-amber-600 bg-white hover:bg-amber-50 border border-amber-200 rounded-lg transition-all shadow-sm"
                                title="Resume"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                              </button>
                            ) : (
                              <button 
                                onClick={() => pauseTask(task.id)} 
                                className="p-2 text-amber-600 bg-white hover:bg-amber-50 border border-amber-200 rounded-lg transition-all shadow-sm"
                                title="Pause"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                              </button>
                            )}
                            <button 
                              onClick={() => markTaskComplete(task.id)} 
                              className="p-2 text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-all shadow-md shadow-emerald-100"
                              title="Complete Task"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="dashboard-grid">
          {/* Left Column */}
          <div className="left-column">
            {/* Calendar */}
            <div className="glass-card p-4 sm:p-6">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <h3 style={{ margin: 0 }}>Calendar</h3>
                  {uniqueMainTasks.length > 1 && (
                    <select
                      className="project-filter-select"
                      value={mainTaskFilter}
                      onChange={(e) => setMainTaskFilter(e.target.value)}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        color: '#475569',
                        backgroundColor: '#f8fafc',
                        cursor: 'pointer',
                        outline: 'none'
                      }}
                    >
                      {uniqueMainTasks.map(name => (
                        <option key={name} value={name}>{name === 'All' ? 'All Projects' : name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="calendar-nav">
                  <button className="btn-icon" onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
                  <span id="currentMonth">{MONTH_NAMES[month]} {year}</span>
                  <button className="btn-icon" onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
                </div>
              </div>
              <div className="card-body">
                <div className="calendar">
                  <div className="calendar-weekdays">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                      <div key={d} className="weekday">{d}</div>
                    ))}
                  </div>
                  <div className="calendar-days">
                    {calendarDays.map((cell, i) => {
                      const hasFailed = cell.tasksForDay.some(t => t.status === 'failed')
                      const hasCompleted = cell.tasksForDay.every(t => t.status === 'completed') && cell.tasksForDay.length > 0
                      const hasTasks = cell.tasksForDay.length > 0
                      const hasSummary = cell.summaryForDay.length > 0
                      const hasDeadline = cell.deadlinesForDay.length > 0
                      const hasAnyTask = hasTasks || hasSummary
                      const failedCount = cell.tasksForDay.filter(t => t.status === 'failed').length
                      const completedCount = cell.tasksForDay.filter(t => t.status === 'completed').length
                      let dayClass = 'calendar-day'
                      if (cell.isOtherMonth) dayClass += ' other-month'
                      if (cell.isToday) dayClass += ' today'
                      if (hasAnyTask) dayClass += ' has-task'
                      if (hasDeadline) dayClass += ' has-deadline'
                      if (hasFailed) dayClass += ' has-failed-task'
                      else if (hasCompleted) dayClass += ' has-completed-task'
                      return (
                        <div
                          key={i}
                          className={dayClass}
                          onClick={() => (hasAnyTask || cell.deadlinesForDay.length > 0) && showTasksForDate(cell.dateStr, cell.tasksForDay, cell.summaryForDay, cell.deadlinesForDay)}
                        >
                          <div className="day-number">{cell.day}</div>
                          {failedCount > 0 && (
                            <div className="calendar-missed-label">
                              {failedCount === 1 ? '1 task missed' : `${failedCount} missed`}
                            </div>
                          )}
                          {hasAnyTask && (
                            <div className="task-count" style={
                              hasTasks && failedCount > 0 ? { backgroundColor: '#ef4444', color: 'white' } :
                                hasTasks && completedCount === cell.tasksForDay.length ? { backgroundColor: '#10b981', color: 'white' } :
                                  !hasTasks && hasSummary ? { backgroundColor: '#ef4444', color: 'white' } :
                                    {}
                            }>
                              {hasTasks
                                ? (failedCount > 0 ? `${failedCount}` :
                                  completedCount === cell.tasksForDay.length ? `${completedCount} ✓` :
                                    cell.tasksForDay.length)
                                : cell.summaryForDay.length}
                            </div>
                          )}
                          {hasDeadline && (
                            <div className="deadline-badge" title={cell.deadlinesForDay.map(d => d.main_task || d.subtask_name).join(', ')}>
                              DL
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Statistics */}
            <div className="glass-card p-4 sm:p-6">
              <div className="card-header"><h3>Task Statistics</h3></div>
              <div className="card-body">
                <div className="stats-grid">
                  <div className="stat-card high">
                    <div className="stat-value">{high}</div>
                    <div className="stat-label">High Priority</div>
                  </div>
                  <div className="stat-card medium">
                    <div className="stat-value">{medium}</div>
                    <div className="stat-label">Medium Priority</div>
                  </div>
                  <div className="stat-card low">
                    <div className="stat-value">{low}</div>
                    <div className="stat-label">Low Priority</div>
                  </div>
                  <div className="stat-card total">
                    <div className="stat-value">{incompleteTasks.length}</div>
                    <div className="stat-label">Total Tasks</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          {/* Right Column */}
          <div className="right-column">
            {/* Todo List */}
            <div className="glass-card p-4 sm:p-6 flex flex-col gap-4">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center w-100 flex-wrap gap-3">
                  <h3 className="text-lg font-bold text-slate-800 m-0">Todo List</h3>
                  <div className="flex gap-1.5 p-1 bg-slate-100/50 rounded-xl border border-slate-200/40">
                    {['all', 'High', 'Medium', 'Low'].map(f => (
                      <button
                        key={f}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                          currentFilter === f 
                          ? 'bg-white text-indigo-600 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700'
                        }`}
                        onClick={() => setCurrentFilter(f)}
                      >
                        {f === 'all' ? 'All' : f}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Search Bar */}
                <div className="relative group">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  </span>
                  <input
                    type="text"
                    placeholder="Search tasks..."
                    value={taskSearchQuery}
                    onChange={(e) => setTaskSearchQuery(e.target.value)}
                    className="glass-input w-full pl-10 pr-10 py-2.5 text-sm"
                  />
                  {taskSearchQuery && (
                    <button 
                      onClick={() => setTaskSearchQuery('')} 
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>

              <div className="todo-list mt-2">
                {filteredTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center opacity-60">
                    <div className="text-3xl mb-2">📋</div>
                    <p className="text-sm font-medium text-slate-500">No tasks found.</p>
                  </div>
                ) : (
                  filteredTasks.map(task => {
                    const isFailed = task.status === 'failed'
                    const estimatedTime = task.user_estimate || task.predicted_time
                    const allocationDate = task.time_allocation_date
                      ? formatDate(task.time_allocation_date.split('T')[0])
                      : 'Not scheduled'
                    
                    const priorityBorder = task.priority === 'High' ? 'border-l-red-400' : task.priority === 'Low' ? 'border-l-emerald-400' : 'border-l-orange-400'

                    return (
                      <div key={task.id} className={`glass-card p-4 border-l-4 ${priorityBorder} ${isFailed ? 'opacity-60' : ''}`}>
                        <div className="flex justify-between items-start gap-2 mb-3">
                          <div className={`text-sm font-bold text-slate-800 min-w-0 break-words ${isFailed ? 'line-through' : ''}`}>
                            {task.name}
                          </div>
                          {task.rescheduled && (
                            <span className="text-[9px] font-extrabold bg-orange-100 text-orange-800 px-2 py-0.5 rounded border border-orange-200 uppercase shrink-0">
                              Re-Scheduled
                            </span>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 bg-slate-50/60 border border-slate-100/60 rounded-xl p-3.5">
                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                              Date
                            </span>
                            <span className="text-xs font-semibold text-slate-600">{allocationDate}</span>
                          </div>
                          
                          {task.predictedActiveStart && task.predictedActiveEnd && (
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                Window
                              </span>
                              <span className="text-xs font-semibold text-slate-600">{task.predictedActiveStart} - {task.predictedActiveEnd}</span>
                            </div>
                          )}

                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
                              Estimated
                            </span>
                            <span className="text-xs font-extrabold text-indigo-500">{formatTime(estimatedTime)}</span>
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                              Priority
                            </span>
                            <span className={`text-[10px] font-extrabold uppercase ${
                              task.priority === 'High' ? 'text-red-500' : task.priority === 'Low' ? 'text-emerald-500' : 'text-orange-500'
                            }`}>{task.priority}</span>
                          </div>

                          {task.method && task.method !== 'unknown' && (
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                                Mode
                              </span>
                              <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 uppercase inline-block w-fit">
                                {task.method === 'cold_start' ? 'Cold' : task.method === 'warm_start' ? 'Warm' : String(task.method).split('_')[0]}
                              </span>
                            </div>
                          )}

                          {isFailed && (
                            <div className="col-span-full flex items-center gap-2 mt-1">
                              <span className="text-red-500">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                              </span>
                              <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide">Time Window Expired</span>
                            </div>
                          )}
                        </div>

                        {task.description && (
                          <div className="text-xs text-slate-500 mt-3 line-clamp-2">
                            <span className="font-semibold text-slate-700">Main Task:</span> {task.description}
                          </div>
                        )}

                        <div className="flex justify-end mt-4 pt-3 border-t border-dashed border-slate-200/60">
                          <button
                            className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                            onClick={() => {
                              setManualLogTaskId(task.id);
                              setManualLogActualTime(estimatedTime || 1);
                              setManualLogCompletedDate(new Date().toISOString().split('T')[0]);
                              setShowManualLogModal(true);
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            Complete Offline
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Time Estimation Summary */}
            <div className="glass-card p-4 sm:p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4">Daily Summary</h3>
              <div className="space-y-1 bg-white/40 border border-slate-200/40 rounded-2xl overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-slate-200/40">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Completed</span>
                  <span className="text-xl font-extrabold text-emerald-500">{formatTime(todaysLoggedTime)}</span>
                </div>
                <div className="flex justify-between items-center p-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Available</span>
                  <span className="text-xl font-extrabold text-indigo-500">{availableTime}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {modalDate && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-900/20 backdrop-blur-[2px] flex items-center justify-center p-4 transition-all duration-500 animate-fade-in" onClick={e => { if (e.target === e.currentTarget) setModalDate(null) }}>
          <div className="glass-card w-full max-w-[680px] max-h-[85vh] flex flex-col overflow-hidden animate-fade-in-up shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 bg-white/40 shrink-0">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                Tasks for <span className="text-indigo-500">{new Date(modalDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </h3>
              <button onClick={() => setModalDate(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100/80 hover:bg-red-500 text-slate-400 hover:text-white transition-all duration-200 text-lg font-medium">&times;</button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Allocated Tasks */}
              {modalTasks.length > 0 && (
                <>
                  <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider">Scheduled Focus Tasks</p>
                  <div className="space-y-3">{modalTasks.map(renderModalTask)}</div>
                </>
              )}
              {/* Deadline Tasks */}
              {modalDeadlines.length > 0 && (() => {
                const uniqueDeadlines = modalDeadlines.filter(
                  (d, idx, arr) => arr.findIndex(x => (x.main_task || x.subtask_name) === (d.main_task || d.subtask_name)) === idx
                )
                return (
                  <>
                    <p className="text-[11px] font-bold text-orange-500 uppercase tracking-wider mt-2">Deadlines</p>
                    {uniqueDeadlines.map((d, idx) => (
                      <div key={idx} className="glass-card p-3 border-l-4 border-l-orange-400">
                        <div className="text-sm font-bold text-orange-800">{d.main_task || 'Assignment'}</div>
                        <div className="text-xs text-orange-600 mt-1">Deadline: {d.deadline}</div>
                      </div>
                    ))}
                  </>
                )
              })()}


              {/* System Suggested Tasks */}
              {(() => {
                const uniqueSummary = modalSummaryTasks.filter(
                  s => !modalTasks.some(t => t.name === s.subtask_name)
                )
                if (uniqueSummary.length === 0) return null
                return (
                  <>
                    <p className="text-[11px] font-bold text-red-500 uppercase tracking-wider mt-2">System Suggested</p>
                    {uniqueSummary.map((s, idx) => (
                      <div key={idx} className="glass-card p-3 border-l-4 border-l-red-400">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-slate-800">{s.subtask_name}</span>
                          <span className="px-2 py-0.5 text-[10px] font-bold text-red-600 bg-red-50 rounded border border-red-200 uppercase">System Suggested</span>
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Final Deadline: <span className="text-slate-600 font-semibold normal-case">{s.deadline}</span></div>
                      </div>
                    ))}
                  </>
                )
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Manual Log Modal */}
      {showManualLogModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-900/20 backdrop-blur-[2px] flex items-center justify-center p-4 transition-all duration-500 animate-fade-in" onClick={e => { if (e.target === e.currentTarget) setShowManualLogModal(false) }}>
          <div className="glass-card w-full max-w-[450px] overflow-hidden animate-fade-in-up shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200/60 bg-white/40">
              <h3 className="text-base font-bold text-slate-900 m-0">Log Offline Task</h3>
              <button onClick={() => setShowManualLogModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100/80 hover:bg-red-500 text-slate-400 hover:text-white transition-all duration-200 text-lg">&times;</button>
            </div>
            {/* Body */}
            <div className="p-5">
              {(() => {
                const targetTask = tasks.find(t => t.id === manualLogTaskId);
                return targetTask ? (
                  <div className="mb-4 p-3 bg-slate-50/60 rounded-xl border border-slate-100/60">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Task Name</div>
                    <div className="text-sm font-semibold text-slate-800">{targetTask.name}</div>
                    {targetTask.description && <div className="text-xs text-slate-500 mt-1">{targetTask.description}</div>}
                  </div>
                ) : null;
              })()}

              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="block mb-1.5 text-xs font-semibold text-slate-600">Actual Time (mins)</label>
                  <input
                    type="number"
                    className="glass-input w-full px-3 py-2.5 text-sm text-slate-800"
                    value={manualLogActualTime}
                    onChange={(e) => setManualLogActualTime(parseInt(e.target.value) || 0)}
                    min="1"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 text-xs font-semibold text-slate-600">Completion Date</label>
                  <input
                    type="date"
                    className="glass-input w-full px-3 py-2.5 text-sm text-slate-800"
                    value={manualLogCompletedDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setManualLogCompletedDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2.5 justify-end mt-3">
                <button
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  onClick={() => setShowManualLogModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                  onClick={markTaskCompleteManual}
                  disabled={!manualLogTaskId}
                >
                  ✓ Save Log
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default TimeEstimator
