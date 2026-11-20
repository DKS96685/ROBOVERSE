import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_CATALOG } from '../lib/config/gameCatalog.ts';
import {
  createInitialGameState,
  advancePong,
  advanceSnake,
  flipMemoryCard,
  getPublicGameState,
  matchesTargetSequence,
  moveInQuickMaze,
  parseStoredMemoryGameState,
  resetMemoryMismatch,
  toggleLightsOutCell,
} from '../lib/games/state.ts';
import {
  getGameCompletionPoints,
  getFailedAttemptDisposition,
  getProgressRequestDisposition,
  hasValidEnabledSupportedGameCount,
  isNextProgressActionSequence,
  isRecoveryAnswerCorrect,
  isValidRecoveryQuestion,
  selectGamesForTeam,
} from '../lib/games/rules.ts';
import {
  buildTeamGameAssignmentPlan,
  isPristineImportedTeamGame,
} from '../lib/games/teamGameAssignments.ts';
import { deleteTeamForAdmin, TEAM_DELETE_TRANSACTION_OPTIONS } from '../lib/teamDeletion.ts';
import { safeErrorDetails } from '../lib/safeErrorDetails.ts';
import sharp from 'sharp';
import {
  getPuzzleImageExtension,
  getValidatedPuzzleImageExtension,
} from '../lib/storage/imageValidation.ts';
import { runOnce } from '../lib/games/callbacks.ts';
import { nextTeamLoginId, reserveTeamLoginIds } from '../lib/teams/loginIds.ts';
import { toEventStateView } from '../lib/eventStateView.ts';
import { isPristineTeamScore, summarizeEventStartHistory } from '../lib/eventStartHistorySummary.ts';
import { isPuzzleImageReference } from '../lib/storage/imageReference.ts';

test('event state remains administrator controlled regardless of elapsed wall time', () => {
  const view = toEventStateView({ status: 'running' });
  assert.equal(view.status, 'running');
  assert.equal(view.isRunning, true);
  assert.deepEqual(Object.keys(view).sort(), ['isEnded', 'isPaused', 'isRunning', 'status']);
  assert.equal(toEventStateView({ status: 'paused' }).isPaused, true);
  assert.equal(toEventStateView({ status: 'ended' }).isEnded, true);
});

test('team login IDs are allocated dynamically beyond 25 and fill gaps', () => {
  const existing = Array.from({ length: 30 }, (_, index) => `team${String(index + 1).padStart(2, '0')}`);
  assert.equal(nextTeamLoginId(existing), 'team31');
  assert.deepEqual(reserveTeamLoginIds(['TEAM01', 'team03'], 3), ['team02', 'team04', 'team05']);
});

test('shared event history summary blocks every history source and non-pristine assignment', () => {
  const pristine = makeImportedPlaceholder('team-a', 'game-a');
  const noHistory = { gameSessions: 0, lifelineEvents: 0, teamScores: 0, nonPristineTeamScores: 0, recoveryPuzzles: 0, projectClueUnlocks: 0 };
  assert.equal(summarizeEventStartHistory([pristine], noHistory, isPristineImportedTeamGame).ready, true);
  const blocked = summarizeEventStartHistory(
    [{ ...pristine, status: 'FIRST_ATTEMPT_FAILED' }],
    { ...noHistory, gameSessions: 1 },
    isPristineImportedTeamGame
  );
  assert.equal(blocked.ready, false);
  assert.equal(blocked.nonPristineTeamGames.length, 1);
  assert.equal(blocked.counts.gameSessions, 1);
  for (const guardedCount of ['gameSessions', 'lifelineEvents', 'nonPristineTeamScores', 'recoveryPuzzles', 'projectClueUnlocks']) {
    assert.equal(summarizeEventStartHistory([pristine], { ...noHistory, [guardedCount]: 1 }, isPristineImportedTeamGame).ready, false);
  }
  assert.equal(summarizeEventStartHistory([pristine, pristine], noHistory, isPristineImportedTeamGame).ready, false);
});

