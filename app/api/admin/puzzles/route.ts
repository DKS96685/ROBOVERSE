import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    await requireAuth('admin');
    const questions = await prisma.componentQuestion.findMany({
      include: {
        options: { orderBy: { sort_order: 'asc' } },
        puzzles: {
          include: {
            team: { select: { id: true, name: true, login_id: true } },
            team_game: { include: { game: { select: { id: true, title: true } } } },
            attempts: { orderBy: { attempted_at: 'desc' } },
          },
          orderBy: { created_at: 'desc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    return NextResponse.json({ questions });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to load recovery puzzles' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth('admin');
    const body = await req.json();
    const action = body.action;

    if (action === 'create' || action === 'update') {
      const questionId = typeof body.questionId === 'string' ? body.questionId : null;
      const questionText = typeof body.questionText === 'string' ? body.questionText.trim() : '';
      const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
      const correctAnswer = typeof body.correctAnswer === 'string' ? body.correctAnswer.trim() : '';
      const options = Array.isArray(body.options)
        ? body.options.map((option: unknown) => String(option).trim()).filter(Boolean)
        : [];
      const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;

      if (!questionText || !imageUrl || !correctAnswer) {
        return NextResponse.json({ error: 'Question text, image, and correct answer are required.' }, { status: 400 });
      }
      if (options.length < 2 || options.length > 6) {
        return NextResponse.json({ error: 'Provide between 2 and 6 answer choices.' }, { status: 400 });
      }
      const uniqueOptions = Array.from(new Set(options));
      if (uniqueOptions.length !== options.length) {
        return NextResponse.json({ error: 'Answer choices must be unique.' }, { status: 400 });
      }
      if (!options.includes(correctAnswer)) {
        return NextResponse.json({ error: 'The correct answer must match one of the answer choices.' }, { status: 400 });
      }

      const question = await prisma.$transaction(async (tx) => {
        const saved = action === 'update'
          ? await tx.componentQuestion.update({
              where: { id: questionId! },
              data: { question_text: questionText, image_url: imageUrl, correct_answer: correctAnswer, enabled },
            })
          : await tx.componentQuestion.create({
              data: { question_text: questionText, image_url: imageUrl, correct_answer: correctAnswer, enabled },
            });

        if (action === 'update') {
          await tx.componentAnswerOption.deleteMany({ where: { question_id: saved.id } });
        }
        await tx.componentAnswerOption.createMany({
          data: options.map((option: string, index: number) => ({
            question_id: saved.id,
            option_text: option,
            sort_order: index,
          })),
        });
        await tx.auditLog.create({
          data: {
            actor: session.email || 'admin',
            action: action === 'create' ? 'component_question_create' : 'component_question_update',
            after: JSON.stringify({
              questionId: saved.id,
              questionText,
              imageUrl,
              enabled,
              options,
            }),
          },
        });
        return saved;
      });

      return NextResponse.json({ success: true, question });
    }

    if (action === 'delete') {
      const questionId = typeof body.questionId === 'string' ? body.questionId : null;
      if (!questionId) return NextResponse.json({ error: 'questionId is required.' }, { status: 400 });
      const inUse = await prisma.recoveryPuzzle.count({ where: { question_id: questionId } });
      if (inUse > 0) {
        return NextResponse.json({ error: 'A used question cannot be deleted.' }, { status: 409 });
      }
      await prisma.componentQuestion.delete({ where: { id: questionId } });
      await prisma.auditLog.create({
        data: {
          actor: session.email || 'admin',
          action: 'component_question_delete',
          after: JSON.stringify({ questionId }),
        },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid puzzle action.' }, { status: 400 });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Component question not found.' }, { status: 404 });
    }
    console.error('Admin puzzle action error:', error);
    return NextResponse.json({ error: 'Failed to update recovery puzzles' }, { status: 500 });
  }
}
