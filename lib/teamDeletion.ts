import type { Prisma } from '@prisma/client';

type TeamDeleteTransaction = Prisma.TransactionClient;

export const TEAM_DELETE_TRANSACTION_OPTIONS = {
  isolationLevel: 'Serializable' as const,
  timeout: 30_000,
  maxWait: 10_000,
};

export type DeletedTeamSummary = {
  id: string;
  name: string;
  login_id: string;
};

export async function deleteTeamForAdmin(
  teamId: string,
  requireAdmin: () => Promise<unknown>,
  runTransaction: (operation: (tx: TeamDeleteTransaction) => Promise<DeletedTeamSummary>) => Promise<DeletedTeamSummary>
): Promise<DeletedTeamSummary> {
  await requireAdmin();

  return runTransaction(async (tx) => {
    const eventState = await tx.eventState.findUnique({
      where: { id: 'global' },
      select: { status: true },
    });
    if (eventState?.status === 'running') throw new Error('EVENT_RUNNING');

    const team = await tx.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, login_id: true },
    });
    if (!team) throw new Error('TEAM_NOT_FOUND');

    const [foreignPuzzle, foreignClueUnlock, foreignPuzzleAttempt] = await Promise.all([
      tx.recoveryPuzzle.findFirst({
        where: { team_id: { not: teamId }, team_game: { is: { team_id: teamId } } },
        select: { id: true },
      }),
      tx.projectClueUnlock.findFirst({
        where: { team_id: { not: teamId }, team_game: { is: { team_id: teamId } } },
        select: { id: true },
      }),
      tx.recoveryPuzzleAttempt.findFirst({
        where: { team_id: { not: teamId }, puzzle: { is: { team_id: teamId } } },
        select: { id: true },
      }),
    ]);
    if (foreignPuzzle || foreignClueUnlock || foreignPuzzleAttempt) {
      throw new Error('CROSS_TEAM_DEPENDENCY');
    }

    await tx.recoveryPuzzleAttempt.deleteMany({ where: { team_id: teamId } });
    await tx.projectClueUnlock.deleteMany({ where: { team_id: teamId } });
    await tx.recoveryPuzzle.deleteMany({ where: { team_id: teamId } });
    await tx.gameSession.deleteMany({ where: { team_id: teamId } });
    await tx.lifelineEvent.deleteMany({ where: { team_id: teamId } });
    await tx.teamScore.deleteMany({ where: { team_id: teamId } });
    await tx.teamGame.deleteMany({ where: { team_id: teamId } });
    await tx.member.deleteMany({ where: { team_id: teamId } });
    await tx.team.delete({ where: { id: teamId } });

    return team;
  });
}
