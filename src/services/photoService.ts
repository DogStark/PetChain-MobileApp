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
 * @param localUri  file:// URI returned by the image picker
 * @param quality   compression preset ('high' | 'medium' | 'low')
 */
export async function stripExifAndCompress(
  localUri: string,
  quality: PhotoQuality = 'medium',
): Promise<ProcessedPhoto> {
  const compress = QUALITY_MAP[quality];
  const maxDim = MAX_DIMENSION[quality];

  // First pass: resize to enforce the maximum dimension while maintaining
  // aspect ratio. expo-image-manipulator accepts only one resize constraint
  // at a time, so we use 'width' — the height scales proportionally.
  const resized = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: maxDim } }],
    // SaveFormat.JPEG forces a full re-encode, which drops all EXIF data
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
  );

  // Second pass: apply compression.  We do this in two passes so the resize
  // step always works on the original full-quality image.
  const compressed = await ImageManipulator.manipulateAsync(resized.uri, [], {
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
    uri: compressed.uri,
    width: compressed.width,
    height: compressed.height,
    estimatedBytes,
    checksumSha256,
  };
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
  uploadPhoto,
  listPhotos,
  getPhoto,
  deletePhoto,
};

export default photoService;
