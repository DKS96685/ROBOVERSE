'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import SnakeGame from './SnakeGame';
import PongGame from './PongGame';
import MemoryMatchGame from './MemoryMatchGame';
import LightsOutGame from './LightsOutGame';
import QuickMazeGame from './QuickMazeGame';
import TargetSequenceGame from './TargetSequenceGame';
import { soundManager } from '@/lib/sound';
import { getGameCatalogEntry } from '@/lib/config/gameCatalog';
import {
  GameProgressResponse,
  ServerGameAction,
  ServerGameState,
  parseServerGameState,
} from '@/lib/games/state';
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
  const [serverGameState, setServerGameState] = useState<ServerGameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [canRetryResult, setCanRetryResult] = useState(false);
  const [retryResult, setRetryResult] = useState<'won' | 'lost' | null>(null);
  const [lifelineRetryAvailable, setLifelineRetryAvailable] = useState(
    game.status === 'FIRST_ATTEMPT_FAILED' && lifelinesRemaining > 0
  );
  const [recoveryPuzzle, setRecoveryPuzzle] = useState<any | null>(game.puzzle || null);
  const [puzzleImageError, setPuzzleImageError] = useState<string | null>(null);
  const [puzzleImageRefreshAttempted, setPuzzleImageRefreshAttempted] = useState(false);
  const eventPausedRef = useRef(eventPaused);
  const countdownRef = useRef<number | null>(null);
  const resultSubmittedRef = useRef(false);
  const actionSequenceRef = useRef(0);

  const refreshRecoveryPuzzleImage = useCallback(async () => {
    if (!recoveryPuzzle?.id) return;
    setPuzzleImageError(null);
    try {
      const response = await fetch(`/api/games/puzzle?gameId=${encodeURIComponent(game.id)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.puzzle?.imageUrl) throw new Error(data.error || 'Could not refresh the recovery image.');
      setRecoveryPuzzle(data.puzzle);
      setPuzzleImageRefreshAttempted(true);
    } catch (error) {
      setPuzzleImageError(error instanceof Error ? error.message : 'Could not load the recovery image.');
    }
  }, [game.id, recoveryPuzzle?.id]);

  // Result state
  const [resultState, setResultState] = useState<'idle' | 'won' | 'recovered'>('idle');
  const [revealedClue, setRevealedClue] = useState<string | null>(game.clue);
  const [decodedText, setDecodedText] = useState<string>('');
  const [pointsAwarded, setPointsAwarded] = useState<number | null>(null);

  useEffect(() => {
    eventPausedRef.current = eventPaused;
  }, [eventPaused]);

  const submitGameAction = useCallback(async (
    action: ServerGameAction
  ): Promise<GameProgressResponse | null> => {
    if (!sessionId) return null;
    const orderedGame = ['snake', 'pong', 'memory'].includes(game.gameKey);
    const actionSequence = orderedGame ? actionSequenceRef.current + 1 : undefined;
    const body = JSON.stringify({
      sessionId,
      requestId: window.crypto.randomUUID(),
      ...(actionSequence === undefined ? {} : { actionSequence }),
      action,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('/api/games/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const data = await res.json();
        if (
          res.status === 409
          && attempt === 0
          && data.error === 'Progress update conflicted. Retry.'
        ) continue;
        if (!res.ok) {
          if (Number.isSafeInteger(data.expectedActionSequence)) {
            actionSequenceRef.current = Math.max(0, data.expectedActionSequence - 1);
          }
          setErrorMsg(data.error || 'Failed to verify game progress.');
          return null;
        }
        if (Number.isSafeInteger(data.nextActionSequence)) {
          actionSequenceRef.current = data.nextActionSequence;
        }
        return data as GameProgressResponse;
      } catch (error) {
        if (attempt === 1) {
          setErrorMsg(error instanceof Error ? error.message : 'Failed to verify game progress.');
          return null;
        }
      }
    }
    return null;
  }, [game.gameKey, sessionId]);

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

      const parsedState = parseServerGameState(data.gameConfig);
      if (!parsedState || parsedState.gameKey !== game.gameKey) {
        throw new Error('The server did not return a valid game state. Please contact an administrator.');
      }
      setSessionId(data.sessionId);
      actionSequenceRef.current = Number.isSafeInteger(data.actionSequence) ? data.actionSequence : 0;
      setServerGameState(parsedState);
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
  }, [game.gameKey, game.id]);

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
        body: JSON.stringify({ sessionId, result: 'won', submissionKey: sessionId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResultState('won');
        setIsPlaying(false);
        setRevealedClue(data.clue);
        setPointsAwarded(data.points);
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
      const verifiedFailure = await submitGameAction({ type: 'forfeitAttempt' });
      if (!verifiedFailure?.failed) {
        resultSubmittedRef.current = false;
        setErrorMsg('The server could not verify the failed attempt. Please retry after checking the connection.');
        setCanRetryResult(true);
        setRetryResult('lost');
        return;
      }

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
          setPuzzleImageError(null);
          setPuzzleImageRefreshAttempted(false);
          setErrorMsg('Recovery puzzle required. The clue remains locked.');
          onRefreshDashboard();
          return;
        }
        setErrorMsg('The server returned an unexpected game result. Please refresh the dashboard.');
        setCanRetryResult(true);
        setRetryResult('lost');
        resultSubmittedRef.current = false;
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
  }, [onRefreshDashboard, sessionId, submitGameAction]);

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
      actionSequenceRef.current = Number.isSafeInteger(data.actionSequence) ? data.actionSequence : 0;
      const parsedState = parseServerGameState(data.gameConfig);
      if (!parsedState || parsedState.gameKey !== game.gameKey) {
        throw new Error('The server did not return a valid retry state. Please contact an administrator.');
      }
      setServerGameState(parsedState);
      resultSubmittedRef.current = false;
      setRetryResult(null);
      setCanRetryResult(false);
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
        setResultState('recovered');
        setRevealedClue(data.clue);
        setPointsAwarded(0);
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
                serverGameState?.gameKey === 'snake' && (
                <SnakeGame
                  initialState={serverGameState}
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onAction={submitGameAction}
                  onWin={handleWin}
                  onLose={handleLose}
                />
                )
              )}
              {game.gameKey === 'pong' && (
                serverGameState?.gameKey === 'pong' && (
                <PongGame
                  initialState={serverGameState}
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onAction={submitGameAction}
                  onWin={handleWin}
                  onLose={handleLose}
                />
                )
              )}
              {game.gameKey === 'memory' && (
                serverGameState?.gameKey === 'memory' && (
                <MemoryMatchGame
                  initialState={serverGameState}
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onAction={submitGameAction}
                  onWin={handleWin}
                  onLose={handleLose}
                />
                )
              )}
              {game.gameKey === 'lights-out' && serverGameState?.gameKey === 'lights-out' && (
                <LightsOutGame
                  initialState={serverGameState}
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onAction={submitGameAction}
                  onWin={handleWin}
                  onLose={handleLose}
                />
              )}
              {game.gameKey === 'quick-maze' && serverGameState?.gameKey === 'quick-maze' && (
                <QuickMazeGame
                  initialState={serverGameState}
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onAction={submitGameAction}
                  onWin={handleWin}
                  onLose={handleLose}
                />
              )}
              {game.gameKey === 'target-sequence' && serverGameState?.gameKey === 'target-sequence' && (
                <TargetSequenceGame
                  initialState={serverGameState}
                  minSeconds={game.minSeconds}
                  isPaused={eventPaused}
                  onAction={submitGameAction}
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
                  <p className="text-xs text-retro-cyan font-pixel">
                    VERIFIED COMPLETION · {pointsAwarded ?? 0} POINTS
                  </p>
                </div>
              ) : (
                <div className="mb-4">
                  <h3 className="font-pixel text-retro-amber text-lg mb-1">
                    [GAME SKIPPED AFTER RECOVERY]
                  </h3>
                  <p className="text-xs text-retro-muted font-pixel">0 POINTS · CONTINUE TO YOUR NEXT GAME</p>
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
                onError={() => {
                  if (!puzzleImageRefreshAttempted) {
                    setPuzzleImageRefreshAttempted(true);
                    void refreshRecoveryPuzzleImage();
                  } else {
                    setPuzzleImageError('The recovery image could not be loaded.');
                  }
                }}
              />
              {puzzleImageError && (
                <div role="alert" className="mb-3 text-sm text-retro-red">
                  {puzzleImageError}{' '}
                  <button type="button" onClick={() => { setPuzzleImageRefreshAttempted(false); void refreshRecoveryPuzzleImage(); }} className="underline">Retry image</button>
                </div>
              )}
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
                {getGameCatalogEntry(game.gameKey)?.description || 'Complete this assigned challenge to unlock its project clue.'}
              </p>

              <div className="bg-[#0b0d18] border border-retro-border p-3 rounded mb-6 text-left w-full max-w-sm space-y-2 text-sm font-mono">
                <p className="text-retro-cyan font-bold">
                  CONTROLS: {getGameCatalogEntry(game.gameKey)?.controls || 'Use the on-screen game controls.'}
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
                  <span className="text-retro-yellow">
                    {game.status === 'IN_PROGRESS'
                      ? 'Resume your current attempt'
                      : 'Failure does not automatically spend your lifeline'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                <button
                  onClick={handleStartGame}
                  disabled={loading || eventPaused || lifelineRetryAvailable}
                  className="flex-1 py-3 px-4 bg-retro-cyan text-retro-bg font-pixel text-xs rounded font-bold hover:bg-white active:scale-95 transition-all shadow-neon-cyan flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {eventPaused
                    ? 'EVENT PAUSED'
                    : game.status === 'IN_PROGRESS' || game.status === 'SECOND_ATTEMPT_IN_PROGRESS'
                    ? 'RESUME GAME'
                    : 'START GAME'}
                </button>

                {lifelineRetryAvailable && (
                  <button
                    onClick={handleLifelineRetry}
                    disabled={loading || eventPaused || lifelinesRemaining < 1}
                    className="py-3 px-4 bg-retro-card border border-retro-magenta text-retro-magenta hover:bg-retro-magenta/20 active:scale-95 font-pixel text-xs rounded transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                    title="Use the one lifeline for a second attempt"
                  >
                    <Heart className="w-4 h-4 fill-current text-retro-magenta" />
                    USE LIFELINE FOR RETRY
                  </button>
                )}

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
