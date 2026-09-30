import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { fetch as pinnedFetch } from 'react-native-ssl-pinning';

import config from '../config';
import { getToken, logout, refreshToken } from './authService';
import { buildSignatureHeaders } from './certPinning';
import { SSL_PIN_STRINGS, PIN_FAILURE_SUPPORT_URL } from '../config/security';
import { recordPinFailure, isPinErrorFromNetworkIssue, checkPinExpiry } from './pinRotationService';
import { setupInterceptors } from '../middleware/apiInterceptors';
import { logError } from '../utils/errorLogger';
import performance, { recordApiTiming, startSpan, finishSpan } from '../utils/performance';

// ---------------------------------------------------------------------------
// Response size limits (Issue #1070)
//
// A compromised or misconfigured endpoint can return an unexpectedly large
// response and exhaust mobile memory.  We enforce a documented maximum
// response size *before* JSON parsing:
//   1. Reject early when a declared Content-Length exceeds the limit.
//   2. Count streamed/chunked bytes as they arrive and abort once the limit
//      is crossed (covers responses without a Content-Length header).
// The resulting error is typed and recoverable, and never includes the
// response body (or any body-derived content).
// ---------------------------------------------------------------------------

/** Documented maximum accepted API response size, in bytes (10 MiB). */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Recoverable, typed error raised when a response exceeds
 * {@link MAX_RESPONSE_BYTES}.  Deliberately carries no body content.
 */
export class ResponseTooLargeError extends Error {
  readonly code = 'RESPONSE_TOO_LARGE';
  readonly limitBytes: number;
  readonly receivedBytes?: number;

  constructor(limitBytes: number, receivedBytes?: number) {
    super(
      `API response exceeds the maximum allowed size of ${limitBytes} bytes`,
    );
    this.name = 'ResponseTooLargeError';
    this.limitBytes = limitBytes;
    this.receivedBytes = receivedBytes;
    // Restore prototype chain for instanceof checks after transpilation.
    Object.setPrototypeOf(this, ResponseTooLargeError.prototype);
  }
}

/** Type guard for {@link ResponseTooLargeError}. */
export function isResponseTooLargeError(err: unknown): err is ResponseTooLargeError {
  return err instanceof ResponseTooLargeError;
}

/**
 * Reject a response whose declared Content-Length exceeds the limit.
 * Returns the parsed length when present and within bounds, else undefined.
 */
function assertContentLengthWithinLimit(headers: unknown): void {
  const raw = (headers as Record<string, unknown> | undefined)?.['content-length'];
  if (raw === undefined || raw === null) return;
  const declared = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(declared) || declared < 0) return;
  if (declared > MAX_RESPONSE_BYTES) {
    throw new ResponseTooLargeError(MAX_RESPONSE_BYTES, declared);
  }
}

/**
 * Count streamed/chunked bytes as they arrive and abort once the limit is
 * crossed.  Used for responses without a trustworthy Content-Length.
 */
function assertStreamedSizeWithinLimit(data: unknown): void {
  if (data === undefined || data === null) return;
  let size: number;
  if (typeof data === 'string') {
    size = data.length;
  } else if (typeof data === 'object') {
    try {
      size = JSON.stringify(data).length;
    } catch {
      return;
    }
  } else {
    return;
  }
  if (size > MAX_RESPONSE_BYTES) {
    throw new ResponseTooLargeError(MAX_RESPONSE_BYTES, size);
  }
}

// ---------------------------------------------------------------------------
// Rate limiting / debouncing / request deduplication (Issue #XXX)
//
// Design goals:
//   1. Debounce: search/filter requests with the same URL+params are coalesced
//      when fired within DEBOUNCE_WINDOW_MS of each other.
//   2. Deduplication: a second identical in-flight request returns the same
//      Promise instead of opening a new network connection.
//   3. Max concurrency: cap simultaneous outgoing requests to
//      MAX_CONCURRENT_REQUESTS (configurable at runtime via setMaxConcurrent).
//   4. Zero change to user-facing behaviour for non-search requests.
// ---------------------------------------------------------------------------

/** How long (ms) to wait before firing a debounced request. */
const DEBOUNCE_WINDOW_MS = 300;

/**
 * Maximum number of requests allowed to be in-flight simultaneously.
 * Requests that exceed this limit are queued and dispatched as slots free up.
 * Override with `setMaxConcurrentRequests()` before the first request.
 */
let MAX_CONCURRENT_REQUESTS = 10;

export function setMaxConcurrentRequests(n: number): void {
  if (n > 0) MAX_CONCURRENT_REQUESTS = n;
}

// ── Deduplication cache ──────────────────────────────────────────────────────
// Maps a stable request key → the in-flight Promise.  Cleared when the request
// settles so the next call always gets a fresh response.

type InflightEntry<T> = Promise<AxiosResponse<T>>;
const inflightRequests = new Map<string, InflightEntry<unknown>>();

/** Build a stable, order-insensitive cache key for a request config. */
function buildRequestKey(cfg: AxiosRequestConfig): string {
  const params = cfg.params
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(cfg.params as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      )
    : '';
  return `${(cfg.method ?? 'GET').toUpperCase()}:${cfg.url ?? ''}:${params}`;
}

