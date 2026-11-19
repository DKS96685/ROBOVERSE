import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isDuplicateProgressRequest } from '@/lib/games/rules';

import {
  GameProgressResponse,
  MazeDirection,
  PongInput,
  ServerGameAction,
  advancePong,
  advanceSnake,
  flipMemoryCard,
  getPublicGameState,
  matchesTargetSequence,
  moveInQuickMaze,
  parseServerGameState,
  parseStoredMemoryGameState,
  resetMemoryMismatch,
  toggleLightsOutCell,
} from '@/lib/games/state';

function parseAction(value: unknown): ServerGameAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as Record<string, unknown>;
  const type = action.type;
  if (type === 'snakeStep' && isDirection(action.direction)) {
    return { type, direction: action.direction };
  }
  if (
    type === 'pongStep'
    && (action.input === 'up' || action.input === 'down' || action.input === 'stay')
    && (
      action.paddleCenterY === undefined
      || (typeof action.paddleCenterY === 'number' && Number.isFinite(action.paddleCenterY))
    )
  ) {
    return {
      type,
      input: action.input as PongInput,
      ...(typeof action.paddleCenterY === 'number' ? { paddleCenterY: action.paddleCenterY } : {}),
    };
  }
  if (type === 'memoryFlip' && Number.isInteger(action.index)) {
    return { type, index: action.index as number };
  }
  if (type === 'memoryResetSelection') {
    return { type };
  }
  if (type === 'forfeitAttempt') {
    return { type };
  }
  if (type === 'lightsOutToggle' && Number.isInteger(action.index)) {
    return { type, index: action.index as number };
  }
  if (
    type === 'quickMazeMove'
    && (action.direction === 'up' || action.direction === 'down' || action.direction === 'left' || action.direction === 'right')
  ) {
    return { type, direction: action.direction as MazeDirection };
  }
  if (
    type === 'targetSequenceSubmit'
    && Array.isArray(action.sequence)
    && action.sequence.length <= 8
    && action.sequence.every((value) => Number.isInteger(value) && value >= 0 && value <= 3)
  ) {
    return { type, sequence: action.sequence as number[] };
  }
  return null;
}

