export type MazeDirection = 'up' | 'down' | 'left' | 'right';
export type SnakeDirection = MazeDirection;
export type PongInput = 'up' | 'down' | 'stay';

export type ServerGameAction =
  | { type: 'snakeStep'; direction: SnakeDirection }
  | { type: 'pongStep'; input: PongInput; paddleCenterY?: number }
  | { type: 'memoryFlip'; index: number }
  | { type: 'memoryResetSelection' }
  | { type: 'forfeitAttempt' }
  | { type: 'lightsOutToggle'; index: number }
  | { type: 'quickMazeMove'; direction: MazeDirection }
  | { type: 'targetSequenceSubmit'; sequence: number[] };

export interface SnakePoint {
  x: number;
  y: number;
}

export interface SnakeGameState {
  gameKey: 'snake';
  target: 3;
  tileCount: 20;
  snake: SnakePoint[];
  direction: SnakeDirection;
  food: SnakePoint;
  foodCollected: number;
  moves: number;
  failed: boolean;
}

export interface PongGameState {
  gameKey: 'pong';
  target: 3;
  width: 440;
  height: 320;
  paddleHeight: 100;
  playerY: number;
  aiY: number;
  ballX: number;
  ballY: number;
  ballSpeedX: number;
  ballSpeedY: number;
  playerScore: number;
  aiScore: number;
  ticks: number;
  failed: boolean;
}

export interface MemoryGameState {
  gameKey: 'memory';
  target: 3;
  cardCount: 6;
  matchedIndices: number[];
  revealedCards: { index: number; symbolIndex: number }[];
  moves: number;
  mismatch: boolean;
}

export interface StoredMemoryGameState {
  gameKey: 'memory';
  target: 3;
  deck: number[];
  matchedIndices: number[];
  selection: number[];
  moves: number;
}

export interface LightsOutState {
  gameKey: 'lights-out';
  target: 1;
  board: boolean[];
  moves: number;
}

export interface QuickMazeState {
  gameKey: 'quick-maze';
  target: 1;
  maze: number[][];
  row: number;
  column: number;
  exitRow: number;
  exitColumn: number;
  moves: number;
}

export interface TargetSequenceState {
  gameKey: 'target-sequence';
  target: 1;
  sequence: number[];
  failures: number;
}

export type ServerGameState =
  | SnakeGameState
  | PongGameState
  | MemoryGameState
  | LightsOutState
  | QuickMazeState
  | TargetSequenceState;

export type PersistedGameState =
  | SnakeGameState
  | PongGameState
  | StoredMemoryGameState
  | LightsOutState
  | QuickMazeState
  | TargetSequenceState;

export interface GameProgressResponse {
  success: boolean;
  accepted: boolean;
  progress: number;
  target: number;
  winningReady: boolean;
  duplicate?: boolean;
  gameState?: ServerGameState;
  correct?: boolean;
  failed?: boolean;
  remainingAttempts?: number;
}

function isDirection(value: unknown): value is MazeDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

function isGridPoint(value: unknown, limit: number): value is SnakePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return Number.isInteger(point.x)
    && Number(point.x) >= 0
    && Number(point.x) < limit
    && Number.isInteger(point.y)
    && Number(point.y) >= 0
    && Number(point.y) < limit;
}

export function getPublicGameState(value: unknown): ServerGameState | null {
  if (!value || typeof value !== 'object') return null;
  const memoryState = parseStoredMemoryGameState(value);
  if (memoryState) {
    const { deck, matchedIndices, selection } = memoryState;
    const visibleIndices = Array.from(new Set([...matchedIndices, ...selection]));
    return {
      gameKey: 'memory',
      target: 3,
      cardCount: 6,
      matchedIndices,
      revealedCards: visibleIndices.map((index) => ({ index, symbolIndex: deck[index] })),
      moves: memoryState.moves,
      mismatch: selection.length === 2 && deck[selection[0]] !== deck[selection[1]],
    };
  }
  return parseServerGameState(value);
}

