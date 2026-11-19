import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { GAME_CATALOG } from '@/lib/config/gameCatalog';

export async function GET() {
  try {
    await requireAuth('admin');
    const [games, activeEvent] = await Promise.all([
      prisma.game.findMany({ orderBy: { order_num: 'asc' } }),
      prisma.eventState.findUnique({ where: { id: 'global' } }),
    ]);
    const existingKeys = new Set(games.map((game) => game.game_key));
    return NextResponse.json({
      games,
      catalog: GAME_CATALOG.filter((entry) => !existingKeys.has(entry.gameKey)),
      eventStarted: Boolean(activeEvent?.started_at),
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Admin game library error:', error);
    return NextResponse.json({ error: 'Failed to load the game library.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('admin');
    const body = await req.json();
    const gameKey = typeof body.gameKey === 'string' ? body.gameKey : '';
    const catalogEntry = GAME_CATALOG.find((entry) => entry.gameKey === gameKey);
    if (!catalogEntry) {
      return NextResponse.json({ error: 'Select a supported game from the library.' }, { status: 400 });
    }

    const game = await prisma.$transaction(async (tx) => {
      const event = await tx.eventState.findUnique({ where: { id: 'global' } });
      if (event && (event.status !== 'ready' || event.started_at)) {
        throw new Error('EVENT_ALREADY_STARTED');
      }

      const existing = await tx.game.findUnique({ where: { game_key: catalogEntry.gameKey } });
      if (existing) throw new Error('GAME_ALREADY_EXISTS');
      if (await tx.game.count() >= 10) throw new Error('GAME_LIBRARY_FULL');

      const created = await tx.game.create({
        data: {
          game_key: catalogEntry.gameKey,
          title: catalogEntry.title,
          min_seconds: catalogEntry.minSeconds,
          enabled: false,
          order_num: GAME_CATALOG.findIndex((entry) => entry.gameKey === catalogEntry.gameKey) + 1,
        },
      });
      await tx.auditLog.create({
        data: {
          actor: session.email || 'admin',
          action: 'game_library_add',
          after: JSON.stringify({
            gameId: created.id,
            gameKey: created.game_key,
            title: created.title,
            enabled: created.enabled,
          }),
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json({ success: true, game });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.message === 'EVENT_ALREADY_STARTED') {
      return NextResponse.json({ error: 'Games cannot be added after the event starts.' }, { status: 409 });
    }
    if (error.message === 'GAME_ALREADY_EXISTS') {
      return NextResponse.json({ error: 'That game is already in the library.' }, { status: 409 });
    }
    if (error.message === 'GAME_LIBRARY_FULL') {
      return NextResponse.json({ error: 'The game library is limited to 10 games.' }, { status: 409 });
    }
    if (error.code === 'P2034') {
      return NextResponse.json({ error: 'The game library changed concurrently. Refresh and retry.' }, { status: 409 });
    }
    console.error('Admin game creation error:', error);
    return NextResponse.json({ error: 'Failed to add the game.' }, { status: 500 });
  }
}
