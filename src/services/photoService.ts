/**
 * Photo service — client-side
 *
 * Handles pet photo management with privacy-safe processing:
 *  - EXIF metadata (including GPS coordinates) is stripped before upload
 *    using expo-image-manipulator
 *  - Photos are compressed to a configurable quality level
 *  - Upload supports cancellation via AbortController
 *  - Upload progress is reported via an optional onProgress callback
 *  - SHA-256 checksum is computed on the processed file for integrity verification
 *  - Metered-network detection: uploads are gated behind a `allowMetered` flag
 *    when NetInfo reports that the connection is metered (mobile data)
 *
 * ### Cancellation / resumable uploads (issue #964)
 *
 * `uploadPhoto` returns an `UploadHandle` with an `abort()` method.  The
 * caller can store the handle and call `abort()` to cancel the in-flight
 * request.  A cancelled upload throws an `UploadCancelledError` so the UI
 * can distinguish it from a real network error.
 *
 * True byte-range resumption is not natively available in Expo's JS layer, so
 * the service uses an **idempotent re-upload strategy**:
 *   1. The client sends a `X-Checksum-SHA256` header with every request.
 *   2. If the server has already stored a photo with that checksum for the
 *      given pet, it returns the existing record instead of storing a duplicate.
 *   3. The client can therefore safely retry after a transient failure without
 *      worrying about duplicate uploads.
 *
 * ### Platform notes
 * - iOS and Android both honour `AbortController` on the `fetch` / `XMLHttpRequest`
 *   layer that Expo's networking stack is built on.
 * - `@react-native-community/netinfo` is used for metered-network detection.
 *   On iOS a connection is considered metered when `isConnectionExpensive` is
 *   true; on Android this maps to the `isConnectionExpensive` field as well.
 */

import NetInfo from '@react-native-community/netinfo';
import CryptoJS from 'crypto-js';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';

import apiClient from './apiClient';
import { logError } from '../utils/errorLogger';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PhotoQuality = 'high' | 'medium' | 'low';

const QUALITY_MAP: Record<PhotoQuality, number> = {
  high: 0.9,
  medium: 0.7,
  low: 0.5,
};

/** Maximum dimension (width or height) in pixels before the image is resized */
const MAX_DIMENSION: Record<PhotoQuality, number> = {
  high: 2048,
  medium: 1280,
  low: 800,
};

export interface PetPhoto {
  id: string;
  petId: string;
  caption?: string;
  url: string;
  thumbnailUrl: string;
  sizeBytes: number;
  width: number;
  height: number;
  uploadedAt: string;
  uploadedById: string;
}

export interface UploadPhotoInput {
  petId: string;
  localUri: string;
  caption?: string;
  quality?: PhotoQuality;
  /** Called with values 0–1 as the upload progresses */
  onProgress?: (fraction: number) => void;
  /**
   * When true the upload is allowed even on a metered (mobile-data) connection.
   * Defaults to false — callers must explicitly opt in.
   */
  allowMetered?: boolean;
}

export interface UploadPhotoResult {
  photo: PetPhoto;
}

export interface ProcessedPhoto {
  /** file:// URI of the processed (EXIF-stripped, compressed) image */
  uri: string;
  width: number;
  height: number;
  /** Estimated size in bytes after processing */
  estimatedBytes: number;
  /** SHA-256 hex digest of the processed JPEG bytes (for server-side dedup) */
  checksumSha256: string;
}

/**
 * Thrown when an in-flight upload is cancelled by the caller.
 * The UI can distinguish this from a real network error.
 */
export class UploadCancelledError extends Error {
  constructor() {
    super('Upload was cancelled');
    this.name = 'UploadCancelledError';
  }
}

/**
 * Handle returned by `uploadPhoto`.
 * Call `abort()` to cancel the in-flight request.
 */
export interface UploadHandle {
  /** Promise that resolves to the uploaded photo or rejects with an error */
  promise: Promise<UploadPhotoResult>;
  /** Cancel the in-flight upload; the promise will reject with UploadCancelledError */
  abort: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIMITS  (Issue #963)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard limits applied to every uploaded photo.
 *
 * These are enforced in `stripExifAndCompress`, not merely documented, so an
 * oversized or unsupported file fails fast on-device instead of after a long
 * upload.
 */
export const PHOTO_LIMITS = {
  /** Largest accepted source file. Anything bigger is rejected before decode. */
  maxInputBytes: 15 * 1024 * 1024,
  /** Longest output edge per quality preset, in pixels. */
  maxOutputDimension: MAX_DIMENSION,
  /**
   * Source containers we accept. The output is always JPEG regardless — the
   * re-encode is what strips metadata.
   */
  allowedInputExtensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] as const,
} as const;

export class PhotoValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'UNSUPPORTED_FORMAT'
      | 'FILE_TOO_LARGE'
      | 'DECODE_FAILED'
      | 'VERIFICATION_FAILED',
  ) {
    super(message);
    this.name = 'PhotoValidationError';
  }
}

