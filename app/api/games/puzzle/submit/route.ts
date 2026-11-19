import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isRecoveryAnswerCorrect } from '@/lib/games/rules';

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('team');
    const body = await req.json();
    const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : null;
    const selectedAnswer = typeof body.answer === 'string' ? body.answer.trim() : '';

    if (!puzzleId || !selectedAnswer) {
      return NextResponse.json({ error: 'Puzzle and answer are required.' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.eventState.findUnique({ where: { id: 'global' } });
      if (event?.status !== 'running') {
        return { error: 'Event is not running.', status: 400 };
      }

      const puzzle = await tx.recoveryPuzzle.findUnique({
        where: { id: puzzleId },
        include: {
          question: { include: { options: true } },
          team_game: true,
        },
      });
      if (!puzzle || puzzle.team_id !== session.teamId) {
        return { error: 'Recovery puzzle not found or belongs to another team.', status: 404 };
      }
      if (puzzle.status !== 'PENDING') {
        return { error: 'Recovery puzzle is already completed.', status: 409 };
      }
      if (puzzle.team_game.status !== 'PENDING_RECOVERY_PUZZLE') {
        return { error: 'Recovery puzzle is not eligible.', status: 409 };
      }
      if (!puzzle.question.options.some((option) => option.option_text === selectedAnswer)) {
        return { error: 'Select one of the listed answer choices.', status: 400 };
      }

      const isCorrect = isRecoveryAnswerCorrect(puzzle.question.correct_answer, selectedAnswer);
      let clue: string | null = null;
      let projectId: string | null = null;
      if (isCorrect) {
        const team = await tx.team.findUnique({
          where: { id: session.teamId! },
          select: { project_id: true },
        });
        projectId = team?.project_id || null;
        if (!projectId) {
          return { error: 'The team has no assigned project. Contact an administrator.', status: 409 };
        }

        const hint = await tx.projectHint.findUnique({
          where: {
            project_id_game_id: {
              project_id: projectId,
              game_id: puzzle.team_game.game_id,
            },
          },
          select: { clue_text: true },
        });
        if (!hint?.clue_text.trim()) {
          return { error: 'The recovery clue is unavailable. Contact an administrator.', status: 409 };
        }
        clue = hint.clue_text;
      }

      await tx.recoveryPuzzleAttempt.create({
        data: {
          puzzle_id: puzzle.id,
          team_id: session.teamId!,
          selected_answer: selectedAnswer,
          is_correct: isCorrect,
        },
      });

      if (!isCorrect) {
        return {
          success: false,
          correct: false,
          message: 'Incorrect answer. The clue remains locked.',
          puzzleStatus: 'PENDING',
        };
      }
      if (!projectId || !clue) {
        return { error: 'The recovery clue is unavailable. Contact an administrator.', status: 409 };
      }

      const puzzleClaim = await tx.recoveryPuzzle.updateMany({
        where: { id: puzzle.id, team_id: session.teamId!, status: 'PENDING' },
        data: { status: 'COMPLETED', completed_at: new Date() },
      });
      if (puzzleClaim.count !== 1) {
        return { error: 'Recovery puzzle has already been completed.', status: 409 };
      }

      await tx.teamGame.update({
        where: { id: puzzle.team_game_id },
        data: {
          status: 'SKIPPED_AFTER_RECOVERY',
          points: 0,
          completed_at: new Date(),
        },
      });

      await tx.projectClueUnlock.upsert({
        where: {
          team_id_project_id_game_id: {
            team_id: session.teamId!,
            project_id: projectId,
            game_id: puzzle.team_game.game_id,
          },
        },
        update: {},
        create: {
          team_id: session.teamId!,
          project_id: projectId,
          game_id: puzzle.team_game.game_id,
          team_game_id: puzzle.team_game_id,
          reason: 'RECOVERY_PUZZLE',
        },
      });

      await tx.auditLog.create({
        data: {
          actor: session.loginId || 'team',
          action: 'recovery_puzzle_completed',
          team_id: session.teamId!,
          after: JSON.stringify({
            puzzleId: puzzle.id,
            teamGameId: puzzle.team_game_id,
            gameId: puzzle.team_game.game_id,
            clueUnlocked: Boolean(clue),
          }),
        },
      });

      const teamGames = await tx.teamGame.findMany({
        where: { team_id: session.teamId!, required: true },
      });
      const completedGames = teamGames.filter((item: any) =>
        item.status === 'COMPLETED_NORMAL' || item.status === 'COMPLETED_WITH_LIFELINE'
      ).length;
      const totalPoints = teamGames.reduce((sum: number, item: any) => sum + item.points, 0);
      const allTerminal = teamGames.length === 3 && teamGames.every((item: any) =>
        ['COMPLETED_NORMAL', 'COMPLETED_WITH_LIFELINE', 'SKIPPED_AFTER_RECOVERY', 'SKIPPED_WITHOUT_LIFELINE'].includes(item.status)
      );

      await tx.teamScore.upsert({
        where: { team_id: session.teamId! },
        update: {
          total_points: totalPoints,
          completed_games: completedGames,
          lifeline_used: teamGames.some((item: any) => item.lifeline_used),
          completed_at: allTerminal ? new Date() : null,
        },
        create: {
          team_id: session.teamId!,
          total_points: totalPoints,
          completed_games: completedGames,
          lifeline_used: teamGames.some((item: any) => item.lifeline_used),
          completed_at: allTerminal ? new Date() : null,
        },
      });

      return {
        success: true,
        correct: true,
        puzzleStatus: 'COMPLETED',
        clue,
      };
    }, { isolationLevel: 'Serializable' });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.code === 'P2034') {
      return NextResponse.json({ error: 'Puzzle submission conflicted. Retry.' }, { status: 409 });
    }
    console.error('Recovery puzzle submit error:', error);
    return NextResponse.json({ error: 'Failed to submit recovery puzzle' }, { status: 500 });
  }
}
