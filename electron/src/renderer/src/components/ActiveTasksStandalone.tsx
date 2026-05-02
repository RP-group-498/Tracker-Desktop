import React, { useEffect, useState, useRef } from 'react'

const API_BASE_URL = 'http://localhost:8000/api/tasks'

interface TimerState {
  segmentStart: number | null
  accumulated: number
  isPaused: boolean
  timerInterval: NodeJS.Timeout | null
}

const ActiveTasksStandalone: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([])
  const [timerTick, setTimerTick] = useState(0)
  const taskTimersRef = useRef<Record<string, TimerState>>({})
  const [token, setToken] = useState<string>('')
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI.getAuthToken().then(data => {
      if (data?.token) setToken(data.token)
    })
  }, [])

  const loadTasks = async () => {
    if (!token) return
    try {
      const response = await fetch(`${API_BASE_URL}/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) return
      const data = await response.json()
      
      ;(data.tasks || []).forEach((task: any) => {
        if (task.status === 'in_progress' && !taskTimersRef.current[task.task_id]) {
          const interval = setInterval(() => setTimerTick(t => t + 1), 1000)
          taskTimersRef.current[task.task_id] = {
            segmentStart: task.started_date ? new Date(task.started_date).getTime() : Date.now(),
            accumulated: task.accumulated_time || 0,
            isPaused: false,
            timerInterval: interval,
          }
        } else if (task.status === 'paused' && !taskTimersRef.current[task.task_id]) {
          taskTimersRef.current[task.task_id] = {
            segmentStart: null,
            accumulated: task.accumulated_time || 0,
            isPaused: true,
            timerInterval: null,
          }
        } else if (task.status === 'completed' && taskTimersRef.current[task.task_id]) {
          const timer = taskTimersRef.current[task.task_id]
          if (timer.timerInterval) clearInterval(timer.timerInterval)
          delete taskTimersRef.current[task.task_id]
        }
      })
      setTasks(data.tasks || [])
    } catch (e) {}
  }

  useEffect(() => {
    loadTasks()
    const int = setInterval(loadTasks, 5000)
    return () => clearInterval(int)
  }, [token])

  useEffect(() => {
    return () => {
      Object.values(taskTimersRef.current).forEach(t => {
        if (t.timerInterval) clearInterval(t.timerInterval)
      })
    }
  }, [])

  const getElapsed = (taskId: string) => {
    const timer = taskTimersRef.current[taskId]
    if (!timer) return 0
    if (timer.isPaused) return timer.accumulated
    return timer.accumulated + Math.floor((Date.now() - (timer.segmentStart ?? Date.now())) / 1000)
  }

  useEffect(() => {
    if (!contentRef.current || !window.electronAPI.resizeActiveTasksWindow) return;
    
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const height = Math.ceil(entry.contentRect.height) + 16; 
        window.electronAPI.resizeActiveTasksWindow(height);
      }
    });
    
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  const formatElapsed = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const action = async (endpoint: string, task: any, extraBody: any = {}) => {
    await fetch(`${API_BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subtask: task.subtask, task_id: task.task_id, ...extraBody })
    })
    loadTasks()
  }

  const pauseTask = (task: any) => {
    const timer = taskTimersRef.current[task.task_id]
    if (!timer || timer.isPaused) return
    timer.accumulated += Math.floor((Date.now() - (timer.segmentStart ?? Date.now())) / 1000)
    timer.isPaused = true
    if (timer.timerInterval) clearInterval(timer.timerInterval)
    timer.timerInterval = null
    timer.segmentStart = null
    action('pause-task', task, { accumulated_time: timer.accumulated })
  }

  const resumeTask = (task: any) => {
    const timer = taskTimersRef.current[task.task_id]
    if (!timer || !timer.isPaused) return
    timer.segmentStart = Date.now()
    timer.isPaused = false
    timer.timerInterval = setInterval(() => setTimerTick(t => t + 1), 1000)
    action('resume-task', task)
  }

  const markComplete = (task: any) => {
    const timer = taskTimersRef.current[task.task_id]
    if (!timer) return
    const totalSeconds = timer.isPaused ? timer.accumulated : timer.accumulated + Math.floor((Date.now() - (timer.segmentStart ?? Date.now())) / 1000)
    const actualTimeMinutes = Math.max(1, Math.round(totalSeconds / 60))
    action('complete', task, { actual_time: actualTimeMinutes })
  }

  const activeTasks = tasks.filter(t => Object.keys(taskTimersRef.current).includes(t.task_id))

  return (
    <div className="w-full h-full bg-transparent p-2 flex items-start">
      <div ref={contentRef} className="w-full flex flex-col glass-card overflow-hidden shadow-2xl max-h-full" style={{ WebkitAppRegion: 'drag' } as any}>
        {/* Widget Header */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200/60 bg-white/40">
          <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            Active Tasks ({activeTasks.length})
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold text-slate-500" style={{ WebkitAppRegion: 'no-drag' } as any}>
              {activeTasks.filter(t => !taskTimersRef.current[t.task_id]?.isPaused).length} running &middot; {activeTasks.filter(t => taskTimersRef.current[t.task_id]?.isPaused).length} paused
            </span>
            <button 
              onClick={() => window.close()}
              className="text-slate-400 hover:text-red-500 transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as any}
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>

        {/* Task Rows */}
        <div className="flex-1 overflow-y-auto flex flex-col" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {activeTasks.map((task, idx) => {
            const timer = taskTimersRef.current[task.task_id]
            if (!timer) return null
            const isRunning = !timer.isPaused
            return (
              <div 
                key={task.task_id} 
                className={`px-4 py-3 flex flex-col gap-2 transition-colors ${
                  idx < activeTasks.length - 1 ? 'border-b border-slate-100/60' : ''
                } ${isRunning ? 'bg-white/60' : 'bg-slate-50/40'}`}
              >
                {/* Task name + status dot */}
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    isRunning ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]' : 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]'
                  }`} />
                  <span className="font-semibold text-slate-800 text-sm truncate flex-1" title={task.subtask}>
                    {task.subtask}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                    isRunning ? 'text-emerald-600' : 'text-amber-600'
                  }`}>
                    {isRunning ? 'Running' : 'Paused'}
                  </span>
                </div>

                {/* Timer + Buttons */}
                <div className="flex justify-between items-center mt-1">
                  <span className="text-lg font-bold text-slate-700 tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatElapsed(getElapsed(task.task_id))}
                  </span>
                  <div className="flex gap-2">
                    {timer.isPaused ? (
                      <button 
                        onClick={() => resumeTask(task)} 
                        className="px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Resume
                      </button>
                    ) : (
                      <button 
                        onClick={() => pauseTask(task)} 
                        className="px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause
                      </button>
                    )}
                    <button 
                      onClick={() => markComplete(task)} 
                      className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors shadow-sm flex items-center gap-1"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Done
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {activeTasks.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm font-medium">No active tasks</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ActiveTasksStandalone
