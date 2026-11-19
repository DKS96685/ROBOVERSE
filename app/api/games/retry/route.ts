import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { GAME_RULES } from '@/lib/config/gameRules';
import { getGameProgressTarget } from '@/lib/config/gameCatalog';
import { createInitialGameState, getPublicGameState } from '@/lib/games/state';

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('team');
    const body = await req.json();
    const gameId = typeof body.gameId === 'string' ? body.gameId : null;
    if (!gameId) {
      return NextResponse.json({ error: 'gameId is required' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: session.teamId! },
        select: { active: true },
      });
      if (!team?.active) return { error: 'Team is inactive.', status: 403 };

      const event = await tx.eventState.findUnique({ where: { id: 'global' } });
      if (event?.status !== 'running') {
        return { error: 'Event is not running.', status: 400 };
      }

      const teamGame = await tx.teamGame.findUnique({
        where: {
          team_id_game_id: {
            team_id: session.teamId!,
            game_id: gameId,
          },
        },
        include: { game: true },
      });
      if (!teamGame || !teamGame.required || teamGame.status !== 'FIRST_ATTEMPT_FAILED') {
        return { error: 'A lifeline retry is not available for this game.', status: 409 };
      }

      const events = await tx.lifelineEvent.findMany({
        where: { team_id: session.teamId! },
        select: { action: true, amount: true },
      });
      let used = 0;
      let reverted = 0;
      for (const lifelineEvent of events) {
        if (lifelineEvent.action === 'used') used += lifelineEvent.amount;
        if (lifelineEvent.action === 'reverted') reverted += lifelineEvent.amount;
      }
      const remaining = Math.max(
        0,
        GAME_RULES.STARTING_LIFELINES - Math.max(0, used - reverted)
      );
      if (remaining < 1) {
        return { error: 'The team lifeline has already been spent.', status: 409 };
      }

      const target = getGameProgressTarget(teamGame.game.game_key);
      const gameConfig = createInitialGameState(
        teamGame.game.game_key,
        (max) => crypto.randomInt(max)
      );
      if (!gameConfig) {
        return { error: 'This game does not have a supported server-verified implementation.', status: 409 };
      }
      const lastAttempt = await tx.gameSession.aggregate({
        where: { team_id: session.teamId!, team_game_id: teamGame.id },
        _max: { attempt_number: true },
      });
      const attemptNumber = (lastAttempt._max.attempt_number || 1) + 1;
      const gameSession = await tx.gameSession.create({
        data: {
          team_id: session.teamId!,
          game_id: gameId,
          team_game_id: teamGame.id,
          attempt_number: attemptNumber,
          result: 'in_progress',
          progress: 0,
          validated_target: target,
          game_state: JSON.parse(JSON.stringify(gameConfig)) as Prisma.InputJsonValue,
        },
      });

      await tx.lifelineEvent.create({
        data: {
          team_id: session.teamId!,
          game_id: gameId,
          team_game_id: teamGame.id,
          session_id: gameSession.id,
          action: 'used',
          amount: 1,
          by_admin: false,
          note: `Lifeline used for second attempt at ${teamGame.game.title}`,
        },
      });

      await tx.teamGame.update({
        where: { id: teamGame.id },
        data: {
          status: 'SECOND_ATTEMPT_IN_PROGRESS',
          attempt_count: attemptNumber,
          lifeline_used: true,
        },
      });

      await tx.teamScore.upsert({
        where: { team_id: session.teamId! },
        update: { lifeline_used: true },
        create: { team_id: session.teamId!, lifeline_used: true },
      });

      await tx.auditLog.create({
        data: {
          actor: session.loginId || 'team',
          action: 'lifeline_used',
          team_id: session.teamId!,
          after: JSON.stringify({ gameId, teamGameId: teamGame.id, attempt: attemptNumber }),
        },
      });

      return {
        sessionId: gameSession.id,
        startedAt: gameSession.started_at,
        minSeconds: teamGame.game.min_seconds,
        gameConfig,
      };
    }, { isolationLevel: 'Serializable' });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const publicGameConfig = getPublicGameState(result.gameConfig);
    if (!publicGameConfig) {
      return NextResponse.json(
        { error: 'The retry game state could not be initialized. Contact an administrator.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ...result, gameConfig: publicGameConfig });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.code === 'P2034') {
      return NextResponse.json({ error: 'Lifeline update conflicted. Retry the request.' }, { status: 409 });
    }
    console.error('Lifeline retry error:', error);
    return NextResponse.json({ error: 'Failed to start lifeline retry' }, { status: 500 });
  }
}