export function parseStoredMemoryGameState(value: unknown): StoredMemoryGameState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Record<string, unknown>;
  const deck = state.deck;
  const matchedIndices = state.matchedIndices;
  const selection = state.selection;
  if (
    state.gameKey !== 'memory'
    || state.target !== 3
    || !Array.isArray(deck)
    || deck.length !== 6
    || !deck.every((symbol) => Number.isInteger(symbol) && symbol >= 0 && symbol < 3)
    || !Array.isArray(matchedIndices)
    || !matchedIndices.every((index) => Number.isInteger(index) && index >= 0 && index < 6)
    || new Set(matchedIndices).size !== matchedIndices.length
    || !Array.isArray(selection)
    || selection.length > 2
    || !selection.every((index) => Number.isInteger(index) && index >= 0 && index < 6)
    || new Set(selection).size !== selection.length
    || !Number.isInteger(state.moves)
    || Number(state.moves) < 0
  ) {
    return null;
  }
  if ([0, 1, 2].some((symbol) => deck.filter((value: unknown) => value === symbol).length !== 2)) {
    return null;
  }
  const typedDeck = deck as number[];
  const typedMatchedIndices = matchedIndices as number[];
  const typedSelection = selection as number[];
  if (
    typedMatchedIndices.length % 2 !== 0
    || typedMatchedIndices.some((index) => typedSelection.includes(index))
    || (typedSelection.length === 2 && typedDeck[typedSelection[0]] === typedDeck[typedSelection[1]])
    || [0, 1, 2].some((symbol) => {
      const matchedCount = typedMatchedIndices.filter((index) => typedDeck[index] === symbol).length;
      return matchedCount !== 0 && matchedCount !== 2;
    })
  ) {
    return null;
  }
  return {
    gameKey: 'memory',
    target: 3,
    deck: typedDeck,
    matchedIndices: typedMatchedIndices,
    selection: typedSelection,
    moves: Number(state.moves),
  };
}

