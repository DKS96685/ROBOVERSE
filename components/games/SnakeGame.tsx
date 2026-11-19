'use client';

import React, { useEffect, useRef, useState } from 'react';
import { soundManager } from '@/lib/sound';

interface SnakeGameProps {
  onWin: () => void;
  onLose: () => void;
  onProgress: (action: 'snakeFoodCollected') => Promise<boolean>;
  minSeconds: number;
  isPaused: boolean;
}

export default function SnakeGame({ onWin, onLose, onProgress, minSeconds, isPaused }: SnakeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState(0);
  const targetScore = 3;
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const pausedRef = useRef(isPaused);
  const winNotifiedRef = useRef(false);
  const secondsElapsedRef = useRef(0);
  const progressPromiseRef = useRef<Promise<boolean> | null>(null);

  // References to keep mutable game state inside loop
  const stateRef = useRef({
    snake: [{ x: 10, y: 10 }, { x: 10, y: 11 }, { x: 10, y: 12 }],
    direction: { x: 0, y: -1 },
    nextDirection: { x: 0, y: -1 },
    food: { x: 5, y: 5 },
    gridSize: 20,
    tileCount: 20,
    score: 0,
    isAlive: true,
  });

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      if (!pausedRef.current) {
        secondsElapsedRef.current += 1;
        setSecondsElapsed(secondsElapsedRef.current);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (waitingForMinimum && secondsElapsed >= minSeconds && !winNotifiedRef.current) {
      winNotifiedRef.current = true;
      setWaitingForMinimum(false);
      void (progressPromiseRef.current || Promise.resolve(true)).then((ready) => {
        if (ready) onWin();
      });
    }
  }, [minSeconds, onProgress, onWin, secondsElapsed, waitingForMinimum]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { nextDirection } = stateRef.current;
      if (pausedRef.current || !stateRef.current.isAlive) return;
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          if (nextDirection.y === 0) stateRef.current.nextDirection = { x: 0, y: -1 };
          e.preventDefault();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          if (nextDirection.y === 0) stateRef.current.nextDirection = { x: 0, y: 1 };
          e.preventDefault();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          if (nextDirection.x === 0) stateRef.current.nextDirection = { x: -1, y: 0 };
          e.preventDefault();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          if (nextDirection.x === 0) stateRef.current.nextDirection = { x: 1, y: 0 };
          e.preventDefault();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Direction handler for touch/on-screen buttons
  const changeDirection = (dx: number, dy: number) => {
    const { nextDirection } = stateRef.current;
    if (pausedRef.current || !stateRef.current.isAlive) return;
    if (dx !== 0 && nextDirection.x === 0) {
      stateRef.current.nextDirection = { x: dx, y: 0 };
    }
    if (dy !== 0 && nextDirection.y === 0) {
      stateRef.current.nextDirection = { x: 0, y: dy };
    }
  };

  // Main Canvas Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const spawnFood = () => {
      const { tileCount, snake } = stateRef.current;
      let newFood = {
        x: Math.floor(Math.random() * tileCount),
        y: Math.floor(Math.random() * tileCount),
      };
      // Ensure not on snake body
      while (snake.some((seg) => seg.x === newFood.x && seg.y === newFood.y)) {
        newFood = {
          x: Math.floor(Math.random() * tileCount),
          y: Math.floor(Math.random() * tileCount),
        };
      }
      stateRef.current.food = newFood;
    };

    spawnFood();

    const interval = setInterval(() => {
      const s = stateRef.current;
      if (!s.isAlive || pausedRef.current) return;

      // Update direction
      s.direction = s.nextDirection;

      // Move head
      const head = {
        x: s.snake[0].x + s.direction.x,
        y: s.snake[0].y + s.direction.y,
      };

      // Collision with walls
      if (head.x < 0 || head.x >= s.tileCount || head.y < 0 || head.y >= s.tileCount) {
        s.isAlive = false;
        setGameOver(true);
        soundManager.playDamage();
        onLose();
        return;
      }

      // Collision with self
      for (let i = 0; i < s.snake.length; i++) {
        if (s.snake[i].x === head.x && s.snake[i].y === head.y) {
          s.isAlive = false;
          setGameOver(true);
          soundManager.playDamage();
          onLose();
          return;
        }
      }

      s.snake.unshift(head);

      // Check food
      if (head.x === s.food.x && head.y === s.food.y) {
        s.score += 1;
        setScore(s.score);
        soundManager.playCoin();
        progressPromiseRef.current = onProgress('snakeFoodCollected');

        // Check Win Condition
        if (s.score >= targetScore) {
          s.isAlive = false;
          setGameWon(true);
          if (secondsElapsedRef.current >= minSeconds) {
            winNotifiedRef.current = true;
            soundManager.playLevelClear();
              void progressPromiseRef.current?.then((ready) => {
                if (ready) onWin();
              });
          } else {
            setWaitingForMinimum(true);
          }
          return;
        } else {
          spawnFood();
        }
      } else {
        s.snake.pop();
      }

      // Render Frame
      // Dark background
      ctx.fillStyle = '#06070d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Neon grid lines
      ctx.strokeStyle = '#0e1224';
      ctx.lineWidth = 1;
      for (let i = 0; i < s.tileCount; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s.gridSize, 0);
        ctx.lineTo(i * s.gridSize, canvas.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * s.gridSize);
        ctx.lineTo(canvas.width, i * s.gridSize);
        ctx.stroke();
      }

      // Draw Glowing Food (Power Chip)
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#ffe600';
      ctx.fillStyle = '#ffe600';
      ctx.fillRect(
        s.food.x * s.gridSize + 2,
        s.food.y * s.gridSize + 2,
        s.gridSize - 4,
        s.gridSize - 4
      );

      // Draw Snake Body
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#00f0ff';
      s.snake.forEach((seg, idx) => {
        if (idx === 0) {
          ctx.fillStyle = '#00ff66'; // Head is bright green
        } else {
          ctx.fillStyle = '#00f0ff'; // Body cyan
        }
        ctx.fillRect(
          seg.x * s.gridSize + 1,
          seg.y * s.gridSize + 1,
          s.gridSize - 2,
          s.gridSize - 2
        );
      });
      ctx.shadowBlur = 0;
    }, 250);

    return () => clearInterval(interval);
  }, [minSeconds, onLose, onProgress, onWin]);

  return (
    <div className="flex flex-col items-center justify-center p-4">
      {/* Score & Timer HUD */}
      <div className="flex items-center justify-between w-full max-w-[420px] mb-3 px-4 py-2 bg-retro-card border border-retro-cyan/40 rounded">
        <div>
          <span className="text-xs text-retro-muted uppercase font-pixel">FOOD DOTS:</span>
          <span className="ml-2 font-pixel text-retro-yellow text-sm font-bold">
            {score}/{targetScore}
          </span>
        </div>
        <div>
          <span className="text-xs text-retro-muted uppercase font-pixel">TIME:</span>
          <span className={`ml-2 font-pixel text-sm font-bold ${secondsElapsed < minSeconds ? 'text-retro-amber' : 'text-retro-green'}`}>
            {secondsElapsed}s / {minSeconds}s
          </span>
        </div>
      </div>

      {/* Retro Canvas */}
      <div className="relative border-2 border-retro-cyan shadow-neon-cyan rounded overflow-hidden">
        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          className="block bg-retro-bg max-w-full"
        />

        {/* Scanlines overlay */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_4px] opacity-40" />

        {/* Overlays */}
        {gameOver && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center">
            <h2 className="font-pixel text-retro-red text-2xl mb-2 animate-pulse">SERPENT DESTROYED</h2>
            <p className="text-xs text-retro-muted font-pixel mb-4">-1 LIFELINE PENALTY</p>
          </div>
        )}
        {gameWon && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center">
            <h2 className="font-pixel text-retro-green text-2xl mb-2 motion-safe:animate-bounce">LEVEL CLEARED!</h2>
            <p className="text-xs text-retro-cyan font-pixel">
              {waitingForMinimum ? `MINIMUM TIME ${secondsElapsed}s / ${minSeconds}s` : 'WIN SUBMITTING...'}
            </p>
          </div>
        )}
      </div>

      {/* On-screen D-Pad for Mobile & Touch */}
      <div className="mt-4 flex flex-col items-center gap-1">
        <button
          onClick={() => changeDirection(0, -1)}
          disabled={isPaused || gameWon || gameOver}
          className="w-16 h-14 touch-none bg-retro-card border border-retro-cyan active:bg-retro-cyan/30 text-retro-cyan font-pixel text-base rounded flex items-center justify-center disabled:opacity-40"
        >
          ▲
        </button>
        <div className="flex gap-4">
          <button
            onClick={() => changeDirection(-1, 0)}
            disabled={isPaused || gameWon || gameOver}
            className="w-16 h-14 touch-none bg-retro-card border border-retro-cyan active:bg-retro-cyan/30 text-retro-cyan font-pixel text-base rounded flex items-center justify-center disabled:opacity-40"
          >
            ◀
          </button>
          <button
            onClick={() => changeDirection(0, 1)}
            disabled={isPaused || gameWon || gameOver}
            className="w-16 h-14 touch-none bg-retro-card border border-retro-cyan active:bg-retro-cyan/30 text-retro-cyan font-pixel text-base rounded flex items-center justify-center disabled:opacity-40"
          >
            ▼
          </button>
          <button
            onClick={() => changeDirection(1, 0)}
            disabled={isPaused || gameWon || gameOver}
            className="w-16 h-14 touch-none bg-retro-card border border-retro-cyan active:bg-retro-cyan/30 text-retro-cyan font-pixel text-base rounded flex items-center justify-center disabled:opacity-40"
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
}
