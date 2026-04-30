/**
 * InterventionContext
 *
 * Owns all intervention state that must survive tab switches:
 * monitoring loop, timers, notification response handler, modal visibility.
 * Lives in App.tsx so it never unmounts while authenticated.
 */

import React, { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { getContext } from '../../../utils/contextBuilder';
import { MonitoringLoop } from '../utils/monitoringLoop';
import { CooldownManager } from '../utils/cooldownManager';
import { useAuth } from './AuthContext';

const ACTION_TO_STRATEGY: Record<string, string> = {
    NO_INTERVENTION: 'no_intervention',
    FIVE_SECOND_RULE: '5_second_rule',
    POMODORO: 'pomodoro',
    BREATHING: 'breathing',
    VISUALIZATION: 'visualization',
    REFRAME: 'reframe',
};

const ACTION_NOTIFICATIONS: Record<string, { title: string; body: string | null }> = {
    NO_INTERVENTION: { title: 'No Intervention', body: null },
    FIVE_SECOND_RULE: { title: '5-Second Rule', body: 'Count down 5-4-3-2-1 and move!' },
    POMODORO: { title: 'Pomodoro Session', body: 'Ready to focus for 25 minutes?' },
    BREATHING: { title: 'Time for a Breath', body: 'Take a moment to calm your mind.' },
    VISUALIZATION: { title: 'Visualize Completion', body: 'Close your eyes and imagine finishing this task.' },
    REFRAME: { title: 'Reframe Your Perspective', body: null },
};

export interface InterventionContextValue {
    monitorEnabled: boolean;
    monitorStatus: string;
    toggleMonitor: () => void;
    showBreathing: boolean;
    showVisualization: boolean;
    setShowBreathing: (v: boolean) => void;
    setShowVisualization: (v: boolean) => void;
    pomodoroActive: boolean;
    lastInterventionTs: number;
    abortBreathing: () => void;
    abortVisualization: () => void;
}

const InterventionContext = createContext<InterventionContextValue | undefined>(undefined);

export const useInterventionContext = (): InterventionContextValue => {
    const ctx = useContext(InterventionContext);
    if (!ctx) throw new Error('useInterventionContext must be used within InterventionProvider');
    return ctx;
};

export const InterventionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const userId = user?.id ?? '';

    // ── Persistent state ──────────────────────────────────────────────
    const [monitorEnabled, setMonitorEnabled] = useState(false);
    const [monitorStatus, setMonitorStatus] = useState('Monitoring stopped');
    const [showBreathing, setShowBreathing] = useState(false);
    const [showVisualization, setShowVisualization] = useState(false);
    const [pomodoroActive, setPomodoroActive] = useState(false);
    const [lastInterventionTs, setLastInterventionTs] = useState(0);

    // ── Persistent refs ───────────────────────────────────────────────
    const cooldownRef = useRef<CooldownManager>(new CooldownManager());
    const monitorRef = useRef<MonitoringLoop | null>(null);
    const pendingBanditRef = useRef<{ action: string; vector: number[] } | null>(null);
    const pomodoroIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const breakIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const fiveSecIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // ── Helpers ───────────────────────────────────────────────────────

    const logMotivation = useCallback(async (vector: number[], scenario: string = 'live') => {
        try {
            await window.electronAPI.intervention.logMotivation({
                user_id: userId,
                motivation: vector[5],  // TMT motivation score, now at index 5 in 9-element vector
                scenario,
                context_vector: vector,
            });
        } catch (e) {
            console.warn('[Motivation] Log failed:', e);
        }
    }, [userId]);

    const computeReward = (button: string): number => {
        if (button === 'start') return 1.0;
        if (button === 'no_intervention') return 0.5;
        if (button === 'not_now' || button === 'reject') return 0.4;
        return 0.2;
    };

    const sendBanditUpdate = useCallback(async (
        action: string,
        vector: number[],
        reward: number,
        button: string,
    ) => {
        try {
            const data = await window.electronAPI.intervention.banditUpdate({
                user_id: userId,
                x: vector,
                action,
                reward,
                button,
                alpha: 1.0,
            });
        } catch (err) {
            console.warn('[Bandit] Update error:', err);
        }
    }, [userId]);

    // ── Timer helpers ─────────────────────────────────────────────────

    const clearAllTimers = useCallback(() => {
        if (pomodoroIntervalRef.current) { clearInterval(pomodoroIntervalRef.current); pomodoroIntervalRef.current = null; }
        if (breakIntervalRef.current) { clearInterval(breakIntervalRef.current); breakIntervalRef.current = null; }
        if (fiveSecIntervalRef.current) { clearInterval(fiveSecIntervalRef.current); fiveSecIntervalRef.current = null; }
    }, []);

    const startFiveSecondCountdown = useCallback(() => {
        let timeLeft = 5;
        window.electronAPI.intervention.updateTrayTimer(`Go in ${timeLeft}...`);

        fiveSecIntervalRef.current = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                window.electronAPI.intervention.updateTrayTimer(`Go in ${timeLeft}...`);
            } else {
                clearInterval(fiveSecIntervalRef.current!);
                fiveSecIntervalRef.current = null;
                window.electronAPI.intervention.updateTrayTimer("Let's Go!");
                setTimeout(() => window.electronAPI.intervention.clearTray(), 3000);
            }
        }, 1000);
    }, []);

    const startBreakTimer = useCallback(() => {
        window.electronAPI.intervention.notify({
            title: 'Pomodoro Break',
            body: 'Great focus session. Take a 5-minute break.',
        });
        let timeLeft = 5 * 60;
        const update = () => {
            const m = Math.floor(timeLeft / 60);
            const s = timeLeft % 60;
            window.electronAPI.intervention.updateTrayTimer(`Break: ${m}:${s.toString().padStart(2, '0')}`);
        };
        update();
        breakIntervalRef.current = setInterval(() => {
            timeLeft--;
            update();
            if (timeLeft <= 0) {
                clearInterval(breakIntervalRef.current!);
                breakIntervalRef.current = null;
                window.electronAPI.intervention.notify({
                    title: 'Pomodoro',
                    body: "Let's get back to work.",
                });
                window.electronAPI.intervention.clearTray();
                setPomodoroActive(false);
                window.electronAPI.intervention.pomodoroStopped();
            }
        }, 1000);
    }, []);

    const startPomodoroTimer = useCallback(() => {
        setPomodoroActive(true);
        window.electronAPI.intervention.pomodoroStarted();

        let timeLeft = 25 * 60;
        const update = () => {
            const m = Math.floor(timeLeft / 60);
            const s = timeLeft % 60;
            window.electronAPI.intervention.updateTrayTimer(`${m}:${s.toString().padStart(2, '0')}`);
        };
        update();
        pomodoroIntervalRef.current = setInterval(() => {
            timeLeft--;
            update();
            if (timeLeft <= 0) {
                clearInterval(pomodoroIntervalRef.current!);
                pomodoroIntervalRef.current = null;
                window.electronAPI.intervention.clearTray();
                startBreakTimer();
            }
        }, 1000);
    }, [startBreakTimer]);

    // ── Bandit notification trigger ───────────────────────────────────

    const triggerBanditNotification = useCallback(async (action: string, vector: number[]) => {
        let { title, body } = ACTION_NOTIFICATIONS[action];

        if (action === 'REFRAME') {
            let goal = 'your goals';
            try {
                const data = await window.electronAPI.intervention.getUserGoal();
                if ((data as any)?.life_goal) goal = (data as any).life_goal;
            } catch (e) {
                console.warn('[Bandit] Could not fetch life goal for reframe:', e);
            }
            body = `I choose to do this because it helps me ${goal}.`;
        }

        pendingBanditRef.current = { action, vector };
        window.electronAPI.intervention.notifyActions({ title, body: body ?? '', strategy: ACTION_TO_STRATEGY[action] });
    }, []);

    // ── Monitoring loop callback ──────────────────────────────────────

    const onSuggestIntervention = useCallback(async (vector: number[], _allowedActions: string[]) => {
        try {
            cooldownRef.current.setActiveIntervention('pending');

            const result = await window.electronAPI.intervention.banditSelect({
                user_id: userId,
                x: vector,
                alpha: 1.0,
            });
            const { action } = result as { action: string; allowed_actions: string[] };

            if (action === 'NO_INTERVENTION') {
                // Bandit decided no intervention is needed — silent skip
                await logMotivation(vector, action);
                await sendBanditUpdate(action, vector, 0.5, 'no_intervention');
                cooldownRef.current.applyCooldown(action, 'no_intervention');
                cooldownRef.current.setActiveIntervention(null);
                setMonitorStatus('Monitoring — no intervention needed');
                return;
            }

            setMonitorStatus(`Triggered → ${action}`);
            await logMotivation(vector, action);
            setLastInterventionTs(Date.now());

            cooldownRef.current.setActiveIntervention(action);
            await triggerBanditNotification(action, vector);
        } catch (err) {
            console.warn('[MonitoringLoop] Bandit select error:', err);
            cooldownRef.current.setActiveIntervention(null);
            setMonitorStatus(`Error: ${(err as Error)?.message ?? 'unknown'}`);
        }
    }, [userId, triggerBanditNotification, logMotivation, sendBanditUpdate]);

    // ── Toggle monitoring loop on/off ─────────────────────────────────

    const toggleMonitor = useCallback(() => {
        if (monitorRef.current?.isRunning()) {
            monitorRef.current.stop();
            monitorRef.current = null;
            setMonitorEnabled(false);
            setMonitorStatus('Monitoring stopped');
        } else {
            const loop = new MonitoringLoop(cooldownRef.current, {
                onSuggestIntervention,
                onLogMotivation: (vector) => {
                    logMotivation(vector);
                    setLastInterventionTs(Date.now());
                },
                onStatusUpdate: (status) => setMonitorStatus(status),
            }, userId);
            monitorRef.current = loop;
            loop.start();
            setMonitorEnabled(true);
        }
    }, [onSuggestIntervention, logMotivation, userId]);

    // ── Abort handlers for breathing/visualization ────────────────────

    const handleBreathingAbort = useCallback(() => {
        if (pendingBanditRef.current && pendingBanditRef.current.action === 'BREATHING') {
            sendBanditUpdate(pendingBanditRef.current.action, pendingBanditRef.current.vector, 0.2, 'skip');
            cooldownRef.current.applyCooldown('BREATHING', 'skip');
            pendingBanditRef.current = null;
            setLastInterventionTs(Date.now());
        }
        setShowBreathing(false);
    }, [sendBanditUpdate]);

    const handleVisualizationAbort = useCallback(() => {
        if (pendingBanditRef.current && pendingBanditRef.current.action === 'VISUALIZATION') {
            sendBanditUpdate(pendingBanditRef.current.action, pendingBanditRef.current.vector, 0.2, 'skip');
            cooldownRef.current.applyCooldown('VISUALIZATION', 'skip');
            pendingBanditRef.current = null;
            setLastInterventionTs(Date.now());
        }
        setShowVisualization(false);
    }, [sendBanditUpdate]);

    // ── Notification response handler (lives here so it persists) ─────

    useEffect(() => {
        const handler = async ({ strategy, action }: { strategy: string; action: string }) => {
            const logAction = action === 'reject' ? 'not_now' : action;

            if (pendingBanditRef.current && ACTION_TO_STRATEGY[pendingBanditRef.current.action] === strategy) {
                const reward = computeReward(logAction);
                await sendBanditUpdate(
                    pendingBanditRef.current.action,
                    pendingBanditRef.current.vector,
                    reward,
                    logAction,
                );

                const banditAction = pendingBanditRef.current.action;
                cooldownRef.current.applyCooldown(
                    banditAction,
                    logAction as 'start' | 'skip' | 'not_now',
                );

                pendingBanditRef.current = null;
                setLastInterventionTs(Date.now());
            }

            if (strategy === 'pomodoro' && action === 'start') {
                startPomodoroTimer();
            } else if (strategy === '5_second_rule' && action === 'start') {
                startFiveSecondCountdown();
            } else if (strategy === 'breathing' && action === 'start') {
                window.electronAPI.intervention.showWindow();
                setShowBreathing(true);
            } else if (strategy === 'visualization' && action === 'start') {
                window.electronAPI.intervention.showWindow();
                setShowVisualization(true);
            }
        };

        const unsubscribe = window.electronAPI.intervention.onNotificationResponse(handler);
        return () => unsubscribe();
    }, [sendBanditUpdate, startPomodoroTimer, startFiveSecondCountdown]);

    // ── Pomodoro idle prompt handler ──────────────────────────────────

    useEffect(() => {
        const unsubscribe = window.electronAPI.intervention.onPomodoroIdleResponse((data: { action: string }) => {
            if (data.action === 'stop') {
                // Stop pomodoro timer
                if (pomodoroIntervalRef.current) {
                    clearInterval(pomodoroIntervalRef.current);
                    pomodoroIntervalRef.current = null;
                }
                if (breakIntervalRef.current) {
                    clearInterval(breakIntervalRef.current);
                    breakIntervalRef.current = null;
                }
                window.electronAPI.intervention.clearTray();
                window.electronAPI.intervention.pomodoroStopped();
                setPomodoroActive(false);

                // Record as skip if there's a pending bandit
                if (pendingBanditRef.current && pendingBanditRef.current.action === 'POMODORO') {
                    sendBanditUpdate(pendingBanditRef.current.action, pendingBanditRef.current.vector, 0.2, 'skip');
                    cooldownRef.current.applyCooldown('POMODORO', 'skip');
                    pendingBanditRef.current = null;
                }
                setLastInterventionTs(Date.now());
            }
            // 'continue' — main process resets idle check, nothing to do in renderer
        });
        return () => unsubscribe();
    }, [sendBanditUpdate]);

    // ── Cleanup on unmount (provider unmount = logout) ────────────────

    useEffect(() => {
        return () => {
            clearAllTimers();
            if (monitorRef.current?.isRunning()) monitorRef.current.stop();
        };
    }, [clearAllTimers]);

    // ── Context value ─────────────────────────────────────────────────

    const value: InterventionContextValue = {
        monitorEnabled,
        monitorStatus,
        toggleMonitor,
        showBreathing,
        showVisualization,
        setShowBreathing,
        setShowVisualization,
        pomodoroActive,
        lastInterventionTs,
        abortBreathing: handleBreathingAbort,
        abortVisualization: handleVisualizationAbort,
    };

    return (
        <InterventionContext.Provider value={value}>
            {children}
        </InterventionContext.Provider>
    );
};
