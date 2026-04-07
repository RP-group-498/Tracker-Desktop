import React, { useEffect, useRef, useState, useCallback } from 'react';

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

    return (
        <div className="sie-breathing-modal">
            <div className="sie-breathing-container">
                {showAbortPrompt ? (
                    <>
                        <div className="sie-breathing-text">Are you sure you want to abort?</div>
                        <div className="sie-breathing-instruction">Your breathing session is paused.</div>
                        <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
                            <button className="sie-modal-btn" onClick={handleAbort}>Yes, abort</button>
                            <button className="sie-modal-btn" onClick={handleContinue}>No, continue</button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="sie-breathing-circle" />
                        <div className="sie-breathing-text">{breathText}</div>
                        <div className="sie-breathing-instruction">{breathInstruction}</div>
                        <div className="sie-breathing-counter">{cycleLabel}</div>
                        <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
                            {!done && (
                                <button className="sie-modal-btn" onClick={onClose}>Cancel</button>
                            )}
                            {done && (
                                <button className="sie-modal-btn" onClick={onClose}>Complete</button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default BreathingModal;
