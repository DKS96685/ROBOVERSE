import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';
import crypto from 'crypto';

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('admin');
    const { action } = await req.json();

    const event = await prisma.eventState.findUnique({
      where: { id: 'global' },
    });

    const now = new Date();
    const beforeState = event ? { ...event } : null;

    if (action === 'start') {
      if (event?.status === 'running' || event?.status === 'paused') {
        return NextResponse.json({ error: 'Event is already running or paused.' }, { status: 409 });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const activeTeams = await tx.team.findMany({
          where: { active: true },
          select: { id: true, name: true, project_id: true },
        });
        if (activeTeams.length === 0) throw new Error('NO_ACTIVE_TEAMS');

        const enabledGames = await tx.game.findMany({
          where: { enabled: true },
          orderBy: { order_num: 'asc' },
        });
        if (enabledGames.length < 3) throw new Error('NOT_ENOUGH_GAMES');

        for (const team of activeTeams) {
          if (!team.project_id) throw new Error(`TEAM_PROJECT_REQUIRED:${team.name}`);
          const missingHints = await tx.projectHint.findMany({
            where: {
              project_id: team.project_id,
              game_id: { in: enabledGames.map((game) => game.id) },
              clue_text: { not: '' },
            },
            select: { game_id: true },
          });
          if (missingHints.length !== enabledGames.length) {
            throw new Error(`PROJECT_HINTS_REQUIRED:${team.name}`);
          }
        }

        const allocationRunId = crypto.randomUUID();
        const assignmentCounts = new Map(enabledGames.map((game) => [game.id, 0]));
        const seenCombinations = new Set<string>();

        for (const team of activeTeams) {
          await tx.teamGame.deleteMany({ where: { team_id: team.id } });

          const ranked = shuffle(enabledGames).sort(
            (a, b) => (assignmentCounts.get(a.id) || 0) - (assignmentCounts.get(b.id) || 0)
          );
          let selected = ranked.slice(0, 3);
          let selectedIds = selected.map((game) => game.id).sort().join(':');

          for (let attempt = 0; seenCombinations.has(selectedIds) && attempt < 20; attempt++) {
            const alternatives = shuffle(enabledGames);
            selected = alternatives.slice(0, 3);
            selectedIds = selected.map((game) => game.id).sort().join(':');
          }
          seenCombinations.add(selectedIds);
          selected = shuffle(selected);

          for (let index = 0; index < selected.length; index++) {
            const game = selected[index];
            await tx.teamGame.create({
              data: {
                team_id: team.id,
                game_id: game.id,
                assignment_run_id: allocationRunId,
                assigned_order: index + 1,
                required: true,
                status: index === 0 ? 'NOT_STARTED' : 'NOT_STARTED',
                updated_by: 'system_allocation',
              },
            });
            assignmentCounts.set(game.id, (assignmentCounts.get(game.id) || 0) + 1);
          }

          await tx.teamScore.upsert({
            where: { team_id: team.id },
            update: {
              total_points: 0,
              completed_games: 0,
              lifeline_used: false,
              completed_at: null,
            },
            create: {
              team_id: team.id,
              total_points: 0,
              completed_games: 0,
              lifeline_used: false,
            },
          });
        }

        return await tx.eventState.upsert({
          where: { id: 'global' },
          update: {
            status: 'running',
            started_at: now,
            paused_at: null,
            total_paused_seconds: 0,
          },
          create: {
            id: 'global',
            status: 'running',
            started_at: now,
            paused_at: null,
            total_paused_seconds: 0,
          },
        });
      }, { isolationLevel: 'Serializable' });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'event_start',
        before: beforeState,
        after: updated,
      });

      return NextResponse.json({ success: true, eventState: updated });
    }

    if (action === 'pause') {
      if (event?.status !== 'running') {
        return NextResponse.json({ error: 'Event is not running' }, { status: 400 });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const updatedEvent = await tx.eventState.update({
          where: { id: 'global' },
          data: { status: 'paused', paused_at: now },
        });
        await tx.gameSession.updateMany({
          where: { result: 'in_progress', pause_started_at: null },
          data: { pause_started_at: now },
        });
        return updatedEvent;
      });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'event_pause',
        before: beforeState,
        after: updated,
      });

      return NextResponse.json({ success: true, eventState: updated });
    }

    if (action === 'resume') {
      if (event?.status !== 'paused' || !event.paused_at) {
        return NextResponse.json({ error: 'Event is not paused' }, { status: 400 });
      }

      const pausedSeconds = Math.floor(
        (now.getTime() - new Date(event.paused_at).getTime()) / 1000
      );
      const newTotalPaused = event.total_paused_seconds + pausedSeconds;

      const updated = await prisma.$transaction(async (tx) => {
        const updatedEvent = await tx.eventState.update({
          where: { id: 'global' },
          data: {
            status: 'running',
            paused_at: null,
            total_paused_seconds: newTotalPaused,
          },
        });
        await tx.gameSession.updateMany({
          where: { result: 'in_progress', pause_started_at: { not: null } },
          data: {
            paused_seconds: { increment: pausedSeconds },
            pause_started_at: null,
          },
        });
        return updatedEvent;
      });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'event_resume',
        before: beforeState,
        after: updated,
      });

      return NextResponse.json({ success: true, eventState: updated });
    }

    if (action === 'end') {
      const updated = await prisma.eventState.update({
        where: { id: 'global' },
        data: { status: 'ended' },
      });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'event_end',
        before: beforeState,
        after: updated,
      });

      return NextResponse.json({ success: true, eventState: updated });
    }

    if (action === 'reset') {
      const updated = await prisma.eventState.update({
        where: { id: 'global' },
        data: {
          status: 'ready',
          started_at: null,
          paused_at: null,
          total_paused_seconds: 0,
        },
      });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'event_reset',
        before: beforeState,
        after: updated,
      });

      return NextResponse.json({ success: true, eventState: updated });
    }

    // Full event data reset — keeps teams and games
    if (action === 'reset_data') {
      // Delete transactional data in a transaction
      await prisma.$transaction([
        prisma.gameSession.deleteMany(),
        prisma.lifelineEvent.deleteMany(),
        prisma.auditLog.deleteMany(),
      ]);

      const allGames = await prisma.game.findMany({ orderBy: { order_num: 'asc' } });
      const allTeams = await prisma.team.findMany({ select: { id: true } });
      const now = new Date();

      for (const team of allTeams) {
        for (let i = 0; i < allGames.length; i++) {
          await prisma.teamGame.upsert({
            where: { team_id_game_id: { team_id: team.id, game_id: allGames[i].id } },
            update: { status: i === 0 ? 'available' : 'locked', updated_by: 'admin_reset' },
            create: {
              team_id: team.id,
              game_id: allGames[i].id,
              status: i === 0 ? 'available' : 'locked',
              updated_by: 'admin_reset',
            },
          });
        }
      }

      const resetEvent = await prisma.eventState.upsert({
        where: { id: 'global' },
        update: { status: 'ready', started_at: null, paused_at: null, total_paused_seconds: 0 },
        create: { id: 'global', status: 'ready', started_at: null, paused_at: null, total_paused_seconds: 0 },
      });

      await prisma.auditLog.create({
        data: {
          actor: session.email || 'admin',
          action: 'event_data_reset',
          before: beforeState ? JSON.stringify(beforeState) : null,
          after: JSON.stringify({ status: 'ready', message: 'Full event data reset' }),
        },
      });

      return NextResponse.json({ success: true, eventState: resetEvent });
    }

    return NextResponse.json({ error: 'Invalid event action' }, { status: 400 });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.message === 'NO_ACTIVE_TEAMS') {
      return NextResponse.json({ error: 'At least one active team is required.' }, { status: 400 });
    }
    if (error.message === 'NOT_ENOUGH_GAMES') {
      return NextResponse.json({ error: 'At least three enabled games are required.' }, { status: 400 });
    }
    if (typeof error.message === 'string' && error.message.startsWith('TEAM_PROJECT_REQUIRED:')) {
      const teamName = error.message.split(':').slice(1).join(':');
      return NextResponse.json({ error: `Team ${teamName} has no assigned project.` }, { status: 400 });
    }
    if (typeof error.message === 'string' && error.message.startsWith('PROJECT_HINTS_REQUIRED:')) {
      const teamName = error.message.split(':').slice(1).join(':');
      return NextResponse.json({ error: `Project for ${teamName} is missing clues for an enabled game.` }, { status: 400 });
    }
    console.error('Admin event action error:', error);
    return NextResponse.json({ error: 'Failed to update event state' }, { status: 500 });
  }
}
