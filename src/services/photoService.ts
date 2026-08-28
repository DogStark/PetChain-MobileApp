/**
 * Photo service — client-side
 *
 * Handles pet photo management with privacy-safe processing:
 *  - EXIF metadata (including GPS coordinates) is stripped before upload
 *    using expo-image-manipulator
 *  - Photos are compressed to a configurable quality level
 *  - Upload goes through the PetChain API which stores on CDN
 *  - Photos can be deleted with CDN cache invalidation
 */

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
  /** Source file size from the picker, checked against `PHOTO_LIMITS`. */
  sourceBytes?: number;
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
 * Strips all EXIF metadata (including GPS coordinates) from a local image URI
 * and applies lossy JPEG compression at the requested quality level.
 *
 * ## How metadata is removed
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
  });

  verifyProcessedOutput(processed, source, maxDim);

  // Rough size estimate: dimensions x 3 bytes/pixel x compress factor
  const estimatedBytes = Math.round(processed.width * processed.height * 3 * compress * 0.1);

  return {
    uri: processed.uri,
    width: processed.width,
    height: processed.height,
    estimatedBytes,
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
// API CALLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes the photo (EXIF strip + compress) then uploads it to the backend.
 *
 * The backend is responsible for generating a thumbnail and storing both the
 * full image and the thumbnail on the CDN via signed upload URLs.
 */
export async function uploadPhoto(input: UploadPhotoInput): Promise<UploadPhotoResult> {
  const { petId, localUri, caption, quality = 'medium', sourceBytes } = input;

  let processed: ProcessedPhoto;
  try {
    processed = await stripExifAndCompress(localUri, quality, sourceBytes);
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      service: 'photoService',
      action: 'stripExifAndCompress',
      petId,
    });
    // Validation failures carry a message the user can act on ("too large",
    // "unsupported format"); surface it instead of a generic retry prompt.
    if (err instanceof PhotoValidationError) throw err;
    throw new Error('Failed to process photo before upload. Please try again.');
  }

  // Build FormData for multipart upload
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

  const response = await apiClient.post<UploadPhotoResult>('/photos', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data;
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