test('pristine TeamScore rows are reported but do not block event start', () => {
  const pristine = makeImportedPlaceholder('team-a', 'game-a');
  const pristineScores = Array.from({ length: 3 }, () => ({
    total_points: 0,
    completed_games: 0,
    lifeline_used: false,
    completed_at: null,
  }));
  assert.equal(isPristineTeamScore(pristineScores[0]), true);
  for (const scores of [[], pristineScores.slice(0, 1), pristineScores]) {
    const teamScores = scores.length;
    const summary = summarizeEventStartHistory(
      [pristine],
      {
        gameSessions: 0,
        lifelineEvents: 0,
        teamScores,
        nonPristineTeamScores: scores.filter((score) => !isPristineTeamScore(score)).length,
        recoveryPuzzles: 0,
        projectClueUnlocks: 0,
      },
      isPristineImportedTeamGame
    );
    assert.equal(summary.ready, true);
    assert.equal(summary.counts.teamScores, teamScores);
  }
});

test('each gameplay-bearing TeamScore condition blocks event start', () => {
  const pristine = makeImportedPlaceholder('team-a', 'game-a');
  const noHistory = { gameSessions: 0, lifelineEvents: 0, teamScores: 1, nonPristineTeamScores: 1, recoveryPuzzles: 0, projectClueUnlocks: 0 };
  for (const score of [
    { total_points: 0, completed_games: 1, lifeline_used: false, completed_at: null },
    { total_points: 1, completed_games: 0, lifeline_used: false, completed_at: null },
    { total_points: 0, completed_games: 0, lifeline_used: true, completed_at: null },
    { total_points: 0, completed_games: 0, lifeline_used: false, completed_at: new Date() },
  ]) {
    assert.equal(isPristineTeamScore(score), false);
    const nonPristineTeamScores = Number(!isPristineTeamScore(score));
    const summary = summarizeEventStartHistory(
      [pristine],
      { ...noHistory, nonPristineTeamScores },
      isPristineImportedTeamGame
    );
    assert.equal(summary.ready, false);
  }
});

test('pristine TeamScore does not hide session, lifeline, or non-pristine assignment history', () => {
  const pristine = makeImportedPlaceholder('team-a', 'game-a');
  const pristineScoreCounts = { gameSessions: 0, lifelineEvents: 0, teamScores: 1, nonPristineTeamScores: 0, recoveryPuzzles: 0, projectClueUnlocks: 0 };
  assert.equal(summarizeEventStartHistory([pristine], { ...pristineScoreCounts, gameSessions: 1 }, isPristineImportedTeamGame).ready, false);
  assert.equal(summarizeEventStartHistory([pristine], { ...pristineScoreCounts, lifelineEvents: 1 }, isPristineImportedTeamGame).ready, false);
  assert.equal(
    summarizeEventStartHistory([{ ...pristine, status: 'FIRST_ATTEMPT_FAILED' }], pristineScoreCounts, isPristineImportedTeamGame).ready,
    false
  );
});

test('stored puzzle image references can be resolved afresh while direct URLs are not treated as storage keys', () => {
  assert.equal(isPuzzleImageReference('neon-s3://roboverse-puzzle-images/component-questions/test.png'), true);
  assert.equal(isPuzzleImageReference('https://example.test/image.png'), false);
});

test('game completion callbacks run once when the same result is emitted repeatedly', () => {
  const guard = { current: false };
  let callbackCount = 0;
  assert.equal(runOnce(guard, () => { callbackCount += 1; }), true);
  assert.equal(runOnce(guard, () => { callbackCount += 1; }), false);
  assert.equal(callbackCount, 1);
});

test('a first failure leaves the lifeline available until a retry is explicitly taken', () => {
  const lifelinesRemaining = 1;
  assert.equal(getFailedAttemptDisposition(1, lifelinesRemaining), 'LIFELINE_RETRY_AVAILABLE');
  assert.equal(lifelinesRemaining, 1);
  assert.equal(getGameCompletionPoints(1), 10);
  assert.equal(getGameCompletionPoints(2), 5);
  assert.equal(getFailedAttemptDisposition(2, 0), 'RECOVERY_PUZZLE_REQUIRED');
});

test('progress protocol treats exact retries as idempotent and rejects stale or forged reuse', () => {
  assert.equal(
    getProgressRequestDisposition(['request-1'], { 'request-1': '4:{"type":"pongStep"}' }, 'request-1', '4:{"type":"pongStep"}'),
    'DUPLICATE'
  );
  assert.equal(
    getProgressRequestDisposition(['request-1'], { 'request-1': '4:{"type":"pongStep"}' }, 'request-1', '4:{"type":"pongStep","input":"up"}'),
    'REQUEST_ID_REUSED'
  );
  assert.equal(isNextProgressActionSequence(4, 5), true);
  assert.equal(isNextProgressActionSequence(4, 4), false);
  assert.equal(isNextProgressActionSequence(4, 6), false);
});

