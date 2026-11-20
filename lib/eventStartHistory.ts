import { isPristineTeamScore, summarizeEventStartHistory } from './eventStartHistorySummary';
import { isPristineImportedTeamGame } from './games/teamGameAssignments';

export async function inspectEventStartHistory(client: any) {
  const [teamGames, gameSessions, lifelineEvents, teamScores, recoveryPuzzles, projectClueUnlocks] = await Promise.all([
    client.teamGame.findMany({
      select: {
        id: true, team_id: true, game_id: true, assignment_run_id: true, assigned_order: true,
        required: true, status: true, points: true, attempt_count: true, lifeline_used: true,
        started_at: true, completed_at: true, updated_by: true,
      },
    }),
    client.gameSession.count(),
    client.lifelineEvent.count(),
    client.teamScore.findMany({
      select: {
        total_points: true,
        completed_games: true,
        lifeline_used: true,
        completed_at: true,
      },
    }),
    client.recoveryPuzzle.count(),
    client.projectClueUnlock.count(),
  ]);
  const counts = {
    gameSessions,
    lifelineEvents,
    teamScores: teamScores.length,
    nonPristineTeamScores: teamScores.filter((score: any) => !isPristineTeamScore(score)).length,
    recoveryPuzzles,
    projectClueUnlocks,
  };
  return summarizeEventStartHistory(teamGames, counts, isPristineImportedTeamGame);
}
