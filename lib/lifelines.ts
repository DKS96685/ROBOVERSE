import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { GAME_RULES } from './config/gameRules';

export interface TeamLifelineSummary {
  starting: number;
  totalUsed: number;
  totalReverted: number;
  netUsed: number;
  remaining: number;
  isEliminated: boolean;
}

export async function lockTeamLifelines(
  tx: Prisma.TransactionClient,
  teamId: string
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
}

export async function getTeamLifelines(teamId: string): Promise<TeamLifelineSummary> {
  const events = await prisma.lifelineEvent.findMany({
    where: { team_id: teamId },
  });

  let used = 0;
  let reverted = 0;

  for (const ev of events) {
    if (ev.action === 'used') {
      used += ev.amount;
    } else if (ev.action === 'reverted') {
      reverted += ev.amount;
    }
  }

  const netUsed = Math.max(0, used - reverted);
  const remaining = Math.max(0, GAME_RULES.STARTING_LIFELINES - netUsed);
  const isEliminated = false;

  return {
    starting: GAME_RULES.STARTING_LIFELINES,
    totalUsed: used,
    totalReverted: reverted,
    netUsed,
    remaining,
    isEliminated,
  };
}

/**
 * Deduct a lifeline within a transaction
 */
export async function deductLifeline(params: {
  teamId: string;
  amount: number;
  gameId?: string | null;
  note?: string;
  byAdmin?: boolean;
}) {
  return await prisma.$transaction(async (tx) => {
    await lockTeamLifelines(tx, params.teamId);
    if (params.gameId) {
      const existingDeduction = await tx.lifelineEvent.findFirst({
        where: {
          team_id: params.teamId,
          game_id: params.gameId,
          action: 'used',
        },
      });
      if (existingDeduction) return existingDeduction;
    }
    // Check current lifelines
    const events = await tx.lifelineEvent.findMany({
      where: { team_id: params.teamId },
    });

    let used = 0;
    let reverted = 0;
    for (const ev of events) {
      if (ev.action === 'used') used += ev.amount;
      else if (ev.action === 'reverted') reverted += ev.amount;
    }
    const currentRemaining = Math.max(0, GAME_RULES.STARTING_LIFELINES - Math.max(0, used - reverted));

    if (currentRemaining <= 0) {
      // Already eliminated
      return null;
    }

    const newEvent = await tx.lifelineEvent.create({
      data: {
        team_id: params.teamId,
        game_id: params.gameId || null,
        action: 'used',
        amount: params.amount,
        by_admin: params.byAdmin || false,
        note: params.note || 'Lifeline deduction',
      },
    });

    return newEvent;
  });
}
