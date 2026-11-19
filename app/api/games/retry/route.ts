import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { GAME_RULES } from '@/lib/config/gameRules';

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

      const existingUse = await tx.lifelineEvent.findFirst({
        where: {
          team_id: session.teamId!,
          action: 'used',
          game_id: gameId,
        },
      });
      if (existingUse) {
        return { error: 'This lifeline retry was already recorded.', status: 409 };
      }

      await tx.lifelineEvent.create({
        data: {
          team_id: session.teamId!,
          game_id: gameId,
          team_game_id: teamGame.id,
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
          attempt_count: 2,
          lifeline_used: true,
        },
      });

      await tx.teamScore.upsert({
        where: { team_id: session.teamId! },
        update: { lifeline_used: true },
        create: { team_id: session.teamId!, lifeline_used: true },
      });

      const gameSession = await tx.gameSession.create({
        data: {
          team_id: session.teamId!,
          game_id: gameId,
          team_game_id: teamGame.id,
          attempt_number: 2,
          result: 'in_progress',
          progress: 0,
          validated_target: 3,
          game_state: { target: 3, gameKey: teamGame.game.game_key },
        },
      });

      await tx.auditLog.create({
        data: {
          actor: session.loginId || 'team',
          action: 'lifeline_used',
          team_id: session.teamId!,
          after: JSON.stringify({ gameId, teamGameId: teamGame.id, attempt: 2 }),
        },
      });

      return {
        sessionId: gameSession.id,
        startedAt: gameSession.started_at,
        minSeconds: teamGame.game.min_seconds,
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
      return NextResponse.json({ error: 'Lifeline update conflicted. Retry the request.' }, { status: 409 });
    }
    console.error('Lifeline retry error:', error);
    return NextResponse.json({ error: 'Failed to start lifeline retry' }, { status: 500 });
  }
}
