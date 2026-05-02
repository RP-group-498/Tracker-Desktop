import React, { useEffect, useState } from 'react';
import { useInterventionContext } from '../context/InterventionContext';

const FOCUS_PERIODS = ['morning', 'afternoon', 'evening', 'night'] as const;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

interface CalibrationData {
  focus_period: string;
  study_days: string[];
  study_duration_hours: number;
}

interface CalibrationPageProps {
  pythonRunning: boolean;
  extensionConnected: boolean;
}

const CalibrationPage: React.FC<CalibrationPageProps> = ({ pythonRunning, extensionConnected }) => {
  const { monitorEnabled, monitorStatus, toggleMonitor } = useInterventionContext();

  const [calib, setCalib] = useState<CalibrationData>({
    focus_period: 'morning',
    study_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    study_duration_hours: 2,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCalibration();
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

  return (
    <div className="p-2 space-y-6 max-w-2xl w-full">
      {/* Connection Status */}
      <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Connection Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-slate-200/60 bg-white/50 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-2">
              <div className="font-semibold text-slate-800 text-sm">Browser Extension</div>
              <div className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${extensionConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${extensionConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
                {extensionConnected ? 'Connected' : 'Waiting'}
              </div>
            </div>
            <div className="text-xs text-slate-500">{extensionConnected ? 'Chrome · Active' : 'Waiting for connection...'}</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200/60 bg-white/50 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-2">
              <div className="font-semibold text-slate-800 text-sm">Desktop Application</div>
              <div className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${pythonRunning ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${pythonRunning ? 'bg-green-500' : 'bg-red-500'}`} />
                {pythonRunning ? 'Connected' : 'Offline'}
              </div>
            </div>
            <div className="text-xs text-slate-500">{pythonRunning ? 'System · Active' : 'Tracker offline'}</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200/60 bg-white/50 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-2">
              <div className="font-semibold text-slate-800 text-sm">Detection Backend</div>
              <div className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${pythonRunning ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${pythonRunning ? 'bg-green-500' : 'bg-red-500'}`} />
                {pythonRunning ? 'Connected' : 'Offline'}
              </div>
            </div>
            <div className="text-xs text-slate-500">{pythonRunning ? 'Processing · latency ~40ms' : 'Service down'}</div>
          </div>
        </div>
      </div>

      {/* Auto-Monitor */}
      <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md">
        <div className="flex items-start sm:items-center justify-between gap-3 mb-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 m-0">Auto-Monitor</h2>
            <p className="text-xs text-gray-500 m-0">
              Checks every 60s and triggers interventions automatically
            </p>
          </div>
          <button
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
              monitorEnabled
                ? 'bg-green-500 text-white shadow-sm'
                : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}
            onClick={toggleMonitor}
          >
            {monitorEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className={`w-2 h-2 rounded-full ${monitorEnabled ? 'bg-green-500' : 'bg-slate-300'}`} />
          <span className="text-xs text-gray-500">{monitorStatus}</span>
        </div>
      </div>

      {/* Study Calibration */}
      <div className="glass-card p-4 sm:p-8 transition-all duration-200 hover:shadow-md space-y-8">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-1">Study Calibration</h2>
          <p className="text-sm text-slate-500">Configure your baseline study patterns for accurate tracking.</p>
        </div>

        {/* Focus Period */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-700">Focus Period</label>
          <div className="flex gap-2 flex-wrap">
            {FOCUS_PERIODS.map(p => (
              <button
                key={p}
                onClick={() => setCalib(prev => ({ ...prev, focus_period: p }))}
                className={`px-4 py-2 rounded-xl text-sm font-medium capitalize border transition-all duration-200 ${
                  calib.focus_period === p
                    ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Study Days */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-700">Study Days</label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map(day => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className={`min-w-[3rem] h-10 px-2 rounded-xl text-sm font-medium border transition-all duration-200 ${
                  calib.study_days?.includes(day)
                    ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        {/* Study Duration */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            Study Duration: <span className="text-purple-600">{calib.study_duration_hours}h</span>
          </label>
          <div className="pt-2">
            <input
              type="range"
              min={1}
              max={12}
              step={0.5}
              value={calib.study_duration_hours}
              onChange={e => setCalib(prev => ({ ...prev, study_duration_hours: parseFloat(e.target.value) }))}
              className="glass-input w-full h-2 rounded-lg appearance-none cursor-pointer accent-purple-600"
            />
            <div className="flex justify-between text-xs font-medium text-slate-400 mt-2">
              <span>1h</span><span>12h</span>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t border-slate-100">
          <button
            onClick={saveCalibration}
            disabled={saving}
            className="w-full py-3.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 transition-all shadow-sm active:scale-[0.98]"
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Calibration'}
          </button>

          {error && (
            <p className="text-sm font-medium text-red-600 bg-red-50 px-4 py-3 rounded-xl mt-4 border border-red-100">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CalibrationPage;
