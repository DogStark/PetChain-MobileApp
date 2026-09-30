import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

/**
 * Attachment service.
 *
 * Privacy behavior: images selected for pet and medical attachments are
 * re-encoded through the image manipulation pipeline before they are persisted
 * locally or uploaded. Re-encoding strips EXIF metadata (GPS coordinates,
 * camera/device identifiers, and original capture timestamps) while preserving
 * the visual orientation and the source format. Resolution is bounded to keep
 * stored/uploaded files reasonable. The original file is only held in memory
 * long enough to transform it and is never left behind in temporary storage.
 */

const MAX_DIMENSION = 2048;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

export interface AttachmentInput {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}

export interface ProcessedAttachment {
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

function extensionOf(fileName?: string | null): string {
  if (!fileName) {
    return '';
  }
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

function isSupported(input: AttachmentInput): boolean {
  const mime = (input.mimeType || '').toLowerCase();
  if (mime && SUPPORTED_MIME_TYPES.includes(mime)) {
    return true;
  }
  const ext = extensionOf(input.fileName) || extensionOf(input.uri);
  return SUPPORTED_EXTENSIONS.includes(ext);
}

function formatFor(input: AttachmentInput): ImageManipulator.SaveFormat {
  const mime = (input.mimeType || '').toLowerCase();
  const ext = extensionOf(input.fileName) || extensionOf(input.uri);
  if (mime === 'image/png' || ext === '.png') {
    return ImageManipulator.SaveFormat.PNG;
  }
  if (mime === 'image/webp' || ext === '.webp') {
    return ImageManipulator.SaveFormat.WEBP;
  }
  return ImageManipulator.SaveFormat.JPEG;
}

function extensionForFormat(format: ImageManipulator.SaveFormat): string {
  switch (format) {
    case ImageManipulator.SaveFormat.PNG:
      return '.png';
    case ImageManipulator.SaveFormat.WEBP:
      return '.webp';
    default:
      return '.jpg';
  }
}

function mimeForFormat(format: ImageManipulator.SaveFormat): string {
  switch (format) {
    case ImageManipulator.SaveFormat.PNG:
      return 'image/png';
    case ImageManipulator.SaveFormat.WEBP:
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

async function resolveFileSize(input: AttachmentInput): Promise<number | null> {
  if (typeof input.fileSize === 'number' && input.fileSize > 0) {
    return input.fileSize;
  }
  try {
    const info = await FileSystem.getInfoAsync(input.uri, { size: true });
    if (info.exists && typeof (info as { size?: number }).size === 'number') {
      return (info as { size: number }).size;
    }
  } catch {
    // Fall through: size is unknown, validation continues without it.
  }
  return null;
}

async function safeDelete(uri: string | null | undefined): Promise<void> {
  if (!uri) {
    return;
  }
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort cleanup; never surface cleanup failures to the caller.
  }
}

/**
 * Strip metadata from an image attachment and persist the sanitized copy.
 *
 * The returned file is a freshly encoded image with no EXIF GPS, camera, or
 * original timestamp fields. Orientation is normalized by the manipulator so
 * the result renders correctly on both iOS and Android. The source file is
 * deleted after a successful transform and on any failure path.
 */
export async function processAttachment(
  input: AttachmentInput,
  destinationDir: string,
): Promise<ProcessedAttachment> {
  if (!input?.uri) {
    throw new AttachmentError('No image was provided. Please choose a photo and try again.');
  }

  if (!isSupported(input)) {
    throw new AttachmentError(
      'Unsupported image format. Please choose a JPEG, PNG, or WebP photo.',
    );
  }

  const size = await resolveFileSize(input);
  if (size !== null && size > MAX_FILE_BYTES) {
    throw new AttachmentError(
      'This image is too large (over 25 MB). Please choose a smaller photo.',
    );
  }

  const format = formatFor(input);
  let transformed: ImageManipulator.ImageResult | null = null;

  try {
    const actions: ImageManipulator.Action[] = [];
    const context = ImageManipulator.manipulateAsync(input.uri, actions, {
      compress: 0.9,
      format,
    });
    transformed = await context;

    // Bound resolution while preserving aspect ratio.
    const longest = Math.max(transformed.width, transformed.height);
    if (longest > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / longest;
      const resizeAction: ImageManipulator.Action = {
        resize: {
          width: Math.round(transformed.width * scale),
          height: Math.round(transformed.height * scale),
        },
      };
      transformed = await ImageManipulator.manipulateAsync(
        transformed.uri,
        [resizeAction],
        { compress: 0.9, format },
      );
    }

    const extension = extensionForFormat(format);
    const baseName = (input.fileName || 'attachment').replace(/\.[^.]+$/, '');
    const fileName = `${baseName}-sanitized${extension}`;
    const destination = `${destinationDir.replace(/\/$/, '')}/${fileName}`;

    await FileSystem.makeDirectoryAsync(destinationDir, { intermediates: true }).catch(
      () => undefined,
    );
    await FileSystem.moveAsync({ from: transformed.uri, to: destination });

    const finalInfo = await FileSystem.getInfoAsync(destination, { size: true });
    const finalSize =
      finalInfo.exists && typeof (finalInfo as { size?: number }).size === 'number'
        ? (finalInfo as { size: number }).size
        : 0;

    return {
      uri: destination,
      fileName,
      mimeType: mimeForFormat(format),
      fileSize: finalSize,
      width: transformed.width,
      height: transformed.height,
    };
  } catch (error) {
    if (error instanceof AttachmentError) {
      throw error;
    }
    throw new AttachmentError(
      'We could not process this image. Please try a different photo.',
    );
  } finally {
    // Never leave the original or intermediate files in temporary storage.
    await safeDelete(transformed?.uri);
    await safeDelete(input.uri);
  }
}

/**
 * Produce a sanitized copy suitable for sharing without persisting it.
 * The caller is responsible for deleting the returned file after sharing.
 */
export async function prepareAttachmentForShare(
  input: AttachmentInput,
  cacheDir: string,
): Promise<ProcessedAttachment> {
  return processAttachment(input, cacheDir);
}

export const attachmentPlatform = Platform.OS;
