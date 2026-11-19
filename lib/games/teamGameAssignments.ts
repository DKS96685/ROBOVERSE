export type ExistingTeamGameAssignment = {
  id: string;
  team_id: string;
  game_id: string;
  assignment_run_id: string | null;
  assigned_order: number;
  required: boolean;
  status: string;
  points: number;
  attempt_count: number;
  lifeline_used: boolean;
  started_at: Date | null;
  completed_at: Date | null;
  updated_by: string;
};

type AssignmentTeam = { id: string };
type AssignmentGame = { id: string };

export type TeamGameAssignmentData = {
  team_id: string;
  game_id: string;
  assignment_run_id: string;
  assigned_order: number;
  required: true;
  status: 'NOT_STARTED';
  updated_by: 'system_allocation';
};

export type TeamGameAssignmentPlan = {
  updates: { id: string; data: TeamGameAssignmentData }[];
  creates: TeamGameAssignmentData[];
};

export function isPristineImportedTeamGame(record: ExistingTeamGameAssignment): boolean {
  return record.assignment_run_id === null
    && record.assigned_order === 0
    && record.required === false
    && (record.status === 'available' || record.status === 'locked')
    && record.points === 0
    && record.attempt_count === 0
    && record.lifeline_used === false
    && record.started_at === null
    && record.completed_at === null
    && record.updated_by === 'system';
}

export function buildTeamGameAssignmentPlan<Team extends AssignmentTeam, Game extends AssignmentGame>(
  teams: Team[],
  selectedGamesByTeam: Map<string, Game[]>,
  enabledGameIds: ReadonlySet<string>,
  existingRecords: ExistingTeamGameAssignment[],
  assignmentRunId: string
): TeamGameAssignmentPlan {
  if (existingRecords.some((record) => !isPristineImportedTeamGame(record))) {
    throw new Error('NON_PRISTINE_TEAM_GAME');
  }

  const existingByPair = new Map<string, ExistingTeamGameAssignment>();
  for (const record of existingRecords) {
    const pair = JSON.stringify([record.team_id, record.game_id]);
    if (existingByPair.has(pair)) throw new Error('DUPLICATE_TEAM_GAME_PAIR');
    existingByPair.set(pair, record);
  }

  const plan: TeamGameAssignmentPlan = { updates: [], creates: [] };

  for (const team of teams) {
    const selected = selectedGamesByTeam.get(team.id) || [];
    if (selected.length !== 3 || new Set(selected.map((game) => game.id)).size !== 3) {
      throw new Error('INVALID_TEAM_GAME_SELECTION');
    }
    if (selected.some((game) => !enabledGameIds.has(game.id))) {
      throw new Error('SELECTED_GAME_NOT_ENABLED');
    }

    for (let index = 0; index < selected.length; index++) {
      const game = selected[index];
      const data: TeamGameAssignmentData = {
        team_id: team.id,
        game_id: game.id,
        assignment_run_id: assignmentRunId,
        assigned_order: index + 1,
        required: true,
        status: 'NOT_STARTED',
        updated_by: 'system_allocation',
      };
      const existing = existingByPair.get(JSON.stringify([team.id, game.id]));
      if (existing) plan.updates.push({ id: existing.id, data });
      else plan.creates.push(data);
    }
  }

  return plan;
}
