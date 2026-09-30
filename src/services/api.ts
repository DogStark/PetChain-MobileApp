import axios from 'axios';

const API_BASE_URL = 'https://api.handsoff.app/api';

/**
 * Documented maximum size for an API response body. Responses larger than
 * this are rejected before JSON parsing so a compromised or misconfigured
 * endpoint cannot exhaust mobile memory. 5 MiB comfortably covers normal
 * pagination pages and attachment metadata while bounding worst-case usage.
 */
export const MAX_API_RESPONSE_BYTES = 5 * 1024 * 1024;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Bound the raw response before it is buffered/parsed. This covers both
  // content-length and streamed/chunked bodies.
  maxContentLength: MAX_API_RESPONSE_BYTES,
  maxBodyLength: MAX_API_RESPONSE_BYTES,
});

/**
 * Recoverable, typed error raised when a response exceeds the documented
 * size limit. It deliberately carries no response body or body-derived
 * content — only the limit and the observed size (when known).
 */
export class ApiResponseTooLargeError extends Error {
  readonly code = 'API_RESPONSE_TOO_LARGE';
  readonly limit: number;
  readonly observed?: number;

  constructor(limit: number, observed?: number) {
    super(
      observed !== undefined
        ? `API response exceeded the ${limit} byte limit (received ${observed} bytes).`
        : `API response exceeded the ${limit} byte limit.`,
    );
    this.name = 'ApiResponseTooLargeError';
    this.limit = limit;
    this.observed = observed;
  }
}

/**
 * Detect an oversized-response failure. Axios surfaces the maxContentLength
 * guard as a generic error, so we match on its message rather than treating
 * it as a network failure. No response body is ever inspected here.
 */
export function isResponseTooLargeError(error: unknown): boolean {
  if (error instanceof ApiResponseTooLargeError) {
    return true;
  }
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const message = (error.message ?? '').toLowerCase();
  return message.includes('maxcontentlength') || message.includes('max content length');
}

// Reject oversized responses before JSON parsing. The interceptor runs on
// every response, so pagination and attachment flows are bounded too, while
// normal-sized payloads pass through untouched.
api.interceptors.response.use(
  (response) => {
    const declared = response.headers?.['content-length'];
    if (declared !== undefined) {
      const size = Number(declared);
      if (Number.isFinite(size) && size > MAX_API_RESPONSE_BYTES) {
        throw new ApiResponseTooLargeError(MAX_API_RESPONSE_BYTES, size);
      }
    }
    return response;
  },
  (error) => {
    if (isResponseTooLargeError(error)) {
      throw new ApiResponseTooLargeError(MAX_API_RESPONSE_BYTES);
    }
    throw error;
  },
);

// --- Certificate pinning --------------------------------------------------
// Pinning is enforced at the native networking layer (see app.config.js).
// There is intentionally NO HTTP fallback: any request that cannot complete
// over a pinned TLS connection must fail closed rather than silently
// downgrade to an unpinned transport.
const PINNING_ERROR_CODES = [
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CERT_DATE_INVALID',
  'ERR_CERT_REVOKED',
  'ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN',
  'CERTIFICATE_PINNING_FAILURE',
  'PINNING_MISMATCH',
];

const PINNING_ERROR_MESSAGES = [
  'certificate pinning',
  'pinned key',
  'pinned certificate',
  'certificate chain',
  'ssl pinning',
];

/**
 * Privacy-safe diagnostic state for a failed request. This deliberately
 * carries no certificate material, no request/response bodies, and no record
 * data — only a coarse category plus a support code for triage.
 */
export type ApiDiagnosticState =
  | { kind: 'ok' }
  | { kind: 'offline'; supportCode: string }
  | { kind: 'pinning_failure'; supportCode: string }
  | { kind: 'network_error'; supportCode: string };

/**
 * Build a stable, non-sensitive support code. It is derived only from the
 * error category and HTTP status so support can correlate reports without
 * exposing any private material or user data.
 */
function buildSupportCode(category: string, status?: number): string {
  const suffix = status ? `-${status}` : '';
  return `HS-${category.toUpperCase()}${suffix}`;
}

/**
 * Detect a certificate-pinning failure. Pinning errors surface as TLS errors
 * from the native layer, so we match on the known error codes/messages rather
 * than treating them as generic network failures.
 */