test('supported game catalog has six distinct playable entries', () => {
  const keys = GAME_CATALOG.map((game) => game.gameKey);
  assert.equal(keys.length, 6);
  assert.equal(new Set(keys).size, keys.length);
});

test('Lights Out move toggles the chosen cell and its orthogonal neighbors', () => {
  const initial = Array.from({ length: 9 }, () => false);
  const afterMove = toggleLightsOutCell(initial, 4);
  assert.deepEqual(afterMove, [false, true, false, true, true, true, false, true, false]);
  assert.deepEqual(toggleLightsOutCell(afterMove, 4), initial);
  assert.equal(toggleLightsOutCell(initial, 9), null);
});

test('Quick Maze rejects blocked moves and reaches the configured exit by a legal path', () => {
  let state = createInitialGameState('quick-maze');
  assert.ok(state && state.gameKey === 'quick-maze');
  assert.equal(moveInQuickMaze(state, 'up'), null);
  const path = ['right', 'down', 'right', 'right', 'right', 'right', 'down', 'down', 'down', 'down', 'down', 'right'];
  for (const direction of path) {
    const next = moveInQuickMaze(state, direction);
    assert.ok(next, `Expected ${direction} to be a legal move`);
    state = next;
  }
  assert.deepEqual([state.row, state.column], [state.exitRow, state.exitColumn]);
});

test('Target Sequence matches only an exact ordered answer', () => {
  assert.equal(matchesTargetSequence([0, 3, 1, 2, 0], [0, 3, 1, 2, 0]), true);
  assert.equal(matchesTargetSequence([0, 3, 1, 2, 0], [0, 1, 3, 2, 0]), false);
  assert.equal(matchesTargetSequence([0, 3, 1, 2, 0], [0, 3]), false);
});

test('generated Lights Out states are non-trivial and solvable', () => {
  const state = createInitialGameState('lights-out', (max) => max - 1);
  assert.ok(state && state.gameKey === 'lights-out');
  assert.equal(state.board.length, 9);
  assert.equal(state.board.every((cell) => !cell), false);
  const solved = toggleLightsOutCell(state.board, 4);
  assert.ok(solved);
  assert.equal(solved.every((cell) => !cell), true);
});

test('Snake server steps collect food, reject reverse input, and verify collisions', () => {
  const initial = createInitialGameState('snake', () => 0);
  assert.ok(initial && initial.gameKey === 'snake');
  const next = advanceSnake({
    ...initial,
    food: { x: 11, y: 10 },
  }, 'right', () => 0);
  assert.equal(next.accepted, true);
  assert.equal(next.collected, true);
  assert.equal(next.state.foodCollected, 1);
  assert.deepEqual(next.state.snake[0], { x: 11, y: 10 });
  assert.equal(advanceSnake(next.state, 'left', () => 0).accepted, false);

  const collision = advanceSnake({
    ...initial,
    snake: [{ x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17, y: 10 }],
    food: { x: 0, y: 0 },
  }, 'right', () => 0);
  assert.equal(collision.failed, true);
});

test('Pong awards only server-simulated points and detects a terminal loss', () => {
  const initial = createInitialGameState('pong');
  assert.ok(initial && initial.gameKey === 'pong');
  const scored = advancePong({
    ...initial,
    ballX: 438,
    ballY: 250,
    ballSpeedX: 5,
    ballSpeedY: 0,
    aiY: 0,
  }, 'stay');
  assert.equal(scored.state.playerScore, 1);
  assert.equal(scored.playerScored, true);

  const lost = advancePong({
    ...initial,
    aiScore: 2,
    ballX: 7,
    ballY: 10,
    ballSpeedX: -5,
    ballSpeedY: 0,
  }, 'stay');
  assert.equal(lost.failed, true);
  assert.equal(lost.state.failed, true);
});

test('Pong normal completion reaches the server target without a failure', () => {
  const initial = createInitialGameState('pong');
  assert.ok(initial && initial.gameKey === 'pong');
  const finalPoint = advancePong({
    ...initial,
    playerScore: 2,
    ballX: 438,
    ballY: 250,
    ballSpeedX: 5,
    ballSpeedY: 0,
    aiY: 0,
  }, 'stay');
  assert.equal(finalPoint.state.playerScore, finalPoint.state.target);
  assert.equal(finalPoint.failed, false);
  assert.equal(finalPoint.state.failed, false);
});

