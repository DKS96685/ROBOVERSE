-- Run after the consolidated migration; read-only.
SELECT
    (SELECT count(*) FROM "Team") AS "teams",
    (SELECT count(*) FROM "Project") AS "projects",
    (SELECT count(*) FROM "Game") AS "games",
    (SELECT count(*) FROM "TeamGame") AS "team_games",
    (SELECT count(*) FROM "GameSession") AS "game_sessions",
    (SELECT count(*) FROM "LifelineEvent") AS "lifeline_events",
    (SELECT count(*) FROM "ProjectHint") AS "normalized_hints",
    (SELECT count(*) FROM "ComponentQuestion") AS "recovery_questions",
    (SELECT count(*) FROM "ComponentAnswerOption") AS "recovery_answer_options",
    (SELECT count(*) FROM "RecoveryPuzzle") AS "recovery_puzzles",
    (SELECT count(*) FROM "RecoveryPuzzleAttempt") AS "puzzle_attempts",
    (SELECT count(*) FROM "ProjectClueUnlock") AS "clue_unlocks";

-- Must return zero: all non-empty legacy fixed hints should have a normalized copy.
SELECT count(*) AS "unbackfilled_legacy_hints"
FROM "Project" p
JOIN "Game" g ON (
    (g."game_key" = 'snake' AND btrim(p."snake_hint") <> '')
    OR (g."game_key" = 'pong' AND btrim(p."pong_hint") <> '')
    OR (g."game_key" = 'memory' AND btrim(p."memory_hint") <> '')
)
LEFT JOIN "ProjectHint" h
    ON h."project_id" = p."id" AND h."game_id" = g."id"
WHERE h."id" IS NULL
   OR h."clue_text" <> CASE g."game_key"
        WHEN 'snake' THEN p."snake_hint"
        WHEN 'pong' THEN p."pong_hint"
        WHEN 'memory' THEN p."memory_hint"
      END;

-- Both verification sets must return no rows.
WITH expected_constraints("constraint_name") AS (
    VALUES
        ('Admin_pkey'), ('Team_pkey'), ('Project_pkey'), ('ProjectHint_pkey'),
        ('Member_pkey'), ('Game_pkey'), ('GameSession_pkey'), ('TeamGame_pkey'),
        ('LifelineEvent_pkey'), ('EventState_pkey'), ('AuditLog_pkey'),
        ('ComponentQuestion_pkey'), ('ComponentAnswerOption_pkey'),
        ('RecoveryPuzzle_pkey'), ('RecoveryPuzzleAttempt_pkey'),
        ('ProjectClueUnlock_pkey'), ('TeamScore_pkey'),
        ('Team_project_id_fkey'), ('ProjectHint_project_id_fkey'),
        ('ProjectHint_game_id_fkey'), ('Member_team_id_fkey'),
        ('GameSession_team_id_fkey'), ('GameSession_game_id_fkey'),
        ('TeamGame_team_id_fkey'), ('TeamGame_game_id_fkey'),
        ('LifelineEvent_team_id_fkey'), ('LifelineEvent_game_id_fkey'),
        ('AuditLog_team_id_fkey'), ('ComponentAnswerOption_question_id_fkey'),
        ('RecoveryPuzzle_team_id_fkey'), ('RecoveryPuzzle_team_game_id_fkey'),
        ('RecoveryPuzzle_question_id_fkey'),
        ('RecoveryPuzzleAttempt_puzzle_id_fkey'),
        ('RecoveryPuzzleAttempt_team_id_fkey'),
        ('ProjectClueUnlock_team_id_fkey'), ('ProjectClueUnlock_project_id_fkey'),
        ('ProjectClueUnlock_game_id_fkey'), ('ProjectClueUnlock_team_game_id_fkey'),
        ('TeamScore_team_id_fkey')
)
SELECT expected."constraint_name"
FROM expected_constraints expected
LEFT JOIN pg_constraint actual ON actual.conname = expected."constraint_name"
WHERE actual.oid IS NULL
ORDER BY expected."constraint_name";

WITH expected_indexes("index_name") AS (
    VALUES
        ('Admin_email_key'), ('Team_name_key'), ('Team_login_id_key'),
        ('Team_project_id_idx'), ('Project_name_key'),
        ('ProjectHint_game_id_idx'), ('ProjectHint_project_id_game_id_key'),
        ('Game_game_key_key'), ('GameSession_team_id_result_idx'),
        ('GameSession_team_id_team_game_id_attempt_number_key'),
        ('TeamGame_team_id_status_idx'), ('TeamGame_team_id_game_id_key'),
        ('TeamGame_assignment_run_id_team_id_assigned_order_key'),
        ('ComponentAnswerOption_question_id_sort_order_idx'),
        ('ComponentAnswerOption_question_id_option_text_key'),
        ('RecoveryPuzzle_question_id_idx'), ('RecoveryPuzzle_team_id_team_game_id_key'),
        ('RecoveryPuzzleAttempt_puzzle_id_attempted_at_idx'),
        ('RecoveryPuzzleAttempt_team_id_attempted_at_idx'),
        ('ProjectClueUnlock_team_id_unlocked_at_idx'),
        ('ProjectClueUnlock_team_id_project_id_game_id_key'),
        ('TeamScore_team_id_key')
)
SELECT expected."index_name"
FROM expected_indexes expected
LEFT JOIN pg_indexes actual ON actual.indexname = expected."index_name"
WHERE actual.indexname IS NULL
ORDER BY expected."index_name";
