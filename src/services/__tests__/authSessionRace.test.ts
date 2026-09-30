/**
 * Logout / refresh race regression tests  (Issue #904)
 *
 * The bug: `refreshToken()` awaited a network round-trip and then wrote the
 * response with `storeSecureTokens()`. If `logout()` ran during that window,
 * the write landed *after* `clearSecureTokens()` and silently restored the
 * session the user had just ended.
 *
 * These tests drive the race deterministically by holding the refresh response
 * open with a deferred promise, performing the competing action, and only then
 * resolving it — no timers, no flakiness.
 */

// ─── Mocks (declared before imports; factory vars must be `mock`-prefixed) ────

jest.mock('../../config', () => ({
  __esModule: true,
  default: { api: { baseUrl: 'https://api.petchain.test/api', timeoutMs: 5000 } },
}));

const mockAxiosPost = jest.fn();

jest.mock('axios', () => {
  // Everything is built inside the factory. `authService` calls
  // `axios.create()` at module load — before this file's module-level `const`s
  // are assigned — so an instance captured from outer scope would still be
  // `undefined` when the real client is constructed. The `post` arrow resolves
  // `mockAxiosPost` lazily, at call time, when it does exist.
  const isAxiosError = (err: unknown) =>
    typeof err === 'object' && err !== null && 'isAxiosError' in (err as object);
  const instance = {
    post: (...args: unknown[]) => mockAxiosPost(...args),
    get: jest.fn(),
    delete: jest.fn(),
  };
  return {
    __esModule: true,
    default: { create: () => instance, isAxiosError },
    create: () => instance,
    isAxiosError,
  };
});

/** Stand-in for the device keychain. */
const mockKeychainState: { token: string | null; refreshToken: string | null } = {
  token: null,
  refreshToken: null,
};
const mockStoreSecureTokens = jest.fn(async (payload: { token: string; refreshToken?: string }) => {
  mockKeychainState.token = payload.token;
  mockKeychainState.refreshToken = payload.refreshToken ?? null;
});
const mockClearSecureTokens = jest.fn(async () => {
  mockKeychainState.token = null;
  mockKeychainState.refreshToken = null;
});

jest.mock('../../utils/encryption/keychain', () => ({
  storeSecureTokens: (...args: unknown[]) => mockStoreSecureTokens(...(args as [never])),
  clearSecureTokens: (...args: unknown[]) => mockClearSecureTokens(...(args as [])),
  getSecureToken: jest.fn(async () => mockKeychainState.token),
  getSecureRefreshToken: jest.fn(async () => mockKeychainState.refreshToken),
  getSecureTokens: jest.fn(async () =>
    mockKeychainState.token
      ? { token: mockKeychainState.token, refreshToken: mockKeychainState.refreshToken }
      : null,
  ),
  getBiometricAvailability: jest.fn(async () => ({ isAvailable: false })),
  isBiometricAuthenticationEnabled: jest.fn(async () => false),
  enableBiometricAuthentication: jest.fn(async () => undefined),
  disableBiometricAuthentication: jest.fn(async () => undefined),
  authenticateWithBiometricGate: jest.fn(async () => false),
}));

jest.mock('../../utils/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../utils/sanitize', () => ({ sanitizeString: (v: unknown) => String(v ?? '') }));
jest.mock('../../utils/encryption', () => ({ hashPassword: (v: string) => `hashed:${v}` }));
jest.mock('../sessionMonitoringService', () => ({
  __esModule: true,
  default: {
    isBiometricCheckExpired: jest.fn(async () => false),
    setLastBiometricCheck: jest.fn(async () => undefined),
  },
}));

import { getAuthGeneration, login, logout, refreshToken } from '../authService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A promise whose resolution this test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Yield until the refresh has actually issued its POST.
 *
 * `refreshToken()` awaits the keychain before touching the network, so a test
 * that queues a second axios response too early would have it consumed by the
 * refresh instead of the call it was meant for.
 */
async function waitForPendingRequest(callCount: number) {
  for (let i = 0; i < 20 && mockAxiosPost.mock.calls.length < callCount; i += 1) {
    await Promise.resolve();
  }
}

function seedLoggedInSession() {
  mockKeychainState.token = 'old-access-token';
  mockKeychainState.refreshToken = 'old-refresh-token';
}

beforeEach(() => {
  jest.clearAllMocks();
  mockKeychainState.token = null;
  mockKeychainState.refreshToken = null;
});

// ─── The race ────────────────────────────────────────────────────────────────

