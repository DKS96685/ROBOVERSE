import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getGameCatalogEntry } from '@/lib/config/gameCatalog';
import { hasValidEnabledSupportedGameCount, isValidRecoveryQuestion } from '@/lib/games/rules';
import { assertPuzzleImageStorageAvailable } from '@/lib/storage/puzzleImages';
import { inspectEventStartHistory } from '@/lib/eventStartHistory';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAuth('admin');

    const [teams, games, activeTeams, recoveryQuestions, event, history] = await Promise.all([
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
      prisma.eventState.findUnique({ where: { id: 'global' }, select: { status: true, started_at: true } }),
      inspectEventStartHistory(prisma),
    ]);

    const enabledGames = games.filter((game) => game.enabled);
    const enabledSupportedGames = enabledGames.filter((game) => getGameCatalogEntry(game.game_key));
    const gamesReady = games.map((g) => ({
      id: g.id,
      title: g.title,
      enabled: g.enabled,
      ready: Boolean(g.enabled && getGameCatalogEntry(g.game_key)),
      supported: Boolean(getGameCatalogEntry(g.game_key)),
    }));

    const missingProjects = activeTeams.filter((team) => !team.project_id).map((team) => team.name);
    const projectIds = Array.from(new Set(activeTeams.flatMap((team) => team.project_id ? [team.project_id] : [])));
    const enabledIds = enabledSupportedGames.map((game) => game.id);
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
    let puzzleStorageReady = false;
    try {
      await assertPuzzleImageStorageAvailable();
      puzzleStorageReady = true;
    } catch {
      puzzleStorageReady = false;
    }
    const canStart =
      (!event || (event.status === 'ready' && !event.started_at))
      && history.ready
      && teams >= 1
      && hasValidEnabledSupportedGameCount(enabledSupportedGames.length)
      && enabledSupportedGames.length === enabledGames.length
      && gamesReady.filter((game) => game.ready).length === enabledSupportedGames.length
      && missingProjects.length === 0
      && missingHints.length === 0
      && recoveryQuestionsReady
      && puzzleStorageReady;

    return NextResponse.json({
      teamsCount: teams,
      eventStatus: event?.status || 'ready',
      history,
      blockingReasons: [
        ...(!event || (event.status === 'ready' && !event.started_at) ? [] : [`Event status is ${event?.status}; start requires READY.`]),
        ...history.blockingReasons,
        ...(teams < 1 ? ['At least one active team is required.'] : []),
        ...(!hasValidEnabledSupportedGameCount(enabledSupportedGames.length) ? ['Enable between three and ten supported games.'] : []),
        ...(enabledSupportedGames.length !== enabledGames.length ? ['An enabled game is unsupported.'] : []),
        ...missingProjects.map((name) => `Team ${name} needs an assigned project.`),
        ...missingHints.map((name) => `Project for ${name} is missing a clue for an enabled game.`),
        ...(!recoveryQuestionsReady ? ['A valid recovery question is required.'] : []),
        ...(!puzzleStorageReady ? ['Private puzzle storage is unavailable.'] : []),
      ],
      gamesReady,
      canStart,
      enabledGamesCount: enabledSupportedGames.length,
      requiredEnabledGames: { min: 3, max: 10 },
      missingProjects,
      missingHints,
      recoveryQuestionsReady,
      puzzleStorageReady,
      puzzleStorageMessage: puzzleStorageReady
        ? null
        : 'Private puzzle storage is not configured or its bucket is unavailable.',
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to run preflight check' }, { status: 500 });
  }
}
