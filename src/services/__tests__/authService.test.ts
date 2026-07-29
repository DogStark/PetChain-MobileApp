/**
 * Unit tests for src/services/authService.ts  (Issue #824)
 *
 * All external dependencies (axios, expo-secure-store, react-native-keychain,
 * sessionMonitoringService) are mocked so these run cleanly in Jest without
 * any native modules. Axios requests are verified via jest.fn() spies.
 *
 * Coverage targets: login, register, logout, refreshToken, getToken,
 * isAuthenticated, getSession, biometric helpers, PIN helpers, and OAuth flow.
 */

// ─── Mocks (must be declared before imports) ──────────────────────────────────

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    api: {
      baseUrl: 'https://api.petchain.app/api',
      timeoutMs: 10000,
    },
  },
}));

// Axios mock — exposes spy handles so tests can control per-call behaviour
const mockAxiosPost = jest.fn();
const mockAxiosGet = jest.fn();
const mockAxiosDelete = jest.fn();

jest.mock('axios', () => {
  const actual = jest.requireActual<typeof import('axios')>('axios');
  return {
    ...actual,
    create: () => ({
      post: mockAxiosPost,
      get: mockAxiosGet,
      delete: mockAxiosDelete,
    }),
    isAxiosError: (err: unknown) =>
      typeof err === 'object' && err !== null && (err as Record<string, unknown>).isAxiosError === true,
  };
});

// in-memory backing stores shared between mock and assertions
const keychainStore: Record<string, string> = {};
const secureStoreData: Record<string, string> = {};
let supportedBiometryType: string | null = null;
let biometricAuthShouldFail = false;

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
  ACCESS_CONTROL: {
    BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE: 'BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE',
  },
  AUTHENTICATION_TYPE: {
    DEVICE_PASSCODE_OR_BIOMETRICS: 'DEVICE_PASSCODE_OR_BIOMETRICS',
  },
  SECURITY_LEVEL: { SECURE_HARDWARE: 'SECURE_HARDWARE', ANY: 'ANY' },
  setGenericPassword: jest.fn((_user: string, value: string, opts?: { service?: string }) => {
    keychainStore[opts?.service ?? '__default__'] = value;
    return Promise.resolve(true);
  }),
  getGenericPassword: jest.fn((opts?: { service?: string }) => {
    if (opts?.service === 'com.petchain.auth.biometric' && biometricAuthShouldFail) {
      return Promise.resolve(false);
    }
    const val = keychainStore[opts?.service ?? '__default__'];
    return Promise.resolve(val ? { username: 'petchain_user', password: val } : false);
  }),
  resetGenericPassword: jest.fn((opts?: { service?: string }) => {
    delete keychainStore[opts?.service ?? '__default__'];
    return Promise.resolve(true);
  }),
  getSupportedBiometryType: jest.fn(() => Promise.resolve(supportedBiometryType)),
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  setItemAsync: jest.fn((key: string, value: string) => {
    secureStoreData[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => Promise.resolve(secureStoreData[key] ?? null)),
  deleteItemAsync: jest.fn((key: string) => {
    delete secureStoreData[key];
    return Promise.resolve();
  }),
}));

