/**
 * Logging configuration
 * Issue #99 — Comprehensive Logging Infrastructure
 *
 * All logging behaviour is driven by environment variables so it can be
 * tuned per environment without code changes.
 */

export interface LoggingConfig {
  /** Minimum log level to emit (error | warn | info | http | debug) */
  level: string;
  /** Directory where rotating log files are written */
  logDir: string;
  /** Maximum size of a single log file before rotation (e.g. "20m") */
  maxFileSize: string;
  /** How long to keep combined log files (e.g. "14d") */
  retentionDays: string;
  /** How long to keep error log files (e.g. "30d") */
  errorRetentionDays: string;
  /** Sliding window (ms) used for error-rate spike detection */
  alertWindowMs: number;
  /** Number of errors within the window that triggers an alert */
  alertErrorThreshold: number;
  /** Datadog API key — enables Datadog transport when set */
  datadogApiKey?: string;
  /** Papertrail host — enables Papertrail transport when both host+port are set */
  papertrailHost?: string;
  /** Papertrail port */
  papertrailPort?: number;
  /** Logstash/ELK HTTP URL — enables ELK transport when set */
  logstashUrl?: string;
  /** Service name tag attached to every log entry */
  serviceName: string;
}

function loggingConfig(): LoggingConfig {
  const env = process.env.APP_ENV ?? 'development';

  return {
    level: process.env.LOG_LEVEL ?? (env === 'production' ? 'info' : 'debug'),
    logDir: process.env.LOG_DIR ?? 'logs',
    maxFileSize: process.env.LOG_MAX_SIZE ?? '20m',
    retentionDays: process.env.LOG_RETENTION_DAYS ? `${process.env.LOG_RETENTION_DAYS}d` : '14d',
    errorRetentionDays: process.env.LOG_ERROR_RETENTION_DAYS
      ? `${process.env.LOG_ERROR_RETENTION_DAYS}d`
      : '30d',
    alertWindowMs: Number(process.env.ALERT_WINDOW_MS ?? 60_000),
    alertErrorThreshold: Number(process.env.ALERT_ERROR_THRESHOLD ?? 10),
    datadogApiKey: process.env.DATADOG_API_KEY,
    papertrailHost: process.env.PAPERTRAIL_HOST,
    papertrailPort: process.env.PAPERTRAIL_PORT ? Number(process.env.PAPERTRAIL_PORT) : undefined,
    logstashUrl: process.env.LOGSTASH_URL,
    serviceName: process.env.SERVICE_NAME ?? 'petchain-api',
  };
}

/**
 * Issue #1089 — Support bundle redaction for backend and device diagnostics.
 *
 * Support exports must never leak authorization headers, account identifiers,
 * or full endpoint URLs. Only allowlisted diagnostic fields survive; forbidden
 * keys and values are stripped recursively before serialization, and the
 * resulting bundle is bounded in size.
 */
export const SUPPORT_BUNDLE_MAX_BYTES = 256 * 1024;

/** Diagnostic keys that are safe to include in a support bundle. */
export const SUPPORT_BUNDLE_ALLOWED_KEYS: readonly string[] = [
  'level',
  'message',
  'timestamp',
  'service',
  'serviceName',
  'environment',
  'env',
  'version',
  'appVersion',
  'platform',
  'os',
  'osVersion',
  'deviceModel',
  'deviceId',
  'buildNumber',
  'errorCode',
  'errorName',
  'stack',
  'statusCode',
  'durationMs',
  'requestId',
  'correlationId',
  'component',
  'module',
  'count',
  'tags',
];

/** Keys that must never appear in a support bundle, regardless of allowlist. */
export const SUPPORT_BUNDLE_FORBIDDEN_KEYS: readonly string[] = [
  'authorization',
  'auth',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'apiKey',
  'apikey',
  'secret',
  'password',
  'passwd',
  'cookie',
  'set-cookie',
  'session',
  'sessionId',
  'accountId',
  'accountNumber',
  'userId',
  'userEmail',
  'email',
  'phone',
  'ssn',
  'dob',
  'dateOfBirth',
  'url',
  'endpoint',
  'host',
  'hostname',
  'ip',
  'ipAddress',
  'headers',
  'requestHeaders',
  'responseHeaders',
  'query',
  'queryParams',
  'body',
  'requestBody',
  'responseBody',
  'payload',
];

