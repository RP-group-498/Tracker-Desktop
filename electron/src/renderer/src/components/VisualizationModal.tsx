import React, { useEffect, useRef, useState } from 'react';

interface VisualizationModalProps {
    onClose: () => void;
    onAbort: () => void;
}

const VisualizationModal: React.FC<VisualizationModalProps> = ({ onClose, onAbort }) => {
    const [timeLeft, setTimeLeft] = useState(30);
    const [vizText, setVizText] = useState('Focus');
    const [vizInstruction, setVizInstruction] = useState('Imagine the exact steps to finish your task.');
    const [done, setDone] = useState(false);
    const [showAbortPrompt, setShowAbortPrompt] = useState(false);
    const [paused, setPaused] = useState(false);
    const particleContainerRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Generate particles
        if (particleContainerRef.current) {
            for (let i = 0; i < 50; i++) {
                const p = document.createElement('div');
                p.className = 'sie-viz-particle';
                p.style.left = Math.random() * 100 + '%';
                p.style.top = Math.random() * 100 + '%';
                const size = (Math.random() * 3 + 1) + 'px';
                p.style.width = size;
                p.style.height = size;
                p.style.animationDelay = (Math.random() * 5) + 's';
                particleContainerRef.current.appendChild(p);
            }
        }
    }, []);

    useEffect(() => {
        if (done || paused) return;
        timerRef.current = setTimeout(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    setVizText('Well Done');
                    setVizInstruction('Hold onto that feeling of relief and satisfaction.');
                    setDone(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [timeLeft, done, paused]);

    // Blur detection — show abort prompt when user switches away
    useEffect(() => {
        const handleBlur = () => {
            if (!done && !showAbortPrompt) {
                setPaused(true);
                if (timerRef.current) clearTimeout(timerRef.current);
                setShowAbortPrompt(true);
            }
        };
        window.addEventListener('blur', handleBlur);
        return () => window.removeEventListener('blur', handleBlur);
    }, [done, showAbortPrompt]);

    const handleContinue = () => {
        setShowAbortPrompt(false);
        setPaused(false);
    };

    const handleAbort = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        onAbort();
    };

    return (
        <div className="sie-viz-modal">
            <div className="sie-viz-background" ref={particleContainerRef} />
            <div className="sie-viz-container">
                {showAbortPrompt ? (
                    <>
                        <div className="sie-viz-portal">
                            <div className="sie-viz-text">Are you sure?</div>
                        </div>
                        <div className="sie-viz-instruction">Your visualization session is paused.</div>
                        <div className="sie-viz-actions">
                            <button className="sie-modal-btn" onClick={handleAbort}>Yes, abort</button>
                            <button className="sie-modal-btn" onClick={handleContinue}>No, continue</button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="sie-viz-portal">
                            <div className="sie-viz-text">{vizText}</div>
                        </div>
                        <div className="sie-viz-instruction">{vizInstruction}</div>
                        <div className="sie-viz-counter">
                            {done ? 'Visualization Complete' : `${timeLeft}s remaining`}
                        </div>
                        <div className="sie-viz-actions">
                            {!done && <button className="sie-modal-btn" onClick={onClose}>Cancel</button>}
                            {done && <button className="sie-modal-btn" onClick={onClose}>Complete</button>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default VisualizationModal;
