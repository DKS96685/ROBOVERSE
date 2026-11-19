import { prisma } from './db';
import { GAME_RULES } from './config/gameRules';

export interface EventClockState {
  status: 'ready' | 'running' | 'paused' | 'ended';
  startedAt: string | null;
  pausedAt: string | null;
  totalPausedSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  totalSeconds: number;
  currentSlot: number;
  isPaused: boolean;
  isRunning: boolean;
  isEnded: boolean;
  serverTime: string;
}

export async function getEventState(): Promise<EventClockState> {
  let event = await prisma.eventState.findUnique({
    where: { id: 'global' },
  });

  if (!event) {
    event = await prisma.eventState.create({
      data: {
        id: 'global',
        status: 'ready',
        total_paused_seconds: 0,
      },
    });
  }

  const now = new Date();
  const totalSeconds = GAME_RULES.EVENT_DURATION_MINUTES * 60; // 10,800s (3 hours)
  const slotSeconds = GAME_RULES.SLOT_DURATION_MINUTES * 60; // 2,700s (45 mins)

  let elapsedSeconds = 0;

  if (event.status === 'ready' || !event.started_at) {
    elapsedSeconds = 0;
  } else if (event.status === 'ended') {
    elapsedSeconds = totalSeconds;
  } else if (event.status === 'paused' && event.paused_at) {
    const started = new Date(event.started_at).getTime();
    const paused = new Date(event.paused_at).getTime();
    const grossElapsed = Math.floor((paused - started) / 1000);
    elapsedSeconds = Math.max(0, grossElapsed - event.total_paused_seconds);
  } else if (event.status === 'running') {
    const started = new Date(event.started_at).getTime();
    const grossElapsed = Math.floor((now.getTime() - started) / 1000);
    elapsedSeconds = Math.max(0, grossElapsed - event.total_paused_seconds);

    // Auto-end if elapsed reaches totalSeconds
    if (elapsedSeconds >= totalSeconds) {
      elapsedSeconds = totalSeconds;
      // Background update event state to ended
      await prisma.eventState.update({
        where: { id: 'global' },
        data: { status: 'ended' },
      });
      event.status = 'ended';
    }
  }

  elapsedSeconds = Math.min(totalSeconds, Math.max(0, elapsedSeconds));
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
  const currentSlot = Math.min(
    GAME_RULES.TOTAL_SLOTS,
    Math.floor(elapsedSeconds / slotSeconds) + 1
  );

  return {
    status: event.status as 'ready' | 'running' | 'paused' | 'ended',
    startedAt: event.started_at?.toISOString() || null,
    pausedAt: event.paused_at?.toISOString() || null,
    totalPausedSeconds: event.total_paused_seconds,
    elapsedSeconds,
    remainingSeconds,
    totalSeconds,
    currentSlot,
    isPaused: event.status === 'paused',
    isRunning: event.status === 'running',
    isEnded: event.status === 'ended',
    serverTime: now.toISOString(),
  };
}
