import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { GAME_RULES } from '@/lib/config/gameRules';
import { gameStartSchema } from '@/lib/validations';

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('team');
    const parsed = gameStartSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: session.teamId! },
        select: { active: true },
      });
      if (!team?.active) return { error: 'Team is inactive.', status: 403 };

      const event = await tx.eventState.findUnique({ where: { id: 'global' } });
      if (event?.status !== 'running') return { error: 'Event is not running.', status: 400 };

      const teamGame = await tx.teamGame.findUnique({
        where: {
          team_id_game_id: {
            team_id: session.teamId!,
            game_id: parsed.data.gameId,
          },
        },
        include: { game: true },
      });
      if (!teamGame || teamGame.required !== true || !teamGame.game.enabled) {
        return { error: 'Game is not available to play.', status: 400 };
      }
      if (teamGame.assigned_order > 1) {
        const previousGame = await tx.teamGame.findFirst({
          where: {
            team_id: session.teamId!,
            assignment_run_id: teamGame.assignment_run_id,
            assigned_order: teamGame.assigned_order - 1,
          },
        });
        const terminalStatuses = [
          'COMPLETED_NORMAL',
          'COMPLETED_WITH_LIFELINE',
          'SKIPPED_AFTER_RECOVERY',
          'SKIPPED_WITHOUT_LIFELINE',
        ];
        if (!previousGame || !terminalStatuses.includes(previousGame.status)) {
          return { error: 'Complete the previous assigned game first.', status: 409 };
        }
      }
      if (!['NOT_STARTED', 'FIRST_ATTEMPT_FAILED'].includes(teamGame.status)) {
        return { error: 'Game cannot be started in its current state.', status: 400 };
      }
      if (teamGame.status === 'FIRST_ATTEMPT_FAILED') {
        return { error: 'Use the lifeline retry action after a first failure.', status: 409 };
      }

      const activeSession = await tx.gameSession.findFirst({
        where: { team_id: session.teamId!, team_game_id: teamGame.id, result: 'in_progress' },
        select: { id: true },
      });
      if (activeSession) return { error: 'This team already has an active game session.', status: 409 };

      const gameSession = await tx.gameSession.create({
        data: {
          team_id: session.teamId!,
          game_id: parsed.data.gameId,
          team_game_id: teamGame.id,
          attempt_number: 1,
          result: 'in_progress',
          progress: 0,
          validated_target: 3,
          game_state: { target: 3, gameKey: teamGame.game.game_key },
        },
      });
      await tx.teamGame.update({
        where: { id: teamGame.id },
        data: {
          status: 'IN_PROGRESS',
          attempt_count: 1,
          started_at: teamGame.started_at || new Date(),
        },
      });
      return { session: gameSession, minSeconds: teamGame.game.min_seconds };
    }, { isolationLevel: 'Serializable' });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      sessionId: result.session.id,
      startedAt: result.session.started_at,
      minSeconds: result.minSeconds,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.code === 'P2034') {
      return NextResponse.json({ error: 'Game start conflicted with another update. Please retry.' }, { status: 409 });
    }
    console.error('Game start error:', error);
    return NextResponse.json({ error: 'Failed to start game session' }, { status: 500 });
  }
}