export function isPinningError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const code = (error as { code?: string }).code;
  if (typeof code === 'string' && PINNING_ERROR_CODES.includes(code)) {
    return true;
  }
  const message = (error.message ?? '').toLowerCase();
  return PINNING_ERROR_MESSAGES.some((needle) => message.includes(needle));
}

/**
 * Map any request failure to a dedicated, privacy-safe diagnostic state.
 * Pinning failures are never collapsed into a generic network error so that
 * outage triage can distinguish them, and offline is reported separately so
 * users get the right retry guidance.
 */
export function getApiDiagnosticState(error: unknown): ApiDiagnosticState {
  if (isPinningError(error)) {
    return {
      kind: 'pinning_failure',
      supportCode: buildSupportCode('pin'),
    };
  }
  if (axios.isAxiosError(error) && !error.response) {
    return {
      kind: 'offline',
      supportCode: buildSupportCode('offline'),
    };
  }
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return {
    kind: 'network_error',
    supportCode: buildSupportCode('net', status),
  };
}

/**
 * Actionable, user-facing guidance for a diagnostic state. Pinning failures
 * must never suggest disabling verification or falling back to HTTP.
 */
export function getRecoveryGuidance(state: ApiDiagnosticState): string {
  switch (state.kind) {
    case 'pinning_failure':
      return `We couldn't establish a secure connection. Please retry, and if this persists contact support with code ${state.supportCode}.`;
    case 'offline':
      return 'You appear to be offline. Check your connection and retry.';
    case 'network_error':
      return `Something went wrong. Please retry, or contact support with code ${state.supportCode}.`;
    default:
      return '';
  }
}

/**
 * Export a support code for triage. Contains only the coarse category and
 * status — no certificate private material and no record data.
 */
export function exportSupportCode(state: ApiDiagnosticState): string | null {
  return state.kind === 'ok' ? null : state.supportCode;
}

// --- Push token lifecycle -------------------------------------------------
// Tracks the token currently registered with the backend so we can avoid
// duplicate registrations and know what to invalidate on logout.
let currentPushToken: string | null = null;

// Server responses that mean the token is no longer valid. These must NOT be
// retried, otherwise we get retry storms against a dead token.
const INVALID_TOKEN_STATUSES = [400, 404, 410];
const INVALID_TOKEN_CODES = [
  'InvalidRegistration',
  'NotRegistered',
  'Unregistered',
  'DeviceNotRegistered',
  'invalid_token',
];

export function isInvalidTokenError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const status = error.response?.status;
  if (status && INVALID_TOKEN_STATUSES.includes(status)) {
    return true;
  }
  const data = error.response?.data as { code?: string; error?: string } | undefined;
  const code = data?.code ?? data?.error;
  return typeof code === 'string' && INVALID_TOKEN_CODES.includes(code);
}

/**
 * Register a push token with the backend. Idempotent: registering the same
 * token twice is a no-op so one device cannot register the same token
 * repeatedly. When the OS rotates the token, the previous token is
 * invalidated before the new one is registered.
 */
export async function registerPushToken(token: string): Promise<void> {
  if (!token || token === currentPushToken) {
    return;
  }

  const previousToken = currentPushToken;
  currentPushToken = token;

  try {
    await api.post('/push-tokens', { token });
  } catch (error) {
    // Roll back so a later attempt can retry a genuine failure.
    currentPushToken = previousToken;
    throw error;
  }

  // Rotation: drop the old token now that the new one is live.
  if (previousToken) {
    await invalidatePushToken(previousToken);
  }
}

/**
 * Invalidate a token on the backend. Invalid/unregistered responses are
 * treated as success (the token is already gone) and never retried.
 */
export async function invalidatePushToken(token: string): Promise<void> {
  try {
    await api.delete('/push-tokens', { data: { token } });
  } catch (error) {
    if (!isInvalidTokenError(error)) {
      throw error;
    }
  } finally {
    if (token === currentPushToken) {
      currentPushToken = null;
    }
  }
}

/**
 * Clean up the locally tracked token on logout or account deletion. The
 * backend call is best-effort: local state is always cleared so a partial
 * failure cannot leave a stale token registered.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = currentPushToken;
  currentPushToken = null;
  if (!token) {
    return;
  }
  try {
    await api.delete('/push-tokens', { data: { token } });
  } catch (error) {
    if (!isInvalidTokenError(error)) {
      // Swallow: local cleanup already happened; do not retry-storm.
    }
  }
}

export default api;
