import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { GAME_RULES } from '@/lib/config/gameRules';
import { PuzzleImageStorageError, resolvePuzzleImageUrl } from '@/lib/storage/puzzleImages';
import {
  getFailedAttemptDisposition,
  getGameCompletionPoints,
  isValidRecoveryQuestion,
} from '@/lib/games/rules';

export const runtime = 'nodejs';

async function remainingLifelines(tx: any, teamId: string) {
  const events = await tx.lifelineEvent.findMany({
    where: { team_id: teamId },
    select: { action: true, amount: true },
  });
  let used = 0;
  let reverted = 0;
  for (const event of events) {
    if (event.action === 'used') used += event.amount;
    if (event.action === 'reverted') reverted += event.amount;
  }
  return Math.max(0, GAME_RULES.STARTING_LIFELINES - Math.max(0, used - reverted));
}

async function refreshTeamScore(tx: any, teamId: string) {
  const teamGames = await tx.teamGame.findMany({
    where: { team_id: teamId, required: true },
  });
  const successfulGames = teamGames.filter((teamGame: any) =>
    teamGame.status === 'COMPLETED_NORMAL' || teamGame.status === 'COMPLETED_WITH_LIFELINE'
  );
  const lifelineUsed = teamGames.some((teamGame: any) => teamGame.lifeline_used);
  const totalPoints = teamGames.reduce((sum: number, teamGame: any) => sum + teamGame.points, 0);
  const allTerminal = teamGames.length === 3 && teamGames.every((teamGame: any) =>
    ['COMPLETED_NORMAL', 'COMPLETED_WITH_LIFELINE', 'SKIPPED_AFTER_RECOVERY', 'SKIPPED_WITHOUT_LIFELINE'].includes(teamGame.status)
  );
  const completedAt = allTerminal ? new Date() : null;

  await tx.teamScore.upsert({
    where: { team_id: teamId },
    update: {
      total_points: totalPoints,
      completed_games: successfulGames.length,
      lifeline_used: lifelineUsed,
      completed_at: completedAt,
    },
    create: {
      team_id: teamId,
      total_points: totalPoints,
      completed_games: successfulGames.length,
      lifeline_used: lifelineUsed,
      completed_at: completedAt,
    },
  });
}

