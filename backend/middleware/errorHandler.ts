import * as Sentry from '@sentry/react-native';
import { AxiosError } from 'axios';

interface ErrorResponse {
  message: string;
  code?: string;
  status?: number;
}

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (error: unknown): ErrorResponse => {
  // Log error for debugging
  console.error('[Error Handler]', {
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : undefined,
  });

  // Capture error in Sentry
  if (error instanceof Error) {
    Sentry.captureException(error);
  } else {
    Sentry.captureMessage(typeof error === 'string' ? error : JSON.stringify(error));
  }

  // Handle Axios errors
  if (error instanceof AxiosError) {
    // Network errors
    if (!error.response) {
      return {
        message:
          error.code === 'ECONNABORTED'
            ? 'Request timeout. Please try again.'
            : 'Network error. Check your connection.',
        code: error.code || 'NETWORK_ERROR',
        status: 0,
      };
    }

    // API errors
    const status = error.response.status;
    const data = error.response.data;

    return {
      message: data?.message || getStatusMessage(status),
      code: data?.code || `HTTP_${status}`,
      status,
    };
  }

  // Handle custom app errors
  if (error instanceof AppError) {
    return {
      message: error.message,
      code: error.code,
      status: error.statusCode,
    };
  }

  // Handle validation errors
  if (error instanceof Error && error.name === 'ValidationError') {
    return {
      message: error.message,
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }

  // Generic error fallback
  return {
    message: error instanceof Error ? error.message : 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR',
    status: 500,
  };
};

const getStatusMessage = (status: number): string => {
  const messages: Record<number, string> = {
    400: 'Invalid request. Please check your input.',
    401: 'Authentication required. Please log in.',
    403: 'Access denied.',
    404: 'Resource not found.',
    408: 'Request timeout. Please try again.',
    429: 'Too many requests. Please wait.',
    500: 'Server error. Please try again later.',
    502: 'Service unavailable. Please try again.',
    503: 'Service temporarily unavailable.',
  };
  return messages[status] || 'An error occurred. Please try again.';
};
