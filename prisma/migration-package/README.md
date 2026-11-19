# Consolidated competition migration package

This package targets only the checked-in migration history:

1. `20261116132503_init`
2. `20261118010000_projects_game_state`
3. `20261119000000_consolidated_competition` (the single new consolidated delta)

The migration has **not** been executed and no database was modified. Do not apply it until a database owner has inspected the preflight output, created and verified a backup, reconciled any unmatched legacy hints, and approved the production change.

## Order of operations

1. On a read-only connection to the exact target database, run `PREFLIGHT.sql`. Stop if either baseline migration is missing/failed, or if any legacy fixed hint has no matching `Game` row. Compare its row counts with the expected production inventory.
2. Create and verify a custom-format dump to an explicit path:

   ```powershell
   $env:DATABASE_URL = '<set securely in this shell; do not paste it into source control>'
   .\prisma\migration-package\BACKUP.ps1 -BackupPath 'D:\secure-backups\roboverse-pre-migration.dump'
   ```

3. Review the backup retention/access policy and restore the dump to an isolated database to confirm it is usable.
4. With separate approval, apply only the `20261119000000_consolidated_competition` migration using the normal Prisma migration process. Do not use `prisma db push`.
5. Run `VERIFY.sql` and compare its counts with the recorded preflight counts. `unbackfilled_legacy_hints` must be zero. Confirm `Project.snake_hint`, `pong_hint`, and `memory_hint` remain intact; the migration intentionally retains those columns as a rollback/archive copy.

The migration backfills normalized `ProjectHint` rows only when the matching `Game` row exists; it never deletes or overwrites the legacy fixed hints. Existing teams, projects, games, TeamGame rows, GameSession rows, LifelineEvent rows, and audit history are retained. The former unique Team-to-Project index becomes a non-unique index because multiple teams may share a project.

## Rollback

Preferred rollback is to stop the app, restore the verified full pre-migration dump into a separate database, validate it, and switch the application back only after approval. `ROLLBACK.sql` is a guarded schema rollback for a still-empty migration: it refuses to proceed when new assignments, sessions, lifeline references, puzzle data, scores, or non-legacy hints exist. If it is used successfully, reconcile Prisma's migration history with `prisma migrate resolve --rolled-back 20261119000000_consolidated_competition` only after reviewing the schema and with separate approval. This rollback must not be used to erase production activity. Preserve the post-migration database and do a reviewed merge if new competition activity has already occurred.
