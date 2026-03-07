import React, { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { TaskData, Subtask } from '../types/tasks'
import '../styles/pages.css'
import '../styles/pdf-analysis.css'

const API_BASE_URL = 'http://localhost:8000/api/tasks'
const USER_ID = 'student_123'

function formatTime(minutes: number): string {
  if (minutes === 0 || !minutes) return '0 minutes'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0 && mins > 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ${mins} ${mins === 1 ? 'minute' : 'minutes'}`
  } else if (hours > 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  } else {
    return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`
  }
}

const PDFAnalysis: React.FC = () => {
  const [inputMode, setInputMode] = useState<'pdf' | 'text'>('pdf')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [deadline, setDeadline] = useState('')
  const [credits, setCredits] = useState(1)
  const [weight, setWeight] = useState(0)
  const [textContent, setTextContent] = useState('')
  const [taskData, setTaskData] = useState<TaskData | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [hasBeenSaved, setHasBeenSaved] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notification, setNotification] = useState<{ message: string; type: string } | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [sliderValues, setSliderValues] = useState<number[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    if (taskData?.sub_tasks) {
      setSliderValues(taskData.sub_tasks.map(s => s.estimated_minutes || 0))
    }
  }, [taskData])

  function showNotification(message: string, type: string) {
    setNotification({ message, type })
    if (type === 'error') {
      setTimeout(() => setNotification(null), 5000)
    } else {
      setTimeout(() => setNotification(null), 3000)
    }
  }

  function handleFileSelect(file: File | null) {
    if (!file) return
    if (file.type !== 'application/pdf') {
      showNotification('Please select a PDF file', 'error')
      return
    }
    setSelectedFile(file)
  }

  function clearFileSelection() {
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function getPredictionsFromAPI(data: TaskData): Promise<TaskData> {
    try {
      const subtasks = data.sub_tasks.map(subtask => ({
        name: subtask.name,
        ai_suggested_time: subtask.estimated_minutes || null,
      }))

      const requestData = {
        user_id: USER_ID,
        main_task: { name: data.task_name || 'Assignment' },
        subtasks,
      }

      const response = await fetch(`${API_BASE_URL}/predict-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      })

      if (!response.ok) throw new Error(`API error! status: ${response.status}`)

      const predictions = await response.json()

      if (predictions.predictions && predictions.predictions.length > 0) {
        let totalEstimatedTime = 0
        const updatedSubtasks: Subtask[] = data.sub_tasks.map((subtask, index) => {
          const prediction = predictions.predictions[index]
          const aiEstimateMinutes = subtask.estimated_minutes || 0
          const finalTime = prediction.method === 'warm_start' ? prediction.predicted_time : aiEstimateMinutes
          totalEstimatedTime += finalTime
          return {
            ...subtask,
            estimated_minutes: finalTime,
            ai_estimated_minutes: aiEstimateMinutes,
            api_predicted_minutes: prediction.predicted_time,
            confidence: prediction.confidence,
            method: prediction.method,
            suggested_date: subtask.suggested_date // Preserve from Gemini
          }
        })
        return { ...data, sub_tasks: updatedSubtasks, total_estimated_time: totalEstimatedTime }
      }
    } catch (error) {
      console.error('Failed to get predictions from API:', error)
      showNotification('Time estimation unavailable - using default estimates', 'warning')
    }
    return data
  }

  async function analyzeTask(e: React.FormEvent) {
    e.preventDefault()

    if (inputMode === 'pdf' && !selectedFile) {
      showNotification('Please select a PDF file', 'error')
      return
    }
    if (inputMode === 'text' && !textContent.trim()) {
      showNotification('Please paste your task content', 'error')
      return
    }
    if (!deadline || !credits || weight === undefined) {
      showNotification('Please fill in all fields', 'error')
      return
    }
    if (credits < 1 || credits > 4) {
      showNotification('Credits must be between 1 and 4', 'error')
      return
    }
    if (weight < 0 || weight > 100) {
      showNotification('Weight must be between 0 and 100', 'error')
      return
    }

    setIsLoading(true)
    setTaskData(null)
    setHasBeenSaved(false)
    setHasUnsavedChanges(false)
    setIsEditMode(false)

    try {
      const analysisData: Record<string, unknown> = { deadline, credits, weight }
      if (inputMode === 'pdf' && selectedFile) {
        analysisData.pdfPath = (selectedFile as File & { path?: string }).path
      } else {
        analysisData.textContent = textContent
      }

      const result = await window.electronAPI.analyzePdf(analysisData as {
        pdfPath?: string; textContent?: string; deadline: string; credits: number; weight: number
      })

      if (result && result.tasks && result.tasks.length > 0) {
        const raw: TaskData = result.tasks[0] as TaskData
        const withPredictions = await getPredictionsFromAPI(raw)
        setTaskData(withPredictions)
        showNotification('Analysis completed successfully! You can now adjust times and save.', 'success')
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 100)
      } else {
        throw new Error('No results returned from analysis')
      }
    } catch (error) {
      console.error('Analysis error:', error)
      const source = inputMode === 'pdf' ? 'PDF' : 'text content'
      showNotification(`Failed to analyze ${source}. Please try again.`, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  function toggleEditMode() {
    if (hasBeenSaved && !isEditMode) {
      showNotification('Tasks have already been saved. You cannot edit them again.', 'warning')
      return
    }
    setIsEditMode(prev => !prev)
  }

  function handleSliderChange(index: number, value: number) {
    setSliderValues(prev => {
      const next = [...prev]
      next[index] = value
      return next
    })
    setTaskData(prev => {
      if (!prev) return prev
      const updatedSubtasks = prev.sub_tasks.map((s, i) =>
        i === index ? { ...s, user_selected_minutes: value } : s
      )
      return { ...prev, sub_tasks: updatedSubtasks }
    })
    setHasUnsavedChanges(true)
  }

  function cancelEdit() {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Are you sure you want to cancel?')) return
    }
    // Reset sliders to original estimated times
    if (taskData) {
      setSliderValues(taskData.sub_tasks.map(s => s.estimated_minutes || 0))
      setTaskData(prev => {
        if (!prev) return prev
        const reset = prev.sub_tasks.map(s => ({ ...s, user_selected_minutes: null }))
        return { ...prev, sub_tasks: reset }
      })
    }
    setHasUnsavedChanges(false)
    setIsEditMode(false)
  }

  async function saveAllTasks() {
    if (!taskData) {
      showNotification('No task data available to save', 'error')
      return
    }

    const predictions = taskData.sub_tasks.map((subtask, index) => {
      const userSelectedTime = sliderValues[index] ?? subtask.estimated_minutes
      return {
        subtask_text: subtask.name,
        subtask_number: index + 1,
        method: subtask.method || 'cold_start',
        predicted_time: subtask.estimated_minutes,
        user_estimate: userSelectedTime,
        confidence: subtask.confidence || 'MEDIUM',
        category: subtask.category || 'general',
        suggested_date: subtask.suggested_date // Pass through to backend
      }
    })

    const requestData = {
      user_id: USER_ID,
      main_task: {
        name: taskData.task_name,
        difficulty: taskData.metrics.difficulty_rating,
        deadline: taskData.metrics.deadline,
        days_left: taskData.metrics.days_left,
        credits: taskData.metrics.credits,
        weight: taskData.metrics.percentage || taskData.weight,
        final_mcdm_score: taskData.mcdm_calculation.final_weighted_score,
        priority: taskData.priority,
      },
      predictions,
    }

    try {
      const response = await fetch(`${API_BASE_URL}/save-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      })
      if (!response.ok) throw new Error(`API error! status: ${response.status}`)
      await response.json()
      showNotification('Tasks saved successfully! Times are now locked and cannot be edited again.', 'success')
      setHasUnsavedChanges(false)
      setHasBeenSaved(true)
      setIsEditMode(false)
    } catch (error) {
      console.error('Failed to save tasks:', error)
      showNotification('Failed to save tasks. Please try again.', 'error')
    }
  }

  const totalSliderTime = sliderValues.reduce((sum, v) => sum + v, 0)

  return (
    <div className="container">
      <nav className="navbar">
        <div className="nav-brand" />
        <div className="nav-links">
          <Link to="/pdf-analysis" className="nav-link active">PDF Analysis</Link>
          <Link to="/time-estimator" className="nav-link">Time Estimator</Link>
        </div>
      </nav>

      {notification && (
        <div style={{
          position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999,
          padding: '0.75rem 1.25rem', borderRadius: '8px', fontWeight: 500,
          backgroundColor: notification.type === 'error' ? '#dc3545' :
                           notification.type === 'success' ? '#28a745' :
                           notification.type === 'warning' ? '#ffc107' : '#6c757d',
          color: notification.type === 'warning' ? '#212529' : 'white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {notification.message}
        </div>
      )}

      <div className="main-content">
        <div className="page-header">
          <h2>Task Analysis</h2>
          <p>Upload a PDF or paste text to calculate task priority</p>
        </div>

        {/* Input Mode Tabs */}
        <div className="tabs">
          <button
            className={`tab-link${inputMode === 'pdf' ? ' active' : ''}`}
            onClick={() => setInputMode('pdf')}
          >PDF Upload</button>
          <button
            className={`tab-link${inputMode === 'text' ? ' active' : ''}`}
            onClick={() => setInputMode('text')}
          >Direct Text</button>
        </div>

        {/* Step 1: Content */}
        <div className="card">
          <div className="card-header">
            <h3>Step 1: Provide Task Content</h3>
          </div>
          <div className="card-body">
            {inputMode === 'pdf' ? (
              <>
                {!selectedFile ? (
                  <div
                    className={`upload-area${isDragOver ? ' dragover' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={e => {
                      e.preventDefault()
                      setIsDragOver(false)
                      const file = e.dataTransfer.files[0]
                      if (file && file.type === 'application/pdf') {
                        handleFileSelect(file)
                      } else {
                        showNotification('Please select a valid PDF file', 'error')
                      }
                    }}
                  >
                    <div className="upload-icon">📄</div>
                    <p className="upload-text">Drag and drop your PDF here or click to browse</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      hidden
                      onChange={e => handleFileSelect(e.target.files?.[0] ?? null)}
                    />
                    <button className="btn btn-primary" type="button" onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}>
                      Browse Files
                    </button>
                  </div>
                ) : (
                  <div className="file-info">
                    <div className="file-name">{selectedFile.name}</div>
                    <button className="btn btn-secondary btn-sm" onClick={clearFileSelection}>Remove</button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-input-area">
                <textarea
                  className="form-control"
                  rows={8}
                  placeholder="Paste your assignment instructions, email content, or task description here..."
                  value={textContent}
                  onChange={e => setTextContent(e.target.value)}
                />
                <small className="form-text">Paste the full text of your task for Gemini to analyze.</small>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Task Details */}
        <div className="card">
          <div className="card-header">
            <h3>Step 2: Enter Task Details</h3>
          </div>
          <div className="card-body">
            <form onSubmit={analyzeTask}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Deadline Date</label>
                  <input
                    type="date"
                    className="form-control"
                    min={today}
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                    required
                  />
                  <small className="form-text">Select the assignment due date</small>
                </div>
                <div className="form-group">
                  <label>Module Credits</label>
                  <input
                    type="number"
                    className="form-control"
                    min={1} max={4}
                    value={credits}
                    onChange={e => setCredits(parseInt(e.target.value))}
                    required
                  />
                  <small className="form-text">Enter credits (1-4)</small>
                </div>
                <div className="form-group">
                  <label>Assignment Weight (%)</label>
                  <input
                    type="number"
                    className="form-control"
                    min={0} max={100}
                    value={weight}
                    onChange={e => setWeight(parseInt(e.target.value))}
                    required
                  />
                  <small className="form-text">Percentage of final grade</small>
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-success btn-lg" disabled={isLoading}>
                  {isLoading ? (
                    <><span className="spinner" />&nbsp;Analyzing...</>
                  ) : (
                    'Analyze Task'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Results */}
        {taskData && (
          <div className="card" ref={resultsRef}>
            <div className="card-header">
              <h3>Analysis Results</h3>
            </div>
            <div className="card-body">
              <div className="results-container">
                {/* Task Info */}
                <div className="result-section">
                  <h4>Task Information</h4>
                  <div className="info-grid">
                    <div className="info-item">
                      <span className="info-label">Task Name:</span>
                      <span className="info-value">{taskData.task_name || 'N/A'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Priority:</span>
                      <span className={`info-value priority-badge ${taskData.priority}`}>{taskData.priority}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Days Left:</span>
                      <span className="info-value">{taskData.metrics.days_left} days</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Difficulty Rating:</span>
                      <span className="info-value">{taskData.metrics.difficulty_rating}/5</span>
                    </div>
                  </div>
                </div>

                {/* MCDM Scores */}
                <div className="result-section">
                  <h4>MCDM Scores</h4>
                  <div className="scores-container">
                    {[
                      { label: 'Urgency (50%)', key: 'urgency_score', cls: 'urgency' },
                      { label: 'Impact (30%)', key: 'impact_score', cls: 'impact' },
                      { label: 'Difficulty (20%)', key: 'difficulty_score', cls: 'difficulty' },
                    ].map(({ label, key, cls }) => {
                      const val = taskData.mcdm_calculation[key as keyof typeof taskData.mcdm_calculation] as number
                      return (
                        <div className="score-item" key={key}>
                          <div className="score-label">{label}</div>
                          <div className="score-bar">
                            <div className={`score-fill ${cls}`} style={{ width: `${val}%` }} />
                          </div>
                          <div className="score-value">{val}</div>
                        </div>
                      )
                    })}
                    <div className="score-item final-score">
                      <div className="score-label">Final MCDM Score</div>
                      <div className="score-value large">{taskData.mcdm_calculation.final_weighted_score.toFixed(1)}</div>
                    </div>
                  </div>
                </div>

                {/* Subtasks */}
                <div className="result-section">
                  <h4>Subtasks</h4>
                  {taskData.sub_tasks && taskData.sub_tasks.length > 0 ? (
                    <>
                      <ul className={`subtasks-list${isEditMode ? ' edit-mode' : ''}`}>
                        {taskData.sub_tasks.map((subtask, index) => {
                          const minutes = subtask.estimated_minutes || 0
                          const sliderVal = sliderValues[index] ?? minutes
                          const minTime = Math.max(10, minutes - 20)
                          const maxTime = minutes + 40
                          const diff = sliderVal - minutes
                          const confidenceColor = subtask.confidence === 'HIGH' ? '#10b981' :
                            subtask.confidence === 'MEDIUM' ? '#f59e0b' : '#ef4444'
                          const methodLabel = subtask.method === 'warm_start' ? 'API Prediction' : 'AI Estimate'
                          const methodColor = subtask.method === 'warm_start' ? '#10b981' : '#6b7280'
                          return (
                            <li key={index}>
                              <div className="subtask-header">
                                <strong>{subtask.name}</strong>
                                {' '}
                                <span className="subtask-time" style={{ color: '#7c3aed', fontWeight: 600 }}>
                                  ({isEditMode ? formatTime(sliderVal) : formatTime(minutes)})
                                </span>
                                {subtask.confidence && (
                                  <span style={{ color: confidenceColor, fontSize: '0.85em' }}> [{subtask.confidence}]</span>
                                )}
                                {subtask.method && (
                                  <span style={{ color: methodColor, fontSize: '0.8em', fontStyle: 'italic' }}> ({methodLabel})</span>
                                )}
                              </div>
                              <div className={`time-adjustment${isEditMode ? ' active' : ''}`}>
                                <div className="slider-container">
                                  <span className="slider-label">Adjust Time:</span>
                                  <input
                                    type="range"
                                    className="time-slider"
                                    min={minTime}
                                    max={maxTime}
                                    step={10}
                                    value={sliderVal}
                                    onChange={e => handleSliderChange(index, parseInt(e.target.value))}
                                  />
                                  <span className="slider-value">{sliderVal} min</span>
                                </div>
                                <div className="time-comparison">
                                  <span className="predicted-time">Predicted: {minutes} min</span>
                                  <span className={`time-difference ${diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral'}`}>
                                    Difference: {diff > 0 ? `+${diff}` : diff} min
                                  </span>
                                </div>
                              </div>
                            </li>
                          )
                        })}
                        {totalSliderTime > 0 && (
                          <li style={{ borderTop: '2px solid #7c3aed', marginTop: '10px', paddingTop: '10px' }}>
                            <strong style={{ color: '#7c3aed' }}>
                              Total Estimated Time: {formatTime(isEditMode ? totalSliderTime : taskData.sub_tasks.reduce((s, t) => s + (t.estimated_minutes || 0), 0))}
                            </strong>
                          </li>
                        )}
                      </ul>
                      <div className="subtasks-actions" style={{ display: 'flex' }}>
                        {!isEditMode && !hasBeenSaved && (
                          <button className="btn btn-primary" onClick={toggleEditMode}>Adjust Times</button>
                        )}
                        {isEditMode && (
                          <>
                            <button className="btn btn-success" onClick={saveAllTasks}>Save All Tasks</button>
                            <button className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <ul className="subtasks-list"><li>No subtasks available</li></ul>
                  )}
                </div>

                {/* Description */}
                <div className="result-section">
                  <h4>Task Description</h4>
                  <p className="task-description">{taskData.task_description || 'No description available'}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PDFAnalysis
