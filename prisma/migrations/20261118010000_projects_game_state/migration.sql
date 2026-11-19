CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "snake_hint" TEXT NOT NULL,
    "pong_hint" TEXT NOT NULL,
    "memory_hint" TEXT NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Team" ADD COLUMN "project_id" TEXT;

ALTER TABLE "GameSession"
ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "game_state" JSONB,
ADD COLUMN "pause_started_at" TIMESTAMP(3),
ADD COLUMN "paused_seconds" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");
CREATE UNIQUE INDEX "Team_project_id_key" ON "Team"("project_id");

ALTER TABLE "Team"
ADD CONSTRAINT "Team_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
