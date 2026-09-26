import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Biometric authentication service.
 *
 * Handles secure-store backed biometric credentials and guards against
 * lockout loops that occur when a user adds or removes a fingerprint/face
 * profile (enrollment change), which invalidates previously stored keys.
 */

export type BiometricErrorCode =
  | 'ENROLLMENT_CHANGED'
  | 'INCORRECT_BIOMETRIC'
  | 'CANCELLED'
  | 'LOCKOUT'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export interface BiometricResult {
  success: boolean;
  code?: BiometricErrorCode;
  /** True when the stored key was invalidated and re-enrollment is required. */
  requiresReEnrollment?: boolean;
  /** True when the caller should route the user to account recovery. */
  fallbackToRecovery?: boolean;
}

const BIOMETRIC_KEY = 'biometric_credential_key';

/** Max biometric prompts allowed per app session before we stop retrying. */
const MAX_PROMPTS_PER_SESSION = 3;

/**
 * Per-session prompt counter. Reset only when the app process restarts,
 * so a user cannot be trapped in an endless prompt loop.
 */
let promptCount = 0;
let sessionRequiresReEnrollment = false;

/**
 * Classify a LocalAuthentication error into a stable, loggable-safe code.
 * We never surface raw error messages (which may contain biometric details).
 */
function classifyError(error: unknown): BiometricErrorCode {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (
    message.includes('enrollment') ||
    message.includes('key invalidated') ||
    message.includes('invalidated') ||
    message.includes('changed')
  ) {
    return 'ENROLLMENT_CHANGED';
  }
  if (message.includes('cancel')) {
    return 'CANCELLED';
  }
  if (message.includes('lockout') || message.includes('too many')) {
    return 'LOCKOUT';
  }
  if (message.includes('not available') || message.includes('unavailable')) {
    return 'UNAVAILABLE';
  }
  if (message.includes('fail') || message.includes('not recognized') || message.includes('mismatch')) {
    return 'INCORRECT_BIOMETRIC';
  }
  return 'UNKNOWN';
}

/**
 * Clear only the affected secure-store key. Called once when an enrollment
 * change is detected so the invalidated credential is not retried.
 */
async function clearInvalidatedKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
  } catch {
    // Swallow: deletion failure must not leak details or block recovery.
  }
}

/**
 * Whether the current session has been flagged as requiring re-enrollment.
 */
export function requiresReEnrollment(): boolean {
  return sessionRequiresReEnrollment;
}

/**
 * Reset per-session state. Intended for tests and explicit sign-out flows.
 */
export function resetBiometricSession(): void {
  promptCount = 0;
  sessionRequiresReEnrollment = false;
}

/**
 * Attempt biometric authentication with lockout-loop protection.
 *
 * - Distinguishes enrollment-change errors from incorrect attempts.
 * - Invalidates the affected key exactly once.
 * - Rate-limits prompts per app session.
 * - Exposes a fallback to the existing account recovery flow.
 */
export async function authenticateWithBiometrics(): Promise<BiometricResult> {
  // If a prior enrollment change already flagged this session, do not prompt
  // again — route straight to the recovery fallback.
  if (sessionRequiresReEnrollment) {
    return {
      success: false,
      code: 'ENROLLMENT_CHANGED',
      requiresReEnrollment: true,
      fallbackToRecovery: true,
    };
  }

  // Rate-limit prompts per app session to prevent lockout loops.
  if (promptCount >= MAX_PROMPTS_PER_SESSION) {
    return {
      success: false,
      code: 'LOCKOUT',
      fallbackToRecovery: true,
    };
  }

  promptCount += 1;

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to continue',
      fallbackLabel: 'Use account recovery',
      disableDeviceFallback: false,
    });

    if (result.success) {
      return { success: true };
    }

    const code = classifyError((result as { error?: unknown }).error);

    if (code === 'ENROLLMENT_CHANGED') {
      // Invalidate the affected key once and flag the session.
      await clearInvalidatedKey();
      sessionRequiresReEnrollment = true;
      return {
        success: false,
        code,
        requiresReEnrollment: true,
        fallbackToRecovery: true,
      };
    }

    return {
      success: false,
      code,
      fallbackToRecovery: code === 'LOCKOUT' || code === 'UNAVAILABLE',
    };
  } catch (error) {
    const code = classifyError(error);

    if (code === 'ENROLLMENT_CHANGED') {
      await clearInvalidatedKey();
      sessionRequiresReEnrollment = true;
      return {
        success: false,
        code,
        requiresReEnrollment: true,
        fallbackToRecovery: true,
      };
    }

    return {
      success: false,
      code,
      fallbackToRecovery: code === 'LOCKOUT' || code === 'UNAVAILABLE',
    };
  }
}
