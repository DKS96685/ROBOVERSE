import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

type ProgressAction =
  | { type: 'snakeFoodCollected' }
  | { type: 'pongPlayerPoint' }
  | { type: 'memoryPairMatched' };

function parseAction(value: unknown): ProgressAction | null {
  if (!value || typeof value !== 'object') return null;
  const type = (value as { type?: unknown }).type;
  if (
    type === 'snakeFoodCollected'
    || type === 'pongPlayerPoint'
    || type === 'memoryPairMatched'
  ) {
    return { type };
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('team');
    const body = await req.json();
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    const action = parseAction(body.action);

    if (!sessionId || !action) {
      return NextResponse.json({ error: 'sessionId and a valid progress action are required.' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.eventState.findUnique({ where: { id: 'global' } });
      if (event?.status !== 'running') {
        return { error: 'Event is not running.', status: 400 };
      }

      const team = await tx.team.findUnique({
        where: { id: session.teamId! },
        select: { active: true },
      });
      if (!team?.active) return { error: 'Team is inactive.', status: 403 };

      const gameSession = await tx.gameSession.findUnique({
        where: { id: sessionId },
        include: { game: true },
      });
      if (!gameSession || gameSession.team_id !== session.teamId) {
        return { error: 'Game session not found or belongs to another team.', status: 404 };
      }
      if (gameSession.result !== 'in_progress') {
        return { error: 'This game session has already been concluded.', status: 409 };
      }

      const assigned = await tx.teamGame.findUnique({
        where: {
          team_id_game_id: {
            team_id: session.teamId!,
            game_id: gameSession.game_id,
          },
        },
      });
      if (!assigned || !assigned.required) {
        return { error: 'Game is not assigned to this team.', status: 403 };
      }

      const expectedAction =
        gameSession.game.game_key === 'snake'
          ? 'snakeFoodCollected'
          : gameSession.game.game_key === 'pong'
          ? 'pongPlayerPoint'
          : gameSession.game.game_key === 'memory'
          ? 'memoryPairMatched'
          : null;

      if (!expectedAction || action.type !== expectedAction) {
        return { error: 'Progress action does not match the assigned game.', status: 400 };
      }

      const state =
        gameSession.game_state && typeof gameSession.game_state === 'object'
          ? (gameSession.game_state as Record<string, unknown>)
          : {};
      const recordedProgress =
        typeof state.serverProgress === 'number'
          ? Math.max(0, Math.floor(state.serverProgress))
          : gameSession.progress;
      const nextProgress = Math.min(
        gameSession.validated_target,
        recordedProgress + 1
      );
      const nextState = {
        ...state,
        target: gameSession.validated_target,
        serverProgress: nextProgress,
        gameKey: gameSession.game.game_key,
        lastActionAt: new Date().toISOString(),
      };

      await tx.gameSession.update({
        where: { id: gameSession.id },
        data: {
          progress: nextProgress,
          game_state: nextState,
          winning_state:
            nextProgress >= gameSession.validated_target
              ? 'SERVER_VALIDATED'
              : null,
        },
      });

      return {
        success: true,
        progress: nextProgress,
        target: gameSession.validated_target,
        winningReady: nextProgress >= gameSession.validated_target,
      };
    }, { isolationLevel: 'Serializable' });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.code === 'P2034') {
      return NextResponse.json({ error: 'Progress update conflicted. Retry.' }, { status: 409 });
    }
    console.error('Game progress error:', error);
    return NextResponse.json({ error: 'Failed to update game progress' }, { status: 500 });
  }
}
