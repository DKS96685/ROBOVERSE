import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getGameCatalogEntry } from '@/lib/config/gameCatalog';
import { isValidRecoveryQuestion } from '@/lib/games/rules';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAuth('admin');

    const [teams, games, activeTeams, recoveryQuestions] = await Promise.all([
      prisma.team.count({ where: { active: true } }),
      prisma.game.findMany({ orderBy: { order_num: 'asc' } }),
      prisma.team.findMany({
        where: { active: true },
        select: { id: true, name: true, project_id: true },
      }),
      prisma.componentQuestion.findMany({
        where: { enabled: true },
        select: {
          question_text: true,
          image_url: true,
          correct_answer: true,
          options: { select: { option_text: true } },
        },
      }),
    ]);

    const enabledGames = games.filter((game) => game.enabled);
    const gamesReady = games.map((g) => ({
      id: g.id,
      title: g.title,
      enabled: g.enabled,
      ready: Boolean(g.enabled && getGameCatalogEntry(g.game_key)),
      supported: Boolean(getGameCatalogEntry(g.game_key)),
    }));

    const missingProjects = activeTeams.filter((team) => !team.project_id).map((team) => team.name);
    const projectIds = Array.from(new Set(activeTeams.flatMap((team) => team.project_id ? [team.project_id] : [])));
    const enabledIds = enabledGames.map((game) => game.id);
    const projectHints = projectIds.length > 0 && enabledIds.length > 0
      ? await prisma.projectHint.findMany({
          where: {
            project_id: { in: projectIds },
            game_id: { in: enabledIds },
            clue_text: { not: '' },
          },
          select: { project_id: true, game_id: true, clue_text: true },
        })
      : [];
    const hintsByProject = new Map<string, Set<string>>();
    for (const hint of projectHints) {
      if (!hint.clue_text.trim()) continue;
      const hints = hintsByProject.get(hint.project_id) || new Set<string>();
      hints.add(hint.game_id);
      hintsByProject.set(hint.project_id, hints);
    }
    const projectsMissingHints = new Set(
      projectIds.filter((projectId) => (hintsByProject.get(projectId)?.size || 0) !== enabledIds.length)
    );
    const missingHints = activeTeams
      .filter((team) => team.project_id && projectsMissingHints.has(team.project_id))
      .map((team) => team.name);
    const recoveryQuestionsReady = recoveryQuestions.some((question) =>
      isValidRecoveryQuestion({
        questionText: question.question_text,
        imageUrl: question.image_url,
        correctAnswer: question.correct_answer,
        options: question.options.map((option) => ({ optionText: option.option_text })),
      })
    );
    const canStart =
      teams >= 1
      && enabledGames.length >= 6
      && enabledGames.length <= 10
      && gamesReady.filter((game) => game.ready).length === enabledGames.length
      && missingProjects.length === 0
      && missingHints.length === 0
      && recoveryQuestionsReady;

    return NextResponse.json({
      teamsCount: teams,
      gamesReady,
      canStart,
      enabledGamesCount: enabledGames.length,
      requiredEnabledGames: { min: 6, max: 10 },
      missingProjects,
      missingHints,
      recoveryQuestionsReady,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to run preflight check' }, { status: 500 });
  }
}
