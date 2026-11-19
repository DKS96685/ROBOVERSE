export const GAME_CATALOG = [
  {
    gameKey: 'snake',
    title: 'Cyber Serpent',
    minSeconds: 15,
    progressTarget: 3,
    description: 'Collect three data dots without hitting a wall or your own tail.',
    controls: 'Arrow keys, WASD, or the touch D-pad.',
  },
  {
    gameKey: 'pong',
    title: 'Circuit Deflector',
    minSeconds: 20,
    progressTarget: 3,
    description: 'Deflect the energy pulses and score three points against the CPU.',
    controls: 'W/S, arrow keys, or drag your paddle.',
  },
  {
    gameKey: 'memory',
    title: 'Neural Matrix',
    minSeconds: 15,
    progressTarget: 3,
    description: 'Match all three pairs of robotic symbols.',
    controls: 'Tap two cards at a time to match all three pairs.',
  },
  {
    gameKey: 'target-sequence',
    title: 'Target Sequence',
    minSeconds: 20,
    progressTarget: 1,
    description: 'Remember the illuminated sequence and reproduce it.',
    controls: 'Tap the sequence buttons in the displayed order.',
  },
  {
    gameKey: 'lights-out',
    title: 'Lights Out',
    minSeconds: 20,
    progressTarget: 1,
    description: 'Switch off every light; each move toggles a cell and its neighbors.',
    controls: 'Tap or click a light to toggle it and the adjacent cells.',
  },
  {
    gameKey: 'quick-maze',
    title: 'Quick Maze',
    minSeconds: 20,
    progressTarget: 1,
    description: 'Navigate the maze from the entrance to the exit.',
    controls: 'Arrow keys or the on-screen direction buttons.',
  },
] as const;

export type GameCatalogEntry = (typeof GAME_CATALOG)[number];
export type GameCatalogKey = GameCatalogEntry['gameKey'];

export function getGameCatalogEntry(gameKey: string): GameCatalogEntry | undefined {
  return GAME_CATALOG.find((game) => game.gameKey === gameKey);
}

export function getGameProgressTarget(gameKey: string): number {
  return getGameCatalogEntry(gameKey)?.progressTarget || 3;
}
