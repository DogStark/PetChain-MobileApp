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
// EXIF STRIPPING & COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips all EXIF metadata (including GPS coordinates) from a local image
 * URI and applies lossy JPEG compression at the requested quality level.
 *
 * expo-image-manipulator re-encodes the image from scratch, which removes
 * ALL metadata blocks embedded in the original file — including:
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
  });

  // Rough size estimate: dimensions × 3 bytes/pixel × compress factor
  const estimatedBytes = Math.round(compressed.width * compressed.height * 3 * compress * 0.1);

  return {
    uri: compressed.uri,
    width: compressed.width,
    height: compressed.height,
    estimatedBytes,
  };
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
  const { petId, localUri, caption, quality = 'medium' } = input;

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
  uploadPhoto,
  listPhotos,
  getPhoto,
  deletePhoto,
};

export default photoService;
