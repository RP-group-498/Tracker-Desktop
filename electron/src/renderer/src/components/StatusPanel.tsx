import React, { useEffect, useState } from 'react';

interface Props {
  sessionId: string | null;
  eventCount: number;
  pythonRunning: boolean;
  extensionConnected: boolean;
}

interface ActivityStats {
  total_events: number;
  total_active_time: number;
  total_idle_time: number;
  by_category: Record<string, { count: number; time: number }>;
}

const StatusPanel: React.FC<Props> = ({
  sessionId,
  eventCount,
  pythonRunning,
  extensionConnected,
}) => {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [componentStatus, setComponentStatus] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!pythonRunning) return;

      try {
        const [activityStats, classificationStatus] = await Promise.all([
          window.electronAPI.getActivityStats(),
          window.electronAPI.getComponentStatus('classification'),
        ]);

        setStats(activityStats);
        setComponentStatus(classificationStatus);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [pythonRunning]);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  return (
    <div className="space-y-4">
      {/* Session Info */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-500 mb-2">Current Session</h3>
        {sessionId ? (
          <div>
            <div className="font-mono text-sm text-gray-800 truncate">
              {sessionId}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {eventCount} events captured
            </div>
          </div>
        ) : (
          <div className="text-gray-400">No active session</div>
        )}
      </div>

      {/* Activity Stats */}
      {stats && (
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Activity Summary</h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {stats.total_events}
              </div>
              <div className="text-xs text-gray-500">Total Events</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {formatTime(stats.total_active_time)}
              </div>
              <div className="text-xs text-gray-500">Active Time</div>
            </div>
          </div>

          {/* Category breakdown */}
          {Object.keys(stats.by_category).length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 mb-2">By Category</h4>
              <div className="space-y-2">
                {Object.entries(stats.by_category).map(([category, data]) => (
                  <div key={category} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3 h-3 rounded ${
                          category === 'academic'
                            ? 'bg-green-500'
                            : category === 'productivity'
                            ? 'bg-blue-500'
                            : category === 'non_academic'
                            ? 'bg-red-500'
                            : 'bg-gray-400'
                        }`}
                      />
                      <span className="text-sm capitalize">{category.replace('_', ' ')}</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {data.count} ({formatTime(data.time)})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Component Status */}
      {componentStatus && (
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Classification Component</h3>
          <div className="text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Version</span>
              <span className="font-mono">{String(componentStatus.version)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-600">Type</span>
              <span className="capitalize">{String(componentStatus.type)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-600">Status</span>
              <span className={componentStatus.initialized ? 'text-green-600' : 'text-yellow-600'}>
                {componentStatus.initialized ? 'Ready' : 'Initializing'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Quick Actions</h3>
        <div className="flex gap-2">
          <button
            onClick={() => window.electronAPI.sendCommand('pause')}
            disabled={!extensionConnected}
            className="flex-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Pause Tracking
          </button>
          <button
            onClick={() => window.electronAPI.restartBackend()}
            className="flex-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            Restart Backend
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatusPanel;
