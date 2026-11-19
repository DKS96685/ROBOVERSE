import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { PuzzleImageStorageError, uploadPuzzleImage } from '@/lib/storage/puzzleImages';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await requireAuth('admin');
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Image file is required.' }, { status: 400 });
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, and WebP images are allowed.' }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be no larger than 2 MB.' }, { status: 413 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length !== file.size) {
      return NextResponse.json({ error: 'Image upload was incomplete.' }, { status: 400 });
    }

    const uploaded = await uploadPuzzleImage(bytes, file.type);
    return NextResponse.json({
      success: true,
      imageUrl: uploaded.imageReference,
      previewUrl: uploaded.previewUrl,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof PuzzleImageStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Puzzle image upload error:', error);
    return NextResponse.json({ error: 'Failed to upload component image' }, { status: 500 });
  }
}
