import React, { useEffect, useState } from 'react';
import StatusPanel from './components/StatusPanel';
import ConnectionIndicator from './components/ConnectionIndicator';
import ProcrastinationPage from './pages/ProcrastinationPage';
import CalibrationPage from './pages/CalibrationPage';
import SmartInterventionPage from './pages/SmartInterventionPage';
import TaskPrioritizationTab from './pages/TaskPrioritizationTab';
import CalibrationDetailsPage from './pages/CalibrationDetailsPage';
import LoginPage from './pages/LoginPage';
import BreathingModal from './components/BreathingModal';
import VisualizationModal from './components/VisualizationModal';
import { useAuth } from './context/AuthContext';
import { InterventionProvider, useInterventionContext } from './context/InterventionContext';

interface AppState {
  pythonRunning: boolean;
  extensionConnected: boolean;
  currentSessionId: string | null;
  eventCount: number;
}

type Tab = 'dashboard' | 'tasks' | 'procrastination' | 'calibration' | 'intervention' | 'calibration-details';

const TABS: { id: Tab; label: string }[] = [
  { id: 'procrastination', label: 'Dashboard' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'intervention', label: 'Interventions' },
  { id: 'calibration-details', label: 'Calibration Details' },
  { id: 'dashboard', label: 'Activity' },
  { id: 'calibration', label: 'Settings' },
];

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    pythonRunning: false,
    extensionConnected: false,
    currentSessionId: null,
    eventCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('procrastination');

  // Onboarding Goal state
  const [goalChecked, setGoalChecked] = useState(false);
  const [needsGoal, setNeedsGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  const { isAuthenticated, justLoggedIn, clearJustLoggedIn, isLoading: authLoading, logout, user } = useAuth();

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

  useEffect(() => {
    // Only verify goal after a fresh OAuth login, not on token restore
    if (justLoggedIn && !goalChecked) {
      window.electronAPI.intervention.getUserGoal()
        .then(data => {
          if (!data || !(data as any).life_goal) {
            setNeedsGoal(true);
          }
        })
        .catch(e => console.error('Failed to get user goal:', e))
        .finally(() => {
          setGoalChecked(true);
          clearJustLoggedIn();
        });
    }
  }, [justLoggedIn, goalChecked]);

  const handleSaveGoal = async () => {
    if (!goalInput.trim()) return;
    setIsSavingGoal(true);
    try {
      await window.electronAPI.intervention.saveUserGoal(goalInput);
      setNeedsGoal(false); // Done with onboarding
    } catch (e) {
      console.error('Failed to save goal:', e);
    } finally {
      setIsSavingGoal(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // If authenticated via fresh login but we are still checking the goal, show a loader
  if (justLoggedIn && !goalChecked) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-gray-500 flex flex-col items-center">
          <svg className="animate-spin -ml-1 mr-3 h-8 w-8 text-indigo-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Personalizing your experience...
        </div>
      </div>
    );
  }

  // If goal check finished and goal is missing, show the Welcome/Personalize step instead of the dashboard
  if (needsGoal) {
    return (
      <div className="flex h-screen bg-gray-50 items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 space-y-6 border border-gray-100">
          <div className="text-center">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Welcome!</h2>
            <p className="text-sm text-gray-500">
              Let's personalize your experience. Please set your academic goal to make smart interventions more effective.
            </p>
          </div>

          <div className="space-y-4">
            <input
              type="text"
              placeholder="e.g. Become a Doctor, Get a 4.0 GPA"
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow bg-gray-50 focus:bg-white"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGoal(); }}
              autoFocus
            />

            <button
              disabled={isSavingGoal || !goalInput.trim()}
              onClick={handleSaveGoal}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isSavingGoal ? 'Saving...' : 'Continue to Dashboard'}
            </button>
          </div>
          <p className="text-xs text-center text-gray-400">You can change this later in the Interventions tab.</p>
        </div>
      </div>
    );
  }

  return (
    <InterventionProvider>
      <AppContent
        state={state}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        logout={logout}
      />
    </InterventionProvider>
  );
};

/** Inner component that can use InterventionContext */
const AppContent: React.FC<{
  state: AppState;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  user: any;
  logout: () => void;
}> = ({ state, activeTab, setActiveTab, user, logout }) => {
  const {
    showBreathing, setShowBreathing,
    showVisualization, setShowVisualization,
    abortBreathing, abortVisualization,
  } = useInterventionContext();

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="px-4 pt-4 pb-2 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Focus App</h1>
          <p className="text-sm text-gray-500">Procrastination Detection System</p>
        </div>
        <div className="flex items-center gap-4">
          {user && <span className="text-sm text-gray-600">Logged in as {user.email || 'User'}</span>}
          <button
            onClick={logout}
            className="px-3 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="flex border-b border-gray-200 px-4 bg-white">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${activeTab === tab.id
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
        {activeTab === 'procrastination' && <ProcrastinationPage />}
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

        {activeTab === 'tasks' && <TaskPrioritizationTab />}
        {activeTab === 'intervention' && <SmartInterventionPage />}
        {activeTab === 'calibration-details' && <CalibrationDetailsPage />}
        {activeTab === 'calibration' && <CalibrationPage />}
      </main>

      {/* Modals — rendered at app level so they survive tab switches */}
      {showBreathing && (
        <BreathingModal
          onClose={() => setShowBreathing(false)}
          onAbort={abortBreathing}
        />
      )}
      {showVisualization && (
        <VisualizationModal
          onClose={() => setShowVisualization(false)}
          onAbort={abortVisualization}
        />
      )}
    </div>
  );
};

export default App;

