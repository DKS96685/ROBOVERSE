import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { lockTeamLifelines } from '@/lib/lifelines';

async function reverseActiveRetry(tx: any, event: any): Promise<boolean> {
  if (!event.team_game_id && !event.session_id) return false;
  if (!event.team_game_id) {
    throw new Error('LIFELINE_REVERSAL_CONFLICT');
  }

  const teamGame = await tx.teamGame.findUnique({ where: { id: event.team_game_id } });
  const gameSession = event.session_id
    ? await tx.gameSession.findUnique({ where: { id: event.session_id } })
    : await tx.gameSession.findFirst({
        where: {
          team_game_id: event.team_game_id,
          attempt_number: 2,
        },
        orderBy: { started_at: 'desc' },
      });
  if (
    !teamGame
    || !gameSession
    || teamGame.status !== 'SECOND_ATTEMPT_IN_PROGRESS'
    || gameSession.result !== 'in_progress'
  ) {
    throw new Error('LIFELINE_REVERSAL_CONFLICT');
  }

  const now = new Date();
  const sessionUpdate = await tx.gameSession.updateMany({
    where: { id: gameSession.id, result: 'in_progress' },
    data: { result: 'cancelled_admin', ended_at: now },
  });
  if (sessionUpdate.count !== 1) throw new Error('LIFELINE_REVERSAL_CONFLICT');

  const teamGameUpdate = await tx.teamGame.updateMany({
    where: { id: teamGame.id, status: 'SECOND_ATTEMPT_IN_PROGRESS', lifeline_used: true },
    data: {
      status: 'FIRST_ATTEMPT_FAILED',
      attempt_count: 1,
      lifeline_used: false,
    },
  });
  if (teamGameUpdate.count !== 1) throw new Error('LIFELINE_REVERSAL_CONFLICT');
  return true;
}

