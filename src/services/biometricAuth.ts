import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Typed, observable security events emitted by the biometric auth service.
 * Consumers can subscribe to react to enrollment changes without parsing
 * generic login errors.
 */
export type BiometricSecurityEventType =
  | 'enrollment-changed'
  | 'biometric-unavailable'
  | 'biometric-lockout'
  | 'biometric-cancelled';

export interface BiometricSecurityEvent {
  type: BiometricSecurityEventType;
  /** Human-readable, non-sensitive explanation. Never contains secrets. */
  message: string;
  /** Whether the user must re-authenticate via the approved recovery flow. */
  requiresReauth: boolean;
  timestamp: number;
}

export type BiometricSecurityListener = (event: BiometricSecurityEvent) => void;

/**
 * Result of a biometric authentication attempt. `enrollmentChanged` is set
 * when the stored key reference is no longer valid (e.g. a fingerprint or
 * face profile was added/removed), which is distinct from a plain failure.
 */
export interface BiometricAuthResult {
  success: boolean;
  enrollmentChanged: boolean;
  error?: string;
}

const BIOMETRIC_KEY_REF = 'biometric.key.reference';
const BIOMETRIC_ENROLLMENT_FINGERPRINT = 'biometric.enrollment.fingerprint';

const listeners = new Set<BiometricSecurityListener>();

/**
 * Subscribe to typed biometric security events. Returns an unsubscribe fn.
 */
export function subscribeToBiometricSecurityEvents(
  listener: BiometricSecurityListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: BiometricSecurityEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // A misbehaving listener must never break the auth flow.
    }
  });
}

/**
 * Builds a non-secret fingerprint of the current enrollment state so we can
 * detect when the set of enrolled biometric profiles changes.
 */
async function computeEnrollmentFingerprint(): Promise<string | null> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return `${level}:${types.sort().join(',')}`;
  } catch {
    return null;
  }
}

/**
 * Clears any locally stored biometric key references. Called when the
 * enrollment fingerprint no longer matches so the app never loops on
 * biometric prompts against an invalidated key.
 */
export async function clearInvalidBiometricReferences(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(BIOMETRIC_KEY_REF).catch(() => undefined),
    SecureStore.deleteItemAsync(BIOMETRIC_ENROLLMENT_FINGERPRINT).catch(() => undefined),
  ]);
}

/**
 * Records the current enrollment fingerprint after a successful enrollment
 * or re-enrollment so future changes can be detected.
 */
export async function recordEnrollmentFingerprint(): Promise<void> {
  const fingerprint = await computeEnrollmentFingerprint();
  if (fingerprint) {
    await SecureStore.setItemAsync(BIOMETRIC_ENROLLMENT_FINGERPRINT, fingerprint);
  }
}

/**
 * Detects whether the biometric enrollment has changed since the last
 * recorded fingerprint. Returns true when a change is detected.
 */
export async function hasEnrollmentChanged(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(BIOMETRIC_ENROLLMENT_FINGERPRINT).catch(
    () => null,
  );
  if (!stored) {
    return false;
  }
  const current = await computeEnrollmentFingerprint();
  if (!current) {
    return false;
  }
  return stored !== current;
}

/**
 * Authenticates the user with biometrics, detecting enrollment changes and
 * emitting typed security events. Never logs or returns secrets.
 */
export async function authenticateWithBiometrics(): Promise<BiometricAuthResult> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (!hasHardware || !isEnrolled) {
    emit({
      type: 'biometric-unavailable',
      message: 'Biometric authentication is not available on this device.',
      requiresReauth: true,
      timestamp: Date.now(),
    });
    return { success: false, enrollmentChanged: false, error: 'unavailable' };
  }

  if (await hasEnrollmentChanged()) {
    await clearInvalidBiometricReferences();
    emit({
      type: 'enrollment-changed',
      message:
        'Your biometric enrollment changed. Please sign in again to re-enable biometric unlock.',
      requiresReauth: true,
      timestamp: Date.now(),
    });
    return { success: false, enrollmentChanged: true, error: 'enrollment-changed' };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock',
    disableDeviceFallback: false,
  });

  if (result.success) {
    await recordEnrollmentFingerprint();
    return { success: true, enrollmentChanged: false };
  }

  if (result.error === 'lockout') {
    emit({
      type: 'biometric-lockout',
      message: 'Biometric authentication is temporarily locked. Use your password to continue.',
      requiresReauth: true,
      timestamp: Date.now(),
    });
    return { success: false, enrollmentChanged: false, error: 'lockout' };
  }

  if (result.error === 'user_cancel' || result.error === 'system_cancel') {
    emit({
      type: 'biometric-cancelled',
      message: 'Biometric authentication was cancelled.',
      requiresReauth: false,
      timestamp: Date.now(),
    });
    return { success: false, enrollmentChanged: false, error: 'cancelled' };
  }

  return { success: false, enrollmentChanged: false, error: result.error };
}
