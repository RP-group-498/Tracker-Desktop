import React, { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { HistoryDay } from './types';

Chart.register(...registerables);

const PERIODS = ['1d', '3d', '5d', '7d', '14d'] as const;
type Period = typeof PERIODS[number];
const PERIOD_DAYS: Record<Period, number> = {
  '1d': 1, '3d': 3, '5d': 5, '7d': 7, '14d': 14,
};
const PERIOD_LABELS: Record<Period, string> = {
  '1d': '1 Day', '3d': '3 Days', '5d': '5 Days', '7d': '7 Days', '14d': '14 Days',
};

interface Props {
  chartHistory: HistoryDay[];
  daysSinceStart: number;
}

const TrendChart: React.FC<Props> = ({ chartHistory, daysSinceStart }) => {
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('7d');
  const chartCanvasRef   = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  useEffect(() => {
    buildChart();
    return () => {
      chartInstanceRef.current?.destroy();
      chartInstanceRef.current = null;
    };
  }, [selectedPeriod, chartHistory]);

  function buildChart() {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;

    chartInstanceRef.current?.destroy();
    chartInstanceRef.current = null;

    const n           = PERIOD_DAYS[selectedPeriod];
    const window_data = chartHistory.slice(-n);
    if (window_data.length === 0) return;

    const labels = window_data.map(d => d.date.slice(5));

    const focusProbs = window_data.map(d =>
      Math.round((d.focusProbability ?? 0) * 100)
    );
    const academicRatio = window_data.map(d => {
      const acad    = d.fullDayAcademicMinutes ?? d.academicMinutes ?? 0;
      const nonAcad = d.fullDayNonAcademicMinutes ?? d.nonAcademicMinutes ?? 0;
      const total   = acad + nonAcad;
      return total > 0 ? Math.min(Math.round((acad / total) * 100), 100) : 0;
    });
    const studentEfficiency = window_data.map(d => {
      const acad    = d.academicMinutes ?? d.fullDayAcademicMinutes ?? 0;
      const nonAcad = d.fullDayNonAcademicMinutes ?? d.nonAcademicMinutes ?? 0;
      const total   = acad + nonAcad;
      return total > 0 ? Math.min(Math.round((acad / total) * 100), 100) : 0;
    });
    const goalCompletion = window_data.map(d => {
      const acad = d.fullDayAcademicMinutes ?? d.academicMinutes ?? 0;
      const exp  = d.expectedStudyMinutes ?? 0;
      return exp > 0 ? Math.min(Math.round((acad / exp) * 100), 100) : 0;
    });

    chartInstanceRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Focus Probability (%)',
            data: focusProbs,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.06)',
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 3,
            fill: false,
            yAxisID: 'yPct',
          },
          {
            label: 'Academic Ratio (%)',
            data: academicRatio,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6,182,212,0.06)',
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 3,
            fill: false,
            yAxisID: 'yPct',
          },
          {
            label: 'Study Efficiency (%)',
            data: studentEfficiency,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99,102,241,0.06)',
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 3,
            borderDash: [5, 3],
            fill: false,
            yAxisID: 'yPct',
          },
          {
            label: 'Goal Completion (%)',
            data: goalCompletion,
            borderColor: '#fbbf24',
            backgroundColor: 'rgba(251,191,36,0.06)',
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 3,
            borderDash: [3, 3],
            fill: false,
            yAxisID: 'yPct',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#64748b', font: { size: 11 }, boxWidth: 12 },
          },
          tooltip: {
            backgroundColor: '#1e293b',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            callbacks: {
              label: (ctx) => {
                const label = ctx.dataset.label ?? '';
                const val   = ctx.parsed.y;
                if (label.includes('Focus'))           return ` Focus: ${val}%`;
                if (label.includes('Academic Ratio')) return ` Academic Ratio: ${val}%`;
                if (label.includes('Efficiency'))     return ` Study Efficiency: ${val}%`;
                if (label.includes('Goal'))           return ` Goal Completion: ${val}%`;
                return ` ${label}: ${val}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { size: 10 } },
            grid:  { color: 'rgba(148,163,184,0.08)' },
          },
          yPct: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 100,
            ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => `${v}%` },
            grid: { drawOnChartArea: false },
            title: { display: true, text: '%', color: '#94a3b8', font: { size: 10 } },
          },
        },
      },
    });
  }

  return (
    <div className="glass-card p-4 sm:p-6 transition-all duration-200 hover:shadow-md flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-base font-semibold text-slate-800 tracking-tight">Activity Trends</h3>
        <div className="flex gap-1.5 flex-wrap">
          {PERIODS.map(p => (
            <button
              key={p}
              className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${
                selectedPeriod === p 
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' 
                : 'bg-white/60 text-indigo-500 border-indigo-200 hover:bg-indigo-50'
              }`}
              onClick={() => setSelectedPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="w-full relative h-[260px] mt-2">
        {chartHistory.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-16 font-medium">
            {daysSinceStart < 3
              ? `Chart available in ${3 - daysSinceStart} more day${3 - daysSinceStart !== 1 ? 's' : ''} — needs at least 3 days of data.`
              : 'No history data yet. Run the pipeline for a few days first.'}
          </p>
        ) : (
          <canvas ref={chartCanvasRef} />
        )}
      </div>
    </div>
  );
};

export default TrendChart;
