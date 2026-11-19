import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';
import { GAME_RULES } from '@/lib/config/gameRules';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function generateRandomPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('admin');
    const { rows } = await req.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No valid team rows provided in CSV payload.' }, { status: 400 });
    }

    const currentTeamCount = await prisma.team.count();
    if (currentTeamCount + rows.length > GAME_RULES.MAX_TEAMS) {
      return NextResponse.json(
        {
          error: `Importing ${rows.length} teams would exceed the maximum limit of ${GAME_RULES.MAX_TEAMS} teams (currently ${currentTeamCount} registered).`,
        },
        { status: 400 }
      );
    }

    // Validate rows
    const seenNames = new Set<string>();
    const sanitizedRows: { name: string; members: [string, string, string]; projectId: string | null }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r.name || r['Team Name'] || '').trim();
      const m1 = String(r.member1 || r['Member 1'] || '').trim();
      const m2 = String(r.member2 || r['Member 2'] || '').trim();
      const m3 = String(r.member3 || r['Member 3'] || '').trim();

      if (!name || name.length < 2) {
        return NextResponse.json({ error: `Row ${i + 1}: Team name is missing or too short.` }, { status: 400 });
      }

      const lowerName = name.toLowerCase();
      if (seenNames.has(lowerName)) {
        return NextResponse.json({ error: `Row ${i + 1}: Duplicate team name "${name}" in CSV batch.` }, { status: 400 });
      }
      seenNames.add(lowerName);

      if (!m1 || !m2 || !m3) {
        return NextResponse.json(
          { error: `Row ${i + 1} (${name}): Each team must have all 3 member names filled.` },
          { status: 400 }
        );
      }

      sanitizedRows.push({
        name,
        members: [m1, m2, m3],
        projectId: String(r.projectId || r['Project ID'] || '').trim() || null,
      });
    }

    // Check existing names in DB
    const existingTeams = await prisma.team.findMany({
      select: { name: true, login_id: true, project_id: true },
    });
    const existingDbNames = new Set(existingTeams.map((t) => t.name.toLowerCase()));
    for (const row of sanitizedRows) {
      if (existingDbNames.has(row.name.toLowerCase())) {
        return NextResponse.json(
          { error: `Team name "${row.name}" is already registered in the database.` },
          { status: 400 }
        );
      }
    }

    const projectRows = await prisma.project.findMany({
      select: { id: true, name: true },
    });
    const projectById = new Map(projectRows.map((project) => [project.id, project]));
    for (const row of sanitizedRows) {
      if (!row.projectId) continue;
      const project = projectById.get(row.projectId);
      if (!project) {
        return NextResponse.json({ error: `Project ID "${row.projectId}" does not exist.` }, { status: 400 });
      }
      row.projectId = project.id;
    }

    // Prepare sequential login IDs
    const usedIds = new Set(existingTeams.map((t) => t.login_id.toLowerCase()));
    let nextNum = 1;

    const allGames = await prisma.game.findMany({ orderBy: { order_num: 'asc' } });
    const createdCredentials: {
      teamName: string;
      loginId: string;
      password: string;
      member1: string;
      member2: string;
      member3: string;
    }[] = [];

    for (const item of sanitizedRows) {
      while (usedIds.has(`team${String(nextNum).padStart(2, '0')}`)) {
        nextNum++;
      }
      const loginId = `team${String(nextNum).padStart(2, '0')}`;
      usedIds.add(loginId);

      const plainPassword = generateRandomPassword();
      const passwordHash = await bcrypt.hash(plainPassword, 12);

      const team = await prisma.team.create({
        data: {
          name: item.name,
          login_id: loginId,
          password_hash: passwordHash,
          project_id: item.projectId,
          active: true,
          members: {
            create: [
              { name: item.members[0] },
              { name: item.members[1] },
              { name: item.members[2] },
            ],
          },
        },
      });

      for (let gIdx = 0; gIdx < allGames.length; gIdx++) {
        await prisma.teamGame.create({
          data: {
            team_id: team.id,
            game_id: allGames[gIdx].id,
            status: gIdx === 0 ? 'available' : 'locked',
            updated_by: 'system',
          },
        });
      }

      createdCredentials.push({
        teamName: item.name,
        loginId,
        password: plainPassword,
        member1: item.members[0],
        member2: item.members[1],
        member3: item.members[2],
      });
    }

    await logAuditEvent({
      actor: session.email || 'admin',
      action: 'team_import_csv',
      after: { importedCount: createdCredentials.length },
    });

    return NextResponse.json({
      success: true,
      message: `Successfully registered ${createdCredentials.length} teams.`,
      credentials: createdCredentials,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to import CSV' }, { status: 500 });
  }
}
