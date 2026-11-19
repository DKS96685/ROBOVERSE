'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { soundManager } from '@/lib/sound';
import GameModal from '@/components/games/GameModal';
import { getGameCatalogEntry } from '@/lib/config/gameCatalog';
import {
  Heart,
  Clock,
  Users,
  Volume2,
  VolumeX,
  LogOut,
  Play,
  Lock,
  CheckCircle,
  SkipForward,
  AlertTriangle,
  Award,
} from 'lucide-react';

export default function TeamDashboard() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<any | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [pollFailCount, setPollFailCount] = useState(0);

  // Initialize audio mute state
  useEffect(() => {
    setIsMuted(soundManager.isMuted());
  }, []);

  const toggleSound = () => {
    const muted = soundManager.toggleMute();
    setIsMuted(muted);
  };

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/team/dashboard');
      if (res.status === 401 || res.status === 403) {
        router.push('/');
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load dashboard');
      setData(json);
      setError(null);
      setPollFailCount(0);
    } catch (err: any) {
      setPollFailCount((c) => c + 1);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Initial fetch and 3-second live refresh interval
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(() => {
      fetchDashboard();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-retro-bg flex flex-col items-center justify-center font-pixel text-retro-cyan text-sm">
        <div className="w-12 h-12 border-4 border-retro-cyan border-t-transparent rounded-full animate-spin mb-4" />
        LOADING ROBOVERSE TERMINAL...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-retro-bg flex flex-col items-center justify-center p-4">
        <div className="p-6 bg-retro-card border border-retro-red text-center max-w-md rounded">
          <AlertTriangle className="w-12 h-12 text-retro-red mx-auto mb-3" />
          <h2 className="font-pixel text-retro-red text-sm mb-2">SYSTEM ERROR</h2>
          <p className="text-xs text-gray-300 font-mono mb-4">{error || 'Unable to connect to game server'}</p>
          <button
            onClick={fetchDashboard}
            className="px-4 py-2 bg-retro-cyan text-retro-bg font-pixel text-xs rounded font-bold"
          >
            RETRY CONNECTION
          </button>
        </div>
      </div>
    );
  }

  const { team, eventState, lifelines, games, project, teamScore } = data;

  // Format event remaining time
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Render the one-team lifeline.
  const renderHearts = () => {
    const hearts = [];
    const remaining = lifelines.remaining;

    for (let i = 1; i <= lifelines.starting; i++) {
      if (remaining >= i) {
        // Full heart
        hearts.push(
          <div key={i} className="flex flex-col items-center">
            <Heart className="w-6 h-6 sm:w-7 sm:h-7 text-retro-red fill-current drop-shadow-[0_0_8px_rgba(255,34,68,0.8)]" />
          </div>
        );
      } else if (remaining === i - 0.5) {
        // Half heart
        hearts.push(
          <div key={i} className="relative flex flex-col items-center">
            <Heart className="w-6 h-6 sm:w-7 sm:h-7 text-retro-border fill-current opacity-40" />
            <div className="absolute inset-0 overflow-hidden w-1/2">
              <Heart className="w-6 h-6 sm:w-7 sm:h-7 text-retro-red fill-current drop-shadow-[0_0_8px_rgba(255,34,68,0.8)]" />
            </div>
            <span className="text-[7px] font-pixel text-retro-yellow -mt-1 font-bold">1/2</span>
          </div>
        );
      } else {
        // Empty / Greyed out
        hearts.push(
          <div key={i} className="flex flex-col items-center">
            <Heart className="w-6 h-6 sm:w-7 sm:h-7 text-retro-border fill-current opacity-25" />
          </div>
        );
      }
    }
    return hearts;
  };

  return (
    <div className="min-h-screen bg-retro-bg text-gray-100 flex flex-col relative select-none">
      {/* Scanline Background Texture - reduced opacity for phone readability */}
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.18)_50%)] bg-[length:100%_4px] z-40 opacity-100" />

      {/* RECONNECT BANNER — shows when polling fails 2+ times */}
      {pollFailCount >= 2 && (
        <div className="fixed inset-x-0 top-0 z-50 bg-retro-amber/90 text-black py-2 px-4 text-center font-pixel text-[10px] font-bold tracking-widest shadow-lg flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-black animate-ping" />
          CONNECTION LOST — RETRYING...
          <button
            onClick={fetchDashboard}
            className="ml-3 px-2 py-0.5 bg-black text-retro-amber rounded text-[9px] font-pixel hover:bg-retro-bg"
          >
            RETRY NOW
          </button>
        </div>
      )}

      {/* PAUSED BANNER OVERLAY */}
      {eventState.isPaused && (
        <div className="fixed inset-x-0 top-0 z-50 bg-retro-red/90 text-black py-2 px-4 text-center font-pixel text-xs sm:text-sm font-bold tracking-widest shadow-lg flex items-center justify-center gap-2">
          <span className="w-3 h-3 rounded-full bg-white animate-ping" />
          EVENT PAUSED BY ADMIN · EVENT CLOCK AND DRAIN FROZEN
          <span className="animate-flicker">_</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="border-b border-retro-border bg-retro-card/90 backdrop-blur sticky top-0 z-30 px-4 py-3 flex items-center justify-between">
        {/* Brand & Team Name */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-sm bg-retro-cyan shadow-neon-cyan" />
            <h1 className="font-pixel text-xs sm:text-sm text-retro-cyan tracking-wider">
              ROBOVERSE
            </h1>
          </div>
          <span className="text-retro-muted text-xs">/</span>
          <span className="font-pixel text-xs text-white truncate max-w-[140px] sm:max-w-xs">
            {team.name}
          </span>
          <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-pixel bg-retro-cyan/10 text-retro-cyan border border-retro-cyan/30">
            {team.loginId.toUpperCase()}
          </span>
        </div>

        {/* Action Controls: Sound & Logout */}
        <div className="flex items-center space-x-3">
          <button
            onClick={toggleSound}
            className={`p-1.5 rounded border transition-colors ${
              !isMuted
                ? 'border-retro-cyan text-retro-cyan shadow-neon-cyan'
                : 'border-retro-border text-retro-muted hover:text-white'
            }`}
            title={!isMuted ? 'Mute 8-bit Audio' : 'Enable 8-bit Audio'}
          >
            {!isMuted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-retro-border text-retro-muted hover:text-retro-red hover:border-retro-red/50 text-[10px] font-pixel transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">EXIT</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* TOP STATUS BAR: Clock + Lifelines */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. Event Clock Card */}
          <div className="bg-retro-card border border-retro-border p-4 rounded-lg flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between text-retro-muted text-xs mb-2">
              <span className="font-pixel text-[10px] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-retro-yellow" />
                EVENT CLOCK
              </span>
              <span className="font-pixel text-[10px] text-retro-yellow">
                SLOT {eventState.currentSlot} / {4}
              </span>
            </div>

            <div className="flex items-baseline justify-between">
              <span className="font-pixel text-2xl sm:text-3xl text-white tracking-widest">
                {formatTime(eventState.remainingSeconds)}
              </span>
              <span
                className={`text-[10px] font-pixel px-2 py-0.5 rounded uppercase ${
                  eventState.isRunning
                    ? 'bg-retro-green/10 text-retro-green border border-retro-green/30'
                    : eventState.isPaused
                    ? 'bg-retro-red/10 text-retro-red border border-retro-red/30 animate-pulse'
                    : 'bg-retro-border text-retro-muted'
                }`}
              >
                {eventState.status}
              </span>
            </div>
            <p className="text-[10px] text-retro-muted font-mono mt-2">
              3-Hour Build &amp; Game Session · Slot changes every 45m
            </p>
          </div>

          {/* 2. Lifelines (5 Mario-style Lives) */}
          <div className="bg-retro-card border border-retro-border p-4 rounded-lg flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between text-retro-muted text-xs mb-2">
              <span className="font-pixel text-[10px] flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5 text-retro-red" />
                LIFELINES REMAINING
              </span>
              <span className="font-pixel text-[10px] text-retro-cyan font-bold">
                {lifelines.remaining} / {lifelines.starting}
              </span>
            </div>

            <div className="flex items-center justify-between py-1 px-2 bg-retro-bg rounded border border-retro-border/60">
              {renderHearts()}
            </div>

            <p className="text-[10px] text-retro-muted font-mono mt-2">
              {lifelines.remaining > 0
                ? '1 lifeline available for a second attempt'
                : 'Lifeline spent · continue playing; recover skipped games with puzzles'}
            </p>
            {teamScore && (
              <p className="text-[10px] text-retro-yellow font-pixel mt-2">
                SCORE: {teamScore.totalPoints} / 30 · COMPLETED: {teamScore.completedGames} / 3
              </p>
            )}
          </div>
        </div>

        {/* TEAM MEMBERS BADGE */}
        <div className="bg-retro-card/60 border border-retro-border/60 px-4 py-2.5 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-retro-cyan" />
            <span className="font-pixel text-[10px] text-retro-cyan">REGISTERED MEMBERS:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {team.members.map((m: string, i: number) => (
              <span
                key={i}
                className="px-2.5 py-0.5 rounded bg-retro-bg border border-retro-border text-gray-300 font-mono text-xs"
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        {project && (
          <section className="bg-retro-card border border-retro-magenta/60 shadow-neon-magenta/20 p-4 sm:p-5 rounded-lg">
            <h2 className="font-pixel text-xs text-retro-magenta mb-2">YOUR ASSIGNED PROJECT</h2>
            <h3 className="font-pixel text-sm text-white mb-2">{project.name}</h3>
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{project.description}</p>
          </section>
        )}

        {/* CLUE GAMES SECTION */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-pixel text-xs sm:text-sm text-retro-cyan tracking-wider flex items-center gap-2">
              <Award className="w-4 h-4 text-retro-yellow" />
              ASSIGNED CLUE CHALLENGES (3)
            </h2>
            <span className="text-[10px] font-pixel text-retro-muted">
              SOLVE TO EXTRACT PROJECT BLUEPRINTS
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {games.map((g: any) => {
              const isCompleted =
                g.status === 'completed'
                || g.status === 'COMPLETED_NORMAL'
                || g.status === 'COMPLETED_WITH_LIFELINE';
              const isSkipped =
                g.status === 'skipped'
                || g.status === 'SKIPPED_AFTER_RECOVERY'
                || g.status === 'SKIPPED_WITHOUT_LIFELINE';
              const isAvailable =
                g.status === 'available'
                || g.status === 'NOT_STARTED'
                || g.status === 'FIRST_ATTEMPT_FAILED';
              const isInProgress =
                g.status === 'IN_PROGRESS'
                || g.status === 'SECOND_ATTEMPT_IN_PROGRESS';
              const isPendingPuzzle = g.status === 'PENDING_RECOVERY_PUZZLE';

              return (
                <div
                  key={g.id}
                  className={`bg-retro-card border rounded-lg p-4 flex flex-col justify-between transition-all ${
                    isCompleted
                      ? 'border-retro-green/60 shadow-[0_0_10px_rgba(0,255,102,0.15)]'
                      : isSkipped
                      ? 'border-retro-amber/60'
                      : isAvailable || isInProgress
                      ? 'border-retro-cyan shadow-neon-cyan'
                      : 'border-retro-border opacity-50'
                  }`}
                >
                  <div>
                    {/* Game Header */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-pixel text-retro-muted">
                        CHALLENGE 0{g.orderNum}
                      </span>
                      {isCompleted && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-pixel bg-retro-green/10 text-retro-green border border-retro-green/40 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> CLEARED
                        </span>
                      )}
                      {isSkipped && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-pixel bg-retro-amber/10 text-retro-amber border border-retro-amber/40 flex items-center gap-1">
                          <SkipForward className="w-3 h-3" /> SKIPPED
                        </span>
                      )}
                      {isAvailable && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-pixel bg-retro-cyan/10 text-retro-cyan border border-retro-cyan/40 animate-pulse">
                          {g.status === 'FIRST_ATTEMPT_FAILED' ? 'RETRY AVAILABLE' : 'READY'}
                        </span>
                      )}
                      {isInProgress && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-pixel bg-retro-cyan/10 text-retro-cyan border border-retro-cyan/40">
                          IN PROGRESS
                        </span>
                      )}
                      {!isCompleted && !isSkipped && !isAvailable && !isInProgress && !isPendingPuzzle && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-pixel bg-retro-border text-retro-muted flex items-center gap-1">
                          <Lock className="w-3 h-3" /> LOCKED
                        </span>
                      )}
                      {isPendingPuzzle && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-pixel bg-retro-magenta/20 text-retro-magenta border border-retro-magenta/40">
                          RECOVERY PUZZLE
                        </span>
                      )}
                    </div>

                    <h3 className="font-pixel text-xs text-white mb-2">{g.title}</h3>
                    <p className="text-[11px] font-mono text-retro-muted mb-4">
                      {getGameCatalogEntry(g.gameKey)?.description || 'Complete this assigned challenge to unlock its project clue.'}
                    </p>

                    {/* Unlocked Clue View */}
                    {(isCompleted || isSkipped) && g.clue && (
                      <div className="mt-2 p-3 bg-retro-bg border border-retro-yellow/40 rounded">
                        <span className="text-[9px] font-pixel text-retro-yellow block mb-1">
                          DECRYPTED PROJECT CLUE:
                        </span>
                        <p className="font-retro text-base text-retro-cyan leading-snug">
                          {g.clue}
                        </p>
                      </div>
                    )}
                    {g.projectHint && (
                      <div className="mt-2 p-3 bg-retro-bg border border-retro-magenta/50 rounded">
                        <span className="text-[9px] font-pixel text-retro-magenta block mb-1">
                          VERIFIED PROJECT HINT:
                        </span>
                        <p className="font-retro text-base text-white leading-snug">{g.projectHint}</p>
                      </div>
                    )}
                  </div>

                  {/* Play Action Button */}
                  <div className="mt-4 pt-3 border-t border-retro-border/50">
                    {isPendingPuzzle ? (
                      <button
                        onClick={() => setSelectedGame(g)}
                        className="w-full py-2.5 px-3 bg-retro-magenta text-white font-pixel text-[11px] rounded font-bold active:scale-95 transition-all"
                      >
                        SOLVE RECOVERY PUZZLE
                      </button>
                    ) : isAvailable || isInProgress ? (
                      <button
                        onClick={() => setSelectedGame(g)}
                        disabled={false}
                        className="w-full py-2.5 px-3 bg-retro-cyan text-retro-bg hover:bg-white font-pixel text-[11px] rounded font-bold shadow-neon-cyan active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        {isInProgress
                          ? 'RESUME GAME'
                          : g.status === 'FIRST_ATTEMPT_FAILED'
                          ? 'USE LIFELINE RETRY'
                          : 'INSERT COIN / PLAY'}
                      </button>
                    ) : (isCompleted || isSkipped) ? (
                      <div className="w-full py-2 px-3 border border-retro-border text-retro-muted text-center font-pixel text-[10px] rounded">
                        GAME COMPLETE · {g.points || 0} POINTS
                      </div>
                    ) : (
                      <div className="text-center py-2 text-[10px] font-pixel text-retro-muted">
                        COMPLETE CHALLENGE 0{g.orderNum - 1} TO UNLOCK
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </main>

      {/* POPUP GAME MODAL */}
      {selectedGame && (
        <GameModal
          game={selectedGame}
          lifelinesRemaining={lifelines.remaining}
          eventPaused={eventState.isPaused}
          onClose={() => setSelectedGame(null)}
          onRefreshDashboard={() => {
            fetchDashboard();
          }}
        />
      )}
    </div>
  );
}
