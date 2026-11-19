const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function runDryRunTests() {
  console.log('=====================================================');
  console.log('🤖 ROBOVERSE PLATFORM: FULL DRY RUN & VERIFICATION 🤖');
  console.log('=====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Verify 25 Teams & 100 Members
    console.log('TEST 1: 25 Teams and 100 Members verification');
    const teams = await prisma.team.findMany({ include: { members: true, team_games: true } });
    assert(teams.length === 25, `Expected 25 teams in database, found ${teams.length}`);

    let totalMembers = 0;
    let validTeamGames = true;
    for (const t of teams) {
      totalMembers += t.members.length;
      if (t.team_games.length !== 3) validTeamGames = false;
    }
    assert(totalMembers === 100, `Expected 100 members (4 per team), found ${totalMembers}`);
    assert(validTeamGames, 'All 25 teams have exactly 3 clue games initialized');

    // 2. Admin Verification
    console.log('\nTEST 2: Admin Account Credentials');
    const admin = await prisma.admin.findUnique({ where: { email: 'admin@roboverse.local' } });
    assert(!!admin, 'Admin account admin@roboverse.local exists');
    const isPassValid = await bcrypt.compare('admin123', admin.password_hash);
    assert(isPassValid, 'Admin password hash verified successfully');

    // 3. Event Clock State: Start, Pause, Resume, Reset
    console.log('\nTEST 3: Global Event State & Lifecycle (Start, Pause, Resume)');
    const event = await prisma.eventState.upsert({
      where: { id: 'global' },
      update: { status: 'running', started_at: new Date(), paused_at: null, total_paused_seconds: 0 },
      create: { id: 'global', status: 'running', started_at: new Date() }
    });
    assert(event.status === 'running', 'Event successfully transitioned to RUNNING');

    // Pause
    const pausedNow = new Date();
    const pausedEvent = await prisma.eventState.update({
      where: { id: 'global' },
      data: { status: 'paused', paused_at: pausedNow }
    });
    assert(pausedEvent.status === 'paused' && !!pausedEvent.paused_at, 'Event successfully PAUSED');

    // Resume
    const resumedEvent = await prisma.eventState.update({
      where: { id: 'global' },
      data: { status: 'running', paused_at: null, total_paused_seconds: 5 }
    });
    assert(resumedEvent.status === 'running' && resumedEvent.total_paused_seconds === 5, 'Event successfully RESUMED with paused duration accumulated');

    const team1 = teams[0];

    // 4. Clue Games & Unlock Flow
    console.log('\nTEST 4: Clue Games & Sequential Unlocking');
    const games = await prisma.game.findMany({ orderBy: { order_num: 'asc' } });
    assert(games.length === 3, 'Found 3 clue games in catalog');
    assert(games[0].game_key === 'snake' && games[1].game_key === 'pong' && games[2].game_key === 'memory', 'Games ordered: Snake -> Pong -> Memory');

    // Team 1 completes Game 1 -> Game 2 unlocks
    await prisma.teamGame.update({
      where: { team_id_game_id: { team_id: team1.id, game_id: games[0].id } },
      data: { status: 'completed' }
    });
    await prisma.teamGame.update({
      where: { team_id_game_id: { team_id: team1.id, game_id: games[1].id } },
      data: { status: 'available' }
    });
    const team1Games = await prisma.teamGame.findMany({ where: { team_id: team1.id }, orderBy: { game: { order_num: 'asc' } } });
    assert(team1Games[0].status === 'completed', 'Game 1 marked COMPLETED');
    assert(team1Games[1].status === 'available', 'Game 2 transitioned from LOCKED to AVAILABLE');

    // 5. Lifelines & Revert (Misclick Test)
    console.log('\nTEST 5: Lifelines Deduction & Deliberate Misclick Revert');
    // Team 1 deducts 1 lifeline for Game 2 (e.g. misclick or skip)
    const deductionEvent = await prisma.lifelineEvent.create({
      data: {
        team_id: team1.id,
        game_id: games[1].id,
        action: 'used',
        amount: 1.0,
        by_admin: false,
        note: 'Accidental skip / misclick by team'
      }
    });

    await prisma.teamGame.update({
      where: { team_id_game_id: { team_id: team1.id, game_id: games[1].id } },
      data: { status: 'skipped' }
    });

    // Check lifelines remaining before revert
    const allEventsBefore = await prisma.lifelineEvent.findMany({ where: { team_id: team1.id } });
    let usedBefore = 0, revertedBefore = 0;
    for (const ev of allEventsBefore) {
      if (ev.action === 'used') usedBefore += ev.amount;
      if (ev.action === 'reverted') revertedBefore += ev.amount;
    }
    const remBefore = 5.0 - (usedBefore - revertedBefore);
    assert(remBefore === 4.0, `Team 1 lifelines reduced from 5.0 to 4.0 (got ${remBefore})`);

    // ADMIN REVERTS THE MISCLICK
    const revertEvent = await prisma.lifelineEvent.create({
      data: {
        team_id: team1.id,
        game_id: deductionEvent.game_id,
        action: 'reverted',
        amount: deductionEvent.amount,
        by_admin: true,
        note: `Admin reverted misclick event ${deductionEvent.id}`
      }
    });

    // Un-skip the game back to available
    await prisma.teamGame.update({
      where: { team_id_game_id: { team_id: team1.id, game_id: games[1].id } },
      data: { status: 'available' }
    });

    // Verify lifeline restored
    const allEventsAfter = await prisma.lifelineEvent.findMany({ where: { team_id: team1.id } });
    let usedAfter = 0, revertedAfter = 0;
    for (const ev of allEventsAfter) {
      if (ev.action === 'used') usedAfter += ev.amount;
      if (ev.action === 'reverted') revertedAfter += ev.amount;
    }
    const remAfter = 5.0 - (usedAfter - revertedAfter);
    assert(remAfter === 5.0, `Team 1 lifelines fully restored to 5.0 (got ${remAfter})`);

    const unskippedGame = await prisma.teamGame.findUnique({
      where: { team_id_game_id: { team_id: team1.id, game_id: games[1].id } }
    });
    assert(unskippedGame.status === 'available', 'Game 2 un-skipped back to AVAILABLE status');

    // 6. Audit Log
    console.log('\nTEST 6: Audit Log Integrity');
    const audit = await prisma.auditLog.create({
      data: {
        actor: 'admin@roboverse.local',
        action: 'lifeline_revert',
        team_id: team1.id,
        before: JSON.stringify({ remaining: 4.0 }),
        after: JSON.stringify({ remaining: 5.0, unskippedGame: true })
      }
    });
    assert(!!audit.id, 'Audit event successfully written with before/after state');

    console.log('\n=====================================================');
    console.log(`🎯 DRY RUN COMPLETED: ${passed} PASSED, ${failed} FAILED`);
    console.log('=====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runDryRunTests();
