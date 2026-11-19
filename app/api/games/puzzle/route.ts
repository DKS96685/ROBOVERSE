import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PuzzleImageStorageError, resolvePuzzleImageUrl } from '@/lib/storage/puzzleImages';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth('team');
    const gameId = new URL(req.url).searchParams.get('gameId');
    const where: any = {
      team_id: session.teamId!,
      status: 'PENDING',
    };
    if (gameId) {
      where.team_game = { game_id: gameId };
    }

    const puzzle = await prisma.recoveryPuzzle.findFirst({
      where,
      include: {
        question: {
          include: {
            options: { orderBy: { sort_order: 'asc' } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    if (!puzzle) return NextResponse.json({ puzzle: null });

    return NextResponse.json({
      puzzle: {
        id: puzzle.id,
        status: puzzle.status,
        questionText: puzzle.question.question_text,
        imageUrl: await resolvePuzzleImageUrl(puzzle.question.image_url),
        options: puzzle.question.options.map((option) => ({
          id: option.id,
          text: option.option_text,
        })),
      },
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof PuzzleImageStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: 'Failed to load recovery puzzle' }, { status: 500 });
  }
}
