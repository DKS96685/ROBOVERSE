const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function readEnvFile(filePath) {
  const values = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/^export\s+/, '');

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[key] = value;
  }

  return values;
}

async function main() {
  const env = readEnvFile(path.resolve(__dirname, '..', '.env'));
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from .env');
  }

  process.env.DATABASE_URL = env.DATABASE_URL;
  if (env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL_UNPOOLED = env.DATABASE_URL_UNPOOLED;

  const databaseHost = new URL(env.DATABASE_URL).hostname;
  const prisma = new PrismaClient();

  try {
    const [adminCount, teamCount, admins] = await Promise.all([
      prisma.admin.count(),
      prisma.team.count(),
      prisma.$queryRawUnsafe(
        `SELECT email,
          (length(password_hash) = 60
            AND substring(password_hash from 1 for 4) IN ('$2a$', '$2b$', '$2y$'))
          AS "bcryptHashLooksValid"
         FROM "Admin"
         ORDER BY email`
      ),
    ]);

    console.log(JSON.stringify({
      databaseHost,
      adminCount,
      teamCount,
      admins,
      jwtSecretSet: Boolean(env.JWT_SECRET && env.JWT_SECRET.trim()),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const errorName = error && typeof error.name === 'string' ? error.name : 'Error';
  const errorCode = error && typeof error.code === 'string' ? `, code ${error.code}` : '';
  console.error(`Login setup diagnostic failed (${errorName}${errorCode}). Check that .env is readable and the database is reachable.`);
  process.exitCode = 1;
});
