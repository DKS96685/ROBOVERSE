const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export function getPuzzleImageExtension(bytes: Buffer, mimeType: string): string | null {
  if (bytes.length > MAX_IMAGE_BYTES) return null;
  if (
    mimeType === 'image/jpeg'
    && bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) return 'jpg';
  if (
    mimeType === 'image/png'
    && bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'png';
  if (
    mimeType === 'image/webp'
    && bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP'
  ) return 'webp';
  return null;
}
