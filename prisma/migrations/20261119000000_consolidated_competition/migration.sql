BEGIN;

-- Existing project fixed hints are retained in their legacy columns and copied
-- into the normalized table used by the application.
CREATE TABLE "ProjectHint" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "clue_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectHint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectHint_project_id_game_id_key"
    ON "ProjectHint"("project_id", "game_id");

INSERT INTO "ProjectHint" ("id", "project_id", "game_id", "clue_text", "updated_at")
SELECT md5('project_hint:snake:' || p."id" || ':' || g."id"),
       p."id", g."id", p."snake_hint", CURRENT_TIMESTAMP
FROM "Project" p
JOIN "Game" g ON g."game_key" = 'snake'
WHERE btrim(p."snake_hint") <> ''
ON CONFLICT ("project_id", "game_id") DO NOTHING;

INSERT INTO "ProjectHint" ("id", "project_id", "game_id", "clue_text", "updated_at")
SELECT md5('project_hint:pong:' || p."id" || ':' || g."id"),
       p."id", g."id", p."pong_hint", CURRENT_TIMESTAMP
FROM "Project" p
JOIN "Game" g ON g."game_key" = 'pong'
WHERE btrim(p."pong_hint") <> ''
ON CONFLICT ("project_id", "game_id") DO NOTHING;

INSERT INTO "ProjectHint" ("id", "project_id", "game_id", "clue_text", "updated_at")
SELECT md5('project_hint:memory:' || p."id" || ':' || g."id"),
       p."id", g."id", p."memory_hint", CURRENT_TIMESTAMP
FROM "Project" p
JOIN "Game" g ON g."game_key" = 'memory'
WHERE btrim(p."memory_hint") <> ''
ON CONFLICT ("project_id", "game_id") DO NOTHING;

-- The old unique project assignment prevented multiple teams sharing a project.
DROP INDEX "Team_project_id_key";
CREATE INDEX "Team_project_id_idx" ON "Team"("project_id");

ALTER TABLE "GameSession"
    ADD COLUMN "team_game_id" TEXT,
    ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "validated_target" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "winning_state" TEXT,
    ADD COLUMN "submission_key" TEXT;

CREATE INDEX "GameSession_team_id_result_idx" ON "GameSession"("team_id", "result");
CREATE UNIQUE INDEX "GameSession_team_id_team_game_id_attempt_number_key"
    ON "GameSession"("team_id", "team_game_id", "attempt_number");

ALTER TABLE "TeamGame"
    ADD COLUMN "assignment_run_id" TEXT,
    ADD COLUMN "assigned_order" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lifeline_used" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "started_at" TIMESTAMP(3),
    ADD COLUMN "completed_at" TIMESTAMP(3),
    ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';

CREATE INDEX "TeamGame_team_id_status_idx" ON "TeamGame"("team_id", "status");
CREATE UNIQUE INDEX "TeamGame_assignment_run_id_team_id_assigned_order_key"
    ON "TeamGame"("assignment_run_id", "team_id", "assigned_order");

ALTER TABLE "LifelineEvent"
    ADD COLUMN "team_game_id" TEXT,
    ADD COLUMN "session_id" TEXT;

CREATE TABLE "ComponentQuestion" (
    "id" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "correct_answer" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComponentQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComponentAnswerOption" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "option_text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ComponentAnswerOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComponentAnswerOption_question_id_option_text_key"
    ON "ComponentAnswerOption"("question_id", "option_text");
CREATE INDEX "ComponentAnswerOption_question_id_sort_order_idx"
    ON "ComponentAnswerOption"("question_id", "sort_order");

CREATE TABLE "RecoveryPuzzle" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "team_game_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecoveryPuzzle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryPuzzle_team_id_team_game_id_key"
    ON "RecoveryPuzzle"("team_id", "team_game_id");
CREATE INDEX "RecoveryPuzzle_question_id_idx" ON "RecoveryPuzzle"("question_id");

CREATE TABLE "RecoveryPuzzleAttempt" (
    "id" TEXT NOT NULL,
    "puzzle_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "selected_answer" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryPuzzleAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecoveryPuzzleAttempt_puzzle_id_attempted_at_idx"
    ON "RecoveryPuzzleAttempt"("puzzle_id", "attempted_at");
CREATE INDEX "RecoveryPuzzleAttempt_team_id_attempted_at_idx"
    ON "RecoveryPuzzleAttempt"("team_id", "attempted_at");

CREATE TABLE "ProjectClueUnlock" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "team_game_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "unlocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectClueUnlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectClueUnlock_team_id_project_id_game_id_key"
    ON "ProjectClueUnlock"("team_id", "project_id", "game_id");
CREATE INDEX "ProjectClueUnlock_team_id_unlocked_at_idx"
    ON "ProjectClueUnlock"("team_id", "unlocked_at");

CREATE TABLE "TeamScore" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "completed_games" INTEGER NOT NULL DEFAULT 0,
    "lifeline_used" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamScore_team_id_key" ON "TeamScore"("team_id");

ALTER TABLE "ProjectHint"
    ADD CONSTRAINT "ProjectHint_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ProjectHint_game_id_fkey"
    FOREIGN KEY ("game_id") REFERENCES "Game"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ProjectHint_game_id_idx" ON "ProjectHint"("game_id");

ALTER TABLE "ComponentAnswerOption"
    ADD CONSTRAINT "ComponentAnswerOption_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "ComponentQuestion"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecoveryPuzzle"
    ADD CONSTRAINT "RecoveryPuzzle_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "Team"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "RecoveryPuzzle_team_game_id_fkey"
    FOREIGN KEY ("team_game_id") REFERENCES "TeamGame"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "RecoveryPuzzle_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "ComponentQuestion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecoveryPuzzleAttempt"
    ADD CONSTRAINT "RecoveryPuzzleAttempt_puzzle_id_fkey"
    FOREIGN KEY ("puzzle_id") REFERENCES "RecoveryPuzzle"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "RecoveryPuzzleAttempt_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "Team"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectClueUnlock"
    ADD CONSTRAINT "ProjectClueUnlock_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "Team"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ProjectClueUnlock_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ProjectClueUnlock_game_id_fkey"
    FOREIGN KEY ("game_id") REFERENCES "Game"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ProjectClueUnlock_team_game_id_fkey"
    FOREIGN KEY ("team_game_id") REFERENCES "TeamGame"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamScore"
    ADD CONSTRAINT "TeamScore_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "Team"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
