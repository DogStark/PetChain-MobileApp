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
import { SSL_PINS, PIN_FAILURE_SUPPORT_URL } from '../config/security';
import { setupInterceptors } from '../middleware/apiInterceptors';
import { logError } from '../utils/errorLogger';
import performance, { recordApiTiming, startSpan, finishSpan } from '../utils/performance';

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
 */
export async function pinnedRequest<T>(
  url: string,
  options: RequestInit & { method?: string } = {},
): Promise<T> {
  const hostname = hostnameOf(url);
  const pins = SSL_PINS[hostname];

  if (!pins || pins.length === 0) {
    // No pins configured for this host — use regular fetch
    const res = await fetch(url, options);
    return res.json() as Promise<T>;
  }

  try {
    const res = await pinnedFetch(url, {
      method: (options.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
      headers: (options.headers as Record<string, string>) ?? {},
      body: options.body as string | undefined,
      sslPinning: {
        certs: pins.map((p) => p.replace('sha256/', '')),
      },
      timeoutInterval: config.api.timeoutMs,
    });
    return JSON.parse(res.bodyString ?? '{}') as T;
  } catch (err) {
    const isPinFailure =
      err instanceof Error &&
      (err.message.includes('SSL') ||
        err.message.includes('certificate') ||
        err.message.includes('pinning'));

    if (isPinFailure) {
      logError(err, { service: 'apiClient', action: 'ssl_pin_failure', hostname });
      throw new Error(
        `Security error: the server certificate could not be verified. ` +
          `If this persists, contact support at ${PIN_FAILURE_SUPPORT_URL}`,
      );
    }
    throw err;
  }
}

// --- Circuit Breaker ---
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 30_000;
const circuit = { state: 'CLOSED' as CircuitState, failures: 0, lastFailureTime: 0 };

function isCircuitOpen(): boolean {
  if (circuit.state === 'OPEN') {
    if (Date.now() - circuit.lastFailureTime >= RECOVERY_TIMEOUT_MS) {
      circuit.state = 'HALF_OPEN';

      logError(new Error('Circuit breaker transitioning to HALF_OPEN'), {
        service: 'apiClient',
        action: 'circuit_half_open',
      });

      return false;
    }
    return true;
  }
  return false;
}

function recordSuccess(): void {
  if (circuit.state !== 'CLOSED') {
    logError(new Error('Circuit breaker CLOSED after success'), {
      service: 'apiClient',
      action: 'circuit_closed',
    });
  }
  circuit.failures = 0;
  circuit.state = 'CLOSED';
}

function recordFailure(): void {
  circuit.failures += 1;
  circuit.lastFailureTime = Date.now();

  if (circuit.failures >= FAILURE_THRESHOLD && circuit.state !== 'OPEN') {
    circuit.state = 'OPEN';

    logError(new Error('Circuit breaker OPENED due to multiple failures'), {
      service: 'apiClient',
      action: 'circuit_open',
      failures: circuit.failures,
    });
  }
}

// --- Single-flight token refresh (Issue #547) ---
// If multiple 401 responses arrive concurrently, only one refresh call is made.
// All queued requests resolve / reject together once the refresh settles.

type RefreshSubscriber = (newToken: string) => void;
type RefreshRejecter = (err: unknown) => void;

let refreshInFlight = false;
const refreshSubscribers: RefreshSubscriber[] = [];
const refreshRejecters: RefreshRejecter[] = [];

function subscribeToRefresh(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    refreshSubscribers.push(resolve);
    refreshRejecters.push(reject);
  });
}

function resolveAllSubscribers(token: string): void {
  refreshSubscribers.splice(0).forEach((cb) => cb(token));
  refreshRejecters.splice(0);
}

function rejectAllSubscribers(err: unknown): void {
  refreshRejecters.splice(0).forEach((cb) => cb(err));
  refreshSubscribers.splice(0);
}

async function singleFlightRefresh(): Promise<string> {
  if (refreshInFlight) return subscribeToRefresh();

  refreshInFlight = true;
  try {
    const token = await refreshToken();
    resolveAllSubscribers(token);
    return token;
  } catch (err) {
    rejectAllSubscribers(err);
    await logout();
    throw err;
  } finally {
    refreshInFlight = false;
  }
}

// --- Retry ---
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 300;

function shouldRetry(error: AxiosError, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  if (!error.response) return true; // network error
  return error.response.status >= 500;
}

const delay = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** attempt));

// --- Axios instance ---
const apiClient: AxiosInstance = axios.create({
  baseURL: config.api.baseUrl,
  timeout: config.api.timeoutMs,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-API-Version': config.api.version,
  },
});

apiClient.interceptors.request.use(async (requestConfig) => {
  const token = await getToken();
  if (token) {
    requestConfig.headers = requestConfig.headers ?? ({} as typeof requestConfig.headers);
    (requestConfig.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }

  // Attach HMAC-SHA256 request signature
  try {
    const body =
      requestConfig.data != null
        ? typeof requestConfig.data === 'string'
          ? requestConfig.data
          : JSON.stringify(requestConfig.data)
        : '';
    const sigHeaders = await buildSignatureHeaders(body);
    Object.assign(requestConfig.headers as Record<string, string>, sigHeaders);
  } catch {
    // signing failure must not block the request — log only
  }

  return requestConfig;
});
setupInterceptors(apiClient);

// 401 → single-flight token refresh (Issue #547)
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retried?: boolean };
    if (error.response?.status === 401 && !original._retried) {
      original._retried = true;
      const newToken = await singleFlightRefresh();
      (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
      return apiClient.request(original);
    }
    return Promise.reject(error);
  },
);

// --- Resilient request wrapper ---
export async function resilientRequest<T>(
  requestConfig: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  if (isCircuitOpen()) {
    const error = new Error('Service temporarily unavailable. Please try again later.');

    logError(error, {
      service: 'apiClient',
      action: 'circuit_block_request',
      url: requestConfig.url,
      method: requestConfig.method,
    });

    throw error;
  }

  let lastError: AxiosError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) await delay(attempt - 1);

      const span = startSpan(`http ${requestConfig.method ?? 'request'} ${requestConfig.url}`);
      const started = Date.now();
      const response = await apiClient.request<T>(requestConfig);
      const duration = Date.now() - started;

      // record timings
      try {
        recordApiTiming(requestConfig.url, requestConfig.method, duration, response.status);
      } catch (e) {
        // ignore metric errors
      }

      finishSpan(span);

      recordSuccess();
      return response;
    } catch (err) {
      lastError = err as AxiosError;

      recordFailure();

      if (!shouldRetry(lastError, attempt)) break;
    }
  }

  // --- FINAL ERROR (THIS is where logging matters most) ---
  const message = lastError?.response
    ? `Request failed with status ${lastError.response.status}`
    : (lastError?.message ?? 'Network error');

  const finalError = new Error(message);

  logError(finalError, {
    service: 'apiClient',
    action: 'request_failed',
    url: requestConfig.url,
    method: requestConfig.method,
    attempts: MAX_RETRIES + 1,
    status: lastError?.response?.status,
  });

  throw finalError;
}

export const getCircuitState = () => circuit.state;

/** Exposed for testing only */
export const _resetRefreshState = () => {
  refreshInFlight = false;
  refreshSubscribers.splice(0);
  refreshRejecters.splice(0);
};

/** Exposed for testing only */
export { singleFlightRefresh as singleFlightRefreshForTest };

export default apiClient;
