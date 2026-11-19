'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameProgressResponse, MemoryGameState, ServerGameAction } from '@/lib/games/state';
import { soundManager } from '@/lib/sound';
import { usePausedGameClock } from './usePausedGameClock';

interface MemoryMatchGameProps {
  initialState: MemoryGameState;
  onAction: (action: ServerGameAction) => Promise<GameProgressResponse | null>;
  onWin: () => void;
  onLose: () => void;
  minSeconds: number;
  isPaused: boolean;
}

const SYMBOLS = [
  { symbol: '⚡', name: 'POWER' },
  { symbol: '🤖', name: 'CPU' },
  { symbol: '⚙️', name: 'GEAR' },
];

function symbolForCard(state: MemoryGameState, index: number): number | undefined {
  return state.revealedCards.find((card) => card.index === index)?.symbolIndex;
}

export default function MemoryMatchGame({
  initialState,
  onAction,
  onWin,
  onLose,
  minSeconds,
  isPaused,
}: MemoryMatchGameProps) {
  const [gameState, setGameState] = useState(initialState);
  const [resolvingPair, setResolvingPair] = useState(initialState.mismatch);
  const [gameWon, setGameWon] = useState(initialState.matchedIndices.length === 6);
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const { secondsElapsed } = usePausedGameClock(isPaused);

  const pausedRef = useRef(isPaused);
  const busyRef = useRef(false);
  const finishedRef = useRef(false);
  const winNotifiedRef = useRef(false);
  const loseNotifiedRef = useRef(false);
  const mismatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);
  const propsRef = useRef({ onAction, onWin, onLose, minSeconds, secondsElapsed });
  pausedRef.current = isPaused;
  propsRef.current = { onAction, onWin, onLose, minSeconds, secondsElapsed };

  const notifyWin = useCallback(() => {
    if (winNotifiedRef.current) return;
    winNotifiedRef.current = true;
    soundManager.playLevelClear();
    propsRef.current.onWin();
  }, []);

  const notifyLose = useCallback(() => {
    if (loseNotifiedRef.current) return;
    loseNotifiedRef.current = true;
    propsRef.current.onLose();
  }, []);

  const updateFromResponse = useCallback((response: GameProgressResponse) => {
    if (response.gameState?.gameKey !== 'memory') return false;
    setGameState(response.gameState);
    setErrorMessage('');
    if (response.winningReady) {
      finishedRef.current = true;
      setGameWon(true);
      if (propsRef.current.secondsElapsed >= propsRef.current.minSeconds) {
        notifyWin();
      } else {
        setWaitingForMinimum(true);
      }
    }
    return true;
  }, [notifyWin]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (mismatchTimerRef.current) clearTimeout(mismatchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!gameState.mismatch || disposedRef.current) return;
    const resetAfterDelay = () => {
      mismatchTimerRef.current = setTimeout(async () => {
        if (disposedRef.current) return;
        if (pausedRef.current) {
          resetAfterDelay();
          return;
        }
        if (busyRef.current) {
          resetAfterDelay();
          return;
        }
        busyRef.current = true;
        try {
          const result = await propsRef.current.onAction({ type: 'memoryResetSelection' });
          if (disposedRef.current) return;
          if (result && updateFromResponse(result)) {
            setResolvingPair(false);
          } else {
            setErrorMessage('Could not reset the mismatched cards. Please try again.');
            resetAfterDelay();
          }
        } finally {
          busyRef.current = false;
        }
      }, 900);
    };
    resetAfterDelay();
    return () => {
      if (mismatchTimerRef.current) clearTimeout(mismatchTimerRef.current);
    };
  }, [gameState.mismatch, updateFromResponse]);

  useEffect(() => {
    if (waitingForMinimum && secondsElapsed >= minSeconds) {
      setWaitingForMinimum(false);
      notifyWin();
    }
  }, [minSeconds, notifyWin, secondsElapsed, waitingForMinimum]);

  useEffect(() => {
    if (initialState.matchedIndices.length < initialState.cardCount) return;
    finishedRef.current = true;
    setGameWon(true);
    setWaitingForMinimum(true);
  }, [initialState.cardCount, initialState.matchedIndices.length]);

  useEffect(() => {
    if (secondsElapsed >= 120 && !finishedRef.current) {
      finishedRef.current = true;
      notifyLose();
    }
  }, [notifyLose, secondsElapsed]);

  const handleCardClick = async (index: number) => {
    if (
      pausedRef.current
      || finishedRef.current
      || resolvingPair
      || busyRef.current
      || symbolForCard(gameState, index) !== undefined
      || gameState.matchedIndices.includes(index)
    ) return;

    busyRef.current = true;
    try {
      const result = await propsRef.current.onAction({ type: 'memoryFlip', index });
      if (!result || !updateFromResponse(result)) {
        setErrorMessage('Could not verify this card selection. Please try again.');
        return;
      }
      if (result.gameState?.gameKey === 'memory') {
        if (result.gameState.mismatch) {
          setResolvingPair(true);
          soundManager.playDamage();
        } else if (result.progress > gameState.matchedIndices.length / 2) {
          setResolvingPair(false);
          soundManager.playCoin();
        } else {
          soundManager.playBeep(480, 0.05);
        }
      }
    } finally {
      busyRef.current = false;
    }
  };

  const handleForfeit = () => {
    if (pausedRef.current || finishedRef.current) return;
    finishedRef.current = true;
    notifyLose();
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="mb-3 flex w-full max-w-[440px] items-center justify-between rounded border border-retro-cyan/40 bg-retro-card px-4 py-2">
        <div>
          <span className="font-pixel text-sm text-retro-cyan">PAIRS: </span>
          <span className="font-pixel text-sm font-bold text-retro-yellow">{gameState.matchedIndices.length / 2}/3</span>
        </div>
        <div>
          <span className="font-pixel text-sm text-retro-muted">TIME: </span>
          <span className={`font-pixel text-sm font-bold ${secondsElapsed < minSeconds ? 'text-retro-amber' : 'text-retro-green'}`}>
            {secondsElapsed}s / {minSeconds}s
          </span>
        </div>
      </div>

      <p className="mb-3 text-center font-pixel text-sm text-retro-cyan" aria-live="polite">
        {resolvingPair ? 'CHECKING PAIR...' : 'MATCH 3 PAIRS'}
      </p>
      {errorMessage && <p className="mb-2 text-center text-xs text-retro-amber" aria-live="polite">{errorMessage}</p>}

      <div className="relative grid w-full max-w-[440px] grid-cols-3 gap-3 rounded border-2 border-retro-cyan bg-retro-bg p-3 shadow-neon-cyan">
        <div className="pointer-events-none absolute inset-0 rounded bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_4px] opacity-30" />
        {Array.from({ length: 6 }, (_, index) => {
          const symbolIndex = symbolForCard(gameState, index);
          const isMatched = gameState.matchedIndices.includes(index);
          const isOpen = symbolIndex !== undefined;
          const symbol = symbolIndex === undefined ? null : SYMBOLS[symbolIndex];
          return (
            <button
              key={index}
              onClick={() => void handleCardClick(index)}
              disabled={isPaused || resolvingPair || gameWon || isOpen || isMatched || busyRef.current}
              aria-label={isOpen && symbol ? `${symbol.name}${isMatched ? ', matched' : ''}` : 'Hidden card'}
              className={`h-20 w-full touch-manipulation select-none rounded border transition-all duration-200 disabled:cursor-default sm:h-28 ${
                isMatched
                  ? 'border-retro-green bg-retro-card opacity-90 shadow-neon-green'
                  : isOpen
                    ? 'border-retro-cyan bg-retro-card shadow-neon-cyan'
                    : 'border-retro-border bg-[#0d1020] hover:border-retro-cyan/60 active:scale-95'
              }`}
            >
              {isOpen && symbol ? (
                <>
                  <span className="mb-1 block text-2xl sm:text-3xl">{symbol.symbol}</span>
                  <span className="block font-pixel text-[10px] text-retro-cyan">{symbol.name}</span>
                  {isMatched && <span className="font-pixel text-xs text-retro-green">MATCHED</span>}
                </>
              ) : (
                <span className="font-pixel text-lg text-retro-muted">?</span>
              )}
            </button>
          );
        })}
        {gameWon && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded bg-black/85 p-3 text-center">
            <h2 className="mb-2 font-pixel text-xl text-retro-green motion-safe:animate-bounce">3 PAIRS MATCHED!</h2>
            <p className="font-pixel text-sm text-retro-cyan">
              {waitingForMinimum ? `MINIMUM TIME ${secondsElapsed}s / ${minSeconds}s` : 'WIN SUBMITTING...'}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={handleForfeit}
        disabled={isPaused || gameWon || resolvingPair || gameState.moves === 0}
        className="mt-4 px-4 py-3 font-pixel text-sm uppercase text-retro-red/80 underline hover:text-retro-red disabled:opacity-40"
      >
        END THIS ATTEMPT (NO LIFELINE DEDUCTED)
      </button>
    </div>
  );
}
