import crypto from 'crypto';
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getValidatedPuzzleImageExtension } from './imageValidation';

const BUCKET = 'roboverse-puzzle-images';
const IMAGE_PREFIX = `neon-s3://${BUCKET}/`;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const SIGNED_URL_SECONDS = 3600;

export class PuzzleImageStorageError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number = 503) {
    super(message);
    this.name = 'PuzzleImageStorageError';
    this.statusCode = statusCode;
  }
}

let storageClient: S3Client | null = null;

function getStorageClient(): S3Client {
  if (storageClient) return storageClient;
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION } = process.env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_ENDPOINT_URL_S3 || !AWS_REGION) {
    throw new PuzzleImageStorageError(
      'Persistent puzzle image storage is not configured. Configure the Neon storage environment variables.'
    );
  }
  try {
    new URL(AWS_ENDPOINT_URL_S3);
  } catch {
    throw new PuzzleImageStorageError('Persistent puzzle image storage has an invalid endpoint configuration.');
  }
  storageClient = new S3Client({
    region: AWS_REGION,
    endpoint: AWS_ENDPOINT_URL_S3,
    maxAttempts: 2,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  return storageClient;
}

export function isPuzzleImageReference(value: string): boolean {
  return value.startsWith(IMAGE_PREFIX) && value.length > IMAGE_PREFIX.length;
}

export async function assertPuzzleImageStorageAvailable(): Promise<void> {
  await getStorageClient().send(new HeadBucketCommand({ Bucket: BUCKET }));
}

function getObjectKey(imageReference: string): string | null {
  if (!isPuzzleImageReference(imageReference)) return null;
  const key = imageReference.slice(IMAGE_PREFIX.length);
  if (key.startsWith('/') || key.split('/').some((part) => part === '.' || part === '..')) {
    throw new PuzzleImageStorageError('Invalid puzzle image reference.', 400);
  }
  return key;
}

export async function uploadPuzzleImage(
  bytes: Buffer,
  mimeType: string
): Promise<{ imageReference: string; previewUrl: string }> {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new PuzzleImageStorageError('Image must be no larger than 2 MB.', 413);
  }
  const extension = await getValidatedPuzzleImageExtension(bytes, mimeType);
  if (!extension) {
    throw new PuzzleImageStorageError('The upload is not a valid, decodable JPG, PNG, or WebP image.', 400);
  }

  const key = `component-questions/${crypto.randomUUID()}.${extension}`;
  const client = getStorageClient();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: bytes,
    ContentType: mimeType,
    CacheControl: 'private, max-age=3600',
  }));
  const previewUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: SIGNED_URL_SECONDS }
  );
  return { imageReference: `${IMAGE_PREFIX}${key}`, previewUrl };
}

export async function resolvePuzzleImageUrl(imageReference: string): Promise<string> {
  const key = getObjectKey(imageReference);
  if (!key) return imageReference;
  const client = getStorageClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: SIGNED_URL_SECONDS }
  );
}