test('Memory owns its deck, validates selection order, and resets mismatches', () => {
  const initial = createInitialGameState('memory', (max) => max - 1);
  assert.ok(initial && initial.gameKey === 'memory');
  assert.equal(parseStoredMemoryGameState(initial)?.deck.length, 6);
  const publicState = getPublicGameState(initial);
  assert.ok(publicState && publicState.gameKey === 'memory');
  assert.equal('deck' in publicState, false);
  assert.deepEqual(publicState.revealedCards, []);

  const first = flipMemoryCard(initial, 0);
  assert.ok(first);
  assert.equal(flipMemoryCard(first.state, 0), null);
  const differentIndex = initial.deck.findIndex((symbol, index) => index > 0 && symbol !== initial.deck[0]);
  const mismatch = flipMemoryCard(first.state, differentIndex);
  assert.ok(mismatch);
  assert.equal(mismatch.matched, false);
  assert.deepEqual(resetMemoryMismatch(mismatch.state)?.selection, []);

  const matchingIndex = initial.deck.findIndex((symbol, index) => index > 0 && symbol === initial.deck[0]);
  const matched = flipMemoryCard(first.state, matchingIndex);
  assert.ok(matched);
  assert.equal(matched.matched, true);
  assert.equal(matched.state.matchedIndices.length, 2);
});

test('competition helpers cover points, puzzle validation, duplicate actions, and allocation', () => {
  assert.equal(getGameCompletionPoints(1), 10);
  assert.equal(getGameCompletionPoints(2), 5);
  assert.equal(getFailedAttemptDisposition(1, 1), 'LIFELINE_RETRY_AVAILABLE');
  assert.equal(getFailedAttemptDisposition(1, 0), 'RECOVERY_PUZZLE_REQUIRED');
  assert.equal(getFailedAttemptDisposition(2, 1), 'RECOVERY_PUZZLE_REQUIRED');
  assert.equal(getFailedAttemptDisposition(2, 0), 'RECOVERY_PUZZLE_REQUIRED');
  assert.equal(isRecoveryAnswerCorrect('Arduino Uno', 'Arduino Uno'), true);
  assert.equal(isRecoveryAnswerCorrect('Arduino Uno', 'ESP32'), false);
  assert.equal(isValidRecoveryQuestion({
    questionText: 'Which board is shown?',
    imageUrl: '/puzzle.jpg',
    correctAnswer: 'Arduino Uno',
    options: [{ optionText: 'Arduino Uno' }, { optionText: 'ESP32' }],
  }), true);
  assert.equal(isValidRecoveryQuestion({
    questionText: 'Identify the board',
    imageUrl: '/puzzle.jpg',
    correctAnswer: 'missing',
    options: [{ optionText: 'Arduino Uno' }, { optionText: 'ESP32' }],
  }), false);
  assert.equal(getProgressRequestDisposition(['request-1'], {}, 'request-1', 'a'), 'DUPLICATE');
  assert.equal(
    getProgressRequestDisposition(['request-1'], { 'request-1': 'a' }, 'request-1', 'b'),
    'REQUEST_ID_REUSED'
  );
  assert.equal(getProgressRequestDisposition(['request-1'], {}, 'request-2', 'b'), 'NEW');
  assert.equal(isNextProgressActionSequence(4, 5), true);
  assert.equal(isNextProgressActionSequence(4, 4), false);
  assert.equal(isNextProgressActionSequence(4, 6), false);
  assert.equal(isNextProgressActionSequence(4, Number.NaN), false);

  let seed = 41;
  const randomIndex = (max) => {
    seed = (seed * 48271) % 2147483647;
    return seed % max;
  };
  const games = Array.from({ length: 6 }, (_, index) => ({ id: `game-${index}` }));
  const counts = new Map(games.map((game) => [game.id, 0]));
  const combinations = new Set();
  for (let team = 0; team < 6; team++) {
    const assigned = selectGamesForTeam(games, counts, combinations, randomIndex);
    assert.equal(assigned.length, 3);
    assert.equal(new Set(assigned.map((game) => game.id)).size, 3);
  }
  assert.equal(Array.from(counts.values()).reduce((sum, count) => sum + count, 0), 18);
  assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1);
});

test('event accepts 3, 4, 5, 6, and 10 enabled supported games and rejects fewer than 3', () => {
  for (const count of [3, 4, 5, 6, 10]) {
    assert.equal(hasValidEnabledSupportedGameCount(count), true, `${count} enabled games should be accepted`);
  }
  for (const count of [0, 1, 2]) {
    assert.equal(hasValidEnabledSupportedGameCount(count), false, `${count} enabled games should be rejected`);
  }
  assert.equal(hasValidEnabledSupportedGameCount(11), false);
});

