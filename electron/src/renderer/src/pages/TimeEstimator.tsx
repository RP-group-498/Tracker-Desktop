import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Task, TimerState, ScheduledSummaryTask } from '../types/tasks'
import { formatElapsed } from '../hooks/useTaskTimer'
import '../styles/pages.css'
import '../styles/time-estimator.css'

const API_BASE_URL = 'http://localhost:8000/api/tasks'
const USER_ID = 'student_123'

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
    failed: '<span class="status-badge failed">⚠️ Failed - Time Expired</span>',
    paused: '<span class="status-badge in-progress">Paused</span>',
  }
  return badges[status] || '<span class="status-badge">Unknown</span>'
}

interface TimeEstimatorProps {
  embedded?: boolean
}

const TimeEstimator: React.FC<TimeEstimatorProps> = ({ embedded = false }) => {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [tasks, setTasks] = useState<Task[]>([])
  const [scheduledSummaryTasks, setScheduledSummaryTasks] = useState<ScheduledSummaryTask[]>([])
  const [currentFilter, setCurrentFilter] = useState<string>('all')
  const [modalDate, setModalDate] = useState<string | null>(null)
  const [modalTasks, setModalTasks] = useState<Task[]>([])
  const [modalSummaryTasks, setModalSummaryTasks] = useState<ScheduledSummaryTask[]>([])
  const [timerTick, setTimerTick] = useState(0)
  const [availableTime, setAvailableTime] = useState<string>('-')
  const [notification, setNotification] = useState<{ message: string; type: string } | null>(null)
  const taskTimersRef = useRef<Record<string, TimerState>>({})

  const showNotification = useCallback((message: string, type: string) => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 5000)
  }, [])

  const getTaskValidationStatus = useCallback((task: Task) => {
    if (task.status === 'completed') return { isValid: true, message: 'Completed' }
    if (task.status === 'failed') return { isValid: false, message: 'Window Expired' }

    if (!task.time_allocation_date || !task.predictedActiveStart || !task.predictedActiveEnd) {
      return { isValid: false, message: 'No time window allocated' }
    }

    const now = new Date()
    const startTime = parseActiveTime(task.predictedActiveStart, task.time_allocation_date)
    const endTime = parseActiveTime(task.predictedActiveEnd, task.time_allocation_date)

    if (startTime && now < startTime) {
      return { isValid: false, message: `Starts at ${task.predictedActiveStart}` }
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
        fetch(`${API_BASE_URL}/tasks/${USER_ID}`),
        fetch(`${API_BASE_URL}/scheduled-summary/${USER_ID}`),
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
        }
      })

      // Sync timers
      loaded.forEach(task => {
        if (task.status === 'in_progress' && !taskTimersRef.current[task.id]) {
          const interval = setInterval(() => setTimerTick(t => t + 1), 1000)
          taskTimersRef.current[task.id] = {
            segmentStart: Date.now(), accumulated: 0, isPaused: false, timerInterval: interval,
          }
        } else if (task.status === 'paused' && !taskTimersRef.current[task.id]) {
          taskTimersRef.current[task.id] = {
            segmentStart: null, accumulated: 0, isPaused: true, timerInterval: null,
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
  }, [showNotification])

  // Initial load + polling
  useEffect(() => {
    loadTasksFromAPI()
    const interval = setInterval(() => loadTasksFromAPI(true), 5000)
    return () => clearInterval(interval)
  }, [loadTasksFromAPI])

  // Available time
  useEffect(() => {
    fetch(`${API_BASE_URL}/active-time/user/user_003`)
      .then(r => r.json())
      .then(data => setAvailableTime(formatTime(data.total_predicted_minutes || 0)))
      .catch(() => setAvailableTime('Unavailable'))
  }, [])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(taskTimersRef.current).forEach(t => {
        if (t.timerInterval) clearInterval(t.timerInterval)
      })
    }
  }, [])

  async function startTask(taskName: string) {
    const task = tasks.find(t => t.name === taskName)
    if (!task) { showNotification('Task not found.', 'error'); return }

    const validation = getTaskValidationStatus(task)
    if (!validation.isValid) {
      showNotification(`Cannot start task: ${validation.message}`, 'error')
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/start-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtask: taskName, user_id: USER_ID }),
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

  async function pauseTask(taskName: string) {
    const task = tasks.find(t => t.name === taskName)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtask: taskName, user_id: USER_ID }),
      })
    } catch (error) { console.error('Error updating pause status:', error) }

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'paused' } : t))
    setModalTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'paused' } : t))
    showNotification('Task paused.', 'info')
  }

  async function resumeTask(taskName: string) {
    const task = tasks.find(t => t.name === taskName)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtask: taskName, user_id: USER_ID }),
      })
    } catch (error) { console.error('Error updating resume status:', error) }

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'in_progress' } : t))
    setModalTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'in_progress' } : t))
    showNotification('Task resumed.', 'info')
  }

  async function markTaskComplete(taskName: string) {
    const task = tasks.find(t => t.name === taskName)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtask: taskName, user_id: USER_ID, actual_time: actualTimeMinutes }),
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

  function showTasksForDate(dateStr: string, tasksForDay: Task[], summaryForDay: ScheduledSummaryTask[] = []) {
    setModalDate(dateStr)
    setModalTasks(tasksForDay)
    setModalSummaryTasks(summaryForDay)
  }

  // Calendar computation
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const today = new Date()

  type CalDay = { day: number; year: number; month: number; isOtherMonth: boolean; isToday: boolean; dateStr: string; tasksForDay: Task[]; summaryForDay: ScheduledSummaryTask[] }
  const calendarDays: CalDay[] = []

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const m = month - 1
    const y = m < 0 ? year - 1 : year
    const realMonth = ((m % 12) + 12) % 12
    const dateStr = `${y}-${String(realMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    calendarDays.push({ day: d, year: y, month: realMonth, isOtherMonth: true, isToday: false, dateStr, tasksForDay: [], summaryForDay: [] })
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
    const tasksForDay = tasks.filter(t => t.time_allocation_date && t.time_allocation_date.split('T')[0] === dateStr)
    const summaryForDay = scheduledSummaryTasks.filter(s => s.suggested_date && s.suggested_date.split('T')[0] === dateStr)
    calendarDays.push({ day, year, month, isOtherMonth: false, isToday, dateStr, tasksForDay, summaryForDay })
  }

  const remaining = 42 - calendarDays.length
  for (let day = 1; day <= remaining; day++) {
    const m = month + 1
    const y = m > 11 ? year + 1 : year
    const realMonth = m % 12
    const dateStr = `${y}-${String(realMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    calendarDays.push({ day, year: y, month: realMonth, isOtherMonth: true, isToday: false, dateStr, tasksForDay: [], summaryForDay: [] })
  }

  // Stats
  const incompleteTasks = tasks.filter(t => t.status !== 'completed')
  const high = incompleteTasks.filter(t => t.priority === 'High').length
  const medium = incompleteTasks.filter(t => t.priority === 'Medium').length
  const low = incompleteTasks.filter(t => t.priority === 'Low').length
  const totalEstimatedTime = incompleteTasks.reduce((sum, t) => sum + (t.user_estimate || t.predicted_time || 0), 0)

  // Filtered todo list
  let filteredTasks = tasks.filter(t => t.status !== 'completed')
  if (currentFilter !== 'all') filteredTasks = filteredTasks.filter(t => t.priority === currentFilter)
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
    const activeWindowHtml = task.predictedActiveStart && task.predictedActiveEnd
      ? `<div class="modal-meta-item"><span class="meta-label">Active Window:</span><span class="meta-value">${task.predictedActiveStart} - ${task.predictedActiveEnd}</span></div>`
      : ''

    const validation = getTaskValidationStatus(task)
    const validationHtml = `<div class="modal-meta-item"><span class="meta-label">Status:</span><span class="meta-value" style="color: ${validation.isValid ? '#10b981' : '#ef4444'}">${validation.message}</span></div>`

    let buttonHTML = ''
    let timerHTML = ''

    if (isCompleted) {
      buttonHTML = '<button class="btn-sm btn-success" disabled style="background-color:#10b981;border:none;color:white;cursor:default;">✓ Completed</button>'
    } else if (isFailed) {
      buttonHTML = '<button class="btn-sm btn-danger" disabled style="background-color:#ef4444;border:none;color:white;cursor:default;">✗ Failed</button>'
    } else if (!timer) {
      buttonHTML = `<button class="btn-sm btn-primary start-task-btn" data-task-name="${task.name}" ${!validation.isValid ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : ''}>▶ Start</button>`
    } else if (timer.isPaused) {
      timerHTML = `<span id="timer-${task.id}" style="font-size:0.85em;color:#f59e0b;font-weight:600;">${formatElapsed(elapsed)}</span>`
      buttonHTML = `<button class="btn-sm resume-task-btn" data-task-name="${task.name}" style="background-color:#f59e0b;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;">▶ Resume</button>
        <button class="btn-sm mark-complete-btn" data-task-name="${task.name}" style="background-color:#10b981;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;">✓ Complete</button>`
    } else {
      timerHTML = `<span id="timer-${task.id}" style="font-size:0.85em;color:#10b981;font-weight:600;">${formatElapsed(elapsed)}</span>`
      buttonHTML = `<button class="btn-sm pause-task-btn" data-task-name="${task.name}" style="background-color:#f59e0b;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;">Pause</button>
        <button class="btn-sm mark-complete-btn" data-task-name="${task.name}" style="background-color:#10b981;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;">✓ Complete</button>`
    }

    return `
      <div class="modal-task-item ${task.priority}${isFailed ? ' failed' : ''}" data-task-id="${task.id}">
        <div class="modal-task-header">
          <div class="modal-task-title${isFailed ? ' failed-title' : ''}">${task.name}</div>
          ${timerHTML}
          ${buttonHTML}
          ${getStatusBadge(task.status)}
        </div>
        ${task.description ? `<div class="modal-task-description"><strong>Main Task:</strong> ${task.description}</div>` : ''}
        <div class="modal-task-meta">
          <div class="modal-meta-item"><span class="meta-label">Category:</span><span class="meta-value">${task.category || 'general'}</span></div>
          <div class="modal-meta-item"><span class="meta-label">Estimated Time:</span><span class="meta-value">${formatTime(estimatedTime)}</span></div>
          ${activeWindowHtml}
          ${validationHtml}
          <div class="modal-meta-item"><span class="meta-label">Confidence:</span><span class="meta-value confidence-${task.confidence}">${task.confidence}</span></div>
          <div class="modal-meta-item"><span class="meta-label">Method:</span><span class="meta-value">${task.method}</span></div>
          ${task.actual_time ? `<div class="modal-meta-item"><span class="meta-label">Actual Time:</span><span class="meta-value">${formatTime(task.actual_time)}</span></div>` : ''}
        </div>
      </div>
    `
  }

  function handleModalClick(e: React.MouseEvent<HTMLDivElement>) {
    const btn = e.target as HTMLElement
    const taskName = btn.getAttribute('data-task-name')
    if (!taskName) return
    if (btn.classList.contains('start-task-btn')) startTask(taskName)
    else if (btn.classList.contains('pause-task-btn')) pauseTask(taskName)
    else if (btn.classList.contains('resume-task-btn')) resumeTask(taskName)
    else if (btn.classList.contains('mark-complete-btn')) markTaskComplete(taskName)
  }

  return (
    <div className="container">
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
        <div className="page-header">
          <h2>Adaptive Time Estimator</h2>
          <p>Manage your tasks with calendar view and smart time estimation</p>
        </div>

        <div className="dashboard-grid">
          {/* Left Column */}
          <div className="left-column">
            {/* Calendar */}
            <div className="card">
              <div className="card-header">
                <h3>Calendar</h3>
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
                      const hasAnyTask = hasTasks || hasSummary
                      const failedCount = cell.tasksForDay.filter(t => t.status === 'failed').length
                      const completedCount = cell.tasksForDay.filter(t => t.status === 'completed').length
                      let dayClass = 'calendar-day'
                      if (cell.isOtherMonth) dayClass += ' other-month'
                      if (cell.isToday) dayClass += ' today'
                      if (hasAnyTask) dayClass += ' has-task'
                      if (hasFailed) dayClass += ' has-failed-task'
                      else if (hasCompleted) dayClass += ' has-completed-task'
                      return (
                        <div
                          key={i}
                          className={dayClass}
                          onClick={() => hasAnyTask && showTasksForDate(cell.dateStr, cell.tasksForDay, cell.summaryForDay)}
                        >
                          <div className="day-number">{cell.day}</div>
                          {hasAnyTask && (
                            <div className="task-count" style={
                              hasTasks && failedCount > 0 ? { backgroundColor: '#ef4444', color: 'white' } :
                                hasTasks && completedCount === cell.tasksForDay.length ? { backgroundColor: '#10b981', color: 'white' } :
                                  !hasTasks && hasSummary ? { backgroundColor: '#ef4444', color: 'white' } :
                                    {}
                            }>
                              {hasTasks
                                ? (failedCount > 0 ? `${failedCount} ✗` :
                                  completedCount === cell.tasksForDay.length ? `${completedCount} ✓` :
                                    cell.tasksForDay.length)
                                : cell.summaryForDay.length}
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
              <div className="card-header">
                <h3>Todo List</h3>
                <div className="filter-buttons">
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
                          </div>
                          <div className="todo-meta">
                            <div className="todo-meta-item"><span>📅</span><span>{allocationDate}</span></div>
                            {task.predictedActiveStart && task.predictedActiveEnd && (
                              <div className="todo-meta-item">
                                <span>🕒</span>
                                <span>{task.predictedActiveStart} - {task.predictedActiveEnd}</span>
                              </div>
                            )}
                            <div className="todo-meta-item"><span>⏱️</span><span>{formatTime(estimatedTime)}</span></div>
                            <div className="todo-meta-item">
                              <span className={`priority-badge ${task.priority}`}>{task.priority}</span>
                            </div>
                            <div className="todo-meta-item">
                              <span className={`confidence-badge ${task.confidence}`}>{task.confidence}</span>
                            </div>
                            {isFailed && (
                              <div className="todo-meta-item">
                                <span className="status-badge failed">⚠️ Time Window Expired</span>
                              </div>
                            )}
                          </div>
                          {task.description && (
                            <div className="todo-description"><strong>Main Task:</strong> {task.description}</div>
                          )}
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
                    <span className="time-label">Total Estimated Time:</span>
                    <span className="time-value">{formatTime(totalEstimatedTime)}</span>
                  </div>
                  <div className="time-item">
                    <span className="time-label">Available Time (Next 7 days):</span>
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
              // timerTick forces re-render for live timer updates
              key={timerTick}
              onClick={handleModalClick}
            >
              {/* Allocated Tasks */}
              {modalTasks.length > 0 && (
                <>
                  <h4 style={{ margin: '10px 0 5px 0', fontSize: '0.9em', color: '#4b5563' }}>Allocated Tasks</h4>
                  <div dangerouslySetInnerHTML={{ __html: modalTasks.map(renderModalTask).join('') }} />
                </>
              )}
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
    </div>
  )
}

export default TimeEstimator
