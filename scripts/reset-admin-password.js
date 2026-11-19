const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

// Load .env without needing dotenv
try {
  const lines = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch (e) {}

const email = process.argv[2];
const password = process.argv[3];

async function main() {
  const prisma = new PrismaClient();
  try {
    const admins = await prisma.admin.findMany({ select: { email: true } });
    console.log('Admins in this database:', admins.map((a) => a.email).join(', ') || 'none');
    if (!email || !password) {
      console.log('Usage: node scripts/reset-admin-password.js <email> <new-password>');
      return;
    }
    if (password.length < 10) {
      console.log('Password must be at least 10 characters.');
      return;
    }
    if (!admins.some((a) => a.email === email)) {
      console.log('No admin with that email. Use one from the list above.');
      return;
    }
    const password_hash = await bcrypt.hash(password, 10);
    await prisma.admin.update({ where: { email }, data: { password_hash } });
    console.log('Password updated for', email);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Failed:', e.code || e.message);
  process.exit(1);
});