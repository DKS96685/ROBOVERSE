'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameProgressResponse, PongGameState, ServerGameAction } from '@/lib/games/state';
import { runOnce } from '@/lib/games/callbacks';
import { usePausedGameClock } from './usePausedGameClock';
import { soundManager } from '@/lib/sound';

interface PongGameProps {
  initialState: PongGameState;
  onAction: (action: ServerGameAction) => Promise<GameProgressResponse | null>;
  onWin: () => void;
  onLose: () => void;
  minSeconds: number;
  isPaused: boolean;
}

const ACTION_INTERVAL_MS = 400;

export default function PongGame({
  initialState,
  onAction,
  onWin,
  onLose,
  minSeconds,
  isPaused,
}: PongGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [gameState, setGameState] = useState(initialState);
  const [gameOver, setGameOver] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const { secondsElapsed } = usePausedGameClock(isPaused);

  const stateRef = useRef(initialState);
  const syncedAtRef = useRef(0);
  const pausedRef = useRef(isPaused);
  const pointerActiveRef = useRef(false);
  const pointerCenterRef = useRef<number | null>(null);
  const keysRef = useRef({ up: false, down: false });
  const busyRef = useRef(false);
  const finishedRef = useRef(false);
  const winNotifiedRef = useRef(false);
  const loseNotifiedRef = useRef(false);
  const propsRef = useRef({ onAction, onWin, onLose, minSeconds, secondsElapsed });

  pausedRef.current = isPaused;
  propsRef.current = { onAction, onWin, onLose, minSeconds, secondsElapsed };

  const notifyWin = useCallback(() => {
    runOnce(winNotifiedRef, () => {
      soundManager.playLevelClear();
      propsRef.current.onWin();
    });
  }, []);

  const notifyLose = useCallback(() => {
    runOnce(loseNotifiedRef, () => propsRef.current.onLose());
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (pausedRef.current || finishedRef.current) return;
      if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
        keysRef.current.up = true;
        event.preventDefault();
      } else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
        keysRef.current.down = true;
        event.preventDefault();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') keysRef.current.up = false;
      if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') keysRef.current.down = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const advance = async () => {
      if (disposed) return;
      if (pausedRef.current || finishedRef.current || busyRef.current) {
        timer = setTimeout(advance, ACTION_INTERVAL_MS);
        return;
      }

      busyRef.current = true;
      const input = keysRef.current.up === keysRef.current.down
        ? 'stay'
        : keysRef.current.up
          ? 'up'
          : 'down';
      const action: ServerGameAction = {
        type: 'pongStep',
        input,
        ...(pointerCenterRef.current !== null
          ? { paddleCenterY: pointerCenterRef.current }
          : {}),
      };

      try {
        const result = await propsRef.current.onAction(action);
        if (disposed) return;
        if (result?.gameState?.gameKey === 'pong') {
          stateRef.current = result.gameState;
          syncedAtRef.current = performance.now();
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
          }
        } else if (!result) {
          setErrorMessage('Could not verify this Pong move. Retrying shortly.');
        }
      } catch {
        if (!disposed) setErrorMessage('Could not verify this Pong move. Retrying shortly.');
      } finally {
        busyRef.current = false;
        if (!disposed) timer = setTimeout(advance, ACTION_INTERVAL_MS);
      }
    };

    timer = setTimeout(advance, ACTION_INTERVAL_MS);
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
    if (initialState.playerScore < initialState.target) return;
    finishedRef.current = true;
    setGameWon(true);
    setWaitingForMinimum(true);
  }, [initialState.playerScore, initialState.target]);

  useEffect(() => {
    if (secondsElapsed >= 120 && !finishedRef.current) {
      finishedRef.current = true;
      setGameOver(true);
      notifyLose();
    }
  }, [notifyLose, secondsElapsed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let animationFrame = 0;

    const draw = () => {
      const state = stateRef.current;
      const frames = Math.min(24, Math.max(0, (performance.now() - syncedAtRef.current) / (1000 / 60)));
      const ballX = state.ballX + (finishedRef.current ? 0 : state.ballSpeedX * frames);
      const ballY = Math.max(
        6,
        Math.min(state.height - 6, state.ballY + (finishedRef.current ? 0 : state.ballSpeedY * frames))
      );
      context.fillStyle = '#06070d';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = '#1e2238';
      context.lineWidth = 3;
      context.setLineDash([8, 8]);
      context.beginPath();
      context.moveTo(canvas.width / 2, 0);
      context.lineTo(canvas.width / 2, canvas.height);
      context.stroke();
      context.setLineDash([]);

      context.shadowBlur = 10;
      context.shadowColor = '#00f0ff';
      context.fillStyle = '#00f0ff';
      context.fillRect(20, state.playerY, 10, state.paddleHeight);
      context.shadowColor = '#ff007f';
      context.fillStyle = '#ff007f';
      context.fillRect(canvas.width - 30, state.aiY, 10, state.paddleHeight);
      context.shadowBlur = 12;
      context.shadowColor = '#ffe600';
      context.fillStyle = '#ffe600';
      context.beginPath();
      context.arc(ballX, ballY, 6, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      animationFrame = requestAnimationFrame(draw);
    };

    syncedAtRef.current = performance.now();
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  const setPointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pausedRef.current || finishedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.height <= 0) return;
    const canvasY = (event.clientY - rect.top) * (canvas.height / rect.height);
    const halfPaddle = stateRef.current.paddleHeight / 2;
    pointerCenterRef.current = Math.max(halfPaddle, Math.min(canvas.height - halfPaddle, canvasY));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pausedRef.current || finishedRef.current) return;
    pointerActiveRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPointerPosition(event);
  };

  useEffect(() => {
    if (isPaused || gameOver || gameWon) {
      pointerActiveRef.current = false;
      pointerCenterRef.current = null;
      keysRef.current = { up: false, down: false };
    }
  }, [gameOver, gameWon, isPaused]);

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="mb-3 flex w-full max-w-[440px] items-center justify-between rounded border border-retro-cyan/40 bg-retro-card px-4 py-2">
        <div>
          <span className="font-pixel text-xs text-retro-cyan">PLAYER: </span>
          <span className="font-pixel text-sm font-bold text-retro-yellow">{gameState.playerScore}/3</span>
        </div>
        <div>
          <span className="font-pixel text-xs text-retro-muted">TIME: </span>
          <span className={`font-pixel text-sm font-bold ${secondsElapsed < minSeconds ? 'text-retro-amber' : 'text-retro-green'}`}>
            {secondsElapsed}s / {minSeconds}s
          </span>
        </div>
        <div>
          <span className="font-pixel text-xs text-retro-magenta">AI: </span>
          <span className="font-pixel text-sm font-bold text-retro-red">{gameState.aiScore}/3</span>
        </div>
      </div>

      {errorMessage && (
        <p className="mb-2 text-center text-xs text-retro-amber" aria-live="polite">{errorMessage}</p>
      )}

      <div className="relative w-full max-w-[440px] overflow-hidden rounded border-2 border-retro-cyan shadow-neon-cyan">
        <canvas
          ref={canvasRef}
          width={440}
          height={320}
          onPointerDown={handlePointerDown}
          onPointerMove={(event) => {
            if (pointerActiveRef.current) setPointerPosition(event);
          }}
          onPointerUp={() => {
            pointerActiveRef.current = false;
            pointerCenterRef.current = null;
          }}
          onPointerCancel={() => {
            pointerActiveRef.current = false;
            pointerCenterRef.current = null;
          }}
          className="block h-auto w-full touch-none bg-retro-bg"
          aria-label="Pong playfield; use W/S, arrow keys, or drag your paddle"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_4px] opacity-40" />
        {gameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85">
            <h2 className="mb-2 font-pixel text-2xl text-retro-red motion-safe:animate-pulse">DEFLECTOR BREACHED</h2>
            <p className="mb-4 font-pixel text-xs text-retro-muted">ATTEMPT FAILED</p>
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

      <p className="mt-3 text-center font-pixel text-sm text-retro-muted">
        USE [W/S] OR [UP/DOWN] ARROWS, OR DRAG YOUR PADDLE. FIRST TO 3 WINS.
      </p>
      <p className="mt-2 text-xs text-retro-muted" aria-live="polite">
        {isPaused ? 'PAUSED — USE OF CONTROLS IS FROZEN' : 'USE THE PADDLE TO DEFLECT EACH SERVE'}
      </p>
    </div>
  );
}
