export interface RecoveryQuestionCandidate {
  questionText: string;
  imageUrl: string;
  correctAnswer: string;
  options: { optionText: string }[];
}

export function isValidRecoveryQuestion(question: RecoveryQuestionCandidate): boolean {
  return Boolean(
    question.questionText.trim()
    && question.imageUrl.trim()
    && question.options.length >= 2
    && question.options.some((option) => option.optionText === question.correctAnswer)
  );
}

export function isRecoveryAnswerCorrect(correctAnswer: string, selectedAnswer: string): boolean {
  return selectedAnswer === correctAnswer;
}

export function getGameCompletionPoints(attemptNumber: number): number {
  return attemptNumber === 1 ? 10 : 5;
}

export function getFailedAttemptDisposition(
  attemptNumber: number,
  remainingLifelines: number
): 'LIFELINE_RETRY_AVAILABLE' | 'RECOVERY_PUZZLE_REQUIRED' {
  return attemptNumber === 1 && remainingLifelines > 0
    ? 'LIFELINE_RETRY_AVAILABLE'
    : 'RECOVERY_PUZZLE_REQUIRED';
}

export function isDuplicateProgressRequest(processedRequestIds: string[], requestId: string): boolean {
  return processedRequestIds.includes(requestId);
}

export function getProgressRequestDisposition(
  processedRequestIds: string[],
  fingerprints: Record<string, unknown>,
  requestId: string,
  fingerprint: string
): 'NEW' | 'DUPLICATE' | 'REQUEST_ID_REUSED' {
  if (!isDuplicateProgressRequest(processedRequestIds, requestId)) return 'NEW';
  const previousFingerprint = fingerprints[requestId];
  return typeof previousFingerprint === 'string' && previousFingerprint !== fingerprint
    ? 'REQUEST_ID_REUSED'
    : 'DUPLICATE';
}

export function isNextProgressActionSequence(currentSequence: number, receivedSequence: number): boolean {
  return Number.isSafeInteger(receivedSequence) && receivedSequence === currentSequence + 1;
}

export const MIN_ENABLED_SUPPORTED_GAMES = 3;
export const MAX_ENABLED_SUPPORTED_GAMES = 10;

export function hasValidEnabledSupportedGameCount(count: number): boolean {
  return Number.isInteger(count)
    && count >= MIN_ENABLED_SUPPORTED_GAMES
    && count <= MAX_ENABLED_SUPPORTED_GAMES;
}

export function selectGamesForTeam<T extends { id: string }>(
  games: T[],
  assignmentCounts: Map<string, number>,
  seenCombinations: Set<string>,
  randomIndex: (max: number) => number
): T[] {
  const shuffle = (items: T[]) => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      const swapIndex = Math.max(0, Math.min(index, randomIndex(index + 1)));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  };

  const ranked = shuffle(games).sort(
    (a, b) => (assignmentCounts.get(a.id) || 0) - (assignmentCounts.get(b.id) || 0)
  );
  let selected = ranked.slice(0, 3);
  let selectedIds = selected.map((game) => game.id).sort().join(':');

  for (let attempt = 0; seenCombinations.has(selectedIds) && attempt < 20; attempt++) {
    selected = shuffle(games).slice(0, 3);
    selectedIds = selected.map((game) => game.id).sort().join(':');
  }
  seenCombinations.add(selectedIds);
  selected = shuffle(selected);

  for (const game of selected) {
    assignmentCounts.set(game.id, (assignmentCounts.get(game.id) || 0) + 1);
  }
  return selected;
}
