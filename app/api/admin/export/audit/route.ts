import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function csvSafe(value: string) {
  const escaped = value.replace(/"/g, '""');
  return /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped;
}

export async function GET() {
  try {
    await requireAuth('admin');

    const logs = await prisma.auditLog.findMany({
      orderBy: { created_at: 'asc' },
      include: { team: { select: { name: true, login_id: true } } },
    });

    const header = 'Timestamp,Actor,Action,Team,Before,After';
    const csvRows = logs.map((l) => {
      const teamLabel = l.team ? `${l.team.name} (${l.team.login_id})` : '';
      const before = l.before ? l.before.replace(/"/g, '""') : '';
      const after = l.after ? l.after.replace(/"/g, '""') : '';
      return `"${new Date(l.created_at).toISOString()}","${csvSafe(l.actor)}","${csvSafe(l.action)}","${csvSafe(teamLabel)}","${csvSafe(before)}","${csvSafe(after)}"`;
    });

    const csv = [header, ...csvRows].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="roboverse-audit-${Date.now()}.csv"`,
      },
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