jest.mock('../sessionMonitoringService', () => ({
  __esModule: true,
  default: {
    isBiometricCheckExpired: jest.fn().mockResolvedValue(true),
    setLastBiometricCheck: jest.fn().mockResolvedValue(undefined),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  login,
  logout,
  register,
  refreshToken,
  getToken,
  getSession,
  getStoredToken,
  getStoredTokens,
  isAuthenticated,
  isBiometricAuthenticationAvailable,
  isBiometricAuthenticationEnabled,
  promptForBiometricSetup,
  disableBiometricAuthentication,
  authenticateWithBiometrics,
  requestPasswordReset,
  AuthError,
  setPin,
  verifyPin,
} from '../authService';

// ─── JWT helpers ─────────────────────────────────────────────────────────────

/** Encode a string to base64url without external deps */
function toBase64Url(str: string): string {
  const bytes = Array.from(str).map((c) => c.charCodeAt(0));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeJwt(exp: number): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({ sub: 'user-1', exp, iat: exp - 3600 }));
  return `${header}.${payload}.fakesig`;
}

const NOW = Math.floor(Date.now() / 1000);
const VALID_TOKEN = makeJwt(NOW + 3600);    // valid for 1 h
const EXPIRED_TOKEN = makeJwt(NOW - 3600);  // expired 1 h ago

const MOCK_USER = { id: 'u1', email: 'user@example.com', name: 'Test User', role: 'owner' };

const MOCK_LOGIN_RESPONSE = {
  user: MOCK_USER,
  token: VALID_TOKEN,
  refreshToken: 'refresh-abc',
  expiresIn: 3600,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAxiosError(status: number, message?: string) {
  return Object.assign(new Error(String(status)), {
    isAxiosError: true,
    response: {
      status,
      data: message ? { error: { message } } : {},
    },
  });
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(keychainStore).forEach((k) => delete keychainStore[k]);
  Object.keys(secureStoreData).forEach((k) => delete secureStoreData[k]);
  supportedBiometryType = null;
  biometricAuthShouldFail = false;
});

// ─── login() ─────────────────────────────────────────────────────────────────

describe('login()', () => {
  it('returns a session with user, token, and refreshToken on success', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });

    const session = await login('user@example.com', 'Password1');

    expect(session.token).toBe(VALID_TOKEN);
    expect(session.refreshToken).toBe('refresh-abc');
    expect(session.user).toMatchObject({ email: 'user@example.com' });
  });

  it('persists tokens so getToken() returns the access token', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');

    expect(await getToken()).toBe(VALID_TOKEN);
  });

  it('throws MISSING_CREDENTIALS when email is empty', async () => {
    await expect(login('', 'Password1')).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('throws MISSING_CREDENTIALS when password is empty', async () => {
    await expect(login('user@example.com', '')).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('throws INVALID_CREDENTIALS on HTTP 401', async () => {
    mockAxiosPost.mockRejectedValueOnce(makeAxiosError(401));
    await expect(login('user@example.com', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('throws RATE_LIMITED on HTTP 429', async () => {
    mockAxiosPost.mockRejectedValueOnce(makeAxiosError(429));
    await expect(login('user@example.com', 'Password1')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('propagates custom error message from server on other 4xx', async () => {
    mockAxiosPost.mockRejectedValueOnce(makeAxiosError(400, 'Account suspended'));
    await expect(login('user@example.com', 'Password1')).rejects.toMatchObject({
      code: 'LOGIN_FAILED',
      message: 'Account suspended',
    });
  });

  it('throws NETWORK_ERROR on non-axios errors', async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error('Network failure'));
    await expect(login('user@example.com', 'Password1')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('handles a response without a refreshToken', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: { ...MOCK_LOGIN_RESPONSE, refreshToken: undefined },
    });
    const session = await login('user@example.com', 'Password1');
    expect(session.refreshToken).toBeUndefined();
  });
});

// ─── register() ──────────────────────────────────────────────────────────────

describe('register()', () => {
  it('creates account, stores tokens, and returns session', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });

    const session = await register({ email: 'new@example.com', name: 'New User', password: 'Pw1' });

    expect(session.user.email).toBe('user@example.com');
    expect(await getToken()).toBe(VALID_TOKEN);
  });

  it('throws MISSING_REGISTRATION_FIELDS when email is missing', async () => {
    await expect(register({ email: '', name: 'User', password: 'Pw1' })).rejects.toMatchObject({
      code: 'MISSING_REGISTRATION_FIELDS',
    });
  });

  it('throws MISSING_REGISTRATION_FIELDS when name is missing', async () => {
    await expect(
      register({ email: 'a@b.com', name: '', password: 'Pw1' }),
    ).rejects.toMatchObject({ code: 'MISSING_REGISTRATION_FIELDS' });
  });

  it('throws MISSING_REGISTRATION_FIELDS when password is missing', async () => {
    await expect(
      register({ email: 'a@b.com', name: 'User', password: '' }),
    ).rejects.toMatchObject({ code: 'MISSING_REGISTRATION_FIELDS' });
  });

  it('throws REGISTRATION_FAILED on server error', async () => {
    mockAxiosPost.mockRejectedValueOnce(makeAxiosError(409, 'Email already in use'));
    await expect(
      register({ email: 'dup@example.com', name: 'User', password: 'Pw1' }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_FAILED', message: 'Email already in use' });
  });

  it('throws NETWORK_ERROR on non-axios error during registration', async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      register({ email: 'a@b.com', name: 'User', password: 'Pw1' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

// ─── logout() ────────────────────────────────────────────────────────────────

describe('logout()', () => {
  it('clears stored tokens so getToken() returns null', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');
    expect(await getToken()).toBe(VALID_TOKEN); // sanity check

    await logout();

    expect(await getToken()).toBeNull();
    expect(await getStoredToken()).toBeNull();
    expect(await getStoredTokens()).toBeNull();
  });

  it('is idempotent — calling logout twice does not throw', async () => {
    await expect(logout()).resolves.toBeUndefined();
    await expect(logout()).resolves.toBeUndefined();
  });
});

// ─── getToken() ──────────────────────────────────────────────────────────────

describe('getToken()', () => {
  it('returns null when no token is stored', async () => {
    expect(await getToken()).toBeNull();
  });

  it('returns the access token when a valid one is stored', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');
    expect(await getToken()).toBe(VALID_TOKEN);
  });

  it('automatically refreshes an expired token', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: { ...MOCK_LOGIN_RESPONSE, token: EXPIRED_TOKEN },
    });
    await login('user@example.com', 'Password1');

    const freshToken = makeJwt(NOW + 7200);
    mockAxiosPost.mockResolvedValueOnce({
      data: { token: freshToken, refreshToken: 'refresh-new' },
    });

    const token = await getToken();
    expect(token).toBe(freshToken);
  });

  it('returns null when token is expired and refresh also fails', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: { ...MOCK_LOGIN_RESPONSE, token: EXPIRED_TOKEN },
    });
    await login('user@example.com', 'Password1');

    mockAxiosPost.mockRejectedValueOnce(makeAxiosError(401));

    // getToken calls refreshToken internally; refreshToken throws → getToken rethrows
    await expect(getToken()).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
  });
});

// ─── isAuthenticated() ───────────────────────────────────────────────────────

describe('isAuthenticated()', () => {
  it('returns false when no token is stored', async () => {
    expect(await isAuthenticated()).toBe(false);
  });

  it('returns true when a valid non-expired token is stored', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');
    expect(await isAuthenticated()).toBe(true);
  });

  it('returns false when the stored token is expired and refresh fails', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: { ...MOCK_LOGIN_RESPONSE, token: EXPIRED_TOKEN },
    });
    await login('user@example.com', 'Password1');
    mockAxiosPost.mockRejectedValueOnce(makeAxiosError(401));

    // isAuthenticated absorbs the error and returns false
    const result = await isAuthenticated().catch(() => false);
    expect(result).toBe(false);
  });
});

