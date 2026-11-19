'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GameProgressResponse, LightsOutState, ServerGameAction } from '@/lib/games/state';
import { usePausedGameClock } from './usePausedGameClock';

interface LightsOutGameProps {
  initialState: LightsOutState;
  minSeconds: number;
  isPaused: boolean;
  onAction: (action: ServerGameAction) => Promise<GameProgressResponse | null>;
  onWin: () => void;
  onLose: () => void;
}

export default function LightsOutGame({
  initialState,
  minSeconds,
  isPaused,
  onAction,
  onWin,
  onLose,
}: LightsOutGameProps) {
  const [board, setBoard] = useState(initialState.board);
  const [busy, setBusy] = useState(false);
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const { secondsElapsed } = usePausedGameClock(isPaused);
  const busyRef = useRef(false);
  const finishedRef = useRef(false);
  const winNotifiedRef = useRef(false);

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

  const handleToggle = async (index: number) => {
    if (isPaused || busyRef.current || finishedRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await onAction({ type: 'lightsOutToggle', index });
      if (result?.gameState?.gameKey !== 'lights-out') return;
      setBoard(result.gameState.board);
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
  };

  return (
    <div className="flex flex-col items-center p-4">
      <div className="mb-4 flex w-full max-w-sm items-center justify-between border border-retro-cyan/40 bg-retro-card px-4 py-2">
        <span className="font-pixel text-xs text-retro-cyan">LIGHTS OFF: {board.filter((cell) => !cell).length}/9</span>
        <span className="font-pixel text-xs text-retro-yellow">{secondsElapsed}s / {minSeconds}s</span>
      </div>
      <div className="grid grid-cols-3 gap-3" role="group" aria-label="Lights Out puzzle">
        {board.map((isOn, index) => (
          <button
            key={index}
            type="button"
            aria-label={`Light ${index + 1} ${isOn ? 'on' : 'off'}`}
            aria-pressed={isOn}
            disabled={isPaused || busy || finishedRef.current}
            onClick={() => void handleToggle(index)}
            className={`h-20 w-20 rounded border-2 transition-colors sm:h-24 sm:w-24 ${
              isOn
                ? 'border-retro-yellow bg-retro-yellow/80 shadow-neon-yellow'
                : 'border-retro-border bg-retro-bg'
            } disabled:cursor-not-allowed`}
          />
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-retro-muted">Each move toggles the selected light and its adjacent neighbors.</p>
      {waitingForMinimum && (
        <p className="mt-3 font-pixel text-xs text-retro-amber" aria-live="polite">
          VERIFIED · WAITING FOR MINIMUM PLAY TIME
        </p>
      )}
    </div>
  );
}
