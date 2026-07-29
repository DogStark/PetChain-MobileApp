/**
 * Unit tests for src/services/biometricService.ts
 *
 * All react-native-keychain calls are mocked so these run in Jest/Node
 * without any native bindings.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

let mockBiometryType: string | null = null;
let mockKeychainStore: Record<string, string> = {};
let mockGetGenericPasswordThrows: Error | null = null;
let mockSetGenericPasswordThrows: Error | null = null;
let mockResetGenericPasswordThrows: Error | null = null;

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  },
  ACCESS_CONTROL: {
    BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE: 'BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE',
    BIOMETRY_CURRENT_SET: 'BIOMETRY_CURRENT_SET',
    BIOMETRY_ANY: 'BIOMETRY_ANY',
  },
  SECURITY_LEVEL: {
    SECURE_HARDWARE: 'SECURE_HARDWARE',
    ANY: 'ANY',
  },
  getSupportedBiometryType: jest.fn(() => Promise.resolve(mockBiometryType)),
  setGenericPassword: jest.fn((_user: string, password: string, opts?: { service?: string }) => {
    if (mockSetGenericPasswordThrows) throw mockSetGenericPasswordThrows;
    mockKeychainStore[opts?.service ?? '__default__'] = password;
    return Promise.resolve(true);
  }),
  getGenericPassword: jest.fn((opts?: { service?: string }) => {
    if (mockGetGenericPasswordThrows) throw mockGetGenericPasswordThrows;
    const val = mockKeychainStore[opts?.service ?? '__default__'];
    return Promise.resolve(val ? { username: 'petchain_biometric_user', password: val } : false);
  }),
  resetGenericPassword: jest.fn((opts?: { service?: string }) => {
    if (mockResetGenericPasswordThrows) throw mockResetGenericPasswordThrows;
    delete mockKeychainStore[opts?.service ?? '__default__'];
    return Promise.resolve(true);
  }),
}));

jest.mock('../../utils/errorLogger', () => ({
  logError: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  isBiometricAvailable,
  enrollBiometric,
  authenticateWithBiometrics,
  unenrollBiometric,
  isBiometricEnrolled,
  BiometricError,
} from '../biometricService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BIOMETRIC_SERVICE = 'com.petchain.biometric.credential';
const CREDENTIAL_MARKER = 'petchain:biometric:enrolled';

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockBiometryType = null;
  mockKeychainStore = {};
  mockGetGenericPasswordThrows = null;
  mockSetGenericPasswordThrows = null;
  mockResetGenericPasswordThrows = null;
});

// ─── isBiometricAvailable() ───────────────────────────────────────────────────

describe('isBiometricAvailable()', () => {
  it('returns available=false and biometryType=null when no biometry is supported', async () => {
    mockBiometryType = null;
    const result = await isBiometricAvailable();
    expect(result.available).toBe(false);
    expect(result.biometryType).toBeNull();
  });

  it('returns available=true and biometryType="FaceID" when FaceID is supported', async () => {
    mockBiometryType = 'FaceID';
    const result = await isBiometricAvailable();
    expect(result.available).toBe(true);
    expect(result.biometryType).toBe('FaceID');
  });

  it('returns available=true for TouchID', async () => {
    mockBiometryType = 'TouchID';
    const result = await isBiometricAvailable();
    expect(result.available).toBe(true);
    expect(result.biometryType).toBe('TouchID');
  });

  it('returns available=true for Android Fingerprint', async () => {
    mockBiometryType = 'Fingerprint';
    const result = await isBiometricAvailable();
    expect(result.available).toBe(true);
    expect(result.biometryType).toBe('Fingerprint');
  });

  it('returns available=false when getSupportedBiometryType throws', async () => {
    const Keychain = require('react-native-keychain');
    (Keychain.getSupportedBiometryType as jest.Mock).mockRejectedValueOnce(
      new Error('native crash'),
    );
    const result = await isBiometricAvailable();
    expect(result.available).toBe(false);
    expect(result.biometryType).toBeNull();
  });
});

// ─── enrollBiometric() ───────────────────────────────────────────────────────

describe('enrollBiometric()', () => {
  it('returns false when biometrics are not available', async () => {
    mockBiometryType = null;
    expect(await enrollBiometric()).toBe(false);
  });

  it('returns true and stores the credential marker on success', async () => {
    mockBiometryType = 'FaceID';
    const result = await enrollBiometric();
    expect(result).toBe(true);
    expect(mockKeychainStore[BIOMETRIC_SERVICE]).toBe(CREDENTIAL_MARKER);
  });

  it('passes a custom prompt message to the verification read', async () => {
    mockBiometryType = 'TouchID';
    const Keychain = require('react-native-keychain');
    await enrollBiometric('My custom prompt');
    const getCall = (Keychain.getGenericPassword as jest.Mock).mock.calls.find(
      (args: any[]) => args[0]?.authenticationPrompt?.title === 'My custom prompt',
    );
    expect(getCall).toBeDefined();
  });

  it('returns false and cleans up when verification read returns false', async () => {
    mockBiometryType = 'FaceID';
    const Keychain = require('react-native-keychain');
    // set stores fine, but the verification read returns false
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce(false);
    const result = await enrollBiometric();
    expect(result).toBe(false);
    expect(mockKeychainStore[BIOMETRIC_SERVICE]).toBeUndefined();
  });

  it('returns false and cleans up when setGenericPassword throws', async () => {
    mockBiometryType = 'FaceID';
    mockSetGenericPasswordThrows = new Error('keychain write failed');
    const result = await enrollBiometric();
    expect(result).toBe(false);
  });
});

// ─── authenticateWithBiometrics() ────────────────────────────────────────────

describe('authenticateWithBiometrics()', () => {
  it('returns { success: false, fallbackReason: "unavailable" } when biometrics unavailable', async () => {
    mockBiometryType = null;
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
    expect(result.fallbackReason).toBe('unavailable');
  });

  it('returns { success: false, fallbackReason: "not_enrolled" } when no credential exists', async () => {
    mockBiometryType = 'FaceID';
    // nothing stored in keychain
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
    expect(result.fallbackReason).toBe('not_enrolled');
  });

  it('returns { success: true } when the correct credential marker is retrieved', async () => {
    mockBiometryType = 'FaceID';
    // pre-enroll
    await enrollBiometric();
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(true);
    expect(result.fallbackReason).toBeUndefined();
  });

  it('returns { success: false, fallbackReason: "user_cancelled" } on user cancel', async () => {
    mockBiometryType = 'FaceID';
    await enrollBiometric();
    mockGetGenericPasswordThrows = new Error('User canceled the operation');
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
    expect(result.fallbackReason).toBe('user_cancelled');
  });

  it('returns { success: false, fallbackReason: "lockout" } on too many attempts', async () => {
    mockBiometryType = 'Fingerprint';
    await enrollBiometric();
    mockGetGenericPasswordThrows = new Error('Lockout: too many attempts');
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
    expect(result.fallbackReason).toBe('lockout');
  });

  it('returns { success: false, fallbackReason: "error" } on unexpected errors', async () => {
    mockBiometryType = 'TouchID';
    await enrollBiometric();
    mockGetGenericPasswordThrows = new Error('hardware malfunction');
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
    expect(result.fallbackReason).toBe('error');
  });
});

// ─── unenrollBiometric() ─────────────────────────────────────────────────────

describe('unenrollBiometric()', () => {
  it('removes the stored credential so isBiometricEnrolled returns false', async () => {
    mockBiometryType = 'FaceID';
    await enrollBiometric();
    expect(mockKeychainStore[BIOMETRIC_SERVICE]).toBe(CREDENTIAL_MARKER);

    await unenrollBiometric();
    expect(mockKeychainStore[BIOMETRIC_SERVICE]).toBeUndefined();
  });

  it('does not throw when no credential is stored', async () => {
    await expect(unenrollBiometric()).resolves.toBeUndefined();
  });

  it('throws BiometricError with code KEYCHAIN_ERROR when reset fails', async () => {
    mockResetGenericPasswordThrows = new Error('keychain reset failed');
    await expect(unenrollBiometric()).rejects.toMatchObject({
      code: 'KEYCHAIN_ERROR',
      name: 'BiometricError',
    });
  });
});

// ─── isBiometricEnrolled() ───────────────────────────────────────────────────

describe('isBiometricEnrolled()', () => {
  it('returns false when no credential is stored', async () => {
    expect(await isBiometricEnrolled()).toBe(false);
  });

  it('returns true after a successful enrollment', async () => {
    mockBiometryType = 'TouchID';
    await enrollBiometric();
    expect(await isBiometricEnrolled()).toBe(true);
  });

  it('returns false after unenrolling', async () => {
    mockBiometryType = 'FaceID';
    await enrollBiometric();
    await unenrollBiometric();
    expect(await isBiometricEnrolled()).toBe(false);
  });

  it('returns false when getGenericPassword throws', async () => {
    const Keychain = require('react-native-keychain');
    (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('crash'));
    expect(await isBiometricEnrolled()).toBe(false);
  });
});

// ─── BiometricError class ────────────────────────────────────────────────────

describe('BiometricError', () => {
  it('is an instance of Error', () => {
    expect(new BiometricError('msg', 'BIOMETRIC_UNAVAILABLE')).toBeInstanceOf(Error);
  });

  it('has name "BiometricError"', () => {
    expect(new BiometricError('msg', 'USER_CANCELLED').name).toBe('BiometricError');
  });

  it('exposes the code property', () => {
    expect(new BiometricError('msg', 'LOCKOUT').code).toBe('LOCKOUT');
  });
});
