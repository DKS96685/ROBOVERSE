import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { teamCreateSchema, teamDeleteSchema, teamUpdateSchema } from '@/lib/validations';
import { logAuditEvent } from '@/lib/audit';
import { GAME_RULES } from '@/lib/config/gameRules';
import { deleteTeamForAdmin } from '@/lib/teamDeletion';
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
    const body = await req.json();
    const action = body.action;

    if (action === 'delete') {
      const parsed = teamDeleteSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: 'A valid team ID is required.' }, { status: 400 });
      }

      const team = await deleteTeamForAdmin(
        parsed.data.teamId,
        async () => session,
        (operation) => prisma.$transaction(operation, { isolationLevel: 'Serializable' })
      );

      return NextResponse.json({ success: true, team: { id: team.id, name: team.name, loginId: team.login_id } });
    }

    // 1. Single Team Manual Registration
    if (action === 'create') {
      const eventState = await prisma.eventState.findUnique({ where: { id: 'global' } });
      if (eventState && (eventState.status !== 'ready' || eventState.started_at)) {
        return NextResponse.json(
          { error: 'Teams cannot be registered after the event has started. Reset the event first.' },
          { status: 409 }
        );
      }

      const parsed = teamCreateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'Invalid team data' },
          { status: 400 }
        );
      }

      const { name, members, projectId } = parsed.data;

      // Check 25 team cap
      const currentTeamCount = await prisma.team.count();
      if (currentTeamCount >= GAME_RULES.MAX_TEAMS) {
        return NextResponse.json(
          { error: `Maximum limit of ${GAME_RULES.MAX_TEAMS} teams has been reached.` },
          { status: 400 }
        );
      }

      // Check duplicate name
      const existingName = await prisma.team.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });
      if (existingName) {
        return NextResponse.json(
          { error: `A team named "${name}" already exists.` },
          { status: 400 }
        );
      }

      // Determine lowest available team login ID (team01 to team25)
      const existingTeams = await prisma.team.findMany({ select: { login_id: true } });
      const usedIds = new Set(existingTeams.map((t) => t.login_id.toLowerCase()));
      const loginId = parsed.data.loginId.toLowerCase();
      if (usedIds.has(loginId)) {
        return NextResponse.json({ error: `Login ID "${loginId}" is already in use.` }, { status: 400 });
      }
      if (projectId) {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
          return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
        }
      }
      const plainPassword = parsed.data.password;
      const passwordHash = await bcrypt.hash(plainPassword, 12);

      const team = await prisma.team.create({
        data: {
          name,
          login_id: loginId,
          password_hash: passwordHash,
          project_id: projectId ?? null,
          active: true,
          members: {
            create: members.map((m) => ({ name: m })),
          },
        },
        include: { members: true },
      });

      // Link games
      const allGames = await prisma.game.findMany({ orderBy: { order_num: 'asc' } });
      for (let i = 0; i < allGames.length; i++) {
        await prisma.teamGame.create({
          data: {
            team_id: team.id,
            game_id: allGames[i].id,
            status: i === 0 ? 'available' : 'locked',
            updated_by: 'system',
          },
        });
      }

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'team_register',
        teamId: team.id,
        after: { loginId: team.login_id, name: team.name, members, projectId: team.project_id },
      });

      return NextResponse.json({
        success: true,
        team: {
          id: team.id,
          name: team.name,
          loginId: team.login_id,
          members: team.members.map((m) => m.name),
        },
        credentials: {
          loginId: team.login_id,
          password: plainPassword,
        },
      });
    }

    // 2. Edit Team Info & Members
    if (action === 'update_info') {
      const parsed = teamUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'Invalid update data' },
          { status: 400 }
        );
      }

      const { teamId, name, active, members, password, projectId } = parsed.data;

      const existingTeam = await prisma.team.findUnique({
        where: { id: teamId },
        include: { members: true },
      });

      if (!existingTeam) {
        return NextResponse.json({ error: 'Team not found' }, { status: 404 });
      }

      if (projectId !== undefined && projectId !== existingTeam.project_id) {
        const eventState = await prisma.eventState.findUnique({ where: { id: 'global' } });
        if (eventState && (eventState.status !== 'ready' || eventState.started_at)) {
          return NextResponse.json(
            { error: 'Project assignments cannot be changed after the event has started.' },
            { status: 409 }
          );
        }
      }

      if (projectId) {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
          return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
        }
      }

      if (name && name !== existingTeam.name) {
        const nameConflict = await prisma.team.findFirst({
          where: {
            name: { equals: name, mode: 'insensitive' },
            id: { not: teamId },
          },
        });
        if (nameConflict) {
          return NextResponse.json({ error: `Team name "${name}" is already taken.` }, { status: 400 });
        }
      }

      const updateData: any = {};
      if (name) updateData.name = name;
      if (typeof active === 'boolean') updateData.active = active;
      if (projectId !== undefined) updateData.project_id = projectId;
      if (password) updateData.password_hash = await bcrypt.hash(password, 12);

      const updatedTeam = await prisma.team.update({
        where: { id: teamId },
        data: updateData,
      });

      // Update the 3 members if provided
      if (members && members.length === 3) {
        // Delete and recreate exactly 3 members
        await prisma.member.deleteMany({ where: { team_id: teamId } });
        for (const m of members) {
          await prisma.member.create({
            data: { team_id: teamId, name: m },
          });
        }
      }

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'team_update',
        teamId,
        before: { name: existingTeam.name, active: existingTeam.active, projectId: existingTeam.project_id },
        after: { name: updatedTeam.name, active: updatedTeam.active, projectId: updatedTeam.project_id, members },
      });

      return NextResponse.json({ success: true, team: updatedTeam });
    }

    // 3. Reset Team Password
    if (action === 'reset_password') {
      const { teamId } = body;
      if (!teamId) {
        return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
      }

      const newPlainPassword = generateRandomPassword();
      const newHash = await bcrypt.hash(newPlainPassword, 12);

      await prisma.team.update({
        where: { id: teamId },
        data: { password_hash: newHash },
      });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'team_password_reset',
        teamId,
        after: { message: 'Password reset generated' },
      });

      return NextResponse.json({
        success: true,
        newPassword: newPlainPassword,
      });
    }

    return NextResponse.json({ error: 'Invalid team action' }, { status: 400 });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.message === 'EVENT_RUNNING') {
      return NextResponse.json({ error: 'Teams cannot be deleted while the event is running. Pause or end the event first.' }, { status: 409 });
    }
    if (error.message === 'TEAM_NOT_FOUND') {
      return NextResponse.json({ error: 'Team not found.' }, { status: 404 });
    }
    if (error.message === 'CROSS_TEAM_DEPENDENCY') {
      return NextResponse.json(
        { error: 'Deletion was stopped because gameplay records reference another team. No data was changed; contact an administrator.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to process team request' }, { status: 500 });
  }
}
