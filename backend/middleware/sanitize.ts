import type { NextFunction, Request, Response } from 'express';

import { SanitizationError, sanitizeObject } from '../utils/sanitize';

/**
 * Express middleware that sanitizes req.body, req.query, and req.params.
 * Responds with 400 if SQL injection is detected.
 */
export function sanitizeInputs(req: Request, res: Response, next: NextFunction): void {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body) as Record<string, unknown>;
    }
    if (req.query && typeof req.query === 'object') {
      const sanitized = sanitizeObject(req.query) as typeof req.query;
      // Some express adapters expose `req.query` as a getter-only value in tests.
      // Prefer in-place mutation; fall back to assignment when allowed.
      try {
        Object.keys(req.query).forEach((k) => delete (req.query as any)[k]);
        Object.assign(req.query as any, sanitized);
      } catch {
        req.query = sanitized;
      }
    }
    if (req.params && typeof req.params === 'object') {
      const sanitized = sanitizeObject(req.params) as typeof req.params;
      try {
        Object.keys(req.params).forEach((k) => delete (req.params as any)[k]);
        Object.assign(req.params as any, sanitized);
      } catch {
        req.params = sanitized;
      }
    }
    next();
  } catch (err) {
    if (err instanceof SanitizationError) {
      res.status(400).json({ success: false, error: 'INVALID_INPUT', message: err.message });
      return;
    }
    next(err);
  }
}
