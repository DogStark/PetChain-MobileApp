/**
 * Input sanitization utilities.
 *
 * - stripXss: removes HTML tags and dangerous attribute patterns
 * - detectSqlInjection: detects common SQL injection patterns
 * - truncate: enforces a maximum string length
 * - sanitizeValue: applies all three to a single string value
 * - sanitizeObject: recursively sanitizes all string values in an object
 */

/** Maximum allowed length for any single string input field. */
export const MAX_INPUT_LENGTH = 10_000;

// HTML tags and dangerous event/script patterns
const XSS_TAG_RE = /<[^>]*>/g;
const XSS_ATTR_RE = /\bon\w+\s*=|javascript\s*:|data\s*:/gi;

// Common SQL injection keywords and operators
const SQL_INJECTION_RE =
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|TRUNCATE|GRANT|REVOKE|CAST|CONVERT|DECLARE|CURSOR|FETCH|KILL|BACKUP|RESTORE|MERGE|CALL|LOAD|OUTFILE|DUMPFILE)\b|--|;|\/\*|\*\/|'\s*OR\s*'|'\s*AND\s*'|'\s*=\s*'|xp_|sp_)/i;

/**
 * Strips HTML tags and dangerous XSS patterns from a string.
 */
export function stripXss(value: string): string {
  return value.replace(XSS_TAG_RE, '').replace(XSS_ATTR_RE, '');
}

/**
 * Returns true if the value contains SQL injection patterns.
 */
export function detectSqlInjection(value: string): boolean {
  return SQL_INJECTION_RE.test(value);
}

/**
 * Truncates a string to the given maximum length.
 */
export function truncate(value: string, maxLength = MAX_INPUT_LENGTH): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Sanitizes a single string: truncate → strip XSS.
 * Throws if SQL injection is detected.
 */
export function sanitizeValue(value: string, maxLength = MAX_INPUT_LENGTH): string {
  const truncated = truncate(value, maxLength);
  if (detectSqlInjection(truncated)) {
    throw new SanitizationError('Input contains disallowed SQL patterns.');
  }
  return stripXss(truncated);
}

/**
 * Recursively sanitizes all string values in a plain object or array.
 * Non-string primitives are passed through unchanged.
 */
export function sanitizeObject(input: unknown, maxLength = MAX_INPUT_LENGTH): unknown {
  if (typeof input === 'string') return sanitizeValue(input, maxLength);
  if (Array.isArray(input)) return input.map((v) => sanitizeObject(v, maxLength));
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = sanitizeObject(v, maxLength);
    }
    return out;
  }
  return input;
}

export class SanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SanitizationError';
  }
}
