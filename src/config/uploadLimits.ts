/**
 * Centralized upload limits configuration for medical documents.
 *
 * Single source of truth for size/type limits used by both client and server.
 * All limits are configurable via environment variables (see src/config/index.ts).
 */

export interface UploadLimits {
  /** Maximum file size in bytes (default: 20 MB) */
  maxFileSize: number;
  /** Minimum file size in bytes (default: 64 bytes) */
  minFileSize: number;
  /** Allowed MIME types for medical documents */
  allowedMimeTypes: readonly string[];
  /** Chunk size for resumable uploads in bytes (default: 1 MB) */
  chunkSize: number;
  /** Maximum number of concurrent chunks (default: 3) */
  maxConcurrentChunks: number;
  /** Maximum retry attempts for failed chunks (default: 3) */
  maxChunkRetries: number;
  /** Retry delay base in ms (default: 1000) */
  retryBaseDelay: number;
  /** Maximum total upload time in ms (default: 10 minutes) */
  maxUploadTime: number;
}

/** Default limits - can be overridden by environment variables */
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxFileSize: 20 * 1024 * 1024, // 20 MB
  minFileSize: 64, // 64 bytes
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
  ] as const,
  chunkSize: 1 * 1024 * 1024, // 1 MB
  maxConcurrentChunks: 3,
  maxChunkRetries: 3,
  retryBaseDelay: 1000,
  maxUploadTime: 10 * 60 * 1000, // 10 minutes
};

/**
 * Get upload limits from environment or use defaults.
 * In production, these should match server-side limits.
 */
export function getUploadLimits(): UploadLimits {
  // These could be read from expo-config or environment variables
  // For now, use defaults that match server limits
  return DEFAULT_UPLOAD_LIMITS;
}

/** Validate a file against upload limits - throws with localized error code */
export function validateFileLimits(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  limits: UploadLimits = getUploadLimits(),
): { ok: true } | { ok: false; code: string; message: string } {
  // Check MIME type first (fastest check, no I/O)
  if (!limits.allowedMimeTypes.includes(mimeType)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MIME_TYPE',
      message: `Unsupported file type: ${mimeType}. Allowed: ${limits.allowedMimeTypes.join(', ')}`,
    };
  }

  // Check minimum size
  if (sizeBytes < limits.minFileSize) {
    return {
      ok: false,
      code: 'FILE_TOO_SMALL',
      message: `File is too small (${sizeBytes} bytes). Minimum: ${limits.minFileSize} bytes`,
    };
  }

  // Check maximum size
  if (sizeBytes > limits.maxFileSize) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `File too large (${formatBytes(sizeBytes)}). Maximum: ${formatBytes(limits.maxFileSize)}`,
    };
  }

  return { ok: true };
}

/** Format bytes as human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Get allowed extensions for file pickers */
export function getAllowedExtensions(limits: UploadLimits = getUploadLimits()): string[] {
  const mimeToExt: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
  };
  return limits.allowedMimeTypes.map((m) => mimeToExt[m] || '').filter(Boolean);
}