test('each team receives exactly three distinct games from the enabled game set for each supported count', () => {
  for (const count of [3, 4, 5, 6, 10]) {
    const gameLibrary = [
      ...Array.from({ length: count }, (_, index) => ({ id: `enabled-${index}`, enabled: true, supported: true })),
      { id: 'disabled-game', enabled: false, supported: true },
      { id: 'unsupported-game', enabled: true, supported: false },
    ];
    const eligibleGames = gameLibrary.filter((game) => game.enabled && game.supported);
    const assignmentCounts = new Map(eligibleGames.map((game) => [game.id, 0]));
    const combinations = new Set();

    for (let teamIndex = 0; teamIndex < 5; teamIndex++) {
      const assigned = selectGamesForTeam(
        eligibleGames,
        assignmentCounts,
        combinations,
        (max) => (teamIndex + max - 1) % max
      );
      const assignedIds = assigned.map((game) => game.id);
      assert.equal(assigned.length, 3, `${count} games: team should receive three games`);
      assert.equal(new Set(assignedIds).size, 3, `${count} games: team games should be distinct`);
      assert.ok(assignedIds.every((id) => eligibleGames.some((game) => game.id === id)));
      assert.ok(assignedIds.every((id) => id !== 'disabled-game' && id !== 'unsupported-game'));
    }
  }
});

const makeImportedPlaceholder = (teamId, gameId, id = `${teamId}-${gameId}`) => ({
  id,
  team_id: teamId,
  game_id: gameId,
  assignment_run_id: null,
  assigned_order: 0,
  required: false,
  status: gameId.endsWith('0') ? 'available' : 'locked',
  points: 0,
  attempt_count: 0,
  lifeline_used: false,
  started_at: null,
  completed_at: null,
  updated_by: 'system',
});

test('event allocation reuses pristine imported placeholders without duplicate team-game rows', () => {
  const teams = [{ id: 'team-1' }, { id: 'team-2' }];
  const games = Array.from({ length: 6 }, (_, index) => ({ id: `game-${index}` }));
  const placeholders = teams.flatMap((team) => games.map((game) => makeImportedPlaceholder(team.id, game.id)));
  const counts = new Map(games.map((game) => [game.id, 0]));
  const combinations = new Set();
  const selectedGamesByTeam = new Map(teams.map((team) => [
    team.id,
    selectGamesForTeam(games, counts, combinations, () => 0),
  ]));
  const enabledGameIds = new Set(games.map((game) => game.id));
  const plan = buildTeamGameAssignmentPlan(teams, selectedGamesByTeam, enabledGameIds, placeholders, 'run-1');

  assert.equal(plan.updates.length, 6);
  assert.equal(plan.creates.length, 0);
  assert.equal(new Set(plan.updates.map(({ id }) => id)).size, 6);

  for (const team of teams) {
    const assigned = plan.updates.filter(({ data }) => data.team_id === team.id);
    assert.equal(assigned.length, 3);
    assert.equal(new Set(assigned.map(({ data }) => data.game_id)).size, 3);
    assert.ok(assigned.every(({ data }) => data.assignment_run_id === 'run-1' && data.required));
  }

  const existingPairs = new Set(placeholders.map((row) => JSON.stringify([row.team_id, row.game_id])));
  const plannedPairs = [...plan.updates, ...plan.creates].map(({ data }) => JSON.stringify([data.team_id, data.game_id]));
  assert.equal(new Set(plannedPairs).size, plannedPairs.length);
  assert.ok(plannedPairs.every((pair) => existingPairs.has(pair)));
});

test('event allocation rejects any non-pristine TeamGame record', () => {
  const teams = [{ id: 'team-1' }];
  const games = Array.from({ length: 6 }, (_, index) => ({ id: `game-${index}` }));
  const progressed = { ...makeImportedPlaceholder('team-1', 'game-0'), points: 1 };
  const priorAssignment = {
    ...makeImportedPlaceholder('team-1', 'game-1'),
    assignment_run_id: 'run-previous',
    assigned_order: 1,
    required: true,
    status: 'NOT_STARTED',
    updated_by: 'system_allocation',
  };

  assert.equal(isPristineImportedTeamGame(makeImportedPlaceholder('team-1', 'game-0')), true);
  assert.equal(isPristineImportedTeamGame(progressed), false);
  assert.equal(isPristineImportedTeamGame(priorAssignment), false);
  assert.throws(
    () => buildTeamGameAssignmentPlan(teams, new Map([['team-1', games.slice(0, 3)]]), new Set(games.map((game) => game.id)), [progressed], 'run-1'),
    { message: 'NON_PRISTINE_TEAM_GAME' }
  );
  assert.throws(
    () => buildTeamGameAssignmentPlan(teams, new Map([['team-1', games.slice(0, 3)]]), new Set(games.map((game) => game.id)), [priorAssignment], 'run-2'),
    { message: 'NON_PRISTINE_TEAM_GAME' }
  );
});

