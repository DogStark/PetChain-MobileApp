/**
 * Shared error types for the mobile app.
 *
 * These errors are intentionally small and serializable so they can be
 * surfaced to the UI without leaking sensitive payloads.
 */

export class AppError extends Error {
  readonly code: string;

  constructor(message: string, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/**
 * Thrown when an API response exceeds the documented maximum size.
 *
 * The message deliberately contains only the limit and the observed size
 * (when known) — never the response body or any body-derived content.
 */
export class ResponseTooLargeError extends AppError {
  readonly limit: number;
  readonly size?: number;

  constructor(limit: number, size?: number) {
    super(
      size === undefined
        ? `API response exceeds the maximum allowed size of ${limit} bytes`
        : `API response of ${size} bytes exceeds the maximum allowed size of ${limit} bytes`,
      'RESPONSE_TOO_LARGE',
    );
    this.name = 'ResponseTooLargeError';
    this.limit = limit;
    this.size = size;
  }
}

/**
 * Documented maximum size (in bytes) for an API response before it is parsed.
 * Responses larger than this are rejected with a ResponseTooLargeError.
 */
export const MAX_API_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MiB
