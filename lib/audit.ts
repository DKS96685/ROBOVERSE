import { prisma } from './db';

export interface AuditLogEntry {
  actor: string;
  action: string;
  teamId?: string | null;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
}

export async function logAuditEvent({
  actor,
  action,
  teamId,
  before,
  after,
}: AuditLogEntry) {
  try {
    return await prisma.auditLog.create({
      data: {
        actor,
        action,
        team_id: teamId || null,
        before: before ? JSON.stringify(before) : null,
        after: after ? JSON.stringify(after) : null,
      },
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
    return null;
  }
}
