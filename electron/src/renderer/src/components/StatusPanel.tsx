import React, { useEffect, useState } from 'react';
import { Activity as ActivityIcon, Monitor, Server, Clock, AlertCircle, BookOpen, Briefcase, MinusCircle, Coffee } from 'lucide-react';

interface Props {
  sessionId: string | null;
  eventCount: number;
  pythonRunning: boolean;
  extensionConnected: boolean;
}

interface Activity {
  event_id: string;
  domain: string;
  title: string;
  active_time: number;
  timestamp: string;
  classification?: {
    category: string;
    confidence: number;
    source: string;
  };
}

const StatusPanel: React.FC<Props> = ({
  pythonRunning,
  extensionConnected,
}) => {
  const [recentActivities, setRecentActivities] = useState<Activity[]>([]);
  const [currentActivity, setCurrentActivity] = useState<Activity | null>(null);
  const [todayActivities, setTodayActivities] = useState<Activity[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [current, stream, today] = await Promise.all([
          window.electronAPI.getCurrentActivitySession(),
          window.electronAPI.getEventStream(30),
          window.electronAPI.getTodayActivity()
        ]);
        setCurrentActivity(current || null);
        setRecentActivities(stream || []);
        setTodayActivities(today || []);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const formatTimeOffset = (isoString: string): string => {
    // Add 5.30 hours for SLST display
    const date = new Date(isoString);
    date.setHours(date.getHours() + 5);
    date.setMinutes(date.getMinutes() + 30);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (ms: number | undefined): string => {
    if (!ms) return '0h 0m 0s';
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getCategoryColor = (category?: string) => {
    switch (category?.toLowerCase()) {
      case 'academic': return 'bg-green-100 text-green-700 border-green-200';
      case 'productivity': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'neutral': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'non_academic': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const formatCategory = (category?: string) => {
    if (!category) return 'UNCLASSIFIED';
    return category.replace('_', '-').toUpperCase();
  };

  const getCategoryTotal = (category?: string) => {
    if (!category) return 0;
    return todayActivities
      .filter(a => a.classification?.category === category)
      .reduce((sum, a) => sum + (a.active_time || 0), 0);
  };

  const PlatformIcon = ({ domain }: { domain: string }) => {
    if (domain === 'desktop') return <Monitor className="w-5 h-5 text-slate-400" />;
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt=""
        className="w-5 h-5 rounded-sm"
        onError={(e) => {
          (e.target as HTMLImageElement).src = 'https://www.google.com/s2/favicons?domain=google.com&sz=64';
        }}
      />
    );
  };

  const CategorySummaryCard = ({ title, amount, colorClass, icon: Icon }: any) => (
    <div className="glass-card p-4 rounded-xl border border-slate-200/60 bg-white/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1.5 rounded-lg ${colorClass.split(' ')[0]} ${colorClass.split(' ')[1]}`}>
          <Icon size={14} />
        </div>
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{title}</div>
      </div>
      <div className="text-base font-bold text-slate-800 font-mono">
        {amount}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column - Session & Totals */}
        <div className="lg:col-span-5 space-y-4">
          <div className="glass-card p-6 rounded-xl border border-slate-200/60 bg-white/80 shadow-sm flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-start mb-6">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent Session</div>
            </div>

            {currentActivity ? (
              <div className="space-y-6">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight truncate">{currentActivity.domain}</div>
                  <h3 className="text-xl font-bold text-slate-900 truncate leading-tight" title={currentActivity.title}>
                    {currentActivity.title || 'Untitled Activity'}
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Started</div>
                    <div className="text-sm font-bold text-slate-800 font-mono tracking-tight">{formatTimeOffset(currentActivity.timestamp)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Duration</div>
                    <div className="text-sm font-bold text-slate-800 font-mono tracking-tight">
                      {currentActivity.active_time ? formatDuration(currentActivity.active_time) : 'Active'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recent Category</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getCategoryColor(currentActivity.classification?.category)}`}>
                    {formatCategory(currentActivity.classification?.category)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                <Clock className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm font-medium">Monitoring active...</p>
              </div>
            )}
          </div>

          {/* 2x2 Category Totals Grid */}
          <div className="grid grid-cols-2 gap-4">
            <CategorySummaryCard
              title="Academic"
              amount={formatDuration(getCategoryTotal('academic'))}
              colorClass="bg-green-100 text-green-700 border-green-200"
              icon={BookOpen}
            />
            <CategorySummaryCard
              title="Productivity"
              amount={formatDuration(getCategoryTotal('productivity'))}
              colorClass="bg-blue-100 text-blue-700 border-blue-200"
              icon={Briefcase}
            />
            <CategorySummaryCard
              title="Neutral"
              amount={formatDuration(getCategoryTotal('neutral'))}
              colorClass="bg-slate-100 text-slate-700 border-slate-200"
              icon={MinusCircle}
            />
            <CategorySummaryCard
              title="Non-Academic"
              amount={formatDuration(getCategoryTotal('non_academic'))}
              colorClass="bg-orange-100 text-orange-700 border-orange-200"
              icon={Coffee}
            />
          </div>
        </div>

        {/* Right Column - Event Stream */}
        <div className="lg:col-span-7">
          <div className="glass-card p-0 rounded-xl border border-slate-200/60 bg-white/80 shadow-sm overflow-hidden h-[500px] flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-white/50">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Event Stream - Last 30 Min</div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {recentActivities.length > 0 ? (
                <div className="space-y-1">
                  {recentActivities.map((activity, idx) => (
                    <div key={activity.event_id || idx} className="flex items-center p-3 hover:bg-slate-50 rounded-lg transition-colors border-b border-slate-50 last:border-0 group">
                      <div className="w-16 text-xs text-slate-400 font-mono flex-shrink-0">
                        {formatTimeOffset(activity.timestamp)}
                      </div>

                      <div className="flex-1 min-w-0 pr-4">
                        <div className="text-sm font-medium text-slate-800 truncate" title={activity.title || activity.domain}>
                          {activity.title || activity.domain}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {activity.domain === 'desktop' ? 'Desktop App' : activity.domain}
                        </div>
                      </div>

                      <div className="flex-shrink-0">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase border ${getCategoryColor(activity.classification?.category)}`}>
                          {formatCategory(activity.classification?.category)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <ActivityIcon className="w-8 h-8 mb-2 opacity-50" />
                  <p>No recent events recorded</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Today's Full Activity List */}
      <div className="glass-card p-6 rounded-xl border border-slate-200/60 bg-white/80 shadow-sm overflow-hidden flex flex-col mt-8 h-[500px]">
        <div className="pb-4 border-b border-slate-100 bg-transparent flex justify-between items-center shrink-0">
          <div className="text-sm font-bold text-slate-800 uppercase tracking-wider">Today's Activity Log</div>
          <div className="text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">{todayActivities.length} total events</div>
        </div>

        <div className="flex-1 overflow-y-auto mt-2">
          {todayActivities.length > 0 ? (
            <div className="w-full text-left">
              <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 border-b border-slate-100 sticky top-0 bg-white/95 backdrop-blur z-10 px-2">
                <div className="col-span-2">Time</div>
                <div className="col-span-4">Activity</div>
                <div className="col-span-2">Duration</div>
                <div className="col-span-2">Category</div>
                <div className="col-span-2 text-right">Method</div>
              </div>
              <div className="divide-y divide-slate-50">
                {todayActivities.map((activity, idx) => (
                  <div key={activity.event_id || idx} className="grid grid-cols-12 gap-4 items-center py-3 px-2 hover:bg-slate-50/80 transition-colors">
                    <div className="col-span-2 text-xs font-mono text-slate-500">
                      {formatTimeOffset(activity.timestamp)}
                    </div>
                    <div className="col-span-4 min-w-0 pr-4">
                      <div className="text-sm font-medium text-slate-800 truncate" title={activity.title || activity.domain}>
                        {activity.title || activity.domain}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">
                        {activity.domain === 'desktop' ? 'Desktop App' : activity.domain}
                      </div>
                    </div>
                    <div className="col-span-2 text-xs font-mono text-slate-600">
                      {formatDuration(activity.active_time)}
                    </div>
                    <div className="col-span-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${getCategoryColor(activity.classification?.category)}`}>
                        {formatCategory(activity.classification?.category)}
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px] font-semibold uppercase tracking-wider">
                        {activity.classification?.source || 'UNKNOWN'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <ActivityIcon className="w-8 h-8 mb-2 opacity-50" />
              <p>No activity recorded today</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatusPanel;
