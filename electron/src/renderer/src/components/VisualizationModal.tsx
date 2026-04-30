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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm animate-in fade-in duration-300 p-4">
            <div className="absolute inset-0 overflow-hidden pointer-events-none" ref={particleContainerRef} />
            <div className="glass-modal p-6 sm:p-8 max-w-md w-full text-center animate-in zoom-in-95 duration-300 relative z-10 max-h-[92vh] overflow-y-auto">
                {showAbortPrompt ? (
                    <>
                        <div className="mx-auto w-32 h-32 rounded-full bg-gradient-to-tr from-purple-100 to-white border border-purple-50 flex items-center justify-center mb-6 shadow-inner">
                            <div className="text-xl font-bold text-slate-800 tracking-tight">Are you sure?</div>
                        </div>
                        <div className="text-sm text-slate-500 mb-6">Your visualization session is paused.</div>
                        <div className="mt-8 flex gap-3 justify-center">
                            <button className="glass-button px-5 py-2.5 text-sm font-medium transition-colors shadow-sm" onClick={handleAbort}>Yes, abort</button>
                            <button className="px-5 py-2.5 bg-purple-600 text-white hover:bg-purple-700 rounded-xl text-sm font-medium transition-colors shadow-sm" onClick={handleContinue}>No, continue</button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="mx-auto w-32 h-32 rounded-full bg-gradient-to-tr from-purple-100 to-white border border-purple-50 flex items-center justify-center mb-6 shadow-inner animate-pulse">
                            <div className="text-2xl font-bold text-purple-900 tracking-tight">{vizText}</div>
                        </div>
                        <div className="text-base text-slate-500 mb-6">{vizInstruction}</div>
                        <div className="text-xs font-semibold text-purple-400 uppercase tracking-widest">
                            {done ? 'Visualization Complete' : `${timeLeft}s remaining`}
                        </div>
                        <div className="mt-8 flex gap-3 justify-center">
                            {!done && <button className="glass-button px-5 py-2.5 text-sm font-medium transition-colors shadow-sm" onClick={onClose}>Cancel</button>}
                            {done && <button className="px-5 py-2.5 bg-purple-600 text-white hover:bg-purple-700 rounded-xl text-sm font-medium transition-colors shadow-sm" onClick={onClose}>Complete</button>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default VisualizationModal;
