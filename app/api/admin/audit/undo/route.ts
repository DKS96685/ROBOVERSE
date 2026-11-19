import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('admin');
    const { logId } = await req.json();

    if (!logId) {
      return NextResponse.json({ error: 'logId is required' }, { status: 400 });
    }

    const log = await prisma.auditLog.findUnique({
      where: { id: logId },
    });

    if (!log) {
      return NextResponse.json({ error: 'Audit log entry not found' }, { status: 404 });
    }

    const before = log.before ? JSON.parse(log.before) : null;
    const after = log.after ? JSON.parse(log.after) : null;
    const teamId = log.team_id;

    let undoResult = '';

    // Undo Lifeline Revert or Grant (re-deduct)
    if (log.action === 'lifeline_revert' || log.action === 'lifeline_grant' || log.action === 'lifeline_revert_last') {
      const amountToDeduct = after?.revertEvent?.amount || after?.event?.amount || before?.lastUsedEvent?.amount || 1.0;
      if (teamId) {
        await prisma.lifelineEvent.create({
          data: {
            team_id: teamId,
            action: 'used',
            amount: amountToDeduct,
            by_admin: true,
            note: `Undo of ${log.action} (Audit Log ${log.id})`,
          },
        });
        undoResult = `Re-deducted ${amountToDeduct} lifeline to undo the previous grant/revert.`;
      }
    }
    // Undo Lifeline Deduct (re-grant / revert)
    else if (log.action === 'lifeline_deduct') {
      const amountToRestore = after?.event?.amount || 1.0;
      if (teamId) {
        await prisma.lifelineEvent.create({
          data: {
            team_id: teamId,
            action: 'reverted',
            amount: amountToRestore,
            by_admin: true,
            note: `Undo of lifeline deduction (Audit Log ${log.id})`,
          },
        });
        undoResult = `Restored ${amountToRestore} lifeline to undo deduction.`;
      }
    }
    // Undo Team Game Status Change
    else if (log.action === 'team_game_status_change' && teamId) {
      const gameId = after?.gameId;
      if (gameId && before?.status) {
        await prisma.teamGame.update({
          where: {
            team_id_game_id: { team_id: teamId, game_id: gameId },
          },
          data: {
            status: before.status,
            updated_by: 'admin_undo',
          },
        });
        undoResult = `Restored game status back to ${before.status}.`;
      }
    }
    // Undo Clue Update
    else if (log.action === 'game_update_clue' && before?.clue_text) {
      // Find game by after clue text or game
      const game = await prisma.game.findFirst({
        where: { clue_text: after?.clue_text },
      });
      if (game) {
        await prisma.game.update({
          where: { id: game.id },
          data: { clue_text: before.clue_text },
        });
        undoResult = 'Restored previous clue text.';
      }
    } else {
      return NextResponse.json(
        { error: 'Automatic undo is not supported for this action type.' },
        { status: 400 }
      );
    }

    // Record the undo in audit log
    await logAuditEvent({
      actor: session.email || 'admin',
      action: `undo_${log.action}`,
      teamId,
      before: after,
      after: { undoResult, originalLogId: log.id },
    });

    return NextResponse.json({
      success: true,
      message: undoResult || 'Action successfully undone!',
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Audit undo error:', error);
    return NextResponse.json({ error: 'Failed to execute undo' }, { status: 500 });
  }
}
