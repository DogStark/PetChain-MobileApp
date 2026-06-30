/**
 * Request logger middleware
 * Issue #629 — Structured logging with correlation IDs
 *
 * - Generates a UUID requestId per request (or reads X-Request-ID header)
 * - Propagates the requestId through AsyncLocalStorage for the full request lifecycle
 * - Attaches requestId to the response as X-Request-ID
 * - Logs structured HTTP access entries (method, path, status, duration, user)
 * - Calls trackError() on 5xx responses for rate-spike alerting
 */

import { randomUUID } from 'crypto';

import type { NextFunction, Request, Response } from 'express';

import logger, { runWithContext, trackError } from '../utils/logger';

export const REQUEST_ID_HEADER = 'x-request-id';
/** @deprecated use REQUEST_ID_HEADER */
export const CORRELATION_HEADER = 'x-correlation-id';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId =
    (req.headers[REQUEST_ID_HEADER] as string | undefined) ??
    (req.headers[CORRELATION_HEADER] as string | undefined) ??
    randomUUID();

  // Expose on the request object so downstream handlers can read it
  (req as Request & { requestId: string; correlationId: string }).requestId = requestId;
  (req as Request & { correlationId: string }).correlationId = requestId;

  res.setHeader(REQUEST_ID_HEADER, requestId);
  res.setHeader(CORRELATION_HEADER, requestId);

  const startMs = Date.now();
  const userId = (req as Request & { user?: { id: string } }).user?.id;

  runWithContext({ requestId, correlationId: requestId, userId }, () => {
    logger.http('incoming request', {
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length ? req.query : undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.on('finish', () => {
      const durationMs = Date.now() - startMs;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      logger.log(level, 'request completed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
        requestId,
      });

      if (res.statusCode >= 500) {
        trackError();
      }
    });

    next();
  });
}
