import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

import { setupInterceptors } from '../middleware/apiInterceptors';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000/api';
const API_TIMEOUT = 30000;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

setupInterceptors(apiClient);

// --- Circuit Breaker ---
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 30_000;
const circuit = { state: 'CLOSED' as CircuitState, failures: 0, lastFailureTime: 0 };

function isCircuitOpen(): boolean {
  if (circuit.state === 'OPEN') {
    if (Date.now() - circuit.lastFailureTime >= RECOVERY_TIMEOUT_MS) {
      circuit.state = 'HALF_OPEN';
      return false;
    }
    return true;
  }
  return false;
}

function recordSuccess(): void {
  circuit.failures = 0;
  circuit.state = 'CLOSED';
}

function recordFailure(): void {
  circuit.failures += 1;
  circuit.lastFailureTime = Date.now();
  if (circuit.failures >= FAILURE_THRESHOLD) circuit.state = 'OPEN';
}

// --- Retry ---
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 300;

function shouldRetry(error: { response?: { status: number } }, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  if (!error.response) return true;
  return error.response.status >= 500;
}

const delay = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** attempt));

export async function resilientRequest<T>(
  requestConfig: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  if (isCircuitOpen()) {
    throw new Error('Service temporarily unavailable. Please try again later.');
  }

  let lastError: { response?: { status: number }; message?: string } | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) await delay(attempt - 1);
      const response = await apiClient.request<T>(requestConfig);
      recordSuccess();
      return response;
    } catch (err: unknown) {
      lastError = err as { response?: { status: number }; message?: string };
      recordFailure();
      if (!shouldRetry(lastError, attempt)) break;
    }
  }

  const message = lastError?.response
    ? `Request failed with status ${lastError.response.status}`
    : (lastError?.message ?? 'Network error');
  throw new Error(message);
}

export const getCircuitState = () => circuit.state;

export default apiClient;
