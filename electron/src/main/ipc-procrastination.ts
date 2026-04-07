/**
 * /main/ipc-procrastination.ts
 * IPC Handlers — Procrastination Detection
 *
 * Registers all procrastination-related IPC channels.
 * Call registerProcrastinationHandlers() from index.ts after pythonBridge is created.
 */

import { ipcMain } from 'electron';
import { PythonBridge } from './python-bridge';

interface MongoRunResult {
    active_time: {
        date: string;
        day: string;
        status: string;
        activeStart: string | null;
        activeEnd: string | null;
        academicMinutes: number;
        nonAcademicMinutes: number;
        academicAppSwitches: number;
        nonAcademicAppSwitches: number;
        totalAppSwitches: number;
        expectedStudyMinutes: number;
        fullDayAcademicMinutes: number;
        fullDayNonAcademicMinutes: number;
        fullDayProductivityMinutes: number;
        fullDayAcademicAppSwitches: number;
        fullDayNonAcademicAppSwitches: number;
        fullDayProductivityAppSwitches: number;
        fullDayTotalAppSwitches: number;
    };
    procrastination: {
        date: string;
        userId: string;
        dominantPattern: string | null;
        classId: number;
        score: number;
        level: string;
        confidence: number;
        behaviorState: string;
        focusProbability: number;
        source: string;
        patterns?: Array<{ type: string; severity: string; evidence: string; exit_strategy?: string }>;
    };
    prediction: {
        date: string;
        day: string;
        predictedAcademicMinutes: number;
        predictedActiveStart: string;
        predictedActiveEnd: string;
        predictedFocusProbability: number;
        predictedProcrastinationLevel: string;
        nextDayProcrastinationRisk: number;
        source: string;
    } | null;
}

function mapMongoResultToReport(result: MongoRunResult) {
    const at   = result.active_time;
    const proc = result.procrastination;
    const pred = result.prediction ?? null;

    if (!proc || !at) {
        throw new Error(
            `Pipeline returned unexpected shape. Keys: ${Object.keys(result ?? {}).join(', ')}`
        );
    }

    return {
        date:             proc.date,
        score:            proc.score,
        level:            proc.level,
        dominantPattern:  proc.dominantPattern ?? null,
        classId:          proc.classId ?? 0,
        confidence:       proc.confidence ?? 0,
        behaviorState:    proc.behaviorState ?? null,
        focusProbability: proc.focusProbability ?? 0,
        patterns:         proc.patterns ?? [],
        activeTime: {
            activeStart:                   at.activeStart ?? null,
            activeEnd:                     at.activeEnd ?? null,
            academicMinutes:               at.academicMinutes ?? 0,
            nonAcademicMinutes:            at.nonAcademicMinutes ?? 0,
            appSwitches:                   at.totalAppSwitches ?? 0,
            expectedStudyMinutes:          at.expectedStudyMinutes ?? 0,
            status:                        at.status ?? 'no_logs',
            day:                           at.day ?? '',
            fullDayAcademicMinutes:        at.fullDayAcademicMinutes ?? 0,
            fullDayNonAcademicMinutes:     at.fullDayNonAcademicMinutes ?? 0,
            fullDayProductivityMinutes:    at.fullDayProductivityMinutes ?? 0,
            fullDayAcademicAppSwitches:    at.fullDayAcademicAppSwitches ?? 0,
            fullDayNonAcademicAppSwitches: at.fullDayNonAcademicAppSwitches ?? 0,
            fullDayProductivityAppSwitches:at.fullDayProductivityAppSwitches ?? 0,
            fullDayTotalAppSwitches:       at.fullDayTotalAppSwitches ?? 0,
        },
        prediction: pred
            ? {
                date:                          pred.date,
                day:                           pred.day,
                predictedActiveStart:          pred.predictedActiveStart,
                predictedActiveEnd:            pred.predictedActiveEnd,
                predictedAcademicMinutes:      pred.predictedAcademicMinutes,
                predictedFocusProbability:     pred.predictedFocusProbability,
                predictedProcrastinationLevel: pred.predictedProcrastinationLevel,
                nextDayProcrastinationRisk:    pred.nextDayProcrastinationRisk ?? 0.5,
            }
            : null,
    };
}

