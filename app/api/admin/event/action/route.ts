import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';
import crypto from 'crypto';
import { getGameCatalogEntry } from '@/lib/config/gameCatalog';
import {
  hasValidEnabledSupportedGameCount,
  isValidRecoveryQuestion,
  selectGamesForTeam,
} from '@/lib/games/rules';
import { assertPuzzleImageStorageAvailable } from '@/lib/storage/puzzleImages';
import {
  buildTeamGameAssignmentPlan,
} from '@/lib/games/teamGameAssignments';
import { inspectEventStartHistory } from '@/lib/eventStartHistory';

export const runtime = 'nodejs';

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
      if (event && (event.status !== 'ready' || event.started_at)) {
        return NextResponse.json({ error: `Event cannot start from ${event.status.toUpperCase()} state.` }, { status: 409 });
      }
      try {
        await assertPuzzleImageStorageAvailable();
      } catch {
        return NextResponse.json(
          { error: 'Private puzzle storage is not configured or its bucket is unavailable.' },
          { status: 503 }
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        const history = await inspectEventStartHistory(tx);
        if (!history.ready) throw new Error('EVENT_DATA_EXISTS');
        const existingAssignments = await tx.teamGame.findMany({
          select: {
            id: true, team_id: true, game_id: true, assignment_run_id: true, assigned_order: true,
            required: true, status: true, points: true, attempt_count: true, lifeline_used: true,
            started_at: true, completed_at: true, updated_by: true,
          },
        });

        const activeTeams = await tx.team.findMany({
          where: { active: true },
          select: { id: true, name: true, project_id: true },
        });
        if (activeTeams.length === 0) throw new Error('NO_ACTIVE_TEAMS');

        const enabledGames = await tx.game.findMany({
          where: { enabled: true },
          orderBy: { order_num: 'asc' },
        });
        const enabledSupportedGames = enabledGames.filter((game) => getGameCatalogEntry(game.game_key));
        if (!hasValidEnabledSupportedGameCount(enabledSupportedGames.length)) {
          throw new Error('INVALID_ENABLED_GAME_COUNT');
        }
        if (enabledSupportedGames.length !== enabledGames.length) {
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
        const selectedGamesByTeam = new Map(activeTeams.map((team) => [
          team.id,
          selectGamesForTeam(
            enabledGames,
            assignmentCounts,
            seenCombinations,
            (max) => crypto.randomInt(max)
          ),
        ]));
        const assignmentPlan = buildTeamGameAssignmentPlan(
          activeTeams,
          selectedGamesByTeam,
          new Set(enabledGames.map((game) => game.id)),
          existingAssignments,
          allocationRunId
        );
        for (const assignment of assignmentPlan.updates) {
          await tx.teamGame.update({ where: { id: assignment.id }, data: assignment.data });
        }
        for (const assignment of assignmentPlan.creates) {
          await tx.teamGame.create({ data: assignment });
        }

        for (const team of activeTeams) {
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
          },
          create: {
            id: 'global',
            status: 'running',
            started_at: now,
            paused_at: null,
          },
        });
      }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 10000 });

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
      const updated = await prisma.$transaction(async (tx) => {
        const updatedEvent = await tx.eventState.update({
          where: { id: 'global' },
          data: {
            status: 'running',
            paused_at: null,
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

    if (action === 'reset_data') {
      return NextResponse.json({
        error: 'Competition history cannot be cleared from the event controls. Existing assignments and clue history are preserved.',
      }, { status: 409 });
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
      return NextResponse.json({ error: 'At least three enabled supported games are required.' }, { status: 400 });
    }
    if (error.message === 'INVALID_ENABLED_GAME_COUNT') {
      return NextResponse.json({ error: 'Enable between three and ten supported games before starting the event.' }, { status: 400 });
    }
    if (error.message === 'UNSUPPORTED_ENABLED_GAME') {
      return NextResponse.json({ error: 'An enabled game has no playable implementation.' }, { status: 400 });
    }
    if (error.message === 'RECOVERY_QUESTION_REQUIRED') {
      return NextResponse.json({ error: 'Enable at least one valid recovery question with an image and answer choices.' }, { status: 400 });
    }
    if (error.message === 'EVENT_DATA_EXISTS') {
      return NextResponse.json(
        { error: 'Existing competition history was preserved. Starting a new run is blocked to protect assignments, scores, lifelines, puzzles, and clue unlocks.' },
        { status: 409 }
      );
    }
    if (error.message === 'NON_PRISTINE_TEAM_GAME' || error.message === 'DUPLICATE_TEAM_GAME_PAIR') {
      return NextResponse.json(
        { error: 'Existing team game assignments are not pristine import placeholders.' },
        { status: 409 }
      );
    }
    if (error.message === 'SELECTED_GAME_NOT_ENABLED') {
      return NextResponse.json(
        { error: 'An assigned game is not enabled.' },
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
