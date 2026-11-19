'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameProgressResponse, ServerGameAction, SnakeDirection, SnakeGameState } from '@/lib/games/state';
import { soundManager } from '@/lib/sound';
import { usePausedGameClock } from './usePausedGameClock';

interface SnakeGameProps {
  initialState: SnakeGameState;
  onAction: (action: ServerGameAction) => Promise<GameProgressResponse | null>;
  onWin: () => void;
  onLose: () => void;
  minSeconds: number;
  isPaused: boolean;
}

const STEP_INTERVAL_MS = 500;
const TILE_SIZE = 20;

export default function SnakeGame({
  initialState,
  onAction,
  onWin,
  onLose,
  minSeconds,
  isPaused,
}: SnakeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [gameState, setGameState] = useState(initialState);
  const [gameOver, setGameOver] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const { secondsElapsed } = usePausedGameClock(isPaused);

  const stateRef = useRef(initialState);
  const directionRef = useRef<SnakeDirection>(initialState.direction);
  const pausedRef = useRef(isPaused);
  const busyRef = useRef(false);
  const finishedRef = useRef(false);
  const winNotifiedRef = useRef(false);
  const loseNotifiedRef = useRef(false);
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
    soundManager.playDamage();
    propsRef.current.onLose();
  }, []);

  const changeDirection = useCallback((direction: SnakeDirection) => {
    if (pausedRef.current || finishedRef.current) return;
    const current = directionRef.current;
    const reverse: Record<SnakeDirection, SnakeDirection> = {
      up: 'down',
      down: 'up',
      left: 'right',
      right: 'left',
    };
    if (direction !== reverse[current]) directionRef.current = direction;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const direction = key === 'arrowup' || key === 'w'
        ? 'up'
        : key === 'arrowdown' || key === 's'
          ? 'down'
          : key === 'arrowleft' || key === 'a'
            ? 'left'
            : key === 'arrowright' || key === 'd'
              ? 'right'
              : null;
      if (!direction) return;
      event.preventDefault();
      changeDirection(direction);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeDirection]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const step = async () => {
      if (disposed) return;
      if (pausedRef.current || finishedRef.current || busyRef.current) {
        timer = setTimeout(step, STEP_INTERVAL_MS);
        return;
      }

      busyRef.current = true;
      try {
        const result = await propsRef.current.onAction({
          type: 'snakeStep',
          direction: directionRef.current,
        });
        if (disposed) return;
        if (result?.gameState?.gameKey === 'snake') {
          const previousFoodCollected = stateRef.current.foodCollected;
          stateRef.current = result.gameState;
          directionRef.current = result.gameState.direction;
          setGameState(result.gameState);
          setErrorMessage('');
          if (result.failed) {
            finishedRef.current = true;
            setGameOver(true);
            notifyLose();
          } else if (result.winningReady) {
            finishedRef.current = true;
            setGameWon(true);
            if (propsRef.current.secondsElapsed >= propsRef.current.minSeconds) {
              notifyWin();
            } else {
              setWaitingForMinimum(true);
            }
          } else if (result.progress > previousFoodCollected) {
            soundManager.playCoin();
          }
        } else if (!result) {
          setErrorMessage('Could not verify this Snake move. Retrying shortly.');
        }
      } finally {
        busyRef.current = false;
        if (!disposed) timer = setTimeout(step, STEP_INTERVAL_MS);
      }
    };
    timer = setTimeout(step, STEP_INTERVAL_MS);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [notifyLose, notifyWin]);

  useEffect(() => {
    if (waitingForMinimum && secondsElapsed >= minSeconds) {
      setWaitingForMinimum(false);
      notifyWin();
    }
  }, [minSeconds, notifyWin, secondsElapsed, waitingForMinimum]);

  useEffect(() => {
    if (initialState.foodCollected < initialState.target) return;
    finishedRef.current = true;
    setGameWon(true);
    setWaitingForMinimum(true);
  }, [initialState.foodCollected, initialState.target]);

  useEffect(() => {
    if (secondsElapsed >= 120 && !finishedRef.current) {
      finishedRef.current = true;
      setGameOver(true);
      notifyLose();
    }
  }, [notifyLose, secondsElapsed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.fillStyle = '#06070d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#0e1224';
    context.lineWidth = 1;
    for (let index = 0; index < gameState.tileCount; index++) {
      context.beginPath();
      context.moveTo(index * TILE_SIZE, 0);
      context.lineTo(index * TILE_SIZE, canvas.height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, index * TILE_SIZE);
      context.lineTo(canvas.width, index * TILE_SIZE);
      context.stroke();
    }

    context.shadowBlur = 12;
    context.shadowColor = '#ffe600';
    context.fillStyle = '#ffe600';
    context.fillRect(
      gameState.food.x * TILE_SIZE + 2,
      gameState.food.y * TILE_SIZE + 2,
      TILE_SIZE - 4,
      TILE_SIZE - 4
    );
    context.shadowBlur = 8;
    context.shadowColor = '#00f0ff';
    gameState.snake.forEach((point, index) => {
      context.fillStyle = index === 0 ? '#00ff66' : '#00f0ff';
      context.fillRect(
        point.x * TILE_SIZE + 1,
        point.y * TILE_SIZE + 1,
        TILE_SIZE - 2,
        TILE_SIZE - 2
      );
    });
    context.shadowBlur = 0;
  }, [gameState]);

  const controls: { direction: SnakeDirection; label: string }[] = [
    { direction: 'up', label: '▲' },
    { direction: 'left', label: '◀' },
    { direction: 'down', label: '▼' },
    { direction: 'right', label: '▶' },
  ];

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="mb-3 flex w-full max-w-[420px] items-center justify-between rounded border border-retro-cyan/40 bg-retro-card px-4 py-2">
        <div>
          <span className="font-pixel text-xs text-retro-muted">FOOD DOTS: </span>
          <span className="font-pixel text-sm font-bold text-retro-yellow">{gameState.foodCollected}/3</span>
        </div>
        <div>
          <span className="font-pixel text-xs text-retro-muted">TIME: </span>
          <span className={`font-pixel text-sm font-bold ${secondsElapsed < minSeconds ? 'text-retro-amber' : 'text-retro-green'}`}>
            {secondsElapsed}s / {minSeconds}s
          </span>
        </div>
      </div>

      {errorMessage && <p className="mb-2 text-center text-xs text-retro-amber" aria-live="polite">{errorMessage}</p>}

      <div className="relative w-full max-w-[400px] overflow-hidden rounded border-2 border-retro-cyan shadow-neon-cyan">
        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          className="block h-auto w-full bg-retro-bg"
          aria-label="Snake playfield; use arrow keys, WASD, or the on-screen controls"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_4px] opacity-40" />
        {gameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85">
            <h2 className="mb-2 font-pixel text-2xl text-retro-red motion-safe:animate-pulse">SERPENT DESTROYED</h2>
            <p className="font-pixel text-xs text-retro-muted">ATTEMPT FAILED · LIFELINE NOT SPENT</p>
          </div>
        )}
        {gameWon && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85">
            <h2 className="mb-2 font-pixel text-2xl text-retro-green motion-safe:animate-bounce">LEVEL CLEARED!</h2>
            <p className="font-pixel text-xs text-retro-cyan">
              {waitingForMinimum ? `MINIMUM TIME ${secondsElapsed}s / ${minSeconds}s` : 'WIN SUBMITTING...'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-1">
        {['', 'up', ''].map((direction, index) => (
          direction
            ? <button key={direction} onClick={() => changeDirection(direction as SnakeDirection)} disabled={isPaused || gameWon || gameOver} className="h-14 w-16 touch-none rounded border border-retro-cyan bg-retro-card font-pixel text-retro-cyan disabled:opacity-40">▲</button>
            : <span key={`spacer-${index}`} />
        ))}
        {controls.slice(1).map(({ direction, label }) => (
          <button
            key={direction}
            onClick={() => changeDirection(direction)}
            disabled={isPaused || gameWon || gameOver}
            className="h-14 w-16 touch-none rounded border border-retro-cyan bg-retro-card font-pixel text-retro-cyan active:bg-retro-cyan/30 disabled:opacity-40"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-retro-muted" aria-live="polite">
        {isPaused ? 'PAUSED — USE OF CONTROLS IS FROZEN' : 'ARROW KEYS / WASD OR TAP THE CONTROLS'}
      </p>
    </div>
  );
}