const FORBIDDEN_KEY_SET = new Set(SUPPORT_BUNDLE_FORBIDDEN_KEYS.map((k) => k.toLowerCase()));
const ALLOWED_KEY_SET = new Set(SUPPORT_BUNDLE_ALLOWED_KEYS.map((k) => k.toLowerCase()));

/** Value patterns that indicate sensitive content even under an allowed key. */
const FORBIDDEN_VALUE_PATTERNS: readonly RegExp[] = [
  /\bbearer\s+[a-z0-9._\-]+/i,
  /\bbasic\s+[a-z0-9+/=]+/i,
  /\beyJ[a-z0-9_\-]+\.[a-z0-9_\-]+\.[a-z0-9_\-]+/i,
  /\bhttps?:\/\/[^\s"']+/i,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]?){13,19}\b/,
];

function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (FORBIDDEN_KEY_SET.has(normalized)) return true;
  // Catch compound keys such as `x-authorization-header` or `user_email`.
  return SUPPORT_BUNDLE_FORBIDDEN_KEYS.some((forbidden) =>
    normalized.includes(forbidden.toLowerCase()),
  );
}

function isAllowedKey(key: string): boolean {
  return ALLOWED_KEY_SET.has(key.toLowerCase());
}

function isForbiddenValue(value: string): boolean {
  return FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Recursively redact a diagnostic payload against the allowlisted schema.
 * Forbidden keys and values are removed; unknown keys are dropped.
 */
export function redactSupportBundle(input: unknown): unknown {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    return isForbiddenValue(input) ? '[REDACTED]' : input;
  }

  if (typeof input === 'number' || typeof input === 'boolean') return input;

  if (Array.isArray(input)) {
    return input
      .map((item) => redactSupportBundle(item))
      .filter((item) => item !== undefined);
  }

  if (typeof input === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isForbiddenKey(key) || !isAllowedKey(key)) continue;
      const redacted = redactSupportBundle(value);
      if (redacted !== undefined) output[key] = redacted;
    }
    return output;
  }

  return undefined;
}

/**
 * Redact and serialize a support bundle, bounding the result to
 * SUPPORT_BUNDLE_MAX_BYTES. Returns null when serialization fails.
 */
export function serializeSupportBundle(input: unknown): string | null {
  try {
    const redacted = redactSupportBundle(input);
    const serialized = JSON.stringify(redacted);
    if (serialized === undefined) return null;
    if (Buffer.byteLength(serialized, 'utf8') <= SUPPORT_BUNDLE_MAX_BYTES) return serialized;

    // Bound the bundle by trimming the largest arrays until it fits.
    const bounded = boundSupportBundle(redacted);
    const boundedSerialized = JSON.stringify(bounded);
    if (boundedSerialized === undefined) return null;
    if (Buffer.byteLength(boundedSerialized, 'utf8') <= SUPPORT_BUNDLE_MAX_BYTES) {
      return boundedSerialized;
    }
    return JSON.stringify({ truncated: true, reason: 'bundle-size-limit' });
  } catch {
    return null;
  }
}

function boundSupportBundle(value: unknown): unknown {
  if (Array.isArray(value)) {
    let items = value.map((item) => boundSupportBundle(item));
    while (items.length > 0 && Buffer.byteLength(JSON.stringify(items), 'utf8') > SUPPORT_BUNDLE_MAX_BYTES) {
      items = items.slice(0, Math.floor(items.length / 2));
    }
    return items;
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = boundSupportBundle(item);
    }
    return output;
  }
  return value;
}

/**
 * Build a user-visible export result without exposing bundle contents.
 */
export function buildSupportBundleExportResult(input: unknown): {
  success: boolean;
  message: string;
  bytes?: number;
} {
  const serialized = serializeSupportBundle(input);
  if (serialized === null) {
    return { success: false, message: 'Support bundle export failed. Please try again.' };
  }
  return {
    success: true,
    message: 'Support bundle exported successfully.',
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

export default loggingConfig();
