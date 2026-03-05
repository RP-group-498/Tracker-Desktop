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
        score: number;
        level: string;
        dominantPattern: string | null;
        patternsDetected: Array<{ type: string; severity: string; evidence: string }>;
    };
    predicted_active_time: {
        date: string;
        day: string;
        predictedActiveStart: string;
        predictedActiveEnd: string;
        predictedAcademicMinutes: number;
    } | null;
}

function mapMongoResultToReport(result: MongoRunResult) {
    const at = result.active_time;
    const proc = result.procrastination;
    return {
        date: proc.date,
        score: proc.score,
        level: proc.level,
        dominantPattern: proc.dominantPattern ?? null,
        patterns: proc.patternsDetected ?? [],
        activeTime: {
            activeStart: at.activeStart ?? null,
            activeEnd: at.activeEnd ?? null,
            academicMinutes: at.academicMinutes ?? 0,
            nonAcademicMinutes: at.nonAcademicMinutes ?? 0,
            appSwitches: at.totalAppSwitches ?? 0,
            expectedStudyMinutes: at.expectedStudyMinutes ?? 0,
            status: at.status ?? 'no_logs',
            day: at.day ?? '',
            fullDayAcademicMinutes: at.fullDayAcademicMinutes ?? 0,
            fullDayNonAcademicMinutes: at.fullDayNonAcademicMinutes ?? 0,
            fullDayProductivityMinutes: at.fullDayProductivityMinutes ?? 0,
            fullDayAcademicAppSwitches: at.fullDayAcademicAppSwitches ?? 0,
            fullDayNonAcademicAppSwitches: at.fullDayNonAcademicAppSwitches ?? 0,
            fullDayProductivityAppSwitches: at.fullDayProductivityAppSwitches ?? 0,
            fullDayTotalAppSwitches: at.fullDayTotalAppSwitches ?? 0,
        },
        prediction: result.predicted_active_time
            ? {
                  date: result.predicted_active_time.date,
                  day: result.predicted_active_time.day,
                  predictedActiveStart: result.predicted_active_time.predictedActiveStart,
                  predictedActiveEnd: result.predicted_active_time.predictedActiveEnd,
                  predictedAcademicMinutes: result.predicted_active_time.predictedAcademicMinutes,
              }
            : null,
    };
}

export function registerProcrastinationHandlers(pythonBridge: PythonBridge): void {
    // Full daily procrastination report — runs MongoDB analysis pipeline
    ipcMain.handle('procrastination:get-report', async () => {
    const runResult = await pythonBridge.request('POST', '/analysis/run');

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
        const result = await pythonBridge.request('GET', `/procrastination/report/history?days=${days}`);
        return result.data;
    });

    // Save user calibration (focus period, study days, study duration)
    ipcMain.handle('procrastination:save-calibration', async (_event, data: unknown) => {
        const result = await pythonBridge.request('POST', '/procrastination/calibration', data);
        return result.data;
    });

    // Get current user calibration
    ipcMain.handle('procrastination:get-calibration', async () => {
        const result = await pythonBridge.request('GET', '/procrastination/calibration');
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
}