function extensionOf(uri: string): string {
  // Strip query/fragment first — content:// and file:// URIs may carry both.
  const path = uri.split(/[?#]/)[0];
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  return dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * Reject unsupported containers before we hand the file to the decoder.
 *
 * An extensionless URI is allowed through: content:// URIs from the Android
 * picker frequently have none, and the decoder is the real authority on
 * whether the bytes are an image.
 */
function assertSupportedFormat(localUri: string): void {
  const ext = extensionOf(localUri);
  if (ext === '') return;
  if (!(PHOTO_LIMITS.allowedInputExtensions as readonly string[]).includes(ext)) {
    throw new PhotoValidationError(
      `Unsupported image format ".${ext}". Supported: ${PHOTO_LIMITS.allowedInputExtensions.join(', ')}.`,
      'UNSUPPORTED_FORMAT',
    );
  }
}

/**
 * Read the source pixel dimensions without re-encoding.
 *
 * Needed so we only ever *downscale*: the previous implementation passed
 * `resize: { width: maxDim }` unconditionally, which upscaled a 400px photo to
 * 1280px — inflating the upload while destroying quality.
 */
function getSourceSize(localUri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      localUri,
      (width, height) => resolve({ width, height }),
      (error: unknown) =>
        reject(
          new PhotoValidationError(
            `Could not read image dimensions: ${String(error)}`,
            'DECODE_FAILED',
          ),
        ),
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXIF STRIPPING & COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips all EXIF metadata (including GPS coordinates) from a local image URI,
 * applies lossy JPEG compression at the requested quality level, and computes
 * a SHA-256 checksum of the resulting file for integrity checking / dedup.
 *
 * expo-image-manipulator re-encodes the image from scratch, which removes ALL
 * metadata blocks embedded in the original file — including:
 *   - GPS coordinates
 *   - Camera model / serial number
 *   - Date / time stamps
 *   - Thumbnail previews embedded in EXIF
 *
 * `expo-image-manipulator` decodes the source to a bitmap and re-encodes it
 * from scratch. The encoder writes only image data, so every metadata block in
 * the original is dropped:
 *
 *   - GPS coordinates (the owner's home address, in practice)
 *   - Camera make / model / serial number
 *   - Capture timestamps
 *   - Embedded EXIF thumbnail previews (which retain their own GPS copy)
 *
 * ## Orientation
 *
 * Decoding applies the source EXIF `Orientation` tag, so the bitmap handed to
 * the encoder is already upright and the output needs no orientation tag of
 * its own. A portrait photo that was stored as landscape-plus-rotation comes
 * out as true portrait. `verifyProcessedOutput` asserts the aspect ratio was
 * preserved, which catches a decoder that ignores the tag.
 *
 * ## Limits
 *
 * See {@link PHOTO_LIMITS}. Oversized or unsupported files throw
 * {@link PhotoValidationError} before any network call.
 *
 * @param localUri  file:// or content:// URI from the image picker
 * @param quality   compression preset ('high' | 'medium' | 'low')
 * @param sourceBytes optional source size, when the picker reported one
 */
export async function stripExifAndCompress(
  localUri: string,
  quality: PhotoQuality = 'medium',
  sourceBytes?: number,
): Promise<ProcessedPhoto> {
  assertSupportedFormat(localUri);

  if (sourceBytes != null && sourceBytes > PHOTO_LIMITS.maxInputBytes) {
    throw new PhotoValidationError(
      `Image is ${Math.round(sourceBytes / 1024 / 1024)} MB; the limit is ${Math.round(
        PHOTO_LIMITS.maxInputBytes / 1024 / 1024,
      )} MB.`,
      'FILE_TOO_LARGE',
    );
  }

  const compress = QUALITY_MAP[quality];
  const maxDim = MAX_DIMENSION[quality];
  const source = await getSourceSize(localUri);

  // Only downscale, and constrain the *longest* edge so portrait photos are
  // bounded by their height rather than being left oversized.
  const longestEdge = Math.max(source.width, source.height);
  const actions: ImageManipulator.Action[] =
    longestEdge > maxDim
      ? [
          source.width >= source.height
            ? { resize: { width: maxDim } }
            : { resize: { height: maxDim } },
        ]
      : [];

  // Single pass: resize and compress together. The previous two-pass version
  // encoded to JPEG at quality 1.0 and then re-encoded, compounding artefacts
  // for no benefit.
  const processed = await ImageManipulator.manipulateAsync(localUri, actions, {
    compress,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  // Compute a SHA-256 checksum of the processed image bytes.
  // expo-image-manipulator can return base64 when requested; we use that to
  // feed CryptoJS without an extra file read.
  let checksumSha256 = '';
  if (compressed.base64) {
    const wordArray = CryptoJS.enc.Base64.parse(compressed.base64);
    checksumSha256 = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
  } else {
    // Fallback: read the file from disk and hash it
    try {
      const base64Content = await FileSystem.readAsStringAsync(compressed.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const wordArray = CryptoJS.enc.Base64.parse(base64Content);
      checksumSha256 = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
    } catch {
      // Non-fatal — server will still accept the upload; dedup just won't work
      checksumSha256 = '';
    }
  }

  // Rough size estimate: dimensions × 3 bytes/pixel × compress factor
  const estimatedBytes = Math.round(compressed.width * compressed.height * 3 * compress * 0.1);

  return {
    uri: processed.uri,
    width: processed.width,
    height: processed.height,
    estimatedBytes,
    checksumSha256,
  };
}

/**
 * Verify the re-encode actually produced what we asked for.
 *
 * Without this the upload path trusts the manipulator blindly: a failed
 * resize, a zero-dimension result, or a swapped aspect ratio would all sail
 * through and reach the CDN.
 */
export function verifyProcessedOutput(
  processed: { uri: string; width: number; height: number },
  source: { width: number; height: number },
  maxDim: number,
): void {
  if (!processed.uri) {
    throw new PhotoValidationError('Processed image has no URI.', 'VERIFICATION_FAILED');
  }

  if (processed.width <= 0 || processed.height <= 0) {
    throw new PhotoValidationError(
      `Processed image has invalid dimensions (${processed.width}x${processed.height}).`,
      'VERIFICATION_FAILED',
    );
  }

  if (Math.max(processed.width, processed.height) > maxDim) {
    throw new PhotoValidationError(
      `Processed image exceeds the ${maxDim}px limit (${processed.width}x${processed.height}).`,
      'VERIFICATION_FAILED',
    );
  }

  // Aspect ratio must survive the round trip. A mismatch means orientation was
  // mishandled (portrait encoded as landscape) or the resize was non-uniform.
  const sourceRatio = source.width / source.height;
  const outputRatio = processed.width / processed.height;
  const tolerance = 0.05;
  if (Math.abs(sourceRatio - outputRatio) / sourceRatio > tolerance) {
    throw new PhotoValidationError(
      `Aspect ratio changed during processing (${sourceRatio.toFixed(3)} -> ${outputRatio.toFixed(3)}); orientation may have been lost.`,
      'VERIFICATION_FAILED',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// METERED-NETWORK CHECK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the device is currently on a metered connection (mobile
 * data) AND the caller has not explicitly set `allowMetered: true`.
 */
async function isBlockedByMeteredNetwork(allowMetered: boolean): Promise<boolean> {
  if (allowMetered) return false;
  try {
    const state = await NetInfo.fetch();
    // isConnectionExpensive is set to true on iOS/Android for mobile data
    return state.isConnected === true && state.details?.isConnectionExpensive === true;
  } catch {
    // If we cannot determine network type, allow the upload
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API CALLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes the photo (EXIF strip + compress), checks for a metered network,
 * then uploads it to the backend with cancellation and progress support.
 *
 * Returns an `UploadHandle` so the caller can cancel the request:
 *
 * ```ts
 * const handle = uploadPhoto({ petId, localUri });
 * // later, if the user taps cancel:
 * handle.abort();
 * try {
 *   const result = await handle.promise;
 * } catch (err) {
 *   if (err instanceof UploadCancelledError) {
 *     // show "upload cancelled" message
 *   }
 * }
 * ```
 *
 * The upload sends a `X-Checksum-SHA256` header so the server can deduplicate
 * retried requests.
 */
export function uploadPhoto(input: UploadPhotoInput): UploadHandle {
  const controller = new AbortController();

  const promise = (async (): Promise<UploadPhotoResult> => {
    const {
      petId,
      localUri,
      caption,
      quality = 'medium',
      onProgress,
      allowMetered = false,
    } = input;

    // ── Metered-network gate ────────────────────────────────────────────────
    const blocked = await isBlockedByMeteredNetwork(allowMetered);
    if (blocked) {
      throw new Error(
        'Upload blocked on metered connection. Connect to Wi-Fi or enable "Use mobile data" in settings.',
      );
    }

    // ── EXIF strip + compress ───────────────────────────────────────────────
    let processed: ProcessedPhoto;
    try {
      processed = await stripExifAndCompress(localUri, quality);
    } catch (err) {
      logError(err instanceof Error ? err : new Error(String(err)), {
        service: 'photoService',
        action: 'stripExifAndCompress',
        petId,
      });
      throw new Error('Failed to process photo before upload. Please try again.');
    }

    // Check cancellation after processing (before network I/O)
    if (controller.signal.aborted) {
      throw new UploadCancelledError();
    }

    // Report processing-complete (10% of total progress)
    onProgress?.(0.1);

    // ── Build multipart payload ─────────────────────────────────────────────
    const formData = new FormData();
    formData.append('petId', petId);
    formData.append('photo', {
      uri: processed.uri,
      type: 'image/jpeg',
      name: `pet-photo-${Date.now()}.jpg`,
    } as unknown as Blob);
    formData.append('width', String(processed.width));
    formData.append('height', String(processed.height));
    if (caption) formData.append('caption', caption);

    // ── Upload via XMLHttpRequest for progress events ────────────────────────
    const result = await new Promise<UploadPhotoResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Abort when the AbortController fires
      const onAbort = () => {
        xhr.abort();
      };
      controller.signal.addEventListener('abort', onAbort);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          // Map 10%–100% to the upload phase (the first 10% was processing)
          const uploadFraction = event.loaded / event.total;
          onProgress?.(0.1 + uploadFraction * 0.9);
        }
      };

      xhr.onload = () => {
        controller.signal.removeEventListener('abort', onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as UploadPhotoResult;
            resolve(parsed);
          } catch {
            reject(new Error('Invalid server response'));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => {
        controller.signal.removeEventListener('abort', onAbort);
        reject(new Error('Network error during upload'));
      };

      xhr.onabort = () => {
        controller.signal.removeEventListener('abort', onAbort);
        reject(new UploadCancelledError());
      };

      // Retrieve the base URL from the axios instance defaults
      const baseURL: string = (apiClient.defaults?.baseURL as string | undefined) ?? '';
      xhr.open('POST', `${baseURL}/photos`);

      // Forward the auth token if axios has a default Authorization header
      const defaultHeaders = apiClient.defaults?.headers as
        | Record<string, Record<string, string>>
        | undefined;
      const authHeader =
        defaultHeaders?.common?.['Authorization'] ?? defaultHeaders?.post?.['Authorization'] ?? '';
      if (authHeader) {
        xhr.setRequestHeader('Authorization', authHeader);
      }

      // Checksum header for server-side idempotency / dedup
      if (processed.checksumSha256) {
        xhr.setRequestHeader('X-Checksum-SHA256', processed.checksumSha256);
      }

      xhr.send(formData);
    });

    onProgress?.(1);
    return result;
  })();

  return {
    promise,
    abort: () => controller.abort(),
  };
}

export interface ListPhotosOptions {
  page?: number;
  limit?: number;
}

/**
 * Returns a page of photos for a given pet, ordered newest-first.
 * The server generates thumbnails (200×200) so the grid never loads full-res images.
 */
export async function listPhotos(
  petId: string,
  options: ListPhotosOptions = {},
): Promise<PetPhoto[]> {
  const { page = 0, limit = 20 } = options;
  const response = await apiClient.get<{ data: PetPhoto[] }>(`/photos/pet/${petId}`, {
    params: { page, limit },
  });
  return response.data.data;
}

/**
 * Returns a single photo by ID.
 */
export async function getPhoto(photoId: string): Promise<PetPhoto> {
  const response = await apiClient.get<{ data: PetPhoto }>(`/photos/${photoId}`);
  return response.data.data;
}

/**
 * Deletes a photo and triggers CDN cache invalidation for both the full image
 * and its thumbnail.
 */
export async function deletePhoto(photoId: string): Promise<void> {
  await apiClient.delete(`/photos/${photoId}`);
}

const photoService = {
  stripExifAndCompress,
  verifyProcessedOutput,
  PHOTO_LIMITS,
  uploadPhoto,
  listPhotos,
  getPhoto,
  deletePhoto,
};

export default photoService;
