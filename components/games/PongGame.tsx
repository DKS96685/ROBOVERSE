'use client';

import React, { useEffect, useRef, useState } from 'react';
import { soundManager } from '@/lib/sound';

interface PongGameProps {
  onWin: () => void;
  onLose: () => void;
  onProgress: (action: 'pongPlayerPoint') => Promise<boolean>;
  minSeconds: number;
  isPaused: boolean;
}

export default function PongGame({ onWin, onLose, onProgress, minSeconds, isPaused }: PongGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playerScore, setPlayerScore] = useState(0);
  const [aiScore, setAiScore] = useState(0);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const pausedRef = useRef(isPaused);
  const winNotifiedRef = useRef(false);
  const secondsElapsedRef = useRef(0);
  const progressPromiseRef = useRef<Promise<boolean> | null>(null);

  const winningScore = 3;

  const stateRef = useRef({
    playerY: 150,
    aiY: 150,
    paddleHeight: 100,
    paddleWidth: 10,
    paddleSpeed: 5,
    ballX: 200,
    ballY: 175,
    ballSpeedX: 2.7,
    ballSpeedY: 1.8,
    ballRadius: 6,
    isAlive: true,
    keys: { up: false, down: false },
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
      soundManager.playLevelClear();
      void (progressPromiseRef.current || Promise.resolve(true)).then((ready) => {
        if (ready) onWin();
      });
    }
  }, [minSeconds, onWin, secondsElapsed, waitingForMinimum]);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (pausedRef.current || !stateRef.current.isAlive) return;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        stateRef.current.keys.up = true;
        e.preventDefault();
      }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        stateRef.current.keys.down = true;
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        stateRef.current.keys.up = false;
      }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        stateRef.current.keys.down = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Mouse / Touch paddle tracking
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || pausedRef.current || !stateRef.current.isAlive) return;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    stateRef.current.playerY = Math.max(
      0,
      Math.min(canvas.height - stateRef.current.paddleHeight, mouseY - stateRef.current.paddleHeight / 2)
    );
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !e.touches[0] || pausedRef.current || !stateRef.current.isAlive) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touchY = e.touches[0].clientY - rect.top;
    stateRef.current.playerY = Math.max(
      0,
      Math.min(canvas.height - stateRef.current.paddleHeight, touchY - stateRef.current.paddleHeight / 2)
    );
  };

  // Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let pScore = 0;
    let aScore = 0;

    const resetBall = (direction: number) => {
      stateRef.current.ballX = canvas.width / 2;
      stateRef.current.ballY = canvas.height / 2;
      stateRef.current.ballSpeedX = direction * 2.7;
      stateRef.current.ballSpeedY = (Math.random() - 0.5) * 3.2;
    };

    const interval = setInterval(() => {
      const s = stateRef.current;
      if (!s.isAlive || pausedRef.current) return;

      // Player key movement
      if (s.keys.up) s.playerY = Math.max(0, s.playerY - s.paddleSpeed);
      if (s.keys.down) s.playerY = Math.min(canvas.height - s.paddleHeight, s.playerY + s.paddleSpeed);

      // AI Paddle Movement
      const aiCenter = s.aiY + s.paddleHeight / 2;
      if (aiCenter < s.ballY - 15) {
        s.aiY = Math.min(canvas.height - s.paddleHeight, s.aiY + 2.2);
      } else if (aiCenter > s.ballY + 15) {
        s.aiY = Math.max(0, s.aiY - 2.2);
      }

      // Move Ball
      s.ballX += s.ballSpeedX;
      s.ballY += s.ballSpeedY;

      // Bounce top and bottom
      if (s.ballY - s.ballRadius <= 0 || s.ballY + s.ballRadius >= canvas.height) {
        s.ballSpeedY = -s.ballSpeedY;
        soundManager.playBeep(300, 0.04);
      }

      // Player paddle collision
      const pLeft = 20;
      const pRight = 20 + s.paddleWidth;
      if (
        s.ballX - s.ballRadius <= pRight &&
        s.ballX + s.ballRadius >= pLeft &&
        s.ballY >= s.playerY &&
        s.ballY <= s.playerY + s.paddleHeight
      ) {
        s.ballSpeedX = Math.min(5.2, Math.abs(s.ballSpeedX) * 1.03);
        const delta = (s.ballY - (s.playerY + s.paddleHeight / 2)) / (s.paddleHeight / 2);
        s.ballSpeedY = delta * 4;
        soundManager.playBeep(520, 0.05);
      }

      // AI paddle collision
      const aiLeft = canvas.width - 20 - s.paddleWidth;
      const aiRight = canvas.width - 20;
      if (
        s.ballX + s.ballRadius >= aiLeft &&
        s.ballX - s.ballRadius <= aiRight &&
        s.ballY >= s.aiY &&
        s.ballY <= s.aiY + s.paddleHeight
      ) {
        s.ballSpeedX = -Math.min(5.2, Math.abs(s.ballSpeedX) * 1.03);
        const delta = (s.ballY - (s.aiY + s.paddleHeight / 2)) / (s.paddleHeight / 2);
        s.ballSpeedY = delta * 4;
        soundManager.playBeep(420, 0.05);
      }

      // Point scored!
      if (s.ballX < 0) {
        // AI scored
        aScore += 1;
        setAiScore(aScore);
        soundManager.playDamage();
        if (aScore >= winningScore) {
          s.isAlive = false;
          setGameOver(true);
          onLose();
          return;
        }
        resetBall(1);
      } else if (s.ballX > canvas.width) {
        // Player scored
        pScore += 1;
        setPlayerScore(pScore);
        soundManager.playCoin();
        const progressPromise = onProgress('pongPlayerPoint');
        progressPromiseRef.current = progressPromise;
        if (pScore >= winningScore) {
          s.isAlive = false;
          setGameWon(true);
          if (secondsElapsedRef.current >= minSeconds) {
            winNotifiedRef.current = true;
            soundManager.playLevelClear();
            void progressPromise.then((ready) => {
              if (ready) onWin();
            });
          } else {
            setWaitingForMinimum(true);
          }
          return;
        }
        resetBall(-1);
      }

      // Render Frame
      ctx.fillStyle = '#06070d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Center dashed net
      ctx.strokeStyle = '#1e2238';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Player Paddle (Cyan Glow)
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#00f0ff';
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(20, s.playerY, s.paddleWidth, s.paddleHeight);

      // Draw AI Paddle (Magenta Glow)
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#ff007f';
      ctx.fillStyle = '#ff007f';
      ctx.fillRect(canvas.width - 20 - s.paddleWidth, s.aiY, s.paddleWidth, s.paddleHeight);

      // Draw Glowing Ball
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#ffe600';
      ctx.fillStyle = '#ffe600';
      ctx.beginPath();
      ctx.arc(s.ballX, s.ballY, s.ballRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
    }, 1000 / 60);

    return () => clearInterval(interval);
  }, [minSeconds, onLose, onProgress, onWin]);

  return (
    <div className="flex flex-col items-center justify-center p-4">
      {/* Score HUD */}
      <div className="flex items-center justify-between w-full max-w-[440px] mb-3 px-4 py-2 bg-retro-card border border-retro-cyan/40 rounded">
        <div>
          <span className="text-xs text-retro-cyan font-pixel">PLAYER: </span>
          <span className="font-pixel text-retro-yellow text-sm font-bold">{playerScore}/3</span>
        </div>
        <div>
          <span className="text-xs text-retro-muted font-pixel">TIME: </span>
          <span className={`font-pixel text-sm font-bold ${secondsElapsed < minSeconds ? 'text-retro-amber' : 'text-retro-green'}`}>
            {secondsElapsed}s / {minSeconds}s
          </span>
        </div>
        <div>
          <span className="text-xs text-retro-magenta font-pixel">AI: </span>
          <span className="font-pixel text-retro-red text-sm font-bold">{aiScore}/3</span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative border-2 border-retro-cyan shadow-neon-cyan rounded overflow-hidden">
        <canvas
          ref={canvasRef}
          width={440}
          height={320}
          onMouseMove={handleMouseMove}
          onTouchMove={handleTouchMove}
          onTouchStart={handleTouchMove}
          className="block bg-retro-bg cursor-ns-resize max-w-full touch-none"
        />

        {/* Scanlines overlay */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_4px] opacity-40" />

        {gameOver && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center">
            <h2 className="font-pixel text-retro-red text-2xl mb-2 animate-pulse">DEFLECTOR BREACHED</h2>
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

      {/* Help tooltip */}
      <p className="text-sm text-retro-muted font-pixel mt-3 text-center">
        USE [W/S] OR [UP/DOWN] ARROWS, OR DRAG MOUSE / FINGER. FIRST TO 3 WINS.
      </p>
    </div>
  );
}
