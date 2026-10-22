/**
 * biometricService.ts
 *
 * Biometric authentication service for PetChain Mobile App.
 *
 * Provides a clean, high-level API over `react-native-keychain` for:
 *  - Querying biometric hardware availability and type
 *  - Enrolling the device's biometric credentials for app unlock
 *  - Performing a biometric authentication challenge
 *  - Graceful fallback to PIN / password when biometrics fail or are
 *    unavailable
 *
 * All credential references stored in the Keychain are encrypted.
 * Actual passwords/tokens are **never** written to plain AsyncStorage.
 *
 * Platform support:
 *  - iOS  : Face ID and Touch ID (via `BIOMETRY_CURRENT_SET`)
 *  - Android : Fingerprint / Face Unlock / Iris (via
 *              `BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE`)
 *
 * Error handling:
 *  - Hardware unavailable  → functions return `false` / throw
 *    `BiometricError` with code `BIOMETRIC_UNAVAILABLE`
 *  - User cancellation     → `BiometricError` with code `USER_CANCELLED`
 *  - Too many failures     → `BiometricError` with code `LOCKOUT`
 *  - Unknown hardware err  → `BiometricError` with code `BIOMETRIC_ERROR`
 */

import * as Keychain from 'react-native-keychain';

import { logError } from '../utils/errorLogger';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Keychain service name for the biometric-protected credential entry. */
const BIOMETRIC_SERVICE = 'com.petchain.biometric.credential';

/** Username stored in Keychain alongside the encrypted credential reference. */
const BIOMETRIC_USERNAME = 'petchain_biometric_user';

/**
 * The value stored in Keychain under biometric protection.
 * This is an opaque marker, not the actual user password.
 * The real session token is retrieved separately via `authService.getToken()`.
 */
const BIOMETRIC_CREDENTIAL_MARKER = 'petchain:biometric:enrolled';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Result returned by `isBiometricAvailable`. */
export interface BiometricAvailabilityResult {
  /** `true` when the device has biometric hardware and at least one enrolled identity. */
  available: boolean;
  /**
   * Human-readable biometry type reported by the OS, e.g.
   * `"FaceID"`, `"TouchID"`, `"Fingerprint"`, `"Iris"`.
   * `null` when biometrics are unavailable.
   */
  biometryType: string | null;
}

/** Outcome returned by `authenticateWithBiometrics`. */
export interface BiometricAuthResult {
  /** `true` on successful biometric verification. */
  success: boolean;
  /**
   * Set when `success` is `false` to indicate why authentication did not
   * complete.  Callers should use this to decide whether to show a PIN
   * fallback screen.
   */
  fallbackReason?: 'unavailable' | 'not_enrolled' | 'user_cancelled' | 'lockout' | 'error';
}

