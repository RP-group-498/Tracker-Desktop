import React, { useState } from 'react'
import PDFAnalysis from './PDFAnalysis'
import TimeEstimator from './TimeEstimator'

type SubTab = 'pdf-analysis' | 'time-estimator'

const TaskPrioritizationTab: React.FC = () => {
    const [activeSubTab, setActiveSubTab] = useState<SubTab>('time-estimator')

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Sub-tab navigation */}
            <div style={{
                display: 'flex',
                gap: '0',
                padding: '8px 16px 0',
                backgroundColor: 'white',
                borderBottom: '1px solid #e5e7eb',
            }}>
                <button
                    onClick={() => setActiveSubTab('time-estimator')}
                    style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 500,
                        border: 'none',
                        borderBottom: activeSubTab === 'time-estimator' ? '2px solid #6c63ff' : '2px solid transparent',
                        color: activeSubTab === 'time-estimator' ? '#6c63ff' : '#6b7280',
                        backgroundColor: 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        marginBottom: '-1px',
                    }}
                >
                    Time Estimator
                </button>
                <button
                    onClick={() => setActiveSubTab('pdf-analysis')}
                    style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 500,
                        border: 'none',
                        borderBottom: activeSubTab === 'pdf-analysis' ? '2px solid #6c63ff' : '2px solid transparent',
                        color: activeSubTab === 'pdf-analysis' ? '#6c63ff' : '#6b7280',
                        backgroundColor: 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        marginBottom: '-1px',
                    }}
                >
                    PDF Analysis
                </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {activeSubTab === 'time-estimator' && <TimeEstimator embedded />}
                {activeSubTab === 'pdf-analysis' && <PDFAnalysis embedded />}
            </div>
        </div>
    )
}

export default TaskPrioritizationTab
