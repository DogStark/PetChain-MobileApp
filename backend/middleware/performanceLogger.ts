import type { NextFunction, Request, Response } from 'express';

type SentryLib = any;
let sentryLib: SentryLib | null | undefined;

function getSentry(): SentryLib | null {
  if (sentryLib !== undefined) return sentryLib;
  try {
    sentryLib = require('@sentry/node') as SentryLib;
  } catch {
    sentryLib = null;
  }
  return sentryLib;
}

// ─── DB Query Performance Tracking ───────────────────────────────────────────

interface SlowQuery {
  /** Sanitised query text (no parameter values) */
  text: string;
  durationMs: number;
  rowCount: number;
  recordedAt: string;
}

/** Rolling store of the 100 most recent slow queries (>100 ms) */
const slowQueryLog: SlowQuery[] = [];
const MAX_SLOW_QUERIES = 100;

/** Threshold in ms above which a query is considered slow (WARN) */
export const SLOW_QUERY_WARN_MS = 100;
/** Threshold in ms above which a query is considered critical (ERROR + Sentry) */
export const SLOW_QUERY_ERROR_MS = 500;

/**
 * Records a completed DB query for performance monitoring.
 * Called by the instrumented pool wrapper (see backend/config/database.ts).
 *
 * @param text      Raw query text — MUST already have parameter values removed.
 * @param durationMs  Wall-clock duration in milliseconds.
 * @param rowCount  Number of rows returned / affected.
 */
export function recordQueryMetric(text: string, durationMs: number, rowCount: number): void {
  if (durationMs < SLOW_QUERY_WARN_MS) return;

  const entry: SlowQuery = {
    text,
    durationMs,
    rowCount,
    recordedAt: new Date().toISOString(),
  };

  if (durationMs >= SLOW_QUERY_ERROR_MS) {
    console.error('[db:perf] SLOW QUERY (>500ms)', { durationMs, rowCount, text });
    const Sentry = getSentry();
    if (Sentry) {
      Sentry.captureMessage(`Slow DB query ${durationMs}ms`, {
        level: 'error',
        extra: { durationMs, rowCount, text },
      });
    }
  } else {
    console.warn('[db:perf] slow query (>100ms)', { durationMs, rowCount, text });
  }

  slowQueryLog.push(entry);
  // Keep only the most recent MAX_SLOW_QUERIES entries
  if (slowQueryLog.length > MAX_SLOW_QUERIES) {
    slowQueryLog.shift();
  }
}

/**
 * Returns up to 20 of the slowest queries recorded in the last 24 hours,
 * sorted by duration descending.
 */
export function getSlowQueries(): SlowQuery[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return slowQueryLog
    .filter((q) => new Date(q.recordedAt).getTime() >= cutoff)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 20);
}

// ─── HTTP Request Performance Middleware ─────────────────────────────────────

export function performanceLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const Sentry = getSentry();
  if (!Sentry) {
    next();
    return;
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    Sentry.addBreadcrumb({
      category: 'http',
      message: `${req.method} ${req.path}`,
      data: { duration, status: res.statusCode },
    });

    if (duration > 1000) {
      Sentry.captureMessage(`Slow request ${req.method} ${req.path} ${duration}ms`, {
        level: 'warning',
        extra: { duration, path: req.path, method: req.method, status: res.statusCode },
      });
    }
  });

  next();
}

export default performanceLogger;
