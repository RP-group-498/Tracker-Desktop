import React, { useEffect, useState } from 'react';
import StatusPanel from './components/StatusPanel';
import ConnectionIndicator from './components/ConnectionIndicator';

interface AppState {
  pythonRunning: boolean;
  extensionConnected: boolean;
  currentSessionId: string | null;
  eventCount: number;
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    pythonRunning: false,
    extensionConnected: false,
    currentSessionId: null,
    eventCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial state
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

    // Listen for state changes
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
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">Focus App</h1>
        <p className="text-sm text-gray-500">Procrastination Detection System</p>
      </header>

      {/* Connection Status */}
      <ConnectionIndicator
        pythonRunning={state.pythonRunning}
        extensionConnected={state.extensionConnected}
      />

      {/* Main Status Panel */}
      <StatusPanel
        sessionId={state.currentSessionId}
        eventCount={state.eventCount}
        pythonRunning={state.pythonRunning}
        extensionConnected={state.extensionConnected}
      />

      {/* Footer */}
      <footer className="mt-6 text-center text-xs text-gray-400">
        Focus App v1.0.0 | Research Project
      </footer>
    </div>
  );
};

export default App;