export function registerProcrastinationHandlers(pythonBridge: PythonBridge): void {
    // Full daily procrastination report — runs MongoDB analysis pipeline
    ipcMain.handle('procrastination:get-report', async () => {
        const runResult = await pythonBridge.request('POST', '/analysis/run', {}, 60000); // 60s timeout

        if (!runResult.success || !runResult.data) {
            // show the *actual* backend error / status / url if available
            throw new Error(
                `MongoDB analysis pipeline failed: ${runResult.error ?? 'unknown error'}`
            );
        }

        return mapMongoResultToReport(runResult.data as MongoRunResult);
    });

    // Historical reports (default last 7 days)
    ipcMain.handle('procrastination:get-history', async (_event, days: number = 7) => {
        const result = await pythonBridge.request('GET', `/analysis/history?days=${days}`);
        return result.data;
    });

    // Save user calibration (focus period, study days, study duration)
    ipcMain.handle('procrastination:save-calibration', async (_event, data: unknown) => {
        const result = await pythonBridge.request('POST', '/analysis/calibration', data);
        return result.data;
    });

    // Get current user calibration
    ipcMain.handle('procrastination:get-calibration', async () => {
        const result = await pythonBridge.request('GET', '/analysis/calibration');
        return result.data;
    });

    // Add a task with deadline
    ipcMain.handle('procrastination:add-task', async (_event, data: unknown) => {
        const result = await pythonBridge.request('POST', '/procrastination/tasks', data);
        return result.data;
    });

    // List all tasks for current user — served from MongoDB
    ipcMain.handle('procrastination:get-tasks', async () => {
        const result = await pythonBridge.request('GET', '/analysis/tasks');
        return result.data;
    });

    // Delete a task by ID
    ipcMain.handle('procrastination:delete-task', async (_event, taskId: number) => {
        const result = await pythonBridge.request('DELETE', `/procrastination/tasks/${taskId}`);
        return result.data;
    });

    // Calibration phase history (14-day graphs)
    ipcMain.handle('calibration:get-history', async (_event, days: number = 14) => {
        const result = await pythonBridge.request('GET', `/analysis/calibration-history?days=${days}`);
        return result.data;
    });

    // Anomaly detection results (Isolation Forest)
    ipcMain.handle('procrastination:get-anomalies', async (_event, days: number = 30) => {
        const result = await pythonBridge.request('GET', `/analysis/anomalies?days=${days}`);
        return result.data;
    });

    // Behavior trend analysis
    ipcMain.handle('procrastination:get-behavior-trends', async (_event, days: number = 14) => {
        const result = await pythonBridge.request('GET', `/analysis/behavior-trends?days=${days}`);
        return result.data;
    });

    // Time gap comparative stats (1d/3d/5d/7d/14d)
    ipcMain.handle('procrastination:get-time-gap', async () => {
        const result = await pythonBridge.request('GET', '/analysis/time-gap');
        return result.data;
    });

    // Upcoming deadlines with day labels
    ipcMain.handle('procrastination:get-deadlines', async () => {
        const result = await pythonBridge.request('GET', '/analysis/deadlines');
        return result.data;
    });

    // Per-user adaptive model training status
    ipcMain.handle('procrastination:get-model-status', async () => {
        const result = await pythonBridge.request('GET', '/analysis/model-status');
        return result.data;
    });

    // Debug: count events pipeline can see
    ipcMain.handle('procrastination:debug-count', async () => {
        const result = await pythonBridge.request('GET', '/analysis/debug-count');
        return result.data;
    });
}
