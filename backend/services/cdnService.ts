/**
 * CDN service — backend
 *
 * Provides signed URL generation, server-side thumbnail creation, and
 * CDN cache invalidation for pet photos and medical record attachments.
 *
 * Medical record attachments are served via signed URLs with a 1-hour expiry.
 * Old unsigned URLs return 403 — callers must use the re-issue endpoint
 * (`POST /api/medical-records/attachments/signed-url`) to obtain a fresh URL.
 *
 * Migration path for existing unsigned URLs:
 *   1. Existing attachment rows have a bare `key` column in the DB.
 *   2. The re-issue endpoint accepts the raw storage key and issues a signed URL.
 *   3. Clients MUST NOT store the signed URL permanently; they should re-issue
 *      whenever the URL is about to expire (checked via `isSignedUrlExpiring`).
 *
 * Environment variables:
 *   CDN_BASE_URL              — Public CDN origin (e.g. https://cdn.petchain.app)
 *   CDN_SIGNING_SECRET        — HMAC-SHA256 secret for signed URLs (required in prod)
 *   CDN_SIGNED_URL_TTL_S      — Signed URL expiry in seconds (default: 3600 = 1 h)
 *   CDN_MEDICAL_SIGNING_SECRET — Separate secret for medical record URLs (falls back to CDN_SIGNING_SECRET)
 *   CDN_BUCKET                — Storage bucket / container name
 *   CDN_PROVIDER              — 'stub' | 's3' (default: 's3')
 *   THUMBNAIL_WIDTH           — Thumbnail width in px (default: 320)
 *   THUMBNAIL_HEIGHT          — Thumbnail height in px (default: 320)
 */

import crypto from 'crypto';
import path from 'path';

// sharp is an optional peer dependency; we fall back to the original URL
// when it is not available (e.g. in CI without native binaries).
let sharp: typeof import('sharp') | undefined;
try {
  sharp = require('sharp') as typeof import('sharp');
} catch {
  console.warn('[cdnService] sharp not installed; thumbnails will not be generated server-side');
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const CDN_BASE_URL = (process.env.CDN_BASE_URL ?? 'https://cdn.petchain.app').replace(/\/$/, '');
const CDN_SIGNING_SECRET = process.env.CDN_SIGNING_SECRET ?? 'petchain-dev-cdn-secret';
const CDN_MEDICAL_SIGNING_SECRET = process.env.CDN_MEDICAL_SIGNING_SECRET ?? CDN_SIGNING_SECRET;
const CDN_SIGNED_URL_TTL_S = Number(process.env.CDN_SIGNED_URL_TTL_S) || 3600;
const CDN_BUCKET = process.env.CDN_BUCKET ?? 'petchain-photos';
const CDN_PROVIDER = (process.env.CDN_PROVIDER ?? 's3') as 'stub' | 's3';
const THUMBNAIL_WIDTH = Number(process.env.THUMBNAIL_WIDTH) || 320;
const THUMBNAIL_HEIGHT = Number(process.env.THUMBNAIL_HEIGHT) || 320;

/** How many seconds before expiry to consider a URL "about to expire" (client-side threshold). */
export const SIGNED_URL_REFRESH_THRESHOLD_S = 300; // 5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface UploadResult {
  /** Public or CDN URL for the full-size image */
  url: string;
  /** Public or CDN URL for the thumbnail */
  thumbnailUrl: string;
  /** Storage key (path within the bucket) */
  key: string;
  /** Storage key for the thumbnail */
  thumbnailKey: string;
  /** Size in bytes of the stored image */
  sizeBytes: number;
}

