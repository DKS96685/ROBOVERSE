'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameProgressResponse, MazeDirection, QuickMazeState, ServerGameAction } from '@/lib/games/state';
import { usePausedGameClock } from './usePausedGameClock';

interface QuickMazeGameProps {
  initialState: QuickMazeState;
  minSeconds: number;
  isPaused: boolean;
  onAction: (action: ServerGameAction) => Promise<GameProgressResponse | null>;
  onWin: () => void;
  onLose: () => void;
}

const DIRECTIONS: { direction: MazeDirection; label: string }[] = [
  { direction: 'up', label: '▲' },
  { direction: 'left', label: '◀' },
  { direction: 'down', label: '▼' },
  { direction: 'right', label: '▶' },
];

export default function QuickMazeGame({
  initialState,
  minSeconds,
  isPaused,
  onAction,
  onWin,
  onLose,
}: QuickMazeGameProps) {
  const [mazeState, setMazeState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const { secondsElapsed } = usePausedGameClock(isPaused);
  const pausedRef = useRef(isPaused);
  const busyRef = useRef(false);
  const finishedRef = useRef(false);
  const winNotifiedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (waitingForMinimum && secondsElapsed >= minSeconds && !winNotifiedRef.current) {
      winNotifiedRef.current = true;
      onWin();
    }
  }, [minSeconds, onWin, secondsElapsed, waitingForMinimum]);

  useEffect(() => {
    if (secondsElapsed >= 120 && !finishedRef.current) {
      finishedRef.current = true;
      onLose();
    }
  }, [onLose, secondsElapsed]);

  const move = useCallback(async (direction: MazeDirection) => {
    if (pausedRef.current || busyRef.current || finishedRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await onAction({ type: 'quickMazeMove', direction });
      if (result?.gameState?.gameKey !== 'quick-maze') return;
      setMazeState(result.gameState);
      if (result.winningReady) {
        finishedRef.current = true;
        if (secondsElapsed >= minSeconds) {
          winNotifiedRef.current = true;
          onWin();
        } else {
          setWaitingForMinimum(true);
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [minSeconds, onAction, onWin, secondsElapsed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const directionByKey: Record<string, MazeDirection> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
      };
      const direction = directionByKey[event.key] || directionByKey[event.key.toLowerCase()];
      if (!direction) return;
      event.preventDefault();
      void move(direction);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [move]);

  return (
    <div className="flex flex-col items-center p-4">
      <div className="mb-4 flex w-full max-w-sm items-center justify-between border border-retro-cyan/40 bg-retro-card px-4 py-2">
        <span className="font-pixel text-xs text-retro-cyan">MOVES: {mazeState.moves}</span>
        <span className="font-pixel text-xs text-retro-yellow">{secondsElapsed}s / {minSeconds}s</span>
      </div>
      <div
        className="grid gap-1 border-2 border-retro-cyan bg-retro-bg p-2"
        style={{ gridTemplateColumns: `repeat(${mazeState.maze[0].length}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Quick Maze"
      >
        {mazeState.maze.flatMap((row, rowIndex) =>
          row.map((cell, columnIndex) => {
            const isPlayer = rowIndex === mazeState.row && columnIndex === mazeState.column;
            const isExit = rowIndex === mazeState.exitRow && columnIndex === mazeState.exitColumn;
            return (
              <div
                key={`${rowIndex}-${columnIndex}`}
                role="gridcell"
                aria-label={isPlayer ? 'Player' : isExit ? 'Exit' : cell === 1 ? 'Wall' : 'Path'}
                className={`flex h-7 w-7 items-center justify-center sm:h-9 sm:w-9 ${
                  cell === 1 ? 'bg-retro-muted/30' : 'bg-retro-card'
                }`}
              >
                {isPlayer ? <span className="text-retro-cyan">◆</span> : isExit ? <span className="text-retro-green">★</span> : null}
              </div>
            );
          })
        )}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {DIRECTIONS.map(({ direction, label }) => (
          <button
            key={direction}
            type="button"
            aria-label={`Move ${direction}`}
            onClick={() => void move(direction)}
            disabled={isPaused || busy || finishedRef.current}
            className={`h-12 w-14 rounded border border-retro-cyan bg-retro-card text-retro-cyan disabled:opacity-40 ${
              direction === 'up' || direction === 'down' ? 'col-start-2' : ''
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {waitingForMinimum && (
        <p className="mt-3 font-pixel text-xs text-retro-amber" aria-live="polite">
          VERIFIED · WAITING FOR MINIMUM PLAY TIME
        </p>
      )}
    </div>
  );
}