export function parseServerGameState(value: unknown): ServerGameState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Record<string, unknown>;
  if (
    state.gameKey === 'snake'
    && state.target === 3
    && state.tileCount === 20
    && Array.isArray(state.snake)
    && state.snake.length >= 3
    && state.snake.every((point) => isGridPoint(point, 20))
    && new Set((state.snake as SnakePoint[]).map((point) => `${point.x},${point.y}`)).size === state.snake.length
    && isDirection(state.direction)
    && isGridPoint(state.food, 20)
    && (
      Number(state.foodCollected) >= 3
      || !(state.snake as SnakePoint[]).some((point) => point.x === Number((state.food as Record<string, unknown>).x) && point.y === Number((state.food as Record<string, unknown>).y))
    )
    && Number.isInteger(state.foodCollected)
    && Number(state.foodCollected) >= 0
    && Number(state.foodCollected) <= 3
    && Number.isInteger(state.moves)
    && Number(state.moves) >= 0
    && typeof state.failed === 'boolean'
  ) {
    return {
      gameKey: 'snake',
      target: 3,
      tileCount: 20,
      snake: state.snake as SnakePoint[],
      direction: state.direction,
      food: state.food as SnakePoint,
      foodCollected: Number(state.foodCollected),
      moves: Number(state.moves),
      failed: state.failed,
    };
  }
  if (
    state.gameKey === 'pong'
    && state.width === 440
    && state.height === 320
    && state.paddleHeight === 100
    && [state.playerY, state.aiY, state.ballX, state.ballY, state.ballSpeedX, state.ballSpeedY].every(Number.isFinite)
    && Number(state.playerY) >= 0
    && Number(state.playerY) <= 220
    && Number(state.aiY) >= 0
    && Number(state.aiY) <= 220
    && Number(state.ballX) >= 0
    && Number(state.ballX) <= 446
    && Number(state.ballY) >= 6
    && Number(state.ballY) <= 314
    && Math.abs(Number(state.ballSpeedX)) >= 1
    && Math.abs(Number(state.ballSpeedX)) <= 5.2
    && Math.abs(Number(state.ballSpeedY)) <= 4
    && Number.isInteger(state.playerScore)
    && Number(state.playerScore) >= 0
    && Number(state.playerScore) <= 3
    && Number.isInteger(state.aiScore)
    && Number(state.aiScore) >= 0
    && Number(state.aiScore) <= 3
    && Number.isInteger(state.ticks)
    && Number(state.ticks) >= 0
    && typeof state.failed === 'boolean'
  ) {
    return {
      gameKey: 'pong',
      target: 3,
      width: 440,
      height: 320,
      paddleHeight: 100,
      playerY: Number(state.playerY),
      aiY: Number(state.aiY),
      ballX: Number(state.ballX),
      ballY: Number(state.ballY),
      ballSpeedX: Number(state.ballSpeedX),
      ballSpeedY: Number(state.ballSpeedY),
      playerScore: Number(state.playerScore),
      aiScore: Number(state.aiScore),
      ticks: Number(state.ticks),
      failed: state.failed,
    };
  }
  if (
    state.gameKey === 'memory'
    && state.target === 3
    && state.cardCount === 6
    && Array.isArray(state.matchedIndices)
    && state.matchedIndices.every((index) => Number.isInteger(index) && index >= 0 && index < 6)
    && Array.isArray(state.revealedCards)
    && state.revealedCards.every((card) =>
      Boolean(
        card
        && typeof card === 'object'
        && Number.isInteger((card as Record<string, unknown>).index)
        && Number((card as Record<string, unknown>).index) >= 0
        && Number((card as Record<string, unknown>).index) < 6
        && Number.isInteger((card as Record<string, unknown>).symbolIndex)
        && Number((card as Record<string, unknown>).symbolIndex) >= 0
        && Number((card as Record<string, unknown>).symbolIndex) < 3
      )
    )
    && Number.isInteger(state.moves)
    && typeof state.mismatch === 'boolean'
  ) {
    return {
      gameKey: 'memory',
      target: 3,
      cardCount: 6,
      matchedIndices: state.matchedIndices as number[],
      revealedCards: state.revealedCards as MemoryGameState['revealedCards'],
      moves: Number(state.moves),
      mismatch: state.mismatch,
    };
  }
  if (
    state.gameKey === 'lights-out'
    && Array.isArray(state.board)
    && state.board.length === 9
    && state.board.every((cell) => typeof cell === 'boolean')
    && Number.isInteger(state.moves)
  ) {
    return {
      gameKey: 'lights-out',
      target: 1,
      board: state.board,
      moves: state.moves as number,
    };
  }
  if (
    state.gameKey === 'quick-maze'
    && Array.isArray(state.maze)
    && state.maze.length === 7
    && state.maze.every((row) => Array.isArray(row) && row.length === 7 && row.every((cell) => cell === 0 || cell === 1))
    && Number.isInteger(state.row)
    && Number.isInteger(state.column)
    && Number.isInteger(state.exitRow)
    && Number.isInteger(state.exitColumn)
    && Number.isInteger(state.moves)
  ) {
    return {
      gameKey: 'quick-maze',
      target: 1,
      maze: state.maze as number[][],
      row: state.row as number,
      column: state.column as number,
      exitRow: state.exitRow as number,
      exitColumn: state.exitColumn as number,
      moves: state.moves as number,
    };
  }
  if (
    state.gameKey === 'target-sequence'
    && Array.isArray(state.sequence)
    && state.sequence.length === 5
    && state.sequence.every((value) => Number.isInteger(value) && value >= 0 && value <= 3)
    && Number.isInteger(state.failures)
  ) {
    return {
      gameKey: 'target-sequence',
      target: 1,
      sequence: state.sequence,
      failures: state.failures as number,
    };
  }
  return null;
}

