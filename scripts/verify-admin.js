const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

for (const f of ['.env']) {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch (e) {}
}

(async () => {
  const prisma = new PrismaClient();
  const email = process.argv[2];
  const pw = process.argv[3];
  const host = (process.env.DATABASE_URL || '').split('@')[1]?.split('/')[0];
  console.log('DB host:', host);
  console.log('.env.local exists:', fs.existsSync(path.join(__dirname, '..', '.env.local')));
  const a = await prisma.admin.findUnique({ where: { email } });
  console.log('Admin found:', !!a);
  if (a) console.log('Password matches:', await bcrypt.compare(pw, a.password_hash));
  await prisma.$disconnect();
})();
