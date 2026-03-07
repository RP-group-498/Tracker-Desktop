import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import StatusPanel from './components/StatusPanel';
import ConnectionIndicator from './components/ConnectionIndicator';
import PDFAnalysis from './pages/PDFAnalysis';
import TimeEstimator from './pages/TimeEstimator';
import ProcrastinationPage from './pages/ProcrastinationPage';
import CalibrationPage from './pages/CalibrationPage';
import SmartInterventionPage from './pages/SmartInterventionPage';

interface AppState {
  pythonRunning: boolean;
  extensionConnected: boolean;
  currentSessionId: string | null;
  eventCount: number;
}

type Tab = 'dashboard' | 'procrastination' | 'calibration' | 'intervention';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard',       label: 'Dashboard' },
  { id: 'procrastination', label: 'Analysis' },
  { id: 'calibration',     label: 'Settings' },
  { id: 'intervention',    label: 'Interventions' },
];

const Dashboard: React.FC = () => {
  const [state, setState] = useState<AppState>({
    pythonRunning: false,
    extensionConnected: false,
    currentSessionId: null,
    eventCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [hasVisitedIntervention, setHasVisitedIntervention] = useState(false);

  const handleTabChange = (tab: Tab) => {
    if (tab === 'intervention') {
      setHasVisitedIntervention(true);
    }
    setActiveTab(tab);
  };

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
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold text-gray-800">Focus App</h1>
        <p className="text-sm text-gray-500">Procrastination Detection System</p>
      </header>

      {/* Tab Bar */}
      <nav className="flex border-b border-gray-200 px-4 bg-white">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'dashboard' && (
          <div className="p-4 space-y-4">
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
          </div>
        )}

        {activeTab === 'procrastination' && <ProcrastinationPage />}
        {activeTab === 'calibration' && <CalibrationPage />}
        {hasVisitedIntervention && (
          <div className={activeTab === 'intervention' ? 'block' : 'hidden'}>
            <SmartInterventionPage />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="px-4 py-2 text-center text-xs text-gray-400">
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
