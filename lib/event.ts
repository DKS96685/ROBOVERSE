import { prisma } from './db';
import { EventStateView, toEventStateView } from './eventStateView';
export type { EventStateView } from './eventStateView';

export async function getEventState(): Promise<EventStateView> {
  const event = await prisma.eventState.findUnique({
    where: { id: 'global' },
    select: { status: true },
  });
  return toEventStateView(event);
}
