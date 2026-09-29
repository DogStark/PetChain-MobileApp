import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