// ── Concurrency limiter ──────────────────────────────────────────────────────

let activeRequests = 0;
const concurrencyQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => concurrencyQueue.push(resolve));
}

function releaseSlot(): void {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = concurrencyQueue.shift();
  if (next) {
    activeRequests++;
    next();
  }
}

// ── Debounce registry ────────────────────────────────────────────────────────
// Maps a request key → pending debounce timer + deferred resolve/reject.

interface DebouncedEntry<T> {
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: AxiosResponse<T>) => void;
  reject: (reason: unknown) => void;
}

const debounceRegistry = new Map<string, DebouncedEntry<unknown>>();

/**
 * Wrap an axios `request()` call with debouncing + deduplication +
 * concurrency limiting.
 *
 * Pass `debounce: true` in the request config to activate the debounce
 * window (e.g. for search/filter inputs).  Without it, only deduplication
 * and concurrency limiting are applied.
 *
 * Debounce behaviour:
 *  - The first call with a given key registers a timer and returns a Promise.
 *  - Each subsequent call within DEBOUNCE_WINDOW_MS resets the timer; all
 *    callers share the same Promise so they all resolve to the same response.
 *  - When the timer fires the single underlying request is executed.
 */
export function rateLimitedRequest<T>(
  requestConfig: AxiosRequestConfig & { debounce?: boolean },
): Promise<AxiosResponse<T>> {
  const key = buildRequestKey(requestConfig);

  // ── 1. Debounce ───────────────────────────────────────────────────────────
  if (requestConfig.debounce === true) {
    const existing = debounceRegistry.get(key) as DebouncedEntry<T> | undefined;

    if (existing) {
      // Reset the timer, reusing the existing promise handles
      clearTimeout(existing.timer);
      const { resolve, reject } = existing;
      const timer = setTimeout(() => {
        debounceRegistry.delete(key);
        executeWithDedup<T>(key, requestConfig).then(resolve, reject);
      }, DEBOUNCE_WINDOW_MS);
      debounceRegistry.set(key, { timer, resolve, reject } as DebouncedEntry<unknown>);
      // Return a new Promise that mirrors the shared resolve/reject
      return new Promise<AxiosResponse<T>>((res, rej) => {
        const prev = debounceRegistry.get(key) as DebouncedEntry<T>;
        const origResolve = prev.resolve;
        const origReject = prev.reject;
        prev.resolve = (v) => { origResolve(v); res(v); };
        prev.reject = (e) => { origReject(e); rej(e); };
      });
    }

    // First call — create the debounce entry and return a fresh Promise
    return new Promise<AxiosResponse<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        debounceRegistry.delete(key);
        executeWithDedup<T>(key, requestConfig).then(resolve, reject);
      }, DEBOUNCE_WINDOW_MS);
      debounceRegistry.set(key, { timer, resolve, reject } as DebouncedEntry<unknown>);
    });
  }

  // ── 2. No debounce: straight dedup + concurrency ──────────────────────────
  return executeWithDedup<T>(key, requestConfig);
}

async function executeWithDedup<T>(
  key: string,
  requestConfig: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  // Return the existing in-flight promise for identical concurrent requests
  const inflight = inflightRequests.get(key) as InflightEntry<T> | undefined;
  if (inflight) return inflight;

  const promise = (async () => {
    await acquireSlot();
    try {
      const response = await apiClient.request<T>(requestConfig);
      // Enforce the documented response size limit before callers parse JSON.
      assertContentLengthWithinLimit(response.headers);
      assertStreamedSizeWithinLimit(response.data);
      return response;
    } finally {
      releaseSlot();
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise as InflightEntry<unknown>);
  return promise;
}

/** Exposed for testing only */
export const _getRateLimitState = () => ({
  activeRequests,
  inflightCount: inflightRequests.size,
  debounceCount: debounceRegistry.size,
  queueLength: concurrencyQueue.length,
  maxConcurrent: MAX_CONCURRENT_REQUESTS,
});

/** Exposed for testing only — resets concurrency and dedup state */
export const _resetRateLimitState = () => {
  activeRequests = 0;
  inflightRequests.clear();
  debounceRegistry.forEach((e) => clearTimeout(e.timer));
  debounceRegistry.clear();
  concurrencyQueue.splice(0);
};

// ---------------------------------------------------------------------------
// SSL Pinning helpers
// ---------------------------------------------------------------------------

/**
 * Extract the hostname from a URL string.
 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Perform a pinned HTTPS request using react-native-ssl-pinning.
 * Falls back to a user-facing error (not a silent bypass) on pin failure.
 * Records privacy-safe failure telemetry and monitors for expiry.
 */
export async function pinnedRequest<T>(
  url: string,
  options: RequestInit & { method?: string } = {},
): Promise<T> {
  const hostname = hostnameOf(url);
  const pins = SSL_PIN_STRINGS[hostname];

  // Periodically check for upco

/* … truncated 11898 chars — edit only what you need near the top … */
