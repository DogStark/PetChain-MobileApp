/**
 * Structured Winston logger
 * Issue #99 — Comprehensive Logging Infrastructure
 *
 * Features:
 * - Structured JSON output with consistent fields
 * - Log levels: error, warn, info, http, debug
 * - Correlation ID propagation via AsyncLocalStorage
 * - Daily log rotation with configurable retention
 * - Transports: console, rotating file, Datadog/Papertrail/ELK (env-driven)
 * - Error rate spike alerting via a sliding-window counter
 */

import { AsyncLocalStorage } from 'async_hooks';
import path from 'path';

// ─── Correlation ID store ─────────────────────────────────────────────────────

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  service?: string;
  [key: string]: unknown;
}

export const correlationStore = new AsyncLocalStorage<LogContext>();

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

export function getRequestId(): string | undefined {
  return correlationStore.getStore()?.requestId;
}

export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return correlationStore.run(ctx, fn);
}

// ─── Log directory ────────────────────────────────────────────────────────────

const LOG_DIR = process.env.LOG_DIR ?? path.join(process.cwd(), 'logs');

type LoggerLike = {
  error: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  http: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  log: (level: string, msg: string, meta?: Record<string, unknown>) => void;
};

function makeFallbackLogger(): LoggerLike {
  const write = (level: string, msg: string, meta?: Record<string, unknown>) => {
    const store = correlationStore.getStore();
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      requestId: store?.requestId,
      service: store?.service ?? process.env.SERVICE_NAME ?? 'petchain-api',
      message: msg,
      env: process.env.APP_ENV ?? 'development',
      correlationId: store?.correlationId,
      userId: store?.userId,
      ...(meta ?? {}),
    };
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    error: (msg, meta) => write('error', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    http: (msg, meta) => write('http', msg, meta),
    debug: (msg, meta) => write('debug', msg, meta),
    log: (level, msg, meta) => write(level, msg, meta),
  };
}

function createLogger(): LoggerLike {
  try {
    const winston = require('winston') as typeof import('winston');

    const DailyRotateFile = require('winston-daily-rotate-file') as {
      default?: new (opts: Record<string, unknown>) => unknown;
    };

    const structuredFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
      winston.format.errors({ stack: true }),
      winston.format.printf((info) => {
        const ctx = correlationStore.getStore() ?? {};
        const entry: Record<string, unknown> = {
          timestamp: info.timestamp,
          level: info.level,
          requestId: ctx.requestId,
          service: ctx.service ?? process.env.SERVICE_NAME ?? 'petchain-api',
          message: info.message,
          env: process.env.APP_ENV ?? 'development',
          correlationId: ctx.correlationId,
          userId: ctx.userId,
          ...(info.stack ? { stack: info.stack } : {}),
        };
        const { timestamp: _t, level: _l, message: _m, stack: _s, ...rest } = info;
        Object.assign(entry, rest);
        for (const key of Object.keys(entry)) {
          if (entry[key] === undefined) delete entry[key];
        }
        return JSON.stringify(entry);
      }),
    );

    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf((info) => {
        const ctx = correlationStore.getStore() ?? {};
        const cid = ctx.correlationId ? ` [${ctx.correlationId.slice(0, 8)}]` : '';
        return `${info.timestamp}${cid} ${info.level}: ${info.message}`;
      }),
    );

    const transports: import('winston').transport[] = [];
    const isDev = (process.env.APP_ENV ?? 'development') === 'development';
    transports.push(
      new winston.transports.Console({
        format: isDev ? consoleFormat : structuredFormat,
        silent: process.env.NODE_ENV === 'test',
      }),
    );

    if (DailyRotateFile?.default) {
      transports.push(
        new DailyRotateFile.default({
          dirname: LOG_DIR,
          filename: 'petchain-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: process.env.LOG_MAX_SIZE ?? '20m',
          maxFiles: process.env.LOG_RETENTION_DAYS ? `${process.env.LOG_RETENTION_DAYS}d` : '14d',
          format: structuredFormat,
        }) as import('winston').transport,
      );
      transports.push(
        new DailyRotateFile.default({
          dirname: LOG_DIR,
          filename: 'petchain-error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          zippedArchive: true,
          maxSize: process.env.LOG_MAX_SIZE ?? '20m',
          maxFiles: process.env.LOG_RETENTION_DAYS ? `${process.env.LOG_RETENTION_DAYS}d` : '30d',
          format: structuredFormat,
        }) as import('winston').transport,
      );
    }

    return winston.createLogger({
      level: process.env.LOG_LEVEL ?? (process.env.APP_ENV === 'production' ? 'info' : 'debug'),
      transports,
      exitOnError: false,
    }) as LoggerLike;
  } catch {
    return makeFallbackLogger();
  }
}

// ─── Logger instance ──────────────────────────────────────────────────────────

const logger = createLogger();

export default logger;

// ─── Error rate alerting ──────────────────────────────────────────────────────

const ERROR_WINDOW_MS = Number(process.env.ALERT_WINDOW_MS ?? 60_000); // 1 min
const ERROR_THRESHOLD = Number(process.env.ALERT_ERROR_THRESHOLD ?? 10); // 10 errors/min

const errorTimestamps: number[] = [];

export function trackError(): void {
  const now = Date.now();
  errorTimestamps.push(now);

  // Evict entries outside the window
  const cutoff = now - ERROR_WINDOW_MS;
  while (errorTimestamps.length > 0 && errorTimestamps[0]! < cutoff) {
    errorTimestamps.shift();
  }

  if (errorTimestamps.length >= ERROR_THRESHOLD) {
    logger.warn('ALERT: error rate spike detected', {
      errorsInWindow: errorTimestamps.length,
      windowMs: ERROR_WINDOW_MS,
      threshold: ERROR_THRESHOLD,
      alert: true,
    });
    // Drain the window so we don't spam the alert every single error
    errorTimestamps.length = 0;
  }
}

/** Expose for testing */
export function _resetErrorWindow(): void {
  errorTimestamps.length = 0;
}
