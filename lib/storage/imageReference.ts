export const PUZZLE_IMAGE_BUCKET = 'roboverse-puzzle-images';
const IMAGE_PREFIX = `neon-s3://${PUZZLE_IMAGE_BUCKET}/`;

export function isPuzzleImageReference(value: string): boolean {
  return value.startsWith(IMAGE_PREFIX) && value.length > IMAGE_PREFIX.length;
}
