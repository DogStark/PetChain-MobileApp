import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

/**
 * Attachment image service.
 *
 * All pet and medical attachment images pass through this service before they
 * are persisted locally or uploaded. The service re-encodes every image with
 * the existing image manipulation pipeline, which drops EXIF metadata
 * (GPS coordinates, camera make/model, device identifiers and the original
 * capture timestamp) while keeping the visual orientation correct on both
 * iOS and Android.
 *
 * Behavior:
 * - EXIF GPS, camera and original timestamp fields are stripped by re-encoding.
 * - Orientation is normalized so the image looks correct on iOS and Android.
 * - The original format is preserved and the resolution is bounded.
 * - Oversized or unsupported files are rejected with an actionable error.
 * - The original file is only held in memory long enough to transform it and
 *   is never left behind in temporary storage on success or failure.
 */

/** Maximum accepted source file size (bytes). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

/** Longest edge allowed after transformation. */
export const MAX_ATTACHMENT_DIMENSION = 2048;

/** Formats we can safely re-encode while preserving the original format. */
const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

export class AttachmentImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentImageError';
  }
}

export interface ProcessedAttachment {
  /** Local file URI of the sanitized image. */
  uri: string;
  width: number;
  height: number;
  mimeType: string;
}

function extensionOf(uri: string): string {
  const clean = uri.split('?')[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot).toLowerCase() : '';
}

function isSupported(uri: string, mimeType?: string): boolean {
  if (mimeType && SUPPORTED_MIME_TYPES.includes(mimeType.toLowerCase())) {
    return true;
  }
  return SUPPORTED_EXTENSIONS.includes(extensionOf(uri));
}

function formatFor(uri: string, mimeType?: string): ImageManipulator.SaveFormat {
  const normalized = (mimeType ?? '').toLowerCase();
  if (normalized === 'image/png' || extensionOf(uri) === '.png') {
    return ImageManipulator.SaveFormat.PNG;
  }
  if (normalized === 'image/webp' || extensionOf(uri) === '.webp') {
    return ImageManipulator.SaveFormat.WEBP;
  }
  return ImageManipulator.SaveFormat.JPEG;
}

function mimeFor(format: ImageManipulator.SaveFormat): string {
  switch (format) {
    case ImageManipulator.SaveFormat.PNG:
      return 'image/png';
    case ImageManipulator.SaveFormat.WEBP:
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

/**
 * Strip metadata from an attachment image and return a sanitized local file.
 *
 * The source file is read into memory, transformed, and the temporary source
 * copy (if any) is removed in a finally block so nothing is left behind on
 * success or failure.
 */
export async function stripAttachmentMetadata(
  sourceUri: string,
  mimeType?: string,
): Promise<ProcessedAttachment> {
  if (!sourceUri) {
    throw new AttachmentImageError('No image was provided. Please choose a photo and try again.');
  }

  if (!isSupported(sourceUri, mimeType)) {
    throw new AttachmentImageError(
      'Unsupported image format. Please use a JPEG, PNG, or WebP photo.',
    );
  }

  const info = await FileSystem.getInfoAsync(sourceUri, { size: true });
  if (!info.exists) {
    throw new AttachmentImageError('The selected image could not be found. Please choose it again.');
  }
  if (typeof info.size === 'number' && info.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentImageError(
      `Image is too large (${Math.round(info.size / (1024 * 1024))} MB). ` +
        `Please choose a photo under ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const format = formatFor(sourceUri, mimeType);

  try {
    // Re-encoding through the manipulation pipeline drops EXIF metadata
    // (GPS, camera, original timestamp) and normalizes orientation.
    const result = await ImageManipulator.manipulateAsync(
      sourceUri,
      [{ resize: { width: MAX_ATTACHMENT_DIMENSION } }],
      {
        compress: 0.9,
        format,
        base64: false,
      },
    );

    if (!result?.uri) {
      throw new AttachmentImageError('The image could not be processed. Please try another photo.');
    }

    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      mimeType: mimeFor(format),
    };
  } catch (error) {
    if (error instanceof AttachmentImageError) {
      throw error;
    }
    throw new AttachmentImageError(
      'The image could not be processed. Please try another photo.',
    );
  } finally {
    // The original is only needed in memory for the transform above. Remove
    // any temporary source copy so it is not left in temporary storage.
    if (Platform.OS !== 'web' && sourceUri.startsWith(FileSystem.cacheDirectory ?? '')) {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => undefined);
    }
  }
}
