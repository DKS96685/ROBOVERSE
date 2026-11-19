import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getEventState } from '@/lib/event';
import { getTeamLifelines } from '@/lib/lifelines';

export const dynamic = 'force-dynamic';

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
      where: { team_id: teamId },
      include: { game: true },
    });

    const gamesData = teamGames
      .filter((teamGame) => teamGame.game.enabled)
      .map((teamGame) => {
        const game = teamGame.game;
        const isLegacyRevealed =
          teamGame.status === 'completed' || teamGame.status === 'skipped';
        const isP0Revealed =
          teamGame.status === 'COMPLETED_NORMAL'
          || teamGame.status === 'COMPLETED_WITH_LIFELINE'
          || teamGame.status === 'SKIPPED_AFTER_RECOVERY';

        return {
          id: game.id,
          gameKey: game.game_key,
          title: game.title,
          orderNum: (teamGame as any).assigned_order || game.order_num,
          minSeconds: game.min_seconds,
          status: teamGame.status,
          points: (teamGame as any).points || 0,
          attemptCount: (teamGame as any).attempt_count || 0,
          lifelineUsed: (teamGame as any).lifeline_used || false,
          clue: isLegacyRevealed || isP0Revealed ? game.clue_text : null,
          projectHint: null,
          puzzle: null,
        };
      });

    const teamScore = {
      totalPoints: teamGames.reduce(
        (sum, teamGame) => sum + ((teamGame as any).points || 0),
        0
      ),
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
    console.error('Team dashboard error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team dashboard' },
      { status: 500 }
    );
  }
}
