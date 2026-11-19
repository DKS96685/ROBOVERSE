import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';
import { getTeamLifelines } from '@/lib/lifelines';

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('admin');
    const { action, teamId, eventId, amount, note, correctionKey } = await req.json();

    if (!teamId && !eventId) {
      return NextResponse.json(
        { error: 'teamId or eventId is required' },
        { status: 400 }
      );
    }

    // 1. Revert specific Lifeline Event (One-click / two-click revert)
    if (action === 'revert_event' || (action === 'revert' && eventId)) {
      const result = await prisma.$transaction(async (tx) => {
        const targetEvent = await tx.lifelineEvent.findUnique({
          where: { id: eventId },
          include: { team: true, game: true },
        });
        if (!targetEvent) return { error: 'Lifeline event not found', status: 404 };
        if (targetEvent.action !== 'used') {
          return { error: 'Only a lifeline usage can be reverted.', status: 409 };
        }

        const idempotencyMarker = `lifeline-revert:${targetEvent.team_id}:${targetEvent.id}`;
        const existingRevert = await tx.lifelineEvent.findFirst({
          where: {
            team_id: targetEvent.team_id,
            action: 'reverted',
            note: { contains: idempotencyMarker },
          },
        });
        if (existingRevert) {
          return { duplicate: true, revertEvent: existingRevert, teamId: targetEvent.team_id };
        }

        const beforeEvents = await tx.lifelineEvent.findMany({
          where: { team_id: targetEvent.team_id },
          select: { action: true, amount: true },
        });
        let used = 0;
        let reverted = 0;
        for (const event of beforeEvents) {
          if (event.action === 'used') used += event.amount;
          if (event.action === 'reverted') reverted += event.amount;
        }
        const beforeSummary = {
          starting: 1,
          totalUsed: used,
          totalReverted: reverted,
          netUsed: Math.max(0, used - reverted),
          remaining: Math.max(0, 1 - Math.max(0, used - reverted)),
          isEliminated: false,
        };

        const revertEvent = await tx.lifelineEvent.create({
          data: {
            team_id: targetEvent.team_id,
            game_id: targetEvent.game_id,
            action: 'reverted',
            amount: targetEvent.amount,
            by_admin: true,
            note: `${idempotencyMarker} ${note || `Admin reverted event ${targetEvent.id}`}`,
          },
        });

        let unskippedGame = false;
        if (targetEvent.game_id) {
          const teamGame = await tx.teamGame.findUnique({
            where: {
              team_id_game_id: {
                team_id: targetEvent.team_id,
                game_id: targetEvent.game_id,
              },
            },
          });
          if (teamGame && teamGame.status === 'skipped') {
            await tx.teamGame.update({
              where: { id: teamGame.id },
              data: { status: 'available', updated_by: 'admin' },
            });
            unskippedGame = true;
          }
        }

        const afterEvents = await tx.lifelineEvent.findMany({
          where: { team_id: targetEvent.team_id },
          select: { action: true, amount: true },
        });
        let usedAfter = 0;
        let revertedAfter = 0;
        for (const event of afterEvents) {
          if (event.action === 'used') usedAfter += event.amount;
          if (event.action === 'reverted') revertedAfter += event.amount;
        }
        const afterSummary = {
          starting: 1,
          totalUsed: usedAfter,
          totalReverted: revertedAfter,
          netUsed: Math.max(0, usedAfter - revertedAfter),
          remaining: Math.max(0, 1 - Math.max(0, usedAfter - revertedAfter)),
          isEliminated: false,
        };

        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'lifeline_revert',
            team_id: targetEvent.team_id,
            before: JSON.stringify({ lifelines: beforeSummary }),
            after: JSON.stringify({ revertEvent, lifelines: afterSummary, unskippedGame }),
          },
        });

        return { revertEvent, teamId: targetEvent.team_id, lifelines: afterSummary, unskippedGame };
      }, { isolationLevel: 'Serializable' });

      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      if (result.duplicate) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: 'This lifeline deduction was already reverted.',
          revertEvent: result.revertEvent,
        });
      }
      return NextResponse.json({
        success: true,
        message: `Successfully reverted lifeline${result.unskippedGame ? ' and restored the game' : ''}.`,
        lifelines: result.lifelines,
        revertEvent: result.revertEvent,
      });
    }

    // 2. Revert the most recent deduction for a team
    if (action === 'revert_last' && teamId) {
      const result = await prisma.$transaction(async (tx) => {
        const lastUsedEvent = await tx.lifelineEvent.findFirst({
          where: { team_id: teamId, action: 'used' },
          orderBy: { created_at: 'desc' },
        });
        if (!lastUsedEvent) return { error: 'No recent lifeline deduction found to revert for this team.', status: 400 };

        const idempotencyMarker = `lifeline-revert:${teamId}:${lastUsedEvent.id}`;
        const existingRevert = await tx.lifelineEvent.findFirst({
          where: {
            team_id: teamId,
            action: 'reverted',
            note: { contains: idempotencyMarker },
          },
        });
        if (existingRevert) {
          return { duplicate: true, revertEvent: existingRevert };
        }

        const beforeSummary = await getTeamLifelines(teamId);
        const revertEvent = await tx.lifelineEvent.create({
          data: {
            team_id: teamId,
            game_id: lastUsedEvent.game_id,
            action: 'reverted',
            amount: lastUsedEvent.amount,
            by_admin: true,
            note: `${idempotencyMarker} ${note || `Admin reverted last deduction ${lastUsedEvent.id}`}`,
          },
        });

        let unskippedGame = false;
        if (lastUsedEvent.game_id) {
          const teamGame = await tx.teamGame.findUnique({
            where: {
              team_id_game_id: {
                team_id: teamId,
                game_id: lastUsedEvent.game_id,
              },
            },
          });
          if (teamGame && teamGame.status === 'skipped') {
            await tx.teamGame.update({
              where: { id: teamGame.id },
              data: { status: 'available', updated_by: 'admin' },
            });
            unskippedGame = true;
          }
        }

        const afterSummary = await getTeamLifelines(teamId);
        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'lifeline_revert_last',
            team_id: teamId,
            before: JSON.stringify({ lastUsedEvent, lifelines: beforeSummary }),
            after: JSON.stringify({ revertEvent, lifelines: afterSummary, unskippedGame }),
          },
        });
        return { revertEvent, lifelines: afterSummary, unskippedGame };
      }, { isolationLevel: 'Serializable' });

      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      if (result.duplicate) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: 'The latest lifeline deduction was already reverted.',
          revertEvent: result.revertEvent,
        });
      }
      return NextResponse.json({
        success: true,
        message: 'Successfully restored lifeline!',
        lifelines: result.lifelines,
      });
    }

    // 3. Admin manually deducts a lifeline
    if (action === 'deduct' && teamId) {
      const deductAmount = amount || 1.0;
      if (correctionKey) {
        const existing = await prisma.lifelineEvent.findFirst({
          where: { team_id: teamId, action: 'used', note: { contains: correctionKey } },
        });
        if (existing) return NextResponse.json({ error: 'This correction was already applied.' }, { status: 409 });
      }
      const beforeSummary = await getTeamLifelines(teamId);

      const newEvent = await prisma.lifelineEvent.create({
        data: {
          team_id: teamId,
          action: 'used',
          amount: deductAmount,
          by_admin: true,
          note: note || `Admin manual deduction${correctionKey ? ` correction:${correctionKey}` : ''}`,
        },
      });

      const afterSummary = await getTeamLifelines(teamId);

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'lifeline_deduct',
        teamId,
        before: { lifelines: beforeSummary },
        after: { event: newEvent, lifelines: afterSummary },
      });

      return NextResponse.json({
        success: true,
        message: `Deducted ${deductAmount} lifeline.`,
        lifelines: afterSummary,
      });
    }

    // 4. Admin manually grants/restores a lifeline
    if (action === 'grant' && teamId) {
      const grantAmount = amount || 1.0;
      if (correctionKey) {
        const existing = await prisma.lifelineEvent.findFirst({
          where: { team_id: teamId, action: 'reverted', note: { contains: correctionKey } },
        });
        if (existing) return NextResponse.json({ error: 'This correction was already applied.' }, { status: 409 });
      }
      const beforeSummary = await getTeamLifelines(teamId);

      const newEvent = await prisma.lifelineEvent.create({
        data: {
          team_id: teamId,
          action: 'reverted',
          amount: grantAmount,
          by_admin: true,
          note: note || `Admin manual grant${correctionKey ? ` correction:${correctionKey}` : ''}`,
        },
      });

      const afterSummary = await getTeamLifelines(teamId);

      await logAuditEvent({
        actor: session.email || 'admin',
        action: 'lifeline_grant',
        teamId,
        before: { lifelines: beforeSummary },
        after: { event: newEvent, lifelines: afterSummary },
      });

      return NextResponse.json({
        success: true,
        message: `Granted ${grantAmount} lifeline.`,
        lifelines: afterSummary,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Lifeline admin error:', error);
    return NextResponse.json({ error: 'Failed to process lifeline action' }, { status: 500 });
  }
}