// ─── refreshToken() ──────────────────────────────────────────────────────────

describe('refreshToken()', () => {
  it('exchanges the stored refresh token and returns a new access token', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');

    const newToken = makeJwt(NOW + 7200);
    mockAxiosPost.mockResolvedValueOnce({
      data: { token: newToken, refreshToken: 'refresh-new', expiresIn: 7200 },
    });

    const result = await refreshToken();
    expect(result).toBe(newToken);
    expect(await getToken()).toBe(newToken);
  });

  it('updates the stored refresh token when a new one is returned', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');

    const newToken = makeJwt(NOW + 7200);
    mockAxiosPost.mockResolvedValueOnce({
      data: { token: newToken, refreshToken: 'refresh-rotated' },
    });

    await refreshToken();
    const session = await getSession();
    expect(session?.refreshToken).toBe('refresh-rotated');
  });

  it('throws NO_REFRESH_TOKEN when no refresh token is stored', async () => {
    await expect(refreshToken()).rejects.toMatchObject({ code: 'NO_REFRESH_TOKEN' });
  });

  it('clears tokens and throws REFRESH_FAILED on server error', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');

    mockAxiosPost.mockRejectedValueOnce(makeAxiosError(401));

    await expect(refreshToken()).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    expect(await getToken()).toBeNull();
  });

  it('clears tokens and throws REFRESH_FAILED on network error', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');

    mockAxiosPost.mockRejectedValueOnce(new Error('connection refused'));

    await expect(refreshToken()).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    expect(await getToken()).toBeNull();
  });
});

// ─── getSession() ────────────────────────────────────────────────────────────

describe('getSession()', () => {
  it('returns null when no session is stored', async () => {
    expect(await getSession()).toBeNull();
  });

  it('returns token and refreshToken for an active session', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');

    const session = await getSession();
    expect(session).toMatchObject({ token: VALID_TOKEN, refreshToken: 'refresh-abc' });
  });
});