describe('refresh landing after logout (Issue #904)', () => {
  it('discards an in-flight refresh that resolves after logout', async () => {
    seedLoggedInSession();
    const response = deferred<{ data: { token: string; refreshToken: string } }>();
    mockAxiosPost.mockReturnValueOnce(response.promise);

    // 1. Refresh starts and blocks on the network.
    const pending = refreshToken();
    const swallowed = pending.catch((err) => err);

    // 2. The user logs out while it is still in flight.
    await logout();
    expect(mockKeychainState.token).toBeNull();

    // 3. The refresh response finally arrives.
    response.resolve({ data: { token: 'resurrected-token', refreshToken: 'resurrected-refresh' } });
    const err = await swallowed;

    // It must be rejected, and — the actual bug — must not have written.
    expect(err).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(mockStoreSecureTokens).not.toHaveBeenCalled();
    expect(mockKeychainState.token).toBeNull();
    expect(mockKeychainState.refreshToken).toBeNull();
  });

  it('does not let a failed stale refresh clear the tokens of a newer session', async () => {
    seedLoggedInSession();
    const response = deferred<never>();
    mockAxiosPost.mockReturnValueOnce(response.promise);

    const pending = refreshToken();
    const swallowed = pending.catch((err) => err);
    await waitForPendingRequest(1);

    // Logout, then sign in again as someone else.
    await logout();
    mockAxiosPost.mockResolvedValueOnce({
      data: { token: 'new-user-token', refreshToken: 'new-user-refresh', user: { id: 'u2' } },
    });
    await login('second@example.com', 'pw');
    expect(mockKeychainState.token).toBe('new-user-token');

    // Now the original refresh fails.
    response.reject(new Error('network down'));
    await swallowed;

    // The new session must be untouched.
    expect(mockKeychainState.token).toBe('new-user-token');
    expect(mockKeychainState.refreshToken).toBe('new-user-refresh');
  });

  it('discards an in-flight refresh when a different account signs in', async () => {
    seedLoggedInSession();
    const response = deferred<{ data: { token: string; refreshToken: string } }>();
    mockAxiosPost.mockReturnValueOnce(response.promise);

    const swallowed = refreshToken().catch((err) => err);
    await waitForPendingRequest(1);

    mockAxiosPost.mockResolvedValueOnce({
      data: { token: 'account-b-token', refreshToken: 'account-b-refresh', user: { id: 'b' } },
    });
    await login('b@example.com', 'pw');

    response.resolve({ data: { token: 'account-a-token', refreshToken: 'account-a-refresh' } });
    await swallowed;

    // Account A's refresh must not overwrite account B's credentials.
    expect(mockKeychainState.token).toBe('account-b-token');
  });
});

// ─── Concurrency ─────────────────────────────────────────────────────────────

describe('concurrent refresh requests (Issue #904)', () => {
  it('coalesces simultaneous refreshes into a single network call', async () => {
    seedLoggedInSession();
    const response = deferred<{ data: { token: string; refreshToken: string } }>();
    mockAxiosPost.mockReturnValueOnce(response.promise);

    const first = refreshToken();
    const second = refreshToken();
    const third = refreshToken();

    response.resolve({ data: { token: 'fresh-token', refreshToken: 'fresh-refresh' } });
    const results = await Promise.all([first, second, third]);

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['fresh-token', 'fresh-token', 'fresh-token']);
    // One shared refresh means one write, not three.
    expect(mockStoreSecureTokens).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh refresh after the previous one settles', async () => {
    seedLoggedInSession();
    mockAxiosPost.mockResolvedValueOnce({ data: { token: 't1', refreshToken: 'r1' } });
    await expect(refreshToken()).resolves.toBe('t1');

    mockAxiosPost.mockResolvedValueOnce({ data: { token: 't2', refreshToken: 'r2' } });
    await expect(refreshToken()).resolves.toBe('t2');

    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
  });
});

// ─── Generation bookkeeping ──────────────────────────────────────────────────

describe('session generation', () => {
  it('advances on logout and on sign-in', async () => {
    const start = getAuthGeneration();

    await logout();
    expect(getAuthGeneration()).toBeGreaterThan(start);

    const afterLogout = getAuthGeneration();
    mockAxiosPost.mockResolvedValueOnce({
      data: { token: 't', refreshToken: 'r', user: { id: 'u' } },
    });
    await login('a@example.com', 'pw');
    expect(getAuthGeneration()).toBeGreaterThan(afterLogout);
  });

  it('still clears tokens on an ordinary failed refresh', async () => {
    seedLoggedInSession();
    mockAxiosPost.mockRejectedValueOnce(new Error('500'));

    await expect(refreshToken()).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    expect(mockClearSecureTokens).toHaveBeenCalled();
    expect(mockKeychainState.token).toBeNull();
  });
});
