import type { Response } from 'express';

export function ok<T>(data: T, message?: string) {
  return {
    success: true as const,
    data,
    ...(message ? { message } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function errBody(code: string, message: string, details?: Record<string, unknown>) {
  return {
    success: false as const,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    timestamp: new Date().toISOString(),
  };
}

export function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json(errBody(code, message));
}
