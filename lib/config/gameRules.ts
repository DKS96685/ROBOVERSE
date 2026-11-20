/**
 * ROBOVERSE Production Game Rules & Settings
 */
export const GAME_RULES = {
  // Team Registration
  TEAM_SIZE: 3, // Exactly 3 members per team

  // Lifelines
  STARTING_LIFELINES: 1,
  CLUE_GAME_LOSS_PENALTY: 1.0,

  // Clue Games
  MAX_CLUE_GAMES: 3,
  MIN_PLAY_TIME_SECONDS: {
    snake: 15,
    pong: 20,
    memory: 15,
  } as Record<string, number>,
};