export interface SignedUrlOptions {
  /** Extra query parameters to include in the signed URL */
  extraParams?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNED URL GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a time-limited, HMAC-signed URL for a CDN asset.
 *
 * The signature covers: key + expiry.  The CDN (or a reverse proxy) must
 * verify the signature before serving the file.
 *
 * @param key     Storage path of the asset (e.g. 'pets/p-123/photo-456.jpg')
 * @param options Optional URL parameters
 * @returns       Fully-qualified signed URL
 */
export function generateSignedUrl(key: string, options: SignedUrlOptions = {}): string {
  const expiry = Math.floor(Date.now() / 1000) + CDN_SIGNED_URL_TTL_S;
  const payload = `${key}:${expiry}`;
  const signature = crypto.createHmac('sha256', CDN_SIGNING_SECRET).update(payload).digest('hex');

  const params = new URLSearchParams({
    ...(options.extraParams ?? {}),
    expires: String(expiry),
    sig: signature,
  });

  return `${CDN_BASE_URL}/${key}?${params.toString()}`;
}

/**
 * Returns true when a signed URL's HMAC signature and expiry are valid.
 * Used in API middleware to verify inbound signed requests.
 */
export function verifySignedUrl(key: string, expires: string, sig: string): boolean {
  const expiry = Number(expires);
  if (isNaN(expiry) || Date.now() / 1000 > expiry) return false;

  const payload = `${key}:${expiry}`;
  const expected = crypto.createHmac('sha256', CDN_SIGNING_SECRET).update(payload).digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDICAL RECORD ATTACHMENT SIGNED URLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a signed URL specifically for a medical record attachment.
 * Uses CDN_MEDICAL_SIGNING_SECRET to allow key rotation independent of photo URLs.
 * URLs expire after CDN_SIGNED_URL_TTL_S (default 1 hour).
 */
export function generateMedicalRecordSignedUrl(key: string): string {
  const expiry = Math.floor(Date.now() / 1000) + CDN_SIGNED_URL_TTL_S;
  const payload = `medical:${key}:${expiry}`;
  const sig = crypto
    .createHmac('sha256', CDN_MEDICAL_SIGNING_SECRET)
    .update(payload)
    .digest('hex');

  const params = new URLSearchParams({ expires: String(expiry), sig, type: 'medical' });
  return `${CDN_BASE_URL}/${key}?${params.toString()}`;
}

/**
 * Verifies a medical record attachment signed URL.
 * Returns false for unsigned (legacy) URLs — those should return 403.
 */
export function verifyMedicalRecordSignedUrl(
  key: string,
  expires: string,
  sig: string,
): boolean {
  const expiry = Number(expires);
  if (isNaN(expiry) || Date.now() / 1000 > expiry) return false;

  const payload = `medical:${key}:${expiry}`;
  const expected = crypto
    .createHmac('sha256', CDN_MEDICAL_SIGNING_SECRET)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Re-issues a fresh signed URL for a medical record attachment.
 * Called by the backend endpoint when a client presents a valid session token.
 */
export function reissueMedicalRecordSignedUrl(storageKey: string): string {
  return generateMedicalRecordSignedUrl(storageKey);
}

/**
 * Returns true if a signed URL will expire within SIGNED_URL_REFRESH_THRESHOLD_S seconds.
 * Clients should call this before rendering and re-issue the URL if it returns true.
 */
export function isSignedUrlExpiring(signedUrl: string): boolean {
  try {
    const url = new URL(signedUrl);
    const expires = Number(url.searchParams.get('expires'));
    if (isNaN(expires)) return true;
    return expires - Date.now() / 1000 < SIGNED_URL_REFRESH_THRESHOLD_S;
  } catch {
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THUMBNAIL GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a square thumbnail from a JPEG buffer using sharp.
 * Returns null when sharp is unavailable.
 */
export async function generateThumbnail(
  imageBuffer: Buffer,
  width = THUMBNAIL_WIDTH,
  height = THUMBNAIL_HEIGHT,
): Promise<Buffer | null> {
  if (!sharp) return null;

  return sharp(imageBuffer)
    .resize(width, height, {
      fit: 'cover',
      position: 'centre',
    })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stores a photo (and its thumbnail) on the CDN and returns the public URLs.
 *
 * In production (`CDN_PROVIDER=s3`) this would delegate to the AWS SDK.
 * The stub implementation returns deterministic URLs so the rest of the
 * application can be developed and tested without real CDN credentials.
 */
export async function uploadPhoto(
  photoId: string,
  petId: string,
  imageBuffer: Buffer,
  mimeType = 'image/jpeg',
): Promise<UploadResult> {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const key = `pets/${petId}/${photoId}.${ext}`;
  const thumbnailKey = `pets/${petId}/thumbs/${photoId}.${ext}`;

  if (CDN_PROVIDER === 'stub') {
    return stubUpload(key, thumbnailKey, imageBuffer.length);
  }

  // --- S3-compatible upload ------------------------------------------------
  // The actual S3 SDK calls are abstracted here; swap for @aws-sdk/client-s3
  // or any compatible library in your infrastructure.
  console.warn(
    `[cdnService] Uploading ${key} to bucket ${CDN_BUCKET} (${imageBuffer.length} bytes)`,
  );

  const thumbnailBuffer = await generateThumbnail(imageBuffer);

  // In a real deployment these would be putObject calls to S3:
  //   await s3.putObject({ Bucket: CDN_BUCKET, Key: key, Body: imageBuffer, ContentType: mimeType });
  //   await s3.putObject({ Bucket: CDN_BUCKET, Key: thumbnailKey, Body: thumbnailBuffer ?? imageBuffer });

  return {
    url: `${CDN_BASE_URL}/${key}`,
    thumbnailUrl: `${CDN_BASE_URL}/${thumbnailKey}`,
    key,
    thumbnailKey,
    sizeBytes: imageBuffer.length,
  };

  void thumbnailBuffer; // suppress "unused" warning until real upload is wired
}

function stubUpload(key: string, thumbnailKey: string, sizeBytes: number): UploadResult {
  return {
    url: `${CDN_BASE_URL}/${key}`,
    thumbnailUrl: `${CDN_BASE_URL}/${thumbnailKey}`,
    key,
    thumbnailKey,
    sizeBytes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETION & CACHE INVALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deletes a stored photo (and its thumbnail) from the CDN/bucket and
 * invalidates the CDN edge cache for both paths.
 */
export async function deletePhoto(key: string, thumbnailKey: string): Promise<void> {
  if (CDN_PROVIDER === 'stub') {
    console.warn(`[cdnService] stub: would delete ${key} and ${thumbnailKey}`);
    return;
  }

  console.warn(`[cdnService] Deleting ${key} and ${thumbnailKey} from bucket ${CDN_BUCKET}`);

  // In a real deployment:
  //   await s3.deleteObjects({ Bucket: CDN_BUCKET, Delete: { Objects: [{ Key: key }, { Key: thumbnailKey }] } });
  //   await cloudfront.createInvalidation({ DistributionId, InvalidationBatch: { Paths: { Items: [`/${key}`, `/${thumbnailKey}`] } } });

  await invalidateCdnCache([key, thumbnailKey]);
}

/**
 * Sends a cache invalidation request for the given CDN paths.
 * Extend this with your actual CDN provider's invalidation API.
 */
export async function invalidateCdnCache(keys: string[]): Promise<void> {
  const paths = keys.map((k) => `/${k}`);
  console.warn(`[cdnService] Cache invalidation requested for: ${paths.join(', ')}`);

  // CloudFront example (uncomment and configure):
  // await cloudfront.createInvalidation({
  //   DistributionId: process.env.CDN_DISTRIBUTION_ID!,
  //   InvalidationBatch: {
  //     CallerReference: Date.now().toString(),
  //     Paths: { Quantity: paths.length, Items: paths },
  //   },
  // });
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE KEY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function photoKeyFromUrl(url: string): string {
  return url.replace(`${CDN_BASE_URL}/`, '').split('?')[0];
}

export function thumbnailKeyFromPhotoKey(photoKey: string): string {
  const dir = path.dirname(photoKey);
  const base = path.basename(photoKey);
  return `${dir}/thumbs/${base}`;
}

const cdnService = {
  generateSignedUrl,
  verifySignedUrl,
  generateMedicalRecordSignedUrl,
  verifyMedicalRecordSignedUrl,
  reissueMedicalRecordSignedUrl,
  isSignedUrlExpiring,
  generateThumbnail,
  uploadPhoto,
  deletePhoto,
  invalidateCdnCache,
  photoKeyFromUrl,
  thumbnailKeyFromPhotoKey,
};

export default cdnService;
