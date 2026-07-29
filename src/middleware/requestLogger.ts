/**
 * requestLogger
 *
 * Axios interceptor that logs outgoing HTTP requests and incoming responses
 * for debugging purposes.
 *
 * - Enabled only in development and staging builds (config.isDev || config.isStaging)
 * - Logs request method, URL, and sanitised payload
 * - Logs response status code and round-trip duration
 * - Masks sensitive headers (Authorization, Cookie, X-Api-Key, X-Auth-Token)
 *   and common token fields in request/response bodies
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

/** Top-level body keys whose values must never appear in logs. */
const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'pin',
  'otp',
  'privateKey',
  'mnemonic',
  'ssn',
  'cardNumber',
  'cvv',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a copy of `headers` with sensitive values replaced by [REDACTED].
 */
function sanitiseHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADERS.has(key.toLowerCase()) ? MASKED : value,
    ]),
  );
}

/**
 * Returns a sanitised version of the request/response body.
 * Only operates on plain objects; passes everything else through unchanged.
 */
function sanitiseBody(body: unknown): unknown {
  if (body === null || body === undefined) return body;

  // Attempt to parse JSON strings before sanitising
  if (typeof body === 'string') {
    try {
      const parsed: unknown = JSON.parse(body);
      return sanitiseBody(parsed);
    } catch {
      return body;
    }
  }

  if (typeof body !== 'object' || Array.isArray(body)) return body;

  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([key, value]) => [
      key,
      SENSITIVE_BODY_KEYS.has(key) ? MASKED : value,
    ]),
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
 * @param apiInstance - The Axios instance to instrument.
 */
export function setupRequestLogger(apiInstance: AxiosInstance): void {
  // Only activate in dev / staging
  if (!config.isDev && !config.isStaging) return;

  // ── Request interceptor ──────────────────────────────────────────────────

  apiInstance.interceptors.request.use(
    (requestConfig: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      (requestConfig as TimedConfig)._loggerStartedAt = Date.now();

      log('info', {
        direction: 'request',
        method: requestConfig.method?.toUpperCase() ?? 'UNKNOWN',
        url: requestConfig.url ?? '',
        baseURL: requestConfig.baseURL ?? '',
        params: requestConfig.params as unknown,
        headers: sanitiseHeaders(requestConfig.headers as Record<string, unknown>),
        body: sanitiseBody(requestConfig.data),
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

      log(level, {
        direction: 'response',
        method: response.config.method?.toUpperCase() ?? 'UNKNOWN',
        url: response.config.url ?? '',
        status: response.status,
        statusText: response.statusText,
        durationMs,
        headers: sanitiseHeaders(response.headers as Record<string, unknown>),
        body: sanitiseBody(response.data),
      });

      return response;
    },
    (error: AxiosError): Promise<AxiosError> => {
      const started = (error.config as TimedConfig | undefined)?._loggerStartedAt;
      const durationMs = started != null ? Date.now() - started : undefined;

      log('error', {
        direction: 'response_error',
        method: error.config?.method?.toUpperCase() ?? 'UNKNOWN',
        url: error.config?.url ?? '',
        status: error.response?.status ?? null,
        statusText: error.response?.statusText ?? null,
        durationMs,
        message: error.message,
      });

      return Promise.reject(error);
    },
  );
}
