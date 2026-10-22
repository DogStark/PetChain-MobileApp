import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Secure-store wrapper with biometric resilience.
 *
 * Issue #1054: when a user adds or removes a fingerprint/face profile, the
 * biometric-backed secure-store key can become invalid. We must detect that
 * (distinct from a wrong biometric attempt), clear only the affected key once,
 * mark the session as requiring re-enrollment, and expose a fallback to the
 * existing account recovery flow — without logging any biometric error detail.
 */

export type BiometricFailureReason =
  | 'enrollment_changed'
  | 'incorrect_biometric'
  | 'cancelled'
  | 'lockout'
  | 'unavailable';

export interface BiometricResult {
  success: boolean;
  reason?: BiometricFailureReason;
  /** True when the session must re-enroll biometrics before retrying. */
  requiresReEnrollment?: boolean;
  /** True when the caller should route the user to account recovery. */
  fallbackToRecovery?: boolean;
}

const BIOMETRIC_KEY = 'auth.biometric.key';
const RE_ENROLL_FLAG = 'auth.biometric.requiresReEnrollment';

// Rate-limit prompts per app session (in-memory, resets on cold start).
const MAX_PROMPTS_PER_SESSION = 3;
let promptCount = 0;
let sessionLocked = false;

/**
 * Classify a LocalAuthentication error into a stable, non-secret reason.
 * Enrollment-change errors are distinguishable from an incorrect attempt.
 */
function classifyError(error: unknown): BiometricFailureReason {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';
  const haystack = `${code} ${message}`.toLowerCase();

  if (
    haystack.includes('enrollment') ||
    haystack.includes('notenrolled') ||
    haystack.includes('keyinvalidated') ||
    haystack.includes('invalidated')
  ) {
    return 'enrollment_changed';
  }
  if (haystack.includes('lockout') || haystack.includes('lockedout')) {
    return 'lockout';
  }
  if (haystack.includes('cancel') || haystack.includes('user_cancel')) {
    return 'cancelled';
  }
  if (haystack.includes('notavailable') || haystack.includes('unavailable')) {
    return 'unavailable';
  }
  return 'incorrect_biometric';
}

/**
 * Clear only the affected biometric key and mark the session as requiring
 * re-enrollment. Idempotent: the key is invalidated once and not retried.
 */
async function invalidateBiometricKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
  } catch {
    // Never surface or log key material / biometric error details.
  }
  try {
    await SecureStore.setItemAsync(RE_ENROLL_FLAG, 'true');
  } catch {
    // Best-effort flag; failure must not throw to the caller.
  }
  sessionLocked = true;
}

/** Whether the current session must re-enroll biometrics. */
export async function requiresBiometricReEnrollment(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(RE_ENROLL_FLAG)) === 'true';
  } catch {
    return false;
  }
}

/** Clear the re-enrollment flag after a successful re-enrollment. */
export async function clearBiometricReEnrollment(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(RE_ENROLL_FLAG);
  } catch {
    // Best-effort.
  }
  sessionLocked = false;
  promptCount = 0;
}

/**
 * Prompt for biometrics with enrollment-change detection and per-session
 * rate limiting. On enrollment change the affected key is cleared once and the
 * caller is told to fall back to account recovery.
 */
export async function authenticateWithBiometrics(): Promise<BiometricResult> {
  if (sessionLocked) {
    return {
      success: false,
      reason: 'enrollment_changed',
      requiresReEnrollment: true,
      fallbackToRecovery: true,
    };
  }

  if (promptCount >= MAX_PROMPTS_PER_SESSION) {
    return {
      success: false,
      reason: 'lockout',
      requiresReEnrollment: true,
      fallbackToRecovery: true,
    };
  }

  promptCount += 1;

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to continue',
      disableDeviceFallback: true,
    });

    if (result.success) {
      return { success: true };
    }

    const reason = classifyError(result.error);
    if (reason === 'enrollment_changed') {
      await invalidateBiometricKey();
      return {
        success: false,
        reason,
        requiresReEnrollment: true,
        fallbackToRecovery: true,
      };
    }

    return { success: false, reason };
  } catch (error) {
    const reason = classifyError(error);
    if (reason === 'enrollment_changed') {
      await invalidateBiometricKey();
      return {
        success: false,
        reason,
        requiresReEnrollment: true,
        fallbackToRecovery: true,
      };
    }
    return { success: false, reason };
  }
}