test('event allocation creates exactly three distinct rows when no placeholders exist', () => {
  const plan = buildTeamGameAssignmentPlan(
    [{ id: 'team-1' }],
    new Map([['team-1', Array.from({ length: 3 }, (_, index) => ({ id: `game-${index}` }))]]),
    new Set(['game-0', 'game-1', 'game-2']),
    [],
    'run-1'
  );

  assert.equal(plan.updates.length, 0);
  assert.equal(plan.creates.length, 3);
  assert.equal(new Set(plan.creates.map((row) => row.game_id)).size, 3);
});

test('event allocation rejects a selected game outside the enabled-game set', () => {
  const games = Array.from({ length: 4 }, (_, index) => ({ id: `game-${index}` }));
  const selected = new Map([['team-1', games.slice(0, 3)]]);
  const enabledGameIds = new Set(['game-0', 'game-1', 'disabled-game']);

  assert.throws(
    () => buildTeamGameAssignmentPlan([{ id: 'team-1' }], selected, enabledGameIds, [], 'run-1'),
    { message: 'SELECTED_GAME_NOT_ENABLED' }
  );
});

const makeTeamDeletionFixture = ({ eventStatus = 'ready', failOn = null } = {}) => {
  const initial = {
    teams: [
      { id: 'team-a', name: 'Team A', login_id: 'team-a' },
      { id: 'team-b', name: 'Team B', login_id: 'team-b' },
    ],
    members: [{ id: 'member-a', team_id: 'team-a' }, { id: 'member-b', team_id: 'team-b' }],
    teamGames: [{ id: 'game-a', team_id: 'team-a' }, { id: 'game-b', team_id: 'team-b' }],
    gameSessions: [{ id: 'session-a', team_id: 'team-a' }, { id: 'session-b', team_id: 'team-b' }],
    teamScores: [{ id: 'score-a', team_id: 'team-a' }, { id: 'score-b', team_id: 'team-b' }],
    lifelineEvents: [{ id: 'life-a', team_id: 'team-a' }, { id: 'life-b', team_id: 'team-b' }],
    recoveryPuzzleAttempts: [{ id: 'attempt-a', team_id: 'team-a', puzzle_id: 'puzzle-a' }, { id: 'attempt-b', team_id: 'team-b', puzzle_id: 'puzzle-b' }],
    recoveryPuzzles: [
      { id: 'puzzle-a', team_id: 'team-a', team_game_id: 'game-a' },
      { id: 'puzzle-b', team_id: 'team-b', team_game_id: 'game-b' },
    ],
    projectClueUnlocks: [
      { id: 'unlock-a', team_id: 'team-a', team_game_id: 'game-a' },
      { id: 'unlock-b', team_id: 'team-b', team_game_id: 'game-b' },
    ],
    auditLogs: [{ id: 'audit-a', team_id: 'team-a' }, { id: 'audit-b', team_id: 'team-b' }],
    projects: [{ id: 'project-shared', name: 'Shared Project' }],
    projectHints: [{ id: 'hint-shared', project_id: 'project-shared', clue_text: 'Keep this shared clue.' }],
    questions: [{ id: 'question-shared', text: 'Preserve shared question.' }],
    answerOptions: [{ id: 'option-shared', question_id: 'question-shared' }],
    games: [{ id: 'game-shared', game_key: 'snake' }],
    admins: [{ id: 'admin-1' }],
    eventState: { id: 'global', status: eventStatus },
  };
  const state = structuredClone(initial);
  const calls = [];
  const makeDeleteDelegate = (table) => ({
    deleteMany: async ({ where }) => {
      calls.push(`${table}.deleteMany`);
      const countBefore = state[table].length;
      if (failOn === table) throw new Error('simulated transaction failure');
      state[table] = state[table].filter((row) => row.team_id !== where.team_id);
      return { count: countBefore - state[table].length };
    },
  });
  const tx = {
    eventState: { findUnique: async () => state.eventState },
    team: {
      findUnique: async ({ where }) => {
        const team = state.teams.find((row) => row.id === where.id);
        return team ? { id: team.id, name: team.name, login_id: team.login_id } : null;
      },
      delete: async ({ where }) => {
        calls.push('team.delete');
        const teamOwnedTables = [
          'members', 'teamGames', 'gameSessions', 'teamScores', 'lifelineEvents',
          'recoveryPuzzleAttempts', 'recoveryPuzzles', 'projectClueUnlocks',
        ];
        if (teamOwnedTables.some((table) => state[table].some((row) => row.team_id === where.id))) {
          throw new Error('dependent row remains');
        }
        state.auditLogs = state.auditLogs.map((row) => row.team_id === where.id ? { ...row, team_id: null } : row);
        state.teams = state.teams.filter((row) => row.id !== where.id);
      },
    },
    member: makeDeleteDelegate('members'),
    teamGame: makeDeleteDelegate('teamGames'),
    gameSession: makeDeleteDelegate('gameSessions'),
    teamScore: makeDeleteDelegate('teamScores'),
    lifelineEvent: makeDeleteDelegate('lifelineEvents'),
    recoveryPuzzleAttempt: {
      ...makeDeleteDelegate('recoveryPuzzleAttempts'),
      findFirst: async ({ where }) => state.recoveryPuzzleAttempts.find((attempt) =>
        attempt.team_id !== where.team_id.not
        && state.recoveryPuzzles.some((puzzle) => puzzle.id === attempt.puzzle_id && puzzle.team_id === where.puzzle.is.team_id)
      ) || null,
    },
    recoveryPuzzle: {
      ...makeDeleteDelegate('recoveryPuzzles'),
      findFirst: async ({ where }) => state.recoveryPuzzles.find((puzzle) =>
        puzzle.team_id !== where.team_id.not
        && state.teamGames.some((teamGame) => teamGame.id === puzzle.team_game_id && teamGame.team_id === where.team_game.is.team_id)
      ) || null,
    },
    projectClueUnlock: {
      ...makeDeleteDelegate('projectClueUnlocks'),
      findFirst: async ({ where }) => state.projectClueUnlocks.find((unlock) =>
        unlock.team_id !== where.team_id.not
        && state.teamGames.some((teamGame) => teamGame.id === unlock.team_game_id && teamGame.team_id === where.team_game.is.team_id)
      ) || null,
    },
  };
  const runTransaction = async (operation) => {
    const snapshot = structuredClone(state);
    try {
      return await operation(tx);
    } catch (error) {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, snapshot);
      throw error;
    }
  };
  return { initial, state, calls, runTransaction };
};

