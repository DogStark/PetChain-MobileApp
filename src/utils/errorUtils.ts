/**
 * Error utilities for parsing and categorizing API errors.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiError {
  status?: number;
  message?: string;
  code?: string;
  response?: {
    status?: number;
    data?: {
      message?: string;
      code?: string;
    };
  };
  request?: unknown;
}

// ─── Error Parsing ───────────────────────────────────────────────────────────

/**
 * Parse an API error and extract a structured error object.
 * Handles various error shapes from Axios, Fetch, and generic errors.
 */
export function parseApiError(error: unknown): ApiError {
  if (!error) {
    return { message: 'An unknown error occurred.' };
  }

  if (isAxiosLikeError(error)) {
    return parseAxiosError(error);
  }

  if (isFetchLikeError(error)) {
    return parseFetchError(error);
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    return {
      status: typeof err.status === 'number' ? err.status : undefined,
      message: typeof err.message === 'string' ? err.message : undefined,
      code: typeof err.code === 'string' ? err.code : undefined,
    };
  }

  return { message: String(error) };
}

/**
 * Extract a human-readable error message from an unknown error.
 * Returns a fallback message when no specific message can be determined.
 */
export function getErrorMessage(error: unknown, fallback = 'An unexpected error occurred.'): string {
  const parsed = parseApiError(error);
  return parsed.message ?? fallback;
}

// ─── Error Predicates ────────────────────────────────────────────────────────

/**
 * Check if the error is a network-related error.
 * Matches Axios network errors, Fetch type errors, and errors with network-related codes.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;

  // Axios network error (no response received)
  if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') return true;

  // Check for network-related error codes
  if (typeof err.code === 'string' && ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) {
    return true;
  }

  // Request was made but no response received (network issue)
  if (err.request && !err.response) return true;

  return false;
}

/**
 * Check if the error is an authentication/authorization error.
 * Matches 401 (Unauthorized) and 403 (Forbidden) status codes.
 */
export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;

  // Check nested response
  const response = err.response as Record<string, unknown> | undefined;
  const status = err.status ?? response?.status;

  if (typeof status === 'number' && (status === 401 || status === 403)) return true;

  // Check for auth-related error codes
  if (typeof err.code === 'string' && ['UNAUTHORIZED', 'FORBIDDEN', 'AUTH_ERROR'].includes(err.code)) {
    return true;
  }

  return false;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function isAxiosLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  return (
    typeof err.config === 'object' ||
    (err.isAxiosError === true) ||
    (typeof err.response === 'object' && err.response !== null && typeof (err.response as Record<string, unknown>).status === 'number')
  );
}

function parseAxiosError(error: Record<string, unknown>): ApiError {
  const response = error.response as Record<string, unknown> | undefined;
  const data = response?.data as Record<string, unknown> | undefined;

  return {
    status: (response?.status ?? error.status) as number | undefined,
    message: (data?.message ?? error.message ?? response?.statusText) as string | undefined,
    code: (data?.code ?? error.code) as string | undefined,
  };
}

function isFetchLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  return typeof err.status === 'number' || typeof err.statusText === 'string';
}

function parseFetchError(error: Record<string, unknown>): ApiError {
  return {
    status: error.status as number | undefined,
    message: (error.statusText ?? error.message) as string | undefined,
  };
}
