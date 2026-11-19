import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('admin');
    const { action, teamId, gameId, status, clueText, minSeconds, enabled } = await req.json();

    // 1. Update game config (clue text, min_seconds, enabled)
    if (action === 'update_clue' && gameId) {
      const before = await prisma.game.findUnique({ where: { id: gameId } });
      const updateData: any = {};
      if (clueText !== undefined) updateData.clue_text = clueText;
      if (minSeconds !== undefined) updateData.min_seconds = Number(minSeconds);
      if (enabled !== undefined) updateData.enabled = Boolean(enabled);

      const updated = await prisma.game.update({
        where: { id: gameId },
        data: updateData,
      });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'game_update_clue',
        before: { clue_text: before?.clue_text, min_seconds: before?.min_seconds, enabled: before?.enabled },
        after: { clue_text: updated.clue_text, min_seconds: updated.min_seconds, enabled: updated.enabled },
      });

      return NextResponse.json({ success: true, game: updated });
    }

    // 2. Toggle game enabled
    if (action === 'toggle_enabled' && gameId) {
      const before = await prisma.game.findUnique({ where: { id: gameId } });
      const updated = await prisma.game.update({
        where: { id: gameId },
        data: { enabled },
      });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'game_toggle_enabled',
        before: { enabled: before?.enabled },
        after: { enabled: updated.enabled },
      });

      return NextResponse.json({ success: true, game: updated });
    }

    // 3. Update team_game status (e.g. mark completed, available, locked, skipped)
    if (action === 'set_team_status' && teamId && gameId && status) {
      const before = await prisma.teamGame.findUnique({
        where: {
          team_id_game_id: { team_id: teamId, game_id: gameId },
        },
      });

      const updated = await prisma.teamGame.upsert({
        where: {
          team_id_game_id: { team_id: teamId, game_id: gameId },
        },
        update: {
          status,
          updated_by: 'admin',
        },
        create: {
          team_id: teamId,
          game_id: gameId,
          status,
          updated_by: 'admin',
        },
      });

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'team_game_status_change',
        teamId,
        before: { status: before?.status },
        after: { status: updated.status, gameId },
      });

      return NextResponse.json({ success: true, teamGame: updated });
    }

    return NextResponse.json({ error: 'Invalid game action' }, { status: 400 });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Game admin action error:', error);
    return NextResponse.json({ error: 'Failed to update game' }, { status: 500 });
  }
}
