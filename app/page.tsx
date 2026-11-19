'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { soundManager } from '@/lib/sound';
import { Play, Terminal, KeyRound, AlertCircle } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();

  // Intro Sequence States: 'booting' -> 'glitch_logo' -> 'press_start' -> 'login'
  const [introPhase, setIntroPhase] = useState<'booting' | 'glitch_logo' | 'press_start' | 'login'>('booting');
  const [bootProgress, setBootProgress] = useState(0);

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  // Check if intro has already run in this session
  useEffect(() => {
    const hasSeenIntro = sessionStorage.getItem('roboverse_intro_seen');
    if (hasSeenIntro) {
      setIntroPhase('login');
      return;
    }

    // 4-second boot sequence
    const interval = setInterval(() => {
      setBootProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIntroPhase('glitch_logo');
          setTimeout(() => {
            setIntroPhase('press_start');
          }, 1200);
          return 100;
        }
        return prev + 12;
      });
    }, 180);

    return () => clearInterval(interval);
  }, []);

  const skipIntro = () => {
    sessionStorage.setItem('roboverse_intro_seen', 'true');
    setIntroPhase('login');
    soundManager.playBeep(440, 0.05);
  };

  const handlePressStart = () => {
    soundManager.playCoin();
    sessionStorage.setItem('roboverse_intro_seen', 'true');
    setIntroPhase('login');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      const rawText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        throw new Error(`Server returned status ${res.status}: ${rawText.slice(0, 100) || res.statusText}`);
      }

      if (!res.ok) {
        throw new Error(data.error || 'Authentication rejected');
      }

      soundManager.playLevelClear();
      router.push(data.redirect || '/dashboard');
    } catch (err: any) {
      soundManager.playDamage();
      setErrorMsg(err.message || 'ACCESS DENIED');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-retro-bg text-gray-100 flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Scanline CRT overlay */}
      <div className="pointer-events-none fixed inset-0 scanlines z-40 opacity-40" />

      {/* 1. BOOTING & INTRO PHASES */}
      {introPhase !== 'login' && (
        <div className="relative z-30 flex flex-col items-center text-center max-w-lg w-full">
          {/* Skip Intro button */}
          <button
            onClick={skipIntro}
            className="absolute -top-12 right-0 text-[10px] font-pixel text-retro-muted hover:text-retro-cyan px-2 py-1 rounded border border-retro-border hover:border-retro-cyan transition-colors"
          >
            [SKIP INTRO &gt;&gt;]
          </button>

          {/* Phase 1: Booting text & progress bar */}
          {introPhase === 'booting' && (
            <div className="space-y-4 w-full">
              <div className="flex items-center justify-center gap-2 font-pixel text-xs text-retro-cyan tracking-widest animate-pulse">
                <Terminal className="w-4 h-4" />
                <span>INITIALIZING ROBOVERSE ENGINE...</span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-4 bg-retro-card border-2 border-retro-cyan shadow-neon-cyan rounded-full p-0.5 overflow-hidden">
                <div
                  className="h-full bg-retro-cyan transition-all duration-150 rounded-full"
                  style={{ width: `${bootProgress}%` }}
                />
              </div>

              <div className="text-[10px] font-mono text-retro-muted flex justify-between px-1">
                <span>MEM_CHECK: 25_TEAMS_READY</span>
                <span>{bootProgress}%</span>
              </div>
            </div>
          )}

          {/* Phase 2: Glitch Logo Reveal */}
          {(introPhase === 'glitch_logo' || introPhase === 'press_start') && (
            <div className="flex flex-col items-center space-y-6 animate-fade-in">
              <div className="relative">
                <h1 className="font-pixel text-4xl sm:text-5xl text-retro-cyan tracking-wider drop-shadow-[0_0_20px_rgba(0,240,255,0.8)] animate-glitch">
                  ROBOVERSE
                </h1>
                <span className="block font-retro text-lg sm:text-xl text-retro-magenta tracking-widest mt-1">
                  21 NOVEMBER 2026 · GAMIFIED ROBOTICS LAYER
                </span>
              </div>

              {/* Phase 3: Blinking PRESS START */}
              {introPhase === 'press_start' && (
                <button
                  onClick={handlePressStart}
                  className="mt-6 px-8 py-3.5 bg-retro-yellow text-black font-pixel text-sm rounded shadow-neon-yellow hover:bg-white active:scale-95 transition-all font-bold tracking-wider animate-bounce flex items-center gap-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  PRESS START
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. LOGIN FORM PHASE */}
      {introPhase === 'login' && (
        <div
          className={`relative z-30 w-full max-w-md bg-retro-card border-2 border-retro-cyan/70 shadow-neon-cyan rounded-lg p-6 sm:p-8 flex flex-col items-center ${
            isShaking ? 'shake border-retro-red shadow-neon-red' : ''
          }`}
        >
          {/* Logo & Subtitle */}
          <div className="text-center mb-6">
            <h1 className="font-pixel text-2xl sm:text-3xl text-retro-cyan tracking-wider drop-shadow-[0_0_12px_rgba(0,240,255,0.7)]">
              ROBOVERSE
            </h1>
            <p className="font-pixel text-[10px] text-retro-magenta mt-1 tracking-widest">
              INSERT CREDENTIALS TO ACCESS TERMINAL
            </p>
          </div>

          {/* Error Message Box */}
          {errorMsg && (
            <div className="w-full mb-4 p-3 bg-retro-red/20 border border-retro-red text-retro-red text-xs font-pixel rounded text-center flex items-center justify-center gap-2 animate-pulse">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div>
              <label className="block text-[10px] font-pixel text-retro-cyan mb-1.5 uppercase">
                TEAM ID OR ADMIN EMAIL
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Team ID or admin email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="w-full bg-retro-bg border border-retro-border rounded px-3 py-2.5 text-xs text-white placeholder-retro-muted/60 focus:outline-none focus:border-retro-cyan font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-pixel text-retro-cyan mb-1.5 uppercase">
                SECURITY ACCESS KEY (PASSWORD)
              </label>
              <div className="relative">
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-retro-bg border border-retro-border rounded px-3 py-2.5 text-xs text-white placeholder-retro-muted/60 focus:outline-none focus:border-retro-cyan font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-retro-cyan text-retro-bg font-pixel text-xs rounded font-bold hover:bg-white active:scale-95 transition-all shadow-neon-cyan mt-2 flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {loading ? (
                <span>VERIFYING SYSTEM KEY...</span>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  AUTHENTICATE &amp; ENTER
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Footer Branding */}
      <footer className="relative z-30 mt-6 text-center text-[10px] font-mono text-retro-muted">
        ROBOVERSE 2026 · LIVE 3-HOUR ROBOTICS GAMIFIED PLATFORM
      </footer>
    </div>
  );
}
