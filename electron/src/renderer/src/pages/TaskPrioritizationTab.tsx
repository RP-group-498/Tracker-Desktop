import React, { useState } from 'react'
import PDFAnalysis from './PDFAnalysis'
import TimeEstimator from './TimeEstimator'

type SubTab = 'pdf-analysis' | 'time-estimator'

const TaskPrioritizationTab: React.FC = () => {
    const [activeSubTab, setActiveSubTab] = useState<SubTab>('time-estimator')

    return (
        <div className="flex flex-col h-full bg-slate-50/50 p-2 max-w-5xl w-full">
            <div className="mb-4 sm:mb-6 flex justify-center">
                <div className="glass-card p-1 rounded-xl inline-flex gap-1 flex-wrap justify-center">
                    <button
                        onClick={() => setActiveSubTab('time-estimator')}
                        className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                            activeSubTab === 'time-estimator' 
                                ? 'bg-white text-purple-700 shadow-sm' 
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        Time Estimator
                    </button>
                    <button
                        onClick={() => setActiveSubTab('pdf-analysis')}
                        className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                            activeSubTab === 'pdf-analysis' 
                                ? 'bg-white text-purple-700 shadow-sm' 
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        PDF Analysis
                    </button>
                </div>
            </div>

            <div className="animate-fade-in-up">
                {activeSubTab === 'time-estimator' && <TimeEstimator embedded />}
                {activeSubTab === 'pdf-analysis' && <PDFAnalysis embedded />}
            </div>
        </div>
    )
}

export default TaskPrioritizationTab