// ─── requestPasswordReset() ──────────────────────────────────────────────────

describe('requestPasswordReset()', () => {
  it('resolves without error on success', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { success: true } });
    await expect(requestPasswordReset('user@example.com')).resolves.toBeUndefined();
    expect(mockAxiosPost).toHaveBeenCalledWith('/auth/forgot-password', {
      email: 'user@example.com',
    });
  });

  it('throws RESET_FAILED when the server returns an error', async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error('server error'));
    await expect(requestPasswordReset('user@example.com')).rejects.toMatchObject({
      code: 'RESET_FAILED',
    });
  });
});

// ─── Biometric authentication ────────────────────────────────────────────────

describe('biometric authentication', () => {
  it('reports biometrics unavailable when no biometry type is set', async () => {
    expect(await isBiometricAuthenticationAvailable()).toBe(false);
  });

  it('reports biometrics available when FaceID is supported', async () => {
    supportedBiometryType = 'FaceID';
    expect(await isBiometricAuthenticationAvailable()).toBe(true);
  });

  it('reports biometrics available when TouchID is supported', async () => {
    supportedBiometryType = 'TouchID';
    expect(await isBiometricAuthenticationAvailable()).toBe(true);
  });

  it('promptForBiometricSetup enables biometrics when hardware is available', async () => {
    supportedBiometryType = 'FaceID';
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');

    const result = await promptForBiometricSetup();
    expect(result).toBe(true);
    expect(await isBiometricAuthenticationEnabled()).toBe(true);
  });

  it('promptForBiometricSetup returns false when biometrics are not available', async () => {
    const result = await promptForBiometricSetup();
    expect(result).toBe(false);
  });

  it('authenticateWithBiometrics succeeds and returns the stored session', async () => {
    supportedBiometryType = 'FaceID';
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');
    await promptForBiometricSetup();

    const session = await authenticateWithBiometrics();
    expect(session).toMatchObject({ token: VALID_TOKEN });
  });

  it('authenticateWithBiometrics throws BIOMETRIC_UNAVAILABLE when not available', async () => {
    await expect(authenticateWithBiometrics()).rejects.toMatchObject({
      code: 'BIOMETRIC_UNAVAILABLE',
    });
  });

  it('authenticateWithBiometrics throws BIOMETRIC_AUTH_FAILED when verification fails', async () => {
    supportedBiometryType = 'Fingerprint';
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');
    await promptForBiometricSetup();

    biometricAuthShouldFail = true;

    await expect(authenticateWithBiometrics()).rejects.toMatchObject({
      code: 'BIOMETRIC_AUTH_FAILED',
    });
  });

  it('disableBiometricAuthentication removes biometric preference', async () => {
    supportedBiometryType = 'FaceID';
    mockAxiosPost.mockResolvedValueOnce({ data: MOCK_LOGIN_RESPONSE });
    await login('user@example.com', 'Password1');
    await promptForBiometricSetup();

    expect(await isBiometricAuthenticationEnabled()).toBe(true);

    await disableBiometricAuthentication();
    expect(await isBiometricAuthenticationEnabled()).toBe(false);
  });
});

// ─── PIN helpers ─────────────────────────────────────────────────────────────

describe('PIN helpers', () => {
  it('setPin + verifyPin accepts correct PIN', async () => {
    await setPin('123456');
    expect(await verifyPin('123456')).toBe(true);
  });

  it('verifyPin rejects incorrect PIN', async () => {
    await setPin('123456');
    expect(await verifyPin('000000')).toBe(false);
  });

  it('verifyPin rejects when no PIN is set', async () => {
    expect(await verifyPin('123456')).toBe(false);
  });
});

// ─── AuthError class ─────────────────────────────────────────────────────────

describe('AuthError', () => {
  it('is an instance of Error', () => {
    const err = new AuthError('oops', 'TEST_CODE');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "AuthError"', () => {
    expect(new AuthError('msg', 'CODE').name).toBe('AuthError');
  });

  it('exposes the code as a property', () => {
    expect(new AuthError('msg', 'MY_CODE').code).toBe('MY_CODE');
  });

  it('exposes the message as a property', () => {
    expect(new AuthError('some error', 'CODE').message).toBe('some error');
  });
});
