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
import ActiveTasksStandalone from './components/ActiveTasksStandalone';

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

const APP_LOGO_SRC = '/icon.png';

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

  const urlParams = new URLSearchParams(window.location.search);
  const isWidget = urlParams.get('widget') === 'active-tasks';

  if (isWidget) {
    return <ActiveTasksStandalone />;
  }

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
      <div className="flex min-h-screen bg-gray-50 items-center justify-center p-4 sm:p-6">
        <div className="glass-card max-w-md w-full p-6 sm:p-8 space-y-6">
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
              className="glass-input w-full px-4 py-3 focus:outline-none transition-shadow"
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

import { LayoutDashboard, CheckSquare, Zap, Activity, Settings, LogOut, BarChart2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

/** Inner component that can use InterventionContext */
const AppContent: React.FC<{
  state: AppState;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  user: any;
  logout: () => void;
}> = ({ state, activeTab, setActiveTab, user, logout }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const {
    showBreathing, setShowBreathing,
    showVisualization, setShowVisualization,
    abortBreathing, abortVisualization,
  } = useInterventionContext();

  const getTabIcon = (id: Tab) => {
    switch (id) {
      case 'procrastination': return <LayoutDashboard size={18} />;
      case 'tasks': return <CheckSquare size={18} />;
      case 'intervention': return <Zap size={18} />;
      case 'dashboard': return <Activity size={18} />;
      case 'calibration-details': return <BarChart2 size={18} />;
      case 'calibration': return <Settings size={18} />;
      default: return <LayoutDashboard size={18} />;
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-800 font-sans overflow-hidden lg:h-screen">
      {/* Sidebar Navigation */}
      <aside className={`${sidebarCollapsed ? 'w-20' : 'w-20 sm:w-56 lg:w-64'} glass-card rounded-none border-r border-slate-200/60 flex flex-col shrink-0 z-10 relative shadow-none transition-all duration-200`}>
        <div className="p-6 pb-8">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <img src={APP_LOGO_SRC} alt="App logo" className="w-6 h-6 rounded-md object-cover" />
              {!sidebarCollapsed && <span>Focus</span>}
            </h1>
            {!sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title="Collapse sidebar"
              >
                <PanelLeftClose size={16} />
              </button>
            )}
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title="Expand sidebar"
              >
                <PanelLeftOpen size={16} />
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 outline-none
                  ${isActive
                    ? 'bg-purple-50 text-purple-700 shadow-sm'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`}
              >
                <div className={`${isActive ? 'text-purple-600' : 'text-slate-400'}`}>
                  {getTabIcon(tab.id)}
                </div>
                {!sidebarCollapsed && tab.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-slate-100">
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between px-2'} mb-4`}>
            <div className={`flex items-center ${sidebarCollapsed ? '' : 'gap-2'}`}>
              <div className={`w-2 h-2 rounded-full ${state.pythonRunning && state.extensionConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-yellow-500'}`} />
              {!sidebarCollapsed && (
              <span className="text-xs font-medium text-slate-500">
                {state.pythonRunning && state.extensionConnected ? 'All systems active' : 'Connecting...'}
              </span>
              )}
            </div>
          </div>

          <div className={`bg-slate-50 rounded-xl p-3 flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
            {!sidebarCollapsed && (
              <div className="truncate pr-2 text-xs font-medium text-slate-600">
                {user?.email || 'User'}
              </div>
            )}
            <button
              onClick={logout}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative bg-slate-50/50">
        <div className="p-4 sm:p-4 min-h-full">
          {/* Header area replaced by context inside tabs, keeping clean */}
          <div className="animate-fade-in-up">
            {activeTab === 'procrastination' && <ProcrastinationPage />}
            {activeTab === 'dashboard' && (
              <div className="space-y-6 w-full">
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
            {activeTab === 'calibration' && <CalibrationPage pythonRunning={state.pythonRunning} extensionConnected={state.extensionConnected} />}
          </div>
        </div>
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

