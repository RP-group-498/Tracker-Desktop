import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Task, TimerState, ScheduledSummaryTask } from '../types/tasks'
import { formatElapsed } from '../hooks/useTaskTimer'
import { useAuth } from '../context/AuthContext'
import '../styles/pages.css'
import '../styles/time-estimator.css'

const API_BASE_URL = 'http://localhost:8000/api/tasks'

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

    return (
      <div key={task.id} className={`modal-task-item ${task.priority}${isFailed ? ' failed' : ''}`} data-task-id={task.id}>
        <div className="modal-task-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className={`modal-task-title${isFailed ? ' failed-title' : ''}`}>{task.name}</div>
            {isRescheduled && (
              <span style={{
                fontSize: '0.65rem', fontWeight: 900, backgroundColor: '#ffedd5', color: '#9a3412',
                padding: '2px 8px', borderRadius: '4px', border: '1px solid #fed7aa', textTransform: 'uppercase'
              }}>
                Re-Scheduled
              </span>
            )}
          </div>

          {/* Timer Display */}
          {timer && timer.isPaused && <span style={{ fontSize: '0.85em', color: '#f59e0b', fontWeight: 600 }}>{formatElapsed(elapsed)}</span>}
          {timer && !timer.isPaused && <span style={{ fontSize: '0.85em', color: '#10b981', fontWeight: 600 }}>{formatElapsed(elapsed)}</span>}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {isCompleted ? (
              <button className="btn-sm" disabled style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'default', padding: '4px 10px', borderRadius: '4px' }}>✓ Completed</button>
            ) : isFailed ? (
              <button className="btn-sm" disabled style={{ backgroundColor: '#ef4444', border: 'none', color: 'white', cursor: 'default', padding: '4px 10px', borderRadius: '4px' }}>✗ Failed</button>
            ) : !timer ? (
              <button className="btn-sm" onClick={(e) => { e.stopPropagation(); startTask(task.id) }} disabled={!validation.isValid} style={{ backgroundColor: '#4f46e5', border: 'none', color: 'white', padding: '4px 10px', borderRadius: '4px', cursor: validation.isValid ? 'pointer' : 'not-allowed', opacity: validation.isValid ? 1 : 0.6 }}>▶ Start</button>
            ) : timer.isPaused ? (
              <>
                <button className="btn-sm" onClick={(e) => { e.stopPropagation(); resumeTask(task.id) }} style={{ backgroundColor: '#f59e0b', border: 'none', color: 'white', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}>▶ Resume</button>
                <button className="btn-sm" onClick={(e) => { e.stopPropagation(); markTaskComplete(task.id) }} style={{ backgroundColor: '#10b981', border: 'none', color: 'white', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}>✓ Complete</button>
              </>
            ) : (
              <>
                <button className="btn-sm" onClick={(e) => { e.stopPropagation(); pauseTask(task.id) }} style={{ backgroundColor: '#f59e0b', border: 'none', color: 'white', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}>Pause</button>
                <button className="btn-sm" onClick={(e) => { e.stopPropagation(); markTaskComplete(task.id) }} style={{ backgroundColor: '#10b981', border: 'none', color: 'white', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}>✓ Complete</button>
              </>
            )}
          </div>

          <span dangerouslySetInnerHTML={{ __html: getStatusBadge(task.status) }} />
        </div>

        {task.description && <div className="modal-task-description"><strong>Main Task:</strong> {task.description}</div>}

        <div className="modal-task-meta-premium" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', background: '#f8fafc', padding: '16px 20px', borderRadius: '12px', marginTop: '14px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</span>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b', textTransform: 'capitalize' }}>{task.category || 'General'}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>System Estimated Time</span>
            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#6366f1' }}>{formatTime(estimatedTime)}</span>
          </div>

          {/* Original Window (The Past) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {isRescheduled ? 'Original Window' : 'Active Window'}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: isRescheduled ? '#ef4444' : '#334155', textDecoration: isRescheduled ? 'line-through' : 'none' }}>
              {isRescheduled && task.original_allocation_date ? (
                `${new Date(task.original_allocation_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · `
              ) : ''}
              {task.predictedActiveStart} - {task.predictedActiveEnd}
            </span>
          </div>

          {/* Rescheduled Window (The Future) */}
          {isRescheduled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rescheduled Window</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#4f46e5' }}>
                {task.rescheduledActiveStart} - {task.rescheduledActiveEnd}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: validation.isValid ? '#10b981' : '#ef4444' }}>
              {isRescheduled && !isCompleted && !isFailed ? 'Rescheduled' : validation.message}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estimation Mode</span>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', textTransform: 'capitalize' }}>
              {task.method === 'cold_start' ? 'Cold Start' : task.method === 'warm_start' ? 'Warm Start' : task.method.replace('_', ' ')}
            </span>
          </div>

          {task.actual_time && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1', borderTop: '1px dashed #cbd5e1', paddingTop: '12px', marginTop: '4px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completed Time</span>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#10b981' }}>{formatTime(task.actual_time)}</span>
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

      {/* Global Active Task Widget — all running tasks in one scrollable panel */}
      {activeTasks.length > 0 && (
        <div style={{
          position: 'fixed', top: '4.5rem', right: '1rem', zIndex: 9998,
          backgroundColor: '#ffffff', border: '2px solid #6366f1', borderRadius: '14px',
          boxShadow: '0 10px 30px -5px rgba(99, 102, 241, 0.18), 0 4px 12px rgba(0,0,0,0.08)',
          width: '360px', display: 'flex', flexDirection: 'column',
          animation: 'modalSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden'
        }}>
          {/* Widget Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 18px', borderBottom: '1px solid #e0e7ff',
            backgroundColor: '#f5f3ff'
          }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 900, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ⚡ Active Tasks ({activeTasks.length})
            </span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8' }}>
              {activeTasks.filter(t => !taskTimersRef.current[t.id]?.isPaused).length} running · {activeTasks.filter(t => taskTimersRef.current[t.id]?.isPaused).length} paused
            </span>
          </div>

          {/* Task Rows */}
          <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {activeTasks.map((task, idx) => {
              const timer = taskTimersRef.current[task.id]
              if (!timer) return null
              const isRunning = !timer.isPaused
              return (
                <div key={task.id} style={{
                  padding: '12px 18px',
                  borderBottom: idx < activeTasks.length - 1 ? '1px solid #f1f5f9' : 'none',
                  display: 'flex', flexDirection: 'column', gap: '8px',
                  backgroundColor: isRunning ? '#fafffe' : '#fffbf0'
                }}>
                  {/* Task name + status dot */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                      backgroundColor: isRunning ? '#10b981' : '#f59e0b',
                      boxShadow: isRunning ? '0 0 0 3px rgba(16,185,129,0.15)' : '0 0 0 3px rgba(245,158,11,0.15)'
                    }} />
                    <span style={{
                      fontWeight: 700, color: '#1e293b', fontSize: '0.88rem',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1
                    }} title={task.name}>
                      {task.name}
                    </span>
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                      color: isRunning ? '#10b981' : '#f59e0b', flexShrink: 0
                    }}>
                      {isRunning ? 'Running' : 'Paused'}
                    </span>
                  </div>

                  {/* Timer + Buttons */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#334155', fontFamily: 'monospace' }}>
                      {formatElapsed(getElapsed(task.id))}
                    </span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {timer.isPaused ? (
                        <button onClick={() => resumeTask(task.id)} style={{ backgroundColor: '#fef3c7', color: '#d97706', border: '1px solid #fcd34d', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem' }}>
                          ▶ Resume
                        </button>
                      ) : (
                        <button onClick={() => pauseTask(task.id)} style={{ backgroundColor: '#fef3c7', color: '#d97706', border: '1px solid #fcd34d', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem' }}>
                          ⏸ Pause
                        </button>
                      )}
                      <button onClick={() => markTaskComplete(task.id)} style={{ backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem', boxShadow: '0 2px 4px rgba(16,185,129,0.2)' }}>
                        ✓ Done
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="main-content">

        <div className="dashboard-grid">
          {/* Left Column */}
          <div className="left-column">
            {/* Calendar */}
            <div className="card">
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
                            <div style={{
                              fontSize: '0.62rem', color: '#ef4444', fontWeight: 800,
                              marginTop: '2px', textAlign: 'center', lineHeight: '1.2',
                              maxWidth: '100%', wordBreak: 'break-word'
                            }}>
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
            <div className="card">
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
          <div className="right-column">
            {/* Todo List */}
            <div className="card">
              <div className="card-header" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ margin: 0 }}>Todo List</h3>
                  <div className="filter-buttons" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {['all', 'High', 'Medium', 'Low'].map(f => (
                      <button
                        key={f}
                        className={`filter-btn${currentFilter === f ? ' active' : ''}`}
                        onClick={() => setCurrentFilter(f)}
                      >
                        {f === 'all' ? 'All' : f}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Search Bar */}
                <div style={{ width: '100%', display: 'flex', alignItems: 'center', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 12px' }}>
                  <span style={{ marginRight: '8px', opacity: 0.5 }}>🔍</span>
                  <input
                    type="text"
                    placeholder="Search tasks..."
                    value={taskSearchQuery}
                    onChange={(e) => setTaskSearchQuery(e.target.value)}
                    style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.9rem', color: '#1e293b' }}
                  />
                  {taskSearchQuery && (
                    <button onClick={() => setTaskSearchQuery('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', opacity: 0.5, fontSize: '1rem' }}>&times;</button>
                  )}
                </div>
              </div>
              <div className="card-body">
                <div className="todo-list">
                  {filteredTasks.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">📋</div>
                      <p>No tasks found. Tasks will appear here from the API!</p>
                    </div>
                  ) : (
                    filteredTasks.map(task => {
                      const isFailed = task.status === 'failed'
                      const estimatedTime = task.user_estimate || task.predicted_time
                      const allocationDate = task.time_allocation_date
                        ? formatDate(task.time_allocation_date.split('T')[0])
                        : 'Not scheduled'
                      return (
                        <div key={task.id} className={`todo-item ${task.priority}${isFailed ? ' failed' : ''}`}>
                          <div className="todo-header">
                            <div className={`todo-title${isFailed ? ' failed-title' : ''}`}>{task.name}</div>
                            {task.rescheduled && (
                              <span style={{
                                fontSize: '0.6rem', fontWeight: 900, backgroundColor: '#ffedd5', color: '#9a3412',
                                padding: '1px 6px', borderRadius: '4px', border: '1px solid #fed7aa', textTransform: 'uppercase'
                              }}>
                                Re-Scheduled
                              </span>
                            )}
                          </div>
                          <div className="todo-meta">
                            <div className="todo-meta-item">
                              <span style={{ color: '#6366f1' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                              </span>
                              <span>{allocationDate}</span>
                            </div>
                            {task.predictedActiveStart && task.predictedActiveEnd && (
                              <div className="todo-meta-item">
                                <span style={{ color: '#6366f1' }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                </span>
                                <span>{task.predictedActiveStart} - {task.predictedActiveEnd}</span>
                              </div>
                            )}
                            <div className="todo-meta-item">
                              <span style={{ color: '#6366f1' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
                              </span>
                              <span>{formatTime(estimatedTime)}</span>
                            </div>
                            <div className="todo-meta-item">
                              <span style={{ color: '#6366f1' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                              </span>
                              <span className={`priority-badge ${task.priority}`}>{task.priority}</span>
                            </div>
                            {task.method && task.method !== 'unknown' && (
                              <div className="todo-meta-item">
                                <span style={{ color: '#8b5cf6' }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                                </span>
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#8b5cf6', backgroundColor: '#EDE9FE', padding: '2px 6px', borderRadius: '4px' }}>
                                  {task.method === 'cold_start' ? 'Cold Start' : task.method === 'warm_start' ? 'Warm Start' : task.method.replace('_', ' ')}
                                </span>
                              </div>
                            )}
                            {isFailed && (
                              <div className="todo-meta-item" style={{ gridColumn: 'span 2' }}>
                                <span style={{ color: '#ef4444' }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                </span>
                                <span className="status-badge failed">Time Window Expired</span>
                              </div>
                            )}
                          </div>
                          {task.description && (
                            <div className="todo-description"><strong>Main Task:</strong> {task.description}</div>
                          )}
                          <div style={{ marginTop: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                              style={{ padding: '6px 12px', fontSize: '0.8rem', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
                              onClick={() => {
                                setManualLogTaskId(task.id);
                                setManualLogActualTime(estimatedTime || 1);
                                setManualLogCompletedDate(new Date().toISOString().split('T')[0]);
                                setShowManualLogModal(true);
                              }}
                            >
                              ✓ Complete Offline
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Time Estimation */}
            <div className="card">
              <div className="card-header"><h3>Time Estimation</h3></div>
              <div className="card-body">
                <div className="time-summary">
                  <div className="time-item">
                    <span className="time-label">Today's Completed Time:</span>
                    <span className="time-value">{formatTime(todaysLoggedTime)}</span>
                  </div>
                  <div className="time-item">
                    <span className="time-label">Today's Available Time:</span>
                    <span className="time-value">{availableTime}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {modalDate && (
        <div className="modal" style={{ display: 'block' }} onClick={e => { if (e.target === e.currentTarget) setModalDate(null) }}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Tasks for <span>{new Date(modalDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span></h3>
              <button className="modal-close" onClick={() => setModalDate(null)}>&times;</button>
            </div>
            <div
              className="modal-body"
            >
              {/* Allocated Tasks */}
              {modalTasks.length > 0 && (
                <>
                  <h4 style={{ margin: '12px 0 8px 0', fontSize: '0.85em', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>Scheduled Focus Tasks</h4>
                  <div>{modalTasks.map(renderModalTask)}</div>
                </>
              )}
              {/* Deadline Tasks */}
              {modalDeadlines.length > 0 && (() => {
                const uniqueDeadlines = modalDeadlines.filter(
                  (d, idx, arr) => arr.findIndex(x => (x.main_task || x.subtask_name) === (d.main_task || d.subtask_name)) === idx
                )
                return (
                  <>
                    <h4 style={{ margin: '15px 0 5px 0', fontSize: '0.9em', color: '#f97316', display: 'flex', alignItems: 'center', gap: '6px' }}>Deadlines</h4>
                    {uniqueDeadlines.map((d, idx) => (
                      <div key={idx} style={{
                        background: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
                        border: '2px solid #f97316',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        marginBottom: '8px'
                      }}>
                        <div style={{ fontWeight: 700, color: '#c2410c', fontSize: '0.95em' }}>{d.main_task || 'Assignment'}</div>
                        <div style={{ color: '#9a3412', fontSize: '0.82em', marginTop: '4px' }}>Deadline: {d.deadline}</div>
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
                    <h4 style={{ margin: '15px 0 5px 0', fontSize: '0.9em', color: '#ef4444' }}>System Suggested</h4>
                    {uniqueSummary.map((s, idx) => (
                      <div key={idx} className="modal-task-item Medium" style={{ borderLeftColor: '#ef4444' }}>
                        <div className="modal-task-header">
                          <div className="modal-task-title">{s.subtask_name}</div>
                          <span className="status-badge" style={{ backgroundColor: '#fee2e2', color: '#ef4444' }}>System Suggested</span>
                        </div>
                        <div className="modal-task-meta">
                          <div className="modal-meta-item">
                            <span className="meta-label">Final Deadline:</span>
                            <span className="meta-value">{s.deadline}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Manual Log Modal */}
      {showManualLogModal && (
        <div className="modal" style={{ display: 'flex', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, alignItems: 'center', justifyContent: 'center' }} onClick={e => { if (e.target === e.currentTarget) setShowManualLogModal(false) }}>
          <div className="modal-content" style={{ maxWidth: '450px', borderRadius: '12px', overflow: 'hidden', margin: 0 }}>
            <div className="modal-header" style={{ backgroundColor: '#f8fafc', padding: '15px 20px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: 0, color: '#1e293b' }}>Log Offline Task</h3>
              <button className="modal-close" onClick={() => setShowManualLogModal(false)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              {(() => {
                const targetTask = tasks.find(t => t.id === manualLogTaskId);
                return targetTask ? (
                  <div style={{ marginBottom: '16px', padding: '12px', background: '#f1f5f9', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, marginBottom: '4px' }}>Task Name</div>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '1.05rem' }}>{targetTask.name}</div>
                    {targetTask.description && <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '4px' }}>{targetTask.description}</div>}
                  </div>
                ) : null;
              })()}

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#334155', fontSize: '0.85rem' }}>Actual Time (mins)</label>
                  <input
                    type="number"
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}
                    value={manualLogActualTime}
                    onChange={(e) => setManualLogActualTime(parseInt(e.target.value) || 0)}
                    min="1"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#334155', fontSize: '0.85rem' }}>Completion Date</label>
                  <input
                    type="date"
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}
                    value={manualLogCompletedDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setManualLogCompletedDate(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button
                  style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => setShowManualLogModal(false)}
                >
                  Cancel
                </button>
                <button
                  style={{ padding: '8px 16px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                  onClick={markTaskCompleteManual}
                  disabled={!manualLogTaskId}
                >
                  <span style={{ opacity: manualLogTaskId ? 1 : 0.6 }}>✓ Save Log</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TimeEstimator