async function summarizeTeamLifelines(tx: any, teamId: string) {
  const events = await tx.lifelineEvent.findMany({
    where: { team_id: teamId },
    select: { action: true, amount: true },
  });
  let totalUsed = 0;
  let totalReverted = 0;
  for (const event of events) {
    if (event.action === 'used') totalUsed += event.amount;
    if (event.action === 'reverted') totalReverted += event.amount;
  }
  const netUsed = Math.max(0, totalUsed - totalReverted);
  return {
    starting: 1,
    totalUsed,
    totalReverted,
    netUsed,
    remaining: Math.max(0, 1 - netUsed),
    isEliminated: false,
  };
}

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
        await lockTeamLifelines(tx, targetEvent.team_id);
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

        const unspentRetryRestored = await reverseActiveRetry(tx, targetEvent);
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
        await tx.teamScore.updateMany({
          where: { team_id: targetEvent.team_id },
          data: { lifeline_used: afterSummary.remaining === 0 },
        });

        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'lifeline_revert',
            team_id: targetEvent.team_id,
            before: JSON.stringify({ lifelines: beforeSummary }),
            after: JSON.stringify({ revertEvent, lifelines: afterSummary, unspentRetryRestored }),
          },
        });

        return { revertEvent, teamId: targetEvent.team_id, lifelines: afterSummary, unspentRetryRestored };
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
        message: `Successfully reverted lifeline${result.unspentRetryRestored ? ' and restored the retry' : ''}.`,
        lifelines: result.lifelines,
        revertEvent: result.revertEvent,
      });
    }

    // 2. Revert the most recent deduction for a team
    if (action === 'revert_last' && teamId) {
      const result = await prisma.$transaction(async (tx) => {
        await lockTeamLifelines(tx, teamId);
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

        const beforeSummary = await summarizeTeamLifelines(tx, teamId);
        const unspentRetryRestored = await reverseActiveRetry(tx, lastUsedEvent);
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

        const afterSummary = await summarizeTeamLifelines(tx, teamId);
        await tx.teamScore.updateMany({
          where: { team_id: teamId },
          data: { lifeline_used: afterSummary.remaining === 0 },
        });
        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'lifeline_revert_last',
            team_id: teamId,
            before: JSON.stringify({ lastUsedEvent, lifelines: beforeSummary }),
            after: JSON.stringify({ revertEvent, lifelines: afterSummary, unspentRetryRestored }),
          },
        });
        return { revertEvent, lifelines: afterSummary, unspentRetryRestored };
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
      if (
        typeof correctionKey !== 'string'
        || !/^[a-zA-Z0-9._:-]{1,128}$/.test(correctionKey)
        || (amount !== undefined && amount !== 1)
      ) {
        return NextResponse.json({ error: 'A valid correctionKey is required; lifeline corrections must be exactly one.' }, { status: 400 });
      }

      const marker = `[lifeline-correction:deduct:${teamId}:${correctionKey}]`;
      const result = await prisma.$transaction(async (tx) => {
        await lockTeamLifelines(tx, teamId);
        const existing = await tx.lifelineEvent.findFirst({
          where: { team_id: teamId, note: { contains: marker } },
        });
        if (existing) return { duplicate: true, event: existing };

        const beforeSummary = await summarizeTeamLifelines(tx, teamId);
        if (beforeSummary.remaining < 1) {
          return { error: 'The team has no available lifeline to deduct.', status: 409 };
        }
        const newEvent = await tx.lifelineEvent.create({
          data: {
            team_id: teamId,
            action: 'used',
            amount: 1,
            by_admin: true,
            note: `${marker} ${typeof note === 'string' ? note : 'Admin manual deduction'}`,
          },
        });
        const afterSummary = await summarizeTeamLifelines(tx, teamId);
        await tx.teamScore.upsert({
          where: { team_id: teamId },
          update: { lifeline_used: afterSummary.remaining === 0 },
          create: { team_id: teamId, lifeline_used: afterSummary.remaining === 0 },
        });
        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'lifeline_deduct',
            team_id: teamId,
            before: JSON.stringify({ lifelines: beforeSummary }),
            after: JSON.stringify({ event: newEvent, lifelines: afterSummary, correctionKey }),
          },
        });
        return { event: newEvent, lifelines: afterSummary };
      }, { isolationLevel: 'Serializable' });

      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({
        success: true,
        duplicate: Boolean(result.duplicate),
        message: result.duplicate ? 'This correction was already applied.' : 'Deducted one lifeline.',
        event: result.event,
        lifelines: 'lifelines' in result ? result.lifelines : undefined,
      });
    }

    // 4. Admin manually grants/restores a lifeline
    if (action === 'grant' && teamId) {
      if (
        typeof correctionKey !== 'string'
        || !/^[a-zA-Z0-9._:-]{1,128}$/.test(correctionKey)
        || (amount !== undefined && amount !== 1)
      ) {
        return NextResponse.json({ error: 'A valid correctionKey is required; lifeline corrections must be exactly one.' }, { status: 400 });
      }

      const marker = `[lifeline-correction:grant:${teamId}:${correctionKey}]`;
      const result = await prisma.$transaction(async (tx) => {
        await lockTeamLifelines(tx, teamId);
        const existing = await tx.lifelineEvent.findFirst({
          where: { team_id: teamId, note: { contains: marker } },
        });
        if (existing) return { duplicate: true, event: existing };

        const manualDeductions = await tx.lifelineEvent.findMany({
          where: {
            team_id: teamId,
            action: 'used',
            by_admin: true,
            team_game_id: null,
            session_id: null,
          },
          orderBy: { created_at: 'desc' },
        });
        const restorations = await tx.lifelineEvent.findMany({
          where: { team_id: teamId, action: 'reverted', note: { contains: '[restores:' } },
          select: { note: true },
        });
        const restoredDeductionIds = new Set(
          restorations.map((event) => event.note?.match(/\[restores:([^\]]+)\]/)?.[1]).filter(Boolean)
        );
        const manualDeduction = manualDeductions.find((event) => !restoredDeductionIds.has(event.id));
        if (!manualDeduction) {
          return {
            error: 'Only an unlinked manual admin deduction can be granted here. Use the specific reversal action for a game lifeline.',
            status: 409,
          };
        }

        const beforeSummary = await summarizeTeamLifelines(tx, teamId);
        if (beforeSummary.remaining >= 1) {
          return { error: 'The team already has its available lifeline.', status: 409 };
        }
        const newEvent = await tx.lifelineEvent.create({
          data: {
            team_id: teamId,
            action: 'reverted',
            amount: 1,
            by_admin: true,
            note: `${marker} [restores:${manualDeduction.id}] ${typeof note === 'string' ? note : 'Admin manual grant'}`,
          },
        });
        const afterSummary = await summarizeTeamLifelines(tx, teamId);
        await tx.teamScore.upsert({
          where: { team_id: teamId },
          update: { lifeline_used: afterSummary.remaining === 0 },
          create: { team_id: teamId, lifeline_used: afterSummary.remaining === 0 },
        });
        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: 'lifeline_grant',
            team_id: teamId,
            before: JSON.stringify({ lifelines: beforeSummary }),
            after: JSON.stringify({ event: newEvent, lifelines: afterSummary, correctionKey }),
          },
        });
        return { event: newEvent, lifelines: afterSummary };
      }, { isolationLevel: 'Serializable' });

      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({
        success: true,
        duplicate: Boolean(result.duplicate),
        message: result.duplicate ? 'This correction was already applied.' : 'Restored one lifeline.',
        event: result.event,
        lifelines: 'lifelines' in result ? result.lifelines : undefined,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.message === 'LIFELINE_REVERSAL_CONFLICT') {
      return NextResponse.json(
        { error: 'A lifeline can only be reversed before its second attempt has concluded.' },
        { status: 409 }
      );
    }
    if (error.code === 'P2034') {
      return NextResponse.json({ error: 'Lifeline action conflicted with another update. Retry.' }, { status: 409 });
    }
    console.error('Lifeline admin error:', error);
    return NextResponse.json({ error: 'Failed to process lifeline action' }, { status: 500 });
  }
}