function isDirection(value: unknown): value is MazeDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('team');
    const body = await req.json();
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    const action = parseAction(body.action);
    const requestId = typeof body.requestId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
      ? body.requestId
      : null;

    if (!sessionId || !action || !requestId) {
      return NextResponse.json({ error: 'sessionId, requestId, and a valid progress action are required.' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.eventState.findUnique({ where: { id: 'global' } });
      if (event?.status !== 'running') {
        return { error: 'Event is not running.', status: 400 };
      }

      const team = await tx.team.findUnique({
        where: { id: session.teamId! },
        select: { active: true },
      });
      if (!team?.active) return { error: 'Team is inactive.', status: 403 };

      const gameSession = await tx.gameSession.findUnique({
        where: { id: sessionId },
        include: { game: true },
      });
      if (!gameSession || gameSession.team_id !== session.teamId) {
        return { error: 'Game session not found or belongs to another team.', status: 404 };
      }
      if (gameSession.result !== 'in_progress') {
        return { error: 'This game session has already been concluded.', status: 409 };
      }

      const assigned = await tx.teamGame.findUnique({
        where: {
          team_id_game_id: {
            team_id: session.teamId!,
            game_id: gameSession.game_id,
          },
        },
      });
      if (!assigned || !assigned.required) {
        return { error: 'Game is not assigned to this team.', status: 403 };
      }

      const expectedActions: Record<string, ServerGameAction['type']> = {
        snake: 'snakeStep',
        pong: 'pongStep',
        memory: 'memoryFlip',
        'lights-out': 'lightsOutToggle',
        'quick-maze': 'quickMazeMove',
        'target-sequence': 'targetSequenceSubmit',
      };
      const actionMatchesGame = action.type === 'forfeitAttempt'
        || (gameSession.game.game_key === 'memory'
        ? action.type === 'memoryFlip' || action.type === 'memoryResetSelection'
        : expectedActions[gameSession.game.game_key] === action.type);
      if (!actionMatchesGame) {
        return { error: 'Progress action does not match the assigned game.', status: 400 };
      }

      const state =
        gameSession.game_state && typeof gameSession.game_state === 'object'
          ? (gameSession.game_state as Record<string, unknown>)
          : {};
      const processedRequestIds = Array.isArray(state.processedProgressRequestIds)
        ? state.processedProgressRequestIds.filter((value): value is string => typeof value === 'string')
        : [];
      const recordedProgress =
        typeof state.serverProgress === 'number'
          ? Math.max(0, Math.floor(state.serverProgress))
          : gameSession.progress;
      if (isDuplicateProgressRequest(processedRequestIds, requestId)) {
        const duplicate: GameProgressResponse = {
          success: true,
          accepted: true,
          progress: gameSession.progress,
          target: gameSession.validated_target,
          winningReady: gameSession.progress >= gameSession.validated_target,
          duplicate: true,
        };
        const gameState = getPublicGameState(state);
        if (gameState) duplicate.gameState = gameState;
        if (action.type === 'targetSequenceSubmit') {
          duplicate.correct = gameSession.progress >= gameSession.validated_target;
          duplicate.failed = typeof state.failures === 'number' && state.failures >= 3;
          duplicate.remainingAttempts = Math.max(0, 3 - Number(state.failures || 0));
        } else if (action.type === 'snakeStep' || action.type === 'pongStep') {
          duplicate.failed = state.failed === true;
        } else if (action.type === 'forfeitAttempt') {
          duplicate.failed = state.attemptFailed === true
            || state.failed === true
            || (gameSession.game.game_key === 'target-sequence' && Number(state.failures || 0) >= 3);
        }
        return duplicate;
      }
      if (gameSession.progress >= gameSession.validated_target) {
        return { error: 'The game is already server-verified as won.', status: 409 };
      }
      if (processedRequestIds.length >= 2048) {
        return { error: 'This game session reached its progress request limit.', status: 429 };
      }
      const now = Date.now();
      const lastActionTime = typeof state.lastActionAt === 'string'
        ? Date.parse(state.lastActionAt)
        : Number.NaN;
      const minimumActionInterval = gameSession.game.game_key === 'snake'
        || gameSession.game.game_key === 'pong'
        ? 400
        : 100;
      if (Number.isFinite(lastActionTime) && now - lastActionTime < minimumActionInterval) {
        return { error: 'Game actions are arriving too quickly. Wait briefly and try again.', status: 429 };
      }

      let nextProgress = recordedProgress;
      let nextState: Record<string, unknown> = {
        ...state,
        target: gameSession.validated_target,
        gameKey: gameSession.game.game_key,
        lastActionAt: new Date(now).toISOString(),
        processedProgressRequestIds: [...processedRequestIds, requestId],
      };
      let correct: boolean | undefined;
      let failed: boolean | undefined;
      let remainingAttempts: number | undefined;

      if (action.type === 'forfeitAttempt') {
        const alreadyFailed = state.attemptFailed === true
          || state.failed === true
          || (gameSession.game.game_key === 'target-sequence' && Number(state.failures || 0) >= 3);
        const hasGameplayEvidence = alreadyFailed
          || Number(state.moves || 0) > 0
          || Number(state.ticks || 0) > 0
          || Number(state.failures || 0) > 0;
        if (!hasGameplayEvidence) {
          return { error: 'At least one valid game action is required before forfeiting.', status: 409 };
        }
        nextState = {
          ...nextState,
          ...((gameSession.game.game_key === 'snake' || gameSession.game.game_key === 'pong')
            ? { failed: true }
            : {}),
          attemptFailed: true,
        };
        failed = true;
      } else if (action.type === 'snakeStep') {
        const snakeState = getPublicGameState(state);
        if (!snakeState || snakeState.gameKey !== 'snake') {
          return { error: 'The Snake session state is invalid.', status: 409 };
        }
        if (snakeState.failed) return { error: 'The Snake attempt has already failed.', status: 409 };
        const moved = advanceSnake(snakeState, action.direction, (max) => crypto.randomInt(max));
        if (!moved.accepted) return { error: 'That Snake direction is not allowed.', status: 400 };
        nextState = { ...nextState, ...moved.state };
        nextProgress = moved.state.foodCollected;
        failed = moved.failed;
      } else if (action.type === 'pongStep') {
        const pongState = getPublicGameState(state);
        if (!pongState || pongState.gameKey !== 'pong') {
          return { error: 'The Pong session state is invalid.', status: 409 };
        }
        if (pongState.failed) return { error: 'The Pong attempt has already failed.', status: 409 };
        const advanced = advancePong(pongState, action.input, action.paddleCenterY);
        nextState = { ...nextState, ...advanced.state };
        nextProgress = advanced.state.playerScore;
        failed = advanced.failed;
      } else if (action.type === 'memoryFlip' || action.type === 'memoryResetSelection') {
        const memoryState = parseStoredMemoryGameState(state);
        if (!memoryState) return { error: 'The Memory session state is invalid.', status: 409 };
        const updated = action.type === 'memoryFlip'
          ? flipMemoryCard(memoryState, action.index)
          : (() => {
              const cleared = resetMemoryMismatch(memoryState);
              return cleared ? { state: cleared, matched: false } : null;
            })();
        if (!updated) {
          return { error: 'That Memory action is not valid in the current state.', status: 400 };
        }
        nextState = { ...nextState, ...updated.state };
        nextProgress = Math.floor(updated.state.matchedIndices.length / 2);
      } else if (action.type === 'lightsOutToggle') {
        if (!Array.isArray(state.board) || state.board.some((cell) => typeof cell !== 'boolean')) {
          return { error: 'The Lights Out session state is invalid.', status: 409 };
        }
        const board = toggleLightsOutCell(state.board, action.index);
        if (!board) return { error: 'Invalid Lights Out move.', status: 400 };
        nextState = { ...nextState, board, moves: Number(state.moves || 0) + 1 };
        if (board.every((cell) => !cell)) nextProgress = gameSession.validated_target;
      } else if (action.type === 'quickMazeMove') {
        if (
          !Array.isArray(state.maze)
          || !Number.isInteger(state.row)
          || !Number.isInteger(state.column)
          || !Number.isInteger(state.exitRow)
          || !Number.isInteger(state.exitColumn)
        ) {
          return { error: 'The maze session state is invalid.', status: 409 };
        }
        const mazeState = parseServerGameState(state);
        if (!mazeState || mazeState.gameKey !== 'quick-maze') {
          return { error: 'The maze session state is invalid.', status: 409 };
        }
        const moved = moveInQuickMaze(mazeState, action.direction);
        if (!moved) {
          return {
            success: true,
            accepted: false,
            progress: recordedProgress,
            target: gameSession.validated_target,
            winningReady: recordedProgress >= gameSession.validated_target,
            gameState: mazeState,
          };
        }
        nextState = { ...nextState, ...moved };
        if (moved.row === moved.exitRow && moved.column === moved.exitColumn) {
          nextProgress = gameSession.validated_target;
        }
      } else if (action.type === 'targetSequenceSubmit') {
        if (
          !Array.isArray(state.sequence)
          || !state.sequence.every((value) => Number.isInteger(value) && value >= 0 && value <= 3)
        ) {
          return { error: 'The sequence session state is invalid.', status: 409 };
        }
        if (Number(state.failures || 0) >= 3) {
          return { error: 'The sequence attempt is already failed.', status: 409 };
        }
        correct = matchesTargetSequence(state.sequence, action.sequence);
        if (correct) {
          nextProgress = gameSession.validated_target;
        } else {
          const failures = Number.isInteger(state.failures) ? Number(state.failures) + 1 : 1;
          nextState = { ...nextState, failures };
          failed = failures >= 3;
          remainingAttempts = Math.max(0, 3 - failures);
        }
      }

      nextState = {
        ...nextState,
        serverProgress: nextProgress,
      };

      await tx.gameSession.update({
        where: { id: gameSession.id },
        data: {
          progress: nextProgress,
          game_state: nextState as Prisma.InputJsonValue,
          winning_state:
            nextProgress >= gameSession.validated_target
              ? 'SERVER_VALIDATED'
              : null,
        },
      });

      const response: GameProgressResponse = {
        success: true,
        accepted: true,
        progress: nextProgress,
        target: gameSession.validated_target,
        winningReady: nextProgress >= gameSession.validated_target,
        duplicate: false,
      };
      const gameState = getPublicGameState(nextState);
      if (gameState) response.gameState = gameState;
      if (correct !== undefined) response.correct = correct;
      if (failed !== undefined) response.failed = failed;
      if (remainingAttempts !== undefined) response.remainingAttempts = remainingAttempts;
      return response;
    }, { isolationLevel: 'Serializable' });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.code === 'P2034') {
      return NextResponse.json({ error: 'Progress update conflicted. Retry.' }, { status: 409 });
    }
    console.error('Game progress error:', error);
    return NextResponse.json({ error: 'Failed to update game progress' }, { status: 500 });
  }
}