test('team deletion removes a team with no gameplay history', async () => {
  const fixture = makeTeamDeletionFixture();
  fixture.state.gameSessions = [];
  fixture.state.teamScores = [];
  fixture.state.teamGames = [];
  fixture.state.lifelineEvents = [];
  fixture.state.recoveryPuzzleAttempts = [];
  fixture.state.recoveryPuzzles = [];
  fixture.state.projectClueUnlocks = [];
  const result = await deleteTeamForAdmin('team-a', async () => true, fixture.runTransaction);
  assert.deepEqual(result, { id: 'team-a', name: 'Team A', login_id: 'team-a' });
  assert.equal(fixture.state.teams.some((team) => team.id === 'team-a'), false);
  assert.equal(fixture.state.members.some((member) => member.team_id === 'team-a'), false);
});

test('team deletion uses a bounded Serializable Prisma transaction', () => {
  assert.deepEqual(TEAM_DELETE_TRANSACTION_OPTIONS, {
    isolationLevel: 'Serializable',
    timeout: 30_000,
    maxWait: 10_000,
  });
});

test('team deletion removes existing GameSession and TeamScore rows', async () => {
  const fixture = makeTeamDeletionFixture();
  await deleteTeamForAdmin('team-a', async () => true, fixture.runTransaction);
  assert.equal(fixture.state.gameSessions.some((row) => row.team_id === 'team-a'), false);
  assert.equal(fixture.state.teamScores.some((row) => row.team_id === 'team-a'), false);
});

test('team deletion removes TeamGame assignments and lifeline records before deleting the team', async () => {
  const fixture = makeTeamDeletionFixture();
  await deleteTeamForAdmin('team-a', async () => true, fixture.runTransaction);
  assert.equal(fixture.state.teamGames.some((row) => row.team_id === 'team-a'), false);
  assert.equal(fixture.state.lifelineEvents.some((row) => row.team_id === 'team-a'), false);
  assert.ok(fixture.calls.indexOf('teamGames.deleteMany') < fixture.calls.indexOf('team.delete'));
});

