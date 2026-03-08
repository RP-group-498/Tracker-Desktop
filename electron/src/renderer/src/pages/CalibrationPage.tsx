import React, { useEffect, useState } from 'react';

const FOCUS_PERIODS = ['morning', 'afternoon', 'evening', 'night'] as const;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

interface CalibrationData {
  focus_period: string;
  study_days: string[];
  study_duration_hours: number;
}

interface TaskInput {
  task_name: string;
  deadline: string;
}

interface Task {
  id: number;
  task_name: string;
  deadline: string;
}

const CalibrationPage: React.FC = () => {
  const [calib, setCalib] = useState<CalibrationData>({
    focus_period: 'morning',
    study_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    study_duration_hours: 2,
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState<TaskInput>({ task_name: '', deadline: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCalibration();
    loadTasks();
  }, []);

  async function loadCalibration() {
    try {
      const raw = await window.electronAPI.getProcrastinationCalibration() as Record<string, unknown> | null;
      if (raw && (raw.focusPeriod || raw.focus_period)) {
        setCalib({
          focus_period: (raw.focusPeriod ?? raw.focus_period ?? 'morning') as string,
          study_days: (raw.studyDays ?? raw.study_days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) as string[],
          study_duration_hours: (raw.studyDuration ?? raw.study_duration_hours ?? 2) as number,
        });
      }
    } catch {
      // not yet saved, use defaults
    }
  }

  async function loadTasks() {
    try {
      const data = await window.electronAPI.getTasks() as Task[];
      setTasks(data || []);
    } catch {
      setTasks([]);
    }
  }

  function toggleDay(day: string) {
    setCalib(prev => ({
      ...prev,
      study_days: prev.study_days.includes(day)
        ? prev.study_days.filter(d => d !== day)
        : [...prev.study_days, day],
    }));
  }

  async function saveCalibration() {
    setSaving(true);
    setError(null);
    try {
      await window.electronAPI.saveProcrastinationCalibration({
        focusPeriod: calib.focus_period,
        studyDays: calib.study_days,
        studyDuration: calib.study_duration_hours,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Failed to save. Is the backend running?');
    } finally {
      setSaving(false);
    }
  }

  async function addTask() {
    if (!newTask.task_name.trim() || !newTask.deadline) return;
    try {
      await window.electronAPI.addTask({
        task_name: newTask.task_name.trim(),
        deadline: new Date(newTask.deadline).toISOString(),
      });
      setNewTask({ task_name: '', deadline: '' });
      await loadTasks();
    } catch {
      setError('Failed to add task.');
    }
  }

  async function removeTask(taskId: number) {
    try {
      await window.electronAPI.deleteTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch {
      setError('Failed to delete task.');
    }
  }

  return (
    <div className="p-4 space-y-5">
      <h2 className="text-base font-semibold text-gray-800">Study Calibration</h2>

      {/* Focus Period */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Focus Period</label>
        <div className="flex gap-2 flex-wrap">
          {FOCUS_PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setCalib(prev => ({ ...prev, focus_period: p }))}
              className={`px-3 py-1 rounded text-xs capitalize border ${
                calib.focus_period === p
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Study Days */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Study Days</label>
        <div className="flex gap-1 flex-wrap">
          {DAYS.map(day => (
            <button
              key={day}
              onClick={() => toggleDay(day)}
              className={`w-10 h-8 rounded text-xs border ${
                calib.study_days?.includes(day)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {/* Study Duration */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Study Duration: {calib.study_duration_hours}h
        </label>
        <input
          type="range"
          placeholder='range'
          min={1}
          max={12}
          step={0.5}
          value={calib.study_duration_hours}
          onChange={e => setCalib(prev => ({ ...prev, study_duration_hours: parseFloat(e.target.value) }))}
          className="w-full accent-blue-600"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>1h</span><span>12h</span>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={saveCalibration}
        disabled={saving}
        className="w-full py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Calibration'}
      </button>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded">{error}</p>
      )}

      {/* Tasks */}
      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Tasks</h3>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="Task name"
            value={newTask.task_name}
            onChange={e => setNewTask(prev => ({ ...prev, task_name: e.target.value }))}
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
          />
          <input
            placeholder="Task name"
            type="date"
            value={newTask.deadline}
            onChange={e => setNewTask(prev => ({ ...prev, deadline: e.target.value }))}
            className="px-2 py-1 border border-gray-300 rounded text-xs"
          />
          <button
            onClick={addTask}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
          >
            Add
          </button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-xs text-gray-400">No tasks yet.</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map(t => (
              <li key={t.id} className="flex justify-between items-center text-xs bg-white border border-gray-200 rounded px-2 py-1">
                <span className="text-gray-700">{t.task_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">{new Date(t.deadline).toLocaleDateString()}</span>
                  <button
                    onClick={() => removeTask(t.id)}
                    className="text-red-400 hover:text-red-600 text-xs"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default CalibrationPage;
