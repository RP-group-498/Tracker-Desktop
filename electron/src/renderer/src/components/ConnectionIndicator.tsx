import React from 'react';

interface Props {
  pythonRunning: boolean;
  extensionConnected: boolean;
}

const ConnectionIndicator: React.FC<Props> = ({ pythonRunning, extensionConnected }) => {
  const getOverallStatus = (): 'connected' | 'partial' | 'disconnected' => {
    if (pythonRunning && extensionConnected) return 'connected';
    if (pythonRunning || extensionConnected) return 'partial';
    return 'disconnected';
  };

  const status = getOverallStatus();

  const statusConfig = {
    connected: {
      color: 'bg-green-500',
      text: 'All Systems Online',
      description: 'Backend and browser extension are connected',
    },
    partial: {
      color: 'bg-yellow-500',
      text: 'Partially Connected',
      description: pythonRunning
        ? 'Waiting for browser extension...'
        : 'Backend is starting...',
    },
    disconnected: {
      color: 'bg-red-500',
      text: 'Disconnected',
      description: 'Backend and extension offline',
    },
  };

  const config = statusConfig[status];

  return (
    <div className="card mb-4">
      <div className="flex items-center gap-3">
        <div className={`status-dot ${status === 'connected' ? 'connected' : status === 'partial' ? 'disconnected' : 'error'}`} />
        <div>
          <div className="font-medium text-gray-800">{config.text}</div>
          <div className="text-sm text-gray-500">{config.description}</div>
        </div>
      </div>

      {/* Individual status items */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Python Backend</span>
          <span className={pythonRunning ? 'text-green-600' : 'text-red-600'}>
            {pythonRunning ? 'Running' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Browser Extension</span>
          <span className={extensionConnected ? 'text-green-600' : 'text-yellow-600'}>
            {extensionConnected ? 'Connected' : 'Waiting...'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ConnectionIndicator;