test('team deletion preserves every other team record and shared project configuration', async () => {
  const fixture = makeTeamDeletionFixture();
  await deleteTeamForAdmin('team-a', async () => true, fixture.runTransaction);
  for (const table of ['members', 'teamGames', 'gameSessions', 'teamScores', 'lifelineEvents', 'recoveryPuzzleAttempts', 'recoveryPuzzles', 'projectClueUnlocks']) {
    assert.deepEqual(fixture.state[table], fixture.initial[table].filter((row) => row.team_id === 'team-b'));
  }
  for (const table of ['projects', 'projectHints', 'questions', 'answerOptions', 'games', 'admins']) {
    assert.deepEqual(fixture.state[table], fixture.initial[table]);
  }
  assert.equal(fixture.state.auditLogs.find((row) => row.id === 'audit-a').team_id, null);
  assert.equal(fixture.state.auditLogs.find((row) => row.id === 'audit-b').team_id, 'team-b');
});

test('team deletion rejects unauthenticated requests before opening a transaction', async () => {
  const fixture = makeTeamDeletionFixture();
  let transactionStarted = false;
  await assert.rejects(
    deleteTeamForAdmin('team-a', async () => { throw new Error('UNAUTHORIZED'); }, async (operation) => {
      transactionStarted = true;
      return fixture.runTransaction(operation);
    }),
    { message: 'UNAUTHORIZED' }
  );
  assert.equal(transactionStarted, false);
  assert.deepEqual(fixture.state, fixture.initial);
});

test('team deletion is rejected while event status is running', async () => {
  const fixture = makeTeamDeletionFixture({ eventStatus: 'running' });
  await assert.rejects(deleteTeamForAdmin('team-a', async () => true, fixture.runTransaction), { message: 'EVENT_RUNNING' });
  assert.deepEqual(fixture.state, fixture.initial);
});

test('team deletion refuses to cascade through a cross-team gameplay reference', async () => {
  const fixture = makeTeamDeletionFixture();
  fixture.state.projectClueUnlocks.push({ id: 'foreign-unlock', team_id: 'team-b', team_game_id: 'game-a' });
  const before = structuredClone(fixture.state);
  await assert.rejects(deleteTeamForAdmin('team-a', async () => true, fixture.runTransaction), { message: 'CROSS_TEAM_DEPENDENCY' });
  assert.deepEqual(fixture.state, before);
});

test('a failed team deletion transaction restores all team and shared records', async () => {
  const fixture = makeTeamDeletionFixture({ failOn: 'teamGames' });
  await assert.rejects(deleteTeamForAdmin('team-a', async () => true, fixture.runTransaction), { message: 'simulated transaction failure' });
  assert.deepEqual(fixture.state, fixture.initial);
});

test('server error details retain Prisma diagnostics and redact credentials', () => {
  const details = safeErrorDetails(Object.assign(new Error('Foreign key failed for postgres://user:password@db.example/app password=hunter2'), {
    code: 'P2003',
    clientVersion: 'test-version',
    meta: { modelName: 'Team', password: 'hunter2', field_name: 'team_id' },
  }));
  assert.equal(details.name, 'Error');
  assert.equal(details.code, 'P2003');
  assert.equal(details.clientVersion, 'test-version');
  assert.match(details.message, /Foreign key failed/);
  assert.doesNotMatch(details.message, /hunter2|user:password@db/);
  assert.deepEqual(details.meta, { modelName: 'Team', password: '[REDACTED]', field_name: 'team_id' });
});

test('puzzle image upload checks signatures, decoded contents, and size', async () => {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(getPuzzleImageExtension(pngSignature, 'image/png'), 'png');
  assert.equal(getPuzzleImageExtension(pngSignature, 'image/jpeg'), null);
  assert.equal(getPuzzleImageExtension(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png'), null);

  const validPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  }).png().toBuffer();
  assert.equal(await getValidatedPuzzleImageExtension(validPng, 'image/png'), 'png');
  assert.equal(
    await getValidatedPuzzleImageExtension(Buffer.concat([pngSignature, Buffer.alloc(20)]), 'image/png'),
    null
  );
  assert.equal(
    await getValidatedPuzzleImageExtension(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png'),
    null
  );
});
