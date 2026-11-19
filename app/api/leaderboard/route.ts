import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getEventState } from '@/lib/event';
import { getTeamLifelines } from '@/lib/lifelines';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAuth('admin');
    const eventState = await getEventState();

    const teams = await prisma.team.findMany({
      where: { active: true },
      include: {
        team_games: true,
        team_score: true,
      },
    });

    const teamsWithStats = await Promise.all(
      teams.map(async (team) => {
        const lifelines = await getTeamLifelines(team.id);
        const completedGames = team.team_games.filter(
          (tg) =>
            tg.status === 'COMPLETED_NORMAL' ||
            tg.status === 'COMPLETED_WITH_LIFELINE'
        ).length;
        const totalPoints = team.team_games.reduce(
          (sum, tg) => sum + ((tg as any).points || 0),
          0
        );
        const lifelineUsed = lifelines.remaining === 0;

        return {
          id: team.id,
          name: team.name,
          loginId: team.login_id,
          completedGames,
          totalPoints,
          lifelineUsed,
          completedAt: team.team_score?.completed_at || null,
          lifelinesRemaining: lifelines.remaining,
          isEliminated: false,
        };
      })
    );

    // Sort criteria:
    // 1. Eliminated teams go to the bottom (or sorted among themselves)
    // 2. Games completed DESC
    // 3. Lifelines remaining DESC
    teamsWithStats.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.completedGames !== a.completedGames) {
        return b.completedGames - a.completedGames;
      }
      if (a.completedAt && b.completedAt) {
        return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
      }
      if (a.completedAt && !b.completedAt) return -1;
      if (!a.completedAt && b.completedAt) return 1;
      return a.name.localeCompare(b.name);
    });

    const rankedTeams = teamsWithStats.map((team, index) => ({
      rank: index + 1,
      ...team,
    }));

    return NextResponse.json({
      eventState,
      leaderboard: rankedTeams,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Leaderboard fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}
