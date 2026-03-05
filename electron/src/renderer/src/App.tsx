import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import StatusPanel from './components/StatusPanel';
import ConnectionIndicator from './components/ConnectionIndicator';
import PDFAnalysis from './pages/PDFAnalysis';
import TimeEstimator from './pages/TimeEstimator';

interface AppState {
  pythonRunning: boolean;
  extensionConnected: boolean;
  currentSessionId: string | null;
  eventCount: number;
}

const Dashboard: React.FC = () => {
  const [state, setState] = useState<AppState>({
    pythonRunning: false,
    extensionConnected: false,
    currentSessionId: null,
    eventCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const currentState = await window.electronAPI.getState();
        setState(currentState);
      } catch (error) {
        console.error('Failed to get state:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchState();

    window.electronAPI.onStateChange((newState) => {
      setState(newState);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">Focus App</h1>
        <p className="text-sm text-gray-500">Procrastination Detection System</p>
      </header>

      <ConnectionIndicator
        pythonRunning={state.pythonRunning}
        extensionConnected={state.extensionConnected}
      />

      <StatusPanel
        sessionId={state.currentSessionId}
        eventCount={state.eventCount}
        pythonRunning={state.pythonRunning}
        extensionConnected={state.extensionConnected}
      />

      <footer className="mt-6 text-center text-xs text-gray-400">
        Focus App v1.0.0 | Research Project
      </footer>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pdf-analysis" element={<PDFAnalysis />} />
        <Route path="/time-estimator" element={<TimeEstimator />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