export function toggleLightsOutCell(board: boolean[], index: number): boolean[] | null {
  if (board.length !== 9 || !Number.isInteger(index) || index < 0 || index >= 9) return null;
  const next = [...board];
  const row = Math.floor(index / 3);
  const column = index % 3;
  const cells = [
    [row, column],
    [row - 1, column],
    [row + 1, column],
    [row, column - 1],
    [row, column + 1],
  ];
  for (const [cellRow, cellColumn] of cells) {
    if (cellRow >= 0 && cellRow < 3 && cellColumn >= 0 && cellColumn < 3) {
      const cellIndex = cellRow * 3 + cellColumn;
      next[cellIndex] = !next[cellIndex];
    }
  }
  return next;
}

export function moveInQuickMaze(
  state: QuickMazeState,
  direction: MazeDirection
): QuickMazeState | null {
  const deltas: Record<MazeDirection, [number, number]> = {
    up: [-1, 0],
    down: [1, 0],
    left: [0, -1],
    right: [0, 1],
  };
  const [rowDelta, columnDelta] = deltas[direction];
  const row = state.row + rowDelta;
  const column = state.column + columnDelta;
  if (
    row < 0
    || row >= state.maze.length
    || column < 0
    || column >= state.maze[row]?.length
    || state.maze[row][column] !== 0
  ) {
    return null;
  }
  return { ...state, row, column, moves: state.moves + 1 };
}

export function matchesTargetSequence(target: number[], answer: number[]): boolean {
  return target.length > 0
    && answer.length === target.length
    && target.every((value, index) => value === answer[index]);
}

function oppositeDirection(direction: SnakeDirection): SnakeDirection {
  const opposites: Record<SnakeDirection, SnakeDirection> = {
    up: 'down',
    down: 'up',
    left: 'right',
    right: 'left',
  };
  return opposites[direction];
}

function nextSnakePoint(point: SnakePoint, direction: SnakeDirection): SnakePoint {
  if (direction === 'up') return { x: point.x, y: point.y - 1 };
  if (direction === 'down') return { x: point.x, y: point.y + 1 };
  if (direction === 'left') return { x: point.x - 1, y: point.y };
  return { x: point.x + 1, y: point.y };
}

function spawnSnakeFood(
  snake: SnakePoint[],
  tileCount: number,
  randomIndex: (max: number) => number
): SnakePoint | null {
  const occupied = new Set(snake.map((point) => point.y * tileCount + point.x));
  const available: number[] = [];
  for (let index = 0; index < tileCount * tileCount; index++) {
    if (!occupied.has(index)) available.push(index);
  }
  if (available.length === 0) return null;
  const choice = Math.max(0, Math.min(available.length - 1, randomIndex(available.length)));
  const index = available[choice];
  return { x: index % tileCount, y: Math.floor(index / tileCount) };
}

