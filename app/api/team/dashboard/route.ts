import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getEventState } from '@/lib/event';
import { getTeamLifelines } from '@/lib/lifelines';
import { PuzzleImageStorageError, resolvePuzzleImageUrl } from '@/lib/storage/puzzleImages';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await requireAuth('team');
    const teamId = session.teamId!;

    // 1. Fetch team and its members
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: true,
        project: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    if (!team || !team.active) {
      return NextResponse.json(
        { error: 'Team not found or inactive' },
        { status: 403 }
      );
    }

    // 2. Event clock state
    const eventState = await getEventState();

    // 3. Lifeline summary
    const lifelines = await getTeamLifelines(teamId);

    // 4. Games & clues status
    const teamGames = await prisma.teamGame.findMany({
      where: { team_id: teamId, required: true },
      include: { game: true },
      orderBy: { assigned_order: 'asc' },
    });

    const teamGameIds = teamGames.map((teamGame) => teamGame.id);
    const unlocks = team.project_id && teamGameIds.length > 0
      ? await prisma.projectClueUnlock.findMany({
          where: {
            team_id: teamId,
            project_id: team.project_id,
            team_game_id: { in: teamGameIds },
          },
          select: { game_id: true },
        })
      : [];
    const unlockedGameIds = unlocks.map((unlock) => unlock.game_id);
    const projectHints = team.project_id && unlockedGameIds.length > 0
      ? await prisma.projectHint.findMany({
          where: {
            project_id: team.project_id,
            game_id: { in: unlockedGameIds },
          },
          select: { game_id: true, clue_text: true },
        })
      : [];
    const clueByGameId = new Map(projectHints.map((hint) => [hint.game_id, hint.clue_text]));

    const pendingPuzzles = teamGameIds.length > 0
      ? await prisma.recoveryPuzzle.findMany({
          where: {
            team_id: teamId,
            team_game_id: { in: teamGameIds },
            status: 'PENDING',
          },
          include: {
            question: {
              include: {
                options: { orderBy: { sort_order: 'asc' } },
              },
            },
          },
        })
      : [];
    const puzzleEntries = await Promise.all(pendingPuzzles.map(async (puzzle) => [
        puzzle.team_game_id,
        {
          id: puzzle.id,
          questionText: puzzle.question.question_text,
          imageUrl: await resolvePuzzleImageUrl(puzzle.question.image_url),
          options: puzzle.question.options.map((option) => ({
            id: option.id,
            text: option.option_text,
          })),
        },
      ] as const));
    const puzzleByTeamGameId = new Map(puzzleEntries);

    const gamesData = teamGames.map((teamGame) => ({
      id: teamGame.game.id,
      gameKey: teamGame.game.game_key,
      title: teamGame.game.title,
      orderNum: teamGame.assigned_order,
      minSeconds: teamGame.game.min_seconds,
      status: teamGame.status,
      points: teamGame.points,
      attemptCount: teamGame.attempt_count,
      lifelineUsed: teamGame.lifeline_used,
      clue: clueByGameId.get(teamGame.game_id) || null,
      projectHint: null,
      puzzle: puzzleByTeamGameId.get(teamGame.id) || null,
    }));

    const teamScore = {
      totalPoints: teamGames.reduce((sum, teamGame) => sum + teamGame.points, 0),
      completedGames: teamGames.filter((teamGame) =>
        teamGame.status === 'COMPLETED_NORMAL'
        || teamGame.status === 'COMPLETED_WITH_LIFELINE'
      ).length,
      lifelineUsed: lifelines.remaining === 0,
      completedAt: null,
    };

    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
        loginId: team.login_id,
        members: team.members.map((m) => m.name),
      },
      project: team.project
        ? { name: team.project.name, description: team.project.description }
        : null,
      eventState,
      lifelines,
      games: gamesData,
      teamScore,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof PuzzleImageStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Team dashboard error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team dashboard' },
      { status: 500 }
    );
  }
}