async function createRecoveryPuzzle(tx: any, teamId: string, teamGame: any) {
  const previous = await tx.recoveryPuzzle.findMany({
    where: { team_id: teamId },
    select: { question_id: true },
  });
  const previousIds = new Set(previous.map((item: any) => item.question_id));

  const questions = await tx.componentQuestion.findMany({
    where: { enabled: true },
    include: { options: { orderBy: { sort_order: 'asc' } } },
    orderBy: { created_at: 'asc' },
  });
  const validQuestions = questions.filter((question: any) =>
    isValidRecoveryQuestion({
      questionText: question.question_text,
      imageUrl: question.image_url,
      correctAnswer: question.correct_answer,
      options: question.options.map((option: any) => ({ optionText: option.option_text })),
    })
  );
  const question = validQuestions.find((item: any) => !previousIds.has(item.id)) || validQuestions[0];
  if (!question) return null;

  const puzzle = await tx.recoveryPuzzle.upsert({
    where: {
      team_id_team_game_id: {
        team_id: teamId,
        team_game_id: teamGame.id,
      },
    },
    update: { status: 'PENDING' },
    create: {
      team_id: teamId,
      team_game_id: teamGame.id,
      question_id: question.id,
      status: 'PENDING',
    },
  });

  return {
    puzzle,
    question: {
      id: question.id,
      questionText: question.question_text,
      imageUrl: question.image_url,
      options: question.options.map((option: any) => ({
        id: option.id,
        text: option.option_text,
      })),
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('team');
    const body = await req.json();
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    const result = body.result === 'won' || body.result === 'lost' ? body.result : null;
    const submissionKey = typeof body.submissionKey === 'string' ? body.submissionKey : null;

    if (!sessionId || !result) {
      return NextResponse.json({ error: 'sessionId and result are required' }, { status: 400 });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const event = await tx.eventState.findUnique({ where: { id: 'global' } });
      if (event?.status !== 'running') {
        return { error: 'Event is not running.', status: 400 };
      }

      const team = await tx.team.findUnique({
        where: { id: session.teamId! },
        select: { active: true, project_id: true },
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

      if (submissionKey) {
        const duplicate = await tx.gameSession.findFirst({
          where: {
            team_id: session.teamId!,
            submission_key: submissionKey,
            result: { not: 'in_progress' },
          },
        });
        if (duplicate) return { error: 'Duplicate submission.', status: 409 };
      }

      const teamGame = await tx.teamGame.findUnique({
        where: {
          team_id_game_id: {
            team_id: session.teamId!,
            game_id: gameSession.game_id,
          },
        },
      });
      if (!teamGame || !teamGame.required) {
        return { error: 'Game is not assigned to this team.', status: 403 };
      }

      if (result === 'lost') {
        const gameState =
          gameSession.game_state && typeof gameSession.game_state === 'object'
            ? gameSession.game_state as Record<string, unknown>
            : {};
        const serverVerifiedFailure = gameState.attemptFailed === true
          || gameState.failed === true
          || (
            gameSession.game.game_key === 'target-sequence'
            && typeof gameState.failures === 'number'
            && gameState.failures >= 3
          );
        if (!serverVerifiedFailure) {
          return {
            error: 'The server has not verified a failed attempt. Continue playing or explicitly forfeit.',
            status: 400,
          };
        }
      }

      const projectHint = result === 'won' && team.project_id
        ? await tx.projectHint.findUnique({
            where: {
              project_id_game_id: {
                project_id: team.project_id,
                game_id: gameSession.game_id,
              },
            },
            select: { clue_text: true },
          })
        : null;
      if (result === 'won' && !projectHint?.clue_text.trim()) {
        return {
          error: 'The assigned project clue is unavailable. Contact an administrator.',
          status: 409,
        };
      }

      const now = new Date();
      const pausedSeconds = gameSession.paused_seconds
        + (gameSession.pause_started_at
          ? Math.floor((now.getTime() - gameSession.pause_started_at.getTime()) / 1000)
          : 0);
      const durationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - gameSession.started_at.getTime()) / 1000 - pausedSeconds)
      );

      if (
        result === 'won'
        && (
          gameSession.progress < gameSession.validated_target
          || gameSession.winning_state !== 'SERVER_VALIDATED'
          || durationSeconds < gameSession.game.min_seconds
        )
      ) {
        return {
          error: 'Server verification rejected the win. Verified game progress is required.',
          status: 400,
          durationSeconds,
        };
      }

      const claim = await tx.gameSession.updateMany({
        where: { id: sessionId, team_id: session.teamId!, result: 'in_progress' },
        data: {
          result,
          ended_at: now,
          duration_s: durationSeconds,
          paused_seconds: pausedSeconds,
          pause_started_at: null,
          progress: gameSession.progress,
          submission_key: submissionKey,
        },
      });
      if (claim.count !== 1) {
        return { error: 'Duplicate submission.', status: 409 };
      }

      if (result === 'won') {
        const normalCompletion = gameSession.attempt_number === 1;
        const points = getGameCompletionPoints(gameSession.attempt_number);
        const status = normalCompletion ? 'COMPLETED_NORMAL' : 'COMPLETED_WITH_LIFELINE';

        await tx.teamGame.update({
          where: { id: teamGame.id },
          data: {
            status,
            points,
            attempt_count: gameSession.attempt_number,
            completed_at: now,
          },
        });

        if (team.project_id && projectHint) {
          await tx.projectClueUnlock.upsert({
            where: {
              team_id_project_id_game_id: {
                team_id: session.teamId!,
                project_id: team.project_id,
                game_id: gameSession.game_id,
              },
            },
            update: {},
            create: {
              team_id: session.teamId!,
              project_id: team.project_id,
              game_id: gameSession.game_id,
              team_game_id: teamGame.id,
              reason: status,
            },
          });
        }

        await refreshTeamScore(tx, session.teamId!);

        await tx.auditLog.create({
          data: {
            actor: session.loginId || 'team',
            action: 'game_completed',
            team_id: session.teamId!,
            before: JSON.stringify({ status: teamGame.status }),
            after: JSON.stringify({
              status,
              points,
              gameId: gameSession.game_id,
              clueUnlocked: Boolean(projectHint),
            }),
          },
        });

        return {
          success: true,
          clue: projectHint?.clue_text || null,
          points,
          status,
          durationSeconds,
        };
      }

      const remaining = gameSession.attempt_number === 1
        ? await remainingLifelines(tx, session.teamId!)
        : 0;
      if (getFailedAttemptDisposition(gameSession.attempt_number, remaining) === 'LIFELINE_RETRY_AVAILABLE') {
        await tx.teamGame.update({
          where: { id: teamGame.id },
          data: { status: 'FIRST_ATTEMPT_FAILED', attempt_count: 1 },
        });
        await tx.auditLog.create({
          data: {
            actor: session.loginId || 'team',
            action: 'first_attempt_failed',
            team_id: session.teamId!,
            after: JSON.stringify({ gameId: gameSession.game_id }),
          },
        });
        return {
          success: false,
          firstAttemptFailed: true,
          lifelineAvailable: true,
          durationSeconds,
        };
      }

      await tx.teamGame.update({
        where: { id: teamGame.id },
        data: {
          status: 'PENDING_RECOVERY_PUZZLE',
          attempt_count: gameSession.attempt_number,
          points: 0,
        },
      });

      const recovery = await createRecoveryPuzzle(tx, session.teamId!, teamGame);
      await tx.auditLog.create({
        data: {
          actor: session.loginId || 'team',
          action: 'recovery_puzzle_required',
          team_id: session.teamId!,
          after: JSON.stringify({
            gameId: gameSession.game_id,
            puzzleId: recovery?.puzzle.id || null,
          }),
        },
      });
      await refreshTeamScore(tx, session.teamId!);

      return {
        success: false,
        pendingRecoveryPuzzle: true,
        puzzle: recovery?.question || null,
        durationSeconds,
      };
    }, { isolationLevel: 'Serializable' });

    if (outcome.error) {
      return NextResponse.json(
        { error: outcome.error, durationSeconds: outcome.durationSeconds },
        { status: outcome.status || 400 }
      );
    }
    if (outcome.pendingRecoveryPuzzle && outcome.puzzle) {
      return NextResponse.json({
        ...outcome,
        puzzle: {
          ...outcome.puzzle,
          imageUrl: await resolvePuzzleImageUrl(outcome.puzzle.imageUrl),
        },
      });
    }
    return NextResponse.json(outcome);
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.code === 'P2034') {
      return NextResponse.json({ error: 'Game result conflicted. Please retry.' }, { status: 409 });
    }
    if (error instanceof PuzzleImageStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Game submit error:', error);
    return NextResponse.json({ error: 'Failed to submit game result' }, { status: 500 });
  }
}
