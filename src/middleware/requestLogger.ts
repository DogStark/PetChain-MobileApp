/**
 * requestLogger
 *
 * Axios interceptor that logs outgoing HTTP requests and incoming responses
 * for debugging purposes, while protecting sensitive data.
 *
 * - Enabled only in development and staging builds (config.isDev || config.isStaging)
 * - Logs route template (e.g. `/pets/:petId/records`), HTTP status, and duration only
 * - Redacts all query parameter values, header values, and body field values
 * - Never logs request/response bodies, full URLs, or resolved identifiers
 * - Uses a structured log format compatible with loggerService
 */

import {
  type AxiosInstance,
  type AxiosError,
  type InternalAxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

import config from '../config';

// ─── Constants ────────────────────────────────────────────────────────────────

const MASKED = '[REDACTED]';

/** Headers whose values must never appear in logs. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-refresh-token',
  'x-access-token',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a resolved URL path to a route template by replacing UUID-like and
 * numeric segments with parameter names.
 *
 * Examples:
 *   /pets/12345/records/rec-uuid-123 → /pets/:petId/records/:recordId
 *   /users/user-abc-123/profile → /users/:userId/profile
 */
function extractRouteTemplate(url: string): string {
  if (!url) return url;

  // Remove baseURL prefix if present (everything before /api)
  const apiIndex = url.indexOf('/api');
  const pathOnly = apiIndex >= 0 ? url.substring(apiIndex + 4) : url;

  // Split path into segments
  const segments = pathOnly.split('/').filter((s) => s.length > 0);

  // Convert each segment to either the segment name or a parameter placeholder
  const templateSegments = segments.map((segment) => {
    // Check if segment looks like an ID (UUID, numeric, or encoded entity ID)
    // Pattern: all digits, or contains dashes (UUID), or looks like hex
    if (/^\d+$/.test(segment) || /-[a-f0-9]{3,}/.test(segment) || /^[a-f0-9]{8,}$/.test(segment)) {
      // Return a generic :id or context-aware parameter name
      // For now, use generic :id to avoid exposing what type of resource
      return ':id';
    }
    return segment;
  });

  return '/' + templateSegments.join('/');
}

/**
 * Returns an object with query parameter keys only (values redacted).
 */
function redactQueryParams(params: Record<string, unknown> | undefined): Record<string, string> {
  if (!params) return {};
  return Object.fromEntries(
    Object.entries(params).map(([key]) => [key, MASKED]),
  );
}

/**
 * Returns an object with body field keys only (values redacted).
 * Only operates on plain objects; passes everything else through unchanged.
 */
function redactBodyShape(body: unknown): unknown {
  if (body === null || body === undefined) return body;

  // Attempt to parse JSON strings before redacting
  if (typeof body === 'string') {
    try {
      const parsed: unknown = JSON.parse(body);
      return redactBodyShape(parsed);
    } catch {
      return undefined;
    }
  }

  if (typeof body !== 'object' || Array.isArray(body)) return undefined;

  // Return only keys with [REDACTED] values
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([key]) => [key, MASKED]),
  );
}

/**
 * Formats a structured log line and writes it to the console.
 * All log output is prefixed with `[HTTP]` for easy filtering.
 */
function log(level: 'info' | 'warn' | 'error', entry: Record<string, unknown>): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  if (level === 'error') {
    console.error(`[HTTP] ${line}`);
  } else if (level === 'warn') {
    console.warn(`[HTTP] ${line}`);
  } else {
    console.log(`[HTTP] ${line}`);
  }
}

// ─── Timing metadata augmentation ────────────────────────────────────────────

type TimedConfig = InternalAxiosRequestConfig & {
  _loggerStartedAt?: number;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attaches request-logging interceptors to the supplied Axios instance.
 *
 * Must be called **after** authentication interceptors so that the
 * Authorization header is already set when we read it for masking.
 *
 * Logs only route template, HTTP status, and duration to avoid exposing
 * sensitive identifiers, search terms, or request content.
 *
 * @param apiInstance - The Axios instance to instrument.
 */
export function setupRequestLogger(apiInstance: AxiosInstance): void {
  // Only activate in dev / staging
  if (!config.isDev && !config.isStaging) return;

  // ── Request interceptor ──────────────────────────────────────────────────

  apiInstance.interceptors.request.use(
    (requestConfig: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      (requestConfig as TimedConfig)._loggerStartedAt = Date.now();

      const fullUrl = (requestConfig.baseURL ?? '') + (requestConfig.url ?? '');
      const routeTemplate = extractRouteTemplate(fullUrl);

      log('info', {
        direction: 'request',
        method: requestConfig.method?.toUpperCase() ?? 'UNKNOWN',
        route: routeTemplate,
        params: requestConfig.params ? redactQueryParams(requestConfig.params as Record<string, unknown>) : undefined,
        hasBody: requestConfig.data != null,
      });

      return requestConfig;
    },
    (error: AxiosError): Promise<AxiosError> => {
      log('error', {
        direction: 'request_error',
        message: error.message,
      });
      return Promise.reject(error);
    },
  );

  // ── Response interceptor ─────────────────────────────────────────────────

  apiInstance.interceptors.response.use(
    (response: AxiosResponse): AxiosResponse => {
      const started = (response.config as TimedConfig)._loggerStartedAt;
      const durationMs = started != null ? Date.now() - started : undefined;

      const level = response.status >= 400 ? 'warn' : 'info';

      const fullUrl = (response.config.baseURL ?? '') + (response.config.url ?? '');
      const routeTemplate = extractRouteTemplate(fullUrl);

      log(level, {
        direction: 'response',
        method: response.config.method?.toUpperCase() ?? 'UNKNOWN',
        route: routeTemplate,
        status: response.status,
        statusText: response.statusText,
        durationMs,
      });

      return response;
    },
    (error: AxiosError): Promise<AxiosError> => {
      const started = (error.config as TimedConfig | undefined)?._loggerStartedAt;
      const durationMs = started != null ? Date.now() - started : undefined;

      const fullUrl = ((error.config?.baseURL ?? '') + (error.config?.url ?? '')).trim();
      const routeTemplate = fullUrl ? extractRouteTemplate(fullUrl) : 'unknown';

      log('error', {
        direction: 'response_error',
        method: error.config?.method?.toUpperCase() ?? 'UNKNOWN',
        route: routeTemplate,
        status: error.response?.status ?? null,
        statusText: error.response?.statusText ?? null,
        durationMs,
        message: error.message,
      });

      return Promise.reject(error);
    },
  );
}
