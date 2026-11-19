const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('❌ ERROR: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.');
    console.error('Usage:');
    console.error('  Windows PowerShell: $env:ADMIN_EMAIL="admin@yourdomain.com"; $env:ADMIN_PASSWORD="YourStrongPassword"; npm run create-admin');
    console.error('  Linux / macOS:     ADMIN_EMAIL=admin@yourdomain.com ADMIN_PASSWORD=YourStrongPassword npm run create-admin');
    process.exit(1);
  }

  // Check if an admin already exists
  const existingAdminCount = await prisma.admin.count();
  if (existingAdminCount > 0) {
    console.error('❌ ERROR: Admin already exists. Use the admin panel to manage admins.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.admin.create({
    data: {
      email,
      password_hash: passwordHash,
      name: 'Event Administrator',
    },
  });

  // Ensure default Global EventState exists
  await prisma.eventState.upsert({
    where: { id: 'global' },
    update: {},
    create: {
      id: 'global',
      status: 'ready',
      total_paused_seconds: 0,
    },
  });

  // Ensure 3 default games exist as code shells with empty clues waiting for admin setup
  const gameDefs = [
    { game_key: 'snake', title: 'Cyber Serpent', order_num: 1, min_seconds: 15 },
    { game_key: 'pong', title: 'Circuit Deflector', order_num: 2, min_seconds: 20 },
    { game_key: 'memory', title: 'Neural Matrix', order_num: 3, min_seconds: 15 },
  ];

  for (const def of gameDefs) {
    await prisma.game.upsert({
      where: { game_key: def.game_key },
      update: {},
      create: {
        game_key: def.game_key,
        title: def.title,
        clue_text: '', // Empty: admin must configure
        min_seconds: def.min_seconds,
        enabled: true,
        order_num: def.order_num,
      },
    });
  }

  console.log('✅ First Administrator created successfully:');
  console.log(`   Email: ${admin.email}`);
  console.log('   Event initialized in READY state.');
}

main()
  .catch((err) => {
    console.error('❌ Failed to create administrator:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
