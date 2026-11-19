-- Read-only preflight. Run against the intended database before backup or approval.
DO $$
BEGIN
    IF to_regclass('public."_prisma_migrations"') IS NULL THEN
        RAISE EXCEPTION 'Prisma migration history is missing; stop and reconcile this database first.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE "migration_name" = '20261116132503_init'
          AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
    ) OR NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE "migration_name" = '20261118010000_projects_game_state'
          AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
    ) THEN
        RAISE EXCEPTION 'Expected baseline migrations are not both applied successfully; stop and reconcile first.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE "migration_name" IN ('20261116132503_init', '20261118010000_projects_game_state')
          AND "finished_at" IS NULL AND "rolled_back_at" IS NULL
    ) THEN
        RAISE EXCEPTION 'A baseline migration is unfinished or failed; stop and repair migration history first.';
    END IF;
    IF to_regclass('public."Project"') IS NULL
       OR to_regclass('public."Team"') IS NULL
       OR to_regclass('public."TeamGame"') IS NULL
       OR to_regclass('public."GameSession"') IS NULL
       OR to_regclass('public."LifelineEvent"') IS NULL
       OR to_regclass('public."Game"') IS NULL THEN
        RAISE EXCEPTION 'A table required by the checked-in migration history is missing.';
    END IF;
END $$;

SELECT "migration_name", "finished_at", "rolled_back_at"
FROM "_prisma_migrations"
WHERE "migration_name" IN (
    '20261116132503_init',
    '20261118010000_projects_game_state',
    '20261119000000_consolidated_competition'
)
ORDER BY "migration_name";

-- Record current row counts before upgrade; this script does not change data.
SELECT 'Team' AS "table_name", count(*) AS "rows" FROM "Team"
UNION ALL SELECT 'Project', count(*) FROM "Project"
UNION ALL SELECT 'Game', count(*) FROM "Game"
UNION ALL SELECT 'TeamGame', count(*) FROM "TeamGame"
UNION ALL SELECT 'GameSession', count(*) FROM "GameSession"
UNION ALL SELECT 'LifelineEvent', count(*) FROM "LifelineEvent";

SELECT count(*) AS "nonempty_legacy_fixed_hints"
FROM "Project"
WHERE btrim("snake_hint") <> ''
   OR btrim("pong_hint") <> ''
   OR btrim("memory_hint") <> '';

-- Any returned row indicates a legacy fixed hint that cannot yet be copied
-- because the corresponding Game record is missing.
SELECT p."id" AS "project_id", 'snake' AS "missing_game_key"
FROM "Project" p
WHERE btrim(p."snake_hint") <> ''
  AND NOT EXISTS (SELECT 1 FROM "Game" g WHERE g."game_key" = 'snake')
UNION ALL
SELECT p."id", 'pong'
FROM "Project" p
WHERE btrim(p."pong_hint") <> ''
  AND NOT EXISTS (SELECT 1 FROM "Game" g WHERE g."game_key" = 'pong')
UNION ALL
SELECT p."id", 'memory'
FROM "Project" p
WHERE btrim(p."memory_hint") <> ''
  AND NOT EXISTS (SELECT 1 FROM "Game" g WHERE g."game_key" = 'memory');
