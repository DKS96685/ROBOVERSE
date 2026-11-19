import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deductLifeline, getTeamLifelines } from '@/lib/lifelines';
import { GAME_RULES } from '@/lib/config/gameRules';

export async function POST(req: NextRequest) {
  await requireAuth('team');
  return NextResponse.json(
    { error: 'Lifelines cannot be used to skip games.' },
    { status: 410 }
  );
}
