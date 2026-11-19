import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getEventState } from '@/lib/event';
import { getTeamLifelines } from '@/lib/lifelines';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth('admin');

    const eventState = await getEventState();

    const teams = await prisma.team.findMany({
      include: {
        members: true,
        project: {
          select: { id: true, name: true },
        },
        team_games: {
          include: { game: true },
        },
      },
      orderBy: { login_id: 'asc' },
    });

    const teamsData = await Promise.all(
      teams.map(async (team) => {
        const lifelines = await getTeamLifelines(team.id);
        const completedGamesCount = team.team_games.filter(
          (tg) => tg.status === 'COMPLETED_NORMAL' || tg.status === 'COMPLETED_WITH_LIFELINE'
        ).length;
        const totalPoints = team.team_games.reduce(
          (sum, tg) => sum + ((tg as any).points || 0),
          0
        );

        // Find last activity
        const lastSession = await prisma.gameSession.findFirst({
          where: { team_id: team.id },
          orderBy: { started_at: 'desc' },
        });

        const lastLifeline = await prisma.lifelineEvent.findFirst({
          where: { team_id: team.id },
          orderBy: { created_at: 'desc' },
        });

        const lastActivity = lastSession?.started_at || lastLifeline?.created_at || team.created_at;

        return {
          id: team.id,
          name: team.name,
          loginId: team.login_id,
          active: team.active,
          members: team.members.map((m) => m.name),
          projectId: team.project_id,
          projectName: team.project?.name || null,
          lifelines,
          completedGamesCount,
          teamScore: {
            totalPoints,
            lifelineUsed: lifelines.remaining === 0,
            completedAt: null,
          },
          games: team.team_games.map((tg) => ({
            id: tg.game_id,
            gameKey: tg.game.game_key,
            title: tg.game.title,
            status: tg.status,
          })),
          lastActivity: lastActivity.toISOString(),
        };
      })
    );

    return NextResponse.json({
      admin: { name: session.name, email: session.email },
      eventState,
      teams: teamsData,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Admin overview error:', error);
    return NextResponse.json({ error: 'Failed to fetch admin overview' }, { status: 500 });
  }
}
