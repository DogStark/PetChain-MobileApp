/**
 * Biometric re-authentication before sensitive exports — Issue #1193
 *
 * The biometric prompt is only an additional local gate: the server must
 * first confirm the user may export, then the device prompts. Cancel,
 * lockout, and missing hardware are handled according to a fallback policy.
 */

import api from './api';
import { authenticateWithBiometrics } from './biometricService';
import { isPermissionDenied } from './offlineServerCache';
import { networkMonitor } from '../utils/networkMonitor';

/** What to do when biometrics are unavailable or not enrolled. */
export type BiometricFallbackPolicy = 'deny' | 'allow_device_unprotected';

export type ExportGateResult =
  | { allowed: true; biometricVerified: boolean }
  | {
      allowed: false;
      reason: 'offline' | 'not_permitted' | 'cancelled' | 'lockout' | 'unavailable' | 'error';
      message: string;
    };

const MESSAGES = {
  offline: 'Exports need a connection to confirm your permissions.',
  not_permitted: 'You do not have permission to export these records.',
  cancelled: 'Export cancelled.',
  lockout: 'Biometrics are locked. Unlock your device and try again.',
  unavailable: 'Biometric verification is required for exports on this account.',
  error: 'Could not verify your identity. Please try again.',
} as const;

const deny = (reason: keyof typeof MESSAGES): ExportGateResult => ({
  allowed: false,
  reason,
  message: MESSAGES[reason],
});

export async function requireExportReauth(
  petId: string,
  policy: BiometricFallbackPolicy = 'deny',
): Promise<ExportGateResult> {
  if (!(await networkMonitor.isOnline())) return deny('offline');

  try {
    const { data } = await api.get(`/pets/${encodeURIComponent(petId)}/permissions`);
    if ((data as { canExport?: unknown } | null)?.canExport !== true) return deny('not_permitted');
  } catch (error) {
    return deny(isPermissionDenied(error) ? 'not_permitted' : 'error');
  }

  const result = await authenticateWithBiometrics('Confirm it is you to export pet records');
  if (result.success) return { allowed: true, biometricVerified: true };

  switch (result.fallbackReason) {
    case 'user_cancelled':
      return deny('cancelled');
    case 'lockout':
      return deny('lockout');
    case 'unavailable':
    case 'not_enrolled':
      return policy === 'allow_device_unprotected'
        ? { allowed: true, biometricVerified: false }
        : deny('unavailable');
    default:
      return deny('error');
  }
}
