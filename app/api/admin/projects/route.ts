import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { projectCreateSchema, projectUpdateSchema } from '@/lib/validations';

const MAX_PROJECTS = 10;

async function saveProjectHints(
  tx: Prisma.TransactionClient,
  projectId: string,
  data: {
    hints?: { gameId: string; clueText: string }[];
    snakeHint?: string;
    pongHint?: string;
    memoryHint?: string;
  }
) {
  const entries: { gameId: string; clueText: string }[] = data.hints ? [...data.hints] : [];

  if (!data.hints) {
    const legacyHints = [
      ['snake', data.snakeHint],
      ['pong', data.pongHint],
      ['memory', data.memoryHint],
    ] as const;
    for (const [gameKey, clueText] of legacyHints) {
      if (!clueText) continue;
      const game = await tx.game.findUnique({ where: { game_key: gameKey } });
      if (game) entries.push({ gameId: game.id, clueText });
    }
  }

  const nonEmptyEntries = entries.filter((entry) => entry.clueText.trim());
  if (data.hints) {
    const retainedGameIds = nonEmptyEntries.map((entry) => entry.gameId);
    await tx.projectHint.deleteMany({
      where: {
        project_id: projectId,
        ...(retainedGameIds.length > 0 ? { game_id: { notIn: retainedGameIds } } : {}),
      },
    });
  }

  for (const entry of nonEmptyEntries) {
    await tx.projectHint.upsert({
      where: {
        project_id_game_id: {
          project_id: projectId,
          game_id: entry.gameId,
        },
      },
      update: { clue_text: entry.clueText.trim() },
      create: {
        project_id: projectId,
        game_id: entry.gameId,
        clue_text: entry.clueText.trim(),
      },
    });
  }
}

export async function GET() {
  try {
    await requireAuth('admin');
    const projects = await prisma.project.findMany({
      include: {
        teams: {
          select: { id: true, name: true, login_id: true },
        },
        hints: {
          include: { game: { select: { id: true, game_key: true, title: true, enabled: true } } },
          orderBy: { game: { order_num: 'asc' } },
        },
      },
      orderBy: { name: 'asc' },
    });
    const games = await prisma.game.findMany({
      where: { enabled: true },
      orderBy: { order_num: 'asc' },
      select: { id: true, game_key: true, title: true, enabled: true },
    });
    return NextResponse.json({ projects, games, maxProjects: MAX_PROJECTS });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to load projects.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('admin');
    const body = await req.json();

    const eventState = await prisma.eventState.findUnique({ where: { id: 'global' } });
    if (eventState && (eventState.status !== 'ready' || eventState.started_at)) {
      return NextResponse.json(
        { error: 'Project details and clues cannot be changed after the event has started.' },
        { status: 409 }
      );
    }

    if (body.action === 'create') {
      const parsed = projectCreateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid project.' }, { status: 400 });
      }

      const project = await prisma.$transaction(async (tx) => {
        if (await tx.project.count() >= MAX_PROJECTS) {
          throw new Error('PROJECT_LIMIT_REACHED');
        }

        const created = await tx.project.create({
          data: {
            name: parsed.data.name,
            description: parsed.data.description,
          },
        });
        await saveProjectHints(tx, created.id, parsed.data);
        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'project_create',
            after: JSON.stringify({ projectId: created.id, name: created.name }),
          },
        });
        return created;
      }, { isolationLevel: 'Serializable' });

      return NextResponse.json({ success: true, project });
    }

    if (body.action === 'update') {
      const parsed = projectUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid project.' }, { status: 400 });
      }

      const project = await prisma.$transaction(async (tx) => {
        const before = await tx.project.findUnique({ where: { id: parsed.data.projectId } });
        if (!before) throw new Error('PROJECT_NOT_FOUND');

        const updated = await tx.project.update({
          where: { id: before.id },
          data: {
            name: parsed.data.name,
            description: parsed.data.description,
          },
        });
        await saveProjectHints(tx, updated.id, parsed.data);
        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'project_update',
            before: JSON.stringify({
              projectId: before.id,
              name: before.name,
              description: before.description,
            }),
            after: JSON.stringify({
              projectId: updated.id,
              name: updated.name,
              description: updated.description,
            }),
          },
        });
        return updated;
      });

      return NextResponse.json({ success: true, project });
    }

    return NextResponse.json({ error: 'Invalid project action.' }, { status: 400 });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.message === 'PROJECT_LIMIT_REACHED') {
      return NextResponse.json({ error: `A maximum of ${MAX_PROJECTS} projects is allowed.` }, { status: 409 });
    }
    if (error.message === 'PROJECT_NOT_FOUND') {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }
    if (error.code === 'P2002' || error.code === 'P2034') {
      return NextResponse.json({ error: 'Project name is already in use or a concurrent change occurred. Retry the request.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to save project.' }, { status: 500 });
  }
}
