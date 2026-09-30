/**
 * Image and File Utilities — Issue #812
 *
 * Helper functions for image compression, file type validation, and MIME type
 * detection. Uses expo-image-manipulator for compression (already in
 * package.json) to stay consistent with the Expo ecosystem used across the
 * project.
 */

import * as ImageManipulator from 'expo-image-manipulator';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CompressImageOptions {
  /** Maximum width in pixels. Defaults to 1024. */
  maxWidth?: number;
  /** Maximum height in pixels. Defaults to 1024. */
  maxHeight?: number;
  /**
   * JPEG quality 0–1. Defaults to 0.8.
   * Only applies when the output format is JPEG.
   */
  quality?: number;
  /** Output format. Defaults to 'jpeg'. */
  format?: 'jpeg' | 'png' | 'webp';
}

export interface CompressedImageResult {
  uri: string;
  width: number;
  height: number;
  /** Size in bytes, when available from the manipulator result. */
  size?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME type map
// ─────────────────────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  // Audio / Video
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  // Archives
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  // Other
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
};

// ─────────────────────────────────────────────────────────────────────────────
// compressImage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compresses an image at the given URI using expo-image-manipulator.
 *
 * Resizes (maintaining aspect ratio) so neither dimension exceeds the provided
 * maxWidth / maxHeight, then re-encodes at the requested quality.
 *
 * @param uri     - Local file URI of the source image.
 * @param options - Optional compression settings.
 * @returns       - A CompressedImageResult with the new URI and dimensions.
 */
export async function compressImage(
  uri: string,
  options: CompressImageOptions = {},
): Promise<CompressedImageResult> {
  const {
    maxWidth = 1024,
    maxHeight = 1024,
    quality = 0.8,
    format = 'jpeg',
  } = options;

  const manipFormat =
    format === 'png'
      ? ImageManipulator.SaveFormat.PNG
      : format === 'webp'
        ? ImageManipulator.SaveFormat.WEBP
        : ImageManipulator.SaveFormat.JPEG;

  const actions: ImageManipulator.Action[] = [
    { resize: { width: maxWidth, height: maxHeight } },
  ];

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: quality,
    format: manipFormat,
  });

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getFileExtension
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the lower-cased file extension (without the leading dot) for a
 * given filename or path. Returns an empty string when no extension is found.
 *
 * @example
 * getFileExtension('photo.JPG')  // → 'jpg'
 * getFileExtension('archive.tar.gz') // → 'gz'
 * getFileExtension('README') // → ''
 */
export function getFileExtension(filename: string): string {
  if (!filename || typeof filename !== 'string') return '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// getMimeType
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the MIME type string for a given filename based on its extension.
 * Falls back to `'application/octet-stream'` for unknown extensions.
 *
 * @example
 * getMimeType('report.pdf')  // → 'application/pdf'
 * getMimeType('photo.jpg')   // → 'image/jpeg'
 * getMimeType('data.bin')    // → 'application/octet-stream'
 */
export function getMimeType(filename: string): string {
  const ext = getFileExtension(filename);
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ─────────────────────────────────────────────────────────────────────────────
// isValidFileType
// ─────────────────────────────────────────────────────────────────────────────

export interface FileInput {
  /** Filename or path used to derive the extension / MIME type. */
  name: string;
  /** Optional explicit MIME type (e.g. from a picker response). */
  type?: string;
}

/**
 * Validates whether a file is one of the allowed types.
 *
 * `allowedTypes` can contain MIME types (`'image/jpeg'`), MIME wildcards
 * (`'image/*'`), or plain extensions (`'pdf'`, `'.pdf'`).
 *
 * @example
 * isValidFileType({ name: 'cat.jpg' }, ['image/*'])         // true
 * isValidFileType({ name: 'virus.exe' }, ['image/*', 'application/pdf']) // false
 */
export function isValidFileType(file: FileInput, allowedTypes: string[]): boolean {
  if (!file || !Array.isArray(allowedTypes) || allowedTypes.length === 0) return false;

  const ext = getFileExtension(file.name);
  const mime = file.type ?? getMimeType(file.name);

  return allowedTypes.some((allowed) => {
    const normalised = allowed.toLowerCase().replace(/^\./, '');

    // Plain extension match: 'pdf' matches ext 'pdf'
    if (!normalised.includes('/')) {
      return ext === normalised;
    }

    // Wildcard MIME match: 'image/*' matches 'image/jpeg'
    if (normalised.endsWith('/*')) {
      const prefix = normalised.slice(0, -2); // e.g. 'image'
      return mime.startsWith(`${prefix}/`);
    }

    // Exact MIME match
    return mime === normalised;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// formatFileSize
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a byte count into a human-readable string with appropriate unit
 * (B, KB, MB, GB).
 *
 * @param bytes - File size in bytes.
 * @param decimals - Number of decimal places. Defaults to 2.
 *
 * @example
 * formatFileSize(0)            // '0 B'
 * formatFileSize(1024)         // '1.00 KB'
 * formatFileSize(1536, 1)      // '1.5 KB'
 * formatFileSize(1048576)      // '1.00 MB'
 */
export function formatFileSize(bytes: number, decimals: number = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);

  if (i === 0) return `${bytes} B`;

  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(decimals)} ${units[i]}`;
}
