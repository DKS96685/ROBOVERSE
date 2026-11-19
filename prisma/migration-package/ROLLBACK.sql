-- Guarded schema rollback for the consolidated migration.
-- Prefer restoring the complete pre-migration BACKUP.ps1 dump to a separate
-- database and switching the application back. Do not execute this file unless
-- the application has been stopped and all guards below pass.
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "RecoveryPuzzle")
       OR EXISTS (SELECT 1 FROM "RecoveryPuzzleAttempt")
       OR EXISTS (SELECT 1 FROM "ProjectClueUnlock")
       OR EXISTS (SELECT 1 FROM "TeamScore")
       OR EXISTS (SELECT 1 FROM "ComponentQuestion")
       OR EXISTS (SELECT 1 FROM "ComponentAnswerOption") THEN
        RAISE EXCEPTION 'Rollback refused: post-migration competition data exists. Restore the verified pre-migration backup or perform a reviewed data merge.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "TeamGame"
        WHERE "assignment_run_id" IS NOT NULL OR "required" OR "points" <> 0
           OR "attempt_count" <> 0 OR "lifeline_used"
           OR "started_at" IS NOT NULL OR "completed_at" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Rollback refused: assignment or score history exists. Restore the verified pre-migration backup or perform a reviewed data merge.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "GameSession"
        WHERE "team_game_id" IS NOT NULL OR "attempt_number" <> 1
           OR "validated_target" <> 3 OR "winning_state" IS NOT NULL OR "submission_key" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Rollback refused: game session history uses new fields. Restore the verified pre-migration backup or perform a reviewed data merge.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "LifelineEvent"
        WHERE "team_game_id" IS NOT NULL OR "session_id" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Rollback refused: lifeline event references use new fields. Restore the verified pre-migration backup or perform a reviewed data merge.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "ProjectHint" h
        JOIN "Game" g ON g."id" = h."game_id"
        WHERE g."game_key" NOT IN ('snake', 'pong', 'memory')
    ) THEN
        RAISE EXCEPTION 'Rollback refused: normalized hints cannot all be represented by legacy fixed-hint columns.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "Team"
        WHERE "project_id" IS NOT NULL
        GROUP BY "project_id"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Rollback refused: teams now share a project, so the former unique project index cannot be restored.';
    END IF;
END $$;

UPDATE "Project" p SET "snake_hint" = h."clue_text"
FROM "ProjectHint" h JOIN "Game" g ON g."id" = h."game_id"
WHERE h."project_id" = p."id" AND g."game_key" = 'snake';
UPDATE "Project" p SET "pong_hint" = h."clue_text"
FROM "ProjectHint" h JOIN "Game" g ON g."id" = h."game_id"
WHERE h."project_id" = p."id" AND g."game_key" = 'pong';
UPDATE "Project" p SET "memory_hint" = h."clue_text"
FROM "ProjectHint" h JOIN "Game" g ON g."id" = h."game_id"
WHERE h."project_id" = p."id" AND g."game_key" = 'memory';

DROP TABLE "ProjectClueUnlock";
DROP TABLE "RecoveryPuzzleAttempt";
DROP TABLE "RecoveryPuzzle";
DROP TABLE "ComponentAnswerOption";
DROP TABLE "ComponentQuestion";
DROP TABLE "TeamScore";
DROP TABLE "ProjectHint";

DROP INDEX "TeamGame_team_id_status_idx";
DROP INDEX "TeamGame_assignment_run_id_team_id_assigned_order_key";
ALTER TABLE "TeamGame"
    DROP COLUMN "assignment_run_id",
    DROP COLUMN "assigned_order",
    DROP COLUMN "required",
    DROP COLUMN "points",
    DROP COLUMN "attempt_count",
    DROP COLUMN "lifeline_used",
    DROP COLUMN "started_at",
    DROP COLUMN "completed_at",
    ALTER COLUMN "status" SET DEFAULT 'locked';

DROP INDEX "GameSession_team_id_result_idx";
DROP INDEX "GameSession_team_id_team_game_id_attempt_number_key";
ALTER TABLE "GameSession"
    DROP COLUMN "team_game_id",
    DROP COLUMN "attempt_number",
    DROP COLUMN "validated_target",
    DROP COLUMN "winning_state",
    DROP COLUMN "submission_key";

ALTER TABLE "LifelineEvent"
    DROP COLUMN "team_game_id",
    DROP COLUMN "session_id";

DROP INDEX "Team_project_id_idx";
CREATE UNIQUE INDEX "Team_project_id_key" ON "Team"("project_id");

COMMIT;
