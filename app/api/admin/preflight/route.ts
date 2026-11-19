import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAuth('admin');

    const [teams, games, activeTeams] = await Promise.all([
      prisma.team.count({ where: { active: true } }),
      prisma.game.findMany({ orderBy: { order_num: 'asc' } }),
      prisma.team.findMany({
        where: { active: true },
        select: { id: true, name: true, project_id: true },
      }),
    ]);

    const enabledGames = games.filter((game) => game.enabled);
    const gamesReady = games.map((g) => ({
      id: g.id,
      title: g.title,
      ready: Boolean(g.enabled),
    }));

    const missingProjects = activeTeams.filter((team) => !team.project_id).map((team) => team.name);
    let missingHints: string[] = [];
    if (activeTeams.length > 0) {
      const enabledIds = enabledGames.map((game) => game.id);
      for (const team of activeTeams) {
        if (!team.project_id) continue;
        const hintCount = await prisma.projectHint.count({
          where: {
            project_id: team.project_id,
            game_id: { in: enabledIds },
            clue_text: { not: '' },
          },
        });
        if (hintCount !== enabledIds.length) missingHints.push(team.name);
      }
    }
    const canStart =
      teams >= 1
      && enabledGames.length >= 3
      && gamesReady.filter((game) => game.ready).length >= 3
      && missingProjects.length === 0
      && missingHints.length === 0;

    return NextResponse.json({
      teamsCount: teams,
      gamesReady,
      canStart,
      missingProjects,
      missingHints,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to run preflight check' }, { status: 500 });
  }
}
