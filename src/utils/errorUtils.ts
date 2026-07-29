/**
 * errorUtils.ts
 *
 * Normalises API errors into a consistent AppError shape, maps error codes to
 * user-friendly messages, and provides predicate helpers for common error
 * categories (network, auth).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'UNKNOWN';

export interface AppError {
  /** Normalised machine-readable code */
  code: AppErrorCode;
  /** Human-readable message safe to display in the UI */
  message: string;
  /** Original HTTP status code if available */
  status?: number;
  /** Raw underlying error for logging/debugging */
  originalError?: unknown;
}

// ─── Error code → user-friendly message map ──────────────────────────────────

const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  NETWORK_ERROR: 'No internet connection. Please check your network and try again.',
  TIMEOUT: 'The request timed out. Please try again.',
  UNAUTHORIZED: 'Your session has expired. Please log in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource could not be found.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  CONFLICT: 'This action conflicts with an existing record.',
  UNKNOWN: 'An unexpected error occurred. Please try again.',
};

// ─── HTTP status → AppErrorCode ──────────────────────────────────────────────

function codeFromStatus(status: number): AppErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN';
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Normalises any thrown value (Axios error, fetch Response, plain Error, or
 * unknown) into a structured AppError.
 */
export function parseApiError(error: unknown): AppError {
  // Axios-style error with response
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const serverMessage: string | undefined =
      error.response?.data?.message ?? error.response?.data?.error;
    const code = status != null ? codeFromStatus(status) : 'NETWORK_ERROR';

    return {
      code,
      message: serverMessage ?? ERROR_MESSAGES[code],
      status,
      originalError: error,
    };
  }

  // Network / connection errors (no response)
  if (error instanceof Error) {
    if (
      error.message.toLowerCase().includes('network') ||
      error.message.toLowerCase().includes('failed to fetch') ||
      error.message.toLowerCase().includes('connection')
    ) {
      return {
        code: 'NETWORK_ERROR',
        message: ERROR_MESSAGES.NETWORK_ERROR,
        originalError: error,
      };
    }

    if (error.message.toLowerCase().includes('timeout')) {
      return {
        code: 'TIMEOUT',
        message: ERROR_MESSAGES.TIMEOUT,
        originalError: error,
      };
    }

    return {
      code: 'UNKNOWN',
      message: error.message || ERROR_MESSAGES.UNKNOWN,
      originalError: error,
    };
  }

  return {
    code: 'UNKNOWN',
    message: ERROR_MESSAGES.UNKNOWN,
    originalError: error,
  };
}

/**
 * Returns a display-safe string for any error value.
 * Suitable for toast messages and inline UI error text.
 */
export function getErrorMessage(error: unknown): string {
  const appError = parseApiError(error);
  return appError.message;
}

// ─── Predicates ───────────────────────────────────────────────────────────────

/**
 * Returns true when the error indicates a network connectivity failure
 * (no response received from the server).
 */
export function isNetworkError(error: unknown): boolean {
  if (isAxiosError(error) && error.response == null) return true;
  if (
    error instanceof Error &&
    (error.message.toLowerCase().includes('network') ||
      error.message.toLowerCase().includes('failed to fetch') ||
      error.message.toLowerCase().includes('connection'))
  ) {
    return true;
  }
  return false;
}

/**
 * Returns true when the error is a 401 Unauthorized or 403 Forbidden response,
 * indicating an authentication / authorisation failure.
 */
export function isAuthError(error: unknown): boolean {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    return status === 401 || status === 403;
  }
  const appError = parseApiError(error);
  return appError.code === 'UNAUTHORIZED' || appError.code === 'FORBIDDEN';
}

// ─── Internal type guard ──────────────────────────────────────────────────────

interface AxiosLikeError {
  isAxiosError?: boolean;
  response?: {
    status?: number;
    data?: {
      message?: string;
      error?: string;
    };
  };
  message: string;
}

function isAxiosError(error: unknown): error is AxiosLikeError {
  if (error == null || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  // Axios sets isAxiosError = true; also accept any error with a .response shape
  return (
    err['isAxiosError'] === true ||
    (typeof err['response'] === 'object' && err['response'] != null)
  );
}
