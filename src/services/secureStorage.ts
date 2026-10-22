import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Typed, observable security events emitted by the secure storage layer.
 *
 * These are intentionally distinct from generic login errors so that callers
 * (and analytics/telemetry) can react to biometric enrollment changes without
 * conflating them with a bad password or a network failure.
 */
export type SecureStorageSecurityEventType =
  | 'biometric_enrollment_changed'
  | 'biometric_key_invalidated'
  | 'biometric_lockout'
  | 'biometric_cancelled';

export interface SecureStorageSecurityEvent {
  type: SecureStorageSecurityEventType;
  /** Human-readable, non-sensitive description. Never contains secrets. */
  message: string;
  /** Whether the user must re-authenticate via the approved recovery flow. */
  requiresReauthentication: boolean;
  /** Whether local biometric references were cleared as part of handling. */
  clearedLocalBiometricReferences: boolean;
  timestamp: number;
}

type SecurityEventListener = (event: SecureStorageSecurityEvent) => void;

const listeners = new Set<SecurityEventListener>();

/**
 * Subscribe to typed security events. Returns an unsubscribe function.
 */
export function subscribeToSecurityEvents(listener: SecurityEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitSecurityEvent(event: SecureStorageSecurityEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // A misbehaving listener must never break the security path.
    }
  });
}

const BIOMETRIC_KEY = 'biometric_key';
const BIOMETRIC_ENROLLMENT_MARKER = 'biometric_enrollment_marker';

/**
 * Error codes surfaced by SecureStore/Keychain when the underlying key has been
 * invalidated because the enrolled biometric set changed (fingerprint/face
 * added or removed). These are platform-specific and must be matched loosely.
 */
const ENROLLMENT_CHANGE_CODES = [
  'ERR_BIOMETRIC_ENROLLMENT_CHANGED',
  'ERR_BIOMETRIC_KEY_INVALIDATED',
  'ERR_SECURE_STORE_BIOMETRY_CHANGED',
  'ERR_KEYCHAIN_ITEM_INVALIDATED',
  'ERR_BIOMETRIC_LOCKOUT',
];

function isEnrollmentChangeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const code = (error as { code?: string }).code ?? '';
  const message = (error as { message?: string }).message ?? '';
  const haystack = `${code} ${message}`.toLowerCase();
  return (
    ENROLLMENT_CHANGE_CODES.some((c) => haystack.includes(c.toLowerCase())) ||
    haystack.includes('enrollment') ||
    haystack.includes('biometry changed') ||
    haystack.includes('key invalidated') ||
    haystack.includes('lockout')
  );
}

function isCancellationError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const code = (error as { code?: string }).code ?? '';
  const message = (error as { message?: string }).message ?? '';
  const haystack = `${code} ${message}`.toLowerCase();
  return haystack.includes('cancel') || haystack.includes('user_cancel');
}

/**
 * Clears invalid local biometric references so the app never loops on a
 * biometric prompt that can no longer succeed. Only local references are
 * removed; the account credential/recovery flow is untouched.
 */
export async function clearInvalidBiometricReferences(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
  } catch {
    // Best-effort: a missing key is already the desired end state.
  }
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENROLLMENT_MARKER);
  } catch {
    // Best-effort.
  }
}

/**
 * Records the current biometric enrollment marker. Callers should invoke this
 * after a successful biometric authentication so that a later mismatch can be
 * detected as an enrollment change.
 */
export async function recordBiometricEnrollmentMarker(marker: string): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENROLLMENT_MARKER, marker);
}

/**
 * Reads the stored biometric enrollment marker, if any.
 */
export async function getBiometricEnrollmentMarker(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(BIOMETRIC_ENROLLMENT_MARKER);
  } catch {
    return null;
  }
}

/**
 * Handles a biometric authentication failure. Detects enrollment changes and
 * lockouts, clears invalid local biometric references, and emits a typed,
 * observable security event. Never logs or returns secrets.
 *
 * Returns true when the failure was an enrollment change / invalidation that
 * requires re-authentication via the approved credential/recovery flow.
 */
export async function handleBiometricFailure(error: unknown): Promise<boolean> {
  if (isCancellationError(error)) {
    emitSecurityEvent({
      type: 'biometric_cancelled',
      message: 'Biometric authentication was cancelled by the user.',
      requiresReauthentication: false,
      clearedLocalBiometricReferences: false,
      timestamp: Date.now(),
    });
    return false;
  }

  if (!isEnrollmentChangeError(error)) {
    return false;
  }

  const isLockout = `${(error as { code?: string }).code ?? ''} ${(error as { message?: string }).message ?? ''}`
    .toLowerCase()
    .includes('lockout');

  await clearInvalidBiometricReferences();

  emitSecurityEvent({
    type: isLockout ? 'biometric_lockout' : 'biometric_enrollment_changed',
    message: isLockout
      ? 'Biometric authentication is temporarily locked out. Re-authenticate with your account credentials to continue.'
      : 'Your biometric enrollment changed. Re-authenticate with your account credentials to continue.',
    requiresReauthentication: true,
    clearedLocalBiometricReferences: true,
    timestamp: Date.now(),
  });

  return true;
}

/**
 * Platform-aware helper describing what data remains on-device after an
 * enrollment change. Contains no secrets and is safe to display to the user.
 */
export function getOnDeviceDataNotice(): string {
  const platformNote =
    Platform.OS === 'ios'
      ? 'Your encrypted Keychain entries remain on this device until you sign out.'
      : 'Your encrypted Keystore entries remain on this device until you sign out.';
  return `Your account credentials are not stored on this device. ${platformNote} Biometric unlock has been disabled until you re-authenticate.`;
}

export default {
  subscribeToSecurityEvents,
  clearInvalidBiometricReferences,
  recordBiometricEnrollmentMarker,
  getBiometricEnrollmentMarker,
  handleBiometricFailure,
  getOnDeviceDataNotice,
};