/** Error class for biometric-specific failures. */
export class BiometricError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'BIOMETRIC_UNAVAILABLE'
      | 'NOT_ENROLLED'
      | 'USER_CANCELLED'
      | 'LOCKOUT'
      | 'BIOMETRIC_ERROR'
      | 'KEYCHAIN_ERROR',
  ) {
    super(message);
    this.name = 'BiometricError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Resolve the best available `ACCESS_CONTROL` constant at runtime. */
function resolveAccessControl(): Keychain.ACCESS_CONTROL {
  // Prefer the stricter "current set" variants so the credential is
  // invalidated if the user adds/removes a biometric identity.
  if (Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE) {
    return Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE;
  }
  if (Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET) {
    return Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET;
  }
  return Keychain.ACCESS_CONTROL.BIOMETRY_ANY;
}

/** Resolve the best available `SECURITY_LEVEL` constant at runtime. */
function resolveSecurityLevel(): Keychain.SECURITY_LEVEL | undefined {
  if ((Keychain.SECURITY_LEVEL as Record<string, unknown>)?.SECURE_HARDWARE) {
    return Keychain.SECURITY_LEVEL.SECURE_HARDWARE;
  }
  if ((Keychain.SECURITY_LEVEL as Record<string, unknown>)?.ANY) {
    return Keychain.SECURITY_LEVEL.ANY;
  }
  return undefined;
}

/** Map a raw Keychain/OS error to a structured `BiometricError`. */
function mapKeychainError(err: unknown): BiometricError {
  const msg = err instanceof Error ? err.message : String(err);

  if (/cancel/i.test(msg) || /user canceled/i.test(msg)) {
    return new BiometricError('Authentication cancelled by the user', 'USER_CANCELLED');
  }
  if (/lockout|too many attempts/i.test(msg)) {
    return new BiometricError(
      'Too many failed attempts — biometrics locked out. Please use PIN.',
      'LOCKOUT',
    );
  }
  if (/not available|no biometrics/i.test(msg)) {
    return new BiometricError('Biometric hardware not available on this device', 'BIOMETRIC_UNAVAILABLE');
  }
  return new BiometricError(`Biometric keychain error: ${msg}`, 'KEYCHAIN_ERROR');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Query the device for biometric hardware availability.
 *
 * @returns An object indicating whether biometrics are available and which
 *          type (FaceID, TouchID, Fingerprint, …) is supported.
 *
 * @example
 * const { available, biometryType } = await isBiometricAvailable();
 * if (available) showBiometricPrompt(biometryType);
 */
export async function isBiometricAvailable(): Promise<BiometricAvailabilityResult> {
  try {
    // `getSupportedBiometryType` returns null/undefined when no biometry is enrolled
    const biometryType = await Keychain.getSupportedBiometryType();
    return {
      available: biometryType != null,
      biometryType: biometryType ?? null,
    };
  } catch (err) {
    logError(err as Error, { service: 'biometricService', action: 'isBiometricAvailable' });
    return { available: false, biometryType: null };
  }
}

/**
 * Enroll this device for biometric login by writing an encrypted credential
 * marker into the Keychain, protected by the biometric access control policy.
 *
 * The user will be prompted to authenticate with their biometric to confirm
 * enrollment.
 *
 * Falls back gracefully (returns `false`) when:
 *  - Biometrics are not available or not enrolled
 *  - The user cancels the enrollment prompt
 *  - An unrecoverable hardware error occurs
 *
 * @param promptMessage  Optional prompt shown in the biometric dialog.
 * @returns `true` on successful enrollment, `false` otherwise.
 *
 * @example
 * const enrolled = await enrollBiometric('Enable Face ID for PetChain');
 * if (!enrolled) showFallbackSetupMessage();
 */
export async function enrollBiometric(
  promptMessage = 'Set up biometric login for faster, secure access',
): Promise<boolean> {
  const { available } = await isBiometricAvailable();
  if (!available) {
    return false;
  }

  try {
    const securityLevel = resolveSecurityLevel();

    await Keychain.setGenericPassword(
      BIOMETRIC_USERNAME,
      BIOMETRIC_CREDENTIAL_MARKER,
      {
        service: BIOMETRIC_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        accessControl: resolveAccessControl(),
        ...(securityLevel ? { securityLevel } : {}),
      },
    );

    // Immediately verify the enrollment by triggering a read with biometric
    // challenge — this ensures the credential was stored successfully.
    const verification = await Keychain.getGenericPassword({
      service: BIOMETRIC_SERVICE,
      authenticationPrompt: { title: promptMessage },
    });

    if (!verification || !('password' in verification)) {
      // Verification failed — clean up the partial enrollment
      await Keychain.resetGenericPassword({ service: BIOMETRIC_SERVICE });
      return false;
    }

    return true;
  } catch (err) {
    logError(err as Error, { service: 'biometricService', action: 'enrollBiometric' });
    // Clean up any partial keychain entry
    try {
      await Keychain.resetGenericPassword({ service: BIOMETRIC_SERVICE });
    } catch {
      // best-effort cleanup
    }
    return false;
  }
}

/**
 * Perform a biometric authentication challenge.
 *
 * Reads the enrolled credential from Keychain, which triggers the OS-level
 * biometric prompt (Face ID / Touch ID on iOS, Fingerprint / Face on Android).
 *
 * @param promptMessage  Text shown in the biometric dialog.
 * @returns A `BiometricAuthResult` describing the outcome.  On failure the
 *          `fallbackReason` field indicates the appropriate next step.
 *
 * Falls back automatically (`fallbackReason: 'not_enrolled'`) when the device
 * has no enrolled credential, allowing the caller to redirect to PIN entry.
 *
 * @throws `BiometricError` only for unrecoverable internal errors; all
 *         expected failure modes are expressed via `{ success: false, ... }`.
 *
 * @example
 * const result = await authenticateWithBiometrics('Confirm your identity');
 * if (result.success) {
 *   navigateToDashboard();
 * } else if (result.fallbackReason === 'user_cancelled') {
 *   showCancelMessage();
 * } else {
 *   navigateToPinScreen();
 * }
 */
export async function authenticateWithBiometrics(
  promptMessage = 'Authenticate to access your PetChain account',
): Promise<BiometricAuthResult> {
  // Check hardware availability first
  const { available } = await isBiometricAvailable();
  if (!available) {
    return { success: false, fallbackReason: 'unavailable' };
  }

  try {
    const credentials = await Keychain.getGenericPassword({
      service: BIOMETRIC_SERVICE,
      authenticationPrompt: { title: promptMessage },
    });

    if (!credentials || !('password' in credentials)) {
      // No credential stored → the user hasn't enrolled biometrics yet
      return { success: false, fallbackReason: 'not_enrolled' };
    }

    // Verify that the retrieved credential is our known marker
    if (credentials.password !== BIOMETRIC_CREDENTIAL_MARKER) {
      logError(new Error('Unexpected biometric credential marker'), {
        service: 'biometricService',
        action: 'authenticateWithBiometrics',
      });
      return { success: false, fallbackReason: 'error' };
    }

    return { success: true };
  } catch (err) {
    const mapped = mapKeychainError(err);
    logError(mapped, { service: 'biometricService', action: 'authenticateWithBiometrics' });

    switch (mapped.code) {
      case 'USER_CANCELLED':
        return { success: false, fallbackReason: 'user_cancelled' };
      case 'LOCKOUT':
        return { success: false, fallbackReason: 'lockout' };
      case 'BIOMETRIC_UNAVAILABLE':
        return { success: false, fallbackReason: 'unavailable' };
      default:
        return { success: false, fallbackReason: 'error' };
    }
  }
}

/**
 * Remove the stored biometric credential, effectively unenrolling the
 * device from biometric login.
 *
 * After calling this, `authenticateWithBiometrics` will return
 * `{ success: false, fallbackReason: 'not_enrolled' }` until the user
 * re-enrolls via `enrollBiometric`.
 *
 * @example
 * await unenrollBiometric();
 * showSuccessMessage('Biometric login disabled');
 */
export async function unenrollBiometric(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: BIOMETRIC_SERVICE });
  } catch (err) {
    logError(err as Error, { service: 'biometricService', action: 'unenrollBiometric' });
    throw new BiometricError(
      'Failed to remove biometric credential from Keychain',
      'KEYCHAIN_ERROR',
    );
  }
}

/**
 * Check whether biometric credentials are currently enrolled for this app.
 *
 * This is a lightweight read that does **not** trigger a biometric prompt.
 *
 * @returns `true` when an enrolled credential exists in the Keychain.
 *
 * @example
 * if (await isBiometricEnrolled()) showBiometricLoginButton();
 */
export async function isBiometricEnrolled(): Promise<boolean> {
  try {
    // `getGenericPassword` without `authenticationPrompt` checks for entry
    // existence without triggering biometric UI on most RN Keychain versions.
    const result = await Keychain.getGenericPassword({ service: BIOMETRIC_SERVICE });
    return !!(result && 'password' in result);
  } catch {
    return false;
  }
}
