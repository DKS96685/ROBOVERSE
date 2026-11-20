export function isPristineTeamScore(score: any) {
  return score.total_points === 0
    && score.completed_games === 0
    && score.lifeline_used === false
    && score.completed_at === null;
}

export function summarizeEventStartHistory(
  teamGames: any[],
  counts: { gameSessions: number; lifelineEvents: number; teamScores: number; nonPristineTeamScores: number; recoveryPuzzles: number; projectClueUnlocks: number },
  isPristineImportedTeamGame: (record: any) => boolean
) {
  const nonPristine = teamGames.filter((row) => !isPristineImportedTeamGame(row));
  const seenPairs = new Set<string>();
  const duplicateTeamGamePairs: { teamId: string; gameId: string }[] = [];
  for (const row of teamGames) {
    const key = JSON.stringify([row.team_id, row.game_id]);
    if (seenPairs.has(key)) duplicateTeamGamePairs.push({ teamId: row.team_id, gameId: row.game_id });
    seenPairs.add(key);
  }
  const blockingReasons: string[] = [];
  if (nonPristine.length) blockingReasons.push(`${nonPristine.length} non-pristine TeamGame assignment(s) exist.`);
  if (duplicateTeamGamePairs.length) blockingReasons.push(`${duplicateTeamGamePairs.length} duplicate team/game assignment pair(s) exist.`);
  for (const [label, count] of Object.entries(counts)) {
    if (label === 'teamScores' || label === 'nonPristineTeamScores') continue;
    if (count) blockingReasons.push(`${count} ${label} record(s) exist.`);
  }
  if (counts.nonPristineTeamScores) {
    blockingReasons.push(`${counts.nonPristineTeamScores} non-pristine TeamScore record(s) exist.`);
  }
  return {
    ready: blockingReasons.length === 0,
    teamGameCount: teamGames.length,
    pristineTeamGameCount: teamGames.length - nonPristine.length,
    nonPristineTeamGames: nonPristine.map((row) => ({ teamId: row.team_id, gameId: row.game_id })),
    duplicateTeamGamePairs,
    counts,
    blockingReasons,
  };
}