export function advanceSnake(
  state: SnakeGameState,
  direction: SnakeDirection,
  randomIndex: (max: number) => number
): { state: SnakeGameState; accepted: boolean; collected: boolean; failed: boolean } {
  if (state.failed || state.foodCollected >= state.target || direction === oppositeDirection(state.direction)) {
    return { state, accepted: false, collected: false, failed: state.failed };
  }

  const head = nextSnakePoint(state.snake[0], direction);
  const collected = head.x === state.food.x && head.y === state.food.y;
  const collisionBody = collected ? state.snake : state.snake.slice(0, -1);
  if (
    head.x < 0
    || head.x >= state.tileCount
    || head.y < 0
    || head.y >= state.tileCount
    || collisionBody.some((point) => point.x === head.x && point.y === head.y)
  ) {
    return {
      state: { ...state, direction, moves: state.moves + 1, failed: true },
      accepted: true,
      collected: false,
      failed: true,
    };
  }

  const snake = [head, ...state.snake];
  if (!collected) snake.pop();
  const foodCollected = state.foodCollected + Number(collected);
  const food = collected && foodCollected < state.target
    ? spawnSnakeFood(snake, state.tileCount, randomIndex)
    : state.food;
  if (collected && foodCollected < state.target && !food) {
    return {
      state: { ...state, direction, snake, foodCollected, moves: state.moves + 1, failed: true },
      accepted: true,
      collected: true,
      failed: true,
    };
  }

  return {
    state: {
      ...state,
      direction,
      snake,
      food: food || state.food,
      foodCollected,
      moves: state.moves + 1,
    },
    accepted: true,
    collected,
    failed: false,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resetPongBall(state: PongGameState, towardPlayer: boolean): PongGameState {
  return {
    ...state,
    ballX: state.width / 2,
    ballY: state.height / 2,
    ballSpeedX: towardPlayer ? -3.4 : 3.4,
    ballSpeedY: state.ticks % 2 === 0 ? 1.8 : -1.8,
  };
}

export function advancePong(
  initialState: PongGameState,
  input: PongInput,
  paddleCenterY?: number
): { state: PongGameState; playerScored: boolean; failed: boolean } {
  if (initialState.failed || initialState.playerScore >= initialState.target) {
    return { state: initialState, playerScored: false, failed: initialState.failed };
  }

  const paddleTop = paddleCenterY === undefined
    ? initialState.playerY + (input === 'up' ? -72 : input === 'down' ? 72 : 0)
    : clamp(paddleCenterY - initialState.paddleHeight / 2, initialState.playerY - 72, initialState.playerY + 72);
  let state: PongGameState = {
    ...initialState,
    playerY: clamp(paddleTop, 0, initialState.height - initialState.paddleHeight),
    ticks: initialState.ticks + 1,
  };
  let playerScored = false;
  const ballRadius = 6;
  const playerPaddleX = 30;
  const aiPaddleX = state.width - 30;

  for (let frame = 0; frame < 24; frame++) {
    let aiY = state.aiY;
    const aiTarget = state.ballY - state.paddleHeight / 2;
    aiY += clamp(aiTarget - aiY, -1.4, 1.4);
    let ballX = state.ballX + state.ballSpeedX;
    let ballY = state.ballY + state.ballSpeedY;
    let ballSpeedX = state.ballSpeedX;
    let ballSpeedY = state.ballSpeedY;
    let playerScore = state.playerScore;
    let aiScore = state.aiScore;

    if (ballY - ballRadius <= 0 || ballY + ballRadius >= state.height) {
      ballY = clamp(ballY, ballRadius, state.height - ballRadius);
      ballSpeedY = -ballSpeedY;
    }

    if (ballSpeedX < 0 && ballX - ballRadius <= playerPaddleX) {
      if (ballY >= state.playerY && ballY <= state.playerY + state.paddleHeight) {
        const offset = (ballY - (state.playerY + state.paddleHeight / 2)) / (state.paddleHeight / 2);
        ballX = playerPaddleX + ballRadius;
        ballSpeedX = Math.min(5.2, Math.abs(ballSpeedX) * 1.03);
        ballSpeedY = clamp(offset * 4, -4, 4);
      }
    } else if (ballSpeedX > 0 && ballX + ballRadius >= aiPaddleX) {
      if (ballY >= aiY && ballY <= aiY + state.paddleHeight) {
        const offset = (ballY - (aiY + state.paddleHeight / 2)) / (state.paddleHeight / 2);
        ballX = aiPaddleX - ballRadius;
        ballSpeedX = -Math.min(5.2, Math.abs(ballSpeedX) * 1.03);
        ballSpeedY = clamp(offset * 4, -4, 4);
      }
    }

    if (ballX + ballRadius < 0) {
      aiScore += 1;
      state = resetPongBall({
        ...state,
        aiY,
        aiScore,
        ballX,
        ballY,
        ballSpeedX,
        ballSpeedY,
      }, false);
      if (aiScore >= state.target) {
        state = { ...state, failed: true };
        return { state, playerScored, failed: true };
      }
      continue;
    }
    if (ballX - ballRadius > state.width) {
      playerScore += 1;
      playerScored = true;
      state = resetPongBall({
        ...state,
        aiY,
        playerScore,
        ballX,
        ballY,
        ballSpeedX,
        ballSpeedY,
      }, true);
      if (playerScore >= state.target) return { state, playerScored, failed: false };
      continue;
    }

    state = { ...state, aiY, ballX, ballY, ballSpeedX, ballSpeedY, playerScore, aiScore };
  }
  return { state, playerScored, failed: false };
}

export function flipMemoryCard(
  state: StoredMemoryGameState,
  index: number
): { state: StoredMemoryGameState; matched: boolean } | null {
  if (
    !Number.isInteger(index)
    || index < 0
    || index >= state.deck.length
    || state.matchedIndices.includes(index)
    || state.selection.length >= 2
    || state.selection.includes(index)
  ) {
    return null;
  }
  if (state.selection.length === 0) {
    return { state: { ...state, selection: [index], moves: state.moves + 1 }, matched: false };
  }
  const first = state.selection[0];
  if (state.deck[first] === state.deck[index]) {
    return {
      state: {
        ...state,
        matchedIndices: [...state.matchedIndices, first, index].sort((a, b) => a - b),
        selection: [],
        moves: state.moves + 1,
      },
      matched: true,
    };
  }
  return {
    state: { ...state, selection: [first, index], moves: state.moves + 1 },
    matched: false,
  };
}

export function resetMemoryMismatch(state: StoredMemoryGameState): StoredMemoryGameState | null {
  if (
    state.selection.length !== 2
    || state.deck[state.selection[0]] === state.deck[state.selection[1]]
  ) {
    return null;
  }
  return { ...state, selection: [] };
}

export function createInitialGameState(
  gameKey: string,
  randomIndex: (max: number) => number = (max) => Math.floor(Math.random() * max)
): PersistedGameState | null {
  if (gameKey === 'snake') {
    const snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const food = spawnSnakeFood(snake, 20, randomIndex)!;
    return {
      gameKey,
      target: 3,
      tileCount: 20,
      snake,
      direction: 'right',
      food,
      foodCollected: 0,
      moves: 0,
      failed: false,
    };
  }

  if (gameKey === 'pong') {
    return {
      gameKey,
      target: 3,
      width: 440,
      height: 320,
      paddleHeight: 100,
      playerY: 110,
      aiY: 110,
      ballX: 220,
      ballY: 160,
      ballSpeedX: -3.4,
      ballSpeedY: 1.8,
      playerScore: 0,
      aiScore: 0,
      ticks: 0,
      failed: false,
    };
  }

  if (gameKey === 'memory') {
    const deck = [0, 0, 1, 1, 2, 2];
    for (let index = deck.length - 1; index > 0; index--) {
      const swapIndex = Math.max(0, Math.min(index, randomIndex(index + 1)));
      [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
    }
    return { gameKey, target: 3, deck, matchedIndices: [], selection: [], moves: 0 };
  }

  if (gameKey === 'lights-out') {
    let board = Array.from({ length: 9 }, () => false);
    for (let move = 0; move < 8; move++) {
      board = toggleLightsOutCell(board, randomIndex(9))!;
    }
    if (board.every((cell) => !cell)) board = toggleLightsOutCell(board, 4)!;
    return { gameKey, target: 1, board, moves: 0 };
  }

  if (gameKey === 'quick-maze') {
    return {
      gameKey,
      target: 1,
      maze: [
        [0, 0, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 0, 1],
        [1, 0, 0, 0, 1, 0, 1],
        [1, 0, 1, 0, 1, 0, 1],
        [1, 0, 1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 0, 0],
      ],
      row: 0,
      column: 0,
      exitRow: 6,
      exitColumn: 6,
      moves: 0,
    };
  }

  if (gameKey === 'target-sequence') {
    return {
      gameKey,
      target: 1,
      sequence: Array.from({ length: 5 }, () => randomIndex(4)),
      failures: 0,
    };
  }

  return null;
}
