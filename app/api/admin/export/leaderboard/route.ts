import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTeamLifelines } from '@/lib/lifelines';
import { getEventState } from '@/lib/event';

export const dynamic = 'force-dynamic';

function csvSafe(value: string) {
  const escaped = value.replace(/"/g, '""');
  return /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped;
}

export async function GET() {
  try {
    await requireAuth('admin');

    const eventState = await getEventState();

    const teams = await prisma.team.findMany({
      include: {
        members: true,
        team_games: { include: { game: true } },
      },
      orderBy: { login_id: 'asc' },
    });

    const rows = await Promise.all(
      teams.map(async (team, idx) => {
        const lifelines = await getTeamLifelines(team.id);
        const completed = team.team_games.filter(
          (tg) => tg.status === 'COMPLETED_NORMAL' || tg.status === 'COMPLETED_WITH_LIFELINE'
        ).length;
        const totalPoints = team.team_games.reduce(
          (sum, tg) => sum + ((tg as any).points || 0),
          0
        );
        const lifelineUsed = lifelines.remaining === 0;
        const completedAt = '';

        return {
          rank: idx + 1,
          name: team.name,
          loginId: team.login_id,
          active: team.active ? 'yes' : 'no',
          members: team.members.map((m) => m.name).join(' | '),
          lifelines: lifelines.remaining,
          completedGames: completed,
          totalPoints,
          lifelineUsed,
          completedAt,
        };
      })
    );

    // Sort by completed games desc, then lifelines desc
    rows.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.completedGames !== a.completedGames) return b.completedGames - a.completedGames;
      if (a.completedAt && b.completedAt) {
        return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
      }
      if (a.completedAt && !b.completedAt) return -1;
      if (!a.completedAt && b.completedAt) return 1;
      return a.name.localeCompare(b.name);
    });
    rows.forEach((r, i) => (r.rank = i + 1));

    const header = 'Rank,Team Name,Login ID,Active,Members,Lifelines Used,Games Completed,Final Points,Completion Time';
    const csvRows = rows.map(
      (r) =>
        `${r.rank},"${csvSafe(r.name)}",${csvSafe(r.loginId)},${r.active},"${csvSafe(r.members)}",${r.lifelineUsed ? 'yes' : 'no'},${r.completedGames},${r.totalPoints},"${r.completedAt}"`
    );
    const csv = [header, ...csvRows].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="roboverse-leaderboard-${Date.now()}.csv"`,
      },
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
