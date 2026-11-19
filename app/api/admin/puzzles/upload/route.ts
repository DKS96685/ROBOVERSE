import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import crypto from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

function matchesImageType(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && bytes.toString('ascii', 0, 4) === 'RIFF'
      && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

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
      return NextResponse.json({ error: 'Image must be no larger than 2 MB.' }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!matchesImageType(bytes, file.type)) {
      return NextResponse.json({ error: 'The file contents do not match the selected image type.' }, { status: 400 });
    }

    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, fileName), bytes);

    return NextResponse.json({ success: true, imageUrl: `/uploads/${fileName}` });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Puzzle image upload error:', error);
    return NextResponse.json({ error: 'Failed to upload component image' }, { status: 500 });
  }
}
