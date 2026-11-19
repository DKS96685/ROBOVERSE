'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GameProgressResponse, ServerGameAction, TargetSequenceState } from '@/lib/games/state';
import { usePausedGameClock } from './usePausedGameClock';

interface TargetSequenceGameProps {
  initialState: TargetSequenceState;
  minSeconds: number;
  isPaused: boolean;
  onAction: (action: ServerGameAction) => Promise<GameProgressResponse | null>;
  onWin: () => void;
  onLose: () => void;
}

const COLORS = [
  { name: 'CYAN', className: 'bg-retro-cyan' },
  { name: 'MAGENTA', className: 'bg-retro-magenta' },
  { name: 'YELLOW', className: 'bg-retro-yellow' },
  { name: 'GREEN', className: 'bg-retro-green' },
];

export default function TargetSequenceGame({
  initialState,
  minSeconds,
  isPaused,
  onAction,
  onWin,
  onLose,
}: TargetSequenceGameProps) {
  const [previewing, setPreviewing] = useState(true);
  const [previewSeconds, setPreviewSeconds] = useState(4);
  const [input, setInput] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const { secondsElapsed } = usePausedGameClock(isPaused);
  const finishedRef = useRef(false);
  const winNotifiedRef = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!previewing || isPaused) return;
    const timer = window.setTimeout(() => {
      if (previewSeconds <= 1) {
        setPreviewing(false);
        setPreviewSeconds(0);
      } else {
        setPreviewSeconds((value) => value - 1);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [isPaused, previewSeconds, previewing]);

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

  const handlePad = async (value: number) => {
    if (isPaused || previewing || busyRef.current || finishedRef.current) return;
    const nextInput = [...input, value];
    setInput(nextInput);
    setFeedback('');
    if (nextInput.length < initialState.sequence.length) return;

    busyRef.current = true;
    setBusy(true);
    try {
      const result = await onAction({ type: 'targetSequenceSubmit', sequence: nextInput });
      if (result?.correct) {
        finishedRef.current = true;
        if (secondsElapsed >= minSeconds && result.winningReady) {
          winNotifiedRef.current = true;
          onWin();
        } else {
          setWaitingForMinimum(true);
        }
      } else if (result?.failed) {
        finishedRef.current = true;
        onLose();
      } else if (result) {
        setInput([]);
        setFeedback(`NOT QUITE · ${result.remainingAttempts ?? 0} ATTEMPTS LEFT`);
      } else {
        setInput([]);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center p-4">
      <div className="mb-4 flex w-full max-w-sm items-center justify-between border border-retro-cyan/40 bg-retro-card px-4 py-2">
        <span className="font-pixel text-xs text-retro-cyan">INPUT: {input.length}/{initialState.sequence.length}</span>
        <span className="font-pixel text-xs text-retro-yellow">{secondsElapsed}s / {minSeconds}s</span>
      </div>
      {previewing ? (
        <div className="flex min-h-40 flex-col items-center justify-center">
          <p className="mb-4 font-pixel text-xs text-retro-amber">MEMORIZE THE SEQUENCE · {previewSeconds}</p>
          <div className="flex flex-wrap justify-center gap-2" aria-label="Sequence preview">
            {initialState.sequence.map((value, index) => (
              <span
                key={`${index}-${value}`}
                className={`h-8 w-8 rounded ${COLORS[value].className} shadow-lg`}
                aria-label={COLORS[value].name}
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className="mb-4 font-pixel text-xs text-retro-cyan">REPEAT THE FIVE-COLOR SEQUENCE</p>
          <div className="grid grid-cols-2 gap-3">
            {COLORS.map((color, index) => (
              <button
                key={color.name}
                type="button"
                aria-label={color.name}
                onClick={() => void handlePad(index)}
                disabled={isPaused || busy || finishedRef.current}
                className={`h-20 w-24 rounded border-2 border-white/30 ${color.className} transition-transform active:scale-95 disabled:opacity-40 sm:h-24 sm:w-28`}
              />
            ))}
          </div>
        </>
      )}
      {feedback && <p className="mt-3 font-pixel text-xs text-retro-red" aria-live="polite">{feedback}</p>}
      {waitingForMinimum && (
        <p className="mt-3 font-pixel text-xs text-retro-amber" aria-live="polite">
          VERIFIED · WAITING FOR MINIMUM PLAY TIME
        </p>
      )}
    </div>
  );
}
