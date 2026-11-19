'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import SnakeGame from './SnakeGame';
import PongGame from './PongGame';
import MemoryMatchGame from './MemoryMatchGame';
import { soundManager } from '@/lib/sound';
import { X, Play, Heart, AlertTriangle } from 'lucide-react';

interface GameModalProps {
  game: {
    id: string;
    gameKey: string;
    title: string;
    minSeconds: number;
    status: string;
    clue: string | null;
    projectHint?: string | null;
    puzzle?: {
      id: string;
      questionText: string;
      imageUrl: string;
      options: { id: string; text: string }[];
    } | null;
  };
  lifelinesRemaining: number;
  eventPaused: boolean;
  onClose: () => void;
  onRefreshDashboard: () => void;
}

export default function GameModal({
  game,
  lifelinesRemaining,
  eventPaused,
  onClose,
  onRefreshDashboard,
}: GameModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [countdownValue, setCountdownValue] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [canRetryResult, setCanRetryResult] = useState(false);
  const [retryResult, setRetryResult] = useState<'won' | 'lost' | null>(null);
  const [lifelineRetryAvailable, setLifelineRetryAvailable] = useState(false);
  const [recoveryPuzzle, setRecoveryPuzzle] = useState<any | null>(game.puzzle || null);
  const eventPausedRef = useRef(eventPaused);
  const countdownRef = useRef<number | null>(null);
  const resultSubmittedRef = useRef(false);

  // Result state
  const [resultState, setResultState] = useState<'idle' | 'won' | 'lost'>('idle');
  const [revealedClue, setRevealedClue] = useState<string | null>(game.clue);
  const [revealedProjectHint, setRevealedProjectHint] = useState<string | null>(null);
  const [decodedText, setDecodedText] = useState<string>('');

  useEffect(() => {
    eventPausedRef.current = eventPaused;
  }, [eventPaused]);

  const reportProgress = useCallback(async (
    action: 'snakeFoodCollected' | 'pongPlayerPoint' | 'memoryPairMatched'
  ): Promise<boolean> => {
    if (!sessionId) return false;
    try {
      const res = await fetch('/api/games/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: { type: action } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to verify game progress.');
        return false;
      }
      return Boolean(data.winningReady);
    } catch (error: any) {
      setErrorMsg(error.message || 'Failed to verify game progress.');
      return false;
    }
  }, [sessionId]);

  useEffect(() => () => {
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
  }, []);

  const startServerSession = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/games/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: game.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start game session');
      }

      setSessionId(data.sessionId);
      resultSubmittedRef.current = false;
      setCountdownValue(null);
      setIsPlaying(true);
      soundManager.playCoin();
    } catch (err: any) {
      setCountdownValue(null);
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, [game.id]);

  const handleStartGame = () => {
    if (eventPaused || loading || countdownRef.current !== null) return;
    setErrorMsg(null);
    setCountdownValue('3');
    let remaining = 3;
    countdownRef.current = window.setInterval(() => {
      if (eventPausedRef.current) return;
      if (remaining > 1) {
        remaining -= 1;
        setCountdownValue(String(remaining));
      } else if (remaining === 1) {
        remaining = 0;
        setCountdownValue('GO!');
      } else {
        if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
        countdownRef.current = null;
        void startServerSession();
      }
    }, 1000);
  };

  // Animate decoding clue text
  const animateClueDecoding = useCallback((fullClue: string) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#@$%&*<>{}[]';
    let iteration = 0;
    const interval = setInterval(() => {
      setDecodedText(
        fullClue
          .split('')
          .map((letter, index) => {
            if (index < iteration) {
              return fullClue[index];
            }
            if (letter === ' ') return ' ';
            return chars[Math.floor(Math.random() * chars.length)];
          })
          .join('')
      );

      if (iteration >= fullClue.length) {
        clearInterval(interval);
      }
      iteration += 1.5;
    }, 25);
  }, []);

  // Submit Win
  const handleWin = useCallback(async () => {
    if (!sessionId || resultSubmittedRef.current) return;
    if (eventPausedRef.current) {
      setErrorMsg('Event is paused. Retry the win submission after it resumes.');
      setCanRetryResult(true);
      setRetryResult('won');
      return;
    }
    resultSubmittedRef.current = true;
    try {
      const res = await fetch('/api/games/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, result: 'won', progress: 3, submissionKey: sessionId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResultState('won');
        setIsPlaying(false);
        setRevealedClue(data.clue);
        setRevealedProjectHint(data.projectHint || null);
        setCanRetryResult(false);
        setRetryResult(null);

        // Confetti burst
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#00f0ff', '#ff007f', '#ffe600', '#00ff66'],
        });

        animateClueDecoding(data.clue);
        onRefreshDashboard();
      } else {
        setErrorMsg(data.error || 'Win validation failed');
        setCanRetryResult(true);
        setRetryResult('won');
        resultSubmittedRef.current = false;
      }
    } catch (e: any) {
      setErrorMsg(e.message);
      setCanRetryResult(true);
      setRetryResult('won');
      resultSubmittedRef.current = false;
    }
  }, [animateClueDecoding, onRefreshDashboard, sessionId]);

  // Submit Lose
  const handleLose = useCallback(async () => {
    if (!sessionId || resultSubmittedRef.current) return;
    if (eventPausedRef.current) {
      setErrorMsg('Event is paused. Retry the result submission after it resumes.');
      setCanRetryResult(true);
      setRetryResult('lost');
      return;
    }
    resultSubmittedRef.current = true;
    try {
      const res = await fetch('/api/games/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, result: 'lost', submissionKey: sessionId }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.firstAttemptFailed) {
          setResultState('idle');
          setIsPlaying(false);
          setLifelineRetryAvailable(Boolean(data.lifelineAvailable));
          setErrorMsg('First attempt failed. You may use the lifeline for one second attempt.');
          onRefreshDashboard();
          return;
        }
        if (data.pendingRecoveryPuzzle) {
          setResultState('idle');
          setIsPlaying(false);
          setRecoveryPuzzle(data.puzzle);
          setErrorMsg('Recovery puzzle required. The clue remains locked.');
          onRefreshDashboard();
          return;
        }
        setResultState('lost');
        setIsPlaying(false);
        setRevealedClue(data.clue);
        setRevealedProjectHint(null);
        setRetryResult(null);
        setCanRetryResult(false);
        animateClueDecoding(data.clue);
        onRefreshDashboard();
      } else {
        setErrorMsg(data.error || 'Failed to submit game result.');
        setCanRetryResult(true);
        setRetryResult('lost');
        resultSubmittedRef.current = false;
      }
    } catch (e: any) {
      setErrorMsg(e.message);
      setCanRetryResult(true);
      setRetryResult('lost');
      resultSubmittedRef.current = false;
    }
  }, [animateClueDecoding, onRefreshDashboard, sessionId]);

  const handleLifelineRetry = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/games/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: game.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start lifeline retry');
      setSessionId(data.sessionId);
      resultSubmittedRef.current = false;
      setLifelineRetryAvailable(false);
      setIsPlaying(true);
      onRefreshDashboard();
    } catch (error: any) {
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePuzzleAnswer = async (answer: string) => {
    if (!recoveryPuzzle?.id) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/games/puzzle/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ puzzleId: recoveryPuzzle.id, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit puzzle answer');
      if (data.correct) {
        setRecoveryPuzzle(null);
        setResultState('lost');
        setRevealedClue(data.clue);
        if (data.clue) animateClueDecoding(data.clue);
        onRefreshDashboard();
      } else {
        setErrorMsg(data.message || 'Incorrect answer. Try again.');
      }
    } catch (error: any) {
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Use Lifeline to Skip
  const handleSkipWithLifeline = async () => {
    if (lifelinesRemaining < 1 || eventPaused || loading || resultSubmittedRef.current) return;
    if (!confirm('Are you sure you want to spend 1 Lifeline to skip this game and instantly reveal its clue?')) {
      return;
    }

    resultSubmittedRef.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/games/lifeline-skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: game.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        soundManager.playDamage();
        setResultState('lost');
        setRevealedClue(data.clue);
        setRevealedProjectHint(null);
        animateClueDecoding(data.clue);
        onRefreshDashboard();
      } else {
        setErrorMsg(data.error || 'Failed to use lifeline');
        resultSubmittedRef.current = false;
      }
    } catch (e: any) {
      setErrorMsg(e.message);
      resultSubmittedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-retro-card border-2 border-retro-cyan shadow-neon-cyan rounded-lg overflow-hidden flex flex-col my-auto">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#0a0c16] border-b border-retro-cyan/40">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-retro-cyan animate-pulse" />
            <h2 className="font-pixel text-xs sm:text-sm text-retro-cyan tracking-wider">
              {game.title.toUpperCase()}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-retro-muted hover:text-retro-cyan p-1 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div className="mx-4 mt-3 p-3 bg-retro-red/20 border border-retro-red/60 text-retro-red text-xs font-pixel rounded flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {eventPaused && (
          <div className="mx-4 mt-3 p-3 border border-retro-amber/60 bg-retro-amber/10 text-retro-amber text-xs font-pixel rounded text-center">
            EVENT PAUSED — GAMEPLAY AND COUNTDOWN ARE FROZEN
          </div>
        )}

        {/* Modal Body */}
        <div className="p-4 sm:p-6 flex flex-col items-center">
          {/* 1. Playing State */}
          {isPlaying && (
            <div className="w-full flex flex-col items-center">
              {game.gameKey === 'snake' && (
                <SnakeGame
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onProgress={reportProgress}
                  onWin={handleWin}
                  onLose={handleLose}
                />
              )}
              {game.gameKey === 'pong' && (
                <PongGame
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onProgress={reportProgress}
                  onWin={handleWin}
                  onLose={handleLose}
                />
              )}
              {game.gameKey === 'memory' && (
                <MemoryMatchGame
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onProgress={reportProgress}
                  onWin={handleWin}
                  onLose={handleLose}
                />
              )}
            </div>
          )}

          {/* 2. Result Screen (Clue Unlocked) */}
          {!isPlaying && resultState !== 'idle' && revealedClue && (
            <div className="w-full flex flex-col items-center py-4 text-center">
              {resultState === 'won' ? (
                <div className="mb-4">
                  <h3 className="font-pixel text-retro-green text-xl mb-1 animate-pulse">
                    ★ LEVEL CLEARED ★
                  </h3>
                  <p className="text-xs text-retro-cyan font-pixel">DATA TRANSMISSION VERIFIED</p>
                </div>
              ) : (
                <div className="mb-4">
                  <h3 className="font-pixel text-retro-amber text-lg mb-1">
                    [TASK BYPASSED VIA LIFELINE]
                  </h3>
                  <p className="text-xs text-retro-muted font-pixel">1 LIFELINE EXPENDED</p>
                </div>
              )}

              {/* Decoded Clue Terminal Box */}
              <div className="w-full p-4 bg-retro-bg border-2 border-retro-yellow shadow-neon-yellow rounded text-left my-3">
                <div className="flex items-center justify-between border-b border-retro-yellow/30 pb-2 mb-3">
                  <span className="text-[10px] font-pixel text-retro-yellow uppercase">
                    CLASSIFIED PROJECT INTEL DECRYPTED:
                  </span>
                  <span className="text-[9px] font-pixel text-retro-green">STATUS: UNLOCKED</span>
                </div>
                <p className="font-retro text-lg sm:text-xl text-retro-cyan leading-relaxed">
                  {decodedText || revealedClue}
                </p>
              </div>
              {resultState === 'won' && revealedProjectHint && (
                <div className="w-full p-4 bg-retro-bg border border-retro-magenta/70 rounded text-left my-2">
                  <span className="text-[10px] font-pixel text-retro-magenta block mb-2">
                    PROJECT HINT UNLOCKED
                  </span>
                  <p className="font-retro text-base sm:text-lg text-white leading-relaxed">
                    {revealedProjectHint}
                  </p>
                </div>
              )}

              <button
                onClick={onClose}
                className="mt-4 px-6 py-2.5 bg-retro-cyan text-retro-bg font-pixel text-xs rounded hover:bg-white transition-all shadow-neon-cyan font-bold"
              >
                RETURN TO DASHBOARD
              </button>
            </div>
          )}

          {/* Recovery puzzle */}
          {!isPlaying && recoveryPuzzle && (
            <div className="w-full flex flex-col items-center py-2">
              <h3 className="font-pixel text-sm text-retro-magenta mb-3">
                COMPONENT IDENTIFICATION RECOVERY
              </h3>
              <img
                src={recoveryPuzzle.imageUrl}
                alt="Electronic component for identification"
                className="max-h-64 w-auto max-w-full rounded border border-retro-cyan mb-4 object-contain"
              />
              <p className="text-sm text-white mb-4 text-center">
                {recoveryPuzzle.questionText || 'Which electronic component or board is shown in this picture?'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {recoveryPuzzle.options.map((option: any) => (
                  <button
                    key={option.id}
                    onClick={() => void handlePuzzleAnswer(option.text)}
                    disabled={loading || eventPaused}
                    className="py-3 px-3 border border-retro-border bg-retro-card text-xs text-white rounded hover:border-retro-cyan hover:text-retro-cyan disabled:opacity-40"
                  >
                    {option.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 3. Instructions Screen */}
          {!isPlaying && resultState === 'idle' && countdownValue === null && !recoveryPuzzle && (
            <div className="w-full flex flex-col items-center text-center py-4">
              <div className="w-16 h-16 rounded-full bg-retro-cyan/10 border-2 border-retro-cyan flex items-center justify-center text-2xl mb-4 shadow-neon-cyan">
                {game.gameKey === 'snake' ? '🐍' : game.gameKey === 'pong' ? '🏓' : '🧠'}
              </div>

              <h3 className="font-pixel text-lg text-white mb-2">{game.title}</h3>
              <p className="text-sm text-retro-muted font-pixel mb-6 max-w-md">
                Reach 3 progress units. The game begins only after the 3, 2, 1, GO! countdown.
              </p>

              <div className="bg-[#0b0d18] border border-retro-border p-3 rounded mb-6 text-left w-full max-w-sm space-y-2 text-sm font-mono">
                <p className="text-retro-cyan font-bold">
                  {game.gameKey === 'snake'
                    ? 'CONTROLS: Arrow keys / WASD or the touch D-pad.'
                    : game.gameKey === 'pong'
                    ? 'CONTROLS: W/S, arrow keys, or drag your paddle.'
                    : 'CONTROLS: Watch the preview, then tap two cards to match them.'}
                </p>
                <div className="flex justify-between">
                  <span className="text-retro-muted">Minimum Time:</span>
                  <span className="text-retro-cyan font-bold">{game.minSeconds} Seconds</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-retro-muted">Lifeline Available:</span>
                  <span className="text-retro-magenta font-bold">{lifelinesRemaining} Left</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-retro-muted">Rule:</span>
                  <span className="text-retro-yellow">Loss cuts 1 Lifeline & skips game</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                <button
                  onClick={handleStartGame}
                  disabled={loading || eventPaused}
                  className="flex-1 py-3 px-4 bg-retro-cyan text-retro-bg font-pixel text-xs rounded font-bold hover:bg-white active:scale-95 transition-all shadow-neon-cyan flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {eventPaused ? 'EVENT PAUSED' : 'START GAME'}
                </button>

                <button
                  onClick={handleLifelineRetry}
                  disabled={loading || eventPaused || !lifelineRetryAvailable || lifelinesRemaining < 1}
                  className="py-3 px-4 bg-retro-card border border-retro-magenta text-retro-magenta hover:bg-retro-magenta/20 active:scale-95 font-pixel text-xs rounded transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                  title="Use the one lifeline for a second attempt"
                >
                  <Heart className="w-4 h-4 fill-current text-retro-magenta" />
                  USE LIFELINE FOR RETRY
                </button>

              </div>
            </div>
          )}

          {countdownValue !== null && !isPlaying && (
            <div className="min-h-72 w-full flex flex-col items-center justify-center text-center">
              <span className="font-pixel text-retro-yellow text-6xl sm:text-8xl motion-safe:animate-pulse">
                {countdownValue}
              </span>
              <p className="mt-4 font-pixel text-sm text-retro-cyan">
                {eventPaused ? 'PAUSED — COUNTDOWN WILL RESUME' : 'GET READY'}
              </p>
            </div>
          )}

          {canRetryResult && resultState === 'idle' && (
            <button
              onClick={() => void (retryResult === 'lost' ? handleLose() : handleWin())}
              disabled={eventPaused}
              className="mt-4 px-5 py-3 bg-retro-green text-retro-bg font-pixel text-xs rounded font-bold disabled:opacity-40"
            >
              RETRY RESULT SUBMISSION
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
