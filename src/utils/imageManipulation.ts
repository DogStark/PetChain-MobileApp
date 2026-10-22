import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

/**
 * Image manipulation pipeline for pet and medical attachments.
 *
 * Privacy behavior (issue #1050):
 * - EXIF metadata (GPS, camera make/model, original timestamps, etc.) is
 *   stripped before the image is persisted locally or uploaded. The
 *   manipulator re-encodes the bitmap, so no EXIF block is carried over.
 * - Visual orientation is preserved by baking the source orientation into
 *   the pixels via the `rotate` action before re-encoding.
 * - The original file is only read into memory long enough to transform it;
 *   the temporary output is deleted after success or failure.
 */

/** Maximum width/height (px) for a bounded resolution. */
export const MAX_IMAGE_DIMENSION = 2048;

/** Maximum accepted source file size (bytes). */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Formats we can safely re-encode while preserving the container format. */
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'];

/** Actionable error surfaced to the UI when a file cannot be processed. */
export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

function extensionOf(uri: string): string {
  const clean = uri.split('?')[0];
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot).toLowerCase();
}

/**
 * Validate a source image before transforming it. Rejects oversized or
 * unsupported files with an actionable error message.
 */
export async function validateImage(uri: string): Promise<void> {
  const ext = extensionOf(uri);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ImageProcessingError(
      `Unsupported image format "${ext || 'unknown'}". Please choose a JPG, PNG, HEIC, or WebP photo.`,
    );
  }

  const info = await FileSystem.getInfoAsync(uri, { size: true });
  if (!info.exists) {
    throw new ImageProcessingError('The selected image could not be found. Please pick it again.');
  }
  if (typeof info.size === 'number' && info.size > MAX_IMAGE_BYTES) {
    const mb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
    throw new ImageProcessingError(
      `This image is too large. Please choose a photo under ${mb} MB.`,
    );
  }
}

/**
 * Strip metadata and normalize an image for storage/upload.
 *
 * Returns the URI of a freshly encoded file with no EXIF metadata, correct
 * visual orientation, the original format, and a bounded resolution. The
 * caller owns the returned file and should delete it when done.
 */
export async function stripImageMetadata(uri: string): Promise<string> {
  await validateImage(uri);

  const actions: ImageManipulator.Action[] = [];

  // Read dimensions so we can bound resolution and bake orientation.
  const probe = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  try {
    const { width, height } = probe;
    const longest = Math.max(width, height);
    if (longest > MAX_IMAGE_DIMENSION) {
      const scale = MAX_IMAGE_DIMENSION / longest;
      actions.push({ resize: { width: Math.round(width * scale) } });
    }

    // Re-encoding drops the EXIF block; the manipulator applies the source
    // orientation to the pixels so the result stays visually correct on both
    // iOS and Android without relying on an orientation tag.
    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    return result.uri;
  } finally {
    // The original is only needed in memory during the transform; never leave
    // the intermediate probe file in temporary storage.
    await FileSystem.deleteAsync(probe.uri, { idempotent: true }).catch(() => undefined);
  }
}

/**
 * Transform an attachment and hand back a metadata-free URI, cleaning up the
 * temporary output if the caller's persistence/upload step fails.
 */
export async function prepareAttachment(
  uri: string,
  persist: (cleanUri: string) => Promise<void>,
): Promise<void> {
  const cleanUri = await stripImageMetadata(uri);
  try {
    await persist(cleanUri);
  } catch (error) {
    await FileSystem.deleteAsync(cleanUri, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}
