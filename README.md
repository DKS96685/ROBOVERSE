# ROBOVERSE Event Platform

Live gamified robotics web app for the 21 November 2026 event. Teams play three retro clue games and begin with five lifelines.

## Development

Install dependencies, configure `.env` using `.env.example`, then start the app:

```bash
npm install
npm run dev
```

For local database development, apply the Prisma schema to a PostgreSQL database:

```bash
npm run db:push
```

Create the initial admin using `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables:

```bash
npm run create-admin
```

## Production

```bash
npm run build
npm start
```

The app uses server timestamps for the event clock and enforces minimum play times when validating game wins. Teams receive clue text only after completing or skipping its game. Admins control the event, manage teams, review the leaderboard, and audit supported actions.
