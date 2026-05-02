import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const BREATHING_STATES = [
    { text: 'Breathe In', instruction: 'Slowly inhale through your nose', duration: 4000 },
    { text: 'Hold', instruction: 'Hold your breath', duration: 2000 },
    { text: 'Breathe Out', instruction: 'Slowly exhale through your mouth', duration: 4000 },
    { text: 'Hold', instruction: 'Hold your breath', duration: 2000 },
];

const TOTAL_CYCLES = 3;

interface BreathingModalProps {
    onClose: () => void;
    onAbort: () => void;
}

const BreathingModal: React.FC<BreathingModalProps> = ({ onClose, onAbort }) => {
    const [breathText, setBreathText] = useState('Breathe In');
    const [breathInstruction, setBreathInstruction] = useState('Slowly inhale through your nose');
    const [cycleLabel, setCycleLabel] = useState('Cycle 1 of 3');
    const [done, setDone] = useState(false);
    const [showAbortPrompt, setShowAbortPrompt] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const stateRef = useRef(0);
    const cycleRef = useRef(0);
    const pausedRef = useRef(false);

    const step = useCallback(() => {
        if (pausedRef.current) return;
        const state = BREATHING_STATES[stateRef.current];
        setBreathText(state.text);
        setBreathInstruction(state.instruction);
        stateRef.current++;
        if (stateRef.current >= BREATHING_STATES.length) {
            stateRef.current = 0;
            cycleRef.current++;
            if (cycleRef.current >= TOTAL_CYCLES) {
                setCycleLabel('Complete!');
                setDone(true);
                return;
            }
            setCycleLabel(`Cycle ${cycleRef.current + 1} of ${TOTAL_CYCLES}`);
        }
        timerRef.current = setTimeout(step, BREATHING_STATES[stateRef.current].duration);
    }, []);

    useEffect(() => {
        timerRef.current = setTimeout(step, BREATHING_STATES[0].duration);
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [step]);

    // Blur detection — show abort prompt when user switches away
    useEffect(() => {
        const handleBlur = () => {
            if (!done && !showAbortPrompt) {
                pausedRef.current = true;
                if (timerRef.current) clearTimeout(timerRef.current);
                setShowAbortPrompt(true);
            }
        };
        window.addEventListener('blur', handleBlur);
        return () => window.removeEventListener('blur', handleBlur);
    }, [done, showAbortPrompt]);

    const handleContinue = () => {
        setShowAbortPrompt(false);
        pausedRef.current = false;
        // Resume from current state
        timerRef.current = setTimeout(step, BREATHING_STATES[stateRef.current].duration);
    };

    const handleAbort = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        onAbort();
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/10 backdrop-blur-[2px] animate-fade-in p-4">
            <div className="glass-modal p-6 sm:p-8 max-w-md w-full text-center animate-in zoom-in-95 duration-300 max-h-[92vh] overflow-y-auto">
                {showAbortPrompt ? (
                    <>
                        <div className="text-xl font-bold text-slate-800 mb-2 tracking-tight">Are you sure you want to abort?</div>
                        <div className="text-sm text-slate-500 mb-6">Your breathing session is paused.</div>
                        <div className="mt-8 flex gap-3 justify-center">
                            <button className="glass-button px-5 py-2.5 text-sm font-medium transition-colors shadow-sm" onClick={handleAbort}>Yes, abort</button>
                            <button className="px-5 py-2.5 bg-purple-600 text-white hover:bg-purple-700 rounded-xl text-sm font-medium transition-colors shadow-sm" onClick={handleContinue}>No, continue</button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="mx-auto w-24 h-24 rounded-full border-4 border-purple-100 flex items-center justify-center mb-6 animate-pulse">
                            <div className="w-16 h-16 rounded-full bg-purple-100/50" />
                        </div>
                        <div className="text-2xl font-bold text-purple-900 mb-2 tracking-tight">{breathText}</div>
                        <div className="text-base text-slate-500 mb-6">{breathInstruction}</div>
                        <div className="text-xs font-semibold text-purple-400 uppercase tracking-widest">{cycleLabel}</div>
                        <div className="mt-8 flex gap-3 justify-center">
                            {!done && (
                                <button className="glass-button px-5 py-2.5 text-sm font-medium transition-colors shadow-sm" onClick={onClose}>Cancel</button>
                            )}
                            {done && (
                                <button className="px-5 py-2.5 bg-purple-600 text-white hover:bg-purple-700 rounded-xl text-sm font-medium transition-colors shadow-sm" onClick={onClose}>Complete</button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
};

export default BreathingModal;
