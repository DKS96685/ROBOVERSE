# ROBOVERSE — Live Gamified Robotics Event Platform

ROBOVERSE is a live gamified robotics competition platform for the 21 November 2026 event. Teams compete through three randomly allocated arcade-style clue games selected from the enabled game library, solve component-identification recovery challenges, and discover project clues.

## Competition Rules

- Every team receives exactly 3 distinct randomly allocated games.
- The game library can contain 6–10 enabled games.
- Each team receives exactly ONE lifeline for the entire competition.
- A normal game completion awards 10 points.
- A completion using the lifeline retry awards 5 points.
- A failed or skipped game awards 0 points.
- Maximum possible score is 30 points.
- Losing a game or using a lifeline does not eliminate a team.
- If a team cannot retry, it can solve a component-identification MCQ to unlock the clue for that failed game and continue.
- Teams see only their assigned project and legitimately unlocked clues.
- The leaderboard is accessible only to administrators.

## Platform Features

The following features are present in the repository:

- Admin and team authentication, team registration, and project assignment.
- Admin dashboard and event pause/resume controls.
- Six arcade game interfaces: Snake, Pong, Memory, Target Sequence, Lights Out, and Quick Maze, with desktop and mobile controls.
- An admin-protected leaderboard route.
- Application code for randomized persistent game allocation, lifeline retries, recovery puzzles, project-specific game clues, and server-side scoring.
- Server-owned progress simulation for Snake and Pong, server-owned card/deck state for Memory, and validated server state/actions for the other included games.
- Component image uploads validated by MIME signature and a 2 MB limit, stored in a private Neon Object Storage bucket with server-generated signed preview URLs.

The randomized allocation, lifeline, recovery puzzle, clue, and scoring flows depend on Prisma schema additions that are not represented in the checked-in migration history. A consolidated database migration has not been applied, so these flows are not ready to use against the current database.

The game progress API simulates Snake movement and collisions, Pong ball/paddle outcomes, and Memory card matching on the server. Client-side scores are not authoritative. These application paths still require database migration and end-to-end testing against the event database before they can be used in production.

The private image bucket is declared in `neon.ts` but has not been provisioned. After confirming the linked Neon production branch, an administrator must run `neon deploy` and configure the injected `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and `AWS_REGION` values in the app host's server environment. Do not expose these values to client-side code or commit them. Neon Object Storage is not a separate paid provider, but usage is subject to Neon plan limits and billing. Existing `/uploads/...` image references must be re-uploaded through the admin puzzle editor before serverless deployment; their old local files are not durable.

Do not treat the listed features or competition rules as proof that the platform is production-ready. Before the event, reconcile and review the database migration, configure persistent puzzle-image storage, apply the database migration only with explicit approval, and complete end-to-end testing of assignments, retries, recovery puzzles, clue access, scoring, and pause/resume behavior.

## Development Setup

Requirements: Node.js, npm, and a PostgreSQL database.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local `.env` file from `.env.example` and configure the required environment variables. Keep credentials and `.env` out of Git.

3. Start the development server:

   ```bash
   npm run dev
   ```

The repository provides `npm run db:push` for `prisma db push` and `npm run prisma:migrate` for `prisma migrate deploy`. Both modify a database. The checked-in schema is ahead of the migration history; do not run either command against a shared or production database until the consolidated migration has been reviewed and explicitly approved.

Create an admin account with the configured `ADMIN_EMAIL` and `ADMIN_PASSWORD`:

```bash
npm run create-admin
```

## Production Commands

```bash
npm run build
npm start
```

These commands build and start the Next.js application; they do not apply database migrations or verify that the production database is compatible.
