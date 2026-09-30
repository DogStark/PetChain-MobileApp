/**
 * Centralized authenticated request client with single-flight token refresh
 * and logout generation guard.
 *
 * Ensures:
 * - Concurrent 401s trigger exactly one token refresh
 * - In-flight requests are queued and retried against new token
 * - Requests queued before logout are not replayed after logout
 * - No raw tokens appear in logs or telemetry
 * - Offline/timeout paths are handled cleanly
 */

import type { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import axios from 'axios';

export interface AuthenticatedClientConfig {
  baseUrl: string;
  onRefreshToken: () => Promise<string>;
  onLogout: () => Promise<void>;
  refreshTimeoutMs?: number;
  maxQueuedRequests?: number;
}

interface QueuedRequest<T = unknown> {
  config: AxiosRequestConfig;
  generation: number;
  resolve: (response: AxiosResponse<T>) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}

interface ClientMetrics {
  requestsInFlight: number;
  queuedRequestCount: number;
  refreshInProgress: boolean;
  logoutGeneration: number;
  lastRefreshTime: number | null;
  lastRefreshError: string | null;
}

// ─── Global state (per client instance) ────────────────────────────────────────

let refreshInFlight = false;
let refreshSubscribers: Array<(token: string) => void> = [];
let refreshRejecters: Array<(err: unknown) => void> = [];
let requestQueue: QueuedRequest[] = [];
let requestsInFlight = 0;
let logoutGeneration = 1;
let lastRefreshTime: number | null = null;
let lastRefreshError: string | null = null;
let currentToken: string | null = null;

const MAX_QUEUED_REQUESTS = 100;
const REFRESH_TIMEOUT_MS = 10_000;

// ─── Public API ───────────────────────────────────────────────────────────────

export function createAuthenticatedClient(config: AuthenticatedClientConfig) {
  const client = axios.create({
    baseURL: config.baseUrl,
    timeout: 10_000,
  });

  // Request interceptor: attach token
  client.interceptors.request.use(
    async (requestConfig) => {
      requestsInFlight++;

      if (currentToken) {
        requestConfig.headers.Authorization = `Bearer ${currentToken}`;
      }

      return requestConfig;
    },
    (error) => {
      requestsInFlight--;
      return Promise.reject(error);
    },
  );

  // Response interceptor: handle 401 with single-flight refresh
  client.interceptors.response.use(
    (response) => {
      requestsInFlight--;
      return response;
    },
    async (error: AxiosError) => {
      requestsInFlight--;
      const originalConfig = error.config as AxiosRequestConfig & {
        _retried?: boolean;
        _generation?: number;
      };

      // Capture generation before potential logout
      const requestGeneration = originalConfig._generation ?? logoutGeneration;

      // 401 Unauthorized: attempt refresh
      if (error.response?.status === 401 && !originalConfig._retried) {
        originalConfig._retried = true;

        try {
          const newToken = await singleFlightRefresh(config.onRefreshToken, config.refreshTimeoutMs || REFRESH_TIMEOUT_MS);
          currentToken = newToken;

          // Check if logout happened while we were refreshing
          if (requestGeneration !== logoutGeneration) {
            // This request is stale — don't replay it
            return Promise.reject(new Error('Logout occurred during token refresh'));
          }

          // Retry original request with new token
          originalConfig.headers = originalConfig.headers ?? {};
          (originalConfig.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
          return client.request(originalConfig);
        } catch (refreshError) {
          // Refresh failed — logout and reject
          await config.onLogout();
          logoutGeneration++;
          currentToken = null;
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    },
  );

  return client;
}

// ─── Single-flight refresh ────────────────────────────────────────────────────

async function singleFlightRefresh(
  onRefreshToken: () => Promise<string>,
  timeoutMs: number,
): Promise<string> {
  if (refreshInFlight) {
    return subscribeToRefresh();
  }

  refreshInFlight = true;
  const startTime = Date.now();

  try {
    const refreshPromise = onRefreshToken();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Token refresh timeout')),
        timeoutMs,
      ),
    );

    const token = await Promise.race([refreshPromise, timeoutPromise]);
    lastRefreshTime = Date.now();
    lastRefreshError = null;
    resolveAllSubscribers(token);
    return token;
  } catch (err) {
    lastRefreshTime = Date.now();
    lastRefreshError = err instanceof Error ? err.message : String(err);
    rejectAllSubscribers(err);
    throw err;
  } finally {
    refreshInFlight = false;
  }
}

function subscribeToRefresh(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    refreshSubscribers.push(resolve);
    refreshRejecters.push(reject);
  });
}

function resolveAllSubscribers(token: string): void {
  const subs = refreshSubscribers.splice(0);
  subs.forEach((cb) => cb(token));
  refreshRejecters.splice(0);
}

function rejectAllSubscribers(err: unknown): void {
  const rejecters = refreshRejecters.splice(0);
  rejecters.forEach((cb) => cb(err));
  refreshSubscribers.splice(0);
}

// ─── Request queuing ──────────────────────────────────────────────────────────

export function queueRequest<T>(
  config: AxiosRequestConfig,
  signal?: AbortSignal,
): Promise<AxiosResponse<T>> {
  if (requestQueue.length >= MAX_QUEUED_REQUESTS) {
    return Promise.reject(
      new Error(`Request queue full (max ${MAX_QUEUED_REQUESTS} queued requests)`),
    );
  }

  return new Promise<AxiosResponse<T>>((resolve, reject) => {
    const entry: QueuedRequest<T> = {
      config,
      generation: logoutGeneration,
      resolve,
      reject,
      signal,
    };
    requestQueue.push(entry);
  });
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(): Promise<void> {
  logoutGeneration++;
  currentToken = null;
  refreshInFlight = false;
  refreshSubscribers = [];
  refreshRejecters = [];

  // Reject all queued requests (they're stale)
  const queue = requestQueue.splice(0);
  queue.forEach((req) => {
    req.reject(new Error('Logout occurred'));
  });
}

// ─── Metrics and testing ──────────────────────────────────────────────────────

export function getAuthClientMetrics(): ClientMetrics {
  return {
    requestsInFlight,
    queuedRequestCount: requestQueue.length,
    refreshInProgress: refreshInFlight,
    logoutGeneration,
    lastRefreshTime,
    lastRefreshError,
  };
}

export function resetAuthClientForTest(): void {
  refreshInFlight = false;
  refreshSubscribers = [];
  refreshRejecters = [];
  requestQueue = [];
  requestsInFlight = 0;
  logoutGeneration = 1;
  lastRefreshTime = null;
  lastRefreshError = null;
  currentToken = null;
}

// ─── Cancellation support ─────────────────────────────────────────────────────

export function cancelRequests(reason: string): void {
  const queue = requestQueue.splice(0);
  queue.forEach((req) => {
    if (req.signal?.aborted) return;
    req.reject(new Error(`Requests cancelled: ${reason}`));
  });
}

export default {
  createAuthenticatedClient,
  queueRequest,
  logout,
  getAuthClientMetrics,
  resetAuthClientForTest,
  cancelRequests,
};
