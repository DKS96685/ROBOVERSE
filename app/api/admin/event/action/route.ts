import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';
import crypto from 'crypto';
import { getGameCatalogEntry } from '@/lib/config/gameCatalog';
import { isValidRecoveryQuestion, selectGamesForTeam } from '@/lib/games/rules';

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
        const existingAssignment = await tx.teamGame.findFirst({
          where: {
            OR: [
              { required: true },
              { assignment_run_id: { not: null } },
            ],
          },
          select: { id: true },
        });
        const existingSession = await tx.gameSession.findFirst({ select: { id: true } });
        if (existingAssignment || existingSession) throw new Error('EVENT_DATA_EXISTS');

        const activeTeams = await tx.team.findMany({
          where: { active: true },
          select: { id: true, name: true, project_id: true },
        });
        if (activeTeams.length === 0) throw new Error('NO_ACTIVE_TEAMS');

        const enabledGames = await tx.game.findMany({
          where: { enabled: true },
          orderBy: { order_num: 'asc' },
        });
        if (enabledGames.length < 6 || enabledGames.length > 10) {
          throw new Error('INVALID_ENABLED_GAME_COUNT');
        }
        if (enabledGames.some((game) => !getGameCatalogEntry(game.game_key))) {
          throw new Error('UNSUPPORTED_ENABLED_GAME');
        }

        const recoveryQuestions = await tx.componentQuestion.findMany({
          where: { enabled: true },
          select: {
            question_text: true,
            image_url: true,
            correct_answer: true,
            options: { select: { option_text: true } },
          },
        });
        const hasRecoveryQuestion = recoveryQuestions.some((question) =>
          isValidRecoveryQuestion({
            questionText: question.question_text,
            imageUrl: question.image_url,
            correctAnswer: question.correct_answer,
            options: question.options.map((option) => ({ optionText: option.option_text })),
          })
        );
        if (!hasRecoveryQuestion) throw new Error('RECOVERY_QUESTION_REQUIRED');

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
          await tx.teamGame.deleteMany({
            where: {
              team_id: team.id,
              required: false,
              assignment_run_id: null,
            },
          });

          const selected = selectGamesForTeam(
            enabledGames,
            assignmentCounts,
            seenCombinations,
            (max) => crypto.randomInt(max)
          );

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
      if (event?.status === 'running' || event?.status === 'paused') {
        return NextResponse.json({ error: 'End the event before resetting its state.' }, { status: 409 });
      }

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
      if (event?.status === 'running' || event?.status === 'paused') {
        return NextResponse.json({ error: 'Pause or end the event before resetting competition data.' }, { status: 409 });
      }

      const resetEvent = await prisma.$transaction(async (tx) => {
        await tx.recoveryPuzzleAttempt.deleteMany();
        await tx.projectClueUnlock.deleteMany();
        await tx.recoveryPuzzle.deleteMany();
        await tx.gameSession.deleteMany();
        await tx.lifelineEvent.deleteMany();
        await tx.teamScore.deleteMany();
        await tx.teamGame.deleteMany();

        const updatedEvent = await tx.eventState.upsert({
          where: { id: 'global' },
          update: { status: 'ready', started_at: null, paused_at: null, total_paused_seconds: 0 },
          create: { id: 'global', status: 'ready', started_at: null, paused_at: null, total_paused_seconds: 0 },
        });
        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'event_data_reset',
            before: JSON.stringify(beforeState),
            after: JSON.stringify({
              status: 'ready',
              preserved: ['teams', 'projects', 'games', 'project hints', 'component questions', 'audit history'],
              cleared: ['assignments', 'game sessions', 'lifeline events', 'scores', 'recovery puzzles', 'clue unlocks'],
            }),
          },
        });
        return updatedEvent;
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
      return NextResponse.json({ error: 'At least six enabled games are required.' }, { status: 400 });
    }
    if (error.message === 'INVALID_ENABLED_GAME_COUNT') {
      return NextResponse.json({ error: 'Enable between six and ten games before starting the event.' }, { status: 400 });
    }
    if (error.message === 'UNSUPPORTED_ENABLED_GAME') {
      return NextResponse.json({ error: 'An enabled game has no playable implementation.' }, { status: 400 });
    }
    if (error.message === 'RECOVERY_QUESTION_REQUIRED') {
      return NextResponse.json({ error: 'Enable at least one valid recovery question with an image and answer choices.' }, { status: 400 });
    }
    if (error.message === 'EVENT_DATA_EXISTS') {
      return NextResponse.json(
        { error: 'Existing assignments or game sessions were preserved. Use RESET EVENT DATA before starting a new competition run.' },
        { status: 409 }
      );
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
