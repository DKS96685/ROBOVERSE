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
  isNextProgressActionSequence,
  isRecoveryAnswerCorrect,
  isValidRecoveryQuestion,
  selectGamesForTeam,
} from '../lib/games/rules.ts';
import {
  buildTeamGameAssignmentPlan,
  isPristineImportedTeamGame,
} from '../lib/games/teamGameAssignments.ts';
import sharp from 'sharp';
import {
  getPuzzleImageExtension,
  getValidatedPuzzleImageExtension,
} from '../lib/storage/imageValidation.ts';
import { runOnce } from '../lib/games/callbacks.ts';

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
